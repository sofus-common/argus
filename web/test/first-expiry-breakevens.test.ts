import { expect, it } from "vitest";
import { createStrategy, evaluateScenario, firstExpiryBreakevens } from "../src/options";

const input = { min: 50, max: 150, spotTolerance: .02, maxEvaluations: 256 };
const pnl = (state: ReturnType<typeof createStrategy>, spot: number) => evaluateScenario({ ...state, scenarioSpot: spot, scenarioDate: new Date(Math.min(...state.legs.map(leg => Date.parse(leg.expiry)))).toISOString() }).pnl;
const includes = (result: ReturnType<typeof firstExpiryBreakevens>, spot: number) => result.evaluatedZeros.some(value => Math.abs(value - spot) < .000001) || result.candidates.some(band => band.lower <= spot && band.upper >= spot);

it("locates known terminal breakevens and retains exact sampled strike tangencies separately", () => {
  const call = createStrategy("long-call"); call.legs[0].strike = 100; call.legs[0].entryPrice = 2;
  const result = firstExpiryBreakevens(call, input);
  expect(result.status).toBe("spot-tolerance-met"); expect(includes(result, 102)).toBe(true);
  expect(result.candidates.every(band => band.upper - band.lower <= input.spotTolerance)).toBe(true);
  const tangent = createStrategy("long-straddle"); tangent.legs.forEach(leg => { leg.strike = 100; leg.entryPrice = 0; });
  const touched = firstExpiryBreakevens(tangent, input);
  expect(touched.evaluatedZeros).toContain(100);
  expect(touched.candidates.every(band => band.kind === "unresolved")).toBe(true);
  expect(touched.basis).toContain("Not certified");
});

it("retains both calendar crossings despite equal-sign domain endpoints and matches independent dense samples", () => {
  const state = createStrategy("call-calendar");
  const last = Math.max(...state.legs.map(leg => Date.parse(leg.expiry)));
  state.legs.forEach(leg => { leg.strike = 100; leg.entryPrice = 0; leg.side = Date.parse(leg.expiry) === last ? "long" : "short"; });
  state.feeAllowance = (pnl(state, 100) + Math.max(pnl(state, input.min), pnl(state, input.max))) / 2;
  const frozen = structuredClone(state);
  expect(pnl(state, input.min)).toBeLessThan(0); expect(pnl(state, input.max)).toBeLessThan(0);
  const crossings: number[] = [];
  let previous = input.min, previousPnl = pnl(state, previous);
  for (let i = 1; i <= 1000; i++) {
    const spot = input.min + i / 1000 * (input.max - input.min), value = pnl(state, spot);
    if (previousPnl * value < 0) {
      let a = previous, b = spot, left = previousPnl;
      for (let j = 0; j < 30; j++) { const middle = (a + b) / 2, midPnl = pnl(state, middle); if (midPnl * left > 0) { a = middle; left = midPnl; } else b = middle; }
      crossings.push((a + b) / 2);
    }
    previous = spot; previousPnl = value;
  }
  expect(crossings).toHaveLength(2);
  const limited = firstExpiryBreakevens(state, { ...input, maxEvaluations: 3 });
  expect(limited.status).toBe("budget-exhausted");
  expect(limited.candidates).toHaveLength(1);
  expect(limited.candidates[0].kind).toBe("unresolved");
  for (const crossing of crossings) expect(includes(limited, crossing)).toBe(true);
  const result = firstExpiryBreakevens(state, input);
  expect(result.status).toBe("spot-tolerance-met");
  for (const crossing of crossings) expect(includes(result, crossing)).toBe(true);
  expect(result.candidates.filter(band => band.kind === "sign-changing")).toHaveLength(2);
  expect(state).toEqual(frozen);
});

it("keeps a flat zero region unresolved when subdividing cannot narrow the merged candidate band", () => {
  const state = createStrategy("long-call"); state.legs[0].strike = 100; state.legs[0].entryPrice = 0;
  const result = firstExpiryBreakevens(state, { min: 0, max: 90, spotTolerance: .01, maxEvaluations: 16 });
  expect(result.status).toBe("budget-exhausted"); expect(result.evaluations).toBe(16);
  expect(result.candidates).toEqual([{ lower: 0, upper: 90, lowerPnl: 0, upperPnl: 0, kind: "unresolved" }]);
  expect(result.evaluatedZeros.length).toBe(16);
});

it("preserves model, signed stock, fees and IV assumptions while retaining budget-limited candidates", () => {
  for (const valuationModel of ["european-bsm-v1", "american-crr-1024-v1"] as const) {
    const state = { ...createStrategy("call-calendar"), valuationModel, stock: { shares: -3, entryPrice: 100 }, feeAllowance: 7.25, ivShift: .03 };
    state.expiryIvShifts = [{ expiry: state.legs[1].expiry, ivShift: .02 }];
    const frozen = structuredClone(state), result = firstExpiryBreakevens(state, { ...input, maxEvaluations: 16 });
    expect(state).toEqual(frozen); expect(result.evaluations).toBeLessThanOrEqual(16);
    for (const band of result.candidates) {
      expect(band.lowerPnl).toBeCloseTo(pnl(state, band.lower), 6);
      expect(band.upperPnl).toBeCloseTo(pnl(state, band.upper), 6);
      expect(band.kind === "sign-changing").toBe(band.lowerPnl < 0 && band.upperPnl > 0 || band.lowerPnl > 0 && band.upperPnl < 0);
    }
  }
});

it("rejects invalid limits and invalid numerical states", () => {
  const state = createStrategy("call-calendar");
  for (const patch of [{ min: -1 }, { max: 50 }, { min: NaN }, { max: Infinity }, { spotTolerance: 0 }, { spotTolerance: NaN }, { maxEvaluations: 1 }, { maxEvaluations: 1025 }, { maxEvaluations: 2.5 }]) expect(() => firstExpiryBreakevens(state, { ...input, ...patch })).toThrow();
  expect(() => firstExpiryBreakevens({ ...state, legs: [] }, input)).toThrow();
  expect(() => firstExpiryBreakevens({ ...state, feeAllowance: Infinity }, input)).toThrow();
});

it("distinguishes unrepresentable spot refinement from an exhausted evaluation budget", () => {
  const state = createStrategy("long-call"); state.legs[0].strike = 100; state.legs[0].entryPrice = 0;
  const narrow = { min: 1, max: 1 + Number.EPSILON, spotTolerance: Number.EPSILON / 2, maxEvaluations: 4 };
  expect(() => firstExpiryBreakevens(state, narrow)).toThrow("numerical spot resolution");
  const capped = firstExpiryBreakevens(state, { ...narrow, maxEvaluations: 2 });
  expect(capped.status).toBe("budget-exhausted"); expect(capped.evaluations).toBe(2);
  expect(capped.candidates).toHaveLength(1);
});
