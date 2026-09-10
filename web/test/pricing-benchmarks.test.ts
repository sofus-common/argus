import { describe, expect, it } from "vitest";
import { americanPrice } from "../src/american-price";
import { createStrategy, evaluateScenario } from "../src/options";

// Published Haug fixtures in QuantLib testValues/testGreekValues, not engine-generated expectations:
// https://github.com/lballabio/QuantLib/blob/master/test-suite/europeanoption.cpp
// Scale to the sample's K=100 using price homogeneity; preserve the reference year fraction.
function european(type: "call" | "put", strike: number, spot: number, q: number, r: number, t: number, vol: number) {
  const state = createStrategy(type === "call" ? "long-call" : "long-put");
  state.spot = state.scenarioSpot = spot * 100 / strike;
  state.rate = r; state.dividendYield = q; state.ivShift = 0;
  state.legs[0].iv = vol; state.legs[0].entryPrice = 0;
  state.valuationTimestamp = state.scenarioDate = new Date(Date.parse(state.legs[0].expiry) - t * 365 * 86400000).toISOString();
  return evaluateScenario(state);
}

describe("independent published pricing benchmarks", () => {
  it("matches dividend-paying European call and put values", () => {
    const cases = [
      ["call", 65, 60, 0, .08, .25, .30, 2.1334],
      ["put", 95, 100, .05, .10, .50, .20, 2.4648],
      ["put", 19, 19, .10, .10, .75, .28, 1.7011],
      ["call", 19, 19, .10, .10, .75, .28, 1.7011],
      ["call", 40, 42, .08, .04, .75, .35, 5.0975],
    ] as const;
    for (const [type, strike, spot, q, r, t, vol, reference] of cases) {
      const actual = european(type, strike, spot, q, r, t, vol).pnl / 100 * strike / 100;
      expect(Math.abs(actual - reference), `${type} K${strike}`).toBeLessThan(.0001);
    }
  });

  it("checks position Greek units against published per-share Greeks", () => {
    // Published Greeks are per share and per unit rate/volatility; ARGUS reports
    // 100-share contracts, theta per day, vega/rho per percentage point.
    for (const [type, delta] of [["call", .5946], ["put", -.3566]] as const) {
      expect(Math.abs(european(type, 100, 105, .1, .1, .5, .36).delta / 100 - delta)).toBeLessThan(.0001);
    }
    for (const type of ["call", "put"] as const) {
      const actual = european(type, 60, 55, 0, .1, .75, .3);
      expect(Math.abs(actual.gamma / 100 * 100 / 60 - .0278)).toBeLessThan(.0001);
      expect(Math.abs(actual.vega * 60 / 100 - 18.9358)).toBeLessThan(.0001);
    }
    expect(Math.abs(european("put", 405, 430, .05, .07, 1 / 12, .2).theta / 100 * 405 / 100 * 365 - (-31.1924))).toBeLessThan(.0001);
    expect(Math.abs(european("call", 75, 72, 0, .09, 1, .19).rho * 75 / 100 - 38.7325)).toBeLessThan(.0001);
  });

  it("matches published American put and dividend-call values at adjacent tree depths", () => {
    // QuantLib testQdEngineStandardExample, Andersen-Lake early-exercise premium.
    // https://github.com/lballabio/QuantLib/blob/master/test-suite/americanoption.cpp
    // European BSM reference 6.040035156667653 independently evaluated using
    // Python math.erf; published FP_B premium .2386596962737606 is added below.
    // American put/call symmetry swaps spot/strike and rate/yield. Use .005/share
    // absolute accuracy and refinement gates, not monotonic CRR convergence.
    const reference = 6.040035156667653 + .2386596962737606;
    const cases = [
      ["put", 95, 100, .05, .075],
      ["call", 100, 95, .075, .05],
    ] as const;
    for (const [type, strike, spot, q, r] of cases) {
      const values = [1023, 1024, 2048].map(steps => americanPrice(type, spot, strike, 1, r, q, .25, steps));
      for (const value of values) expect(Math.abs(value - reference), `${type} K${strike} S${spot}`).toBeLessThan(.005);
      expect(Math.abs(values[2] - values[1])).toBeLessThan(.005);
    }
  });

  it("tends to the exact payoff immediately before expiry and at expiry", () => {
    for (const type of ["call", "put"] as const) for (const spot of [90, 100, 110]) {
      const intrinsic = Math.max(0, (type === "call" ? 1 : -1) * (spot - 100));
      expect(americanPrice(type, spot, 100, 0, .05, .02, .2, 1024)).toBe(intrinsic);
      expect(Math.abs(americanPrice(type, spot, 100, 1 / (365 * 86400), .05, .02, .2, 1024) - intrinsic)).toBeLessThan(.002);
    }
  });
});
