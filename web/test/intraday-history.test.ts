import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createStrategy } from '../src/options';
import { buildIntradayHistory, readIntradayHistory, buildIvHistory, readIvHistory, buildIvDiscussionFacts } from '../src/intraday-history';

const start = Date.parse('2026-09-04T13:30:00Z'), range = { start, end: start + 600_000 };
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-07T12:00:00Z')); });
afterEach(() => vi.useRealTimers());
function fixture() {
  const state = createStrategy('bull-call');
  state.pricing = { mode: 'market', snapshotId: 'synthetic', basis: 'mid' };
  state.legs.forEach((leg, i) => { leg.strike = 770 + i * 5; leg.expiry = '2026-10-09T20:00:00.000Z'; leg.contractId = `SPY   261009C00${leg.strike}000`; });
  const bar = (close: number) => ({ time: start, count: 1, open: close, high: close, low: close, close, volume: null });
  const raw = { underlying: { symbol: 'SPY', basis: 'last-trade', bars: [bar(770)] }, contracts: state.legs.map((leg, i) => ({ contractId: leg.contractId, basis: 'midpoint', bars: [bar(i ? 1.75 : 3.01)] })) };
  return { state, raw };
}
it('projects exact contract IV in fractional units with zero and unfilled gaps', () => {
  const { state } = fixture();
  const raw = { contracts: state.legs.map((leg, i) => ({ contractId: leg.contractId, basis: 'trade-candle', bars: [{ time: start, iv: i ? 0 : .25 }] })) };
  const before = structuredClone({ state, raw });
  expect(buildIvHistory(state, range, raw)).toEqual({ source: 'Tastytrade DXLink', intervalMs: 300000, basis: 'option-trade-candle-iv', rows: [
    { time: start, legs: state.legs.map((leg, i) => ({ contractId: leg.contractId, iv: i ? 0 : .25 })) },
    { time: range.end - 300000, legs: state.legs.map(leg => ({ contractId: leg.contractId, iv: null })) },
  ] });
  expect({ state, raw }).toEqual(before);
  for (const change of [
    (r: any) => { r.contracts[0].contractId = 'SPY'; }, (r: any) => { r.contracts[0].basis = 'midpoint'; },
    (r: any) => { r.contracts.pop(); }, (r: any) => { r.contracts[1] = r.contracts[0]; },
    (r: any) => { r.contracts[0].bars[0].iv = -1; }, (r: any) => { r.contracts[0].bars[0].iv = 'NaN'; },
    (r: any) => { r.contracts[0].bars[0].time++; }, (r: any) => { r.contracts[0].bars[0].time = range.end; },
    (r: any) => { r.contracts[0].bars.push(r.contracts[0].bars[0]); }, (r: any) => { r.underlying = {}; },
  ]) { const invalid = structuredClone(raw); change(invalid); expect(() => buildIvHistory(state, range, invalid)).toThrow(); }
});

it('binds IV responses to the exact request and rejects swapped, malformed or extra facts', () => {
  const { state } = fixture(), history = buildIvHistory(state, range);
  history.rows[0].legs[0].iv = 0; history.rows[0].legs[1].iv = .25;
  const response = { history, range, snapshotId: state.pricing!.snapshotId, positionVersion: state.version };
  expect(readIvHistory(response, state, range)).toEqual(history);
  for (const corrupt of [
    (r: any) => r.snapshotId = 'foreign', (r: any) => r.positionVersion++, (r: any) => r.range.end++,
    (r: any) => r.history.basis = 'option-midpoints', (r: any) => r.history.rows[0].time++,
    (r: any) => r.history.rows.pop(), (r: any) => r.history.rows[0].legs.reverse(),
    (r: any) => r.history.rows[0].legs[0].iv = -1, (r: any) => r.history.rows[0].legs[0].iv = '0',
    (r: any) => r.history.rows[0].value = 100,
  ]) { const invalid = structuredClone(response); corrupt(invalid); expect(() => readIvHistory(invalid, state, range)).toThrow(); }
});

it('computes timestamped IV facts without filling gaps, dividing by zero or using future values as previous', () => {
  const { state } = fixture(), bounds = { start, end: start + 5 * 300000 }, history = buildIvHistory(state, bounds);
  [0, null, .25, .25, .1].forEach((iv, i) => { history.rows[i].legs[0].iv = iv; history.rows[i].legs[1].iv = .99; });
  const before = structuredClone(history), id = state.legs[0].contractId;
  const facts = buildIvDiscussionFacts(state, bounds, history, id, start + 2 * 300000);
  expect(facts.contract.contractId).toBe(id); expect(facts.observations.map(row => row.iv)).toEqual([0, null, .25, .25, .1]);
  expect(facts.summary.scope).toBe('whole-requested-range');
  expect(facts.summary.requested).toBe(5); expect(facts.summary.reported).toBe(4); expect(facts.summary.missing).toBe(1);
  expect(facts.summary.minimum).toEqual({ time: new Date(start).toISOString(), iv: 0 });
  expect(facts.summary.maximum).toEqual({ time: new Date(start + 600000).toISOString(), iv: .25 });
  expect(facts.summary.changePercentagePoints).toBeCloseTo(10);
  expect(facts.previousReported).toEqual(facts.summary.minimum);
  expect(facts.selectedChangePercentagePoints).toBeCloseTo(25);
  const gap = buildIvDiscussionFacts(state, bounds, history, id, start + 300000);
  expect(gap.selected.iv).toBeNull(); expect(gap.selectedChangePercentagePoints).toBeNull(); expect(gap.previousReported?.iv).toBe(0);
  const first = buildIvDiscussionFacts(state, bounds, history, id, start);
  expect(first.previousReported).toBeNull(); expect(first.selectedChangePercentagePoints).toBeNull();
  expect(history).toEqual(before);
  expect(facts.timestampMeaning).toContain('bucket start');
});

it('keeps all-missing IV summaries empty and rejects foreign or malformed discussion selections', () => {
  const { state } = fixture(), history = buildIvHistory(state, range), id = state.legs[0].contractId;
  const facts = buildIvDiscussionFacts(state, range, history, id, start);
  expect(facts.summary).toEqual({ scope: 'whole-requested-range', requested: 2, reported: 0, missing: 2, first: null, last: null, minimum: null, maximum: null, changePercentagePoints: null });
  expect(facts.previousReported).toBeNull();
  for (const [contract, time] of [['foreign', start], [id, start + 1], [id, range.end]] as const) expect(() => buildIvDiscussionFacts(state, range, history, contract, time)).toThrow();
  history.rows[0].legs[1].iv = -1;
  expect(() => buildIvDiscussionFacts(state, range, history, id, start)).toThrow();
});

it('rejects overflowing IV change arithmetic instead of emitting infinite facts', () => {
  const { state } = fixture(), history = buildIvHistory(state, range);
  history.rows[0].legs[0].iv = 0; history.rows[1].legs[0].iv = Number.MAX_VALUE;
  expect(() => buildIvDiscussionFacts(state, range, history, state.legs[0].contractId, start)).toThrow();
});

it('projects fixed signed inventory into every bucket without subtracting entry costs or fees', () => {
  const { state, raw } = fixture(); state.legs[0].contracts = 2; state.feeAllowance = 999;
  const before = structuredClone({ state, raw }), result = buildIntradayHistory(state, range, raw);
  expect(result.source).toBe('Tastytrade DXLink'); expect(result.intervalMs).toBe(300000); expect(result.basis).toBe('option-midpoints');
  expect(result.rows).toHaveLength(2); expect(result.rows[0].value).toBeCloseTo(427); expect(result.rows[0].underlying).toBe(770);
  expect(result.rows[1]).toEqual({ time: start + 300_000, underlying: null, legs: state.legs.map(leg => ({ contractId: leg.contractId, close: null })), value: null });
  expect({ state, raw }).toEqual(before);
  result.rows[0].legs[0].close = 999;
  expect(buildIntradayHistory(state, range, raw).rows[0].legs[0].close).toBe(3.01);
  expect(buildIntradayHistory(state, range).rows.every(row => row.value === null)).toBe(true);
});
it('keeps missing-leg gaps, allows genuine zero and only requires underlying trade prices when shares are held', () => {
  const { state, raw } = fixture(); raw.underlying.bars = [];
  expect(buildIntradayHistory(state, range, raw).rows[0].value).toBeCloseTo(126);
  state.stock = { shares: -100, entryPrice: 123 };
  expect(buildIntradayHistory(state, range, raw).rows[0].value).toBeNull();
  raw.underlying.bars = [{ time: start, count: 0, open: 770, high: 770, low: 770, close: 770, volume: null }];
  const result = buildIntradayHistory(state, range, raw);
  expect(result.basis).toBe('option-midpoints-and-stock-trades'); expect(result.rows[0].value).toBeCloseTo(-76874);
  raw.contracts[0].bars = []; expect(buildIntradayHistory(state, range, raw).rows[0].value).toBeNull();
  delete state.stock;
  raw.contracts[0].bars = [{ time: start, count: 0, open: 0, high: 0, low: 0, close: 0, volume: null }];
  expect(buildIntradayHistory(state, range, raw).rows[0].value).toBe(-175);
});
it('rejects wrong sources, identities, malformed prices and noncanonical bucket sets', () => {
  const mutations: Array<(raw: any) => void> = [
    raw => { raw.underlying.symbol = 'QQQ'; }, raw => { raw.underlying.basis = 'midpoint'; }, raw => { raw.contracts[0].basis = 'last-trade'; },
    raw => { raw.contracts[0].contractId = 'wrong'; }, raw => { raw.contracts.pop(); }, raw => { raw.contracts.push(raw.contracts[0]); },
    raw => { raw.contracts[0].bars[0].close = 'NaN'; }, raw => { raw.contracts[0].bars[0].volume = 'NaN'; },
    raw => { raw.contracts[0].bars[0].high = 0; }, raw => { raw.contracts[0].bars[0].count = 1.5; },
    raw => { raw.contracts[0].bars[0].time++; }, raw => { raw.contracts[0].bars[0].time = range.end; },
    raw => { raw.contracts[0].bars.push(raw.contracts[0].bars[0]); },
    raw => { raw.contracts[0].bars = [{ ...raw.contracts[0].bars[0], time: start + 300_000 }, raw.contracts[0].bars[0]]; },
    raw => { raw.contracts[0].bars = Array(289).fill(raw.contracts[0].bars[0]); },
  ];
  for (const mutate of mutations) { const { state, raw } = fixture(); mutate(raw); expect(() => buildIntradayHistory(state, range, raw)).toThrow(); }
  const { state } = fixture(); for (const raw of [null, {}, [], 'wrong']) expect(() => buildIntradayHistory(state, range, raw)).toThrow();
});
it('preflights listed state and bounded completed range through first expiry', () => {
  const { state } = fixture();
  for (const input of [{ ...range, start: start + 1 }, { start, end: start }, { start: Date.parse('2026-08-31T00:00:00Z'), end: Date.parse('2026-09-07T00:05:00Z') }, { start: Date.now(), end: Date.now() + 300_000 }]) expect(() => buildIntradayHistory(state, input)).toThrow();
  expect(buildIntradayHistory(state, { start, end: start + 86_400_000 }).rows).toHaveLength(288);
  expect(() => buildIntradayHistory(createStrategy('bull-call'), range)).toThrow();
  state.legs[0].contracts = 1.5; expect(() => buildIntradayHistory(state, range)).toThrow(); state.legs[0].contracts = 1;
  vi.setSystemTime(new Date('2026-11-01T12:00:00Z'));
  const expiry = Date.parse(state.legs[0].expiry);
  expect(buildIntradayHistory(state, { start: expiry - 300_000, end: expiry }).rows).toHaveLength(1);
  expect(() => buildIntradayHistory(state, { start: expiry, end: expiry + 300_000 })).toThrow();
});

it('reads detached server history only for the exact workspace, range and computed signed inventory', () => {
  const { state, raw } = fixture(); state.stock = { shares: -100, entryPrice: 110 };
  const history = buildIntradayHistory(state, range, raw);
  const envelope = { history, snapshotId: state.pricing!.snapshotId, positionVersion: state.version, range: { ...range } };
  const result = readIntradayHistory(envelope, state, range);
  expect(result).toEqual(history); expect(result.rows[0].value).toBeCloseTo(-76874);
  result.rows[0].legs[0].close = 999;
  expect(envelope.history.rows[0].legs[0].close).toBe(3.01);
  const mutations: Array<(body: any) => void> = [
    body => { body.snapshotId = 'other'; }, body => { body.positionVersion++; }, body => { body.range.start += 300_000; },
    body => { body.history.source = 'invented'; }, body => { body.history.basis = 'option-midpoints'; }, body => { body.history.intervalMs = 60_000; },
    body => { body.history.rows.pop(); }, body => { body.history.rows.reverse(); }, body => { body.history.rows[0].time++; },
    body => { body.history.rows[0].legs.reverse(); }, body => { body.history.rows[0].legs[0].contractId = 'other'; },
    body => { body.history.rows[0].legs[0].close = '3.01'; }, body => { body.history.rows[0].legs[0].close = 1_000_001; },
    body => { body.history.rows[0].underlying = NaN; }, body => { body.history.rows[0].underlying = -1; },
    body => { body.history.rows[0].value = null; }, body => { body.history.rows[0].value = 0; }, body => { body.history.rows[0].value += .000001; },
    body => { body.history.rows[0].legs[0].close = null; }, body => { body.history.rows[0].underlying = null; },
    body => { body.history.rows[1].value = 0; }, body => { body.history.rows[1].value = Infinity; },
    body => { body.extra = true; }, body => { body.history.rows[0].extra = true; },
  ];
  for (const mutate of mutations) { const body = structuredClone(envelope); mutate(body); expect(() => readIntradayHistory(body, state, range)).toThrow(); }
  const rounded = structuredClone(envelope); rounded.history.rows[0].value! += 1e-9;
  expect(readIntradayHistory(rounded, state, range)).toEqual(history);
});

it('reads genuine zero values and permits absent underlying only for options-only inventory', () => {
  const { state, raw } = fixture(); raw.underlying.bars = [];
  raw.contracts[1].bars = structuredClone(raw.contracts[0].bars);
  const history = buildIntradayHistory(state, range, raw);
  expect(history.rows[0].value).toBe(0);
  const envelope = { history, snapshotId: state.pricing!.snapshotId, positionVersion: state.version, range };
  expect(readIntradayHistory(envelope, state, range).rows[0]).toEqual(history.rows[0]);
  history.rows[0].value = null;
  expect(() => readIntradayHistory(envelope, state, range)).toThrow();
});

it('round-trips a dense seven-day four-leg inventory and preserves interior gaps without forward filling', () => {
  const { state, raw } = fixture(), week = { start: Date.parse('2026-08-31T00:00:00Z'), end: Date.parse('2026-09-07T00:00:00Z') };
  state.legs = [...state.legs, ...state.legs.map((leg, i) => ({ ...leg, id: `extra-${i}`, strike: 780 + i * 5, contractId: `SPY   261009C00${780 + i * 5}000` }))];
  state.stock = { shares: -100, entryPrice: 123 }; state.feeAllowance = 99;
  const bars = (close: number) => Array.from({ length: 2016 }, (_, index) => ({ time: week.start + index * 300000, count: 1, open: close, high: close, low: close, close, volume: null }));
  raw.underlying.bars = bars(770);
  raw.contracts = state.legs.map((leg, index) => ({ contractId: leg.contractId, basis: 'midpoint', bars: bars(index % 2 ? 1.75 : 3.01) }));
  const history = buildIntradayHistory(state, week, raw);
  expect(history.rows).toHaveLength(2016); expect(history.rows.every(row => row.value !== null)).toBe(true);
  expect(history.rows[0].value).toBeCloseTo(-76748);
  const envelope = { history, range: week, snapshotId: state.pricing!.snapshotId, positionVersion: state.version };
  expect(readIntradayHistory(envelope, state, week)).toEqual(history);
  raw.contracts[2].bars.splice(1000, 1);
  const gapped = buildIntradayHistory(state, week, raw);
  expect(gapped.rows[1000].value).toBeNull(); expect(gapped.rows[1000].legs[2].close).toBeNull();
  expect(gapped.rows[1000].underlying).toBe(770); expect(gapped.rows[999].value).not.toBeNull(); expect(gapped.rows[1001].value).not.toBeNull();
  expect(readIntradayHistory({ ...envelope, history: gapped }, state, week)).toEqual(gapped);
  expect(buildIntradayHistory(state, week).rows.every(row => row.value === null)).toBe(true);
  raw.contracts[0].bars.push({ ...raw.contracts[0].bars[0], time: week.end });
  expect(() => buildIntradayHistory(state, week, raw)).toThrow();
});
