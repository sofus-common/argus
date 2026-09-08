import { env } from "cloudflare:workers";
import { beforeAll, expect, it } from "vitest";
import migration from "../migrations/0001_saved_strategies.sql?raw";
import lifecycleMigration from "../migrations/0002_position_lifecycle.sql?raw";
import { createMarketStrategy, createStrategy, type MarketSnapshot } from "../src/options";
import { createSavedStore } from "../src/saved-strategies";
import { createPosition, projectPosition, type PositionRecord } from "../src/position-lifecycle";
import { projectPositionLots, type LotTransaction, type PositionLots } from "../src/position-lots";

const db = (env as { DB: D1Database }).DB;
beforeAll(async () => {
  await db.batch((migration + lifecycleMigration).split(";").filter(sql => sql.trim()).map(sql => db.prepare(sql)));
});

it("upgrades only on atomic lot writes and retains legacy retries and original basis", async () => {
  const store = createSavedStore(db), owner = crypto.randomUUID(), state = createStrategy("long-call"), at = "2026-09-05T12:00:00.000Z";
  state.legs[0].contracts = 2;
  const saved = await store.create(owner, "Lots", state);
  const close = { id: "old-close", assetId: `option:${state.legs[0].id}`, quantity: 1, price: 3, at };
  await store.close(owner, saved.id, 1, close);
  const correction = { id: "old-fix", closeId: close.id, price: 4, reason: "Fix", recordedAt: at };
  await store.correctPrice(owner, saved.id, 2, correction);
  const cancellation = { id: "old-void", closeId: close.id, reason: "No fill", recordedAt: at };
  const before = await store.voidClose(owner, saved.id, 3, cancellation);
  const leg = state.legs[0];
  const transaction: LotTransaction = { id: "addition", at, recordedAt: at, closes: [], opens: [{ id: "new-lot", side: "long", quantity: 1, entryPrice: 5, asset: { kind: "option", contractId: leg.contractId, type: leg.type, strike: leg.strike, expiry: leg.expiry, multiplier: 100 } }] };
  await expect(store.transact("other", saved.id, 4, transaction)).rejects.toMatchObject({ status: 404 });
  const [one, two] = await Promise.all([store.transact(owner, saved.id, 4, transaction), store.transact(owner, saved.id, 4, transaction)]);
  expect(one).toEqual(two); expect(one.revision).toBe(5);
  expect(one.state).toEqual(state);
  expect(one.lifecycle).toMatchObject({ schemaVersion: 2, legacy: before.lifecycle, transactions: [transaction] });
  expect(await store.transact(owner, saved.id, 4, transaction)).toEqual(one);
  expect(await store.close(owner, saved.id, 1, close)).toEqual(one);
  expect(await store.correctPrice(owner, saved.id, 2, correction)).toEqual(one);
  expect(await store.voidClose(owner, saved.id, 3, cancellation)).toEqual(one);
  await expect(store.close(owner, saved.id, 5, { ...close, id: "new-v1-close" })).rejects.toMatchObject({ status: 400 });
  await expect(store.correctPrice(owner, saved.id, 5, { ...correction, price: 99 })).rejects.toMatchObject({ status: 400 });
  await expect(store.update(owner, saved.id, 5, "Overwrite", state)).rejects.toMatchObject({ status: 409 });
  const invalid = { ...transaction, id: "invalid", opens: [{ ...transaction.opens[0], id: "bad", entryPrice: -1 }] };
  await expect(store.transact(owner, saved.id, 5, invalid)).rejects.toMatchObject({ status: 400 });
  expect(await store.get(owner, saved.id)).toEqual(one);
});

it("CAS arbitrates lot transactions versus amendments and rejects corrupt v2 reads", async () => {
  const store = createSavedStore(db), owner = crypto.randomUUID(), state = createStrategy("long-call"), at = "2026-09-05T12:00:00.000Z";
  state.legs[0].contracts = 3;
  const saved = await store.create(owner, "Race", state);
  const transaction: LotTransaction = { id: "close-tx", at, recordedAt: at, opens: [], closes: [{ id: "lot-close", lotId: "initial:option:0", quantity: 1, price: 3 }] };
  await store.transact(owner, saved.id, 1, transaction);
  const correction = { id: "lot-fix", closeId: "lot-close", price: 4, reason: "Fix", recordedAt: at };
  const race = await Promise.allSettled([store.transact(owner, saved.id, 2, { ...transaction, id: "next", closes: [{ ...transaction.closes[0], id: "next-close" }] }), store.correctPrice(owner, saved.id, 2, correction)]);
  expect(race.filter(result => result.status === "fulfilled")).toHaveLength(1);
  expect(race.find(result => result.status === "rejected")).toMatchObject({ reason: { status: 409 } });
  const latest = await store.get(owner, saved.id);
  expect(latest.revision).toBe(3);
  expect(await store.transact(owner, saved.id, 1, transaction)).toEqual(latest);
  const voided = await store.voidClose(owner, saved.id, 3, { id: "lot-void", closeId: "lot-close", reason: "No fill", recordedAt: at });
  expect(projectPositionLots(voided.lifecycle as PositionLots).lots[0].quantity).toBeGreaterThanOrEqual(2);
  const corrupt = structuredClone(voided.lifecycle as PositionLots); corrupt.transactions[0].closes[0].quantity = 99;
  await db.prepare("UPDATE saved_strategies SET lifecycle_json = ? WHERE owner = ? AND id = ?").bind(JSON.stringify(corrupt), owner, saved.id).run();
  await expect(store.get(owner, saved.id)).rejects.toThrow();
  await expect(store.transact(owner, saved.id, 1, transaction)).rejects.toThrow();
});

it("isolates records by owner and atomically rejects competing revisions", async () => {
  const store = createSavedStore(db);
  const alice = crypto.randomUUID(), bob = crypto.randomUUID();
  const state = createStrategy("bull-call");
  const saved = await store.create(alice, " My spread ", state);
  expect(saved.title).toBe("My spread");
  expect(saved.id).toMatch(/^[a-f0-9-]{36}$/);
  expect(saved.revision).toBe(1);
  expect(saved.snapshot).toBeNull();
  expect((await store.get(alice, saved.id)).state).toEqual(state);
  expect(await store.list(bob)).toEqual([]);
  await expect(store.get(bob, saved.id)).rejects.toMatchObject({ status: 404, code: "not_found" });
  await expect(store.update(bob, saved.id, 1, "stolen", state)).rejects.toMatchObject({ status: 404 });
  await expect(store.remove(bob, saved.id, 1)).rejects.toMatchObject({ status: 404 });
  const attempts = await Promise.allSettled([
    store.update(alice, saved.id, 1, "one", state),
    store.update(alice, saved.id, 1, "two", state),
  ]);
  expect(attempts.filter(result => result.status === "fulfilled")).toHaveLength(1);
  expect(attempts.find(result => result.status === "rejected")).toMatchObject({ reason: { status: 409, code: "conflict" } });
  expect((await store.get(alice, saved.id)).revision).toBe(2);
  await expect(store.remove(alice, saved.id, 1)).rejects.toMatchObject({ status: 409 });
  await store.remove(alice, saved.id, 2);
  await expect(store.get(alice, saved.id)).rejects.toMatchObject({ status: 404 });
});

it("persists audited corrections atomically and preserves exact retry identity", async () => {
  const store = createSavedStore(db), owner = crypto.randomUUID(), state = createStrategy("long-call");
  state.legs[0].entryPrice = 2; state.legs[0].contracts = 2;
  const saved = await store.create(owner, "Correction", state);
  const close = { id: "close", assetId: `option:${state.legs[0].id}`, quantity: 1, price: 3, at: "2026-09-05T12:00:00.000Z" };
  const original = await store.close(owner, saved.id, 1, close);
  const correction = { id: "fix", closeId: close.id, price: 4, reason: "Fill transcription", recordedAt: close.at };
  await expect(store.correctPrice("other", saved.id, 2, correction)).rejects.toMatchObject({ status: 404 });
  const results = await Promise.all([store.correctPrice(owner, saved.id, 2, correction), store.correctPrice(owner, saved.id, 2, correction)]);
  expect(results[0]).toEqual(results[1]); expect(results[0].revision).toBe(3);
  expect((results[0].lifecycle as PositionRecord).closes).toEqual((original.lifecycle as PositionRecord).closes);
  const race = await Promise.allSettled([
    store.correctPrice(owner, saved.id, 3, { ...correction, id: "second", price: 5 }),
    store.close(owner, saved.id, 3, { ...close, id: "other-close" }),
  ]);
  expect(race.filter(result => result.status === "fulfilled")).toHaveLength(1);
  expect(race.find(result => result.status === "rejected")).toMatchObject({ reason: { status: 409 } });
  const latest = await store.get(owner, saved.id);
  expect(await store.correctPrice(owner, saved.id, 2, correction)).toEqual(latest);
  await expect(store.correctPrice(owner, saved.id, 4, { ...correction, price: 99 })).rejects.toMatchObject({ status: 400 });
  await expect(store.update(owner, saved.id, 4, "Overwrite", state)).rejects.toMatchObject({ status: 409 });
});

it("persists a void once, preserving originals and restoring quantity for later closes", async () => {
  const store = createSavedStore(db), owner = crypto.randomUUID(), state = createStrategy("long-call");
  const saved = await store.create(owner, "Wrong close", state);
  const close = { id: "wrong", assetId: `option:${state.legs[0].id}`, quantity: 1, price: 3, at: "2026-09-05T12:00:00.000Z" };
  const original = await store.close(owner, saved.id, 1, close);
  const request = { id: "void", closeId: close.id, reason: "Duplicate transcription", recordedAt: close.at };
  await expect(store.voidClose("foreign", saved.id, 2, request)).rejects.toMatchObject({ status: 404 });
  const [one, two] = await Promise.all([store.voidClose(owner, saved.id, 2, request), store.voidClose(owner, saved.id, 2, request)]);
  expect(one).toEqual(two); expect(one.revision).toBe(3);
  expect((one.lifecycle as PositionRecord).closes).toEqual((original.lifecycle as PositionRecord).closes);
  expect(projectPosition(one.lifecycle as PositionRecord)).toMatchObject({ grossRealizedPnl: 0, active: { legs: [{ contracts: 1 }] } });
  const later = await store.close(owner, saved.id, 3, { ...close, id: "actual" });
  expect(await store.voidClose(owner, saved.id, 2, request)).toEqual(later);
  await expect(store.voidClose(owner, saved.id, 4, { ...request, id: "again" })).rejects.toMatchObject({ status: 400 });
});

it("records owner-scoped closes atomically with exact retry identity and immutable history", async () => {
  const store = createSavedStore(db), owner = crypto.randomUUID();
  const state = createStrategy("long-call");
  state.legs[0].contracts = 3; state.legs[0].entryPrice = 2;
  const saved = await store.create(owner, "Position", state);
  const close = { id: "one", assetId: `option:${state.legs[0].id}`, quantity: 1, price: 3, at: "2026-09-05T12:00:00.000Z" };
  await expect(store.close("other-owner", saved.id, 1, close)).rejects.toMatchObject({ status: 404 });
  const identical = await Promise.all([store.close(owner, saved.id, 1, close), store.close(owner, saved.id, 1, close)]);
  expect(identical[0]).toEqual(identical[1]);
  expect(identical[0].revision).toBe(2);
  expect((identical[0].lifecycle as PositionRecord).closes).toHaveLength(1);
  expect(identical[0].state).toEqual(state);
  await expect(store.close(owner, saved.id, 2, { ...close, price: 4 })).rejects.toMatchObject({ status: 400 });
  await expect(store.update(owner, saved.id, 2, "overwrite", state)).rejects.toMatchObject({ status: 409 });
  const distinct = await Promise.allSettled([
    store.close(owner, saved.id, 2, { ...close, id: "two" }),
    store.close(owner, saved.id, 2, { ...close, id: "three" }),
  ]);
  expect(distinct.filter(result => result.status === "fulfilled")).toHaveLength(1);
  expect(distinct.find(result => result.status === "rejected")).toMatchObject({ reason: { status: 409 } });
  const latest = await store.get(owner, saved.id);
  expect(await store.close(owner, saved.id, 1, close)).toEqual(latest);
  expect(projectPosition(latest.lifecycle as PositionRecord)).toMatchObject({ grossRealizedPnl: 200, active: { legs: [{ contracts: 1 }] } });
  await expect(store.close(owner, saved.id, 3, { ...close, id: "over", quantity: 2 })).rejects.toMatchObject({ status: 400 });
  expect(await store.get(owner, saved.id)).toEqual(latest);
});

it("allows only one winner when a builder save races the first recorded close", async () => {
  const store = createSavedStore(db), owner = crypto.randomUUID(), state = createStrategy("long-call");
  const saved = await store.create(owner, "Position", state);
  const outcomes = await Promise.allSettled([
    store.close(owner, saved.id, 1, { id: "close", assetId: `option:${state.legs[0].id}`, quantity: 1, price: 3, at: "2026-09-05T12:00:00.000Z" }),
    store.update(owner, saved.id, 1, "Changed", { ...state, feeAllowance: 15 }),
  ]);
  expect(outcomes.filter(result => result.status === "fulfilled")).toHaveLength(1);
  expect(outcomes.find(result => result.status === "rejected")).toMatchObject({ reason: { status: 409 } });
  expect((await store.get(owner, saved.id)).revision).toBe(2);
});

it("rejects malformed persisted lifecycle payloads instead of treating them as legacy positions", async () => {
  const store = createSavedStore(db), owner = crypto.randomUUID(), state = createStrategy("long-call");
  const saved = await store.create(owner, "Position", state);
  const wrongBasis = createPosition({ ...state, feeAllowance: 20 });
  for (const payload of ["null", "false", "0", "", "{}", JSON.stringify(wrongBasis)]) {
    await db.prepare("UPDATE saved_strategies SET lifecycle_json = ? WHERE owner = ? AND id = ?").bind(payload, owner, saved.id).run();
    await expect(store.get(owner, saved.id)).rejects.toThrow();
    await expect(store.close(owner, saved.id, 1, { id: "close", assetId: `option:${state.legs[0].id}`, quantity: 1, price: 3, at: "2026-09-05T12:00:00.000Z" })).rejects.toThrow();
  }
});

it("bounds titles and metadata lists and parameterizes adversarial strings", async () => {
  const store = createSavedStore(db), owner = crypto.randomUUID();
  const state = createStrategy("long-call");
  for (const title of ["", " ", "x".repeat(121)]) {
    await expect(store.create(owner, title, state)).rejects.toMatchObject({ status: 400 });
  }
  const title = "'); DROP TABLE saved_strategies; --";
  const saved = await store.create(owner, title, state);
  expect((await store.get(owner, saved.id)).title).toBe(title);
  await expect(store.update(owner, saved.id, 0, "bad", state)).rejects.toMatchObject({ status: 400 });
  await expect(store.remove(owner, saved.id, 1.5)).rejects.toMatchObject({ status: 400 });
  for (let i = 0; i < 51; i++) await store.create(owner, String(i), state);
  const list = await store.list(owner);
  expect(list).toHaveLength(50);
  expect(list[0]).not.toHaveProperty("state");
  expect(list[0]).not.toHaveProperty("snapshot");
  expect(await store.list("' OR 1=1 --")).toEqual([]);
});

it("round trips historical quote payloads without changing valuation or quote timestamps", async () => {
  const store = createSavedStore(db), owner = crypto.randomUUID();
  const snapshot: MarketSnapshot = {
    id: "trusted-historical", underlying: "SPY", source: "Tastytrade", retrievedAt: "2026-09-04T18:00:00Z",
    spot: 100, spotAsOf: "2026-09-04T17:59:58Z", availableExpiries: ["2026-09-11"],
    contracts: [{ contractId: "SPY   260911C00100000", type: "call", strike: 100, expiry: "2026-09-11T20:15:00Z", multiplier: 100,
      bid: 2, ask: 2.1, iv: 0.2, quoteAsOf: "2026-09-04T17:59:57Z" }],
  };
  const state = createMarketStrategy("long-call", snapshot);
  const fixed = { ...state, pricing: { ...state.pricing!, entryMode: "fixed" as const } };
  const close = { id: "market-close", assetId: `option:${state.legs[0].id}`, quantity: 1, price: 3, at: "2026-09-05T12:00:00.000Z" };
  for (const invalidSnapshot of [undefined, { ...snapshot, id: "mismatch" }]) {
    const invalid = await store.create(owner, "Invalid basis", fixed, invalidSnapshot);
    await expect(store.close(owner, invalid.id, 1, close)).rejects.toMatchObject({ status: 400 });
    expect((await store.get(owner, invalid.id)).lifecycle).toBeNull();
  }
  const valid = await store.create(owner, "Held basis", fixed, snapshot);
  expect(((await store.close(owner, valid.id, 1, close)).lifecycle as PositionRecord).closes).toHaveLength(1);
  const estimated = await store.create(owner, "Estimated entry", state, snapshot);
  await expect(store.close(owner, estimated.id, 1, close)).rejects.toMatchObject({ status: 400 });
  const saved = await store.create(owner, "Historical", state, snapshot);
  expect(saved.snapshot).toEqual(snapshot);
  expect((await store.get(owner, saved.id)).state).toEqual(state);
  const updated = await store.update(owner, saved.id, 1, "Historical renamed", state, snapshot);
  expect(updated.snapshot).toEqual(snapshot);
  expect(updated.createdAt).toBe(saved.createdAt);
  const deletes = await Promise.allSettled([store.remove(owner, saved.id, 2), store.remove(owner, saved.id, 2)]);
  expect(deletes.filter(result => result.status === "fulfilled")).toHaveLength(1);
});
