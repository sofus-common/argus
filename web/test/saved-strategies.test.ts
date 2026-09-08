import { env } from "cloudflare:workers";
import { beforeAll, expect, it } from "vitest";
import migration from "../migrations/0001_saved_strategies.sql?raw";
import lifecycleMigration from "../migrations/0002_position_lifecycle.sql?raw";
import { createMarketStrategy, createStrategy, marketLeg, type MarketSnapshot } from "../src/options";
import { createSavedStore } from "../src/saved-strategies";
import { createPosition, projectPosition, type PositionRecord } from "../src/position-lifecycle";
import { projectPositionLots, valuePositionLots, type LotTransaction, type PositionLots } from "../src/position-lots";

const db = (env as { DB: D1Database }).DB;
beforeAll(async () => {
  await db.batch((migration + lifecycleMigration).split(";").filter(sql => sql.trim()).map(sql => db.prepare(sql)));
});

it('keeps positions beyond the first fifty reachable through owner-scoped pages', async () => {
  const store = createSavedStore(db), owner = crypto.randomUUID(), state = createStrategy('long-call');
  const created = [];
  for (let i = 0; i < 51; i++) created.push(await store.create(owner, `Position ${i}`, state));
  const first = await store.listPage(owner);
  expect(first.strategies).toHaveLength(50);
  expect(first.nextCursor).not.toBeNull();
  const second = await store.listPage(owner, first.nextCursor!);
  expect(second.strategies).toHaveLength(1);
  expect(second.nextCursor).toBeNull();
  expect(new Set([...first.strategies, ...second.strategies].map(record => record.id)).size).toBe(created.length);
  for (const record of [...first.strategies, ...second.strategies]) expect(record).toHaveProperty('tracking', { underlying: 'SPY', status: 'not-tracked', remainingLots: null, optionContracts: null, signedShares: null, grossRealizedPnl: null, allowance: null, netClosedPnl: null, asOf: null });
  expect((await store.listPage('another-owner', first.nextCursor!)).strategies).toEqual([]);
});

it('pages timestamp ties deterministically and requires refresh for records moved before the cursor', async () => {
  const store = createSavedStore(db), owner = crypto.randomUUID(), state = createStrategy('long-call'), at = '2026-01-01T00:00:00.000Z';
  const created = [];
  for (let i = 0; i < 102; i++) created.push(await store.create(owner, `Tied ${i}`, state));
  await db.prepare('UPDATE saved_strategies SET updated_at = ? WHERE owner = ?').bind(at, owner).run();
  const ordered = created.map(record => record.id).sort(), first = await store.listPage(owner);
  expect(first.strategies.map(record => record.id)).toEqual(ordered.slice(0, 50));
  await store.update(owner, ordered[0], 1, 'Already seen, updated', state);
  await store.update(owner, ordered[60], 1, 'Unseen, updated', state);
  const inserted = await store.create(owner, 'New record', state);
  const second = await store.listPage(owner, first.nextCursor!);
  const third = await store.listPage(owner, second.nextCursor!);
  expect([...second.strategies, ...third.strategies].map(record => record.id)).toEqual(ordered.slice(50).filter(id => id !== ordered[60]));
  expect(third.nextCursor).toBeNull();
  const refreshed = await store.listPage(owner);
  expect(refreshed.strategies.map(record => record.id)).toEqual(expect.arrayContaining([ordered[0], ordered[60], inserted.id]));
});

it('isolates invalid tracking rows and reconciles corrected signed-stock holdings without marking analyses', async () => {
  const store = createSavedStore(db), owner = crypto.randomUUID(), at = '2026-09-05T12:00:00.000Z';
  const snapshot: MarketSnapshot = { id: 'tracking', underlying: 'SPY', source: 'Tastytrade', spot: 100, retrievedAt: '2026-09-04T18:00:00.000Z', spotAsOf: '2026-09-04T18:00:00.000Z', availableExpiries: ['2026-10-09'], contracts: [{ contractId: 'SPY   261009C00100000', type: 'call', strike: 100, expiry: '2026-10-09T20:00:00.000Z', multiplier: 100, bid: 3, ask: 5, iv: .2, quoteAsOf: '2026-09-04T18:00:00.000Z' }] };
  const state = createMarketStrategy('long-call', snapshot);
  const quoted = await store.create(owner, 'Quoted analysis', state, snapshot);
  state.pricing!.entryMode = 'fixed'; state.legs = []; state.stock = { shares: -10, entryPrice: 100 }; state.feeAllowance = 2;
  const held = await store.create(owner, 'Short shares', state, snapshot);
  const close = { id: 'partial', assetId: 'stock', quantity: 4, price: 90, at };
  await store.close(owner, held.id, 1, close);
  await store.correctPrice(owner, held.id, 2, { id: 'correct', closeId: close.id, price: 95, reason: 'Recorded fill correction', recordedAt: at });
  let page = await store.listPage(owner);
  expect(page.strategies.find(row => row.id === held.id)).toHaveProperty('tracking', { underlying: 'SPY', status: 'open', remainingLots: 1, optionContracts: 0, signedShares: -6, grossRealizedPnl: 20, allowance: 2, netClosedPnl: null, asOf: at });
  expect(page.strategies.find(row => row.id === quoted.id)).toHaveProperty('tracking', { underlying: 'SPY', status: 'not-tracked', remainingLots: null, optionContracts: null, signedShares: null, grossRealizedPnl: null, allowance: null, netClosedPnl: null, asOf: null });
  await store.voidClose(owner, held.id, 3, { id: 'void', closeId: close.id, reason: 'Fill was cancelled', recordedAt: at });
  expect((await store.listPage(owner)).strategies.find(row => row.id === held.id)).toHaveProperty('tracking.signedShares', -10);
  const invalid = await store.create(owner, 'Corrupt record', createStrategy('long-call'));
  await db.prepare('UPDATE saved_strategies SET state_json = ? WHERE owner = ? AND id = ?').bind('{"underlying":"UNVALIDATED"}', owner, invalid.id).run();
  page = await store.listPage(owner);
  expect(page.strategies).toHaveLength(3);
  expect(page.strategies.find(row => row.id === invalid.id)).toHaveProperty('tracking', { underlying: null, status: 'unavailable', remainingLots: null, optionContracts: null, signedShares: null, grossRealizedPnl: null, allowance: null, netClosedPnl: null, asOf: null });
  expect(page.strategies.find(row => row.id === held.id)).toHaveProperty('tracking.grossRealizedPnl', 0);
  expect((await store.listPage('foreign-owner')).strategies).toEqual([]);
  expect((await store.list(owner))[0]).not.toHaveProperty('tracking');
});

it('rejects noncanonical or malformed cursors before querying storage', async () => {
  let queries = 0;
  const store = createSavedStore({ prepare() { queries++; throw new Error('Must not query'); } } as unknown as D1Database);
  const encode = (value: unknown) => btoa(JSON.stringify(value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const value = { updatedAt: '2026-01-01T00:00:00.000Z', id: 'position' };
  for (const cursor of ['', '!', 'x'.repeat(1025), encode(null), encode({ ...value, id: '../foreign' }), encode({ ...value, updatedAt: '2026-02-30T00:00:00.000Z' }), encode({ ...value, extra: 1 }), encode({ id: value.id, updatedAt: value.updatedAt }), `${encode(value)}=`]) await expect(store.listPage('owner', cursor)).rejects.toMatchObject({ status: 400, code: 'invalid_request' });
  expect(queries).toBe(0);
});

it("round trips eight-leg four-expiry holdings and reconciles closes and rolls without crossing owners", async () => {
  const store = createSavedStore(db), owner = crypto.randomUUID(), recipient = crypto.randomUUID();
  const at = "2026-09-05T12:00:00.000Z", markedAt = "2026-09-06T12:00:00.000Z";
  const dates = ["2026-10-09", "2026-10-16", "2026-10-23", "2026-10-30"];
  const snapshot: MarketSnapshot = {
    id: "wide-held", underlying: "SPY", source: "Tastytrade", spot: 100, retrievedAt: "2026-09-04T18:00:00.000Z", spotAsOf: "2026-09-04T18:00:00.000Z", availableExpiries: dates,
    contracts: dates.flatMap(date => [100, 105, 110].map(strike => ({ contractId: `SPY   ${date.slice(2).replaceAll("-", "")}C${String(strike * 1000).padStart(8, "0")}`, type: "call" as const, strike, expiry: `${date}T20:00:00.000Z`, multiplier: 100 as const, bid: 3, ask: 5, iv: .2, quoteAsOf: "2026-09-04T18:00:00.000Z" }))),
  };
  const state = createMarketStrategy("long-call", snapshot);
  state.legs = snapshot.contracts.filter(quote => quote.strike !== 110).map((quote, i) => ({ ...marketLeg(quote, "long", 1, `held-${i}`, "mid"), entryPrice: 2 }));
  state.pricing!.entryMode = "fixed"; state.stock = { shares: 100, entryPrice: 98 }; state.feeAllowance = 7;
  state.excludedLegIds = [state.legs[7].id];
  state.expiryIvShifts = dates.map(date => ({ expiry: `${date}T20:00:00.000Z`, ivShift: .01 }));
  const saved = await store.create(owner, "Wide inventory", state, snapshot);
  expect((await store.get(owner, saved.id)).state).toEqual(state);
  const close = { id: "first-close", assetId: `option:${state.legs[0].id}`, quantity: 1, price: 3, at };
  await expect(store.close(recipient, saved.id, 1, close)).rejects.toMatchObject({ status: 404 });
  await store.close(owner, saved.id, 1, close);
  const replacement = snapshot.contracts.find(quote => quote.strike === 110)!;
  const roll: LotTransaction = { id: "roll", at, recordedAt: at, closes: [{ id: "roll-close", lotId: "initial:option:1", quantity: 1, price: 3 }], opens: [{ id: "replacement", side: "long", quantity: 1, entryPrice: 2, asset: { kind: "option", contractId: replacement.contractId, type: replacement.type, strike: replacement.strike, expiry: replacement.expiry, multiplier: 100 } }] };
  const rolled = await store.transact(owner, saved.id, 2, roll);
  expect(rolled.state).toEqual(state);
  const overview = async () => (await store.listPage(owner)).strategies.find(row => row.id === saved.id);
  expect(await overview()).toHaveProperty('tracking', { underlying: 'SPY', status: 'open', remainingLots: 8, optionContracts: 7, signedShares: 100, grossRealizedPnl: 200, allowance: 7, netClosedPnl: null, asOf: at });
  const marks = { ...snapshot, id: "wide-mark", retrievedAt: markedAt, spotAsOf: markedAt, contracts: snapshot.contracts.map(quote => ({ ...quote, quoteAsOf: markedAt })) };
  const valuation = valuePositionLots(rolled.lifecycle as PositionLots, marks, "mid");
  expect(valuation).toMatchObject({ grossRealizedPnl: 200, unrealizedPnl: 1600, allowance: 7, combinedPnl: 1793, analysisUnavailable: null });
  expect(valuation.remainingState!.legs).toHaveLength(7);
  expect(valuation.remainingState!.excludedLegIds).toEqual([state.legs[7].contractId]);
  const exported = JSON.parse(JSON.stringify({ format: "argus-saved-position", formatVersion: 1, exportedAt: new Date().toISOString(), record: await store.get(owner, saved.id) }));
  const imported = await store.importRecord(recipient, exported);
  expect(imported.id).not.toBe(saved.id); expect(imported.revision).toBe(1);
  expect(imported.state).toEqual({ ...state, pricing: { ...state.pricing, snapshotId: imported.snapshot!.id, historical: true } });
  expect(imported.snapshot!.contracts).toEqual(snapshot.contracts);
  expect(imported.snapshot).toMatchObject({ historical: true, imported: true });
  expect((imported.lifecycle as PositionLots).transactions).toEqual([roll]);
  expect(valuePositionLots(imported.lifecycle as PositionLots, marks, "mid")).toEqual(valuation);
  await expect(store.get(owner, imported.id)).rejects.toMatchObject({ status: 404 });
  await expect(store.get(recipient, saved.id)).rejects.toMatchObject({ status: 404 });
  const remaining = projectPositionLots(imported.lifecycle as PositionLots).lots;
  const finish: LotTransaction = { id: "finish", at: markedAt, recordedAt: markedAt, opens: [], closes: remaining.map(lot => ({ id: `finish-${lot.id}`, lotId: lot.id, quantity: lot.quantity, price: lot.asset.kind === "stock" ? 100 : 4 })) };
  await expect(store.transact(owner, imported.id, 1, finish)).rejects.toMatchObject({ status: 404 });
  const closed = await store.transact(recipient, imported.id, 1, finish);
  expect(projectPositionLots(closed.lifecycle as PositionLots)).toMatchObject({ status: "closed", lots: [], grossRealizedPnl: 1800, netClosedPnl: 1793 });
  expect((await store.listPage(recipient)).strategies[0]).toHaveProperty('tracking', { underlying: 'SPY', status: 'closed', remainingLots: 0, optionContracts: 0, signedShares: 0, grossRealizedPnl: 1800, allowance: 7, netClosedPnl: 1793, asOf: markedAt });
  expect(await store.transact(recipient, imported.id, 1, finish)).toEqual(closed);
  expect(await store.get(owner, saved.id)).toEqual(rolled);
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
