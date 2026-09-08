import { describe, expect, it } from "vitest";
import { americanPrice, americanGreeks } from "../src/american-price";
import { createStrategy, evaluateScenario } from "../src/options";

describe("price-only American valuation tracer", () => {
  it("preserves small continuation value near the exercise boundary against refined FD Greeks", () => {
    // american-oracle.py: QuantLib 1.43 Douglas FD1600/3200 refinement, not forward theta.
    const reference = [5.0027979194986685, -.9864190118034034, .03546114453379557, -.004013990099476718, .004055979219463879, -.0024938326444345904];
    const keys = ["price", "delta", "gamma", "theta", "vega", "rho"] as const;
    const tolerances = [.0001, .001, .0003, .0002, .0002, .00002];
    for (const steps of [1023, 1024, 2047, 2048]) {
      const actual = americanGreeks("put", 95, 100, 7 / 365, .05, 0, .2, steps);
      expect(actual.price).toBeGreaterThan(5);
      keys.forEach((key, index) => expect(Math.abs(actual[key] - reference[index]), `${key} N${steps}`).toBeLessThan(tolerances[index]));
    }
  });
  it("keeps centered Greek bumps inside the domain of a valid low-volatility tree", () => {
    // QuantLib 1.43 AnalyticEuropeanEngine; no-dividend cases without early-exercise value.
    const cases = [
      ["call", .04, [3.92105608476768, 1, 0, -.010529199333176139, 0, .9607894391523231]],
      ["call", .04155, [4.069863092612798, 1, 0, -.010920266269868303, 0, .959301369073872]],
      ["put", -.04, [4.081077419238828, -1, 0, -.011406145470601524, 0, -1.040810774192388]],
      ["put", -.04155, [4.242528181255418, -1, 0, -.011866512454605911, 0, -1.0424252818125543]],
    ] as const;
    const keys = ["price", "delta", "gamma", "theta", "vega", "rho"] as const;
    for (const [type, rate, reference] of cases) for (const steps of [1023, 1024, 2047, 2048]) {
      const actual = americanGreeks(type, 100, 100, 1, rate, 0, .0013, steps);
      keys.forEach((key, index) => expect(Math.abs(actual[key] - reference[index]), `${key} r${rate} N${steps}`).toBeLessThan(.00001));
      for (const key of ["delta", "gamma", "theta", "vega", "rho"] as const) expect(americanGreeks(type, 100, 100, 1, rate, 0, .0013, steps, key)).toBe(actual[key]);
      if (steps === 1024) {
        const state = createStrategy(type === "call" ? "long-call" : "long-put");
        state.valuationModel = "american-crr-1024-v1"; state.rate = rate; state.dividendYield = 0; state.legs[0].iv = .0013;
        state.valuationTimestamp = state.scenarioDate = new Date(Date.parse(state.legs[0].expiry) - 365 * 86400000).toISOString();
        const position = evaluateScenario(state);
        expect(Math.abs(position.pnl - (reference[0] - state.legs[0].entryPrice) * 100)).toBeLessThan(.001);
        for (const key of ["delta", "gamma", "theta", "vega", "rho"] as const) expect(Math.abs(position[key] - actual[key] * 100)).toBeLessThan(.001);
      }
    }
    expect(() => americanGreeks("call", 100, 100, 1, .05, 0, .0013, 1024)).toThrow("numerical domain");
    for (const [type, rate] of [["call", .04], ["put", -.04]] as const) {
      expect(americanPrice(type, 100, 100, 1, rate, 0, .00125, 1024)).toBeGreaterThan(0);
      expect(Math.abs(americanGreeks(type, 100, 100, 1, rate, 0, .00125, 1024, "delta"))).toBeCloseTo(1, 8);
      expect(() => americanGreeks(type, 100, 100, 1, rate, 0, .00125, 1024)).toThrow("sensitivities outside numerical domain");
      for (const metric of ["vega", "rho"] as const) expect(() => americanGreeks(type, 100, 100, 1, rate, 0, .00125, 1024, metric)).toThrow("sensitivities outside numerical domain");
    }
  });
  it("returns the exact requested sensitivity without changing full-result semantics", () => {
    for (const type of ["call", "put"] as const) for (const spot of [0, 50, 100, 150]) for (const years of [0, 7 / 365, 1]) for (const rate of [-.01, .05]) {
      const args = [type, spot, 100, years, rate, .03, .25, 256] as const;
      const full = americanGreeks(...args);
      for (const key of ["delta", "gamma", "theta", "vega", "rho"] as const) expect(americanGreeks(...args, key)).toBe(full[key]);
    }
    expect(() => americanGreeks("put", 0, 100, 1, 0, .05, .25, 256, "delta")).toThrow("rho is undefined");
    for (const years of [0, 1]) expect(() => americanGreeks("put", 50, 100, years, .05, 0, .25, 256, "invalid" as "delta")).toThrow();
  });
  it("uses the exact absorbing zero-spot boundary, including delayed exercise at negative rates", () => {
    for (const rate of [-.075, 0, .05]) for (const yieldRate of [-.02, 0, .05]) {
      expect(americanPrice("call", 0, 120, 1, rate, yieldRate, .25, 1024)).toBe(0);
      expect(americanPrice("put", 0, 120, 1, rate, yieldRate, .25, 1024)).toBe(120 * Math.exp(Math.max(0, -rate)));
    }
    // QuantLib 1.43 testZeroSpot: independent endpoint and nearby positive spot.
    expect(americanPrice("put", 0, 120, 1, -.075, .05, .25, 1024)).toBeCloseTo(129.346098106155779, 10);
    expect(americanPrice("put", 1e-6, 120, 1, -.075, .05, .25, 1024)).toBeCloseTo(129.346097154926355, 8);
    const negative = americanGreeks("put", 0, 120, 1, -.075, .05, .25, 1024);
    expect(negative.delta).toBe(-Math.exp(-.05));
    expect(negative.theta).toBe(-.075 * negative.price / 365);
    expect(negative.rho).toBe(-negative.price / 100);
    expect(negative.gamma).toBe(0);
    expect(negative.vega).toBe(0);
    expect(americanGreeks("put", 0, 120, 1, .05, .05, .25, 1024)).toEqual({ price: 120, delta: -1, gamma: 0, theta: 0, vega: 0, rho: 0 });
    expect(americanGreeks("call", 0, 120, 1, 0, .05, .25, 1024)).toEqual({ price: 0, delta: 0, gamma: 0, theta: 0, vega: 0, rho: 0 });
    expect(() => americanGreeks("put", 0, 120, 1, 0, .05, .25, 1024)).toThrow("rho is undefined");
    expect(americanGreeks("put", 0, 120, 0, 0, .05, .25, 1024)).toEqual({ price: 120, delta: -1, gamma: 0, theta: 0, vega: 0, rho: 0 });
    expect(() => americanPrice("put", -1, 120, 1, .05, 0, .25, 1024)).toThrow();
  });
  it("agrees with independent finite-difference continuation-region references", () => {
    // Reproduce with american-oracle.py: QuantLib 1.43, Douglas 1600x1600, two damping steps.
    // Local theta uses the continuation PDE on FD outputs, not QuantLib's 0.99-day secant.
    const cases = [
      ["put", 100, 365, .05, .05, .25, [9.5693524363, -.4362916826, .0156495695, -.0120877338, .3808165884, -.4328506773]],
      ["put", 90, 365, .05, 0, .2, [11.4921147285, -.6832473873, .0312801679, -.0038853924, .2889736645, -.2944334013]],
      ["put", 100, 7, .05, 0, .2, [1.0629529891, -.4842300587, .1456667029, -.0730384730, .0551242271, -.0079969668]],
      ["call", 100, 365, .03, .08, .25, [7.8382796451, .4838764799, .0178424506, -.0080033837, .3707462668, .2718826993]],
      ["put", 100, 365, -.01, .02, .2, [9.5080199222, -.5096440474, .0195277703, -.0151494970, .3905544707, -.6047241430]],
    ] as const;
    const keys = ["price", "delta", "gamma", "theta", "vega", "rho"] as const;
    const tolerances = [.01, .001, .0003, .0002, .0025, .0025];
    for (const [type, spot, days, rate, yieldRate, vol, reference] of cases) for (const steps of [1023, 1024, 2047, 2048]) {
      const actual = americanGreeks(type, spot, 100, days / 365, rate, yieldRate, vol, steps);
      keys.forEach((key, index) => expect(Math.abs(actual[key] - reference[index]), `${type} S${spot} days${days} r${rate} ${key} N${steps}`).toBeLessThan(tolerances[index]));
    }
  });
  it("distinguishes local theta from QuantLib's 0.99-day forward secant", () => {
    for (const steps of [1023, 1024, 2048]) {
      const now = americanPrice("put", 100, 100, 7 / 365, .05, 0, .2, steps);
      const later = americanPrice("put", 100, 100, 6.01 / 365, .05, 0, .2, steps);
      expect(Math.abs((later - now) / .99 - (-.07603557524949854))).toBeLessThan(.0002);
    }
  });
  it("keeps OTM continuation theta within the independent tolerance across adjacent tree depths", () => {
    const reference = -.013281035926276961;
    for (const steps of [255, 256, 1023, 1024, 2047, 2048]) {
      const actual = americanGreeks("call", 90, 100, 30 / 365, .03, .08, .25, steps);
      expect(Math.abs(actual.theta - reference), `OTM theta N${steps}`).toBeLessThan(.0002);
    }
  });
  it("matches refined independent references at one day, high volatility and an OTM strike", () => {
    // QuantLib 1.43 FD800/1600 convergence checked by american-oracle.py.
    const cases = [
      ["put", 100, 1, .05, 0, .2, [.411458050126, -.493759170732, .382404103195, -.202716306528, .020871764422, -.001200735761]],
      ["call", 100, 1, .05, 0, .2, [.424486599652, .507309219201, .381026312860, -.215672833803, .020878121189, .001378259917]],
      ["put", 100, 730, .03, .08, .8, [43.368304813958, -.274915116654, .002798317999, -.024734641194, .438951638315, -1.163337092979]],
      ["call", 90, 30, .03, .08, .25, [.187389560062, .067953057719, .020381189371, -.013281035926, .033802178101, .004601147135]],
    ] as const;
    const keys = ["price", "delta", "gamma", "theta", "vega", "rho"] as const;
    const tolerances = [.01, .001, .0003, .0002, .0025, .0025];
    for (const [type, spot, days, rate, yieldRate, vol, reference] of cases) {
      const actual = americanGreeks(type, spot, 100, days / 365, rate, yieldRate, vol, 1024);
      keys.forEach((key, index) => expect(Math.abs(actual[key] - reference[index]), `${type} S${spot} days${days} ${key} N1024`).toBeLessThan(tolerances[index]));
    }
  });
  it("checks sensitivity stability across perturbation sizes in continuation", () => {
    for (const spot of [90, 100]) {
      const actual = americanGreeks("put", spot, 100, 1, .05, 0, .2, 2048);
      const price = (time: number, rate: number, vol: number) => americanPrice("put", spot, 100, time, rate, 0, vol, 2048);
      for (const bump of [.00001, .001]) {
        expect(Math.abs((price(1 - bump, .05, .2) - price(1 + bump, .05, .2)) / (2 * bump * 365) - actual.theta)).toBeLessThan(.0002);
        expect(Math.abs((price(1, .05, .2 + bump) - price(1, .05, .2 - bump)) / (2 * bump * 100) - actual.vega)).toBeLessThan(.0025);
        expect(Math.abs((price(1, .05 + bump, .2) - price(1, .05 - bump, .2)) / (2 * bump * 100) - actual.rho)).toBeLessThan(.0025);
      }
    }
  });
  it("matches analytic call sensitivities where early exercise has no value", () => {
    const state = createStrategy("long-call");
    state.rate = .05; state.dividendYield = 0; state.legs[0].iv = .2;
    state.valuationTimestamp = state.scenarioDate = new Date(Date.parse(state.legs[0].expiry) - 365 * 86400000).toISOString();
    const analytic = evaluateScenario(state);
    const tolerances = { delta: .001, gamma: .0001, theta: .0001, vega: .002, rho: .002 };
    for (const steps of [255, 256, 1023, 1024]) {
      const actual = americanGreeks("call", 100, 100, 1, .05, 0, .2, steps);
      for (const key of Object.keys(tolerances) as (keyof typeof tolerances)[]) expect(Math.abs(actual[key] - analytic[key] / 100), `${key} at ${steps}`).toBeLessThan(tolerances[key]);
    }
  });
  it("preserves intrinsic sensitivities inside exercise regions and at expiry", () => {
    const boundary = americanGreeks("put", 80.5, 100, 1, .05, 0, .2, 256);
    expect(boundary.price).toBe(19.5);
    expect(boundary.delta).toBe(-1);
    expect(boundary.gamma).toBe(0);
    for (const steps of [255, 256, 1024]) {
      const actual = americanGreeks("put", 50, 100, 1, .1, 0, .1, steps);
      expect(actual.delta).toBeCloseTo(-1, 7);
      for (const key of ["gamma", "theta", "vega", "rho"] as const) expect(actual[key]).toBeCloseTo(0, 7);
    }
    expect(americanGreeks("put", 100, 100, 0, .05, 0, .2, 256)).toEqual({ price: 0, delta: -.5, gamma: 0, theta: 0, vega: 0, rho: 0 });
  });
  it("reports four-leg 44x18 workload without relaxing the 100ms integration budget", () => {
    const state = createStrategy("iron-condor");
    const expiry = Date.parse(state.legs[0].expiry);
    state.valuationTimestamp = new Date(expiry - 365 * 86400000).toISOString();
    for (const steps of [0, 256, 1024]) for (const pass of ["cold", "repeat"]) {
      let checksum = 0;
      const start = performance.now();
      for (let row = 0; row < 18; row++) for (let col = 0; col < 44; col++) {
        const years = (18 - row) / 18, spot = 80 + col;
        if (!steps) checksum += evaluateScenario({ ...state, scenarioSpot: spot, scenarioDate: new Date(expiry - years * 365 * 86400000).toISOString() }).pnl;
        else for (const leg of state.legs) checksum += americanPrice(leg.type, spot, leg.strike, years, state.rate, state.dividendYield, leg.iv, steps) * (leg.side === "long" ? 1 : -1) * leg.contracts * leg.multiplier;
      }
      const elapsedMs = performance.now() - start;
      expect(Number.isFinite(checksum)).toBe(true);
      console.log(JSON.stringify({ model: steps ? "American price only" : "European full scenario", steps, pass, evaluations: 792, elapsedMs, withinIntegrationBudget: elapsedMs <= 100 }));
    }
  }, 30000);
  it("matches published early-exercise premiums across adjacent lattice depths", () => {
    // QuantLib testAndersenLakeHighPrecisionExample: one ACT/365 year, S=K=100.
    // https://github.com/lballabio/QuantLib/blob/master/test-suite/americanoption.cpp
    for (const [rate, premium] of [[.05, .10695268], [.075, .36711113]]) {
      const state = createStrategy("long-put");
      state.rate = rate; state.dividendYield = .05; state.legs[0].iv = .25;
      state.valuationTimestamp = state.scenarioDate = new Date(Date.parse(state.legs[0].expiry) - 365 * 86400000).toISOString();
      const european = evaluateScenario(state).pnl / 100 + state.legs[0].entryPrice;
      for (const steps of [2047, 2048]) {
        const price = americanPrice("put", 100, 100, 1, rate, .05, .25, steps);
        expect(Math.abs(price - european - premium)).toBeLessThan(.005);
      }
    }
  });
  it("preserves terminal payoff and refuses invalid probabilities rather than clamping", () => {
    expect(americanPrice("put", 90, 100, 0, .05, 0, .2, 256)).toBe(10);
    expect(americanPrice("call", 90, 100, 0, .05, 0, .2, 256)).toBe(0);
    expect(() => americanPrice("put", 90, 100, 1, 1, 0, .001, 256)).toThrow("numerical domain");
    for (const vol of [0, -1, NaN, Infinity]) expect(() => americanPrice("put", 90, 100, 1, .05, 0, vol, 256)).toThrow();
    expect(() => americanPrice("put", 90, 100, 1, .05, 0, .2, 4097)).toThrow();
  });
  it("allows early exercise without claiming assignment cashflow modeling", () => {
    expect(americanPrice("put", 50, 100, 1, .1, 0, .1, 512)).toBeCloseTo(50, 7);
    expect(americanPrice("call", 150, 100, 1, 0, .1, .1, 512)).toBeCloseTo(50, 7);
    for (const type of ["call", "put"] as const) {
      const price = americanPrice(type, 100, 100, 1, -.01, .02, .2, 512);
      expect(Number.isFinite(price)).toBe(true);
      expect(price).toBeGreaterThan(0);
    }
  });
});
