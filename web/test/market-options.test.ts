import { describe, expect, it, vi } from "vitest";
import * as american from "../src/american-price";
import { candidateStrategyFamily, CANDIDATE_OPTION_FAMILIES, searchCandidates, expirationProbability, calculateStrategy, createMarketStrategy, createStrategy, marketLeg, quoteValuation, scenarioFacts, TEMPLATES, validateMarketStrategy, validateStrategy, type MarketSnapshot } from "../src/options";

const snapshot: MarketSnapshot = {
  id: "snapshot-1", underlying: "SPY", source: "Tastytrade", retrievedAt: "2026-09-05T12:00:00.000Z", spot: 650, spotAsOf: "2026-09-04T20:00:00.000Z",
  availableExpiries: ["2026-09-08", "2026-09-11"],
  contracts: ["2026-09-08T20:15:00.000Z", "2026-09-11T20:15:00.000Z"].flatMap(expiry =>
    [640, 645, 650, 655, 660].flatMap(strike => (["call", "put"] as const).map(type => ({
      contractId: `SPY   ${expiry.slice(2, 10).replaceAll("-", "")}${type === "call" ? "C" : "P"}${String(strike * 1000).padStart(8, "0")}`,
      type, strike, expiry, multiplier: 100 as const, bid: 2, ask: 3, iv: 0.25, quoteAsOf: "2026-09-04T20:00:00.000Z",
    })))),
};

describe("listed market strategies", () => {
  it('returns the independently searched best eligible representative of every selected family', () => {
    const held = { ...createMarketStrategy('bull-call', snapshot), dividendYield: 0 };
    const families = [...CANDIDATE_OPTION_FAMILIES, 'covered-call', 'protective-put', 'collar', 'call-calendar', 'put-calendar', 'call-diagonal', 'put-diagonal'] as const;
    for (const basis of ['mid', 'natural'] as const) for (const objective of ['target-pnl', 'return-on-risk'] as const) {
      const input = { targetSpot: 653, targetDate: snapshot.contracts[0].expiry, maxLoss: 100000, feeAllowance: 5, basis, objective };
      const domain = { families: [...families], maxEntryOutlay: 100000, resultMode: 'best-per-family' as const };
      const result = searchCandidates(held, snapshot, input, domain);
      const representatives = families.flatMap(family => searchCandidates(held, snapshot, input, { families: [family], maxEntryOutlay: domain.maxEntryOutlay }).candidates.slice(0, 1)).sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
      expect(result.candidates).toEqual(representatives);
      expect(result.eligibleFamilies).toBe(representatives.length);
      expect(result.candidates.length).toBeGreaterThan(5);
      expect(new Set(result.candidates.map(candidate => candidateStrategyFamily(candidate.state))).size).toBe(representatives.length);
      expect(result.candidates.every(candidate => candidateStrategyFamily(candidate.state) !== null)).toBe(true);
      expect(result.domain).toEqual(domain);
      expect(searchCandidates(held, { ...snapshot, contracts: [...snapshot.contracts].reverse() }, input, domain)).toEqual(result);
      const legacy = searchCandidates(held, snapshot, input, { families: [...families], maxEntryOutlay: domain.maxEntryOutlay });
      expect(legacy).not.toHaveProperty('eligibleFamilies');
      expect(legacy.candidates).toHaveLength(5);
      expect([legacy.evaluated, legacy.eligible, legacy.excludedBudget, legacy.excludedCost]).toEqual([result.evaluated, result.eligible, result.excludedBudget, result.excludedCost]);
      for (const invalid of [{ ...domain, resultMode: 'unknown' }, { ...domain, extra: true }]) expect(() => searchCandidates(held, snapshot, input, invalid as never)).toThrow();
    }
    const input = { targetSpot: 653, targetDate: snapshot.contracts[0].expiry, maxLoss: 100000, feeAllowance: 5, basis: 'natural' as const, objective: 'expiry-probability' as const };
    const domain = { families: ['options' as const], maxEntryOutlay: 100000, resultMode: 'best-per-family' as const };
    const result = searchCandidates(held, snapshot, input, domain);
    const oracle = CANDIDATE_OPTION_FAMILIES.flatMap(family => searchCandidates(held, snapshot, input, { families: [family], maxEntryOutlay: domain.maxEntryOutlay }).candidates.slice(0, 1)).sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
    expect(result.candidates).toEqual(oracle);
    const empty = searchCandidates(held, snapshot, { ...input, maxLoss: .01 }, domain);
    expect(empty).toMatchObject({ candidates: [], eligibleFamilies: 0 });
  });
  it.each(["short-call-butterfly", "short-put-butterfly", "inverse-iron-butterfly", "inverse-iron-condor"] as const)("searches the quoted inverse orientation %s", template => {
    const shape = createMarketStrategy(template, snapshot);
    const chain = { ...snapshot, contracts: snapshot.contracts.filter(c => shape.legs.some(l => l.contractId === c.contractId)).map(c => {
      const side = shape.legs.find(l => l.contractId === c.contractId)!.side;
      const bid = template.startsWith("short-") ? side === "short" ? 2 : 1 : side === "short" ? 1 : 2;
      return { ...c, bid, ask: bid + .2 };
    }) };
    const before = structuredClone(chain);
    for (const basis of ["mid", "natural"] as const) {
      const held = createMarketStrategy(template, chain, basis);
      const targetSpot = template === "short-put-butterfly" ? Math.max(...held.legs.map(l => l.strike)) : Math.min(...held.legs.map(l => l.strike));
      const input = { targetSpot, targetDate: chain.contracts[0].expiry, maxLoss: 10000, feeAllowance: 5, basis, objective: "target-pnl" as const };
      const result = searchCandidates(held, chain, input);
      const expected = { ...held, legs: held.legs.map(l => ({ ...l, id: l.contractId! })), scenarioSpot: input.targetSpot, scenarioDate: input.targetDate, feeAllowance: 5 };
      const id = expected.legs.map(l => `${l.side}:${l.contractId}${l.contracts === 1 ? "" : `*${l.contracts}`}`).join("|");
      const candidate = result.candidates.find(c => c.id === id);
      expect(candidate, template).toBeDefined();
      expect(candidate!.state.legs).toEqual(expected.legs);
      expect(candidate!.metrics).toEqual(calculateStrategy(expected));
      expect(candidate!.score).toBe(candidate!.metrics.scenarioPnl);
      expect(candidate!.metrics.maxLoss).toBeGreaterThan(0);
      expect(result.planned).toBe(result.evaluated);
      expect(searchCandidates(held, chain, { ...input, maxLoss: candidate!.metrics.maxLoss! - .01 }).candidates.some(c => c.id === id)).toBe(false);
      expect(searchCandidates(held, { ...chain, contracts: [...chain.contracts].reverse() }, input)).toEqual(result);
    }
    expect(chain).toEqual(before);
  });
  it.each([[650, 650], [645, 655]])("searches a minimal long-volatility pair at put %s / call %s", (putStrike, callStrike) => {
    const chain = { ...snapshot, contracts: snapshot.contracts.filter(c => c.expiry === snapshot.contracts[0].expiry && c.strike === (c.type === "put" ? putStrike : callStrike)) };
    const original = structuredClone(chain);
    for (const valuationModel of ["european-bsm-v1", "american-crr-1024-v1"] as const) for (const basis of ["mid", "natural"] as const) {
      const held = { ...createMarketStrategy("long-call", chain), valuationModel };
      const before = structuredClone(held);
      const input = { targetSpot: 670, targetDate: chain.retrievedAt, maxLoss: 1000, feeAllowance: 5, basis, objective: "target-pnl" as const };
      const result = searchCandidates(held, chain, input);
      expect(result).toMatchObject({ planned: 3, evaluated: 3, eligible: 3, excludedRisk: 0, excludedBudget: 0 });
      const pair = result.candidates.find(c => c.state.legs.length === 2)!;
      expect(pair.state.legs.map(l => [l.type, l.strike, l.side, l.contracts, l.entryPrice])).toEqual([
        ["put", putStrike, "long", 1, basis === "mid" ? 2.5 : 3], ["call", callStrike, "long", 1, basis === "mid" ? 2.5 : 3],
      ]);
      expect(pair.id).toBe(pair.state.legs.map(l => `long:${l.contractId}`).join("|"));
      expect(pair.metrics).toEqual(calculateStrategy(pair.state));
      expect(pair.metrics.maxLoss).toBe(basis === "mid" ? 505 : 605);
      expect(pair.score).toBe(pair.metrics.scenarioPnl);
      expect(validateMarketStrategy(pair.state, chain)).toEqual([]);
      expect(searchCandidates(held, chain, { ...input, maxLoss: pair.metrics.maxLoss! })).toMatchObject({ eligible: 3, excludedBudget: 0 });
      const constrained = searchCandidates(held, chain, { ...input, maxLoss: pair.metrics.maxLoss! - .01 });
      expect(constrained).toMatchObject({ evaluated: 3, eligible: 2, excludedBudget: 1 });
      expect(constrained.candidates.every(c => c.state.legs.length === 1)).toBe(true);
      expect(searchCandidates(held, { ...chain, contracts: [...chain.contracts].reverse() }, input)).toEqual(result);
      expect(held).toEqual(before);
    }
    expect(chain).toEqual(original);
  });
  it("does not search reversed-strike or mixed-expiry long-volatility pairs", () => {
    for (const mixedExpiry of [false, true]) {
      const chain = { ...snapshot, contracts: snapshot.contracts.filter(c => c.type === "put" ? c.strike === (mixedExpiry ? 645 : 655) && c.expiry === snapshot.contracts[0].expiry : c.strike === (mixedExpiry ? 655 : 645) && c.expiry === snapshot.contracts[mixedExpiry ? 10 : 0].expiry) };
      const call = chain.contracts.find(c => c.type === "call")!;
      const held = { ...createMarketStrategy("long-call", snapshot), legs: [marketLeg(call, "long", 1, call.contractId, "mid")] };
      const result = searchCandidates(held, chain, { targetSpot: 670, targetDate: chain.retrievedAt, maxLoss: 1000, feeAllowance: 5, basis: "natural", objective: "target-pnl" });
      expect(result).toMatchObject({ planned: 2, evaluated: 2, eligible: 2 });
      expect(result.candidates.every(c => c.state.legs.length === 1)).toBe(true);
    }
  });
  it.each(["bull-call", "bear-call", "bull-put", "bear-put", "long-strangle", "short-strangle", "collar"] as const)("constructs %s from its minimal quoted pair", id => {
    const dense = createMarketStrategy(id, snapshot);
    const chain = { ...snapshot, contracts: snapshot.contracts.filter(c => dense.legs.some(l => l.contractId === c.contractId)) };
    const before = structuredClone(chain);
    expect(chain.contracts.map(c => c.strike).sort((a, b) => a - b)).toEqual([645, 655]);
    for (const basis of ["mid", "natural"] as const) {
      const state = createMarketStrategy(id, chain, basis);
      expect(state.legs).toEqual(createMarketStrategy(id, snapshot, basis).legs);
      expect(validateMarketStrategy(state, chain)).toEqual([]);
      expect(state.stock).toEqual(id === "collar" ? { shares: 100, entryPrice: snapshot.spot } : undefined);
      expect(state.legs.map(l => l.entryPrice)).toEqual(state.legs.map(l => basis === "mid" ? 2.5 : l.side === "long" ? 3 : 2));
      expect(createMarketStrategy(id, { ...chain, contracts: [...chain.contracts].reverse() }, basis)).toEqual(state);
      for (const missing of chain.contracts) expect(() => createMarketStrategy(id, { ...chain, contracts: chain.contracts.filter(c => c !== missing) }, basis)).toThrow(/unavailable/);
      const splitExpiry = { ...chain, contracts: [chain.contracts[0], snapshot.contracts.find(c => c.type === chain.contracts[1].type && c.strike === chain.contracts[1].strike && c.expiry !== chain.contracts[1].expiry)!] };
      expect(() => createMarketStrategy(id, splitExpiry, basis)).toThrow(/unavailable/);
    }
    expect(chain).toEqual(before);
  });
  it.each(["long-strangle", "short-strangle", "collar"] as const)("requires strictly ordered typed strikes for %s", id => {
    for (const [put, call] of [[655, 645], [650, 650]]) {
      const chain = { ...snapshot, contracts: snapshot.contracts.filter(c => c.expiry === snapshot.contracts[0].expiry && c.strike === (c.type === "put" ? put : call)) };
      expect(() => createMarketStrategy(id, chain)).toThrow(/unavailable/);
    }
  });
  it("ranks sparse mixed-type pairs by midpoint then width independent of quote order", () => {
    const chain = { ...snapshot, spot: 647.5, contracts: snapshot.contracts.filter(c => c.expiry === snapshot.contracts[0].expiry && (c.type === "put" ? [640, 645].includes(c.strike) : [650, 655].includes(c.strike))) };
    const state = createMarketStrategy("collar", chain);
    expect(state.legs.map(l => l.strike)).toEqual([645, 650]);
    expect(createMarketStrategy("collar", { ...chain, contracts: [...chain.contracts].reverse() })).toEqual(state);
  });
  it.each(["iron-butterfly", "inverse-iron-butterfly", "iron-condor", "inverse-iron-condor"] as const)("constructs %s from only its required typed contracts", id => {
    const butterfly = id.endsWith("butterfly");
    const required = butterfly ? [["put", 645], ["put", 650], ["call", 650], ["call", 655]] : [["put", 640], ["put", 645], ["call", 655], ["call", 660]];
    const chain = { ...snapshot, contracts: snapshot.contracts.filter(c => c.expiry === snapshot.contracts[0].expiry && required.some(([type, strike]) => c.type === type && c.strike === strike)) };
    const before = structuredClone(chain);
    for (const basis of ["mid", "natural"] as const) {
      const state = createMarketStrategy(id, chain, basis);
      expect(state.legs.map(l => [l.type, l.strike])).toEqual(required);
      expect(validateMarketStrategy(state, chain)).toEqual([]);
      expect(state.legs.map(l => l.entryPrice)).toEqual(state.legs.map(l => basis === "mid" ? 2.5 : l.side === "long" ? 3 : 2));
      expect(createMarketStrategy(id, { ...chain, contracts: [...chain.contracts].reverse() }, basis)).toEqual(state);
      for (const missing of chain.contracts) expect(() => createMarketStrategy(id, { ...chain, contracts: chain.contracts.filter(c => c !== missing) }, basis)).toThrow(/unavailable/);
    }
    expect(chain).toEqual(before);
  });
  it("selects a feasible typed iron butterfly away from an infeasible nearest center", () => {
    const chain = { ...snapshot, spot: 645, contracts: snapshot.contracts.filter(c => c.expiry === snapshot.contracts[0].expiry && (c.type === "put" ? [645, 650].includes(c.strike) : [645, 650, 655].includes(c.strike))) };
    expect(createMarketStrategy("iron-butterfly", chain).legs.map(l => l.strike)).toEqual([645, 650, 650, 655]);
  });
  it("selects feasible inner condor strikes with wings and stable ordering", () => {
    const chain = { ...snapshot, spot: 660, contracts: snapshot.contracts.filter(c => c.expiry === snapshot.contracts[0].expiry && (c.type === "put" ? c.strike <= 650 : c.strike >= 655)) };
    const state = createMarketStrategy("iron-condor", chain);
    expect(state.legs.map(l => l.strike)).toEqual([645, 650, 655, 660]);
    expect(createMarketStrategy("iron-condor", { ...chain, contracts: [...chain.contracts].reverse() })).toEqual(state);
  });
  it("keeps quoted prices unchanged and resets expiry shifts for new candidates", () => {
    const state = createMarketStrategy("call-calendar", snapshot);
    const shifted = { ...state, expiryIvShifts: state.legs.map(leg => ({ expiry: leg.expiry, ivShift: .04 })) };
    expect(validateMarketStrategy(shifted, snapshot)).toEqual([]);
    expect(quoteValuation(shifted, snapshot)).toEqual(quoteValuation(state, snapshot));
    const result = searchCandidates(shifted, snapshot, { targetSpot: 650, targetDate: snapshot.retrievedAt, maxLoss: 100000, feeAllowance: 0, basis: "mid", objective: "target-pnl" });
    expect(result.candidates.length).toBeGreaterThan(0);
    expect(result.candidates.every(candidate => !candidate.state.expiryIvShifts?.length)).toBe(true);
    expect(result.assumptions).toContain("Expiry-specific IV shifts reset to zero");
  });
  it("ranks shared-distribution expiry probability independently of the target scenario", () => {
    const chain = { ...snapshot, contracts: snapshot.contracts.filter(c => c.expiry === snapshot.contracts[0].expiry).map((c, i) => ({ ...c, iv: .15 + i * .02 })) };
    const held = createMarketStrategy("long-call", chain), original = structuredClone(held);
    const input = { targetSpot: 650, targetDate: chain.contracts[0].expiry, maxLoss: 100000, feeAllowance: 5, basis: "natural" as const, objective: "expiry-probability" as const };
    const result = searchCandidates(held, chain, input);
    const reference = chain.contracts.find(c => c.strike === 650 && c.type === "call")!;
    for (const candidate of result.candidates) {
      const probability = expirationProbability({ ...candidate.state, scenarioSpot: chain.spot, scenarioDate: chain.retrievedAt }, undefined, reference);
      expect(candidate.probability).toEqual(probability);
      expect(candidate.score).toBe(probability.probability);
      expect(candidate.score).toBeGreaterThan(0);
      expect(candidate.score).toBeLessThan(1);
      expect(candidate.probability.volatilityContractId).toBe(reference.contractId);
      expect(candidate.state.legs.map(l => l.iv)).toEqual(candidate.state.legs.map(l => chain.contracts.find(c => c.contractId === l.contractId)!.iv));
    }
    const changed = searchCandidates(held, chain, { ...input, targetSpot: 670, targetDate: chain.retrievedAt });
    expect(changed.candidates.map(c => [c.id, c.score])).toEqual(result.candidates.map(c => [c.id, c.score]));
    expect(searchCandidates(held, { ...chain, contracts: [...chain.contracts].reverse() }, input)).toEqual(result);
    expect(held).toEqual(original);
    const unheld = chain.contracts.find(c => c.contractId !== held.legs[0].contractId)!;
    for (const patch of [{ contractId: "invalid" }, { iv: 0 }, { iv: NaN }, { bid: -1 }, { ask: Infinity }]) {
      const invalid = { ...chain, contracts: chain.contracts.map(c => c === unheld ? { ...c, ...patch } : c) };
      expect(() => searchCandidates(held, invalid, input)).toThrow();
    }
    expect(() => searchCandidates({ ...held, ivShift: -.5 }, chain, input)).toThrow();
    expect(() => expirationProbability({ ...held, scenarioSpot: NaN })).toThrow();
  });
  it("exhaustively merges both expiries in the loader's 100-contract window for every objective", () => {
    const chain: MarketSnapshot = { ...snapshot, contracts: snapshot.availableExpiries.flatMap(date => Array.from({ length: 25 }, (_, i) => 638 + i).flatMap(strike => (["call", "put"] as const).map(type => ({
      ...snapshot.contracts[0], expiry: `${date}T20:15:00.000Z`, type, strike,
      contractId: `SPY   ${date.slice(2).replaceAll("-", "")}${type === "call" ? "C" : "P"}${String(strike * 1000).padStart(8, "0")}`,
    })))) };
    const held = createMarketStrategy("long-call", chain), before = structuredClone({ held, chain });
    expect(chain.contracts).toHaveLength(100);
    for (const objective of ["target-pnl", "return-on-risk", "expiry-probability"] as const) {
      const input = { targetSpot: 649, targetDate: chain.retrievedAt, maxLoss: 100000, feeAllowance: 5, basis: "natural" as const, objective };
      const full = searchCandidates(held, chain, input);
      const parts = chain.availableExpiries.map(date => {
        const part = { ...chain, contracts: chain.contracts.filter(c => c.expiry.startsWith(date)) };
        return searchCandidates(createMarketStrategy("long-call", part), part, input);
      });
      expect(full.planned).toBe(64102);
      expect(full.evaluated).toBe(full.planned);
      for (const key of ["planned", "evaluated", "eligible", "excludedRisk", "excludedBudget"] as const) expect(full[key]).toBe(parts.reduce((sum, part) => sum + part[key], 0));
      expect(full.candidates).toEqual(parts.flatMap(part => part.candidates).sort((a, b) => b.score - a.score || a.id.localeCompare(b.id)).slice(0, 5));
      expect({ held, chain }).toEqual(before);
    }
  });
  it("enumerates irregular-grid iron structures and bounds a full-window search", () => {
    const grid = (strikes: number[]): MarketSnapshot => ({ ...snapshot, spot: strikes[2], contracts: strikes.flatMap(strike => (["call", "put"] as const).map(type => ({ ...snapshot.contracts[0], type, strike, contractId: `SPY   260908${type === "call" ? "C" : "P"}${String(Math.round(strike * 1000)).padStart(8, "0")}` }))) });
    const chain = grid([640.001, 642.001, 646.001, 650.001, 660.001]);
    const held = createMarketStrategy("long-call", chain);
    const input = { targetSpot: 649, targetDate: chain.retrievedAt, maxLoss: 100000, feeAllowance: 5, basis: "natural" as const, objective: "target-pnl" as const };
    const result = searchCandidates(held, chain, input);
    // Equal-wing triples are 642/646/650 and 640/650/660, for both types.
    expect(result.evaluated).toBe(103);
    expect(result.planned).toBe(result.evaluated);
    const iron = [];
    for (const a of chain.contracts.filter(c => c.type === "put")) for (const b of chain.contracts.filter(c => c.type === "put" && c.strike > a.strike)) for (const c of chain.contracts.filter(c => c.type === "call" && c.strike >= b.strike)) for (const d of chain.contracts.filter(x => x.type === "call" && x.strike > c.strike)) for (const side of ["long", "short"] as const) {
      const inner = side === "long" ? "short" : "long";
      const legs = [marketLeg(a, side, 1, a.contractId, "natural"), marketLeg(b, inner, 1, b.contractId, "natural"), marketLeg(c, inner, 1, c.contractId, "natural"), marketLeg(d, side, 1, d.contractId, "natural")];
      const metrics = calculateStrategy({ ...held, legs, scenarioSpot: input.targetSpot, scenarioDate: input.targetDate, feeAllowance: 5, pricing: { ...held.pricing!, basis: "natural" } });
      iron.push({ id: legs.map(l => `${l.side}:${l.contractId}`).join("|"), metrics });
    }
    expect(iron).toHaveLength(30);
    for (const candidate of result.candidates.filter(c => c.state.legs.length === 4)) expect(candidate.metrics).toEqual(iron.find(c => c.id === candidate.id)!.metrics);
    const large = grid(Array.from({ length: 40 }, (_, i) => 625 + i));
    const started = performance.now();
    const full = searchCandidates(createMarketStrategy("long-call", large), large, input);
    console.info("80-contract candidate search ms", performance.now() - started, "evaluated", full.evaluated);
    expect(full.candidates).toHaveLength(5);
    expect(full.eligible + full.excludedRisk + full.excludedBudget).toBe(full.evaluated);
    expect(full.evaluated).toBe(208080);
    expect(full.planned).toBe(full.evaluated);
    for (const targetDate of [snapshot.retrievedAt, "2026-09-09T20:00:00.000Z"]) {
      const dated = searchCandidates(createMarketStrategy("long-call", snapshot), snapshot, { ...input, targetDate });
      expect(dated.planned).toBe(dated.evaluated);
      expect(dated.evaluated).toBe(targetDate === snapshot.retrievedAt ? 222 : 111);
    }
    const separated = { ...large, contracts: large.contracts.map(c => c.type === "call" ? { ...c, strike: c.strike + 100, contractId: `${c.contractId.slice(0, 13)}${String((c.strike + 100) * 1000).padStart(8, "0")}` } : c) };
    const price = vi.spyOn(american, "americanPrice");
    try {
      const widest = grid(Array.from({ length: 50 }, (_, i) => 625 + i));
      expect(() => searchCandidates({ ...createMarketStrategy("long-call", widest), valuationModel: "american-crr-1024-v1" }, widest, input)).toThrow(/300,000.*narrow/);
      expect(() => searchCandidates({ ...createMarketStrategy("long-call", separated), valuationModel: "american-crr-1024-v1" }, separated, input)).toThrow(/300,000.*narrow/);
      expect(price).not.toHaveBeenCalled();
      expect(searchCandidates(createMarketStrategy("long-call", separated), separated, { ...input, targetDate: "2026-09-09T20:00:00.000Z" })).toMatchObject({ planned: 0, evaluated: 0, candidates: [] });
    } finally { price.mockRestore(); }
  });
  it("exhaustively ranks quoted long options, long-volatility pairs and verticals without inheriting held costs", () => {
    const chain = { ...snapshot, contracts: snapshot.contracts.filter(c => c.expiry === snapshot.contracts[0].expiry && c.strike >= 645 && c.strike <= 655) };
    for (const valuationModel of ["european-bsm-v1", "american-crr-1024-v1"] as const) {
      const held = { ...createMarketStrategy("long-call", chain), valuationModel, stock: { shares: -83, entryPrice: 42 }, feeAllowance: 999 };
      held.pricing!.entryMode = "fixed"; held.legs[0].entryPrice = 99;
      const original = structuredClone(held);
      const input = { targetSpot: 654, targetDate: chain.retrievedAt, maxLoss: 1000000, feeAllowance: 5, basis: "natural" as const, objective: "target-pnl" as const };
      const result = searchCandidates(held, chain, input);
      expect(result.evaluated).toBe(30);
      expect(result.planned).toBe(result.evaluated);
      expect(result.eligible).toBe(30);
      const alternatives = chain.contracts.flatMap(a => [[marketLeg(a, "long", 1, a.contractId, "natural")], ...chain.contracts.filter(b => b.type === a.type && b.contractId !== a.contractId).map(b => [marketLeg(a, "long", 1, a.contractId, "natural"), marketLeg(b, "short", 1, b.contractId, "natural")])]);
      for (const put of chain.contracts.filter(c => c.type === "put")) for (const call of chain.contracts.filter(c => c.type === "call" && c.strike >= put.strike)) alternatives.push([marketLeg(put, "long", 1, put.contractId, "natural"), marketLeg(call, "long", 1, call.contractId, "natural")]);
      for (const template of ["call-butterfly", "put-butterfly", "iron-butterfly", "short-call-butterfly", "short-put-butterfly", "inverse-iron-butterfly"] as const) alternatives.push(createMarketStrategy(template, chain, "natural").legs);
      const direct = alternatives.map(legs => {
        const state = { ...held, stock: undefined, legs, feeAllowance: 5, scenarioSpot: input.targetSpot, scenarioDate: input.targetDate, pricing: { mode: "market" as const, snapshotId: chain.id, basis: "natural" as const } };
        const metrics = calculateStrategy(state);
        return { id: legs.map(l => `${l.side}:${l.contractId}${l.contracts === 1 ? "" : `*${l.contracts}`}`).join("|"), pnl: metrics.scenarioPnl, riskScore: metrics.scenarioPnl / metrics.maxLoss! };
      }).sort((a, b) => b.pnl - a.pnl || a.id.localeCompare(b.id));
      expect(result.candidates.map(c => ({ id: c.id, pnl: c.metrics.scenarioPnl }))).toEqual(direct.slice(0, 5).map(({ id, pnl }) => ({ id, pnl })));
      const riskRanked = searchCandidates(held, chain, { ...input, objective: "return-on-risk" });
      expect(riskRanked.candidates.map(c => ({ id: c.id, score: c.score }))).toEqual([...direct].sort((a, b) => b.riskScore - a.riskScore || a.id.localeCompare(b.id)).slice(0, 5).map(c => ({ id: c.id, score: c.riskScore })));
      const zero = searchCandidates(held, chain, { ...input, basis: "mid", feeAllowance: 0 });
      expect(zero.excludedRisk).toBe(9);
      expect(zero.eligible + zero.excludedRisk + zero.excludedBudget).toBe(zero.evaluated);
      expect(searchCandidates(held, chain, { ...input, targetDate: "2026-09-09T20:00:00.000Z" })).toMatchObject({ evaluated: 0, candidates: [], excludedBeforeTarget: 6 });
      expect(() => searchCandidates(held, chain, { ...input, targetSpot: NaN })).toThrow();
      expect(() => searchCandidates(held, chain, { ...input, targetDate: "2027-02-30T20:00:00.000Z" })).toThrow();
      expect(() => searchCandidates(held, chain, { ...input, targetDate: "2026-09-01T20:00:00.000Z" })).toThrow();
      for (const candidate of result.candidates) {
        expect(candidate.metrics).toEqual(calculateStrategy(candidate.state));
        expect(candidate.state.stock).toBeUndefined();
        expect(candidate.state.pricing?.entryMode).toBeUndefined();
      }
      expect(searchCandidates(held, { ...chain, contracts: [...chain.contracts].reverse() }, input)).toEqual(result);
      expect(searchCandidates(held, chain, { ...input, maxLoss: 1 }).eligible).toBe(0);
      expect(() => searchCandidates(held, { ...chain, historical: true }, input)).toThrow();
      expect(() => searchCandidates(held, chain, { ...input, maxLoss: 0 })).toThrow();
      expect(held).toEqual(original);
    }
  });
  it("quantifies positive quoted option widths without treating them as fills or fees", () => {
    const state = createMarketStrategy("bull-call", snapshot, "natural");
    state.pricing!.entryMode = "fixed";
    state.legs[0].contracts = 2; state.legs[1].contracts = 3;
    const natural = quoteValuation(state, snapshot);
    expect(natural.optionQuotedSpreadWidth).toBe(500);
    expect(natural.optionMidToNaturalDifference).toBe(250);
    expect(natural.optionSpreadLegs.map(leg => leg.positionWidthUsd)).toEqual([200, 300]);
    const mid = quoteValuation({ ...state, pricing: { ...state.pricing!, basis: "mid" } }, snapshot);
    expect(mid.signedLiquidationValue - natural.signedLiquidationValue).toBe(250);
    const changed = { ...state, stock: { shares: 100, entryPrice: 40 }, feeAllowance: 25, scenarioSpot: 900, legs: state.legs.map(leg => ({ ...leg, side: leg.side === "long" ? "short" as const : "long" as const, entryPrice: 40 })) };
    expect(quoteValuation(changed, snapshot).optionQuotedSpreadWidth).toBe(500);
    const locked = { ...snapshot, contracts: snapshot.contracts.map(contract => ({ ...contract, ask: contract.bid })) };
    expect(quoteValuation(state, locked).optionQuotedSpreadWidth).toBe(0);
  });
  it("selects true diagonals across disjoint expiry grids without fabricating a pair", () => {
    const near = snapshot.contracts[0].expiry;
    for (const id of ["call-diagonal", "put-diagonal"] as const) {
      const farStrike = id === "call-diagonal" ? 645 : 655;
      const disjoint = { ...snapshot, contracts: snapshot.contracts.filter(contract => contract.expiry === near ? contract.strike === 650 : contract.strike === farStrike) };
      const state = createMarketStrategy(id, disjoint, "natural");
      expect(state.legs.map(leg => leg.expiry)).toEqual([near, "2026-09-11T20:15:00.000Z"]);
      expect(state.legs.map(leg => [leg.side, leg.strike, leg.entryPrice])).toEqual([["short", 650, 2], ["long", farStrike, 3]]);
      expect(state.legs[0].expiry < state.legs[1].expiry).toBe(true);
      expect(createMarketStrategy(id, { ...disjoint, contracts: [...disjoint.contracts].reverse() }, "natural").legs).toEqual(state.legs);
      expect(calculateStrategy(state).mode).toBe("first-expiry");
      expect(() => createMarketStrategy(id, { ...snapshot, contracts: snapshot.contracts.filter(contract => contract.expiry === near) })).toThrow(/unavailable/i);
      expect(() => createMarketStrategy(id, { ...snapshot, contracts: snapshot.contracts.filter(contract => contract.strike === 650) })).toThrow(/unavailable/i);
      expect(() => createMarketStrategy(id, { ...snapshot, contracts: snapshot.contracts.filter(contract => contract.expiry === near ? contract.strike === farStrike : contract.strike === 650) })).toThrow(/unavailable/i);
    }
  });
  it("finds real equal-width butterfly wings on uneven grids and rejects absent triples", () => {
    const grid = (strikes: number[], spot: number): MarketSnapshot => ({ ...snapshot, spot, contracts: strikes.map(strike => ({ ...snapshot.contracts[0], strike, contractId: `${snapshot.contracts[0].contractId.slice(0, 13)}${String(Math.round(strike * 1000)).padStart(8, '0')}` })) });
    expect(createMarketStrategy("call-butterfly", grid([105, 110, 114, 115, 116], 112.5)).legs.map(leg => leg.strike)).toEqual([114, 115, 116]);
    expect(createMarketStrategy("call-butterfly", grid([100.001, 100.002, 100.003], 100.002)).legs.map(leg => leg.strike)).toEqual([100.001, 100.002, 100.003]);
    for (const id of ["call-butterfly", "put-butterfly"] as const) {
      const uneven = { ...snapshot, contracts: snapshot.contracts.filter(contract => contract.strike !== 655) };
      const state = createMarketStrategy(id, uneven, "natural");
      expect(state.legs.map(leg => leg.strike)).toEqual([640, 650, 660]);
      expect(state.legs.map(leg => leg.contracts)).toEqual([1, 2, 1]);
      expect(state.legs.map(leg => leg.entryPrice)).toEqual([3, 2, 3]);
      expect(calculateStrategy(state).entryAmount).toBe(200);
      expect(quoteValuation(state, uneven).pnl).toBe(-400);
      const standard = createMarketStrategy(id, snapshot);
      expect(standard.legs.map(leg => leg.strike)).toEqual([645, 650, 655]);
      expect(() => createMarketStrategy(id, { ...snapshot, contracts: snapshot.contracts.filter(contract => [640, 645, 660].includes(contract.strike)) })).toThrow(/unavailable/i);
    }
  });
  it("deducts the flat allowance once from quote P/L but not asset entry or marks", () => {
    const state = createMarketStrategy("bull-call", snapshot);
    const original = quoteValuation(state, snapshot);
    state.feeAllowance = 12.5;
    const marked = quoteValuation(state, snapshot);
    expect(marked.pnl).toBe(original.pnl - 12.5);
    expect(marked.signedEntry).toBe(original.signedEntry);
    expect(marked.signedLiquidationValue).toBe(original.signedLiquidationValue);
    expect(marked.feeAllowance).toBe(12.5);
  });
  it("marks stock at dated underlying spot rather than option quote sides or scenario spot", () => {
    const dated = { ...snapshot, spotAsOf: "2026-09-03T20:00:00.000Z" };
    const base = createMarketStrategy("bull-call", dated, "natural");
    const original = quoteValuation(base, dated);
    for (const shares of [100, -100]) {
      const state = { ...base, scenarioSpot: 700, stock: { shares, entryPrice: 600 } };
      const marks = quoteValuation(state, dated);
      expect(marks.signedStockValue).toBe(shares * 650);
      expect(marks.signedEntry).toBe(original.signedEntry + shares * 600);
      expect(marks.pnl).toBe(original.pnl + shares * 50);
      expect(marks.oldestQuoteAt).toBe(dated.spotAsOf);
      expect(marks.basis).toContain("stock uses a dated underlying spot mark");
      expect(() => quoteValuation(state, { ...dated, spotAsOf: "invalid" })).toThrow(/timestamp/);
    }
  });
  it("constructs templates when spot lies beyond an otherwise sufficient quoted strike window", () => {
    for (const spot of [600, 700]) {
      for (const template of TEMPLATES) {
        const window = { ...snapshot, spot };
        const state = createMarketStrategy(template.id, window);
        expect(validateMarketStrategy(state, window)).toEqual([]);
        expect(new Set(state.legs.map(leg => leg.contractId)).size).toBe(state.legs.length);
      }
    }
    for (const [spot, expected] of [[600, [640, 650]], [650, [645, 655]], [700, [650, 660]]] as const) {
      expect(createMarketStrategy("bull-call", { ...snapshot, spot }).legs.map(leg => leg.strike)).toEqual(expected);
    }
    expect(createMarketStrategy("iron-condor", { ...snapshot, spot: 700 }).legs.map(leg => leg.strike)).toEqual([640, 645, 655, 660]);
  });
  it("allows held entry costs without trusting changed IV or identities", () => {
    const state = createMarketStrategy("bull-call", snapshot);
    state.pricing!.entryMode = "fixed";
    for (const price of [0, 1, 99]) {
      state.legs[0].entryPrice = price;
      expect(validateMarketStrategy(state, snapshot)).toEqual([]);
    }
    expect(scenarioFacts(state).valuation.entryBasis).toMatch(/not broker-verified fills/i);
    for (const price of [-1, NaN, Infinity]) {
      const changed = structuredClone(state);
      changed.legs[0].entryPrice = price;
      expect(validateMarketStrategy(changed, snapshot).length).toBeGreaterThan(0);
    }
    for (const field of ["iv", "strike", "multiplier"] as const) {
      const changed = structuredClone(state);
      changed.legs[0][field] += 1;
      expect(validateMarketStrategy(changed, snapshot).length).toBeGreaterThan(0);
    }
    expect(validateStrategy({ ...state, pricing: { ...state.pricing!, entryMode: "other" as "fixed" } }).length).toBeGreaterThan(0);
    const prior = { ...state.legs[0], entryPrice: 1.23 };
    const contract = snapshot.contracts.find(c => c.contractId === prior.contractId)!;
    expect(marketLeg(contract, "long", 3, "renamed", "natural", prior).entryPrice).toBe(1.23);
    expect(marketLeg(contract, "short", 3, "renamed", "natural", prior).entryPrice).toBe(2);
    expect(marketLeg(snapshot.contracts[0], "long", 3, "renamed", "natural", prior).entryPrice).toBe(3);
  });
  it("marks liquidation on the opposite natural side with signed costs and dated provenance", () => {
    const dated = structuredClone(snapshot);
    dated.historical = true;
    const state = createMarketStrategy("bull-call", dated, "natural");
    state.pricing!.entryMode = "fixed";
    state.legs[0].contracts = 2;
    state.legs[0].entryPrice = 1;
    state.legs[1].entryPrice = 4;
    dated.contracts.find(c => c.contractId === state.legs[0].contractId)!.quoteAsOf = "2026-09-04T19:59:00Z";
    const marked = quoteValuation(state, dated);
    expect(marked).toMatchObject({ signedEntry: -200, signedLiquidationValue: 100, pnl: 300, historical: true, oldestQuoteAt: "2026-09-04T19:59:00.000Z", newestQuoteAt: "2026-09-04T20:00:00.000Z" });
    expect(marked.basis).toMatch(/longs at bid.*shorts at ask/i);
    state.pricing!.basis = "mid";
    expect(quoteValuation(state, dated)).toMatchObject({ signedEntry: -200, signedLiquidationValue: 250, pnl: 450 });
    state.legs[0].iv = 9;
    expect(() => quoteValuation(state, dated)).toThrow();
  });
  it("constructs all catalog templates and preserves sample mode", () => {
    for (const template of TEMPLATES) {
      const state = createMarketStrategy(template.id, snapshot);
      expect(validateMarketStrategy(state, snapshot)).toEqual([]);
      expect(state.spot).toBe(650);
      expect(state.legs.every(leg => snapshot.contracts.some(contract => contract.contractId === leg.contractId))).toBe(true);
      expect(Number.isFinite(calculateStrategy(state).entryAmount)).toBe(true);
      expect(validateStrategy(createStrategy(template.id))).toEqual([]);
    }
  });
  it("uses midpoint or side-aware natural prices", () => {
    expect(marketLeg({ ...snapshot.contracts[0], bid: 2.34, ask: 2.35 }, "long").entryPrice).toBe(2.345);
    expect(marketLeg(snapshot.contracts[0], "long").entryPrice).toBe(2.5);
    expect(marketLeg(snapshot.contracts[0], "long", 2, "leg", "natural").entryPrice).toBe(3);
    expect(marketLeg(snapshot.contracts[0], "short", 1, "leg", "natural").entryPrice).toBe(2);
  });
  it("rejects tampered authoritative fields while allowing scenario edits", () => {
    const state = createMarketStrategy("bull-call", snapshot);
    for (const field of ["entryPrice", "strike", "iv", "multiplier"] as const) {
      const changed = structuredClone(state);
      changed.legs[0][field] += 1;
      expect(validateMarketStrategy(changed, snapshot).length).toBeGreaterThan(0);
    }
    expect(validateMarketStrategy({ ...state, spot: 651 }, snapshot).length).toBeGreaterThan(0);
    expect(validateMarketStrategy({ ...state, valuationTimestamp: "2026-09-05T13:00:00.000Z" }, snapshot).length).toBeGreaterThan(0);
    expect(validateMarketStrategy({ ...state, pricing: { ...state.pricing!, snapshotId: "other" } }, snapshot).length).toBeGreaterThan(0);
    expect(validateMarketStrategy({ ...state, scenarioSpot: 660, ivShift: 0.02 }, snapshot)).toEqual([]);
    expect(validateStrategy({ ...state, pricing: undefined }).length).toBeGreaterThan(0);
    const invented = structuredClone(state);
    invented.legs[0].contractId = "SPY   260908C00649000";
    invented.legs[0].strike = 649;
    expect(validateStrategy(invented)).toEqual([]);
    expect(validateMarketStrategy(invented, snapshot).length).toBeGreaterThan(0);
    const natural = createMarketStrategy("bull-call", snapshot, "natural");
    expect(validateMarketStrategy(natural, snapshot)).toEqual([]);
    expect(natural.legs.map(leg => leg.entryPrice)).toEqual([3, 2]);
    expect(validateMarketStrategy({ ...natural, pricing: { ...natural.pricing!, basis: "mid" } }, snapshot).length).toBeGreaterThan(0);
  });
  it("does not fabricate wings or calendars from incomplete catalogs", () => {
    for (const id of ["short-call", "short-put", "short-straddle", "short-strangle"] as const) {
      const state = createMarketStrategy(id, snapshot, "natural");
      for (const leg of state.legs) {
        expect(leg.side).toBe("short");
        expect(leg.entryPrice).toBe(snapshot.contracts.find(contract => contract.contractId === leg.contractId)!.bid);
      }
      expect(state.stock).toBeUndefined();
      if (id === "short-straddle") expect(state.legs[0].strike).toBe(state.legs[1].strike);
      if (id === "short-strangle") expect(state.legs[0].strike).toBeGreaterThan(state.legs[1].strike);
    }
    expect(() => createMarketStrategy("short-strangle", { ...snapshot, contracts: snapshot.contracts.filter(contract => contract.strike === 650) })).toThrow(/unavailable/i);
    const sparse = { ...snapshot, contracts: snapshot.contracts.filter(contract => contract.strike === 650) };
    expect(() => createMarketStrategy("iron-condor", sparse)).toThrow(/unavailable/i);
    expect(() => createMarketStrategy("call-calendar", { ...snapshot, contracts: snapshot.contracts.filter(contract => contract.expiry.startsWith("2026-09-08")) })).toThrow(/unavailable/i);
    const calendar = createMarketStrategy("put-calendar", snapshot);
    expect(calendar.legs[0].strike).toBe(calendar.legs[1].strike);
    expect(calendar.legs[0].expiry).not.toBe(calendar.legs[1].expiry);
  });
  it("preserves exact space-padded OCC identity and rejects rewritten IDs", () => {
    const state = createMarketStrategy("long-call", snapshot);
    expect(state.legs[0].contractId).toBe("SPY   260908C00650000");
    expect(validateMarketStrategy(state, snapshot)).toEqual([]);
    state.legs[0].contractId = state.legs[0].contractId.replaceAll(" ", "");
    expect(validateStrategy(state)).toContain(`${state.legs[0].id}: invalid market contract identity`);
  });
});
