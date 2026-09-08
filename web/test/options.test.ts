import { describe, expect, it } from "vitest";
import { americanGreeks, americanPrice } from "../src/american-price";

import {
  TEMPLATES,
  calculateStrategy,
  firstExpiryRange,
  pnlDisplayBasis,
  expirationProbability,
  expirationDistribution,
  scenarioTable,
  scenarioSpotAttribution,
  evaluateScenario,
  scenarioFacts,
  createStrategy,
  createMarketStrategy,
  payoffSeries,
  scenarioSeries,
  scenarioCurve,
  scenarioHeatmap,
  sampleContractId,
  translateStrikes,
  marketLeg,
  validateMarketStrategy,
  type MarketSnapshot,
  validateStrategy,
  effectiveIv,
  pruneExpiryIvShifts,
  type OptionLeg,
  type StrategyState,
  type TemplateId,
} from "../src/options";

const IDS = TEMPLATES.map((template) => template.id);
describe('inverse template families', () => {
  const pairs = [['inverse-iron-butterfly', 'iron-butterfly'], ['inverse-iron-condor', 'iron-condor'], ['short-call-butterfly', 'call-butterfly'], ['short-put-butterfly', 'put-butterfly']] as const;
  it.each(pairs)('reverses %s without mutating its base', (inverse, base) => {
    const original = createStrategy(base), before = structuredClone(original);
    const reversed = createStrategy(inverse as TemplateId);
    expect(reversed.id).toBe(inverse);
    reversed.legs.forEach((leg, index) => expect({ ...leg, id: original.legs[index].id }).toEqual({ ...original.legs[index], side: original.legs[index].side === 'long' ? 'short' : 'long' }));
    const metrics = calculateStrategy(reversed), baseMetrics = calculateStrategy(original);
    expect(metrics.maxProfit).toBe(baseMetrics.maxLoss);
    expect(metrics.maxLoss).toBe(baseMetrics.maxProfit);
    for (const spot of [0.01, 94, 95, 97, 100, 103, 105, 106, 200]) {
      expect(evaluateScenario({ ...reversed, scenarioDate: reversed.legs[0].expiry, scenarioSpot: spot }).pnl).toBeCloseTo(-evaluateScenario({ ...original, scenarioDate: original.legs[0].expiry, scenarioSpot: spot }).pnl, 8);
    }
    reversed.legs[0].contracts = 9;
    expect(original).toEqual(before);
    expect(createStrategy(base)).toEqual(before);
  });
  it.each(pairs)('reprices %s on the opposite quote side and fails closed on missing grids', (inverse, base) => {
    const sample = createStrategy(base), expiry = sample.legs[0].expiry;
    const snapshot: MarketSnapshot = { id: 'inverse-test', underlying: 'SPY', source: 'Tastytrade', spot: 100, retrievedAt: sample.valuationTimestamp, spotAsOf: sample.valuationTimestamp, availableExpiries: [expiry], contracts: [90, 95, 100, 105, 110].flatMap(strike => (['call', 'put'] as const).map(type => ({ contractId: sampleContractId(type, strike, expiry).replace('SPY', 'SPY   '), type, strike, expiry, multiplier: 100 as const, bid: 1, ask: 2, iv: .22, quoteAsOf: sample.valuationTimestamp }))) };
    const before = structuredClone(snapshot);
    for (const basis of ['mid', 'natural'] as const) {
      const original = createMarketStrategy(base, snapshot, basis), reversed = createMarketStrategy(inverse as TemplateId, snapshot, basis);
      expect(validateMarketStrategy(reversed, snapshot)).toEqual([]);
      reversed.legs.forEach((leg, index) => {
        expect(leg.contractId).toBe(original.legs[index].contractId);
        expect(leg.contracts).toBe(original.legs[index].contracts);
        expect(leg.side).not.toBe(original.legs[index].side);
        expect(leg.entryPrice).toBe(basis === 'mid' ? 1.5 : leg.side === 'long' ? 2 : 1);
      });
    }
    expect(snapshot).toEqual(before);
    snapshot.contracts = snapshot.contracts.filter(contract => [90, 95, 110].includes(contract.strike));
    expect(() => createMarketStrategy(inverse as TemplateId, snapshot)).toThrow('unavailable');
    snapshot.contracts = snapshot.contracts.filter(contract => contract.type === 'call' && contract.strike === 90);
    expect(() => createMarketStrategy(inverse as TemplateId, snapshot)).toThrow('unavailable');
  });
});
describe('whole-structure strike translation', () => {
  function quoted() {
    const state = createStrategy('call-diagonal');
    const snapshot: MarketSnapshot = {
      id: 'translate-test', underlying: 'SPY', source: 'Tastytrade', spot: state.spot,
      retrievedAt: state.valuationTimestamp, spotAsOf: state.valuationTimestamp,
      availableExpiries: state.legs.map(leg => leg.expiry),
      contracts: state.legs.flatMap(leg => [0, .125, 1.375, 3].map(offset => {
        const strike = leg.strike + offset;
        return { contractId: sampleContractId(leg.type, strike, leg.expiry).replace('SPY', 'SPY   '), type: leg.type, strike, expiry: leg.expiry, multiplier: 100 as const, bid: 1 + offset, ask: 2 + offset, iv: .22 + offset / 100, quoteAsOf: state.valuationTimestamp };
      })),
    };
    state.pricing = { mode: 'market', snapshotId: snapshot.id, basis: 'natural' };
    state.legs = state.legs.map(leg => marketLeg(snapshot.contracts.find(c => c.strike === leg.strike && c.expiry === leg.expiry)!, leg.side, leg.contracts, leg.id, 'natural'));
    return { state, snapshot };
  }
  it.each(['call-butterfly', 'iron-condor', 'call-diagonal', 'collar'] as const)('preserves every field except sample contract identity for %s', template => {
    const state = createStrategy(template);
    state.feeAllowance = 9; state.ivShift = .03;
    state.expiryIvShifts = [{ expiry: state.legs[0].expiry, ivShift: .02 }];
    const before = structuredClone(state), anchor = state.legs[0];
    const moved = translateStrikes(state, anchor.id, anchor.strike + 2.3);
    expect(moved).toEqual({ ...before, legs: before.legs.map(leg => ({ ...leg, strike: leg.strike + 2, contractId: sampleContractId(leg.type, leg.strike + 2, leg.expiry) })) });
    expect(state).toEqual(before);
    expect(translateStrikes(state, anchor.id, anchor.strike)).toBe(state);
    const edge = translateStrikes(state, anchor.id, 1000);
    expect(Math.max(...edge.legs.map(leg => leg.strike))).toBe(120);
    expect(translateStrikes(edge, anchor.id, edge.legs[0].strike, undefined, 1)).toBe(edge);
    expect(translateStrikes(edge, anchor.id, edge.legs[0].strike, undefined, -1).legs[0].strike).toBe(edge.legs[0].strike - 1);
  });
  it('intersects irregular quoted grids and reprices all legs atomically', () => {
    const { state, snapshot } = quoted();
    state.legs[0].contracts = 2;
    snapshot.contracts = snapshot.contracts.filter(c => !(c.expiry === state.legs[1].expiry && c.strike === state.legs[1].strike + .125));
    const before = structuredClone({ state, snapshot });
    const moved = translateStrikes(state, state.legs[0].id, state.legs[0].strike + .125, snapshot, 1);
    expect(moved.legs.map(leg => leg.strike)).toEqual(state.legs.map(leg => leg.strike + 1.375));
    expect(moved.legs.map(leg => leg.entryPrice)).toEqual([2.375, 3.375]);
    expect(moved.legs[0].contracts).toBe(2);
    expect(moved.version).toBe(state.version);
    expect(validateMarketStrategy(moved, snapshot)).toEqual([]);
    expect(translateStrikes(state, state.legs[0].id, state.legs[0].strike + 1, snapshot)).toEqual(moved);
    expect({ state, snapshot }).toEqual(before);
  });
  it('cannot fabricate missing contracts or move held entry costs', () => {
    const { state, snapshot } = quoted();
    const onlyCurrent = { ...snapshot, contracts: snapshot.contracts.filter(c => state.legs.some(leg => leg.contractId === c.contractId)) };
    expect(translateStrikes(state, state.legs[0].id, 120, onlyCurrent)).toBe(state);
    state.pricing!.entryMode = 'fixed'; state.legs[0].entryPrice = 7;
    const before = structuredClone(state);
    expect(translateStrikes(state, state.legs[0].id, state.legs[0].strike, snapshot)).toBe(state);
    expect(() => translateStrikes(state, state.legs[0].id, 120, snapshot)).toThrow(/held|fixed/i);
    expect(state).toEqual(before);
  });
  it('rejects mismatched snapshots, invalid anchors and invalid input without mutation', () => {
    const { state, snapshot } = quoted();
    expect(() => translateStrikes(state, state.legs[0].id, 105)).toThrow(/snapshot/i);
    expect(() => translateStrikes(state, state.legs[0].id, 105, { ...snapshot, id: 'other' })).toThrow(/snapshot/i);
    expect(() => translateStrikes(state, 'missing', 105, snapshot)).toThrow(/anchor/i);
    expect(() => translateStrikes(state, state.legs[0].id, NaN, snapshot)).toThrow();
    const malformed = structuredClone(snapshot);
    malformed.contracts.find(c => c.strike === state.legs[0].strike + 3)!.contractId = 'fabricated';
    expect(() => translateStrikes(state, state.legs[0].id, 120, malformed)).toThrow();
  });
});
it('encloses finite-domain extrema at strike kinks without replacing exact metrics', () => {
  const state = { ...createStrategy('bull-call'), stock: { shares: -37, entryPrice: 91 }, feeAllowance: 11 };
  state.legs[0].contracts = 2;
  const before = structuredClone(state);
  const result = firstExpiryRange(state, { min: 0, max: 200, tolerance: .01, maxEvaluations: 16 });
  const oracle = payoffSeries(state, 0, 200, 200);
  expect(result.status).toBe('tolerance-met');
  expect(result.minimum.lower).toBeCloseTo(Math.min(...oracle.map(p => p.pnl)), 6);
  expect(result.maximum.upper).toBeCloseTo(Math.max(...oracle.map(p => p.pnl)), 6);
  expect(result.minimum.upper - result.minimum.lower).toBeLessThanOrEqual(.01);
  expect(result.maximum.upper - result.maximum.lower).toBeLessThanOrEqual(.01);
  expect(result.evaluations).toBe(4);
  expect(state).toEqual(before);
  expect(result.basis).toContain('pricing approximation and floating-point roundoff');
});
it('retains unresolved signed mixed-expiry bounds and converges under subdivision', () => {
  const state = { ...createStrategy('call-calendar'), stock: { shares: -37, entryPrice: 91 }, feeAllowance: 11 };
  state.legs[1].contracts = 2;
  const input = { min: 80, max: 120, tolerance: .1, maxEvaluations: 3 };
  const coarse = firstExpiryRange(state, input);
  expect(coarse.status).toBe('budget-exhausted');
  expect(coarse.evaluations).toBe(3);
  const fine = firstExpiryRange(state, { ...input, maxEvaluations: 256 });
  expect(fine.status).toBe('tolerance-met');
  expect(fine.minimum.lower).toBeGreaterThanOrEqual(coarse.minimum.lower - 1e-8);
  expect(fine.maximum.upper).toBeLessThanOrEqual(coarse.maximum.upper + 1e-8);
  for (const point of payoffSeries(state, 80, 120, 400)) {
    expect(point.pnl).toBeGreaterThanOrEqual(fine.minimum.lower - .011);
    expect(point.pnl).toBeLessThanOrEqual(fine.maximum.upper + .011);
  }
  const reversed = { ...state, stock: { shares: 37, entryPrice: 91 }, legs: state.legs.map(leg => ({ ...leg, side: leg.side === 'long' ? 'short' as const : 'long' as const })) };
  const reverse = firstExpiryRange(reversed, input);
  expect(reverse.minimum.lower).toBeCloseTo(-coarse.maximum.upper - 22, 7);
  expect(reverse.maximum.upper).toBeCloseTo(-coarse.minimum.lower - 22, 7);
  expect(fine.minimum.at.pnl).toBe(fine.minimum.upper);
  expect(fine.maximum.at.pnl).toBe(fine.maximum.lower);
});
it.each(['european-bsm-v1', 'american-crr-1024-v1'] as const)('bounds first-expiry model work for %s', valuationModel => {
    const state = { ...createStrategy('put-calendar'), valuationModel };
    const result = firstExpiryRange(state, { min: 80, max: 120, tolerance: .01, maxEvaluations: 16 });
    expect(result.evaluations).toBeLessThanOrEqual(16);
    expect(result.minimum.lower).toBeLessThanOrEqual(result.minimum.upper);
    expect(result.maximum.lower).toBeLessThanOrEqual(result.maximum.upper);
    for (const point of payoffSeries(state, 80, 120, 16)) {
      expect(point.pnl).toBeGreaterThanOrEqual(result.minimum.lower - .011);
      expect(point.pnl).toBeLessThanOrEqual(result.maximum.upper + .011);
    }
}, 30_000);
it.each(['european-bsm-v1', 'american-crr-1024-v1'] as const)('closes ordinary calendar search gaps for %s', valuationModel => {
  const state = { ...createStrategy('call-calendar'), valuationModel };
  const result = firstExpiryRange(state, { min: 50, max: 150, tolerance: 1, maxEvaluations: 256 });
  expect(result.status).toBe('tolerance-met');
  expect(result.minimum.upper - result.minimum.lower).toBeLessThanOrEqual(1);
  expect(result.maximum.upper - result.maximum.lower).toBeLessThanOrEqual(1);
  expect(result.evaluations).toBeLessThanOrEqual(256);
  for (const point of payoffSeries(state, 50, 150, 100)) {
    expect(point.pnl).toBeGreaterThanOrEqual(result.minimum.lower - .011);
    expect(point.pnl).toBeLessThanOrEqual(result.maximum.upper + .011);
  }
}, 30_000);
it('rejects invalid range requests and unsafe quantities', () => {
  const state = createStrategy('call-calendar');
  const input = { min: 80, max: 120, tolerance: .01, maxEvaluations: 16 };
  for (const invalid of [{ min: -1 }, { max: 80 }, { max: Infinity }, { tolerance: 0 }, { tolerance: NaN }, { maxEvaluations: 2 }, { maxEvaluations: 1025 }, { maxEvaluations: 3.5 }]) expect(() => firstExpiryRange(state, { ...input, ...invalid })).toThrow();
  state.legs[0].contracts = 1e15;
  expect(() => firstExpiryRange(state, input)).toThrow();
});
it("distinguishes European carry tails from American exercise tails at first expiry", () => {
  const calendar = createStrategy("call-calendar");
  calendar.rate = .05; calendar.dividendYield = .08; calendar.feeAllowance = 7;
  const before = structuredClone(calendar);
  const years = 7 / 365;
  const entry = calendar.legs.reduce((sum, leg) => sum + (leg.side === "long" ? 1 : -1) * leg.contracts * 100 * leg.entryPrice, 0) + 7;
  const european = calculateStrategy(calendar).conditionalTail!;
  expect(european).toMatchObject({ date: calendar.legs[0].expiry, outcome: "loss-unbounded", zeroSpotPnl: -entry });
  expect(european.slope).toBeCloseTo(100 * Math.expm1(-.08 * years), 12);
  expect(european.intercept).toBeCloseTo(10000 * -Math.expm1(-.05 * years) - entry, 8);
  for (const valuationModel of ["european-bsm-v1", "american-crr-1024-v1"] as const) {
    const state = { ...calendar, valuationModel };
    const facts = calculateStrategy(state).conditionalTail!;
    for (const spot of [1000, 2000]) expect(payoffSeries(state, spot, spot + 1, 1)[0].pnl).toBeCloseTo(facts.slope! * spot + facts.intercept!, 5);
    if (valuationModel === "american-crr-1024-v1") expect(facts).toMatchObject({ slope: 0, intercept: -entry, outcome: "finite-limit" });
    expect(calculateStrategy(state).maxLoss).toBeNull();
  }
  expect(calendar).toEqual(before);
  expect(calculateStrategy(createStrategy("bull-call")).conditionalTail).toBeUndefined();
});
it("retains signed quantities, stock basis, fees and carry edge cases in conditional tails", () => {
  for (const valuationModel of ["european-bsm-v1", "american-crr-1024-v1"] as const) {
    for (const dividendYield of [-.04, 0, .08]) for (const rate of [-.03, .05]) {
      const state = { ...createStrategy("call-diagonal"), valuationModel, dividendYield, rate, stock: { shares: -37, entryPrice: 91 }, feeAllowance: 11 };
      state.legs[1].contracts = 2;
      const facts = calculateStrategy(state).conditionalTail!;
      expect(facts.outcome).toBe('profit-unbounded');
      for (const spot of [1000, 2000]) expect(payoffSeries(state, spot, spot + 1, 1)[0].pnl).toBeCloseTo(facts.slope! * spot + facts.intercept!, 5);
      const reversed = { ...state, stock: { shares: 37, entryPrice: 91 }, legs: state.legs.map(leg => ({ ...leg, side: leg.side === 'long' ? 'short' as const : 'long' as const })) };
      const reverse = calculateStrategy(reversed).conditionalTail!;
      expect(reverse.outcome).toBe('loss-unbounded');
      expect(reverse.slope).toBe(-facts.slope!);
      expect(reverse.intercept).toBeCloseTo(-facts.intercept! - 22, 7);
      const put = { ...createStrategy('put-calendar'), valuationModel, rate, dividendYield };
      const putFacts = calculateStrategy(put).conditionalTail!;
      const entry = put.legs.reduce((sum, leg) => sum + (leg.side === 'long' ? 1 : -1) * leg.entryPrice * 100, 0);
      const expectedZero = 10000 * Math.expm1((valuationModel === 'american-crr-1024-v1' ? Math.max(0, -rate) : -rate) * 7 / 365) - entry;
      expect(putFacts.zeroSpotPnl).toBeCloseTo(expectedZero, 7);
      expect(putFacts).toMatchObject({ slope: 0, intercept: -entry, outcome: 'finite-limit' });
    }
  }
  const tinyYield = { ...createStrategy('call-calendar'), dividendYield: 1e-18 };
  expect(calculateStrategy(tinyYield).conditionalTail).toMatchObject({ outcome: 'loss-unbounded' });
  expect(calculateStrategy(tinyYield).conditionalTail!.slope).toBeLessThan(0);
  const ambiguous = { ...createStrategy('call-calendar'), dividendYield: -Math.log1p(.01) / (7 / 365), stock: { shares: 1, entryPrice: 100 } };
  ambiguous.legs = ambiguous.legs.map(leg => ({ ...leg, side: leg.side === 'long' ? 'short' : 'long' }));
  expect(calculateStrategy(ambiguous).conditionalTail!.outcome).toBe('numerically-unresolved');
  const oversized = { ...createStrategy('call-calendar'), dividendYield: 0, stock: { shares: -1, entryPrice: 100 } };
  oversized.legs = oversized.legs.flatMap(leg => [{ ...leg, contracts: 1e15 }, { ...leg, contracts: 1e15, id: `${leg.id}-offset`, strike: 105, contractId: sampleContractId('call', 105, leg.expiry), side: leg.side === 'long' ? 'short' as const : 'long' as const }]);
  expect(validateStrategy(oversized)).toEqual([]);
  expect(calculateStrategy(oversized).conditionalTail).toMatchObject({ outcome: 'numerically-unresolved', slope: null, intercept: null, zeroSpotPnl: null });
  const oversizedPuts = createStrategy('put-calendar');
  oversizedPuts.legs.forEach(leg => { leg.contracts = 1e15; });
  expect(calculateStrategy(oversizedPuts).conditionalTail).toMatchObject({ outcome: 'numerically-unresolved', slope: null, intercept: null, zeroSpotPnl: null });
}, 30000);
it("describes endpoint valuation without inventing historical-path or assignment simulation", () => {
  for (const valuationModel of ["european-bsm-v1", "american-crr-1024-v1"] as const) {
    const initial = { ...createStrategy("call-calendar"), valuationModel, feeAllowance: 7 };
    const final = { ...initial, scenarioSpot: 103 };
    const detour = { ...initial, scenarioSpot: 90, ivShift: .05 };
    evaluateScenario(detour);
    const returned = { ...detour, scenarioSpot: final.scenarioSpot, ivShift: final.ivShift };
    expect(evaluateScenario(returned)).toEqual(evaluateScenario(final));
    const facts = scenarioFacts(final);
    expect(facts.basis).toContain("no historical price-path input");
    expect(facts.basis).toContain("effective IV, rate and yield");
    if (valuationModel === "american-crr-1024-v1") expect(facts.basis).toContain("does not model assignment");
  }
});
it("derives signed value and exact positive risk display bases without changing canonical P/L", () => {
  for (const id of ["long-call", "short-call", "covered-call"] as TemplateId[]) {
    const state = createStrategy(id); state.feeAllowance = 7;
    const before = structuredClone(state), pnl = evaluateScenario(state).pnl;
    const entry = state.legs.reduce((sum, leg) => sum + (leg.side === "long" ? 1 : -1) * leg.entryPrice * leg.contracts * leg.multiplier, (state.stock?.shares ?? 0) * (state.stock?.entryPrice ?? 0));
    expect(pnlDisplayBasis(state, "pnl")).toEqual({ label: "P/L", unit: "USD", scale: 1, offset: 0, denominator: null });
    expect(pnlDisplayBasis(state, "position-value")).toEqual({ label: "Position value", unit: "USD", scale: 1, offset: entry + 7, denominator: null });
    expect(pnl + pnlDisplayBasis(state, "position-value")!.offset).toBeCloseTo(scenarioFacts(state).valuation.signedModelValue, 4);
    const loss = calculateStrategy(state).maxLoss;
    expect(pnlDisplayBasis(state, "risk-percent")).toEqual(loss === null ? null : { label: "P/L / max loss", unit: "%", scale: 100 / loss, offset: 0, denominator: loss });
    expect(state).toEqual(before);
  }
  expect(pnlDisplayBasis(createStrategy("call-calendar"), "risk-percent")).toBeNull();
  const free = createStrategy("long-call"); free.legs[0].entryPrice = 0;
  expect(pnlDisplayBasis(free, "risk-percent")).toBeNull();
  const credit = createStrategy("short-call"); credit.stock = { shares: -10, entryPrice: 90 }; credit.feeAllowance = 7;
  expect(pnlDisplayBasis(credit, "position-value")!.offset).toBe(-credit.legs[0].entryPrice * 100 - 900 + 7);
  expect(evaluateScenario(credit).pnl + pnlDisplayBasis(credit, "position-value")!.offset).toBeCloseTo(scenarioFacts(credit).valuation.signedModelValue, 4);
});
it("reconciles a held American put calendar against independent FD aggregate references", () => {
  const state = createStrategy("put-calendar");
  state.valuationModel = "american-crr-1024-v1";
  state.valuationTimestamp = state.scenarioDate = "2026-09-05T20:00:00.000Z";
  state.rate = .05; state.dividendYield = 0; state.ivShift = .01;
  state.stock = { shares: -83, entryPrice: 91.37 }; state.feeAllowance = 12.37;
  state.pricing = { mode: "market", snapshotId: "synthetic-fd-oracle", basis: "mid", entryMode: "fixed" };
  state.legs = state.legs.map((leg, index) => ({ ...leg,
    expiry: index ? "2026-09-12T20:00:00.000Z" : "2026-09-06T20:00:00.000Z",
    contractId: index ? "SPY   260912P00100000" : "SPY   260906P00100000",
    contracts: index ? 2 : 1, entryPrice: index ? 3.56 : 1.23, iv: index ? .22 : .17,
  }));
  state.expiryIvShifts = state.legs.map((leg, index) => ({ expiry: leg.expiry, ivShift: index ? -.03 : .02 }));
  const before = structuredClone(state);
  // QuantLib 1.43 FD1600 references in american-oracle.py: ATM puts, one/seven days, IV .2.
  // Independent signed aggregation: -100 front +200 back; stock contributes only P/L and delta.
  const reference = { pnl: -1146.2152071926, delta: -130.4700946668, gamma: -9.1070697395, theta: 5.6639360528, vega: 8.9376689778, rho: -1.4793197839 };
  // Conservative absolute bounds: 300 share-equivalents times each existing per-option FD tolerance.
  const bounds = { pnl: 3, delta: .3, gamma: .09, theta: .06, vega: .75, rho: .75 };
  expect(validateStrategy(state)).toEqual([]);
  const scenario = evaluateScenario(state), metrics = calculateStrategy(state), facts = scenarioFacts(state);
  for (const key of Object.keys(reference) as (keyof typeof reference)[]) {
    expect(Math.abs(scenario[key] - reference[key]), key).toBeLessThan(bounds[key]);
    expect(Math.sign(scenario[key]), `${key} sign`).toBe(Math.sign(reference[key]));
    if (key !== "pnl") {
      expect(metrics[key]).toBe(scenario[key]);
      const factTotal = facts.legs.reduce((sum, leg) => sum + leg.greeks[key], key === "delta" ? -83 : 0);
      expect(Math.abs(factTotal - reference[key]), `${key} facts`).toBeLessThan(bounds[key]);
    }
  }
  expect(metrics.scenarioPnl).toBe(scenario.pnl);
  expect(facts.valuation.modelPnl).toBe(scenario.pnl);
  expect(state).toEqual(before);
}, 30000);

it("retains sampled extrema coordinates without promoting them to exact bounds", () => {
  const state = createStrategy("call-calendar");
  state.spot = 100.13;
  const points = payoffSeries(state, 50, 150.195, 200);
  const low = points.reduce((a, b) => b.pnl < a.pnl ? b : a);
  const high = points.reduce((a, b) => b.pnl > a.pnl ? b : a);
  const metrics = calculateStrategy(state);
  expect(metrics.sampledRange).toEqual({ kind: "sampled-model-range", date: state.legs.map(leg => leg.expiry).sort()[0], spotMin: 50, spotMax: 150.195, pointCount: 201, low, high });
  expect(high.spot).not.toBe(100);
  expect(metrics.modeledLow).toBe(low.pnl);
  expect(metrics.modeledHigh).toBe(high.pnl);
  expect(metrics.maxLoss).toBeNull();
  expect(metrics.maxProfit).toBeNull();
});

it("keeps expiry IV assumptions separate and reprices front and back independently", () => {
  const base = createStrategy("call-calendar");
  expect(evaluateScenario({ ...base, expiryIvShifts: [] })).toEqual(evaluateScenario(base));
  const state = { ...base, ivShift: .01, expiryIvShifts: base.legs.map((leg, index) => ({ expiry: leg.expiry, ivShift: index ? -.03 : .05 })) };
  const before = structuredClone(state);
  const materialized = { ...state, expiryIvShifts: [], ivShift: 0, legs: state.legs.map(leg => ({ ...leg, iv: effectiveIv(state, leg) })) };
  expect(validateStrategy(state)).toEqual([]);
  expect(evaluateScenario(state)).toEqual(evaluateScenario(materialized));
  expect(scenarioSeries(state, 90, 110, 20)).toEqual(scenarioSeries(materialized, 90, 110, 20));
  expect(state).toEqual(before);
  expect(pruneExpiryIvShifts(state)).toBe(state);
  expect(pruneExpiryIvShifts({ ...state, legs: [state.legs[1]] }).expiryIvShifts).toEqual([state.expiryIvShifts[1]]);
  const single = { ...state, legs: [state.legs[1]], expiryIvShifts: [state.expiryIvShifts[1]] };
  expect(expirationProbability(single).volatility).toBe(effectiveIv(single, single.legs[0]));
  for (const expiryIvShifts of [null, {}, [{ expiry: state.legs[0].expiry, ivShift: .1, forged: 1 }], [{ expiry: "2027-01-01T20:00:00.000Z", ivShift: .1 }], [state.expiryIvShifts[0], state.expiryIvShifts[0]], [{ expiry: state.legs[0].expiry, ivShift: -1 }], [{ expiry: state.legs[0].expiry, ivShift: Infinity }], [{ expiry: state.legs[0].expiry, ivShift: 11 }]]) {
    expect(validateStrategy({ ...base, expiryIvShifts } as StrategyState).length).toBeGreaterThan(0);
  }
});
it("routes canonical American prices and sensitivities with held stock, costs and shifted IV", () => {
  const state = createStrategy("long-put");
  state.valuationModel = "american-crr-1024-v1";
  state.stock = { shares: -83, entryPrice: 91.37 };
  state.legs[0].side = "short";
  state.legs[0].contracts = 2;
  state.feeAllowance = 12.37;
  state.ivShift = .037;
  state.expiryIvShifts = [{ expiry: state.legs[0].expiry, ivShift: .013 }];
  const before = structuredClone(state), leg = state.legs[0];
  const years = (Date.parse(leg.expiry) - Date.parse(state.scenarioDate)) / (365 * 86400000);
  const priced = americanGreeks(leg.type, state.scenarioSpot, leg.strike, years, state.rate, state.dividendYield, effectiveIv(state, leg), 1024);
  expect(validateStrategy(state)).toEqual([]);
  const metrics = calculateStrategy(state), scenario = evaluateScenario(state), facts = scenarioFacts(state);
  expect(scenario.pnl).toBeCloseTo(-83 * (state.scenarioSpot - 91.37) - 200 * (priced.price - leg.entryPrice) - 12.37, 7);
  for (const metric of ["delta", "gamma", "theta", "vega", "rho"] as const) {
    expect(scenario[metric]).toBeCloseTo(-200 * priced[metric] + (metric === "delta" ? -83 : 0), 7);
    expect(metrics[metric]).toBe(scenario[metric]);
    expect(facts.legs[0].greeks[metric]).toBeCloseTo(-200 * priced[metric], 7);
    const curve = scenarioCurve(state, 90, 110, metric);
    expect(curve.find(point => point.spot === state.scenarioSpot)?.value).toBe(scenario[metric]);
    expect(curve[0].value).toBeCloseTo(-200 * americanGreeks(leg.type, 90, leg.strike, years, state.rate, state.dividendYield, effectiveIv(state, leg), 1024, metric) + (metric === "delta" ? -83 : 0), 7);
  }
  const point = scenarioHeatmap(state)[44];
  const t = (Date.parse(leg.expiry) - Date.parse(point.date)) / (365 * 86400000);
  expect(point.pnl).toBeCloseTo(-83 * (point.spot - 91.37) - 200 * (americanPrice(leg.type, point.spot, leg.strike, t, state.rate, state.dividendYield, effectiveIv(state, leg), 1024) - leg.entryPrice) - 12.37, 7);
  expect(facts.valuationModel).toBe("american-crr-1024-v1");
  expect(facts.basis).toContain("American");
  expect(state).toEqual(before);
}, 30000);

it("keeps American zero-spot prices finite but rejects undefined zero-rate put sensitivities without fallback", () => {
  const state = createStrategy("long-put");
  state.valuationModel = "american-crr-1024-v1";
  state.rate = 0;
  const at = Date.parse(state.scenarioDate);
  expect(payoffSeries(state, 0, 100, 1, at)[0].pnl).toBe(9770);
  expect(() => scenarioSeries(state, 0, 100, 1, at)).toThrow("rho is undefined");
  expect(() => scenarioCurve(state, 0, 100, "rho")).toThrow("rho is undefined");
  state.legs[0].iv = .000001;
  state.rate = .2;
  expect(() => evaluateScenario(state)).toThrow("outside numerical domain");
});
it("keeps legacy valuation identity stable and rejects unknown models", () => {
  const explicit = createStrategy("bull-call"), legacy = structuredClone(explicit);
  delete legacy.valuationModel;
  expect(explicit.valuationModel).toBe("european-bsm-v1");
  expect(calculateStrategy(legacy)).toEqual(calculateStrategy(explicit));
  expect(scenarioFacts(legacy)).toEqual(scenarioFacts(explicit));
  expect(scenarioFacts(legacy).valuationModel).toBe("european-bsm-v1");
  for (const valuationModel of [null, {}, "american-crr-v1", "european-bsm-v2", ""]) {
    const invalid = { ...legacy, valuationModel } as unknown as StrategyState;
    expect(validateStrategy(invalid)).toContain("unsupported valuation model");
    expect(() => calculateStrategy(invalid)).toThrow("unsupported valuation model");
  }
});
it("constructs directional diagonals while keeping first-expiry bounds unavailable", () => {
  for (const id of ["call-diagonal", "put-diagonal"] as TemplateId[]) {
    const state = createStrategy(id), metrics = calculateStrategy(state);
    expect(state.legs.map(leg => leg.side)).toEqual(["short", "long"]);
    expect(state.legs[0].expiry < state.legs[1].expiry).toBe(true);
    expect(state.legs[0].strike > state.legs[1].strike).toBe(id === "call-diagonal");
    expect(metrics.mode).toBe("first-expiry");
    expect(metrics.maxProfit).toBeNull();
    expect(metrics.maxLoss).toBeNull();
    expect(expirationProbability(state).probability).toBeNull();
  }
});
it("constructs equal-wing 1:2:1 butterflies with exact terminal bounds", () => {
  for (const id of ["call-butterfly", "put-butterfly"] as TemplateId[]) {
    const state = createStrategy(id), metrics = calculateStrategy(state);
    expect(state.legs.map(leg => [leg.side, leg.contracts, leg.strike])).toEqual([["long", 1, 95], ["short", 2, 100], ["long", 1, 105]]);
    expect(metrics.entryAmount).toBe(180);
    expect(metrics.maxLoss).toBe(180);
    expect(metrics.maxProfit).toBe(320);
    expect(metrics.breakevens).toEqual([96.8, 103.2]);
  }
});
it("prices uncovered short templates without implying stock or cash collateral", () => {
  for (const [id, profit, loss, breakevens] of [
    ["short-call", 250, null, [102.5]], ["short-put", 230, 9770, [97.7]],
    ["short-straddle", 480, null, [95.2, 104.8]], ["short-strangle", 290, null, [94.1, 105.9]],
  ] as const) {
    const state = createStrategy(id as TemplateId), metrics = calculateStrategy(state);
    expect(state.stock).toBeUndefined();
    expect(state.legs.every(leg => leg.side === "short")).toBe(true);
    expect(metrics.maxProfit).toBe(profit);
    expect(metrics.maxLoss).toBe(loss);
    expect(metrics.breakevens).toEqual(breakevens);
    expect(validateStrategy(state)).toEqual([]);
  }
});
it.each([
  { template: "bear-call", prices: [5, 1.2], fee: 5, gross: 380, net: 375 },
  { template: "inverse-iron-butterfly", prices: [3, 1.7, 1.7, 3], fee: 5, gross: 260, net: 255 },
  { template: "long-call", prices: [1.2], fee: 5, gross: -120, net: -125 },
  { template: "short-call", prices: [1.2], fee: 125, gross: 120, net: -5 },
  { template: "short-call", prices: [1.2], fee: 0, gross: 120, net: 120 },
  { template: "short-call", prices: [.01234567896], fee: .000000004, gross: 1.2345679, net: 1.23456789 },
])("separates gross and net entry accounting for $template / allowance $fee", ({ template, prices, fee, gross, net }) => {
  const state = createStrategy(template as TemplateId);
  state.legs = state.legs.map((leg, index) => ({ ...leg, entryPrice: prices[index] }));
  state.feeAllowance = fee;
  const before = structuredClone(state);
  const metrics = calculateStrategy(state);
  expect(metrics.entryAccounting).toEqual({
    grossEntryCashFlow: gross, costAllowance: Number(fee.toFixed(8)), netEntryCashFlowAfterAllowance: net,
    convention: "USD; positive means cash received, negative means cash paid. Gross entry excludes the supplied cost allowance; net subtracts it once. Allowance is a modeled deduction, not a verified fill or broker fee.",
  });
  expect(metrics.entryAmount).toBe(Math.abs(gross));
  expect(state).toEqual(before);
});
it.each([{ shares: 100, price: 90, side: "short", contracts: 2, entry: 2, gross: -8600, net: -8603.25 }, { shares: -37, price: 91, side: "long", contracts: 3, entry: 1.2, gross: 3007, net: 3003.75 }])("includes signed shares and contract quantities in entry accounting: $gross", item => {
  const state = createStrategy("long-call");
  state.stock = { shares: item.shares, entryPrice: item.price };
  state.legs[0] = { ...state.legs[0], side: item.side as "long" | "short", contracts: item.contracts, entryPrice: item.entry };
  state.feeAllowance = 3.25;
  const before = structuredClone(state);
  expect(calculateStrategy(state).entryAccounting).toMatchObject({ grossEntryCashFlow: item.gross, costAllowance: 3.25, netEntryCashFlowAfterAllowance: item.net });
  expect(state).toEqual(before);
});
it("deducts one flat cost allowance without changing asset values or sensitivities", () => {
  const state = createStrategy("bull-call");
  const before = calculateStrategy(state), facts = scenarioFacts(state);
  const changed = { ...state, feeAllowance: 10 };
  const after = calculateStrategy(changed), net = scenarioFacts(changed);
  expect(after.scenarioPnl).toBeCloseTo(before.scenarioPnl - 10, 7);
  expect(after.entryAmount).toBe(before.entryAmount);
  expect(after.maxProfit).toBe(before.maxProfit! - 10);
  expect(after.maxLoss).toBe(before.maxLoss! + 10);
  expect(after.breakevens[0]).toBeCloseTo(before.breakevens[0] + .1, 7);
  for (const key of ["delta", "gamma", "theta", "vega", "rho"] as const) expect(after[key]).toBe(before[key]);
  expect(net.valuation.signedModelValue).toBe(facts.valuation.signedModelValue);
  expect(net.valuation.feeAllowance).toBe(10);
  expect(net.valuation.signedModelValue - net.valuation.signedEntryEstimate - 10).toBeCloseTo(net.valuation.modelPnl, 7);
  expect(expirationProbability(changed).probability).toBeLessThan(expirationProbability(state).probability!);
  expect(scenarioSpotAttribution(changed)).toEqual(scenarioSpotAttribution(state));
  for (const feeAllowance of [null, -1, Infinity, "10"] as unknown as number[]) expect(validateStrategy({ ...state, feeAllowance }).length).toBeGreaterThan(0);
});
it("separates fixed-date stock and option spot-move contributions", () => {
  const state = createStrategy("covered-call");
  state.scenarioSpot = 110;
  const attribution = scenarioSpotAttribution(state);
  expect(attribution.baseline.spot).toBe(110);
  const down = attribution.rows.find(row => row.spot === 90)!;
  expect(down.stockChange).toBe(-2000);
  expect(down.optionChange).toBeCloseTo(555.18654636, 7);
  expect(down.pnlChange).toBeCloseTo(-1444.81345364, 7);
  for (const row of attribution.rows) expect(row.stockChange + row.optionChange).toBeCloseTo(row.pnlChange, 7);
  expect(attribution.rows.find(row => row.spot === 110)).toMatchObject({ pnlChange: 0, stockChange: 0, optionChange: 0 });
  state.stock!.entryPrice = 50; state.legs[0].entryPrice = 10;
  expect(scenarioSpotAttribution(state).rows).toEqual(attribution.rows);
  state.stock!.shares = -100;
  expect(scenarioSpotAttribution(state).rows.find(row => row.spot === 90)?.stockChange).toBe(2000);
  delete state.stock;
  for (const row of scenarioSpotAttribution(state).rows) expect(row.optionChange).toBe(row.pnlChange);
});
it("scenario table includes exact anchors and reconciles all stock-aware metrics", () => {
  const state = createStrategy("covered-call");
  state.scenarioSpot = 137.25;
  const original = structuredClone(state);
  const rows = scenarioTable(state);
  expect(rows.map(row => row.spot)).toEqual([...new Set(rows.map(row => row.spot))].sort((a, b) => a - b));
  for (const spot of [state.spot, state.scenarioSpot, ...state.legs.map(leg => leg.strike)]) expect(rows.some(row => row.spot === spot)).toBe(true);
  for (const row of rows) expect(row).toEqual({ spot: row.spot, ...evaluateScenario({ ...state, scenarioSpot: row.spot }) });
  expect(state).toEqual(original);
});

describe("conditional expiration probability", () => {
  const fixture = () => {
    const state = createStrategy("long-call");
    state.valuationTimestamp = state.scenarioDate = new Date(Date.parse(state.legs[0].expiry) - 365 * 86400000).toISOString();
    state.rate = .02; state.dividendYield = 0;
    state.legs[0].iv = .2; state.legs[0].entryPrice = 0;
    return state;
  };
  it("integrates the full tail and excludes a flat zero payoff", () => {
    const state = fixture();
    const result = expirationProbability(state);
    expect(result.probability).toBeCloseTo(.5, 6);
    state.legs[0].contracts = 4;
    expect(expirationProbability(state).probability).toBe(result.probability);
    state.legs.push({ ...state.legs[0], id: "offset", side: "short", type: "put", contractId: sampleContractId("put", 100, state.legs[0].expiry) });
    state.stock = { shares: -400, entryPrice: 100 };
    expect(expirationProbability(state).probability).toBe(0);
  });
  it("uses an explicit shared distribution without changing candidate IVs", () => {
    const state = fixture(); state.legs[0].iv = .4;
    const before = structuredClone(state), reference = { ...state.legs[0], iv: .2, contractId: "shared-reference" };
    // With r=.02, sigma=.2 and S=K, lognormal median equals strike: Q(S>K)=1/2.
    expect(expirationProbability(state, undefined, reference).probability).toBeCloseTo(.5, 6);
    expect(expirationProbability(state).probability).toBeLessThan(.5);
    expect(expirationProbability({ ...state, feeAllowance: 10 }, undefined, reference).probability).toBeLessThan(.5);
    expect(() => expirationProbability(state, undefined, { ...reference, iv: NaN })).toThrow(/reference/);
    expect(() => expirationProbability(state, undefined, { ...reference, expiry: state.scenarioDate })).toThrow(/reference/);
    expect(state).toEqual(before);
  });
  it("partitions expiry price ranges and handles inclusive point-mass boundaries", () => {
    const state = fixture();
    const range = { lower: 100 * Math.exp(-.2), upper: 100 * Math.exp(.2) };
    const result = expirationProbability(state, range);
    expect(result.priceRange?.between).toBeCloseTo(.682689492137, 6);
    expect(result.priceRange!.below + result.priceRange!.between + result.priceRange!.above).toBeCloseTo(1, 12);
    for (const spot of [range.lower - 1, range.lower, 100, range.upper, range.upper + 1]) {
      state.scenarioDate = state.legs[0].expiry; state.scenarioSpot = spot;
      expect(expirationProbability(state, range).priceRange).toMatchObject({ below: Number(spot < range.lower), between: Number(spot >= range.lower && spot <= range.upper), above: Number(spot > range.upper) });
    }
    expect(() => expirationProbability(state, { lower: 120, upper: 80 })).toThrow(/range/);
    expect(() => expirationProbability(state, { lower: NaN, upper: 80 })).toThrow(/range/);
  });
  it("samples lognormal density with exact median/mode and disclosed omitted tails", () => {
    const state = fixture();
    const distribution = expirationDistribution(state);
    const atSpot = distribution.points.find(point => Math.abs(point.spot - 100) < 1e-10)!;
    expect(atSpot.density).toBeCloseTo(1 / (Math.sqrt(2 * Math.PI) * 100 * .2), 10);
    const mode = 100 * Math.exp(-.04);
    expect(distribution.points.some(point => Math.abs(point.spot - mode) < 1e-10)).toBe(true);
    expect(distribution.omittedMass).toBeCloseTo(1 - .999936657516, 7);
    const area = distribution.points.slice(1).reduce((sum, point, index) => sum + (point.spot - distribution.points[index].spot) * (point.density + distribution.points[index].density) / 2, 0);
    expect(area).toBeCloseTo(1 - distribution.omittedMass!, 3);
    state.legs[0].iv = 5;
    const skewed = expirationDistribution(state);
    expect(skewed.points.length).toBeGreaterThan(256);
    expect(skewed.points.every(point => Number.isFinite(point.spot) && Number.isFinite(point.density))).toBe(true);
    expect(skewed.omittedMass).toBeLessThan(distribution.omittedMass!);
    state.scenarioDate = state.legs[0].expiry;
    expect(expirationDistribution(state)).toMatchObject({ pointMass: 100, points: [] });
    expect(expirationDistribution(createStrategy("call-calendar")).reason).toMatch(/Mixed/);
  });
  it("handles point masses, stock basis and unsupported mixed expiries", () => {
    const state = fixture();
    state.scenarioDate = state.legs[0].expiry;
    expect(expirationProbability(state).probability).toBe(0);
    state.scenarioSpot = 101;
    expect(expirationProbability(state).probability).toBe(1);
    state.scenarioSpot = 0;
    expect(() => expirationProbability(state)).toThrow(/scenario spot/);
    const covered = fixture();
    covered.stock = { shares: 100, entryPrice: 100 };
    covered.legs[0].side = "short";
    expect(expirationProbability(covered).probability).toBe(0);
    covered.stock.entryPrice = 99;
    expect(expirationProbability(covered).probability).toBeGreaterThan(.5);
    expect(expirationProbability(createStrategy("call-calendar"))).toMatchObject({ probability: null, reason: expect.stringMatching(/Mixed/) });
  });
  it("adds disjoint tails and keeps IV selection independent of leg ordering and sizing", () => {
    const state = fixture();
    const iv = Math.log(1.5) / 2;
    state.rate = Math.log(.96) / 2 + iv * iv / 2;
    state.legs = [
      { ...state.legs[0], id: "put", type: "put", strike: 80, iv, contractId: sampleContractId("put", 80, state.legs[0].expiry) },
      { ...state.legs[0], id: "call", strike: 120, iv, contractId: sampleContractId("call", 120, state.legs[0].expiry) },
    ];
    const result = expirationProbability(state);
    expect(result.probability).toBeCloseTo(1 - .682689492137, 6);
    state.legs.reverse();
    state.legs[0].contracts = 3;
    expect(expirationProbability(state).volatilityContractId).toBe(result.volatilityContractId);
    expect(expirationProbability(state).probability).toBeCloseTo(result.probability!, 10);
    state.legs = state.legs.map(leg => ({ ...leg, contracts: 1, strike: 100, entryPrice: 10, side: "short", contractId: sampleContractId(leg.type, 100, leg.expiry) }));
    expect(expirationProbability(state).probability).toBeCloseTo(.682689492137, 6);
    state.legs = state.legs.map(leg => ({ ...leg, side: "long" }));
    expect(expirationProbability(state).probability).toBeCloseTo(1 - .682689492137, 6);
  });
});

describe("stock-backed accounting", () => {
  const base = createStrategy("long-call");
  const option = (type: "call" | "put", strike: number, side: "long" | "short", entryPrice: number): OptionLeg => ({ ...base.legs[0], id: type, type, strike, side, entryPrice, contractId: sampleContractId(type, strike, base.legs[0].expiry) });
  const cases = [
    { legs: [option("call", 105, "short", 2)], entry: 9800, loss: 9800, profit: 700, breakeven: 98, points: [[0, -9800], [98, 0], [105, 700], [150, 700]] },
    { legs: [option("put", 95, "long", 3)], entry: 10300, loss: 800, profit: null, breakeven: 103, points: [[0, -800], [95, -800], [103, 0], [150, 4700]] },
    { legs: [option("put", 95, "long", 3), option("call", 105, "short", 2)], entry: 10100, loss: 600, profit: 400, breakeven: 101, points: [[0, -600], [95, -600], [101, 0], [105, 400], [150, 400]] },
  ];
  it("matches independently derived covered-call, protective-put and collar payoffs", () => {
    for (const item of cases) {
      const state = { ...base, legs: item.legs, stock: { shares: 100, entryPrice: 100 }, scenarioDate: base.legs[0].expiry };
      const metrics = calculateStrategy(state);
      expect([metrics.entryAmount, metrics.maxLoss, metrics.maxProfit, metrics.breakevens]).toEqual([item.entry, item.loss, item.profit, [item.breakeven]]);
      for (const [spot, pnl] of item.points) expect(payoffSeries(state, spot, spot + 1, 1)[0].pnl).toBe(pnl);
      const doubled = { ...state, stock: { shares: 200, entryPrice: 100 }, legs: state.legs.map(leg => ({ ...leg, contracts: 2 })) };
      expect(calculateStrategy(doubled).maxLoss).toBe(item.loss * 2);
    }
  });
  it("adds signed share value and delta only and reconciles option residual separately", () => {
    const optionOnly = evaluateScenario(base);
    for (const shares of [100, -100]) {
      const state = { ...base, stock: { shares, entryPrice: 90 } };
      const result = evaluateScenario(state), facts = scenarioFacts(state).valuation;
      expect(result.pnl).toBeCloseTo(optionOnly.pnl + shares * 10, 7);
      expect(result.delta).toBeCloseTo(optionOnly.delta + shares, 7);
      for (const key of ["gamma", "theta", "vega", "rho"] as const) expect(result[key]).toBe(optionOnly[key]);
      expect(facts.signedModelValue - facts.signedEntryEstimate).toBeCloseTo(facts.modelPnl, 7);
      expect(facts.signedStockValue).toBe(shares * base.scenarioSpot);
      expect(facts.signedIntrinsicValue + facts.signedModelResidual + facts.signedStockValue!).toBeCloseTo(facts.signedModelValue, 7);
      expect(facts.signedModelResidual).toBe(scenarioFacts(base).valuation.signedModelResidual);
      expect(calculateStrategy({ ...base, stock: { shares: -200, entryPrice: 90 } }).maxLoss).toBeNull();
    }
    expect(calculateStrategy({ ...base, legs: cases[0].legs, stock: { shares: 50, entryPrice: 100 } }).maxLoss).toBeNull();
    expect(calculateStrategy({ ...base, legs: cases[0].legs, stock: { shares: 200, entryPrice: 100 } }).maxProfit).toBeNull();
  });
  it("rejects malformed or ambiguous stock holdings", () => {
    for (const stock of [null, [], {}, { shares: 0, entryPrice: 100 }, { shares: .5, entryPrice: 100 }, { shares: Number.MAX_SAFE_INTEGER + 1, entryPrice: 100 }, { shares: 100, entryPrice: -1 }, { shares: 100, entryPrice: NaN }, { shares: 100, entryPrice: Infinity }, { shares: 100, entryPrice: 1e308 }, { shares: 100, entryPrice: 100, symbol: "QQQ" }]) {
      expect(validateStrategy({ ...base, stock } as StrategyState).length).toBeGreaterThan(0);
    }
    expect(validateStrategy({ ...base, stock: { shares: -100, entryPrice: 0 } })).toEqual([]);
  });
});

function oneLeg(state: StrategyState, item: OptionLeg): StrategyState {
  return { ...state, stock: undefined, id: item.id, name: item.id, legs: [{ ...item }] };
}

describe("template catalog", () => {
  it("matches fixed deterministic vectors for all twenty-seven templates", () => {
    const vectors = Object.fromEntries(IDS.map((id) => {
      const m = calculateStrategy(createStrategy(id));
      return [id, [m.entryAmount, m.maxProfit, m.maxLoss, m.scenarioPnl, m.delta, m.gamma, m.theta, m.vega, m.rho]];
    }));
    expect(vectors).toEqual({
      "inverse-iron-butterfly": [320, 180, 320, -13.21334312, 0.53187751, 7.13273807, -4.69956275, 7.3086138, -0.11811456],
      "inverse-iron-condor": [190, 110, 190, -84.88791169, 0.76497674, 6.17785123, -4.09034918, 6.33018181, -0.01332726],
      "short-call-butterfly": [180, 180, 320, -12.28270344, 0.53187751, 7.13273807, -4.75425528, 7.3086138, 0.1143287],
      "short-put-butterfly": [180, 180, 320, -12.28270344, 0.53187751, 7.13273807, -4.75425528, 7.3086138, 0.1143287],
      "call-diagonal": [300, null, null, -32.63421014, 46.29856588, -0.6310481, 0.09252681, 2.78225535, 2.44482182],
      "put-diagonal": [310, null, null, -50.2028849, -45.18857996, 0.39031672, 0.1163377, 3.54905722, -2.59852387],
      "call-butterfly": [180, 320, 180, 12.28270344, -0.53187751, -7.13273807, 4.75425528, -7.3086138, -0.1143287],
      "put-butterfly": [180, 320, 180, 12.28270344, -0.53187751, -7.13273807, 4.75425528, -7.3086138, -0.1143287],
      "short-call": [250, 250, null, 54.24894156, -52.01288347, -8.38681846, 5.9381263, -8.59361673, -2.33134613],
      "short-put": [230, 230, 9770, 47.2742557, 47.93124174, -8.38681846, 5.17285907, -8.59361673, 2.31751914],
      "short-straddle": [480, 480, null, 101.52319726, -4.08164173, -16.77363693, 11.11098537, -17.18723345, -0.01382699],
      "short-strangle": [290, 290, null, 137.89103587, -3.96185397, -13.73943716, 9.12315788, -14.0782178, -0.11367943],
      "covered-call": [9800, 700, 9800, 159.53394707, 83.56614865, -5.21366459, 3.57836431, -5.34222071, -0.74656505],
      "protective-put": [10300, null, 800, -268.77590707, 87.11591287, 4.42723426, -2.83305831, 4.53639894, -0.6146235],
      "collar": [10100, 400, 600, -109.24196, 70.68206151, -0.78643033, 0.745306, -0.80582176, -1.36118855],
      "long-call": [250, null, 250, -54.24894156, 52.01288347, 8.38681846, -5.9381263, 8.59361673, 2.33134613],
      "long-put": [230, 9770, 230, -47.2742557, -47.93124174, 8.38681846, -5.17285907, 8.59361673, -2.31751914],
      "bull-call": [240, 260, 240, -9.32469764, 39.91169473, 0.36270383, -0.52137002, 0.37164721, 1.75146304],
      "bear-put": [240, 260, 240, -11.61883001, -39.83115394, 1.24779402, -0.4967224, 1.27856154, -1.96151895],
      "bull-put": [240, 240, 260, 11.61883001, 39.83115394, -1.24779402, 0.4967224, -1.27856154, 1.96151895],
      "bear-call": [240, 240, 260, 9.32469764, -39.91169473, -0.36270383, 0.52137002, -0.37164721, -1.75146304],
      "long-straddle": [480, null, 480, -101.52319726, 4.08164173, 16.77363693, -11.11098537, 17.18723345, 0.01382699],
      "long-strangle": [290, null, 290, -137.89103587, 3.96185397, 13.73943716, -9.12315788, 14.0782178, 0.11367943],
      "iron-butterfly": [320, 320, 180, 13.21334312, -0.53187751, -7.13273807, 4.69956275, -7.3086138, 0.11811456],
      "iron-condor": [190, 190, 110, 84.88791169, -0.76497674, -6.17785123, 4.09034918, -6.33018181, 0.01332726],
      "call-calendar": [150, null, null, -103.27659488, 0.46343808, -2.55667803, 1.69667779, 1.99753665, 0.95986206],
      "put-calendar": [140, null, null, -98.63613845, 0.48644156, -2.55667803, 1.69591398, 1.99753665, -0.95227799],
    });
  });
  it("constructs twenty-seven valid, independent strategies", () => {
    expect(IDS).toEqual([
      "inverse-iron-butterfly", "inverse-iron-condor", "short-call-butterfly", "short-put-butterfly",
      "call-diagonal", "put-diagonal",
      "call-butterfly", "put-butterfly",
      "short-call", "short-put", "short-straddle", "short-strangle",
      "long-call",
      "long-put",
      "bull-call",
      "bear-put",
      "bull-put",
      "bear-call",
      "long-straddle",
      "long-strangle",
      "iron-butterfly",
      "iron-condor",
      "call-calendar",
      "put-calendar",
      "covered-call", "protective-put", "collar",
    ]);
    for (const id of IDS) {
      const state = createStrategy(id);
      expect(validateStrategy(state), id).toEqual([]);
      expect(state.legs.length, id).toBeGreaterThanOrEqual(1);
      expect(state.legs.length, id).toBeLessThanOrEqual(4);
      expect(() => calculateStrategy(state), id).not.toThrow();
    }
    const first = createStrategy("bull-call");
    const second = createStrategy("bull-call");
    first.legs[0].strike = 1;
    expect(second.legs[0].strike).toBe(98);
  });

  it("rejects an unknown runtime template", () => {
    expect(() => createStrategy("unknown" as TemplateId)).toThrow("Unknown template");
  });
});

describe("same-expiry expiration economics", () => {
  it.each([
    ["bull-call", "Debit", 240, 260, 240, 100.4],
    ["bear-put", "Debit", 240, 260, 240, 99.6],
    ["bull-put", "Credit", 240, 240, 260, 99.6],
    ["bear-call", "Credit", 240, 240, 260, 100.4],
  ] as const)("matches the hand-checkable %s identity", (id, label, entry, profit, loss, breakeven) => {
    const metrics = calculateStrategy(createStrategy(id));
    expect(metrics.entryLabel).toBe(label);
    expect(metrics.entryAmount).toBe(entry);
    expect(metrics.maxProfit).toBeCloseTo(profit, 8);
    expect(metrics.maxLoss).toBeCloseTo(loss, 8);
    expect(metrics.breakevens).toEqual([breakeven]);
    expect(metrics.mode).toBe("expiration");
  });

  it("finds multiple breakevens without a template-specific branch", () => {
    const metrics = calculateStrategy(createStrategy("long-strangle"));
    expect(metrics.maxProfit).toBeNull();
    expect(metrics.maxLoss).toBe(290);
    expect(metrics.breakevens).toEqual([94.1, 105.9]);
  });

  it("classifies a naked short call as unbounded loss", () => {
    const state = createStrategy("long-call");
    state.legs[0].side = "short";
    state.legs[0].id = "short-call";
    const metrics = calculateStrategy(state);
    expect(metrics.entryLabel).toBe("Credit");
    expect(metrics.maxProfit).toBe(250);
    expect(metrics.maxLoss).toBeNull();
    expect(metrics.breakevens).toEqual([102.5]);
  });

  it("includes unequal contracts and the 100-share multiplier", () => {
    const state = createStrategy("bull-call");
    state.legs[0].contracts = 2;
    const combined = calculateStrategy(state);
    const parts = state.legs.map((item) => calculateStrategy(oneLeg(state, item)));
    expect(combined.scenarioPnl).toBeCloseTo(parts.reduce((sum, item) => sum + item.scenarioPnl, 0), 6);
    expect(combined.delta).toBeCloseTo(parts.reduce((sum, item) => sum + item.delta, 0), 6);
    expect(combined.gamma).toBeCloseTo(parts.reduce((sum, item) => sum + item.gamma, 0), 6);
    expect(combined.theta).toBeCloseTo(parts.reduce((sum, item) => sum + item.theta, 0), 6);
    expect(combined.vega).toBeCloseTo(parts.reduce((sum, item) => sum + item.vega, 0), 6);
    expect(combined.rho).toBeCloseTo(parts.reduce((sum, item) => sum + item.rho, 0), 6);
    expect(combined.entryAmount).toBe(620);
  });

  it("composes one-, two-, three-, and four-leg states by signed summation", () => {
    const base = createStrategy("iron-condor");
    for (let count = 1; count <= 4; count += 1) {
      const state = { ...base, legs: base.legs.slice(0, count).map((item) => ({ ...item })) };
      const combined = calculateStrategy(state);
      const parts = state.legs.map((item) => calculateStrategy(oneLeg(state, item)));
      for (const field of ["scenarioPnl", "delta", "gamma", "theta", "vega", "rho"] as const) {
        expect(combined[field], `${count} legs: ${field}`).toBeCloseTo(parts.reduce((sum, item) => sum + item[field], 0), 6);
      }
    }
  });
});

describe("theoretical scenarios", () => {
  it("preserves exact price-only curve parity across all templates, holdings and horizons", () => {
    expect(IDS).toHaveLength(27);
    for (const id of IDS) {
      for (const shares of [undefined, 137, -83]) {
        const state = createStrategy(id);
        if (shares !== undefined) state.stock = { shares, entryPrice: 93.17 };
        state.feeAllowance = 12.37;
        state.ivShift = 0.037;
        state.legs = state.legs.map((leg, index) => ({ ...leg, contracts: index + 2, entryPrice: 1.137 + index * 0.371 }));
        const before = structuredClone(state);
        const expiry = Math.min(...state.legs.map(leg => Date.parse(leg.expiry)));
        for (const at of [Date.parse(state.scenarioDate), expiry, undefined]) {
          for (const [min, max, steps] of [[0, 137.19, 17], [89.73, 111.37, 11]]) {
            expect(payoffSeries(state, min, max, steps, at), `${id}, shares=${shares}, at=${at}`)
              .toEqual(scenarioSeries(state, min, max, steps, at).map(({ spot, pnl }) => ({ spot, pnl })));
          }
        }
        expect(state).toEqual(before);
      }
    }
  });

  it("preserves identical curve rejection messages for invalid ranges, steps and dates", () => {
    const state = createStrategy("call-calendar");
    const cases: Array<[number, number, number, number?]> = [
      [-1, 100, 4], [100, 100, 4], [101, 100, 4], [NaN, 100, 4], [0, Infinity, 4],
      [0, 100, 0], [0, 100, 1.5], [0, 100, 10001], [0, 100, NaN],
      [0, 100, 4, NaN], [0, 100, 4, Infinity],
      [0, 100, 4, Date.parse(state.valuationTimestamp) - 1],
      [0, 100, 4, Math.min(...state.legs.map(leg => Date.parse(leg.expiry))) + 1],
    ];
    for (const args of cases) {
      const messages = [payoffSeries, scenarioSeries].map(curve => {
        try { curve(state, ...args); } catch (error) { return (error as Error).message; }
        return undefined;
      });
      expect(messages[0]).toBeTypeOf("string");
      expect(messages[0]).toBe(messages[1]);
    }
  });

  it("provides curve Greeks from the same selected-date model as the scalar scenario", () => {
    for (const id of IDS) {
      const state = createStrategy(id);
      state.ivShift = 0.03;
      state.legs[0].contracts = 2;
      for (const at of [Date.parse(state.valuationTimestamp), Date.parse("2026-09-07T14:30:00.000Z"), undefined]) {
        const series = scenarioSeries(state, 90, 110, 4, at);
        expect(series.map(({ spot, pnl }) => ({ spot, pnl }))).toEqual(payoffSeries(state, 90, 110, 4, at));
        for (const { spot, ...metrics } of series) expect(metrics).toEqual(evaluateScenario({ ...state, scenarioSpot: spot, scenarioDate: new Date(at ?? Math.min(...state.legs.map(item => Date.parse(item.expiry)))).toISOString() }));
      }
    }
  });

  it("keeps curve zero boundaries finite and preserves range, step and date rejection", () => {
    const state = createStrategy("put-calendar");
    for (const id of IDS) {
      const boundary = createStrategy(id);
      for (const at of [Date.parse(boundary.valuationTimestamp), undefined]) {
        const series = scenarioSeries(boundary, 0, 120, 4, at);
        expect(series.map(({ spot, pnl }) => ({ spot, pnl }))).toEqual(payoffSeries(boundary, 0, 120, 4, at));
        expect(Object.values(series[0]).every(Number.isFinite), id).toBe(true);
        expect(series[0].gamma).toBe(0);
      }
    }
    for (const curve of [scenarioSeries, payoffSeries]) {
      for (const [min, max] of [[-1, 100], [100, 100], [NaN, 100], [0, Infinity]]) expect(() => curve(state, min, max, 4)).toThrow("range");
      for (const steps of [0, 1.5, 10001, NaN]) expect(() => curve(state, 0, 100, steps)).toThrow("steps");
      for (const at of [NaN, Infinity, Date.parse(state.valuationTimestamp) - 1, Date.parse(state.legs[0].expiry) + 1]) expect(() => curve(state, 0, 100, 4, at)).toThrow("date");
    }
  });

  it("attributes scenario Greeks to signed leg quantities across templates and first expiry", () => {
    const fields = ["delta", "gamma", "theta", "vega", "rho"] as const;
    for (const id of IDS) {
      const state = createStrategy(id);
      state.scenarioSpot = 103;
      state.ivShift = 0.03;
      state.legs.forEach((item, index) => { item.contracts = index + 2; });
      for (const date of ["2026-09-07T14:30:00.000Z", state.legs.map(item => item.expiry).sort()[0]]) {
        state.scenarioDate = date;
        const facts = scenarioFacts(state);
        const total = calculateStrategy(state);
        facts.legs.forEach((item, index) => {
          expect(item).toHaveProperty("greeks");
          const single = calculateStrategy(oneLeg(state, state.legs[index]));
          for (const field of fields) expect(item.greeks[field], `${id}: ${field}`).toBe(single[field]);
        });
        for (const field of fields) expect(facts.legs.reduce((sum, item) => sum + item.greeks[field], field === "delta" ? state.stock?.shares ?? 0 : 0), `${id}: ${field} total`).toBeCloseTo(total[field], 7);
      }
    }
  });

  it("keeps model accounting independent of entry estimates, quantity and direction", () => {
    const state = createStrategy("long-call");
    state.scenarioSpot = 105;
    const initial = scenarioFacts(state);
    state.legs[0].entryPrice = 7;
    const repriced = scenarioFacts(state);
    expect(repriced.legs).toEqual(initial.legs);
    for (const field of ["signedModelValue", "signedIntrinsicValue", "signedModelResidual"] as const) expect(repriced.valuation[field]).toBe(initial.valuation[field]);
    expect(repriced.valuation.signedEntryEstimate).toBe(700);
    expect(repriced.valuation.modelPnl).toBe(evaluateScenario(state).pnl);
    expect(repriced.valuation.signedModelValue - repriced.valuation.signedEntryEstimate).toBeCloseTo(repriced.valuation.modelPnl, 7);
    expect(repriced.valuation.signedIntrinsicValue + repriced.valuation.signedModelResidual).toBeCloseTo(repriced.valuation.signedModelValue, 7);
    expect(repriced.legs[0].modelResidualFractionOfModelValue).toBeCloseTo(repriced.legs[0].modelValueMinusIntrinsicPerShare / repriced.legs[0].modelValuePerShare, 7);
    state.legs[0].contracts = 2;
    const doubled = scenarioFacts(state);
    const { greeks: doubledGreeks, ...doubledPerShare } = doubled.legs[0];
    const { greeks: initialGreeks, ...initialPerShare } = repriced.legs[0];
    expect(doubledPerShare).toEqual(initialPerShare);
    for (const field of ["delta", "gamma", "theta", "vega", "rho"] as const) expect(doubledGreeks[field]).toBeCloseTo(initialGreeks[field] * 2, 7);
    for (const field of ["signedEntryEstimate", "signedModelValue", "signedIntrinsicValue", "signedModelResidual", "modelPnl"] as const) expect(doubled.valuation[field]).toBeCloseTo(repriced.valuation[field] * 2, 7);
    state.legs[0].side = "short";
    const short = scenarioFacts(state);
    const { greeks: shortGreeks, ...shortPerShare } = short.legs[0];
    expect(shortPerShare).toEqual(doubledPerShare);
    for (const field of ["delta", "gamma", "theta", "vega", "rho"] as const) expect(shortGreeks[field]).toBe(-doubledGreeks[field]);
    for (const field of ["signedEntryEstimate", "signedModelValue", "signedIntrinsicValue", "signedModelResidual", "modelPnl"] as const) expect(short.valuation[field]).toBeCloseTo(-doubled.valuation[field], 7);
  });

  it("retains negative European carry residuals and handles zero model value without entry percentages", () => {
    const state = createStrategy("long-call");
    state.scenarioSpot = 120;
    state.dividendYield = 0.2;
    expect(scenarioFacts(state).valuation.signedModelResidual).toBeLessThan(0);
    expect(scenarioFacts(state).legs[0].modelResidualFractionOfModelValue).toBeLessThan(0);
    state.scenarioDate = state.legs[0].expiry;
    expect(scenarioFacts(state).valuation.signedModelResidual).toBe(0);
    expect(scenarioFacts(state).legs[0].modelResidualFractionOfModelValue).toBe(0);
    state.scenarioSpot = 90;
    expect(scenarioFacts(state).valuation.signedModelValue).toBe(0);
    expect(scenarioFacts(state).legs[0].modelResidualFractionOfModelValue).toBeNull();
    const credit = scenarioFacts(createStrategy("bull-put"));
    expect(credit.valuation.signedEntryEstimate).toBe(-240);
    expect(credit.valuation.signedModelValue - credit.valuation.signedEntryEstimate).toBeCloseTo(credit.valuation.modelPnl, 7);
    expect(Object.keys(credit.valuation).sort()).toEqual(["entryBasis", "modelPnl", "signedEntryEstimate", "signedIntrinsicValue", "signedModelResidual", "signedModelValue"]);
    expect(credit.valuation.entryBasis).toMatch(/sample/i);
  });

  it.each(["mid", "natural"] as const)("labels %s market entry as an estimate, not a fill", basis => {
    const state = createStrategy("long-call");
    state.pricing = { mode: "market", snapshotId: "test", basis };
    state.legs[0].contractId = state.legs[0].contractId.replace("SPY", "SPY   ");
    expect(scenarioFacts(state).valuation.entryBasis).toMatch(basis === "mid" ? /Midpoint/ : /buy at ask \/ sell at bid/);
    expect(scenarioFacts(state).valuation.entryBasis).toContain("not a fill");
    expect(Object.keys(evaluateScenario(state)).sort()).toEqual(["delta", "gamma", "pnl", "rho", "theta", "vega"]);
  });

  it.each(["bull-call", "call-calendar"] as const)("evaluates %s selected-date curves by signed leg totals", (id) => {
    const state = createStrategy(id);
    state.legs[0].contracts = 2;
    state.ivShift = 0.03;
    state.scenarioDate = "2026-09-07T14:30:00.000Z";
    const at = Date.parse(state.scenarioDate);
    const selected = payoffSeries(state, 90, 110, 4, at);
    expect(selected).not.toEqual(payoffSeries(state, 90, 110, 4));
    for (const point of selected) {
      const scenario = { ...state, scenarioSpot: point.spot };
      const value = evaluateScenario(scenario);
      const metrics = calculateStrategy(scenario);
      const legs = state.legs.map(item => calculateStrategy(oneLeg(scenario, item)));
      expect(point.pnl).toBe(value.pnl);
      expect(value.pnl).toBe(metrics.scenarioPnl);
      expect(value.pnl).toBeCloseTo(legs.reduce((sum, item) => sum + item.scenarioPnl, 0), 6);
      for (const field of ["delta", "gamma", "theta", "vega", "rho"] as const) {
        expect(value[field]).toBe(metrics[field]);
        expect(value[field]).toBeCloseTo(legs.reduce((sum, item) => sum + item[field], 0), 6);
      }
    }
    const expiry = Math.min(...state.legs.map(item => Date.parse(item.expiry)));
    expect(payoffSeries(state, 90, 110, 4, expiry)).toEqual(payoffSeries(state, 90, 110, 4));
    expect(payoffSeries(state, 90, 110, 4, Date.parse(state.valuationTimestamp))).toHaveLength(5);
  });

  it("rejects invalid scenario states and curve dates outside valuation through first expiry", () => {
    const state = createStrategy("call-calendar");
    const expiry = Date.parse(state.legs[0].expiry);
    for (const at of [NaN, Infinity, Date.parse(state.valuationTimestamp) - 1, expiry + 1]) {
      expect(() => payoffSeries(state, 90, 110, 4, at)).toThrow("date");
    }
    for (const scenarioDate of ["invalid", "2026-09-01T19:59:59.999Z", "2026-09-11T20:00:00.001Z"]) {
      expect(() => evaluateScenario({ ...state, scenarioDate })).toThrow("date");
    }
    expect(() => evaluateScenario({ ...state, scenarioSpot: NaN })).toThrow("scenario spot");
  });

  it("decomposes same-scenario model value without treating entry cost as current time value", () => {
    const state = createStrategy("long-call");
    state.scenarioSpot = 105;
    const facts = scenarioFacts(state);
    const priced = facts.legs[0];
    expect(priced.intrinsicPerShare).toBe(5);
    expect(priced.moneyness).toBe("in-the-money");
    expect(priced.modelValuePerShare).toBeCloseTo((calculateStrategy(state).scenarioPnl + 250) / 100, 7);
    expect(priced.modelValueMinusIntrinsicPerShare).toBeCloseTo(priced.modelValuePerShare - 5, 7);
    expect(priced.modelValueMinusIntrinsicPerShare).not.toBe(state.legs[0].entryPrice - 5);
    state.legs[0].entryPrice = 7;
    expect(scenarioFacts(state).legs).toEqual(facts.legs);
  });
  it("reprices one calendar day rather than repeating a constant theta deduction", () => {
    const state = createStrategy("long-call");
    const facts = scenarioFacts(state);
    const later = calculateStrategy({ ...state, scenarioDate: "2026-09-02T20:00:00.000Z" });
    expect(facts.timeStep?.date).toBe("2026-09-02T20:00:00.000Z");
    expect(facts.timeStep?.calendarDays).toBe(1);
    expect(facts.timeStep?.pnl).toBe(later.scenarioPnl);
    expect(facts.timeStep?.changeInValue).toBeCloseTo(later.scenarioPnl - calculateStrategy(state).scenarioPnl, 7);
    expect(facts.timeStep?.changeInValue).not.toBeCloseTo(calculateStrategy(state).theta, 2);
    state.legs[0].contracts = 2;
    expect(scenarioFacts(state).timeStep?.changeInValue).toBeCloseTo(facts.timeStep!.changeInValue * 2, 7);
  });
  it("caps the modeled time step at first expiry and does not invent time beyond expiry", () => {
    const state = createStrategy("call-calendar");
    state.scenarioDate = "2026-09-11T08:00:00.000Z";
    expect(scenarioFacts(state).timeStep).toMatchObject({ date: state.legs[0].expiry, calendarDays: 0.5 });
    state.scenarioDate = state.legs[0].expiry;
    expect(scenarioFacts(state).timeStep).toBeNull();
    expect(scenarioFacts(state).legs[0].modelValueMinusIntrinsicPerShare).toBe(0);
  });
  it("satisfies dividend-aware European put-call parity", () => {
    const call = createStrategy("long-call");
    const put = createStrategy("long-put");
    call.legs[0].entryPrice = 0;
    put.legs[0].entryPrice = 0;
    put.legs[0].iv = call.legs[0].iv;
    const callValue = calculateStrategy(call).scenarioPnl / 100;
    const putValue = calculateStrategy(put).scenarioPnl / 100;
    const years = (Date.parse(call.legs[0].expiry) - Date.parse(call.valuationTimestamp)) / (365 * 86_400_000);
    const parity = call.spot * Math.exp(-call.dividendYield * years) - call.legs[0].strike * Math.exp(-call.rate * years);
    expect(callValue - putValue).toBeCloseTo(parity, 4);
  });

  it("uses intrinsic value exactly at expiry", () => {
    const state = createStrategy("long-call");
    state.scenarioDate = state.legs[0].expiry;
    state.scenarioSpot = 110;
    expect(calculateStrategy(state).scenarioPnl).toBe(750);
  });

  it("models a calendar only to its first expiry", () => {
    const state = createStrategy("call-calendar");
    state.scenarioDate = state.legs[0].expiry;
    state.scenarioSpot = state.legs[0].strike;
    const metrics = calculateStrategy(state);
    const nearOnly = calculateStrategy(oneLeg(state, state.legs[0]));
    const farOnly = calculateStrategy(oneLeg(state, state.legs[1]));
    expect(nearOnly.scenarioPnl).toBe(150);
    expect(farOnly.scenarioPnl).toBeGreaterThan(-300);
    expect(metrics.scenarioPnl).toBeCloseTo(nearOnly.scenarioPnl + farOnly.scenarioPnl, 6);
    expect(metrics.mode).toBe("first-expiry");
    expect(metrics.maxProfit).toBeNull();
    expect(metrics.maxLoss).toBeNull();
    expect(metrics.breakevens).toEqual([]);
  });

  it("returns an inclusive first-expiry payoff series", () => {
    const series = payoffSeries(createStrategy("bull-call"), 80, 120, 4);
    expect(series).toHaveLength(5);
    expect(series.map((point) => point.spot)).toEqual([80, 90, 100, 110, 120]);
    expect(series[0].pnl).toBe(-240);
    expect(series.at(-1)?.pnl).toBe(260);
  });
});

describe("validation", () => {
  it.each(["SPY\n", "SPY\r\n"])("rejects a terminal newline in market root %j", underlying => {
    const state = createStrategy("long-call");
    state.underlying = underlying;
    state.pricing = { mode: "market", snapshotId: "test", basis: "mid" };
    expect(validateStrategy(state)).toContain("invalid market underlying");
  });
  it("rejects fifth legs, adjusted contracts, excess expiries, and invalid shifted IV", () => {
    const fifth = createStrategy("iron-condor");
    fifth.legs.push({ ...fifth.legs[0], id: "fifth", contractId: "fifth" });
    expect(validateStrategy(fifth)).toContain("strategy must contain one to four legs");

    const adjusted = createStrategy("long-call");
    adjusted.legs[0].multiplier = 50;
    expect(validateStrategy(adjusted)).toContain("call: only standard 100-share contracts are supported");

    const expiries = createStrategy("long-strangle");
    expiries.legs.push({ ...expiries.legs[0], id: "third", contractId: "third", expiry: "2026-09-25T20:00:00.000Z" });
    expiries.legs[1].expiry = "2026-09-11T20:00:00.000Z";
    expect(validateStrategy(expiries)).toContain("at most two expiries are supported");

    const volatility = createStrategy("long-call");
    volatility.ivShift = -volatility.legs[0].iv;
    expect(validateStrategy(volatility)).toContain("call: shifted IV must be positive and finite");
    volatility.legs[0].iv = Number.MAX_VALUE;
    volatility.ivShift = Number.MAX_VALUE;
    expect(validateStrategy(volatility)).toContain("call: shifted IV must be positive and finite");
  });

  it("reports malformed untrusted legs without throwing", () => {
    const state = createStrategy("long-call");
    (state as unknown as { legs: unknown[] }).legs = [null];
    expect(validateStrategy(state)).toEqual(["each leg must be an object"]);
  });

  it("rejects unknown or metadata-mismatched sample contracts", () => {
    const unknown = createStrategy("long-call");
    unknown.legs[0].contractId = "arbitrary";
    expect(validateStrategy(unknown)).toContain("call: contract is not in the replay-safe sample catalog");

    const mismatch = createStrategy("long-call");
    mismatch.legs[0].strike = 101;
    expect(validateStrategy(mismatch)).toContain("call: contract is not in the replay-safe sample catalog");

    const offGrid = createStrategy("long-call");
    offGrid.legs[0].strike = 100.0004;
    expect(validateStrategy(offGrid)).toContain("call: contract is not in the replay-safe sample catalog");

    const wrongExpiry = createStrategy("long-call");
    wrongExpiry.legs[0].expiry = "2026-09-18T19:00:00.000Z";
    expect(validateStrategy(wrongExpiry)).toContain("call: contract is not in the replay-safe sample catalog");

    const wrongUnderlying = createStrategy("long-call");
    wrongUnderlying.underlying = "QQQ";
    expect(validateStrategy(wrongUnderlying)).toContain("the replay-safe sample supports SPY only");
  });
});
