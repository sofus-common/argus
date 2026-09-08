import { expect, it, vi } from "vitest";
import { createStrategy, quoteValuation, type MarketSnapshot } from "../src/options";
import { createPosition, recordClose } from "../src/position-lifecycle";
import { upgradePositionLots, projectPositionLots, projectPositionLotsAt, recordLotTransaction, valuePositionLots, recordLotPriceCorrection, recordLotCloseVoid, recordLotOpeningPriceCorrection, recordExpiryResolution, recordExpiryVoid, type LotTransaction, type LotAsset } from "../src/position-lots";

const at = "2026-09-05T12:00:00.000Z";
const fixture = (side: "long" | "short" = "long") => {
  const state = createStrategy("long-call");
  state.legs[0].contracts = 2; state.legs[0].entryPrice = 2; state.legs[0].side = side; state.feeAllowance = 7;
  return createPosition(state);
};
const asset = (base = fixture()): LotAsset => {
  const { contractId, type, strike, expiry, multiplier } = base.initial.legs[0];
  return { kind: "option", contractId, type, strike, expiry, multiplier };
};
const transaction = (patch: Partial<LotTransaction> = {}): LotTransaction => ({ id: "tx", at, recordedAt: at, closes: [], opens: [], ...patch });

it('retains cash-index kind across ledger round trips and rejects stock openings', () => {
  const state = createStrategy('long-call');
  state.underlying = 'XSP'; state.underlyingKind = 'cash-index';
  state.legs = state.legs.map(leg => ({ ...leg, contractId: `XSP   ${leg.expiry.slice(2, 10).replaceAll('-', '')}C${String(leg.strike * 1000).padStart(8, '0')}` }));
  state.pricing = { mode: 'market', snapshotId: 'index', basis: 'mid', entryMode: 'fixed' };
  const base = createPosition(state), ledger = upgradePositionLots(base);
  const opened = recordLotTransaction(ledger, transaction({ opens: [{ id: 'added', asset: asset(base), side: 'long', quantity: 1, entryPrice: 3 }] }));
  const restored = JSON.parse(JSON.stringify(opened));
  expect(restored.legacy.initial.underlyingKind).toBe('cash-index');
  expect(projectPositionLots(restored).lots).toHaveLength(2);
  const snapshot: MarketSnapshot = { id: 'index', underlying: 'XSP', underlyingKind: 'cash-index', contractTerms: { exerciseStyle: 'European', settlement: 'cash', multiplier: 100, settlementSession: 'PM' }, source: 'Tastytrade', spot: state.spot, retrievedAt: at, spotAsOf: at, indexSourceTime: at, availableExpiries: [state.legs[0].expiry.slice(0, 10)], contracts: state.legs.map(leg => ({ contractId: leg.contractId, type: leg.type, strike: leg.strike, expiry: leg.expiry, multiplier: 100, bid: 3, ask: 5, iv: leg.iv, quoteAsOf: at })) };
  expect(valuePositionLots(restored, snapshot, 'mid').remainingState?.underlyingKind).toBe('cash-index');
  expect(() => valuePositionLots(restored, { ...snapshot, underlyingKind: undefined, contractTerms: undefined }, 'mid')).toThrow();
  expect(() => recordLotTransaction(ledger, transaction({ opens: [{ id: 'stock', asset: { kind: 'stock', symbol: 'XSP' }, side: 'long', quantity: 1, entryPrice: 100 }] }))).toThrow();
});

it("reconstructs dated holdings through a roll using latest corrected costs and close prices", () => {
  const base = fixture(); base.initial.stock = { shares: -10, entryPrice: 100 }; base.initial.excludedLegIds = [base.initial.legs[0].id];
  const legacy = recordClose(base, { id: "legacy-close", assetId: `option:${base.initial.legs[0].id}`, quantity: 1, price: 3, at });
  const later = "2026-09-05T13:00:00.000Z", final = "2026-09-05T14:00:00.000Z";
  let position = recordLotTransaction(upgradePositionLots(legacy), transaction({ at: later, recordedAt: later, closes: [{ id: "roll-close", lotId: "initial:option:0", quantity: 1, price: 4 }], opens: [{ id: "replacement", asset: asset(base), side: "long", quantity: 1, entryPrice: 5 }] }));
  position = recordLotOpeningPriceCorrection(position, { id: "entry-fix", lotId: "initial:option:0", price: 2.5, reason: "Correct entry", recordedAt: final });
  position = recordLotPriceCorrection(position, { id: "exit-fix", closeId: "legacy-close", price: 3.5, reason: "Correct exit", recordedAt: final });
  position = recordLotTransaction(position, transaction({ id: "finish", at: final, recordedAt: final, closes: [{ id: "finish-option", lotId: "replacement", quantity: 1, price: 6 }, { id: "finish-stock", lotId: "initial:stock", quantity: 10, price: 90 }] }));
  const before = structuredClone(position), initial = projectPositionLotsAt(position, base.initial.valuationTimestamp);
  expect(initial).toMatchObject({ grossRealizedPnl: 0, allowance: 7, status: "open", netClosedPnl: null, lots: [{ quantity: 2, entryPrice: 2.5 }, { side: "short", quantity: 10 }] });
  expect(initial.basis).toContain("restated");
  expect(projectPositionLotsAt(position, at)).toMatchObject({ grossRealizedPnl: 100, lots: [{ id: "initial:option:0", quantity: 1 }, { id: "initial:stock", quantity: 10 }] });
  const rolled = projectPositionLotsAt(position, later);
  expect(rolled).toMatchObject({ grossRealizedPnl: 250, lots: [{ id: "initial:stock" }, { id: "replacement", quantity: 1, entryPrice: 5 }] });
  const full = projectPositionLots(position), ended = projectPositionLotsAt(position, final);
  expect(ended).toMatchObject({ cutoff: final, status: "closed", lots: full.lots, grossRealizedPnl: full.grossRealizedPnl, netClosedPnl: full.netClosedPnl });
  expect(ended.netClosedPnl).toBe(443);
  initial.lots[0].quantity = 99; initial.lots[0].asset.kind = "stock";
  expect(position).toEqual(before);
});

it("restates voided legacy and lot closes while keeping future opening IDs stable", () => {
  const base = fixture(), later = "2026-09-05T13:00:00.000Z";
  const legacy = recordClose(base, { id: "initial:option:0", assetId: `option:${base.initial.legs[0].id}`, quantity: 1, price: 3, at });
  let position = upgradePositionLots(legacy);
  const stableId = projectPositionLots(position).openings[0].id;
  expect(stableId).toBe("initial:option:0:1");
  position = recordLotTransaction(position, transaction({ closes: [{ id: "lot-close", lotId: stableId, quantity: 1, price: 4 }] }));
  position = recordLotCloseVoid(position, { id: "legacy-void", closeId: "initial:option:0", reason: "No fill", recordedAt: later });
  position = recordLotCloseVoid(position, { id: "lot-void", closeId: "lot-close", reason: "No fill", recordedAt: later });
  const initial = projectPositionLotsAt(position, base.initial.valuationTimestamp);
  expect(initial.lots).toMatchObject([{ id: stableId, quantity: 2 }]);
  expect(projectPositionLotsAt(position, at)).toMatchObject({ grossRealizedPnl: 0, lots: [{ id: stableId, quantity: 2 }] });
  expect(projectPositionLotsAt(position, later).lots).toEqual(projectPositionLots(position).lots);
});

it("rejects invalid cutoffs and corruption after the requested historical date", () => {
  const position = recordLotTransaction(upgradePositionLots(fixture()), transaction({ closes: [{ id: "close", lotId: "initial:option:0", quantity: 1, price: 3 }] }));
  for (const cutoff of ["invalid", "2026-09-05T12:00:00Z", "2026-02-30T12:00:00.000Z", "2000-01-01T00:00:00.000Z", "2099-01-01T00:00:00.000Z"]) expect(() => projectPositionLotsAt(position, cutoff)).toThrow();
  const corrupt = structuredClone(position); corrupt.transactions[0].closes[0].quantity = 99;
  expect(() => projectPositionLotsAt(corrupt, position.legacy.initial.valuationTimestamp)).toThrow();
});

it.each(["long", "short"] as const)("reconciles %s dated lots with corrected added basis and same-time events", side => {
  const base = fixture(side); base.initial.stock = { shares: side === "long" ? 10 : -10, entryPrice: 100 };
  let position = recordLotTransaction(upgradePositionLots(base), transaction({ opens: [{ id: "added", asset: asset(base), side, quantity: 1, entryPrice: 5 }] }));
  position = recordLotTransaction(position, transaction({ id: "exit", closes: [{ id: "added-close", lotId: "added", quantity: 1, price: 7 }, { id: "stock-close", lotId: "initial:stock", quantity: 10, price: 110 }] }));
  position = recordLotOpeningPriceCorrection(position, { id: "added-basis", lotId: "added", price: 6, reason: "Correct entry", recordedAt: at });
  position = recordLotPriceCorrection(position, { id: "added-price", closeId: "added-close", price: 8, reason: "Correct exit", recordedAt: at });
  const initial = projectPositionLotsAt(position, base.initial.valuationTimestamp);
  expect(initial.lots.map(lot => lot.id)).toEqual(["initial:option:0", "initial:stock"]);
  expect(initial.grossRealizedPnl).toBe(0);
  const dated = projectPositionLotsAt(position, at), full = projectPositionLots(position);
  expect(dated.lots).toEqual(full.lots);
  expect(dated.grossRealizedPnl).toBe(side === "long" ? 300 : -300);
  expect(dated.grossRealizedPnl).toBe(full.grossRealizedPnl);
});

it("corrects initial opening basis across legacy closes, rolls and remaining lots without rewriting history", () => {
  let base = fixture(); base.initial.legs[0].contracts = 3;
  base = recordClose(base, { id: "legacy-exit", assetId: `option:${base.initial.legs[0].id}`, quantity: 1, price: 3, at });
  const rolled = recordLotTransaction(upgradePositionLots(base), transaction({ closes: [{ id: "roll-exit", lotId: "initial:option:0", quantity: 1, price: 4 }], opens: [{ id: "roll-open", asset: asset(base), side: "long", quantity: 1, entryPrice: 6 }] }));
  const raw = JSON.stringify(rolled), request = { id: "opening-fix", lotId: "initial:option:0", price: 2.5, reason: "Entry transcription", recordedAt: at };
  const corrected = recordLotOpeningPriceCorrection(rolled, request), projection = projectPositionLots(corrected);
  expect(projection).toMatchObject({ grossRealizedPnl: 200, version: projectPositionLots(rolled).version + 1, asOf: at });
  expect(projection.lots.map(lot => [lot.id, lot.quantity, lot.entryPrice])).toEqual([["initial:option:0", 1, 2.5], ["roll-open", 1, 6]]);
  expect(projection.openings).toMatchObject([{ id: "initial:option:0", quantity: 3, entryPrice: 2.5, originalEntryPrice: 2 }, { id: "roll-open", entryPrice: 6, originalEntryPrice: 6 }]);
  expect(corrected.legacy).toEqual(rolled.legacy); expect(corrected.transactions).toEqual(rolled.transactions); expect(JSON.stringify(rolled)).toBe(raw);
  const closeCorrected = recordLotPriceCorrection(corrected, { id: "exit-fix", closeId: "roll-exit", price: 5, reason: "Exit transcription", recordedAt: at });
  expect(projectPositionLots(closeCorrected).grossRealizedPnl).toBe(300);
  const voided = recordLotCloseVoid(closeCorrected, { id: "exit-void", closeId: "roll-exit", reason: "No fill", recordedAt: at });
  expect(projectPositionLots(voided)).toMatchObject({ grossRealizedPnl: 50, lots: [{ quantity: 2, entryPrice: 2.5 }, { id: "roll-open", quantity: 1, entryPrice: 6 }] });
  expect(projectPositionLots(JSON.parse(JSON.stringify(voided)))).toEqual(projectPositionLots(voided));
  const corrupt = structuredClone(corrected); corrupt.legacy.closes[0].entryPrice = 2.5;
  expect(() => projectPositionLots(corrupt)).toThrow(/basis mismatch/);
});

it("corrects fully closed added options and shares with long and short signs and immutable retries", () => {
  for (const side of ["long", "short"] as const) for (const stock of [false, true]) {
    const base = fixture(side), openingAsset: LotAsset = stock ? { kind: "stock", symbol: base.initial.underlying } : asset(base);
    const added = recordLotTransaction(upgradePositionLots(base), transaction({ opens: [{ id: "added", asset: openingAsset, side, quantity: 2, entryPrice: 5 }] }));
    const closed = recordLotTransaction(added, transaction({ id: "exit", closes: [{ id: "close-added", lotId: "added", quantity: 2, price: 7 }] }));
    const request = { id: "entry-fix", lotId: "added", price: 6, reason: "Entry transcription", recordedAt: at };
    const corrected = recordLotOpeningPriceCorrection(closed, request), projection = projectPositionLots(corrected);
    expect(projection.grossRealizedPnl).toBe(2 * (stock ? 1 : 100) * (side === "long" ? 1 : -1));
    expect(projection.openings.find(lot => lot.id === "added")).toMatchObject({ quantity: 2, entryPrice: 6, originalEntryPrice: 5 });
    expect(projection.lots.some(lot => lot.id === "added")).toBe(false);
    expect(recordLotOpeningPriceCorrection(corrected, { recordedAt: at, reason: request.reason, price: 6, lotId: "added", id: "entry-fix" })).toEqual(corrected);
    expect(() => recordLotOpeningPriceCorrection(corrected, { ...request, price: 7 })).toThrow();
    expect(recordLotTransaction(corrected, added.transactions[0])).toEqual(corrected);
    const corrupt = structuredClone(corrected); corrupt.transactions[0].opens[0].entryPrice = -1;
    expect(() => projectPositionLots(corrupt)).toThrow();
    for (const patch of [{ lotId: "missing" }, { price: -1 }, { price: Infinity }, { price: 1e308 }, { reason: " " }, { recordedAt: "2099-01-01T00:00:00.000Z" }, { recordedAt: base.initial.valuationTimestamp }, { id: "added" }, { id: "exit" }, { id: "close-added" }, { extra: true }]) expect(() => recordLotOpeningPriceCorrection(closed, { ...request, ...patch })).toThrow();
  }
});

it("audits lot corrections and voids, preserves history and restores explicit basis", () => {
  const base = fixture(), added = recordLotTransaction(upgradePositionLots(base), transaction({ opens: [{ id: "five", asset: asset(base), side: "long", quantity: 1, entryPrice: 5 }] }));
  const exited = recordLotTransaction(added, transaction({ id: "exit", closes: [{ id: "exit-five", lotId: "five", quantity: 1, price: 4 }] }));
  const correction = { id: "fix-five", closeId: "exit-five", price: 6, reason: "Transcription", recordedAt: at };
  const corrected = recordLotPriceCorrection(exited, correction);
  expect(projectPositionLots(exited).grossRealizedPnl).toBe(-100);
  expect(projectPositionLots(corrected)).toMatchObject({ grossRealizedPnl: 100, version: projectPositionLots(exited).version });
  const request = { id: "void-five", closeId: "exit-five", reason: "No fill", recordedAt: at };
  const voided = recordLotCloseVoid(corrected, request);
  expect(projectPositionLots(voided)).toMatchObject({ grossRealizedPnl: 0, version: projectPositionLots(exited).version + 1 });
  expect(projectPositionLots(voided).lots.map(lot => [lot.id, lot.quantity, lot.entryPrice])).toEqual([["initial:option:0", 2, 2], ["five", 1, 5]]);
  expect(voided.transactions).toEqual(exited.transactions); expect(voided.legacy).toEqual(base);
  expect(recordLotPriceCorrection(voided, { recordedAt: at, reason: "Transcription", price: 6, closeId: "exit-five", id: "fix-five" })).toEqual(voided);
  expect(recordLotCloseVoid(voided, request)).toEqual(voided);
  expect(() => recordLotPriceCorrection(voided, { ...correction, id: "late" })).toThrow();
  expect(() => recordLotCloseVoid(voided, { ...request, id: "twice" })).toThrow();
  const reclosed = recordLotTransaction(voided, transaction({ id: "actual", closes: [{ id: "actual-five", lotId: "five", quantity: 1, price: 7 }] }));
  expect(projectPositionLots(reclosed).grossRealizedPnl).toBe(200);
  const corrupt = structuredClone(voided); corrupt.transactions[1].closes[0].quantity = 2;
  expect(() => recordLotCloseVoid(corrupt, request)).toThrow();
  expect(projectPositionLots(JSON.parse(JSON.stringify(reclosed)))).toEqual(projectPositionLots(reclosed));
});

it("amends legacy closes without rewriting v1 and rejects dependent opposite-side restoration", () => {
  let base = fixture(); base = recordClose(base, { id: "old-close", assetId: `option:${base.initial.legs[0].id}`, quantity: 2, price: 4, at });
  const position = upgradePositionLots(base), raw = JSON.stringify(base);
  const corrected = recordLotPriceCorrection(position, { id: "old-fix", closeId: "old-close", price: 3, reason: "Fix", recordedAt: at });
  expect(projectPositionLots(corrected).grossRealizedPnl).toBe(200);
  const restored = recordLotCloseVoid(corrected, { id: "old-void", closeId: "old-close", reason: "No fill", recordedAt: at });
  expect(projectPositionLots(restored)).toMatchObject({ grossRealizedPnl: 0, lots: [{ id: "initial:option:0", quantity: 2 }] });
  expect(JSON.stringify(restored.legacy)).toBe(raw);
  const reopened = recordLotTransaction(position, transaction({ opens: [{ id: "opposite", asset: asset(base), side: "short", quantity: 1, entryPrice: 3 }] }));
  expect(() => recordLotCloseVoid(reopened, { id: "no", closeId: "old-close", reason: "No fill", recordedAt: at })).toThrow(/Opposite/);
  const short = fixture("short"), start = upgradePositionLots(short), lotId = projectPositionLots(start).lots[0].id;
  const flipped = recordLotTransaction(start, transaction({ closes: [{ id: "cover", lotId, quantity: 2, price: 1 }], opens: [{ id: "buy", asset: asset(short), side: "long", quantity: 1, entryPrice: 2 }] }));
  expect(() => recordLotCloseVoid(flipped, { id: "undo-cover", closeId: "cover", reason: "No fill", recordedAt: at })).toThrow(/Opposite/);
});

it("enforces amendment global IDs, recorded-time order and immutable retry payloads", () => {
  const position = upgradePositionLots(fixture()), lotId = projectPositionLots(position).lots[0].id;
  const closed = recordLotTransaction(position, transaction({ closes: [{ id: "exit", lotId, quantity: 1, price: 3 }] }));
  const correction = { id: "fix", closeId: "exit", price: 4, reason: "Fix", recordedAt: "2026-09-05T12:00:01.000Z" };
  for (const id of [lotId, "exit", "tx"]) expect(() => recordLotPriceCorrection(closed, { ...correction, id })).toThrow();
  const corrected = recordLotPriceCorrection(closed, correction);
  expect(() => recordLotCloseVoid(corrected, { id: "void", closeId: "exit", reason: "No fill", recordedAt: at })).toThrow();
  expect(() => recordLotTransaction(corrected, transaction({ id: "earlier", closes: [{ id: "next", lotId, quantity: 1, price: 2 }] }))).toThrow();
  expect(recordLotTransaction(corrected, closed.transactions[0])).toEqual(corrected);
  expect(() => recordLotPriceCorrection(corrected, { ...correction, reason: "Other" })).toThrow();
  expect(() => recordLotPriceCorrection(corrected, { ...correction, extra: true } as unknown as typeof correction)).toThrow();
});

it("rejects replay spending inventory before its restoring void was recorded", () => {
  const base = fixture(); base.initial.legs[0].contracts = 1;
  const start = upgradePositionLots(base), lotId = projectPositionLots(start).lots[0].id;
  const closed = recordLotTransaction(start, transaction({ closes: [{ id: "exit", lotId, quantity: 1, price: 3 }] }));
  const restored = recordLotCloseVoid(closed, { id: "restore", closeId: "exit", reason: "No fill", recordedAt: "2026-09-05T13:00:00.000Z" });
  const reclose = transaction({ id: "reclose", recordedAt: "2026-09-05T13:00:00.000Z", closes: [{ id: "actual", lotId, quantity: 1, price: 4 }] });
  const valid = recordLotTransaction(restored, reclose);
  expect(projectPositionLots(valid).grossRealizedPnl).toBe(200);
  const corrupt = JSON.parse(JSON.stringify(valid)); corrupt.transactions[1].recordedAt = "2026-09-05T12:30:00.000Z";
  expect(() => projectPositionLots(corrupt)).toThrow();
  const legacy = recordClose(base, { id: "legacy-exit", assetId: `option:${base.initial.legs[0].id}`, quantity: 1, price: 3, at });
  const legacyRestored = recordLotCloseVoid(upgradePositionLots(legacy), { id: "legacy-restore", closeId: "legacy-exit", reason: "No fill", recordedAt: "2026-09-05T13:00:00.000Z" });
  const legacyValid = recordLotTransaction(legacyRestored, reclose);
  const legacyCorrupt = structuredClone(legacyValid); legacyCorrupt.transactions[0].recordedAt = "2026-09-05T12:30:00.000Z";
  expect(() => projectPositionLots(legacyCorrupt)).toThrow();
  const two = upgradePositionLots(fixture());
  const first = recordLotTransaction(two, transaction({ closes: [{ id: "first", lotId, quantity: 1, price: 3 }] }));
  const independent = recordLotTransaction(first, transaction({ id: "independent", recordedAt: "2026-09-05T12:30:00.000Z", closes: [{ id: "second", lotId, quantity: 1, price: 4 }] }));
  const amended = recordLotCloseVoid(independent, { id: "late-void", closeId: "first", reason: "No fill", recordedAt: "2026-09-05T13:00:00.000Z" });
  expect(projectPositionLots(amended)).toMatchObject({ grossRealizedPnl: 200, lots: [{ quantity: 1 }] });
});

const marketFixture = () => {
  const base = fixture(), leg = base.initial.legs[0];
  leg.contractId = `SPY   ${leg.contractId.slice(3)}`;
  base.initial.pricing = { mode: "market", snapshotId: "original", basis: "mid", entryMode: "fixed" };
  const snapshot: MarketSnapshot = { id: "mark", underlying: "SPY", source: "Tastytrade", spot: 600, spotAsOf: at, retrievedAt: at, availableExpiries: [leg.expiry.slice(0, 10)], contracts: [{ contractId: leg.contractId, type: leg.type, strike: leg.strike, expiry: leg.expiry, multiplier: 100, iv: leg.iv, bid: 2, ask: 4, quoteAsOf: at }] };
  return { base, snapshot };
};

it('records and voids explicit expiry without rewriting trades or inferring marks', () => {
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime('2026-09-22T12:00:00.000Z');
  try {
    const { base } = marketFixture(); base.initial.stock = { shares: 1, entryPrice: 100 };
    const expiry = base.initial.legs[0].expiry, later = '2026-09-21T12:00:00.000Z';
    const before = recordLotTransaction(upgradePositionLots(base), transaction({ at: later, recordedAt: later, closes: [{ id: 'stock-exit', lotId: 'initial:stock', quantity: 1, price: 110 }] }));
    const request = { id: 'expired', lotId: 'initial:option:0', quantity: 2, outcome: 'no-exercise' as const, settlementValue: null, recordedAt: later, reason: 'Broker confirms no exercise' };
    const resolved = recordExpiryResolution(before, request);
    expect(projectPositionLots(resolved)).toMatchObject({ lots: [], grossRealizedPnl: -390, netClosedPnl: -397, asOf: later });
    expect(projectPositionLotsAt(resolved, expiry)).toMatchObject({ grossRealizedPnl: -400, lots: [{ id: 'initial:stock' }] });
    expect(projectPositionLotsAt(resolved, new Date(Date.parse(expiry) - 1).toISOString()).lots).toHaveLength(2);
    expect(recordExpiryResolution(resolved, request)).toEqual(resolved);
    expect(resolved.transactions).toEqual(before.transactions);
    expect(() => recordExpiryResolution(resolved, { ...request, id: 'twice' })).toThrow();
    const fixed = recordLotOpeningPriceCorrection(resolved, { id: 'basis', lotId: request.lotId, price: 3, reason: 'Correct entry', recordedAt: later });
    expect(projectPositionLots(fixed).grossRealizedPnl).toBe(-590);
    const voidRequest = { id: 'undo-expiry', resolutionId: request.id, reason: 'Broker correction', recordedAt: later };
    const voided = recordExpiryVoid(fixed, voidRequest);
    expect(projectPositionLots(voided)).toMatchObject({ grossRealizedPnl: 10, lots: [{ quantity: 2, entryPrice: 3 }], netClosedPnl: null });
    expect(recordExpiryVoid(voided, voidRequest)).toEqual(voided);
    expect(projectPositionLots(JSON.parse(JSON.stringify(voided)))).toEqual(projectPositionLots(voided));
  } finally { vi.useRealTimers(); }
});

it('settles listed XSP calls and puts with signed cash arithmetic and rejects unsupported identity', () => {
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime('2026-09-22T12:00:00.000Z');
  try {
    for (const side of ['long', 'short'] as const) for (const type of ['call', 'put'] as const) for (const payoff of [0, 5]) {
      const { base } = marketFixture(), leg = base.initial.legs[0];
      base.initial.underlying = 'XSP'; base.initial.underlyingKind = 'cash-index';
      leg.side = side; leg.type = type; leg.contractId = `XSP   ${leg.expiry.slice(2, 10).replaceAll('-', '')}${type === 'call' ? 'C' : 'P'}${String(leg.strike * 1000).padStart(8, '0')}`;
      const start = upgradePositionLots(base), request = { id: 'cash', lotId: 'initial:option:0', quantity: 1, outcome: 'cash-settlement' as const, settlementValue: leg.strike + payoff * (type === 'call' ? 1 : -1), reason: 'Official settlement reference', recordedAt: '2026-09-21T12:00:00.000Z' };
      const settled = recordExpiryResolution(start, request), expected = (payoff - 2) * 100 * (side === 'long' ? 1 : -1);
      expect(projectPositionLots(settled)).toMatchObject({ grossRealizedPnl: expected, lots: [{ quantity: 1 }], netClosedPnl: null });
      expect(projectPositionLotsAt(settled, leg.expiry).grossRealizedPnl).toBe(expected);
      const noExercise = recordExpiryResolution(start, { ...request, outcome: 'no-exercise', settlementValue: null });
      expect(projectPositionLots(noExercise).grossRealizedPnl).toBe(-200 * (side === 'long' ? 1 : -1));
      expect(() => recordExpiryResolution(settled, { ...request, reason: 'Changed retry' })).toThrow();
      expect(() => recordExpiryResolution(start, { ...request, extra: true } as typeof request)).toThrow();
      for (const patch of [{ quantity: 3 }, { quantity: .5 }, { settlementValue: -1 }, { settlementValue: null }, { settlementValue: Infinity }, { recordedAt: at }, { recordedAt: '2099-01-01T00:00:00.000Z' }, { reason: '' }, { lotId: 'missing' }, { id: 'initial:option:0' }]) expect(() => recordExpiryResolution(start, { ...request, ...patch })).toThrow();
      const wrong = structuredClone(start); wrong.legacy.initial.underlyingKind = undefined;
      expect(() => recordExpiryResolution(wrong, request)).toThrow();
      const equity = upgradePositionLots(marketFixture().base);
      expect(() => recordExpiryResolution(equity, request)).toThrow();
      expect(() => recordExpiryResolution(upgradePositionLots(fixture()), { ...request, outcome: 'no-exercise', settlementValue: null })).toThrow();
    }
  } finally { vi.useRealTimers(); }
});

it('keeps expiry audit ordering across later trades, restores and immutable retries', () => {
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime('2026-09-22T12:00:00.000Z');
  try {
    const { base } = marketFixture(), early = '2026-09-19T12:00:00.000Z', late = '2026-09-21T12:00:00.000Z';
    const request = { id: 'expiry', lotId: 'initial:option:0', quantity: 2, outcome: 'no-exercise' as const, settlementValue: null, recordedAt: early, reason: 'Broker record' };
    const resolved = recordExpiryResolution(upgradePositionLots(base), request);
    expect(() => recordLotTransaction(resolved, transaction({ opens: [{ id: 'too-early', asset: { kind: 'stock', symbol: 'SPY' }, side: 'long', quantity: 1, entryPrice: 100 }] }))).toThrow();
    const laterTrade = transaction({ id: 'later', at: late, recordedAt: late, opens: [{ id: 'stock', asset: { kind: 'stock', symbol: 'SPY' }, side: 'long', quantity: 1, entryPrice: 100 }] });
    const later = recordLotTransaction(resolved, laterTrade);
    expect(recordExpiryResolution(later, request)).toEqual(later);
    expect(() => recordExpiryVoid(later, { id: 'void', resolutionId: request.id, recordedAt: early, reason: 'Correction' })).toThrow();
    const voided = recordExpiryVoid(later, { id: 'void', resolutionId: request.id, recordedAt: late, reason: 'Correction' });
    expect(() => recordExpiryResolution(voided, { ...request, id: 'too-early' })).toThrow();
    const replacement = recordExpiryResolution(voided, { ...request, id: 'replacement', recordedAt: late });
    expect(projectPositionLots(replacement).grossRealizedPnl).toBe(-400);
    const corrupt = structuredClone(replacement); corrupt.expiryResolutions![1].recordedAt = early;
    expect(() => projectPositionLots(corrupt)).toThrow();
    const restored = recordExpiryVoid(resolved, { id: 'void', resolutionId: request.id, recordedAt: late, reason: 'Correction' });
    const reclosed = recordLotTransaction(restored, transaction({ id: 'backfilled', recordedAt: late, closes: [{ id: 'actual-close', lotId: request.lotId, quantity: 2, price: 3 }] }));
    expect(projectPositionLots(reclosed).grossRealizedPnl).toBe(200);
    expect(() => recordExpiryResolution(reclosed, { ...request, id: 'overlap', recordedAt: late })).toThrow();
    const badClose = structuredClone(reclosed); badClose.transactions[0].recordedAt = early;
    expect(() => projectPositionLots(badClose)).toThrow();
  } finally { vi.useRealTimers(); }
});

it("marks all excluded lots and remaps only surviving initial selection without changing audit", () => {
  const { base, snapshot } = marketFixture(), leg = base.initial.legs[0];
  base.initial.excludedLegIds = [leg.id];
  base.initial.scenarioDate = "2027-01-01T00:00:00.000Z";
  const position = upgradePositionLots(base), raw = JSON.stringify(position);
  const marked = valuePositionLots(position, snapshot, "mid");
  expect(marked.unrealizedPnl).toBe(200);
  expect(marked.combinedPnl).toBe(193);
  expect(marked.remainingState?.excludedLegIds).toEqual([leg.contractId]);
  expect(marked.remainingState?.scenarioDate).toBe(at);
  expect(() => valuePositionLots(position, { ...snapshot, contracts: [] }, "mid")).toThrow(/Remaining option/);
  const partial = recordLotTransaction(position, transaction({ closes: [{ id: "partial", lotId: "initial:option:0", quantity: 1, price: 3 }] }));
  expect(valuePositionLots(partial, snapshot, "mid").remainingState?.excludedLegIds).toEqual([leg.contractId]);
  const replaced = recordLotTransaction(position, transaction({ closes: [{ id: "close", lotId: "initial:option:0", quantity: 2, price: 3 }], opens: [{ id: "new", asset: asset(base), side: "long", quantity: 1, entryPrice: 4 }] }));
  expect(valuePositionLots(replaced, snapshot, "mid").remainingState?.excludedLegIds).toEqual([]);
  expect(JSON.stringify(position)).toBe(raw);
});

it("uses corrected entry basis in dated marks and initial-share realized accounting", () => {
  const { base, snapshot } = marketFixture();
  base.initial.legs[0].contracts = 3;
  const closed = recordClose(base, { id: "partial", assetId: `option:${base.initial.legs[0].id}`, quantity: 1, price: 4, at });
  const position = upgradePositionLots(closed), before = valuePositionLots(position, snapshot, "mid");
  const request = { id: "fix-entry", lotId: "initial:option:0", price: 2.5, reason: "Entry transcription", recordedAt: at };
  const corrected = recordLotOpeningPriceCorrection(position, request), after = valuePositionLots(corrected, snapshot, "mid");
  expect(after.grossRealizedPnl - before.grossRealizedPnl).toBe(-50);
  expect(after.unrealizedPnl - before.unrealizedPnl).toBe(-100);
  expect(after.combinedPnl - before.combinedPnl).toBe(-150);
  expect(after.remainingState?.legs).toMatchObject([{ contracts: 2, entryPrice: 2.5 }]);
  expect(after.allowance).toBe(7);
  const later = recordLotOpeningPriceCorrection(corrected, { ...request, id: "fix-again", price: 3, recordedAt: "2026-09-05T13:00:00.000Z" });
  expect(projectPositionLots(later).openings[0]).toMatchObject({ originalEntryPrice: 2, entryPrice: 3 });
  expect(() => recordLotOpeningPriceCorrection(later, { ...request, id: "earlier" })).toThrow();
  expect(recordLotOpeningPriceCorrection(later, request)).toEqual(later);
  for (const side of [1, -1]) {
    const shares = fixture(); shares.initial.stock = { shares: 3 * side, entryPrice: 40 };
    const partial = recordClose(shares, { id: "share-close", assetId: "stock", quantity: 1, price: 45, at });
    const fixed = recordLotOpeningPriceCorrection(upgradePositionLots(partial), { ...request, lotId: "initial:stock", price: 42 });
    expect(projectPositionLots(fixed).grossRealizedPnl).toBe(3 * side);
    expect(projectPositionLots(fixed).lots.find(lot => lot.id === "initial:stock")).toMatchObject({ quantity: 2, entryPrice: 42 });
    expect(fixed.legacy).toEqual(partial);
  }
});

it("values distinct lots and aggregates held basis only for the chart", () => {
  const { base, snapshot } = marketFixture();
  base.initial.valuationModel = "american-crr-1024-v1"; base.initial.rate = .03; base.initial.dividendYield = .02; base.initial.ivShift = .1;
  const added = recordLotTransaction(upgradePositionLots(base), transaction({ opens: [{ id: "five", asset: asset(base), side: "long", quantity: 1, entryPrice: 5 }] }));
  const before = valuePositionLots(added, snapshot, "mid");
  expect(before.remainingState?.legs).toMatchObject([{ contracts: 3, entryPrice: 3 }]);
  expect(before.lotMarks.map(mark => mark.unrealizedPnl)).toEqual([200, -200]);
  expect(before.combinedPnl).toBe(-7);
  expect(quoteValuation(before.remainingState!, snapshot).pnl).toBe(before.unrealizedPnl);
  expect(before.remainingState).toMatchObject({ valuationModel: "american-crr-1024-v1", rate: .03, dividendYield: .02, ivShift: .1 });
  const fractional = recordLotTransaction(upgradePositionLots(base), transaction({ opens: [{ id: "four", asset: asset(base), side: "long", quantity: 1, entryPrice: 4 }] }));
  const fractionValue = valuePositionLots(fractional, snapshot, "mid");
  expect(fractionValue.remainingState?.legs[0].entryPrice).toBe(8 / 3);
  expect(quoteValuation(fractionValue.remainingState!, snapshot).pnl).toBe(fractionValue.unrealizedPnl);
  const closed = recordLotTransaction(added, transaction({ id: "close", closes: [{ id: "five-close", lotId: "five", quantity: 1, price: 4 }] }));
  const original = JSON.stringify(closed), valued = valuePositionLots(closed, snapshot, "mid");
  expect(valued).toMatchObject({ grossRealizedPnl: -100, unrealizedPnl: 200, allowance: 7, combinedPnl: 93, remainingState: { feeAllowance: 0, legs: [{ contracts: 2, entryPrice: 2 }] } });
  expect(valuePositionLots(closed, snapshot, "natural").combinedPnl).toBe(-107);
  expect(JSON.stringify(closed)).toBe(original);
  for (const bad of [{ ...snapshot, contracts: [] }, { ...snapshot, contracts: [...snapshot.contracts, ...snapshot.contracts] }, { ...snapshot, spotAsOf: "2026-09-04T12:00:00Z" }, { ...snapshot, contracts: [{ ...snapshot.contracts[0], sourceTimes: { bid: "2026-09-04T12:00:00Z", ask: at, iv: at } }] }, { ...snapshot, contracts: [{ ...snapshot.contracts[0], bid: 5 }] }]) expect(() => valuePositionLots(closed, bad, "mid")).toThrow();
  expect(valuePositionLots(closed, { ...snapshot, historical: true }, "mid").remainingState?.pricing?.historical).toBe(true);
  const invalidIv = valuePositionLots(closed, { ...snapshot, contracts: [{ ...snapshot.contracts[0], iv: 0 }] }, "mid");
  expect(invalidIv).toMatchObject({ combinedPnl: 93, remainingState: null });
  expect(invalidIv.analysisUnavailable).toContain("IV");
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime("2026-09-19T00:00:00.000Z");
  try {
    const expiry = snapshot.contracts[0].expiry;
    expect(() => valuePositionLots(closed, { ...snapshot, retrievedAt: expiry, spotAsOf: expiry, contracts: [{ ...snapshot.contracts[0], quoteAsOf: expiry }] }, "mid")).toThrow(/Remaining option/);
    expect(projectPositionLots(closed).lots).toHaveLength(1);
  } finally { vi.useRealTimers(); }
});

it("marks shorts at ask and returns stock-only holdings for share-price analysis", () => {
  const { base, snapshot } = marketFixture();
  base.initial.legs[0].side = "short"; base.initial.stock = { shares: -3, entryPrice: 602 };
  const position = upgradePositionLots(base), valued = valuePositionLots(position, snapshot, "natural");
  expect(valued).toMatchObject({ unrealizedPnl: -394, combinedPnl: -401 });
  expect(quoteValuation(valued.remainingState!, snapshot).pnl).toBe(-394);
  const closed = recordLotTransaction(position, transaction({ closes: [{ id: "exit", lotId: projectPositionLots(position).lots[0].id, quantity: 2, price: 1 }] }));
  const remaining = valuePositionLots(closed, { ...snapshot, contracts: [] }, "mid");
  expect(remaining).toMatchObject({ grossRealizedPnl: 200, unrealizedPnl: 6, combinedPnl: 199, analysisUnavailable: null, remainingState: { legs: [], stock: { shares: -3, entryPrice: 602 }, feeAllowance: 0 } });
  expect(quoteValuation(remaining.remainingState!, { ...snapshot, contracts: [] }).pnl).toBe(6);
});

it("retains every marked lot when inventory exceeds chart limits", () => {
  const { base, snapshot } = marketFixture(), template = snapshot.contracts[0];
  const contracts = Array.from({ length: 8 }, (_, i) => ({ ...template, contractId: `SPY   ${template.expiry.slice(2, 10).replaceAll("-", "")}C${String((110 + i) * 1000).padStart(8, "0")}`, strike: 110 + i }));
  const position = recordLotTransaction(upgradePositionLots(base), transaction({ opens: contracts.map(c => ({ id: c.contractId, asset: { kind: "option", contractId: c.contractId, type: c.type, strike: c.strike, expiry: c.expiry, multiplier: c.multiplier }, side: "long", quantity: 1, entryPrice: 2 })) }));
  const valued = valuePositionLots(position, { ...snapshot, contracts: [template, ...contracts] }, "mid");
  expect(valued.lotMarks).toHaveLength(9);
  expect(valued).toMatchObject({ unrealizedPnl: 1000, combinedPnl: 993, remainingState: null });
  expect(valued.analysisUnavailable).toContain("eight");
});

it("preserves legacy expiry spelling while matching the equivalent canonical opening", () => {
  const base = fixture(), leg = base.initial.legs[0];
  leg.contractId = `SPY   ${leg.contractId.slice(3)}`;
  leg.expiry = leg.expiry.replace(".000Z", "Z");
  base.initial.pricing = { mode: "market", snapshotId: "original", basis: "mid", entryMode: "fixed" };
  const original = JSON.stringify(base), opening = asset(base);
  if (opening.kind !== "option") throw new Error("Expected option fixture");
  opening.expiry = new Date(opening.expiry).toISOString();
  const result = recordLotTransaction(upgradePositionLots(base), transaction({ opens: [{ id: "canonical", asset: opening, side: "long", quantity: 1, entryPrice: 3 }] }));
  expect(projectPositionLots(result).lots).toHaveLength(2);
  expect(JSON.stringify(result.legacy)).toBe(original);
});

it("preserves v1 and allocates a close to its explicit opening lot", () => {
  const base = fixture(), original = JSON.stringify(base);
  const position = upgradePositionLots(base);
  const added = recordLotTransaction(position, transaction({ opens: [{ id: "add", asset: asset(base), side: "long", quantity: 1, entryPrice: 5 }] }));
  expect(projectPositionLots(added).lots.map(lot => [lot.quantity, lot.entryPrice])).toEqual([[2, 2], [1, 5]]);
  const reorderedAsset = Object.fromEntries(Object.entries(asset(base)).reverse()) as LotAsset;
  expect(recordLotTransaction(position, transaction({ opens: [{ id: "add", asset: reorderedAsset, side: "long", quantity: 1, entryPrice: 5 }] }))).toEqual(added);
  expect(recordLotTransaction(added, transaction({ opens: [{ id: "add", asset: reorderedAsset, side: "long", quantity: 1, entryPrice: 5 }] }))).toEqual(added);
  const close = transaction({ id: "close-tx", closes: [{ id: "close-added", lotId: "add", quantity: 1, price: 4 }] });
  const closed = recordLotTransaction(added, close), projection = projectPositionLots(closed);
  expect(projection.grossRealizedPnl).toBe(-100);
  expect(projection.lots.map(lot => [lot.quantity, lot.entryPrice])).toEqual([[2, 2]]);
  expect(projection.grossRealizedPnl + 200 - projection.allowance).toBe(93);
  expect(recordLotTransaction(closed, close)).toEqual(closed);
  expect(recordLotTransaction(closed, { opens: close.opens, closes: [{ price: 4, quantity: 1, lotId: "add", id: "close-added" }], recordedAt: at, at, id: close.id })).toEqual(closed);
  expect(() => recordLotTransaction(closed, { ...close, closes: [{ ...close.closes[0], extra: true }] } as unknown as LotTransaction)).toThrow();
  expect(() => recordLotTransaction(closed, { ...close, closes: [{ ...close.closes[0], price: 9 }] })).toThrow();
  expect(JSON.stringify(base)).toBe(original);
  expect(closed.legacy).toEqual(base);
  expect(projectPositionLots(JSON.parse(JSON.stringify(closed)))).toEqual(projection);
});

it("rolls short lots atomically, permits equal-time dependencies and explicit side reopening", () => {
  const base = fixture("short"); base.initial.legs[0].contracts = 1; base.initial.legs[0].entryPrice = 4;
  const position = upgradePositionLots(base), lotId = projectPositionLots(position).lots[0].id;
  const roll = transaction({ closes: [{ id: "buy-back", lotId, quantity: 1, price: 1.5 }], opens: [{ id: "replacement", asset: asset(base), side: "short", quantity: 1, entryPrice: 3 }] });
  const rolled = recordLotTransaction(position, roll);
  expect(projectPositionLots(rolled).grossRealizedPnl).toBe(250);
  expect(projectPositionLots(rolled).grossRealizedPnl - 100 - 7).toBe(143);
  const flipped = recordLotTransaction(rolled, transaction({ id: "flip", closes: [{ id: "exit", lotId: "replacement", quantity: 1, price: 4 }], opens: [{ id: "long", asset: asset(base), side: "long", quantity: 2, entryPrice: 4 }] }));
  expect(projectPositionLots(flipped)).toMatchObject({ grossRealizedPnl: 150, lots: [{ id: "long", quantity: 2, side: "long" }] });
  const before = JSON.stringify(position);
  expect(() => recordLotTransaction(position, { ...roll, opens: [{ ...roll.opens[0], entryPrice: -1 }] })).toThrow();
  expect(() => recordLotTransaction(position, transaction({ opens: [{ ...roll.opens[0], side: "long" }] }))).toThrow();
  expect(JSON.stringify(position)).toBe(before);
});

it("supports signed stock lots without implicit FIFO", () => {
  const base = fixture(); base.initial.stock = { shares: -83, entryPrice: 42 };
  const position = upgradePositionLots(base), stock = projectPositionLots(position).lots.find(lot => lot.asset.kind === "stock")!;
  const next = recordLotTransaction(position, transaction({ closes: [{ id: "stock-close", lotId: stock.id, quantity: 20, price: 40 }], opens: [{ id: "stock-add", asset: { kind: "stock", symbol: "SPY" }, side: "short", quantity: 10, entryPrice: 41 }] }));
  expect(projectPositionLots(next).grossRealizedPnl).toBe(40);
  expect(projectPositionLots(next).lots.filter(lot => lot.asset.kind === "stock").map(lot => [lot.quantity, lot.entryPrice])).toEqual([[63, 42], [10, 41]]);
});

it("rejects corruption, global ID conflicts, unknown allocations and invalid dates before retry", () => {
  let base = fixture();
  base = recordClose(base, { id: "legacy-close", assetId: `option:${base.initial.legs[0].id}`, quantity: 1, price: 3, at });
  const position = upgradePositionLots(base);
  const valid = transaction({ opens: [{ id: "add", asset: asset(base), side: "long", quantity: 1, entryPrice: 5 }] });
  const recorded = recordLotTransaction(position, valid), corrupt = structuredClone(recorded);
  corrupt.legacy.closes[0].entryPrice = 99;
  expect(() => recordLotTransaction(corrupt, valid)).toThrow();
  for (const bad of [transaction({ id: "legacy-close", opens: valid.opens }), transaction({ at: "2026-09-04T12:00:00.000Z", opens: valid.opens }), transaction({ recordedAt: "2026-09-05T11:00:00.000Z", opens: valid.opens }), transaction({ at: "2099-01-01T00:00:00.000Z", opens: valid.opens }), transaction({ closes: [{ id: "bad", lotId: "missing", quantity: 1, price: 2 }] }), transaction({ opens: [{ ...valid.opens[0], quantity: Number.MAX_SAFE_INTEGER + 1 }] }), transaction({ opens: [{ ...valid.opens[0], entryPrice: 1e308 }] })]) expect(() => recordLotTransaction(position, bad)).toThrow();
  expect(() => recordLotTransaction(position, { ...valid, unexpected: true } as LotTransaction)).toThrow();
});

it("reserves exhausted initial lots and permits inventory wider than chart limits", () => {
  let base = fixture();
  const initialId = projectPositionLots(upgradePositionLots(base)).lots[0].id;
  base = recordClose(base, { id: "all", assetId: `option:${base.initial.legs[0].id}`, quantity: 2, price: 3, at });
  const position = upgradePositionLots(base);
  expect(() => recordLotTransaction(position, transaction({ opens: [{ id: initialId, asset: asset(base), side: "long", quantity: 1, entryPrice: 2 }] }))).toThrow();
  const market = fixture();
  const leg = market.initial.legs[0]; leg.contractId = `SPY   ${leg.contractId.slice(3)}`;
  market.initial.pricing = { mode: "market", snapshotId: "original", basis: "mid", entryMode: "fixed" };
  const marketPosition = upgradePositionLots(market), marketLotId = projectPositionLots(marketPosition).lots[0].id;
  const marketClosed = recordLotTransaction(marketPosition, transaction({ closes: [{ id: "exit-all", lotId: marketLotId, quantity: 2, price: 3 }] }));
  expect(() => recordLotTransaction(marketClosed, transaction({ id: "reopen", opens: [{ id: "changed", asset: { ...asset(market), expiry: leg.expiry.replace("20:00", "21:00") } as LotAsset, side: "short", quantity: 1, entryPrice: 3 }] }))).toThrow(/identity/);
  const opens = Array.from({ length: 5 }, (_, index) => {
    const expiry = ["2026-09-18T20:00:00.000Z", "2026-09-25T20:00:00.000Z", "2026-10-02T20:00:00.000Z"][index % 3], strike = 110 + index;
    return { id: `new-${index}`, asset: { kind: "option" as const, contractId: `SPY   ${expiry.slice(2, 10).replaceAll("-", "")}C${String(strike * 1000).padStart(8, "0")}`, type: "call" as const, strike, expiry, multiplier: 100 }, side: "long" as const, quantity: 1, entryPrice: 2 };
  });
  const wide = recordLotTransaction(upgradePositionLots(market), transaction({ opens }));
  expect(projectPositionLots(wide).lots).toHaveLength(6);
  expect(new Set(projectPositionLots(wide).lots.filter(lot => lot.asset.kind === "option").map(lot => lot.asset.kind === "option" && lot.asset.expiry)).size).toBeGreaterThan(2);
  const later = recordLotTransaction(position, transaction({ recordedAt: "2026-09-05T12:00:01.000Z", opens: [{ id: "new", asset: asset(base), side: "long", quantity: 1, entryPrice: 2 }] }));
  expect(() => recordLotTransaction(later, transaction({ id: "too-early-recording", opens: [{ id: "newer", asset: asset(base), side: "long", quantity: 1, entryPrice: 2 }] }))).toThrow();
});
