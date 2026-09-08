import { describe, expect, it, vi } from "vitest";
import { createStrategy, type MarketSnapshot } from "../src/options";
import { createPosition, projectPosition, recordClose, recordPriceCorrection, recordCloseVoid, valuePosition } from "../src/position-lifecycle";

const fixture = () => {
  const state = createStrategy("long-call");
  state.legs[0].contracts = 3; state.legs[0].entryPrice = 2;
  state.stock = { shares: 83, entryPrice: 42 }; state.feeAllowance = 7;
  return state;
};
const at = "2026-09-05T12:00:00.000Z";

it("keeps excluded inventory in the audit and prunes selection only after actual closure", () => {
  const state = createStrategy("call-calendar"), excluded = state.legs[0];
  state.excludedLegIds = [excluded.id];
  state.scenarioDate = state.legs[1].expiry;
  const position = createPosition(state);
  expect(projectPosition(position).active?.legs).toEqual(state.legs);
  expect(projectPosition(position).active?.excludedLegIds).toEqual([excluded.id]);
  const closed = recordClose(position, { id: "excluded-close", assetId: `option:${excluded.id}`, quantity: excluded.contracts, price: 2, at });
  expect(projectPosition(closed).active?.excludedLegIds).toEqual([]);
  expect(closed.initial).toEqual(state);
  expect(projectPosition(recordCloseVoid(closed, { id: "undo-close", closeId: "excluded-close", reason: "No fill", recordedAt: at })).active?.excludedLegIds).toEqual([excluded.id]);
  expect(() => createPosition({ ...state, legs: [], excludedLegIds: [] })).toThrow(/Lifecycle/);
  expect(() => createPosition({ ...state, excludedLegIds: ["missing"] })).toThrow(/Lifecycle/);
  expect(() => createPosition({ ...state, excludedLegIds: [excluded.id, excluded.id] })).toThrow(/Lifecycle/);
});

it("prunes closed expiry assumptions without rewriting historical basis", () => {
  const initial = createStrategy("call-calendar");
  initial.expiryIvShifts = initial.legs.map(leg => ({ expiry: leg.expiry, ivShift: .03 }));
  const position = recordClose(createPosition(initial), { id: "front", assetId: `option:${initial.legs[0].id}`, quantity: 1, price: 1, at });
  expect(projectPosition(position).active?.expiryIvShifts).toEqual([initial.expiryIvShifts[1]]);
  expect(position.initial).toEqual(initial);
});

it("freezes serialized v1 audit and retry behavior before opening-lot migration", () => {
  const initial = fixture(), assetId = `option:${initial.legs[0].id}`;
  const wrong = { id: "wrong", assetId, quantity: 1, price: 5, at };
  const correction = { id: "correction", closeId: wrong.id, price: 6, reason: "Recorded price", recordedAt: at };
  const cancelled = { id: "cancelled", closeId: wrong.id, reason: "No actual fill", recordedAt: at };
  const option = { id: "actual", assetId, quantity: 3, price: 3, at };
  const stock = { id: "shares", assetId: "stock", quantity: 83, price: 43, at };
  let position = recordClose(createPosition(initial), wrong);
  position = recordPriceCorrection(position, correction);
  position = recordCloseVoid(position, cancelled);
  position = recordClose(recordClose(position, option), stock);
  const persisted = JSON.parse(JSON.stringify(position));
  expect(persisted).toEqual({
    schemaVersion: 1, initial,
    closes: [
      { ...wrong, entryPrice: 2, side: "long", multiplier: 100, contractId: initial.legs[0].contractId },
      { ...option, entryPrice: 2, side: "long", multiplier: 100, contractId: initial.legs[0].contractId },
      { ...stock, entryPrice: 42, side: "long", multiplier: 1, contractId: "SPY" },
    ],
    priceCorrections: [correction], closeVoids: [cancelled],
  });
  expect(projectPosition(persisted)).toMatchObject({ status: "closed", active: null, stock: null, asOf: at, grossRealizedPnl: 383, allowance: 7, netClosedPnl: 376 });
  expect(recordClose(persisted, wrong)).toEqual(persisted);
  expect(recordClose(persisted, option)).toEqual(persisted);
  expect(recordPriceCorrection(persisted, correction)).toEqual(persisted);
  expect(recordCloseVoid(persisted, cancelled)).toEqual(persisted);
  expect(() => recordClose(persisted, { ...option, quantity: 2 })).toThrow(/conflict/);
});

it("voids erroneous closes without deleting history and permits closing restored inventory", () => {
  const state = fixture(), close = { id: "wrong", assetId: `option:${state.legs[0].id}`, quantity: 3, price: 4, at };
  let original = recordClose(createPosition(state), close);
  original = recordPriceCorrection(original, { id: "price", closeId: close.id, price: 5, reason: "Price", recordedAt: at });
  const request = { id: "void", closeId: close.id, reason: "No fill occurred", recordedAt: at };
  const voided = recordCloseVoid(original, request);
  expect(voided.closes).toEqual(original.closes);
  expect(voided.priceCorrections).toEqual(original.priceCorrections);
  expect(projectPosition(voided)).toMatchObject({ grossRealizedPnl: 0, allowance: 7, asOf: state.valuationTimestamp, active: { legs: [{ contracts: 3, entryPrice: 2 }], version: state.version + 2 } });
  expect(recordCloseVoid(voided, request)).toEqual(voided);
  expect(() => recordCloseVoid(voided, { ...request, id: "twice" })).toThrow();
  expect(() => recordCloseVoid(voided, { ...request, reason: "changed" })).toThrow();
  const later = recordClose(voided, { ...close, id: "actual", price: 3 });
  expect(projectPosition(later)).toMatchObject({ status: "stock-only", grossRealizedPnl: 300 });
  expect(() => recordPriceCorrection(voided, { id: "after", closeId: close.id, price: 2, reason: "No", recordedAt: at })).toThrow();
  expect(() => recordClose(voided, { ...close, id: request.id })).toThrow();
  const corrupt = structuredClone(voided); corrupt.closes[0].entryPrice = 99;
  expect(() => recordCloseVoid(corrupt, request)).toThrow();
  expect(projectPosition(JSON.parse(JSON.stringify(later)))).toEqual(projectPosition(later));
  for (const patch of [{ closeId: "missing" }, { reason: " " }, { recordedAt: "2099-01-01T00:00:00.000Z" }, { id: "price" }, { id: close.id }]) expect(() => recordCloseVoid(original, { ...request, ...patch })).toThrow();
  const lateCorrection = structuredClone(voided); lateCorrection.priceCorrections![0].recordedAt = "2026-09-05T12:00:01.000Z";
  expect(() => projectPosition(lateCorrection)).toThrow(/follows/);
  const short = fixture(); short.legs[0].side = "short"; short.stock!.shares = -83;
  let both = recordClose(createPosition(short), { ...close, price: 1 });
  both = recordClose(both, { id: "shares", assetId: "stock", quantity: 83, price: 40, at });
  both = recordCloseVoid(both, request);
  expect(projectPosition(both)).toMatchObject({ grossRealizedPnl: 166, active: { legs: [{ contracts: 3, side: "short" }] } });
  both = recordCloseVoid(both, { ...request, id: "void-shares", closeId: "shares" });
  expect(projectPosition(both)).toMatchObject({ grossRealizedPnl: 0, allowance: 7, stock: { shares: -83, entryPrice: 42 } });
  expect(() => recordClose(voided, { ...close, id: "over", quantity: 4 })).toThrow();
  const lateClose = recordClose(createPosition(state), { ...close, at: "2026-09-05T12:00:01.000Z" });
  const lateVoid = recordCloseVoid(lateClose, { ...request, recordedAt: "2026-09-05T12:00:01.000Z" });
  expect(() => recordClose(lateVoid, { ...close, id: "earlier" })).toThrow();
});

it("audits close-price corrections without rewriting fills or inventory", () => {
  const state = fixture(), close = { id: "close", assetId: `option:${state.legs[0].id}`, quantity: 1, price: 3, at };
  const original = recordClose(createPosition(state), close);
  const correction = { id: "fix", closeId: close.id, price: 4.125, reason: "Broker fill transcription", recordedAt: at };
  const corrected = recordPriceCorrection(original, correction);
  expect(corrected.closes).toEqual(original.closes);
  expect(projectPosition(corrected)).toMatchObject({ grossRealizedPnl: 212.5, active: { legs: [{ contracts: 2, entryPrice: 2 }] } });
  expect(recordPriceCorrection(corrected, correction)).toEqual(corrected);
  expect(() => recordPriceCorrection(corrected, { ...correction, price: 5 })).toThrow();
  const again = recordPriceCorrection(corrected, { ...correction, id: "fix-again", price: 1 });
  expect(projectPosition(again).grossRealizedPnl).toBe(-100);
  expect(original).not.toHaveProperty("priceCorrections");
  expect(projectPosition(JSON.parse(JSON.stringify(again)))).toEqual(projectPosition(again));
  for (const patch of [{ closeId: "missing" }, { price: -1 }, { price: Infinity }, { reason: " " }, { recordedAt: "2099-01-01T00:00:00.000Z" }, { recordedAt: "2026-09-04T12:00:00.000Z" }, { id: close.id }]) expect(() => recordPriceCorrection(original, { ...correction, ...patch })).toThrow();
  expect(() => recordClose(corrected, { ...close, id: correction.id })).toThrow();
  expect(projectPosition(corrected).asOf).toBe(projectPosition(original).asOf);
  expect(projectPosition(corrected).active?.version).toBe(projectPosition(original).active?.version);
  const corrupt = structuredClone(corrected); corrupt.priceCorrections![0].reason = "";
  expect(() => recordPriceCorrection(corrupt, correction)).toThrow();
  expect(() => recordPriceCorrection(original, { ...correction, price: 1e308 })).toThrow();
  expect(() => recordPriceCorrection(original, { ...correction, extra: true } as typeof correction)).toThrow();
  expect(() => projectPosition({ ...original, priceCorrections: null } as unknown as typeof original)).toThrow();
  const later = recordPriceCorrection(original, { ...correction, recordedAt: "2026-09-05T12:00:01.000Z" });
  expect(() => recordPriceCorrection(later, { ...correction, id: "earlier" })).toThrow();
  const short = fixture(); short.legs[0].side = "short"; short.stock!.shares = -83;
  let finished = recordClose(createPosition(short), { ...close, quantity: 3, price: 1 });
  finished = recordClose(finished, { id: "stock", assetId: "stock", quantity: 83, price: 40, at });
  finished = recordPriceCorrection(finished, { ...correction, price: 1.5 });
  finished = recordPriceCorrection(finished, { ...correction, id: "stock-fix", closeId: "stock", price: 41 });
  expect(projectPosition(finished)).toMatchObject({ status: "closed", grossRealizedPnl: 233, netClosedPnl: 226 });
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-09-19T12:00:00Z"));
  try {
    expect(projectPosition(recordPriceCorrection(original, { ...correction, recordedAt: "2026-09-19T12:00:00.000Z" })).grossRealizedPnl).toBe(212.5);
  } finally { vi.useRealTimers(); }
});

it("combines dated remaining marks with realized closes and one allowance", () => {
  const state = fixture(), leg = state.legs[0];
  leg.contractId = `${state.underlying.padEnd(6)}${leg.expiry.slice(2, 10).replaceAll("-", "")}C${String(leg.strike * 1000).padStart(8, "0")}`;
  state.pricing = { mode: "market", snapshotId: "initial", basis: "mid", entryMode: "fixed" };
  const position = recordClose(createPosition(state), { id: "one", assetId: `option:${leg.id}`, quantity: 1, price: 3, at });
  const snapshot: MarketSnapshot = { id: "mark", underlying: state.underlying, source: "Tastytrade", retrievedAt: at, spotAsOf: at, spot: 43, availableExpiries: [leg.expiry.slice(0, 10)], contracts: [{ contractId: leg.contractId, type: leg.type, strike: leg.strike, expiry: leg.expiry, multiplier: 100, bid: 4, ask: 6, iv: leg.iv, quoteAsOf: at }] };
  const original = structuredClone(position);
  const excludedPosition = structuredClone(position);
  excludedPosition.initial.excludedLegIds = [leg.id];
  excludedPosition.initial.scenarioDate = "2027-01-01T00:00:00.000Z";
  expect(valuePosition(excludedPosition, snapshot, "mid").combinedPnl).toBe(776);
  expect(valuePosition(excludedPosition, snapshot, "mid").remainingState?.excludedLegIds).toEqual([leg.id]);
  expect(() => valuePosition(excludedPosition, { ...snapshot, contracts: [] }, "mid")).toThrow(/Remaining option/);
  const excludedClosed = recordClose(excludedPosition, { id: "remaining-excluded", assetId: `option:${leg.id}`, quantity: 2, price: 3, at });
  expect(valuePosition(excludedClosed, { ...snapshot, contracts: [] }, "mid").remainingState?.excludedLegIds).toEqual([]);
  // Realized100 + remainingoptions400 + stock83 - allowance7.
  expect(valuePosition(position, snapshot, "natural")).toMatchObject({ grossRealizedPnl: 100, unrealizedPnl: 483, allowance: 7, combinedPnl: 576 });
  expect(valuePosition(position, snapshot, "mid").combinedPnl).toBe(776);
  expect(valuePosition(position, snapshot, "mid").remainingState).toMatchObject({ name: "Remaining holdings", feeAllowance: 0, spot: 43, valuationTimestamp: at, legs: [{ contracts: 2, entryPrice: 2 }], pricing: { snapshotId: "mark", entryMode: "fixed" } });
  expect(position).toEqual(original);
  const short = structuredClone(state); short.legs[0].side = "short"; short.stock!.shares = -83;
  expect(valuePosition(createPosition(short), snapshot, "natural")).toMatchObject({ unrealizedPnl: -1283, combinedPnl: -1290 });
  expect(() => valuePosition(position, { ...snapshot, contracts: [{ ...snapshot.contracts[0], sourceTimes: { bid: "2026-09-04T12:00:00Z", ask: at, iv: at } }] }, "mid")).toThrow();
  expect(() => valuePosition(position, { ...snapshot, spotAsOf: "2099-01-01T00:00:00Z" }, "mid")).toThrow();
  const stockOnly = recordClose(position, { id: "two", assetId: `option:${leg.id}`, quantity: 2, price: 3, at });
  expect(valuePosition(stockOnly, { ...snapshot, contracts: [] }, "mid")).toMatchObject({ grossRealizedPnl: 300, unrealizedPnl: 83, combinedPnl: 376 });
  expect(valuePosition(stockOnly, { ...snapshot, contracts: [] }, "mid").remainingState).toMatchObject({ legs: [], stock: { shares: 83, entryPrice: 42 }, feeAllowance: 0, scenarioDate: at, pricing: { entryMode: "fixed" } });
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-09-19T12:00:00Z"));
  try {
    const expired = { ...snapshot, retrievedAt: leg.expiry, spotAsOf: leg.expiry, contracts: snapshot.contracts.map(c => ({ ...c, quoteAsOf: leg.expiry })) };
    expect(() => valuePosition(position, expired, "mid")).toThrow(/Remaining option/);
    expect(valuePosition(stockOnly, { ...expired, contracts: [] }, "mid").combinedPnl).toBe(376);
  } finally { vi.useRealTimers(); }
  for (const invalid of [{ ...snapshot, underlying: "WRONG" }, { ...snapshot, spotAsOf: "2026-09-04T12:00:00Z" }, { ...snapshot, contracts: [] }, { ...snapshot, contracts: [{ ...snapshot.contracts[0], quoteAsOf: "2026-09-04T12:00:00Z" }] }, { ...snapshot, contracts: [...snapshot.contracts, ...snapshot.contracts] }]) expect(() => valuePosition(position, invalid, "mid")).toThrow();
});

describe("recorded position closes", () => {
  it("preserves basis through partial closes, stock-only remainder and full close", () => {
    const state = fixture(), original = structuredClone(state), initial = createPosition(state);
    const close = { id: "one", assetId: `option:${state.legs[0].id}`, quantity: 1, price: 3, at };
    const partial = recordClose(initial, close);
    expect(projectPosition(partial)).toMatchObject({ status: "options-active", grossRealizedPnl: 100, allowance: 7, active: { feeAllowance: 0, legs: [{ contracts: 2, entryPrice: 2 }] } });
    expect(recordClose(partial, close)).toEqual(partial);
    expect(() => recordClose(partial, { ...close, price: 4 })).toThrow(/conflict/);
    const optionsClosed = recordClose(partial, { ...close, id: "two", quantity: 2, price: 1 });
    expect(projectPosition(optionsClosed)).toMatchObject({ status: "stock-only", active: { legs: [], stock: { shares: 83, entryPrice: 42 }, feeAllowance: 0 }, stock: { shares: 83, entryPrice: 42 }, grossRealizedPnl: -100 });
    const closed = recordClose(optionsClosed, { id: "three", assetId: "stock", quantity: 83, price: 43, at });
    expect(projectPosition(closed)).toMatchObject({ status: "closed", active: null, stock: null, grossRealizedPnl: -17, netClosedPnl: -24 });
    expect(state).toEqual(original);
    expect(initial.closes).toEqual([]);
    expect(projectPosition(JSON.parse(JSON.stringify(closed)))).toEqual(projectPosition(closed));
  });
  it("rejects invalid closes and altered frozen basis without changing the record", () => {
    const initial = createPosition(fixture()), assetId = `option:${initial.initial.legs[0].id}`;
    const close = { id: "one", assetId, quantity: 1, price: 3, at };
    for (const patch of [{ quantity: 4 }, { quantity: 0 }, { quantity: .5 }, { price: -1 }, { price: NaN }, { assetId: "missing" }, { at: "2026-09-01T00:00:00.000Z" }, { at: "2099-01-01T00:00:00.000Z" }, { at: "2026-02-30T12:00:00.000Z" }]) expect(() => recordClose(initial, { ...close, ...patch })).toThrow();
    const changed = recordClose(initial, close);
    changed.closes[0].entryPrice = 99;
    expect(() => projectPosition(changed)).toThrow(/basis/);
    expect(() => recordClose(changed, close)).toThrow(/basis/);
    expect(initial.closes).toEqual([]);
  });
  it("uses the correct close sign for short options and short shares", () => {
    const state = fixture(); state.legs[0].side = "short"; state.stock!.shares = -83;
    let position = recordClose(createPosition(state), { id: "option", assetId: `option:${state.legs[0].id}`, quantity: 3, price: 1, at });
    position = recordClose(position, { id: "shares", assetId: "stock", quantity: 83, price: 40, at });
    expect(projectPosition(position)).toMatchObject({ status: "closed", grossRealizedPnl: 466, netClosedPnl: 459 });
  });
  it("allows an explicitly recorded expiry close, not later settlement or unsafe inventory", () => {
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime("2026-09-19T00:00:00.000Z");
    try {
      const state = fixture(), position = createPosition(state);
      const close = { id: "expiry", assetId: `option:${state.legs[0].id}`, quantity: 3, price: 0, at: state.legs[0].expiry };
      const closed = recordClose(position, close);
      expect(projectPosition(closed)).toMatchObject({ status: "stock-only", grossRealizedPnl: -600, netClosedPnl: null, requiresRevaluation: true });
      expect(() => recordClose(position, { ...close, at: new Date(Date.parse(close.at) + 1).toISOString() })).toThrow(/expiry/);
      expect(() => recordClose(closed, { ...close, id: "again" })).toThrow();
      state.legs[0].contracts = Number.MAX_SAFE_INTEGER + 1;
      expect(() => createPosition(state)).toThrow();
      state.legs[0].contracts = 3; state.version = Number.MAX_SAFE_INTEGER;
      expect(() => recordClose(createPosition(state), { ...close, quantity: 1 })).toThrow(/version/);
    } finally { vi.useRealTimers(); }
  });
});
