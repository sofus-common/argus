import { expect, it, vi } from "vitest";
import { createStrategy, validateStrategy } from "../src/options";
import { buildPriceHistory, readPriceHistory, historyPriceScale, loadPriceHistory } from "../src/price-history";

it('normalizes whole-position ratios with option and signed stock quantities without mutation', () => {
  const state = createStrategy('bull-call'); state.legs[0].contracts = 2; state.legs[1].contracts = 4;
  const before = structuredClone(state);
  expect(historyPriceScale(state)).toBe(200); expect(state).toEqual(before);
  for (const [shares, expected] of [[150, 200], [151, 100], [-150, 200], [-151, 100]]) {
    state.stock = { shares, entryPrice: 1 }; expect(historyPriceScale(state)).toBe(expected);
  }
  const covered = createStrategy('covered-call'); covered.legs[0].contracts = 2; covered.stock = { shares: 200, entryPrice: 1 };
  expect(historyPriceScale(covered)).toBe(200);
  state.stock = undefined; state.legs[0].contracts = 3; state.legs[1].contracts = 6;
  expect(historyPriceScale(state)).toBe(300);
});

it('declines malformed, nonstandard or unsafe history price normalization', () => {
  const invalid: Array<(state: any) => void> = [
    state => { state.legs = []; }, state => { state.legs = null; }, state => { state.legs[0] = null; },
    state => { state.legs[0].contracts = 0; }, state => { state.legs[0].contracts = -1; }, state => { state.legs[0].contracts = 1.5; },
    state => { state.legs[0].contracts = '2'; }, state => { state.legs[0].contracts = Infinity; }, state => { state.legs[0].contracts = NaN; },
    state => { state.legs[0].contracts = Number.MAX_SAFE_INTEGER + 1; }, state => { state.legs.forEach((leg: any) => { leg.contracts = Number.MAX_SAFE_INTEGER; }); },
    state => { state.legs[0].multiplier = 10; }, state => { state.legs[0].multiplier = '100'; },
    ...[0, 1.5, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1, '100'].map(shares => (state: any) => { state.stock = { shares, entryPrice: 1 }; }),
    state => { state.stock = null; },
  ];
  for (const mutate of invalid) { const state = createStrategy('bull-call'); mutate(state); expect(historyPriceScale(state)).toBeNull(); }
  expect(historyPriceScale(null as any)).toBeNull();
});

const now = new Date("2026-09-06T12:00:00Z");
const range = { start: "2026-09-04", end: "2026-09-05" };
function strategy() {
  const state = createStrategy("bull-call");
  state.valuationTimestamp = "2026-09-06T12:00:00Z";
  state.scenarioDate = state.valuationTimestamp;
  state.spot = state.scenarioSpot = 770.24;
  state.pricing = { mode: "market", snapshotId: "test", basis: "mid" };
  state.legs.forEach((leg, i) => {
    leg.strike = 770 + i * 5;
    leg.expiry = "2026-10-09T20:00:00Z";
    leg.contractId = `SPY   261009C00${leg.strike}000`;
  });
  return state;
}
function mark(bid: number, ask: number, date = "2026-09-04") {
  return { created: `${date}T17:15:00`, last_trade: `${date}T16:14:59`, bid, ask };
}
function responses() {
  return [770, 775].map((strike, i) => ({ response: [{ contract: { symbol: "SPY", expiration: "2026-10-09", strike, right: "CALL" }, data: [mark(i ? 8.88 : 11.64, i ? 8.92 : 11.68)] }] }));
}
const stock = () => ({ response: [mark(770.23, 770.25)] });

it('loads index option history without requesting or admitting stock-shaped index levels', async () => {
  const state = strategy(); state.underlying = 'XSP'; state.underlyingKind = 'cash-index'; state.valuationModel = 'european-bsm-v1';
  state.legs.forEach(leg => { leg.contractId = leg.contractId.replace('SPY', 'XSP'); });
  const raw = responses(); raw.forEach(item => { item.response[0].contract.symbol = 'XSP'; });
  const before = structuredClone(state);
  const request = vi.fn(async (_env, paths: string[]) => {
    expect(paths).toHaveLength(2);
    expect(paths.every(path => path.startsWith('/v3/option/history/eod?') && new URL(path, 'http://theta.internal').searchParams.get('symbol') === 'XSP')).toBe(true);
    return raw;
  });
  const history = await loadPriceHistory(state, range, {}, request);
  expect(request).toHaveBeenCalledOnce();
  expect(history.rows[0].value?.mid).toBeCloseTo(276);
  expect(history.rows[0].value?.bidSide).toBeCloseTo(272);
  expect(history.rows[0].value?.askSide).toBeCloseTo(280);
  expect(history.rows.every(row => row.underlying === null)).toBe(true);
  expect(history.rows[1].value).toBeNull();
  expect(state).toEqual(before);
  const body = { history, snapshotId: 'test', positionVersion: state.version, range, source: 'Theta EOD' };
  expect(readPriceHistory(body, state, range, now)).toEqual(history);
  expect(() => buildPriceHistory(state, raw, stock(), range, now)).toThrow();
  body.history.rows[0].underlying = { bid: 770.23, ask: 770.25, mid: 770.24, created: mark(0, 1).created, lastTrade: mark(0, 1).last_trade };
  expect(() => readPriceHistory(body, state, range, now)).toThrow();
});

it('retains the equity reference request and rejects incomplete index response sets', async () => {
  const request = vi.fn(async (_env, paths: string[]) => {
    expect(paths).toHaveLength(3); expect(paths[2]).toContain('/v3/stock/history/eod?');
    return [...responses(), stock()];
  });
  expect((await loadPriceHistory(strategy(), range, {}, request)).rows[0].underlying?.mid).toBe(770.24);
  const state = strategy(); state.underlying = 'XSP'; state.underlyingKind = 'cash-index'; state.valuationModel = 'european-bsm-v1';
  state.legs.forEach(leg => { leg.contractId = leg.contractId.replace('SPY', 'XSP'); });
  await expect(loadPriceHistory(state, range, {}, async () => [{ response: [] }])).rejects.toThrow();
});

it("validates returned history against captured position, dates and raw quote arithmetic", () => {
  const state = strategy();
  const body = { history: buildPriceHistory(state, responses(), stock(), range, now), snapshotId: 'test', positionVersion: state.version, range, source: 'Theta EOD' };
  expect(readPriceHistory(body, state, range, now)).toEqual(body.history);
  for (const mutate of [
    (value: typeof body) => { value.snapshotId = 'other'; },
    (value: typeof body) => { value.positionVersion++; },
    (value: typeof body) => { value.history.rows[0].value!.mid++; },
    (value: typeof body) => { value.history.rows[0].legs[0].contractId = 'other'; },
    (value: typeof body) => { value.history.rows[0].date = '2026-09-03'; },
    (value: typeof body) => { value.history.rows.pop(); },
  ]) {
    const altered = structuredClone(body); mutate(altered);
    expect(() => readPriceHistory(altered, state, range, now)).toThrow();
  }
});

it("rejects normalized invalid calendar dates in the shared strategy validator", () => {
  const state = strategy();
  state.valuationTimestamp = state.scenarioDate = "2026-02-01T12:00:00Z";
  state.legs.forEach(leg => {
    leg.expiry = "2026-02-30T20:00:00Z";
    leg.contractId = leg.contractId.replace("261009", "260230");
  });
  expect(validateStrategy(state).length).toBeGreaterThan(0);
  expect(() => buildPriceHistory(state, [{ response: [] }, { response: [] }], { response: [] }, { start: "2026-02-01", end: "2026-02-02" }, now)).toThrow();
  for (const field of ["valuationTimestamp", "scenarioDate"] as const) {
    const invalid = strategy(); invalid[field] = "2026-02-30T12:00:00Z";
    expect(validateStrategy(invalid).some(error => error.includes("valid timestamps"))).toBe(true);
  }
});

it("reconstructs signed historical value and bid/ask envelope, not entry-relative P/L", () => {
  const state = strategy();
  expect(validateStrategy(state)).toEqual([]);
  state.legs[0].entryPrice = 100;
  state.feeAllowance = 500;
  const before = structuredClone(state);
  const result = buildPriceHistory(state, responses(), stock(), range, now);
  expect(result.rows.map(row => row.date)).toEqual(["2026-09-04", "2026-09-05"]);
  expect(result.rows[0].value?.mid).toBeCloseTo(276);
  expect(result.rows[0].value?.bidSide).toBeCloseTo(272);
  expect(result.rows[0].value?.askSide).toBeCloseTo(280);
  expect(result.rows[0].underlying).toMatchObject({ bid: 770.23, ask: 770.25, mid: 770.24 });
  expect(result.rows[0].legs.map(leg => leg.contractId)).toEqual(state.legs.map(leg => leg.contractId));
  expect(result.rows[1]).toMatchObject({ underlying: null, value: null, legs: [{ mark: null }, { mark: null }] });
  expect(state).toEqual(before);
});

it("weights contract quantities and negative shares with reversed bid/ask sides", () => {
  const state = strategy();
  state.legs.forEach(leg => { leg.contracts = 2; });
  state.stock = { shares: -10, entryPrice: 1 };
  const row = buildPriceHistory(state, responses(), stock(), range, now).rows[0];
  expect(row.value?.mid).toBeCloseTo(552 - 7702.4);
  expect(row.value?.bidSide).toBeCloseTo(544 - 7702.5);
  expect(row.value?.askSide).toBeCloseTo(560 - 7702.3);
  expect(buildPriceHistory(state, responses(), { response: [] }, range, now).rows[0].value).toBeNull();
  delete state.stock;
  expect(buildPriceHistory(state, responses(), { response: [] }, range, now).rows[0].value?.mid).toBeCloseTo(552);
});

it("keeps missing legs as gaps, never forward fills or drops incomplete dates", () => {
  for (const empty of [{ response: [] }, { response: [{ ...responses()[1].response[0], data: [] }] }]) {
    const row = buildPriceHistory(strategy(), [responses()[0], empty], stock(), range, now).rows[0];
    expect(row.legs[0].mark).not.toBeNull();
    expect(row.legs[1].mark).toBeNull();
    expect(row.value).toBeNull();
  }
});

it("accepts different report times and older last trades without discarding provenance", () => {
  const raw = responses();
  raw[1].response[0].data[0].created = "2026-09-04T17:14:00";
  raw[1].response[0].data[0].last_trade = "2026-09-03T15:00:00";
  const row = buildPriceHistory(strategy(), raw, stock(), range, now).rows[0];
  expect(row.value?.mid).toBeCloseTo(276);
  expect(row.legs[1].mark?.lastTrade).toBe("2026-09-03T15:00:00");
});

it("rejects untrusted identity and malformed or duplicate report dates", () => {
  const mutations = [
    (raw: ReturnType<typeof responses>) => { raw[0].response[0].contract.symbol = "QQQ"; },
    (raw: ReturnType<typeof responses>) => { raw[0].response[0].contract.strike = 771; },
    (raw: ReturnType<typeof responses>) => { raw[0].response[0].contract.right = "PUT"; },
    (raw: ReturnType<typeof responses>) => { raw[0].response[0].contract.expiration = "2026-10-10"; },
    (raw: ReturnType<typeof responses>) => { raw[0].response.push(structuredClone(raw[0].response[0])); },
    (raw: ReturnType<typeof responses>) => { raw[0].response[0].data.push(structuredClone(raw[0].response[0].data[0])); },
    (raw: ReturnType<typeof responses>) => { raw[0].response[0].data[0].created = "2026-09-03T17:15:00"; },
    (raw: ReturnType<typeof responses>) => { raw[0].response[0].data[0].created = "2026-09-06T17:15:00"; },
    (raw: ReturnType<typeof responses>) => { raw[0].response[0].data[0].created = "2026-09-04T25:00:00"; },
    (raw: ReturnType<typeof responses>) => { raw[0].response[0].data[0].last_trade = "2026-09-04T18:00:00"; },
    (raw: ReturnType<typeof responses>) => { raw[0].response[0].data[0].bid = NaN; },
    (raw: ReturnType<typeof responses>) => { raw[0].response[0].data[0].ask = Infinity; },
    (raw: ReturnType<typeof responses>) => { raw[0].response[0].data[0].bid = -1; },
    (raw: ReturnType<typeof responses>) => { raw[0].response[0].data[0].ask = 1; },
  ];
  for (const mutate of mutations) {
    const raw = responses(); mutate(raw);
    expect(() => buildPriceHistory(strategy(), raw, stock(), range, now)).toThrow();
  }
  for (const raw of [[], [responses()[0]], [...responses(), responses()[0]], [null, responses()[1]]]) {
    expect(() => buildPriceHistory(strategy(), raw, stock(), range, now)).toThrow();
  }
  const duplicateStock = stock(); duplicateStock.response.push(mark(770.23, 770.25));
  expect(() => buildPriceHistory(strategy(), responses(), duplicateStock, range, now)).toThrow();
});

it("bounds ranges to 31 complete New York calendar days and no post-expiry valuation", () => {
  const empty = [{ response: [] }, { response: [] }];
  for (const invalid of [
    { start: "2026-08-01", end: "2026-09-01" },
    { start: "2026-09-05", end: "2026-09-04" },
    { start: "2026-09-04", end: "2026-09-06" },
    { start: "2026-02-30", end: "2026-03-01" },
    { start: "2026-9-04", end: "2026-09-05" },
  ]) expect(() => buildPriceHistory(strategy(), empty, { response: [] }, invalid, now)).toThrow();
  expect(buildPriceHistory(strategy(), empty, { response: [] }, { start: "2026-08-06", end: "2026-09-05" }, now).rows).toHaveLength(31);
  expect(() => buildPriceHistory(strategy(), empty, { response: [] }, range, new Date("2026-09-06T02:00:00Z"))).toThrow();
  expect(() => buildPriceHistory(strategy(), empty, { response: [] }, { start: "2026-10-09", end: "2026-10-10" }, new Date("2026-10-12T12:00:00Z"))).toThrow();
});

it("rejects sample identities, unsafe quantities, and corrupted canonical contracts", () => {
  const state = strategy(); delete state.pricing;
  expect(() => buildPriceHistory(state, responses(), stock(), range, now)).toThrow();
  const wrongId = strategy(); wrongId.legs[0].contractId = wrongId.legs[1].contractId;
  expect(() => buildPriceHistory(wrongId, responses(), stock(), range, now)).toThrow();
  const unsafe = strategy(); unsafe.legs[0].contracts = Number.MAX_SAFE_INTEGER + 1;
  expect(() => buildPriceHistory(unsafe, responses(), stock(), range, now)).toThrow();
});
