import { calculateWorkspaceValuation } from "./workspace-valuation";
import { firstExpiryRange, firstExpiryBreakevens } from "./options";
import { optimizerSensitivity } from "./optimizer-sensitivity";

self.onmessage = event => {
  const { id, state, view, range } = event.data;
  if (event.data.action === "optimizer-sensitivity") {
    try { self.postMessage({ id, result: { baseVersion: state.version, model: state.valuationModel ?? "european-bsm-v1", snapshotId: event.data.snapshot.id, sensitivity: optimizerSensitivity(state, event.data.snapshot) } }); }
    catch { self.postMessage({ id, error: "Optimizer sensitivity unavailable for these inputs." }); }
    return;
  }
  if (event.data.action === "first-expiry-breakevens") {
    try { self.postMessage({ id, result: { baseVersion: state.version, model: state.valuationModel ?? "european-bsm-v1", breakevens: firstExpiryBreakevens(state, { min: event.data.min, max: event.data.max, spotTolerance: .01, maxEvaluations: 256 }) } }); }
    catch { self.postMessage({ id, error: "First-expiry breakevens unavailable for these inputs." }); }
    return;
  }
  if (event.data.action === "first-expiry-range") {
    try { self.postMessage({ id, result: { baseVersion: state.version, model: state.valuationModel ?? "european-bsm-v1", range: firstExpiryRange(state, { min: event.data.min, max: event.data.max, tolerance: 1, maxEvaluations: 256 }) } }); }
    catch { self.postMessage({ id, error: "First-expiry range unavailable for these inputs." }); }
    return;
  }
  try { self.postMessage({ id, result: calculateWorkspaceValuation(state, view, range) }); }
  catch { self.postMessage({ id, error: "Workspace valuation unavailable for these inputs." }); }
};
