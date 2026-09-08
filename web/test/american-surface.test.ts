import { afterEach, expect, it, vi } from "vitest";
import { americanScenario, americanSurface } from "../src/american-surface";
import { americanGreeks, americanPrice } from "../src/american-price";
import { createStrategy, type ChartRange } from "../src/options";
import { requestAmericanSurface } from "../src/american-surface-client";

afterEach(() => vi.unstubAllGlobals());

it("routes the explicit range through the American worker handler", async () => {
  const scope = { onmessage: null as ((event: { data: unknown }) => void) | null, postMessage: vi.fn() };
  vi.stubGlobal("self", scope);
  await import("../src/american-surface.worker");
  const state = createStrategy("long-call"), range = { min: 98.137, max: 101.913 };
  scope.onmessage!({ data: { state, range } });
  const result = scope.postMessage.mock.calls[0][0].result;
  expect(result.points[0].spot).toBe(range.min);
  expect(result.points[43].spot).toBe(range.max);
  scope.onmessage!({ data: { state, range: { min: 0, max: 100 } } });
  expect(scope.postMessage).toHaveBeenLastCalledWith({ error: "American surface unavailable for these inputs." });
}, 30000);

it("binds American worker output to transported range and coordinates with cancellation", async () => {
  class FakeWorker {
    static latest: FakeWorker;
    onmessage: ((event: { data: unknown }) => void) | null = null;
    onerror: (() => void) | null = null;
    sent!: { state: ReturnType<typeof createStrategy>; range?: ChartRange };
    terminate = vi.fn();
    constructor() { FakeWorker.latest = this; }
    postMessage(data: typeof this.sent) { this.sent = structuredClone(data); }
  }
  vi.stubGlobal("Worker", FakeWorker);
  const source = createStrategy("long-call"), supplied = { min: 98.137, max: 101.913 }, surface = americanSurface(source, supplied);
  for (const kind of ["valid", "spot", "date", "version", "abort", "error"] as const) {
    const state = structuredClone(source), range = { ...supplied }, controller = new AbortController();
    const pending = requestAmericanSurface(state, controller.signal, range), worker = FakeWorker.latest, result = structuredClone(surface);
    expect(worker.sent).toEqual({ state, range });
    range.min = 90; state.version++;
    if (kind === "abort") controller.abort();
    else if (kind === "error") worker.onerror!();
    else {
      if (kind === "spot") result.points[0].spot = 90;
      if (kind === "date") result.points[44].date = result.points[0].date;
      if (kind === "version") result.baseVersion++;
      worker.onmessage!({ data: { result } });
    }
    if (kind === "valid") await expect(pending).resolves.toEqual(surface);
    else await expect(pending).rejects.toThrow();
    expect(worker.terminate).toHaveBeenCalledOnce();
  }
  const last = FakeWorker.latest;
  await expect(requestAmericanSurface(source, new AbortController().signal, { min: 10, max: 1 })).rejects.toThrow(/range/i);
  expect(FakeWorker.latest).toBe(last);
}, 30000);

it("uses explicit American surface bounds without mutating the position", () => {
  const state = createStrategy("long-put"), range = { min: 98.137, max: 101.913 }, before = structuredClone({ state, range });
  const result = americanSurface(state, range);
  expect(result.points[0].spot).toBe(range.min);
  expect(result.points[43].spot).toBe(range.max);
  expect(result.points.every(point => point.spot >= range.min && point.spot <= range.max)).toBe(true);
  expect({ state, range }).toEqual(before);
  for (const invalid of [{ min: 0, max: 100 }, { min: 100, max: 10 }, { min: 10, max: 100, extra: true }]) expect(() => americanSurface(state, invalid)).toThrow(/range/i);
}, 30000);

it("applies separate expiry shifts to American diagnostic prices and surfaces", () => {
  const state = createStrategy("call-calendar");
  state.expiryIvShifts = state.legs.map((leg, index) => ({ expiry: leg.expiry, ivShift: index ? -.03 : .05 }));
  const materialized = { ...state, expiryIvShifts: [], legs: state.legs.map((leg, index) => ({ ...leg, iv: leg.iv + state.expiryIvShifts![index].ivShift })) };
  expect(americanScenario(state)).toEqual(americanScenario(materialized));
  expect(americanSurface(state)).toEqual(americanSurface(materialized));
}, 30000);

it("computes seven finite American checkpoints for a four-leg position", () => {
  const state = createStrategy("iron-condor");
  const started = performance.now();
  const points = [0.9, 0.95, 0.999, 1, 1.001, 1.05, 1.1].map(factor => americanScenario({ ...state, scenarioSpot: state.scenarioSpot * factor }));
  const elapsedMs = performance.now() - started;
  expect(points).toHaveLength(7);
  expect(points.every(point => Object.values(point).every(Number.isFinite))).toBe(true);
  console.info(`American 1024-step four-leg seven-checkpoint calculation: ${elapsedMs.toFixed(1)} ms (observation, not a timing gate)`);
}, 30000);

it("aggregates American scenario option Greeks with signed contracts, stock and one flat allowance", () => {
  const state = createStrategy("call-calendar");
  state.legs[0].contracts = 3;
  state.legs[1].contracts = 2;
  state.legs[0].entryPrice = 1.23;
  state.legs[1].entryPrice = 3.56;
  state.stock = { shares: -150, entryPrice: 95 };
  state.feeAllowance = 12.5;
  state.ivShift = 0.03;
  state.scenarioSpot = 102;
  state.scenarioDate = "2026-09-07T20:00:00.000Z";
  const before = structuredClone(state), result = americanScenario(state);
  const expected = { pnl: -150 * (102 - 95) - 12.5, delta: -150, gamma: 0, theta: 0, vega: 0, rho: 0 };
  for (const leg of state.legs) {
    const years = (Date.parse(leg.expiry) - Date.parse(state.scenarioDate)) / (365 * 86400000);
    const priced = americanGreeks(leg.type, state.scenarioSpot, leg.strike, years, state.rate, state.dividendYield, leg.iv + state.ivShift, 1024);
    const scale = (leg.side === "long" ? 1 : -1) * leg.contracts * 100;
    expected.pnl += (priced.price - leg.entryPrice) * scale;
    for (const field of ["delta", "gamma", "theta", "vega", "rho"] as const) expected[field] += priced[field] * scale;
  }
  expect(result).toEqual(expected);
  const doubled = americanScenario({ ...state, legs: state.legs.map(leg => ({ ...leg, contracts: leg.contracts * 2 })), stock: { ...state.stock, shares: -300 }, feeAllowance: 25 });
  const changedCosts = americanScenario({ ...state, stock: { ...state.stock, entryPrice: 96 }, feeAllowance: 20 });
  for (const field of ["pnl", "delta", "gamma", "theta", "vega", "rho"] as const) expect(doubled[field]).toBeCloseTo(result[field] * 2, 7);
  expect(changedCosts.pnl - result.pnl).toBeCloseTo(150 - 7.5, 7);
  for (const field of ["delta", "gamma", "theta", "vega", "rho"] as const) expect(changedCosts[field]).toBe(result[field]);
  expect(state).toEqual(before);
}, 30000);

it("builds the actual heatmap grid with stock, held entry and allowance counted once", () => {
  const state = createStrategy("covered-call");
  state.stock = { shares: -150, entryPrice: 95 };
  state.feeAllowance = 12.5;
  state.legs[0].entryPrice = 1.23;
  const before = structuredClone(state), result = americanSurface(state);
  expect(state).toEqual(before);
  expect(result.sourceModel).toBe("european-bsm-v1");
  expect(result.points).toHaveLength(792);
  expect(result.points[0].date).toBe(state.valuationTimestamp);
  expect(result.points.at(-1)!.date).toBe(state.legs[0].expiry);
  for (const point of [result.points[0], result.points[391], result.points[791]]) {
    const leg = state.legs[0], years = (Date.parse(leg.expiry) - Date.parse(point.date)) / (365 * 86400000);
    const optionValue = americanPrice(leg.type, point.spot, leg.strike, years, state.rate, state.dividendYield, leg.iv, 1024);
    const expected = -150 * (point.spot - 95) - (optionValue - 1.23) * 100 - 12.5;
    expect(point.pnl).toBeCloseTo(expected, 7);
  }
}, 30000);

it("rejects invalid source state before calculating", () => {
  const state = createStrategy("long-put");
  state.legs = [];
  expect(() => americanSurface(state)).toThrow("one to eight legs");
});
