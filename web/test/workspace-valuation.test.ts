import { afterEach, expect, it, vi } from "vitest";
import { calculateStrategy, createStrategy, evaluateScenario, firstExpiryRange, firstExpiryBreakevens, payoffSeries, scenarioSeries, scenarioCurve, scenarioHeatmap, scenarioFacts, scenarioTable, scenarioSpotAttribution, isChartRange, type ChartRange, TEMPLATES } from "../src/options";
import { calculateWorkspaceValuation } from "../src/workspace-valuation";
import { assertRemainingLotInventory, calculateLotScenarioComparison } from "../src/lot-scenarios";
import { requestWorkspaceValuation, requestLotScenarioComparison, requestFirstExpiryRange, requestFirstExpiryBreakevens, type LotScenarioSide } from "../src/workspace-valuation-client";
import { createPosition } from "../src/position-lifecycle";
import { projectPositionLots, upgradePositionLots, recordLotTransaction, recordLotOpeningPriceCorrection } from "../src/position-lots";

afterEach(() => vi.unstubAllGlobals());

it("admits stock-only worker views but rejects fabricated option horizons", async () => {
  class FakeWorker {
    static latest: FakeWorker;
    onmessage: ((event: { data: unknown }) => void) | null = null;
    onerror = null; onmessageerror = null;
    sent!: { id: number };
    terminate = vi.fn();
    constructor() { FakeWorker.latest = this; }
    postMessage(data: typeof this.sent) { this.sent = data; }
  }
  vi.stubGlobal("Worker", FakeWorker);
  const curve = { kind: "curve", min: 90, max: 110, metric: "pnl" } as const;
  for (const shares of [50, -50]) for (const view of [undefined, "table", curve] as const) {
    for (const corruption of ["none", "mode", "expiry"] as const) {
      if (corruption === "expiry" && view !== curve) continue;
      const state = { ...createStrategy("long-call"), legs: [], stock: { shares, entryPrice: 98 }, scenarioSpot: 102 };
      const pending = requestWorkspaceValuation(state, new AbortController().signal, view);
      const worker = FakeWorker.latest, result = calculateWorkspaceValuation(state, view);
      if (corruption === "mode") result.metrics.mode = "expiration";
      if (corruption === "expiry") result.curve!.expiration = structuredClone(result.curve!.points);
      worker.onmessage!({ data: { id: worker.sent.id, result } });
      if (corruption === "none") await expect(pending).resolves.toEqual(result);
      else await expect(pending).rejects.toThrow("Invalid workspace valuation result");
      expect(worker.terminate).toHaveBeenCalledOnce();
    }
  }
});

it("values stock-only holdings without inventing an option expiry", async () => {
  const { validateStrategy, expirationProbability, expirationDistribution, pnlDisplayBasis } = await import('../src/options');
  const { americanSurface, americanScenario } = await import('../src/american-surface');
  for (const shares of [50, -50]) {
    const state = { ...createStrategy('long-call'), legs: [], stock: { shares, entryPrice: 98 }, scenarioSpot: 102, feeAllowance: 7 };
    expect(validateStrategy(state)).toEqual([]);
    expect(evaluateScenario(state)).toEqual({ pnl: shares * 4 - 7, delta: shares, gamma: 0, theta: 0, vega: 0, rho: 0 });
    expect(americanScenario(state)).toEqual(evaluateScenario(state));
    const metrics = calculateStrategy(state);
    expect(metrics.mode).toBe('spot');
    expect(metrics.maxProfit).toBe(shares > 0 ? null : 4893);
    expect(metrics.maxLoss).toBe(shares > 0 ? 4907 : null);
    expect(metrics.breakevens).toEqual([shares > 0 ? 98.14 : 97.86]);
    expect(calculateStrategy({ ...state, feeAllowance: 0 }).breakevens).toEqual([98]);
    expect(pnlDisplayBasis(state, 'risk-percent')?.denominator ?? null).toBe(shares > 0 ? 4907 : null);
    expect(metrics.sampledRange.date).toBe(state.scenarioDate);
    const worker = calculateWorkspaceValuation(state, { kind: 'curve', min: 90, max: 110, metric: 'pnl' });
    expect(worker.curve!.expiration).toEqual([]);
    expect(worker.curve!.points[0].value).toBe(shares * (90 - 98) - 7);
    expect(worker.legs).toEqual([]);
    expect(expirationProbability(state)).toMatchObject({ probability: null, expiry: null, volatility: null, priceRange: null });
    expect(expirationProbability(state).reason).toMatch(/stock-only/i);
    expect(expirationDistribution(state)).toMatchObject({ points: [], pointMass: null, omittedMass: null });
    expect(expirationDistribution(state).reason).toMatch(/stock-only/i);
    expect(evaluateScenario({ ...state, scenarioDate: '2027-01-01T20:00:00.000Z' })).toEqual(evaluateScenario(state));
    expect(() => scenarioHeatmap(state)).toThrow(/stock-only/i);
    expect(() => americanSurface(state)).toThrow(/stock-only/i);
    expect(validateStrategy({ ...state, stock: undefined }).length).toBeGreaterThan(0);
    expect(validateStrategy({ ...state, stock: { shares: 0, entryPrice: 98 } }).length).toBeGreaterThan(0);
    expect(validateStrategy({ ...state, stock: { shares: 1.5, entryPrice: 98 } }).length).toBeGreaterThan(0);
  }
});

it("routes the explicit range through the workspace worker handler", async () => {
  const scope = { onmessage: null as ((event: { data: unknown }) => void) | null, postMessage: vi.fn() };
  vi.stubGlobal("self", scope);
  await import("../src/workspace-valuation.worker");
  const state = createStrategy("long-call"), range = { min: 98.137, max: 101.913 };
  scope.onmessage!({ data: { id: 17, state, view: "table", range } });
  expect(scope.postMessage).toHaveBeenLastCalledWith({ id: 17, result: calculateWorkspaceValuation(state, "table", range) });
  scope.onmessage!({ data: { id: 18, state, view: "table", range: { min: 0, max: 100 } } });
  expect(scope.postMessage).toHaveBeenLastCalledWith({ id: 18, error: "Workspace valuation unavailable for these inputs." });
});

it("samples explicit chart ranges consistently without changing the position", () => {
  const state = createStrategy("iron-condor"), range = { min: 98.137, max: 101.913 }, before = structuredClone({ state, range });
  const table = calculateWorkspaceValuation(state, "table", range).table!;
  expect(table.rows[0].spot).toBe(range.min);
  expect(table.rows.at(-1)!.spot).toBe(range.max);
  expect(table.rows.every(row => row.spot >= range.min && row.spot <= range.max)).toBe(true);
  expect(table.rows.map(row => row.spot)).toContain(state.spot);
  expect(table.rows.map(row => row.spot)).not.toContain(state.legs[0].strike);
  expect(table.attribution.rows.map(row => row.spot)).toEqual(table.rows.map(row => row.spot));
  const heatmap = calculateWorkspaceValuation(state, "heatmap", range).heatmap!;
  expect(heatmap).toHaveLength(792);
  expect(heatmap[0].spot).toBe(range.min);
  expect(heatmap[43].spot).toBe(range.max);
  expect(heatmap.every(point => point.spot >= range.min && point.spot <= range.max)).toBe(true);
  for (const point of [heatmap[0], heatmap[391], heatmap[791]]) expect(point.pnl).toBe(evaluateScenario({ ...state, scenarioSpot: point.spot, scenarioDate: point.date }).pnl);
  expect({ state, range }).toEqual(before);
});

it("rejects invalid explicit chart ranges before calculation", () => {
  const state = createStrategy("long-call");
  expect(isChartRange({ min: .0001, max: 1_000_000 })).toBe(true);
  for (const range of [null, {}, { min: 0, max: 100 }, { min: 101, max: 100 }, { min: 100, max: 100 }, { min: NaN, max: 100 }, { min: 10, max: Infinity }, { min: 10, max: 1000001 }, { min: 10, max: 100, extra: 1 }]) {
    expect(isChartRange(range)).toBe(false);
    for (const sample of [scenarioTable, scenarioSpotAttribution, scenarioHeatmap]) expect(() => sample(state, range as never)).toThrow(/range/i);
    expect(() => calculateWorkspaceValuation(state, undefined, range as never)).toThrow(/range/i);
  }
});

it("transports explicit ranges and rejects worker grids from another range", async () => {
  class FakeWorker {
    static latest: FakeWorker;
    onmessage: ((event: { data: unknown }) => void) | null = null;
    onerror = null;
    onmessageerror = null;
    sent!: { id: number; state: ReturnType<typeof createStrategy>; view?: "table" | "heatmap"; range?: ChartRange };
    terminate = vi.fn();
    constructor() { FakeWorker.latest = this; }
    postMessage(data: typeof this.sent) { this.sent = structuredClone(data); }
  }
  vi.stubGlobal("Worker", FakeWorker);
  for (const view of ["table", "heatmap"] as const) for (const kind of ["valid", "wrong-range", "missing-row", "shifted-row"] as const) {
    const state = createStrategy("collar"), range = { min: 98.137, max: 101.913 };
    const pending = requestWorkspaceValuation(state, new AbortController().signal, view, range), worker = FakeWorker.latest;
    expect(worker.sent.range).toEqual(range);
    const result = calculateWorkspaceValuation(state, view, kind === "wrong-range" ? undefined : range), expected = structuredClone(result);
    if (kind === "missing-row") { result.table?.rows.pop(); result.table?.attribution.rows.pop(); result.heatmap?.pop(); }
    if (kind === "shifted-row") {
      if (result.table) { result.table.rows[1].spot += .001; result.table.attribution.rows[1].spot += .001; }
      if (result.heatmap) result.heatmap[1].spot += .001;
    }
    range.min = 90; state.scenarioSpot = 111;
    worker.onmessage!({ data: { id: worker.sent.id, result } });
    if (kind === "valid") await expect(pending).resolves.toEqual(expected);
    else await expect(pending).rejects.toThrow("Invalid workspace valuation result");
    expect(worker.terminate).toHaveBeenCalledOnce();
  }
  const last = FakeWorker.latest;
  await expect(requestWorkspaceValuation(createStrategy("long-call"), new AbortController().signal, "table", { min: 0, max: 100 })).rejects.toThrow(/range/i);
  expect(FakeWorker.latest).toBe(last);
});

it("binds breakeven worker intervals, zero samples and status with cancellation cleanup", async () => {
  class FakeWorker {
    static latest: FakeWorker;
    onmessage: ((event: { data: unknown }) => void) | null = null;
    onerror: (() => void) | null = null; onmessageerror: (() => void) | null = null;
    sent!: { action: string; id: number; state: ReturnType<typeof createStrategy>; min: number; max: number };
    terminate = vi.fn();
    constructor() { FakeWorker.latest = this; }
    postMessage(data: typeof this.sent) { this.sent = structuredClone(data); }
  }
  vi.stubGlobal("Worker", FakeWorker);
  for (const kind of ["valid", "budget", "empty", "zero", "id", "version", "model", "date", "domain", "nonfinite", "reversed", "overlap", "kind", "wrong-sign", "zero-duplicate", "zero-outside", "zero-interior", "zero-missing", "zero-conflict", "count", "tolerance", "evaluations", "status", "false-budget", "early-budget", "basis", "abort", "error", "message-error", "unavailable"] as const) {
    const state = createStrategy("call-calendar"), controller = new AbortController();
    const pending = requestFirstExpiryBreakevens(state, 50, 150, controller.signal), worker = FakeWorker.latest;
    expect(worker.sent).toMatchObject({ action: "first-expiry-breakevens", min: 50, max: 150 });
    const breakevens = { date: new Date(Math.min(...state.legs.map(leg => Date.parse(leg.expiry)))).toISOString(), spotMin: 50, spotMax: 150, spotTolerance: .01, evaluations: 4, status: "spot-tolerance-met", evaluatedZeros: [] as number[], candidates: [{ lower: 90, upper: 90.005, lowerPnl: -1, upperPnl: 1, kind: "sign-changing" }], basis: "Conditional model intervals" };
    const result = { baseVersion: state.version, model: state.valuationModel ?? "european-bsm-v1", breakevens }, candidate = breakevens.candidates[0];
    if (kind === "budget") { breakevens.status = "budget-exhausted"; breakevens.evaluations = 256; candidate.upper = 100; }
    if (kind === "empty") breakevens.candidates = [];
    if (kind === "zero") { breakevens.evaluatedZeros = [90]; candidate.lowerPnl = 0; candidate.kind = "unresolved"; }
    const expected = structuredClone(result), handler = worker.onmessage!;
    state.version++;
    if (kind === "version") result.baseVersion++;
    if (kind === "model") result.model = "american-crr-1024-v1";
    if (kind === "date") breakevens.date = "2000-01-01T00:00:00.000Z";
    if (kind === "domain") breakevens.spotMax++;
    if (kind === "nonfinite") candidate.upperPnl = Infinity;
    if (kind === "reversed") candidate.lower = 100;
    if (kind === "overlap") breakevens.candidates.push({ ...candidate });
    if (kind === "kind") candidate.kind = "exact";
    if (kind === "wrong-sign") candidate.upperPnl = -2;
    if (kind === "zero-duplicate") breakevens.evaluatedZeros = [80, 80];
    if (kind === "zero-outside") breakevens.evaluatedZeros = [49];
    if (kind === "zero-interior") breakevens.evaluatedZeros = [90.002];
    if (kind === "zero-missing") { candidate.lowerPnl = 0; candidate.kind = "unresolved"; }
    if (kind === "zero-conflict") breakevens.evaluatedZeros = [90];
    if (kind === "count") breakevens.evaluatedZeros = [60, 61, 62, 63, 64];
    if (kind === "tolerance") breakevens.spotTolerance = 1;
    if (kind === "evaluations") breakevens.evaluations = 257;
    if (kind === "status") candidate.upper = 100;
    if (kind === "false-budget") { breakevens.status = "budget-exhausted"; breakevens.evaluations = 256; }
    if (kind === "early-budget") { breakevens.status = "budget-exhausted"; candidate.upper = 100; }
    if (kind === "basis") breakevens.basis = "";
    if (kind === "abort") controller.abort();
    else if (kind === "error") worker.onerror!();
    else if (kind === "message-error") worker.onmessageerror!();
    else handler({ data: kind === "unavailable" ? { id: worker.sent.id, error: "unavailable" } : { id: worker.sent.id + (kind === "id" ? 1 : 0), result } });
    if (kind === "zero-interior") await expect(pending).resolves.toEqual(breakevens);
    else if (["valid", "budget", "empty", "zero"].includes(kind)) await expect(pending).resolves.toEqual(expected.breakevens);
    else await expect(pending).rejects.toThrow();
    handler({ data: { id: worker.sent.id, result: expected } });
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(worker.onmessage).toBeNull(); expect(worker.onerror).toBeNull(); expect(worker.onmessageerror).toBeNull();
  }
  const controller = new AbortController(); controller.abort();
  const previous = FakeWorker.latest;
  await expect(requestFirstExpiryBreakevens(createStrategy("call-calendar"), 50, 150, controller.signal)).rejects.toMatchObject({ name: "AbortError" });
  for (const [min, max] of [[-1, 150], [50, 50], [NaN, 150], [50, Infinity], [50, 1_000_001]]) await expect(requestFirstExpiryBreakevens(createStrategy("call-calendar"), min, max, new AbortController().signal)).rejects.toThrow();
  expect(FakeWorker.latest).toBe(previous);
});

it("accepts actual fixed-budget breakeven outputs for both models without changing ordinary valuation", async () => {
  class FakeWorker {
    onmessage: ((event: { data: unknown }) => void) | null = null;
    onerror = null; onmessageerror = null; terminate = vi.fn();
    postMessage(message: { id: number; state: ReturnType<typeof createStrategy>; min: number; max: number }) {
      const breakevens = firstExpiryBreakevens(message.state, { min: message.min, max: message.max, spotTolerance: .01, maxEvaluations: 256 });
      this.onmessage!({ data: { id: message.id, result: { baseVersion: message.state.version, model: message.state.valuationModel ?? "european-bsm-v1", breakevens } } });
    }
  }
  vi.stubGlobal("Worker", FakeWorker);
  for (const valuationModel of ["european-bsm-v1", "american-crr-1024-v1"] as const) {
    const state = { ...createStrategy("call-calendar"), valuationModel }, before = structuredClone(state);
    const result = await requestFirstExpiryBreakevens(state, 50, 150, new AbortController().signal);
    expect(result.evaluations).toBeLessThanOrEqual(256);
    expect(state).toEqual(before);
    expect(calculateWorkspaceValuation(state)).not.toHaveProperty("firstExpiryBreakevens");
  }
});

it("binds on-demand range worker results and rejects malformed enclosures with complete cleanup", async () => {
  class FakeWorker {
    static latest: FakeWorker;
    onmessage: ((event: { data: unknown }) => void) | null = null;
    onerror: (() => void) | null = null; onmessageerror: (() => void) | null = null;
    sent!: { action: string; id: number; state: ReturnType<typeof createStrategy>; min: number; max: number };
    terminate = vi.fn();
    constructor() { FakeWorker.latest = this; }
    postMessage(data: typeof this.sent) { this.sent = structuredClone(data); }
  }
  vi.stubGlobal("Worker", FakeWorker);
  for (const kind of ["valid", "budget", "id", "version", "model", "domain", "date", "nonfinite", "order", "point", "tolerance", "evaluations", "status", "false-budget", "abort", "error", "message-error", "unavailable"] as const) {
    const state = createStrategy("call-calendar"), controller = new AbortController();
    const pending = requestFirstExpiryRange(state, 50, 150, controller.signal), worker = FakeWorker.latest;
    expect(worker.sent).toMatchObject({ action: "first-expiry-range", min: 50, max: 150 });
    const range = { date: new Date(Math.min(...state.legs.map(leg => Date.parse(leg.expiry)))).toISOString(), spotMin: 50, spotMax: 150, tolerance: 1, evaluations: 3, status: "tolerance-met", minimum: { lower: -10, upper: -9.5, at: { spot: 50, pnl: -9.5 } }, maximum: { lower: 20, upper: 20.5, at: { spot: 100, pnl: 20 } }, basis: "Conditional finite-domain model enclosure" };
    const result = { baseVersion: state.version, model: state.valuationModel ?? "european-bsm-v1", range };
    if (kind === "budget") { range.status = "budget-exhausted"; range.evaluations = 256; range.minimum.lower = -20; }
    const expected = structuredClone(result), handler = worker.onmessage!;
    state.version++;
    if (kind === "version") result.baseVersion++;
    if (kind === "model") result.model = "american-crr-1024-v1";
    if (kind === "domain") range.spotMin++;
    if (kind === "date") range.date = "2000-01-01T00:00:00.000Z";
    if (kind === "nonfinite") range.maximum.upper = Infinity;
    if (kind === "order") range.minimum.lower = 1;
    if (kind === "point") range.minimum.at.spot = 0;
    if (kind === "tolerance") range.tolerance = 2;
    if (kind === "evaluations") range.evaluations = 257;
    if (kind === "status") range.minimum.lower = -20;
    if (kind === "false-budget") { range.status = "budget-exhausted"; range.evaluations = 256; }
    if (kind === "abort") controller.abort();
    else if (kind === "error") worker.onerror!();
    else if (kind === "message-error") worker.onmessageerror!();
    else handler({ data: kind === "unavailable" ? { id: worker.sent.id, error: "unavailable" } : { id: worker.sent.id + (kind === "id" ? 1 : 0), result } });
    if (kind === "valid" || kind === "budget") await expect(pending).resolves.toEqual(expected.range);
    else await expect(pending).rejects.toThrow();
    handler({ data: { id: worker.sent.id, result: expected } });
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(worker.onmessage).toBeNull(); expect(worker.onerror).toBeNull(); expect(worker.onmessageerror).toBeNull();
  }
  const controller = new AbortController(); controller.abort();
  const previous = FakeWorker.latest;
  await expect(requestFirstExpiryRange(createStrategy("call-calendar"), 50, 150, controller.signal)).rejects.toMatchObject({ name: "AbortError" });
  expect(FakeWorker.latest).toBe(previous);
  for (const [min, max] of [[-1, 150], [50, 50], [NaN, 150], [50, Infinity]]) await expect(requestFirstExpiryRange(createStrategy("call-calendar"), min, max, new AbortController().signal)).rejects.toThrow();
  expect(FakeWorker.latest).toBe(previous);
});

it("accepts actual fixed-budget range solver output without adding it to ordinary valuations", async () => {
  class FakeWorker {
    onmessage: ((event: { data: unknown }) => void) | null = null;
    onerror = null; onmessageerror = null; terminate = vi.fn();
    postMessage(message: { id: number; state: ReturnType<typeof createStrategy>; min: number; max: number }) {
      const range = firstExpiryRange(message.state, { min: message.min, max: message.max, tolerance: 1, maxEvaluations: 256 });
      queueMicrotask(() => this.onmessage?.({ data: { id: message.id, result: { baseVersion: message.state.version, model: message.state.valuationModel ?? "european-bsm-v1", range } } }));
    }
  }
  vi.stubGlobal("Worker", FakeWorker);
  for (const valuationModel of ["european-bsm-v1", "american-crr-1024-v1"] as const) {
    const state = { ...createStrategy("call-calendar"), valuationModel }, frozen = structuredClone(state);
    const range = await requestFirstExpiryRange(state, 50, 150, new AbortController().signal);
    expect(range).toMatchObject({ spotMin: 50, spotMax: 150, tolerance: 1 });
    expect(range.evaluations).toBeLessThanOrEqual(256);
    expect(state).toEqual(frozen);
    expect(calculateWorkspaceValuation(state)).not.toHaveProperty("range");
  }
}, 15000);

const lotSide = (): LotScenarioSide => {
  const state = { ...createStrategy("long-call"), feeAllowance: 5 };
  state.legs[0].entryPrice = 2;
  const projection = projectPositionLots(upgradePositionLots(createPosition(state)));
  return { projection, valuation: { remainingState: { ...state, feeAllowance: 0 }, lotMarks: [], analysisUnavailable: null, snapshotId: "same-snapshot", basis: "mid", retrievedAt: state.valuationTimestamp, oldestQuoteAt: state.valuationTimestamp, newestQuoteAt: state.valuationTimestamp, historical: false, grossRealizedPnl: 0, unrealizedPnl: 0, allowance: 5, combinedPnl: -5, disclosure: "Test dated marks" } };
};

it("matches corrected weighted opening costs and signed stock before importing remaining inventory", () => {
  const side = lotSide(), initial = side.projection.initial, lot = side.projection.lots[0];
  const at = "2026-09-05T12:00:00.000Z";
  const added = recordLotTransaction(upgradePositionLots(createPosition(initial)), { id: "add", at, recordedAt: at, closes: [], opens: [{ id: "second", asset: lot.asset, side: lot.side, quantity: 2, entryPrice: 5 }] });
  const corrected = recordLotOpeningPriceCorrection(added, { id: "correct", lotId: lot.id, price: 4, reason: "Correct opening cost", recordedAt: at });
  const lots = projectPositionLots(corrected).lots;
  lots.push({ ...lot, id: "stock-1", asset: { kind: "stock", symbol: initial.underlying }, side: "short", quantity: 2, entryPrice: 100 }, { ...lot, id: "stock-2", asset: { kind: "stock", symbol: initial.underlying }, side: "short", quantity: 1, entryPrice: 106 });
  const state = { ...initial, legs: [{ ...initial.legs[0], contracts: 3, entryPrice: 14 / 3 }], stock: { shares: -3, entryPrice: 102 } };
  const frozen = structuredClone({ lots, state });
  expect(() => assertRemainingLotInventory(lots, state)).not.toThrow();
  for (const patch of [{ entryPrice: 4 }, { contracts: 2 }, { side: "short" as const }]) expect(() => assertRemainingLotInventory(lots, { ...state, legs: [{ ...state.legs[0], ...patch }] })).toThrow();
  for (const stock of [{ shares: 3, entryPrice: 102 }, { shares: -3, entryPrice: 100 }, undefined]) expect(() => assertRemainingLotInventory(lots, { ...state, stock })).toThrow();
  expect(() => assertRemainingLotInventory([...lots, { ...lot, id: "conflict", side: "short" }], state)).toThrow("Conflicting");
  expect(() => assertRemainingLotInventory([{ ...lots[0], quantity: 0 }, ...lots.slice(1)], state)).toThrow("Invalid remaining lot");
  expect({ lots, state }).toEqual(frozen);
});

it("compares explicit lot totals at expiry with allowance once and immutable scenario inputs", async () => {
  class Worker {
    onmessage: ((event: { data: unknown }) => void) | null = null;
    onerror = null; onmessageerror = null; terminate = vi.fn();
    postMessage(message: { id: number; state: ReturnType<typeof createStrategy>; view: Parameters<typeof calculateWorkspaceValuation>[1] }) { queueMicrotask(() => this.onmessage?.({ data: { id: message.id, result: calculateWorkspaceValuation(message.state, message.view) } })); }
  }
  vi.stubGlobal("Worker", Worker);
  const before = lotSide(), after = lotSide();
  after.projection.grossRealizedPnl = 50;
  const scenario = { spot: 110, date: before.projection.lots[0].asset.kind === "option" ? before.projection.lots[0].asset.expiry : "", ivShift: .03 };
  const input = { before, after }, frozen = structuredClone(input);
  const result = await requestLotScenarioComparison(input, scenario, new AbortController().signal);
  expect(result.before.target).toBe(795);
  expect(result.after.target).toBe(845);
  expect(calculateLotScenarioComparison(input, scenario)).toEqual({ scenario, model: result.model, before: { combinedPnl: 795, grossRealizedPnl: 0, unrealizedPnl: 800, allowance: 5 }, after: { combinedPnl: 845, grossRealizedPnl: 50, unrealizedPnl: 800, allowance: 5 } });
  expect(result.before.points.find(point => point.spot === 110)?.value).toBe(795);
  expect(input).toEqual(frozen);
  const shifted = { ...scenario, date: before.projection.initial.scenarioDate, ivShift: .08 };
  const modeled = await requestLotScenarioComparison(input, shifted, new AbortController().signal);
  expect(modeled.before.target).toBeCloseTo(evaluateScenario({ ...before.valuation!.remainingState!, scenarioSpot: 110, scenarioDate: shifted.date, ivShift: .08 }).pnl - 5, 7);
  expect(calculateLotScenarioComparison(input, shifted).before.combinedPnl).toBe(modeled.before.target);
  const legacy = createPosition(before.projection.initial), leg = legacy.initial.legs[0];
  leg.contractId = `SPY   ${leg.contractId.slice(3)}`;
  leg.expiry = leg.expiry.replace(".000Z", "Z");
  legacy.initial.pricing = { mode: "market", snapshotId: "same-snapshot", basis: "mid", entryMode: "fixed" };
  const asset = { multiplier: leg.multiplier, expiry: new Date(leg.expiry).toISOString(), strike: leg.strike, type: leg.type, contractId: leg.contractId, kind: "option" as const };
  const lots = recordLotTransaction(upgradePositionLots(legacy), { id: "add", at: "2026-09-05T12:00:00.000Z", recordedAt: "2026-09-05T12:00:00.000Z", closes: [], opens: [{ id: "canonical", asset, side: "long", quantity: 1, entryPrice: 3 }] });
  const equivalent = lotSide();
  equivalent.projection = projectPositionLots(lots);
  equivalent.valuation!.remainingState = { ...legacy.initial, feeAllowance: 0, legs: [{ ...leg, contracts: 2, entryPrice: 2.5 }] };
  const original = structuredClone(equivalent);
  expect((await requestLotScenarioComparison({ before: equivalent, after: equivalent }, scenario, new AbortController().signal)).before.target).toBe(1495);
  expect(equivalent).toEqual(original);
});

it("supports closed and signed stock-only sides without workers and rejects incompatible lot comparisons", async () => {
  const unexpectedWorker = vi.fn(function () { throw new Error("Unexpected worker construction"); });
  vi.stubGlobal("Worker", unexpectedWorker);
  const before = lotSide(), after = lotSide();
  before.projection.lots = []; before.projection.status = "closed"; before.projection.grossRealizedPnl = 80; before.projection.netClosedPnl = 75; before.valuation = null;
  after.projection.lots = [{ ...after.projection.lots[0], asset: { kind: "stock", symbol: after.projection.initial.underlying }, side: "short", quantity: 10, entryPrice: 100 }];
  after.valuation!.remainingState = null;
  const scenario = { spot: 110, date: after.projection.initial.scenarioDate, ivShift: 0 };
  const result = await requestLotScenarioComparison({ before, after }, scenario, new AbortController().signal);
  expect(result.before.target).toBe(75); expect(result.after.target).toBe(-105);
  expect(calculateLotScenarioComparison({ before, after }, scenario)).toEqual({ scenario, model: result.model, before: { combinedPnl: 75, grossRealizedPnl: 80, unrealizedPnl: 0, allowance: 5 }, after: { combinedPnl: -105, grossRealizedPnl: 0, unrealizedPnl: -100, allowance: 5 } });
  expect(result.before.points.every(point => point.value === 75)).toBe(true);
  after.projection.lots[0].side = "long";
  expect((await requestLotScenarioComparison({ before, after }, scenario, new AbortController().signal)).after.target).toBe(95);
  for (const mutate of [
    (side: LotScenarioSide) => { side.valuation!.remainingState = null; },
    (side: LotScenarioSide) => { side.valuation!.remainingState!.legs[0].entryPrice = 999; },
    (side: LotScenarioSide) => { side.projection.initial.rate += .01; },
    (side: LotScenarioSide) => { side.valuation!.snapshotId = "other"; },
    (side: LotScenarioSide) => { side.valuation!.retrievedAt = "2026-09-04T19:00:00.000Z"; },
    (side: LotScenarioSide) => { side.valuation!.basis = "natural"; },
    (side: LotScenarioSide) => { side.valuation!.remainingState!.valuationTimestamp = "2026-09-04T19:00:00.000Z"; },
    (side: LotScenarioSide) => { side.valuation!.remainingState!.spot += 1; },
  ]) { const left = lotSide(), right = lotSide(); mutate(right); expect(() => calculateLotScenarioComparison({ before: left, after: right }, scenario)).toThrow(); await expect(requestLotScenarioComparison({ before: left, after: right }, scenario, new AbortController().signal)).rejects.toThrow(); }
  await expect(requestLotScenarioComparison({ before: lotSide(), after: lotSide() }, { ...scenario, date: "2099-01-01T00:00:00.000Z" }, new AbortController().signal)).rejects.toThrow();
  await expect(requestLotScenarioComparison({ before: lotSide(), after: lotSide() }, { ...scenario, date: "2020-01-01T00:00:00.000Z" }, new AbortController().signal)).rejects.toThrow();
  for (const coordinates of [{ ...scenario, date: "2099-01-01T00:00:00.000Z" }, { ...scenario, date: "2020-01-01T00:00:00.000Z" }, { ...scenario, spot: NaN }]) expect(() => calculateLotScenarioComparison({ before: lotSide(), after: lotSide() }, coordinates)).toThrow();
  const overflowing = structuredClone(after);
  overflowing.projection.lots[0].entryPrice = Number.MAX_VALUE;
  expect(() => calculateLotScenarioComparison({ before, after: overflowing }, scenario)).toThrow("numerical range");
  const aborted = new AbortController(); aborted.abort();
  await expect(requestLotScenarioComparison({ before, after }, scenario, aborted.signal)).rejects.toThrow("cancelled");
  expect(unexpectedWorker).not.toHaveBeenCalled();
});

it("cancels both lot comparison workers on abort or sibling failure", async () => {
  class Worker {
    static all: Worker[] = [];
    onmessage = null; onerror: (() => void) | null = null; onmessageerror = null; terminate = vi.fn();
    constructor() { Worker.all.push(this); }
    postMessage() {}
  }
  vi.stubGlobal("Worker", Worker);
  for (const fail of [false, true]) {
    Worker.all = [];
    const side = lotSide(), controller = new AbortController();
    const pending = requestLotScenarioComparison({ before: side, after: side }, { spot: 100, date: side.projection.initial.scenarioDate, ivShift: 0 }, controller.signal);
    if (fail) Worker.all[0].onerror!(); else controller.abort();
    await expect(pending).rejects.toThrow();
    expect(Worker.all).toHaveLength(2);
    for (const worker of Worker.all) expect(worker.terminate).toHaveBeenCalledOnce();
  }
});

it("preserves frozen raw-value attribution before and at first expiry", async () => {
  const outputs = [];
  for (const valuationModel of ["european-bsm-v1", "american-crr-1024-v1"] as const) for (const id of ["iron-condor", "call-calendar"] as const) for (const withStock of [false, true]) for (const atExpiry of [false, true]) {
    const state = { ...createStrategy(id), valuationModel, scenarioSpot: atExpiry ? 130 : 101.137, ivShift: .037, feeAllowance: 1e12, ...(withStock ? { stock: { shares: -83, entryPrice: 91.37 } } : {}) };
    if (atExpiry) state.scenarioDate = new Date(Math.min(...state.legs.map(leg => Date.parse(leg.expiry)))).toISOString();
    outputs.push(scenarioSpotAttribution(state));
  }
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(outputs)));
  expect([...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, "0")).join("")).toBe("6a51a0cba66a11a6c0e6d33bfd7197a8f9901abbdca67df610469383ee25d50c");
}, 15000);

it("preserves native curve samples and anchors across metrics, comparison dates and first expiry", () => {
  const state = createStrategy("call-calendar"), comparison = createStrategy("collar");
  state.scenarioSpot = 101.137;
  comparison.scenarioSpot = 98.731;
  comparison.scenarioDate = "2026-09-07T20:00:00.000Z";
  comparison.ivShift = 0.03;
  const before = structuredClone({ state, comparison });
  const min = 0, max = 137.913;
  for (const metric of ["pnl", "delta", "gamma", "theta", "vega", "rho"] as const) {
    const baseline = (source: typeof state, at = Date.parse(source.scenarioDate)) => {
      const samples = new Map(metric === "pnl" ? payoffSeries(source, min, max, 160, at).map(point => [point.spot, point.pnl]) : scenarioSeries(source, min, max, 160, at).map(point => [point.spot, point[metric]]));
      for (const spot of new Set([source.scenarioSpot, ...source.legs.map(leg => leg.strike)])) if (spot > 0 && spot >= min && spot <= max) samples.set(spot, evaluateScenario({ ...source, scenarioSpot: spot, scenarioDate: new Date(at).toISOString() })[metric]);
      return [...samples].sort(([a], [b]) => a - b).map(([spot, value]) => ({ spot, value }));
    };
    const expiry = Math.min(...state.legs.map(leg => Date.parse(leg.expiry)));
    expect(scenarioCurve(state, min, max, metric)).toEqual(baseline(state));
    expect(calculateWorkspaceValuation(state, { kind: "curve", min, max, metric, comparison }).curve).toEqual({ min, max, metric, comparisonVersion: comparison.version, comparisonModel: "european-bsm-v1", points: baseline(state), expiration: metric === "pnl" ? baseline(state, expiry) : [], compared: baseline(comparison), target: evaluateScenario(state)[metric] });
    expect(calculateWorkspaceValuation(state, { kind: "curve", min, max, metric }).curve?.compared).toEqual([]);
  }
  expect({ state, comparison }).toEqual(before);
  expect(() => scenarioCurve(state, -1, max, "pnl")).toThrow("range");
  expect(() => scenarioCurve({ ...state, legs: [] }, min, max, "pnl")).toThrow();
});

it("checks worker identity and finite output and terminates success, rejection and cancellation", async () => {
  class FakeWorker {
    static latest: FakeWorker;
    onmessage: ((event: { data: unknown }) => void) | null = null;
    onerror: (() => void) | null = null;
    onmessageerror: (() => void) | null = null;
    sent!: { id: number; state: ReturnType<typeof createStrategy> };
    terminate = vi.fn();
    constructor() { FakeWorker.latest = this; }
    postMessage(data: typeof this.sent) { this.sent = structuredClone(data); }
  }
  vi.stubGlobal("Worker", FakeWorker);
  for (const kind of ["valid", "id", "version", "model", "metrics", "legs", "leg-order", "leg-count", "abort", "error", "unavailable"] as const) {
    const state = createStrategy("bull-call"), controller = new AbortController();
    const pending = requestWorkspaceValuation(state, controller.signal), worker = FakeWorker.latest;
    const result = calculateWorkspaceValuation(state), expected = structuredClone(result);
    state.version += 1;
    expect(worker.sent.state.version).toBe(expected.baseVersion);
    if (kind === "abort") controller.abort();
    else if (kind === "error") worker.onerror!();
    else if (kind === "unavailable") worker.onmessage!({ data: { id: worker.sent.id, error: "Workspace valuation unavailable for these inputs." } });
    else {
      if (kind === "version") result.baseVersion += 1;
      if (kind === "model") (result as { model: string }).model = "american-crr-1024-v1";
      if (kind === "metrics") result.metrics.delta = Infinity;
      if (kind === "legs") result.legs[0].greeks.theta = NaN;
      if (kind === "leg-order") result.legs.reverse();
      if (kind === "leg-count") result.legs.pop();
      worker.onmessage!({ data: { id: worker.sent.id + (kind === "id" ? 1 : 0), result } });
    }
    if (kind === "valid") await expect(pending).resolves.toEqual(expected);
    else if (kind === "unavailable") await expect(pending).rejects.toThrow("Workspace valuation unavailable for these inputs.");
    else await expect(pending).rejects.toThrow();
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(worker.onmessage).toBeNull();
  }
  const controller = new AbortController();
  for (const kind of ["valid", "missing", "target", "range", "metric", "comparison", "order", "anchor", "grid", "expiration", "compared"] as const) {
    const state = createStrategy("call-calendar"), comparison = createStrategy("collar");
    state.scenarioSpot = 101.137;
    const view = { kind: "curve" as const, min: 0, max: 137.913, metric: "pnl" as const, comparison };
    const pending = requestWorkspaceValuation(state, new AbortController().signal, view), worker = FakeWorker.latest;
    const result = calculateWorkspaceValuation(state, view), expected = structuredClone(result);
    if (kind === "missing") result.curve = null;
    if (kind === "target") result.curve!.target = NaN;
    if (kind === "range") result.curve!.min += 1;
    if (kind === "metric") result.curve!.metric = "delta";
    if (kind === "comparison") result.curve!.comparisonVersion! += 1;
    if (kind === "order") result.curve!.points.reverse();
    if (kind === "anchor") result.curve!.points = result.curve!.points.filter(point => point.spot !== state.scenarioSpot);
    if (kind === "grid") result.curve!.points = result.curve!.points.filter(point => [state.scenarioSpot, ...state.legs.map(leg => leg.strike)].includes(point.spot));
    if (kind === "expiration") result.curve!.expiration = [];
    if (kind === "compared") result.curve!.compared[0].value = Infinity;
    view.min = 20;
    comparison.version += 1;
    worker.onmessage!({ data: { id: worker.sent.id, result } });
    if (kind === "valid") await expect(pending).resolves.toEqual(expected);
    else await expect(pending).rejects.toThrow("Invalid workspace valuation result");
    expect(worker.terminate).toHaveBeenCalledOnce();
  }
  controller.abort();
  await expect(requestWorkspaceValuation(createStrategy("bull-call"), controller.signal)).rejects.toMatchObject({ name: "AbortError" });
});

it("preserves canonical metrics and leg facts for every template without changing inputs", () => {
  for (const { id } of TEMPLATES) {
    const state = createStrategy(id);
    state.stock = { shares: -83, entryPrice: 91.37 };
    state.feeAllowance = 12.37;
    state.ivShift = 0.03;
    const before = structuredClone(state);
    expect(calculateWorkspaceValuation(state)).toEqual({ baseVersion: state.version, model: "european-bsm-v1", metrics: calculateStrategy(state), legs: scenarioFacts(state).legs, table: null, heatmap: null, curve: null });
    expect(calculateWorkspaceValuation(state, "table").table).toEqual({ rows: scenarioTable(state), attribution: scenarioSpotAttribution(state) });
    expect(state).toEqual(before);
    delete state.valuationModel;
    expect(calculateWorkspaceValuation(state).model).toBe("european-bsm-v1");
  }
});

it("requires requested table presence and rejects malformed rows or attribution baselines", async () => {
  class FakeWorker {
    static latest: FakeWorker;
    onmessage: ((event: { data: unknown }) => void) | null = null;
    onerror = null;
    onmessageerror = null;
    sent!: { id: number; state: ReturnType<typeof createStrategy>; view?: "table" | "heatmap" };
    terminate = vi.fn();
    constructor() { FakeWorker.latest = this; }
    postMessage(data: typeof this.sent) { this.sent = structuredClone(data); }
  }
  vi.stubGlobal("Worker", FakeWorker);
  for (const kind of ["valid", "missing", "unsolicited", "nonfinite", "order", "alignment", "oversized", "baseline-date", "baseline-spot", "baseline-iv"] as const) {
    const state = createStrategy("collar"), before = structuredClone(state);
    const pending = requestWorkspaceValuation(state, new AbortController().signal, kind !== "unsolicited" ? "table" : undefined), worker = FakeWorker.latest;
    expect(worker.sent.view).toBe(kind !== "unsolicited" ? "table" : undefined);
    const result = calculateWorkspaceValuation(state, "table"), expected = structuredClone(result);
    if (kind === "missing") result.table = null;
    if (kind === "nonfinite") result.table!.rows[0].gamma = Infinity;
    if (kind === "order") { result.table!.rows.reverse(); result.table!.attribution.rows.reverse(); }
    if (kind === "alignment") result.table!.attribution.rows[0].spot += 1;
    if (kind === "oversized") result.table!.rows = Array(100).fill(result.table!.rows[0]);
    if (kind === "baseline-date") result.table!.attribution.baseline.date = "2026-09-07T20:00:00.000Z";
    if (kind === "baseline-spot") result.table!.attribution.baseline.spot += 1;
    if (kind === "baseline-iv") result.table!.attribution.baseline.ivShift += 0.01;
    expect(state).toEqual(before);
    state.scenarioSpot += 10;
    worker.onmessage!({ data: { id: worker.sent.id, result } });
    if (kind === "valid") await expect(pending).resolves.toEqual(expected);
    else await expect(pending).rejects.toThrow("Invalid workspace valuation result");
    expect(worker.terminate).toHaveBeenCalledOnce();
  }
});

it("matches the former heatmap scalar formula exactly for every template and expanded domains", () => {
  for (const { id } of TEMPLATES) for (const target of [100, 12.137, 371.913]) {
    const state = createStrategy(id);
    state.scenarioSpot = target;
    state.stock = { shares: -83, entryPrice: 91.37 };
    state.feeAllowance = 12.37;
    state.ivShift = 0.037;
    const before = structuredClone(state);
    const min = Math.min(state.spot * .76, target, ...state.legs.map(leg => leg.strike));
    const max = Math.max(state.spot * 1.24, target, ...state.legs.map(leg => leg.strike));
    const start = Date.parse(state.valuationTimestamp), end = Math.min(...state.legs.map(leg => Date.parse(leg.expiry)));
    const expected = Array.from({ length: 792 }, (_, index) => {
      const date = new Date(start + (end - start) * Math.floor(index / 44) / 17).toISOString();
      const spot = min + (max - min) * (index % 44) / 43;
      return { spot, date, pnl: evaluateScenario({ ...state, scenarioDate: date, scenarioSpot: spot }).pnl };
    });
    expect(scenarioHeatmap(state)).toEqual(expected);
    expect(calculateWorkspaceValuation(state, "heatmap").heatmap).toEqual(expected);
    expect(calculateWorkspaceValuation(state, "heatmap").table).toBeNull();
    expect(state).toEqual(before);
  }
});

it("rejects missing, unsolicited, malformed and misaligned heatmap output", async () => {
  class FakeWorker {
    static latest: FakeWorker;
    onmessage: ((event: { data: unknown }) => void) | null = null;
    onerror = null;
    onmessageerror = null;
    sent!: { id: number; state: ReturnType<typeof createStrategy>; view?: string };
    terminate = vi.fn();
    constructor() { FakeWorker.latest = this; }
    postMessage(data: typeof this.sent) { this.sent = structuredClone(data); }
  }
  vi.stubGlobal("Worker", FakeWorker);
  for (const kind of ["valid", "missing", "unsolicited", "count", "pnl", "spot", "date", "order"] as const) {
    const state = createStrategy("put-calendar");
    state.scenarioSpot = 371.913;
    const pending = requestWorkspaceValuation(state, new AbortController().signal, kind === "unsolicited" ? undefined : "heatmap");
    const worker = FakeWorker.latest, result = calculateWorkspaceValuation(state, "heatmap"), expected = structuredClone(result);
    if (kind === "missing") result.heatmap = null;
    if (kind === "count") result.heatmap!.pop();
    if (kind === "pnl") result.heatmap![0].pnl = Infinity;
    if (kind === "spot") result.heatmap![0].spot += 1;
    if (kind === "date") result.heatmap![44].date = result.heatmap![0].date;
    if (kind === "order") result.heatmap!.reverse();
    state.scenarioSpot = 80;
    worker.onmessage!({ data: { id: worker.sent.id, result } });
    if (kind === "valid") await expect(pending).resolves.toEqual(expected);
    else await expect(pending).rejects.toThrow("Invalid workspace valuation result");
    expect(worker.terminate).toHaveBeenCalledOnce();
  }
});

it("rejects invalid source states before returning workspace calculations", () => {
  const state = createStrategy("bull-call");
  expect(() => calculateWorkspaceValuation({ ...state, legs: [] })).toThrow("one to four legs");
  expect(() => calculateWorkspaceValuation({ ...state, scenarioSpot: NaN })).toThrow();
});
