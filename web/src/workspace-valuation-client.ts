import { isChartRange, scenarioSpots, type ChartRange, type StrategyState, type firstExpiryRange, type firstExpiryBreakevens } from "./options";
import { prepareLotScenarioComparison, type LotScenarioInput, type LotScenario } from "./lot-scenarios";
export type { LotScenarioSide, LotScenarioInput, LotScenario } from "./lot-scenarios";
import type { calculateWorkspaceValuation, WorkspaceView } from "./workspace-valuation";

let nextRequestId = 0;

export function requestFirstExpiryBreakevens(state: StrategyState, min: number, max: number, signal: AbortSignal): Promise<ReturnType<typeof firstExpiryBreakevens>> {
  if (signal.aborted) return Promise.reject(new DOMException("Calculation cancelled", "AbortError"));
  const id = ++nextRequestId, baseVersion = state.version, model = state.valuationModel ?? "european-bsm-v1";
  const expiry = Math.min(...state.legs.map(leg => Date.parse(leg.expiry)));
  if (!Number.isFinite(min) || !Number.isFinite(max) || min < 0 || max <= min || max > 1_000_000 || !Number.isFinite(expiry)) return Promise.reject(new Error("Invalid first-expiry breakevens"));
  const date = new Date(expiry).toISOString();
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./workspace-valuation.worker.ts", import.meta.url), { type: "module" });
    let settled = false;
    const cleanup = () => { settled = true; worker.terminate(); worker.onmessage = null; worker.onerror = null; worker.onmessageerror = null; signal.removeEventListener("abort", abort); };
    const abort = () => { if (settled) return; cleanup(); reject(new DOMException("Calculation cancelled", "AbortError")); };
    signal.addEventListener("abort", abort, { once: true });
    worker.onmessage = event => {
      if (settled) return;
      if (signal.aborted) { abort(); return; }
      cleanup();
      const result = event.data?.result, value = result?.breakevens;
      const finite = (number: unknown): number is number => typeof number === "number" && Number.isFinite(number);
      const validZeros = Array.isArray(value?.evaluatedZeros) && value.evaluatedZeros.length <= value.evaluations
        && value.evaluatedZeros.every((spot: number, index: number) => finite(spot) && spot >= min && spot <= max && (index === 0 || spot > value.evaluatedZeros[index - 1]));
      const validCandidates = validZeros && Array.isArray(value?.candidates) && value.candidates.length <= value.evaluations - 1
        && value.candidates.every((candidate: ReturnType<typeof firstExpiryBreakevens>["candidates"][number], index: number) => candidate
          && finite(candidate.lower) && finite(candidate.upper) && candidate.lower >= min && candidate.upper <= max && candidate.lower < candidate.upper
          && (index === 0 || candidate.lower >= value.candidates[index - 1].upper) && finite(candidate.lowerPnl) && finite(candidate.upperPnl)
          && (candidate.lowerPnl === 0) === value.evaluatedZeros.includes(candidate.lower) && (candidate.upperPnl === 0) === value.evaluatedZeros.includes(candidate.upper)
          && (candidate.kind === "sign-changing" ? (candidate.lowerPnl < 0 && candidate.upperPnl > 0 || candidate.lowerPnl > 0 && candidate.upperPnl < 0)
            : candidate.kind === "unresolved" && !(candidate.lowerPnl < 0 && candidate.upperPnl > 0 || candidate.lowerPnl > 0 && candidate.upperPnl < 0)));
      const valid = event.data?.id === id && !event.data?.error && result?.baseVersion === baseVersion && result?.model === model
        && value?.date === date && value.spotMin === min && value.spotMax === max && value.spotTolerance === .01
        && Number.isSafeInteger(value.evaluations) && value.evaluations >= 2 && value.evaluations <= 256 && validZeros && validCandidates
        && typeof value.basis === "string" && value.basis.length > 0 && value.basis.length <= 4096
        && (value.status === "spot-tolerance-met" ? value.candidates.every((candidate: { lower: number; upper: number }) => candidate.upper - candidate.lower <= .01)
          : value.status === "budget-exhausted" && value.evaluations === 256 && value.candidates.some((candidate: { lower: number; upper: number }) => candidate.upper - candidate.lower > .01));
      if (!valid) reject(new Error("Invalid first-expiry breakevens result"));
      else resolve(value);
    };
    worker.onerror = worker.onmessageerror = () => { if (settled) return; cleanup(); reject(new Error("First-expiry breakevens worker failed.")); };
    try { worker.postMessage({ action: "first-expiry-breakevens", id, state, min, max }); }
    catch (error) { if (!settled) { cleanup(); reject(error); } }
  });
}

export function requestFirstExpiryRange(state: StrategyState, min: number, max: number, signal: AbortSignal): Promise<ReturnType<typeof firstExpiryRange>> {
  if (signal.aborted) return Promise.reject(new DOMException("Calculation cancelled", "AbortError"));
  const id = ++nextRequestId, baseVersion = state.version, model = state.valuationModel ?? "european-bsm-v1";
  const expiry = Math.min(...state.legs.map(leg => Date.parse(leg.expiry)));
  if (!Number.isFinite(min) || !Number.isFinite(max) || min < 0 || max <= min || max > 1_000_000 || !Number.isFinite(expiry)) return Promise.reject(new Error("Invalid first-expiry range"));
  const date = new Date(expiry).toISOString();
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./workspace-valuation.worker.ts", import.meta.url), { type: "module" });
    let settled = false;
    const cleanup = () => { settled = true; worker.terminate(); worker.onmessage = null; worker.onerror = null; worker.onmessageerror = null; signal.removeEventListener("abort", abort); };
    const abort = () => { if (settled) return; cleanup(); reject(new DOMException("Calculation cancelled", "AbortError")); };
    signal.addEventListener("abort", abort, { once: true });
    worker.onmessage = event => {
      if (settled) return;
      if (signal.aborted) { abort(); return; }
      cleanup();
      const result = event.data?.result, range = result?.range;
      const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
      const validBound = (bound: typeof range.minimum) => bound && finite(bound.lower) && finite(bound.upper) && bound.lower <= bound.upper
        && bound.at && finite(bound.at.spot) && bound.at.spot >= min && bound.at.spot <= max && finite(bound.at.pnl) && bound.at.pnl >= bound.lower && bound.at.pnl <= bound.upper;
      const valid = event.data?.id === id && !event.data?.error && result?.baseVersion === baseVersion && result?.model === model
        && range?.date === date && range.spotMin === min && range.spotMax === max && range.tolerance === 1
        && Number.isSafeInteger(range.evaluations) && range.evaluations >= 2 && range.evaluations <= 256
        && validBound(range.minimum) && validBound(range.maximum) && range.minimum.upper === range.minimum.at.pnl && range.maximum.lower === range.maximum.at.pnl
        && range.minimum.at.pnl <= range.maximum.at.pnl && range.minimum.lower <= range.maximum.lower && range.minimum.upper <= range.maximum.upper
        && typeof range.basis === "string" && range.basis.length > 0 && range.basis.length <= 4096
        && (range.status === "tolerance-met" ? range.minimum.upper - range.minimum.lower <= 1 && range.maximum.upper - range.maximum.lower <= 1
          : range.status === "budget-exhausted" && (range.minimum.upper - range.minimum.lower > 1 || range.maximum.upper - range.maximum.lower > 1));
      if (!valid) reject(new Error("Invalid first-expiry range result"));
      else resolve(range);
    };
    worker.onerror = worker.onmessageerror = () => { if (settled) return; cleanup(); reject(new Error("First-expiry range worker failed.")); };
    try { worker.postMessage({ action: "first-expiry-range", id, state, min, max }); }
    catch (error) { if (!settled) { cleanup(); reject(error); } }
  });
}

type LotScenarioCurve = { points: { spot: number; value: number }[]; target: number };
export type LotScenarioComparison = { scenario: LotScenario; model: string; min: number; max: number; before: LotScenarioCurve; after: LotScenarioCurve };

export async function requestLotScenarioComparison(input: LotScenarioInput, scenario: LotScenario, signal: AbortSignal): Promise<LotScenarioComparison> {
  if (signal.aborted) throw new DOMException("Calculation cancelled", "AbortError");
  const { sides, selected, model, min, max, states } = prepareLotScenarioComparison(input, scenario);
  const finite = (value: number) => typeof value === "number" && Number.isFinite(value);
  const controller = new AbortController(), abort = () => controller.abort();
  signal.addEventListener("abort", abort, { once: true });
  const stockSpots = [...new Set([...Array.from({ length: 161 }, (_, index) => Number((min + (max - min) * index / 160).toFixed(8))), selected.spot])].sort((a, b) => a - b);
  try {
    const curves = await Promise.all(sides.map(async (side, index) => {
      const offset = side.projection.grossRealizedPnl - side.projection.allowance;
      const state = states[index];
      let result: LotScenarioCurve;
      if (state) {
        const bundle = await requestWorkspaceValuation(state, controller.signal, { kind: "curve", min, max, metric: "pnl" });
        if (!bundle.curve) throw new Error("Remaining scenario curve unavailable.");
        result = { points: bundle.curve.points.map(point => ({ spot: point.spot, value: point.value + offset })), target: bundle.curve.target + offset };
      } else {
        const at = (spot: number) => offset + side.projection.lots.reduce((pnl, lot) => pnl + (spot - lot.entryPrice) * lot.quantity * (lot.side === "long" ? 1 : -1), 0);
        result = { points: stockSpots.map(spot => ({ spot, value: at(spot) })), target: at(selected.spot) };
      }
      if (!finite(result.target) || result.points.some(point => !finite(point.spot) || !finite(point.value))) throw new Error("Lot scenario totals exceed numerical range.");
      return result;
    }));
    if (signal.aborted) throw new DOMException("Calculation cancelled", "AbortError");
    return { scenario: selected, model, min, max, before: curves[0], after: curves[1] };
  } catch (error) { controller.abort(); throw error; }
  finally { signal.removeEventListener("abort", abort); }
}

export function requestWorkspaceValuation(state: StrategyState, signal: AbortSignal, view?: WorkspaceView, range?: ChartRange): Promise<ReturnType<typeof calculateWorkspaceValuation>> {
  if (signal.aborted) return Promise.reject(new DOMException("Calculation cancelled", "AbortError"));
  if (range !== undefined && !isChartRange(range)) return Promise.reject(new Error("Invalid chart range"));
  const id = ++nextRequestId, sourceVersion = state.version, sourceModel = state.valuationModel ?? "european-bsm-v1";
  const legIds = state.legs.map(leg => leg.id);
  const expectedMode = !legIds.length ? "spot" : new Set(state.legs.map(leg => leg.expiry)).size > 1 ? "first-expiry" : "expiration";
  const baseline = { spot: state.scenarioSpot, date: state.scenarioDate, ivShift: state.ivShift };
  const min = range?.min ?? Math.min(state.spot * .76, state.scenarioSpot, ...state.legs.map(leg => leg.strike));
  const max = range?.max ?? Math.max(state.spot * 1.24, state.scenarioSpot, ...state.legs.map(leg => leg.strike));
  const tableSpots = view === "table" ? scenarioSpots(state, range) : [];
  const start = Date.parse(state.valuationTimestamp), end = Math.min(...state.legs.map(leg => Date.parse(leg.expiry)));
  const curveView = typeof view === "object" && view.kind === 'curve' ? { min: view.min, max: view.max, metric: view.metric, comparisonVersion: view.comparison?.version ?? null, comparisonModel: view.comparison ? view.comparison.valuationModel ?? "european-bsm-v1" : null } : null;
  const anchors = [state.scenarioSpot, ...state.legs.map(leg => leg.strike)];
  const comparisonAnchors = typeof view === "object" && view.kind === 'curve' && view.comparison ? [view.comparison.scenarioSpot, ...view.comparison.legs.map(leg => leg.strike)] : [];
  const expectedSpots = (anchors: number[]) => curveView ? [...new Set([
    ...Array.from({ length: 161 }, (_, index) => { const spot = curveView.min + (curveView.max - curveView.min) * index / 160; return Math.abs(spot) < 1e-9 ? 0 : Number(spot.toFixed(8)); }),
    ...anchors.filter(spot => spot > 0 && spot >= curveView.min && spot <= curveView.max),
  ])].sort((a, b) => a - b) : [];
  const currentSpots = expectedSpots(anchors), comparisonSpots = expectedSpots(comparisonAnchors);
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./workspace-valuation.worker.ts", import.meta.url), { type: "module" });
    const cleanup = () => { worker.terminate(); worker.onmessage = null; worker.onerror = null; worker.onmessageerror = null; signal.removeEventListener("abort", abort); };
    const abort = () => { cleanup(); reject(new DOMException("Calculation cancelled", "AbortError")); };
    signal.addEventListener("abort", abort, { once: true });
    worker.onmessage = event => {
      if (signal.aborted) { abort(); return; }
      cleanup();
      if (event.data?.id === id && event.data.error) { reject(new Error("Workspace valuation unavailable for these inputs.")); return; }
      const result = event.data?.result, metrics = result?.metrics;
      const comparisonView = typeof view === 'object' && view.kind === 'candidate-comparison' ? view : null;
      const comparison = result?.candidateComparison;
      const validComparison = comparisonView ? comparison && comparison.candidate?.id === comparisonView.selection.id
        && JSON.stringify(comparison.candidate.request) === JSON.stringify(comparisonView.selection.request)
        && JSON.stringify(comparison.candidate.domain) === JSON.stringify(comparisonView.selection.domain)
        && comparison.state?.pricing?.snapshotId === comparisonView.snapshot.id
        && (comparison.state?.valuationModel ?? 'european-bsm-v1') === sourceModel
        && comparison.baseline?.state?.version === sourceVersion : comparison === undefined;
      const finite = (value: unknown) => typeof value === "number" && Number.isFinite(value);
      const validSeries = (points: unknown, spots: number[]) => Array.isArray(points) && points.length === spots.length
        && points.every((point, index) => point && point.spot === spots[index] && finite(point.value));
      const curve = result?.curve;
      const validCurve = !curveView ? curve === null : curve && curve.min === curveView.min && curve.max === curveView.max && curve.metric === curveView.metric
        && curve.comparisonVersion === curveView.comparisonVersion && curve.comparisonModel === curveView.comparisonModel && finite(curve.target)
        && validSeries(curve.points, currentSpots)
        && (curveView.metric === "pnl" && legIds.length > 0 ? validSeries(curve.expiration, currentSpots) : Array.isArray(curve.expiration) && curve.expiration.length === 0)
        && (curveView.comparisonVersion !== null ? validSeries(curve.compared, comparisonSpots) : Array.isArray(curve.compared) && curve.compared.length === 0);
      const table = result?.table;
      const validTable = view !== "table" ? table === null : table && Array.isArray(table.rows) && table.rows.length === tableSpots.length
        && table.attribution?.baseline?.spot === baseline.spot && table.attribution.baseline.date === baseline.date && table.attribution.baseline.ivShift === baseline.ivShift
        && JSON.stringify(table.attribution.baseline.expiryIvShifts ?? []) === JSON.stringify(state.expiryIvShifts ?? [])
        && typeof table.attribution.basis === "string" && Array.isArray(table.attribution.rows) && table.attribution.rows.length === table.rows.length
        && table.rows.every((row: NonNullable<ReturnType<typeof calculateWorkspaceValuation>["table"]>["rows"][number], index: number) => row
          && [row.spot, row.pnl, row.delta, row.gamma, row.theta, row.vega, row.rho].every(finite) && row.spot === tableSpots[index]
          && (index === 0 || row.spot > table.rows[index - 1].spot)
          && table.attribution.rows[index]?.spot === row.spot
          && [table.attribution.rows[index].pnlChange, table.attribution.rows[index].stockChange, table.attribution.rows[index].optionChange].every(finite));
      const validHeatmap = view !== "heatmap" ? result?.heatmap === null : Array.isArray(result?.heatmap) && result.heatmap.length === 792
        && result.heatmap.every((point: { spot: number; date: string; pnl: number }, index: number) => point && finite(point.spot) && finite(point.pnl)
          && point.spot === (range && index % 44 === 43 ? max : min + (max - min) * (index % 44) / 43)
          && point.date === new Date(start + (end - start) * Math.floor(index / 44) / 17).toISOString());
      if (event.data?.id !== id || result?.baseVersion !== sourceVersion || result?.model !== sourceModel
        || !validTable || !validHeatmap || !validCurve || !validComparison
        || !metrics || !["Debit", "Credit"].includes(metrics.entryLabel) || metrics.mode !== expectedMode
        || !["entryAmount", "delta", "gamma", "theta", "vega", "rho", "modeledLow", "modeledHigh", "scenarioPnl"].every(key => finite(metrics[key]))
        || !["maxProfit", "maxLoss"].every(key => metrics[key] === null || finite(metrics[key]))
        || !Array.isArray(metrics.breakevens) || !metrics.breakevens.every(finite)
        || !Array.isArray(result.legs) || result.legs.length !== legIds.length
        || !result.legs.every((leg: ReturnType<typeof calculateWorkspaceValuation>["legs"][number], index: number) => leg?.legId === legIds[index]
          && ["at-the-money", "in-the-money", "out-of-the-money"].includes(leg.moneyness)
          && [leg.modelValuePerShare, leg.intrinsicPerShare, leg.modelValueMinusIntrinsicPerShare].every(finite)
          && (leg.modelResidualFractionOfModelValue === null || finite(leg.modelResidualFractionOfModelValue))
          && leg.greeks && [leg.greeks.delta, leg.greeks.gamma, leg.greeks.theta, leg.greeks.vega, leg.greeks.rho].every(finite))) {
        reject(new Error("Invalid workspace valuation result"));
      } else resolve(result);
    };
    worker.onerror = worker.onmessageerror = () => { cleanup(); reject(new Error("Workspace valuation worker failed.")); };
    try { worker.postMessage({ id, state, view, range }); }
    catch (error) { cleanup(); reject(error); }
  });
}
