import { isChartRange, type ChartRange, type StrategyState } from "./options";
import type { americanSurface } from "./american-surface";

export function requestAmericanSurface(state: StrategyState, signal: AbortSignal, range?: ChartRange): Promise<ReturnType<typeof americanSurface>> {
  if (signal.aborted) return Promise.reject(new DOMException("Calculation cancelled", "AbortError"));
  if (range !== undefined && !isChartRange(range)) return Promise.reject(new Error("Invalid chart range"));
  const sourceVersion = state.version;
  const min = range?.min ?? Math.min(state.spot * .76, state.scenarioSpot, ...state.legs.map(leg => leg.strike));
  const max = range?.max ?? Math.max(state.spot * 1.24, state.scenarioSpot, ...state.legs.map(leg => leg.strike));
  const start = Date.parse(state.valuationTimestamp), end = Math.min(...state.legs.map(leg => Date.parse(leg.expiry)));
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./american-surface.worker.ts", import.meta.url), { type: "module" });
    const cleanup = () => { worker.terminate(); worker.onmessage = null; worker.onerror = null; signal.removeEventListener("abort", abort); };
    const abort = () => { cleanup(); reject(new DOMException("Calculation cancelled", "AbortError")); };
    signal.addEventListener("abort", abort, { once: true });
    worker.onmessage = event => {
      if (signal.aborted) { abort(); return; }
      cleanup();
      const result = event.data?.result;
      if (event.data?.error) reject(new Error("American surface unavailable for these inputs."));
      else if (result?.model !== "american-crr-1024-v1" || result.sourceModel !== "european-bsm-v1" || result.baseVersion !== sourceVersion || !Array.isArray(result.points) || result.points.length !== 792 || !result.points.every((point: { spot: number; date: string; pnl: number } | null, index: number) => point && Number.isFinite(point.spot) && point.spot > 0 && Number.isFinite(point.pnl)
        && point.spot === (range && index % 44 === 43 ? max : min + (max - min) * (index % 44) / 43) && point.date === new Date(Math.trunc(start + (end - start) * Math.floor(index / 44) / 17)).toISOString())) reject(new Error("Invalid American surface result"));
      else resolve(result);
    };
    worker.onerror = () => { cleanup(); reject(new Error("American calculation worker failed.")); };
    try { worker.postMessage({ state, range }); }
    catch (error) { cleanup(); reject(error); }
  });
}
