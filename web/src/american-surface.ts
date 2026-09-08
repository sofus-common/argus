import { americanPrice, americanGreeks } from "./american-price";
import { effectiveIv, validateStrategy, isChartRange, type ChartRange, type StrategyState } from "./options";

export function americanScenario(state: StrategyState) {
  const errors = validateStrategy(state);
  if (errors.length) throw new Error(errors.join("; "));
  const result = { pnl: (state.stock?.shares ?? 0) * (state.scenarioSpot - (state.stock?.entryPrice ?? 0)) - (state.feeAllowance ?? 0), delta: state.stock?.shares ?? 0, gamma: 0, theta: 0, vega: 0, rho: 0 };
  for (const leg of state.legs) {
    const value = americanGreeks(leg.type, state.scenarioSpot, leg.strike, Math.max(0, Date.parse(leg.expiry) - Date.parse(state.scenarioDate)) / (365 * 86400000), state.rate, state.dividendYield, effectiveIv(state, leg), 1024);
    const scale = (leg.side === "long" ? 1 : -1) * leg.contracts * leg.multiplier;
    result.pnl += (value.price - leg.entryPrice) * scale;
    for (const key of ["delta", "gamma", "theta", "vega", "rho"] as const) result[key] += value[key] * scale;
  }
  if (!Object.values(result).every(Number.isFinite)) throw new Error("Nonfinite American scenario");
  return result;
}

export function americanSurface(state: StrategyState, range?: ChartRange) {
  if (range !== undefined && !isChartRange(range)) throw new Error("Invalid chart range");
  const errors = validateStrategy(state);
  if (errors.length) throw new Error(errors.join("; "));
  if (!state.legs.length) throw new Error("Stock-only heatmap unavailable: no option expiry horizon.");
  const start = Date.parse(state.valuationTimestamp), end = Math.min(...state.legs.map(leg => Date.parse(leg.expiry)));
  const min = range?.min ?? Math.min(state.spot * .76, state.scenarioSpot, ...state.legs.map(leg => leg.strike));
  const max = range?.max ?? Math.max(state.spot * 1.24, state.scenarioSpot, ...state.legs.map(leg => leg.strike));
  const entry = state.legs.reduce((sum, leg) => sum + (leg.side === "long" ? 1 : -1) * leg.entryPrice * leg.contracts * leg.multiplier, (state.stock?.shares ?? 0) * (state.stock?.entryPrice ?? 0));
  const points = [];
  for (let row = 0; row < 18; row++) for (let col = 0; col < 44; col++) {
    const at = Math.trunc(start + (end - start) * row / 17), spot = range && col === 43 ? max : min + (max - min) * col / 43;
    let value = (state.stock?.shares ?? 0) * spot;
    for (const leg of state.legs) value += americanPrice(leg.type, spot, leg.strike, Math.max(0, Date.parse(leg.expiry) - at) / (365 * 86400000), state.rate, state.dividendYield, effectiveIv(state, leg), 1024) * (leg.side === "long" ? 1 : -1) * leg.contracts * leg.multiplier;
    const pnl = value - entry - (state.feeAllowance ?? 0);
    if (!Number.isFinite(pnl)) throw new Error("Nonfinite American surface");
    points.push({ spot, date: new Date(at).toISOString(), pnl });
  }
  return { model: "american-crr-1024-v1" as const, sourceModel: state.valuationModel ?? "european-bsm-v1", baseVersion: state.version, points };
}
