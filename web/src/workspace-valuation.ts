import { calculateStrategy, compareSearchCandidate, evaluateScenario, scenarioCurve, scenarioFacts, scenarioHeatmap, scenarioTable, scenarioSpotAttribution, isChartRange, type CandidateSelection, type MarketSnapshot, type ChartRange, type StrategyState } from "./options";

export type WorkspaceView = "table" | "heatmap" | { kind: "curve"; min: number; max: number; metric: keyof ReturnType<typeof evaluateScenario>; comparison?: StrategyState } | { kind: 'candidate-comparison'; snapshot: MarketSnapshot; selection: CandidateSelection };

export function calculateWorkspaceValuation(state: StrategyState, view?: WorkspaceView, range?: ChartRange) {
  if (range !== undefined && !isChartRange(range)) throw new Error("Invalid chart range");
  return {
    baseVersion: state.version,
    model: state.valuationModel ?? "european-bsm-v1",
    metrics: calculateStrategy(state),
    legs: scenarioFacts(state).legs,
    ...(typeof view === 'object' && view.kind === 'candidate-comparison' ? { candidateComparison: compareSearchCandidate(state, view.snapshot, view.selection) } : {}),
    table: view === "table" ? { rows: scenarioTable(state, range), attribution: scenarioSpotAttribution(state, range) } : null,
    heatmap: view === "heatmap" ? scenarioHeatmap(state, range) : null,
    curve: typeof view === "object" && view.kind === "curve" ? {
      min: view.min, max: view.max, metric: view.metric,
      comparisonVersion: view.comparison?.version ?? null,
      comparisonModel: view.comparison ? view.comparison.valuationModel ?? "european-bsm-v1" : null,
      points: scenarioCurve(state, view.min, view.max, view.metric),
      expiration: view.metric === "pnl" && state.legs.length ? scenarioCurve(state, view.min, view.max, view.metric, Math.min(...state.legs.map(leg => Date.parse(leg.expiry)))) : [],
      compared: view.comparison ? scenarioCurve(view.comparison, view.min, view.max, view.metric) : [],
      target: evaluateScenario(state)[view.metric],
    } : null,
  };
}
