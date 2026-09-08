import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createCandleSnapshot } from '../src/candle-history';

const start = Date.parse('2026-09-04T13:30:00Z'), step = 300_000;
const range = { start, end: start + 3 * step };
const symbol = '.SPY261009C770{=5m,price=mark}', other = 'SPY{=5m}';
const event = (patch: Record<string, unknown> = {}) => ({ eventType: 'Candle', eventSymbol: symbol, eventFlags: 4, time: start, sequence: 0, count: 3, open: 2, high: 3, low: 1, close: 2.5, volume: 7, ...patch });
const bar = { time: start, count: 3, open: 2, high: 3, low: 1, close: 2.5, volume: 7 };
it('reads IV independently of prices with zero, missing values and snapshot corrections', () => {
  const snapshot = createCandleSnapshot([symbol], range, 'iv');
  const ivEvent = (patch: Record<string, unknown> = {}) => ({ eventType: 'Candle', eventSymbol: symbol, eventFlags: 12, time: start, sequence: 0, impVolatility: 0.25, ...patch });
  snapshot.push(ivEvent());
  expect(snapshot.read()).toEqual({ [symbol]: [{ time: start, iv: 0.25 }] });
  snapshot.push(ivEvent({ eventFlags: 0, impVolatility: 0 }));
  expect(snapshot.read()[symbol]).toEqual([{ time: start, iv: 0 }]);
  snapshot.push(ivEvent({ eventFlags: 0, impVolatility: 'NaN' }));
  expect(snapshot.read()[symbol]).toEqual([{ time: start, iv: null }]);
  snapshot.push(ivEvent({ eventFlags: 2, impVolatility: undefined }));
  expect(snapshot.read()[symbol]).toEqual([]);
  snapshot.push(ivEvent({ eventFlags: 4, time: start + step }));
  expect(() => snapshot.read()).toThrow();
  snapshot.push(ivEvent({ eventFlags: 9 }));
  expect(snapshot.complete()).toBe(false);
  snapshot.push(ivEvent({ eventFlags: 0 }));
  const result = snapshot.read();
  expect(result[symbol]).toEqual([{ time: start, iv: 0.25 }, { time: start + step, iv: 0.25 }]);
  result[symbol][0].iv = 99;
  expect(snapshot.read()[symbol][0].iv).toBe(0.25);
  snapshot.push(ivEvent({ eventFlags: 12, time: start + 2 * step }));
  expect(snapshot.read()[symbol]).toEqual([{ time: start + 2 * step, iv: 0.25 }]);
});

it('retains IV identity, range and all-symbol snapshot boundaries', () => {
  const snapshot = createCandleSnapshot([symbol, other], range, 'iv');
  const ivEvent = (patch: Record<string, unknown> = {}) => event({ impVolatility: 0.25, ...patch });
  snapshot.push(ivEvent({ eventFlags: 12, time: start - step }));
  expect(snapshot.complete()).toBe(false);
  snapshot.push(ivEvent({ eventSymbol: other, eventFlags: 28 }));
  expect(snapshot.complete()).toBe(false);
  snapshot.push(ivEvent({ eventSymbol: other, eventFlags: 12, time: range.end }));
  expect(snapshot.read()).toEqual({ [symbol]: [], [other]: [] });
  for (const patch of [{ eventSymbol: 'foreign' }, { time: start + 1 }, { time: Date.now() + step }, { sequence: 1 }, { eventFlags: 8 }]) {
    const invalid = createCandleSnapshot([symbol], range, 'iv');
    expect(() => invalid.push(ivEvent(patch))).toThrow();
    expect(() => invalid.read()).toThrow();
  }
});

it('fails closed on malformed IV instead of coercing missing or invalid data to zero', () => {
  for (const iv of [undefined, null, NaN, Infinity, -1, '0.25', 'private text']) {
    const snapshot = createCandleSnapshot([symbol], range, 'iv');
    expect(() => snapshot.push(event({ eventFlags: 12, impVolatility: iv }))).toThrow();
    expect(snapshot.complete()).toBe(false);
    expect(() => snapshot.read()).toThrow();
  }
});
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-07T12:00:00Z')); });
afterEach(() => vi.useRealTimers());

it('requires every symbol snapshot end and settled transaction before exposing sorted in-range bars', () => {
  const snapshot = createCandleSnapshot([symbol, other], range);
  expect(snapshot.complete()).toBe(false); expect(() => snapshot.read()).toThrow();
  snapshot.push(event({ time: range.end }));
  snapshot.push(event({ eventFlags: 0, time: start + step }));
  snapshot.push(event({ eventFlags: 9 }));
  snapshot.push(event({ eventSymbol: other, eventFlags: 12 }));
  expect(snapshot.complete()).toBe(false); expect(() => snapshot.read()).toThrow();
  snapshot.push(event({ eventFlags: 0, time: start - step }));
  expect(snapshot.complete()).toBe(true);
  expect(snapshot.read()).toEqual({ [symbol]: [bar, { ...bar, time: start + step }], [other]: [bar] });
});

it('keeps snipped snapshots incomplete until a fresh begin discards the prior snapshot', () => {
  const snapshot = createCandleSnapshot([symbol], range);
  snapshot.push(event()); snapshot.push(event({ eventFlags: 24, time: start + step }));
  expect(snapshot.complete()).toBe(false); expect(() => snapshot.read()).toThrow();
  snapshot.push(event({ eventFlags: 8 })); expect(snapshot.complete()).toBe(false);
  snapshot.push(event({ eventFlags: 4, time: start + 2 * step }));
  snapshot.push(event({ eventFlags: 8, time: start + 2 * step, close: 3 }));
  expect(snapshot.complete()).toBe(true);
  expect(snapshot.read()[symbol]).toEqual([{ ...bar, time: start + 2 * step, close: 3 }]);
});

it('replaces bucket corrections, removes deleted or unavailable bars and preserves missing volume as null', () => {
  const snapshot = createCandleSnapshot([symbol], range);
  snapshot.push(event()); snapshot.push(event({ eventFlags: 0, close: 3, volume: 'NaN' }));
  snapshot.push(event({ eventFlags: 8, time: start + step }));
  expect(snapshot.read()[symbol]).toEqual([{ ...bar, close: 3, volume: null }, { ...bar, time: start + step }]);
  snapshot.push(event({ eventFlags: 0, close: 'NaN' }));
  expect(snapshot.read()[symbol]).toEqual([{ ...bar, time: start + step }]);
  snapshot.push(event({ eventFlags: 2, time: start + step, count: 'NaN', open: 'NaN', high: 'NaN', low: 'NaN', close: 'NaN', volume: 'NaN' }));
  expect(snapshot.read()[symbol]).toEqual([]);
  snapshot.push(event({ eventFlags: 14, time: 0, count: 'NaN', open: 'NaN', high: 'NaN', low: 'NaN', close: 'NaN', volume: 'NaN' }));
  expect(snapshot.complete()).toBe(true); expect(snapshot.read()[symbol]).toEqual([]);
  for (const field of ['open', 'high', 'low', 'close']) {
    snapshot.push(event({ eventFlags: 0 }));
    snapshot.push(event({ eventFlags: 0, [field]: 'NaN' }));
    expect(snapshot.read()[symbol]).toEqual([]);
  }
  snapshot.push(event({ eventFlags: 2, time: start - 1, close: 'NaN' }));
  expect(snapshot.read()[symbol]).toEqual([]);
});

it('rejects malformed ranges and symbol inventories', () => {
  for (const bounds of [
    { start: NaN, end: range.end }, { start, end: Infinity }, { start: start + 1, end: range.end },
    { start, end: range.end + 1 }, { start, end: start }, { start: range.end, end: start },
    { start: Date.parse('2026-08-31T00:00:00Z'), end: Date.parse('2026-09-07T00:05:00Z') }, { start: Date.now(), end: Date.now() + step },
  ]) expect(() => createCandleSnapshot([symbol], bounds)).toThrow();
  for (const symbols of [[], [symbol, symbol], [''], ['x'.repeat(5000)], ['a', 'b', 'c', 'd', 'e', 'f']]) expect(() => createCandleSnapshot(symbols, range)).toThrow();
  expect(() => createCandleSnapshot([symbol], { start, end: start + 86_400_000 })).not.toThrow();
});

it('accepts seven completed calendar days of dense buckets while retaining snapshot and event bounds', () => {
  const week = { start: Date.parse('2026-08-31T00:00:00Z'), end: Date.parse('2026-09-07T00:00:00Z') };
  const snapshot = createCandleSnapshot([symbol, other], week);
  for (const selected of [symbol, other]) for (let i = 0; i < 2016; i++) snapshot.push(event({ eventSymbol: selected, time: week.start + i * step, eventFlags: i === 0 ? 4 : i === 2015 ? 9 : 0 }));
  expect(snapshot.complete()).toBe(false);
  for (const selected of [symbol, other]) snapshot.push(event({ eventSymbol: selected, time: week.end - step, eventFlags: 0 }));
  const result = snapshot.read();
  expect(result[symbol]).toHaveLength(2016); expect(result[other]).toHaveLength(2016);
  expect(result[symbol][0].time).toBe(week.start); expect(result[symbol].at(-1)!.time).toBe(week.end - step);
  expect(() => createCandleSnapshot([symbol], { ...week, end: week.end + step })).toThrow();
});

it('rejects malformed events, foreign symbols and ambiguous bucket coordinates', () => {
  const mutations = [
    { eventType: 'Quote' }, { eventSymbol: 'foreign' }, { eventFlags: -1 }, { eventFlags: 32 }, { eventFlags: 1.5 },
    { time: start + 1 }, { time: NaN }, { time: 0 }, { sequence: 1 }, { sequence: -1 },
    { close: 'private text' }, { close: null }, { close: NaN }, { open: -1 }, { high: 0 }, { low: 4 }, { close: 4 },
    { volume: 'unknown' }, { volume: -1 }, { count: -1 }, { count: '3' },
  ];
  for (const patch of mutations) {
    const snapshot = createCandleSnapshot([symbol], range);
    snapshot.push(event({ eventFlags: 12 }));
    expect(snapshot.complete()).toBe(true);
    expect(() => snapshot.push(event(patch))).toThrow();
    expect(snapshot.complete()).toBe(false); expect(() => snapshot.read()).toThrow();
  }
  for (const value of [null, [], {}, 'Candle']) expect(() => createCandleSnapshot([symbol], range).push(value)).toThrow();
});

it('captures constructor inputs and returns unaliased data with a total event bound', () => {
  const symbols = [symbol], bounds = { ...range }, snapshot = createCandleSnapshot(symbols, bounds), input = event({ eventFlags: 12 });
  symbols[0] = 'changed'; bounds.start += step;
  snapshot.push(input); input.close = 1;
  expect(snapshot.read()[symbol]).toEqual([bar]);
  for (let i = 1; i < 19_999; i++) snapshot.push(event({ eventFlags: 0 }));
  snapshot.push(event({ eventFlags: 8 }));
  const result = snapshot.read(); expect(result[symbol]).toEqual([bar]);
  result[symbol][0].close = 99; result[symbol].push({ ...bar, time: start + step });
  expect(snapshot.read()[symbol]).toEqual([bar]);
  expect(() => snapshot.push(event({ eventFlags: 0 }))).toThrow();
});
