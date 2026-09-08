import { createCandleSnapshot } from './candle-history';
import { validateStrategy, type StrategyState } from './options';

const record = (value: unknown, keys: string): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join() !== keys) throw new Error('Invalid intraday history response');
  return value as Record<string, unknown>;
};
function inventoryValue(state: StrategyState, closes: Array<number | null>, stock: number | null): number | null {
  if (closes.some(close => close === null) || state.stock && stock === null) return null;
  let value = closes.reduce<number>((total, close, i) => total + close! * state.legs[i].contracts * state.legs[i].multiplier * (state.legs[i].side === 'long' ? 1 : -1), 0);
  if (state.stock) value += stock! * state.stock.shares;
  if (!Number.isFinite(value)) throw new Error('Intraday inventory value exceeds numerical range');
  return value;
}

function validateHistoryRange(state: StrategyState, range: { start: number; end: number }) {
  if (validateStrategy(state).length || state.pricing?.mode !== 'market' || state.legs.some(leg => !Number.isSafeInteger(leg.contracts))) throw new Error('Intraday history requires a valid listed position');
  createCandleSnapshot([state.underlying], range);
  if (state.legs.some(leg => range.end > Date.parse(leg.expiry))) throw new Error('Intraday history cannot pass first expiry');
}

export function buildIvHistory(state: StrategyState, range: { start: number; end: number }, raw?: unknown) {
  validateHistoryRange(state, range);
  const contracts = new Map<string, Map<number, number | null>>();
  const length = (range.end - range.start) / 300_000;
  if (raw !== undefined) {
    const body = record(raw, 'contracts');
    if (!Array.isArray(body.contracts) || body.contracts.length !== state.legs.length) throw new Error('IV inventory mismatch');
    for (const input of body.contracts) {
      const item = record(input, 'bars,basis,contractId');
      if (typeof item.contractId !== 'string' || !state.legs.some(leg => leg.contractId === item.contractId) || contracts.has(item.contractId) || item.basis !== 'trade-candle'
        || !Array.isArray(item.bars) || item.bars.length > length) throw new Error('Invalid IV contract or source');
      const values = new Map<number, number | null>();
      let previous = -1;
      for (const inputBar of item.bars) {
        const bar = record(inputBar, 'iv,time'), time = bar.time as number, iv = bar.iv;
        if (!Number.isSafeInteger(time) || time < range.start || time >= range.end || time % 300_000 || time <= previous
          || iv !== null && (typeof iv !== 'number' || !Number.isFinite(iv * 100) || iv < 0)) throw new Error('Invalid IV observation');
        previous = time; values.set(time, iv as number | null);
      }
      contracts.set(item.contractId, values);
    }
  }
  const rows = Array.from({ length }, (_, index) => {
    const time = range.start + index * 300_000;
    return { time, legs: state.legs.map(leg => ({ contractId: leg.contractId, iv: contracts.get(leg.contractId)?.get(time) ?? null })) };
  });
  return { source: 'Tastytrade DXLink' as const, intervalMs: 300000 as const, basis: 'option-trade-candle-iv' as const, rows };
}

export function buildIntradayHistory(state: StrategyState, range: { start: number; end: number }, raw?: unknown) {
  validateHistoryRange(state, range);
  const readBars = (input: unknown) => {
    if (!Array.isArray(input) || input.length > (range.end - range.start) / 300_000) throw new Error('Invalid intraday bars');
    const result = new Map<number, number>();
    let previous = -1;
    for (const inputBar of input) {
      const bar = record(inputBar, 'close,count,high,low,open,time,volume');
      const { time, count, open, high, low, close, volume } = bar as Record<string, number>;
      if (!Number.isSafeInteger(time) || time < range.start || time >= range.end || time % 300_000 || time <= previous
        || !Number.isSafeInteger(count) || count < 0 || ![open, high, low, close].every(price => typeof price === 'number' && Number.isFinite(price) && price >= 0 && price <= 1_000_000)
        || high < low || open < low || open > high || close < low || close > high
        || volume !== null && (typeof volume !== 'number' || !Number.isFinite(volume) || volume < 0)) throw new Error('Invalid intraday candle');
      previous = time; result.set(time, close);
    }
    return result;
  };
  let underlying = new Map<number, number>();
  const contracts = new Map<string, Map<number, number>>();
  if (raw !== undefined) {
    const body = record(raw, 'contracts,underlying'), stock = record(body.underlying, 'bars,basis,symbol');
    if (stock.symbol !== state.underlying || stock.basis !== 'last-trade' || !Array.isArray(body.contracts) || body.contracts.length !== state.legs.length) throw new Error('Intraday inventory or source mismatch');
    underlying = readBars(stock.bars);
    for (const input of body.contracts) {
      const item = record(input, 'bars,basis,contractId');
      if (typeof item.contractId !== 'string' || !state.legs.some(leg => leg.contractId === item.contractId) || contracts.has(item.contractId) || item.basis !== 'midpoint') throw new Error('Intraday contract or source mismatch');
      contracts.set(item.contractId, readBars(item.bars));
    }
  }
  const rows = Array.from({ length: (range.end - range.start) / 300_000 }, (_, index) => {
    const time = range.start + index * 300_000, stock = underlying.get(time) ?? null;
    const legs = state.legs.map(leg => ({ contractId: leg.contractId, close: contracts.get(leg.contractId)?.get(time) ?? null }));
    return { time, underlying: stock, legs, value: inventoryValue(state, legs.map(leg => leg.close), stock) };
  });
  return { source: 'Tastytrade DXLink' as const, intervalMs: 300000 as const, basis: state.stock ? 'option-midpoints-and-stock-trades' as const : 'option-midpoints' as const, rows };
}

export function readIntradayHistory(raw: unknown, state: StrategyState, range: { start: number; end: number }): ReturnType<typeof buildIntradayHistory> {
  const result = buildIntradayHistory(state, range);
  const body = record(raw, 'history,positionVersion,range,snapshotId'), requested = record(body.range, 'end,start');
  const history = record(body.history, 'basis,intervalMs,rows,source');
  if (body.snapshotId !== state.pricing!.snapshotId || body.positionVersion !== state.version || requested.start !== range.start || requested.end !== range.end
    || history.source !== result.source || history.basis !== result.basis || history.intervalMs !== result.intervalMs || !Array.isArray(history.rows) || history.rows.length !== result.rows.length) throw new Error('Intraday history does not match this request');
  const price = (value: unknown): number | null => {
    if (value === null || typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1_000_000) return value;
    throw new Error('Invalid intraday history price');
  };
  result.rows = history.rows.map((input, index) => {
    const row = record(input, 'legs,time,underlying,value');
    if (row.time !== result.rows[index].time || !Array.isArray(row.legs) || row.legs.length !== state.legs.length) throw new Error('Intraday history bucket mismatch');
    const underlying = price(row.underlying), legs = row.legs.map((inputLeg, i) => {
      const leg = record(inputLeg, 'close,contractId');
      if (leg.contractId !== state.legs[i].contractId) throw new Error('Intraday history contract mismatch');
      return { contractId: state.legs[i].contractId, close: price(leg.close) };
    });
    const value = inventoryValue(state, legs.map(leg => leg.close), underlying);
    if (value === null ? row.value !== null : typeof row.value !== 'number' || !Number.isFinite(row.value) || Math.abs(row.value - value) > 1e-8) throw new Error('Intraday history inventory value mismatch');
    return { time: result.rows[index].time, underlying, legs, value };
  });
  return result;
}

export function readIvHistory(raw: unknown, state: StrategyState, range: { start: number; end: number }): ReturnType<typeof buildIvHistory> {
  const result = buildIvHistory(state, range);
  const body = record(raw, 'history,positionVersion,range,snapshotId'), requested = record(body.range, 'end,start');
  const history = record(body.history, 'basis,intervalMs,rows,source');
  if (body.snapshotId !== state.pricing!.snapshotId || body.positionVersion !== state.version || requested.start !== range.start || requested.end !== range.end
    || history.source !== result.source || history.basis !== result.basis || history.intervalMs !== result.intervalMs || !Array.isArray(history.rows) || history.rows.length !== result.rows.length) throw new Error('IV history does not match this request');
  result.rows = history.rows.map((input, index) => {
    const row = record(input, 'legs,time');
    if (row.time !== result.rows[index].time || !Array.isArray(row.legs) || row.legs.length !== state.legs.length) throw new Error('IV history bucket mismatch');
    const legs = row.legs.map((inputLeg, i) => {
      const leg = record(inputLeg, 'contractId,iv'), iv = leg.iv;
      if (leg.contractId !== state.legs[i].contractId || iv !== null && (typeof iv !== 'number' || !Number.isFinite(iv * 100) || iv < 0)) throw new Error('Invalid IV history observation');
      return { contractId: state.legs[i].contractId, iv: iv as number | null };
    });
    return { time: result.rows[index].time, legs };
  });
  return result;
}

export function buildIvDiscussionFacts(state: StrategyState, range: { start: number; end: number }, history: ReturnType<typeof buildIvHistory>, contractId: string, selectedTime: number) {
  const validated = readIvHistory({ history, range, snapshotId: state.pricing?.snapshotId, positionVersion: state.version }, state, range);
  const legIndex = state.legs.findIndex(leg => leg.contractId === contractId), index = validated.rows.findIndex(row => row.time === selectedTime);
  if (legIndex < 0 || index < 0) throw new Error('Invalid IV discussion selection');
  const leg = state.legs[legIndex];
  const observations = validated.rows.map(row => ({ time: new Date(row.time).toISOString(), iv: row.legs[legIndex].iv }));
  const reported = observations.filter((row): row is { time: string; iv: number } => row.iv !== null);
  const first = reported[0] ?? null, last = reported.at(-1) ?? null, selected = observations[index];
  const previousReported = observations.slice(0, index).reduce<typeof selected | null>((best, row) => row.iv !== null ? row : best, null);
  const minimum = reported.reduce<typeof reported[number] | null>((best, row) => !best || row.iv < best.iv ? row : best, null);
  const maximum = reported.reduce<typeof reported[number] | null>((best, row) => !best || row.iv > best.iv ? row : best, null);
  const change = (from: number | null | undefined, to: number | null | undefined) => from == null || to == null ? null : (to - from) * 100;
  return {
    snapshotId: state.pricing!.snapshotId, positionVersion: state.version,
    source: validated.source, basis: validated.basis, intervalMs: validated.intervalMs,
    range: { start: new Date(range.start).toISOString(), end: new Date(range.end).toISOString(), endExclusive: true },
    contract: { contractId, underlying: state.underlying, type: leg.type, strike: leg.strike, expiry: leg.expiry },
    ivUnits: 'fraction; 0.25 means 25%', changeUnits: 'percentage points; not relative percent',
    timestampMeaning: 'Candle bucket start in UTC; exact IV observation time and within-bucket aggregation are unspecified.',
    selected, previousReported, selectedChangePercentagePoints: change(previousReported?.iv, selected.iv),
    summary: { scope: 'whole-requested-range', requested: observations.length, reported: reported.length, missing: observations.length - reported.length,
      first, last, minimum, maximum, changePercentagePoints: change(first?.iv, last?.iv) },
    observations,
  };
}
