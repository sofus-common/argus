import { historicalMarks, historyToday, type HistoricalMark, type HistoricalRange } from './price-history';
import { projectPositionLots, projectPositionLotsAt, type PositionLots } from './position-lots';
import type { BrokerBindings, createThetaRequest } from './broker-context';

function day(value: string) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) throw new Error('Invalid performance date');
  return value;
}

export function performanceCutoff(date: string) {
  const utc = Date.parse(`${day(date)}T17:15:00.000Z`);
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(utc);
  const hour = Number(parts.find(part => part.type === 'hour')!.value), minute = Number(parts.find(part => part.type === 'minute')!.value);
  return new Date(utc + ((17 * 60 + 15) - (hour * 60 + minute)) * 60000).toISOString();
}

export function validatePerformanceRange(range: HistoricalRange, now = new Date()) {
  if (!range || Object.keys(range).sort().join() !== 'end,start') throw new Error('Invalid performance range');
  const count = (Date.parse(day(range.end)) - Date.parse(day(range.start))) / 86400000 + 1;
  if (count < 1 || count > 31 || range.end >= historyToday(now)) throw new Error('Performance requires at most 31 complete New York dates');
}

export function preparePositionPerformance(position: PositionLots, range: HistoricalRange, now = new Date()) {
  validatePerformanceRange(range, now);
  const full = projectPositionLots(position);
  if (full.initial.pricing?.mode !== 'market') throw new Error('Performance requires listed recorded holdings');
  const rows = Array.from({ length: (Date.parse(range.end) - Date.parse(range.start)) / 86400000 + 1 }, (_, index) => {
    const date = new Date(Date.parse(range.start) + index * 86400000).toISOString().slice(0, 10), cutoff = performanceCutoff(date);
    return { date, cutoff, projection: Date.parse(cutoff) < Date.parse(full.initial.valuationTimestamp) ? null : projectPositionLotsAt(position, cutoff) };
  });
  const assets = new Map(rows.flatMap(row => row.projection?.lots.map(lot => [lot.asset.kind === 'stock' ? 'stock' : lot.asset.contractId, lot.asset] as const) ?? []));
  if (assets.size > 64) throw new Error('Performance history exceeds 64 held identities; narrow the date range');
  const options = [...assets.values()].filter(asset => asset.kind === 'option');
  return { rows, options, stock: assets.has('stock'), symbol: full.initial.underlying };
}

function object(value: unknown): Record<string, any> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid performance response');
  return value as Record<string, any>;
}

export function buildPositionPerformance(position: PositionLots, optionResponses: unknown[], stockResponse: unknown, range: HistoricalRange, now = new Date()) {
  const prepared = preparePositionPerformance(position, range, now);
  if (!Array.isArray(optionResponses) || optionResponses.length !== prepared.options.length) throw new Error('Incomplete performance response set');
  const marks = new Map(prepared.options.map((asset, index) => {
    const response = object(optionResponses[index]).response;
    if (!Array.isArray(response) || response.length > 1) throw new Error('Invalid option performance response');
    if (!response.length) return [asset.contractId, new Map<string, HistoricalMark>()] as const;
    const item = object(response[0]), contract = object(item.contract);
    if (contract.symbol !== prepared.symbol || contract.strike !== asset.strike || contract.expiration !== asset.expiry.slice(0, 10) || contract.right !== asset.type.toUpperCase()) throw new Error('Performance contract mismatch');
    return [asset.contractId, historicalMarks(item.data, range)] as const;
  }));
  const stock = historicalMarks(object(stockResponse).response, range);
  const rows = prepared.rows.map(({ date, cutoff, projection }) => {
    const lots = (projection?.lots ?? []).map(lot => {
      const expired = lot.asset.kind === 'option' && Date.parse(lot.asset.expiry) <= Date.parse(cutoff);
      const reported = (lot.asset.kind === 'stock' ? stock : marks.get(lot.asset.contractId))?.get(date) ?? null;
      const mark = expired ? null : reported;
      const unrealizedPnl = mark ? (mark.mid - lot.entryPrice) * lot.quantity * (lot.asset.kind === 'option' ? lot.asset.multiplier : 1) * (lot.side === 'long' ? 1 : -1) : null;
      if (unrealizedPnl !== null && !Number.isFinite(unrealizedPnl)) throw new Error('Performance exceeds numeric range');
      return { ...lot, mark, unrealizedPnl };
    });
    const unrealizedPnl = !projection || lots.some(lot => lot.unrealizedPnl === null) ? null : lots.reduce((sum, lot) => sum + lot.unrealizedPnl!, 0);
    const combinedPnl = unrealizedPnl === null ? null : projection!.grossRealizedPnl + unrealizedPnl - projection!.allowance;
    if (combinedPnl !== null && !Number.isFinite(combinedPnl)) throw new Error('Performance exceeds numeric range');
    return { date, cutoff, lots, grossRealizedPnl: projection?.grossRealizedPnl ?? null, allowance: projection?.allowance ?? null, unrealizedPnl, combinedPnl, changeUsd: null as number | null, status: projection?.status ?? 'not-started' as const };
  });
  rows.forEach((row, index) => {
    const previous = rows[index - 1];
    if (row.combinedPnl !== null && previous?.combinedPnl != null) {
      row.changeUsd = row.combinedPnl - previous.combinedPnl;
      if (!Number.isFinite(row.changeUsd)) throw new Error('Performance change exceeds numeric range');
    }
  });
  const observed = rows.filter(row => row.combinedPnl !== null);
  const extreme = (high: boolean) => { const row = observed.reduce<typeof rows[number] | undefined>((best, next) => !best || (high ? next.combinedPnl! > best.combinedPnl! : next.combinedPnl! < best.combinedPnl!) ? next : best, undefined); return row ? { date: row.date, value: row.combinedPnl! } : null; };
  return { range: { ...range }, rows, high: extreme(true), low: extreme(false), basis: 'Latest-revision restated recorded holdings at 17:15 America/New_York accounting cutoffs. Theta EOD midpoint estimates are unsynchronized and of unknown quote age; report and last-trade times are not quote timestamps. Marks may precede same-day executions; these are not market-close or post-execution valuations. Missing or expired-unsettled holdings remain unavailable. Allowance is deducted once. Daily USD changes require adjacent complete calendar observations; high/low are observed daily net P/L, not intraday extrema. No percentage/account returns, dividends, financing or settlement inferred. Maximum 31 dates and 64 held identities.' };
}

export type PositionPerformance = ReturnType<typeof buildPositionPerformance>;

export async function loadPositionPerformance(position: PositionLots, range: HistoricalRange, env: BrokerBindings, request: ReturnType<typeof createThetaRequest>, now = new Date()) {
  const prepared = preparePositionPerformance(position, range, now), common = { symbol: prepared.symbol, start_date: range.start.replaceAll('-', ''), end_date: range.end.replaceAll('-', ''), format: 'json' };
  const paths = prepared.options.map(asset => `/v3/option/history/eod?${new URLSearchParams({ ...common, expiration: asset.expiry.slice(0, 10).replaceAll('-', ''), strike: String(asset.strike), right: asset.type })}`);
  if (prepared.stock) paths.push(`/v3/stock/history/eod?${new URLSearchParams(common)}`);
  const responses: unknown[] = [];
  for (let index = 0; index < paths.length; index += 9) {
    const batch = paths.slice(index, index + 9), result = await request(env, batch);
    if (!Array.isArray(result) || result.length !== batch.length) throw new Error('Incomplete performance batch');
    responses.push(...result);
  }
  return buildPositionPerformance(position, responses.slice(0, prepared.options.length), prepared.stock ? responses.at(-1) : { response: [] }, range, now);
}

export function readPositionPerformance(raw: unknown, position: PositionLots, range: HistoricalRange, now = new Date()): PositionPerformance {
  const body = object(raw), prepared = preparePositionPerformance(position, range, now);
  if (!Array.isArray(body.rows) || body.rows.length !== prepared.rows.length) throw new Error('Incomplete performance dates');
  const data = (id: string) => body.rows.flatMap((value: unknown) => {
    const row = object(value);
    if (!Array.isArray(row.lots)) throw new Error('Invalid performance lots');
    const lot = row.lots.map(object).find(item => id === 'stock' ? item.asset?.kind === 'stock' : item.asset?.contractId === id);
    if (!lot?.mark) return [];
    const mark = object(lot.mark);
    return [{ bid: mark.bid, ask: mark.ask, created: mark.created, last_trade: mark.lastTrade }];
  });
  const options = prepared.options.map(asset => ({ response: [{ contract: { symbol: prepared.symbol, strike: asset.strike, expiration: asset.expiry.slice(0, 10), right: asset.type.toUpperCase() }, data: data(asset.contractId) }] }));
  const expected = buildPositionPerformance(position, options, { response: data('stock') }, range, now);
  if (JSON.stringify(body) !== JSON.stringify(expected)) throw new Error('Performance response mismatch');
  return expected;
}
