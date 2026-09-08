import { Hono, type Context } from "hono";
import { withAnalysisTrace, readAnalysisTrace, AnalysisTraceError } from "./analysis-trace";
import { calculateLotScenarioComparison, type LotScenario } from "./lot-scenarios";
import { AuthError, checkRequestOrigin, createAuthenticator, type AuthBindings, type Session } from "./auth";
import { createSavedStore, savedPosition, SavedStoreError } from "./saved-strategies";
import { projectPosition, recordClose, recordCloseVoid, recordPriceCorrection, valuePosition, type CloseRequest, type CloseVoid, type PriceCorrection } from "./position-lifecycle";
import { projectPositionLots, upgradePositionLots, valuePositionLots, recordLotTransaction, recordLotPriceCorrection, recordLotOpeningPriceCorrection, recordLotCloseVoid, type OpeningPriceCorrection, type LotTransaction } from "./position-lots";
import { createMarketContextLoader, type MarketBindings } from "./market-context";
import { createBrokerContextLoader, createThetaRequest, searchSymbols, type BrokerBindings } from "./broker-context";
import { buildPriceHistory, loadPriceHistory } from "./price-history";
import { loadPositionPerformance, preparePositionPerformance, validatePerformanceRange } from "./position-performance";
import { buildIntradayHistory, buildIvHistory } from "./intraday-history";
import { createOptionChainStore, OptionChainLoadError } from "./option-chain";
import { MAX_OPTION_LEGS, MAX_OPTION_EXPIRIES } from "./options";
import { TEMPLATES, CandidateSearchLimitError, calculateStrategy, validateStrategy, validateMarketStrategy, validateConstruction, validateMarketConstruction, type StrategyState } from "./options";
import {
  AnalysisVerificationError,
  InvalidProposalError,
  MODEL,
  parseSparringRequest,
  parseLotConversation,
  discussLotComparison,
  discussPriceHistory,
  discussIntradayHistory,
  discussIvHistory,
  spar,
  type ProviderFetch,
} from "./sparring";

const MAX_REQUEST_BYTES = 128 * 1024;

function traceContext(c: Context<{ Bindings: Bindings; Variables: { session: Session } }>, kind: "sparring" | "lots" | "history" | "intraday", requestId: string) {
  const env = c.env;
  return { owner: c.get("session").owner, kind, requestId,
    secrets: [env.OPENROUTER_API_KEY, env.ALPACA_API_KEY, env.ALPACA_SECRET_KEY, env.FRED_API_KEY, env.EXA_AI_KEY, env.TASTYTRADE_CLIENT_ID, env.TASTYTRADE_CLIENT_SECRET, env.TASTYTRADE_REFRESH_TOKEN].filter((value): value is string => !!value),
    status: (id: string, status: "recording" | "complete" | "unavailable") => { c.header("X-ARGUS-Trace-Id", id); c.header("X-ARGUS-Trace-Status", status); },
  };
}

export type Bindings = MarketBindings & BrokerBindings & AuthBindings & {
  FEED?: DurableObjectNamespace;
  DB?: D1Database;
  ASSETS?: Fetcher;
  SAVED_RATE_LIMITER?: { limit(input: { key: string }): Promise<{ success: boolean }> };
  OPENROUTER_API_KEY?: string;
  SPARRING_RATE_LIMITER?: {
    limit(input: { key: string }): Promise<{ success: boolean }>;
  };
};

async function feedStub(env: Bindings) {
  const credentials = JSON.stringify([env.TASTYTRADE_CLIENT_ID, env.TASTYTRADE_CLIENT_SECRET, env.TASTYTRADE_REFRESH_TOKEN]);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(credentials));
  return env.FEED!.getByName(Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join(""));
}

async function readJson(request: Request, limit = MAX_REQUEST_BYTES): Promise<unknown> {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    throw new Error("content_type");
  }
  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > limit) {
    throw new Error("too_large");
  }
  const reader = request.body?.getReader();
  if (!reader) throw new Error("invalid_json");
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      throw new Error("too_large");
    }
    chunks.push(value);
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(body));
  } catch {
    throw new Error("invalid_json");
  }
}

export function createApp(providerFetch: ProviderFetch = fetch) {
  const app = new Hono<{ Bindings: Bindings; Variables: { session: Session } }>();
  const authenticate = createAuthenticator(providerFetch);
  const marketContext = createMarketContextLoader(providerFetch);
  const thetaRequest = createThetaRequest(providerFetch);
  const brokerContext = createBrokerContextLoader(providerFetch, thetaRequest);
  const chains = createOptionChainStore(providerFetch);

  async function loadContext(env: Bindings, symbol: string) {
    const [context, brokerSources] = await Promise.all([marketContext(env, symbol), brokerContext(env, symbol)]);
    return { ...context, sources: [...context.sources, ...brokerSources] };
  }

  async function loadLotComparison(owner: string, id: string, body: { revision: number; transaction: LotTransaction; snapshotId: string; basis: "mid" | "natural" }, env: Bindings) {
    const record = await createSavedStore(env.DB!).get(owner, id);
    if (record.revision !== body.revision) throw new SavedStoreError("conflict", 409);
    let before, after;
    try {
      const position = savedPosition(record);
      before = position.schemaVersion === 2 ? position : upgradePositionLots(position);
      after = recordLotTransaction(before, body.transaction);
    } catch { throw new SavedStoreError("invalid_request", 400); }
    const snapshot = await chains.get(body.snapshotId, env, owner);
    if (!snapshot) return { error: { code: "snapshot_expired", message: "Load matching workspace quotes before comparing the transaction." }, status: 409 as const };
    try {
      const beforeProjection = projectPositionLots(before), afterProjection = projectPositionLots(after);
      const cutoff = Math.max(Date.parse(beforeProjection.asOf), Date.parse(afterProjection.asOf)), retrievedAt = Date.parse(snapshot.retrievedAt);
      if (!Number.isFinite(retrievedAt) || retrievedAt < cutoff || retrievedAt > Date.now()) throw new Error("Comparison quotes precede the compared executions");
      const beforeValuation = beforeProjection.status === "closed" ? null : valuePositionLots(before, snapshot, body.basis);
      const afterValuation = afterProjection.status === "closed" ? null : valuePositionLots(after, snapshot, body.basis);
      if ([beforeValuation, afterValuation].some(valuation => valuation && Date.parse(valuation.oldestQuoteAt) < cutoff)) throw new Error("Comparison source quotes precede the compared executions");
      return { facts: { savedId: id, title: record.title, revision: record.revision, transaction: body.transaction, snapshotId: body.snapshotId, basis: body.basis,
        before: { projection: beforeProjection, valuation: beforeValuation }, after: { projection: afterProjection, valuation: afterValuation } } };
    } catch { return { error: { code: "incompatible_valuation", message: "The same dated quotes must cover both open inventories and follow their recorded executions." }, status: 422 as const }; }
  }

  app.onError((error, c) => {
    if (error instanceof AuthError || error instanceof SavedStoreError) return c.json({ error: { code: error.code } }, error.status);
    return c.json({ error: { code: "service_unavailable", message: "The request failed. Your workspace is unchanged." } }, 503);
  });
  app.use("*", async (c, next) => {
    c.header("Cache-Control", "no-store");
    const session = await authenticate(c.req.raw, c.env ?? {});
    checkRequestOrigin(c.req.raw, c.env ?? {}, session);
    c.set("session", session);
    await next();
  });

  app.use("/api/strategies*", async (c, next) => {
    if (!c.env.DB) return c.json({ error: { code: "storage_unavailable", message: "Saved strategies are not configured." } }, 503);
    const limited = await c.env.SAVED_RATE_LIMITER?.limit({ key: c.get("session").owner });
    if (limited && !limited.success) return c.json({ error: { code: "rate_limited", message: "Try saving or loading again later." } }, 429);
    await next();
  });
  app.get("/api/strategies", async c => c.json({ strategies: await createSavedStore(c.env.DB!).list(c.get("session").owner) }));
  app.get("/api/strategies/:id/lifecycle", async c => {
    const record = await createSavedStore(c.env.DB!).get(c.get("session").owner, c.req.param("id"));
    if (record.lifecycle?.schemaVersion === 2) return c.json({ error: { code: "lot_view_required", message: "This position contains dated lots. Original-inventory close management is unavailable." } }, 409);
    try {
      const position = savedPosition(record);
      if (position.schemaVersion !== 1) throw new Error("Lot view required");
      return c.json({ record, projection: projectPosition(position) });
    }
    catch { return c.json({ error: { code: "invalid_position", message: "Record held entry costs and save the position before recording closes." } }, 422); }
  });
  app.get("/api/strategies/:id/lots", async c => {
    const record = await createSavedStore(c.env.DB!).get(c.get("session").owner, c.req.param("id"));
    try {
      const position = savedPosition(record);
      return c.json({ record, projection: projectPositionLots(position.schemaVersion === 2 ? position : upgradePositionLots(position)) });
    } catch { return c.json({ error: { code: "invalid_position", message: "Valid held entry costs are required to view dated lots." } }, 422); }
  });
  app.post("/api/strategies/:id/performance", async c => {
    if (!c.get("session").local) return c.json({ error: { code: "history_local_only", message: "Hosted history requires a configured relay and shared provider limits." } }, 503);
    let body: { revision: number; range: { start: string; end: string } };
    try {
      body = await readJson(c.req.raw) as typeof body;
      if (!body || Object.keys(body).sort().join() !== "range,revision" || !Number.isSafeInteger(body.revision) || body.revision < 1) throw new Error();
      validatePerformanceRange(body.range);
    } catch (error) { return c.json({ error: { code: error instanceof Error && error.message === "too_large" ? "request_too_large" : "invalid_request" } }, error instanceof Error && error.message === "too_large" ? 413 : 400); }
    const owner = c.get("session").owner, id = c.req.param("id"), store = createSavedStore(c.env.DB!);
    const record = await store.get(owner, id);
    if (record.revision !== body.revision) throw new SavedStoreError("conflict", 409);
    let position: ReturnType<typeof upgradePositionLots>;
    try {
      const saved = savedPosition(record);
      position = saved.schemaVersion === 2 ? saved : upgradePositionLots(saved);
    } catch { return c.json({ error: { code: "invalid_position", message: "A saved listed position with held entry costs is required." } }, 422); }
    try { preparePositionPerformance(position, body.range); }
    catch { return c.json({ error: { code: "invalid_request", message: "Performance requires a listed position, at most 31 complete dates and 64 held identities." } }, 400); }
    let performance: Awaited<ReturnType<typeof loadPositionPerformance>>;
    try { performance = await loadPositionPerformance(position, body.range, c.env, thetaRequest); }
    catch { return c.json({ error: { code: "history_unavailable", message: "Daily performance unavailable or terminal busy. Missing marks have not been substituted; the saved position is unchanged." } }, 503); }
    if ((await store.get(owner, id)).revision !== body.revision) throw new SavedStoreError("conflict", 409);
    return c.json({ savedId: id, revision: record.revision, range: body.range, source: "Theta EOD", performance });
  });
  app.post("/api/strategies/:id/valuation", async c => {
    let body: { revision: number; snapshotId: string; basis: "mid" | "natural" };
    try {
      body = await readJson(c.req.raw) as typeof body;
      if (!body || Object.keys(body).sort().join() !== "basis,revision,snapshotId" || !Number.isSafeInteger(body.revision) || body.revision < 1 || typeof body.snapshotId !== "string" || !["mid", "natural"].includes(body.basis)) throw new Error();
    } catch (error) { return c.json({ error: { code: error instanceof Error && error.message === "too_large" ? "request_too_large" : "invalid_request" } }, error instanceof Error && error.message === "too_large" ? 413 : 400); }
    const owner = c.get("session").owner, record = await createSavedStore(c.env.DB!).get(owner, c.req.param("id"));
    if (record.revision !== body.revision) throw new SavedStoreError("conflict", 409);
    const snapshot = await chains.get(body.snapshotId, c.env, owner);
    if (!snapshot) return c.json({ error: { code: "snapshot_expired", message: "Load matching workspace quotes before valuing remaining holdings." } }, 409);
    try {
      const position = savedPosition(record);
      return c.json({ revision: record.revision, valuation: position.schemaVersion === 2 ? valuePositionLots(position, snapshot, body.basis) : valuePosition(position, snapshot, body.basis) });
    }
    catch { return c.json({ error: { code: "incompatible_valuation", message: "Quotes must cover the remaining holdings, follow every recorded close, and precede option expiry." } }, 422); }
  });
  app.post("/api/strategies/:id/transaction-comparison", async c => {
    let body: { revision: number; transaction: LotTransaction; snapshotId: string; basis: "mid" | "natural" };
    try {
      body = await readJson(c.req.raw) as typeof body;
      if (!body || Object.keys(body).sort().join() !== "basis,revision,snapshotId,transaction" || !Number.isSafeInteger(body.revision) || body.revision < 1 || typeof body.snapshotId !== "string" || !body.snapshotId || !["mid", "natural"].includes(body.basis)) throw new Error();
    } catch (error) {
      return c.json({ error: { code: error instanceof Error && error.message === "too_large" ? "request_too_large" : "invalid_request" } }, error instanceof Error && error.message === "too_large" ? 413 : 400);
    }
    const result = await loadLotComparison(c.get("session").owner, c.req.param("id"), body, c.env);
    if (result.error) return c.json({ error: result.error }, result.status);
    const { revision, transaction, snapshotId, basis, before, after } = result.facts;
    return c.json({ revision, transactionId: transaction.id, snapshotId, basis, before, after });
  });
  app.post("/api/strategies/:id/lot-discussion", async c => {
    let body: { request_id: string; revision: number; transaction: LotTransaction; snapshotId: string; basis: "mid" | "natural"; conversation: unknown; scenario?: LotScenario };
    try {
      body = await readJson(c.req.raw) as typeof body;
      if (!body || Object.keys(body).filter(key => key !== "scenario").sort().join() !== "basis,conversation,request_id,revision,snapshotId,transaction" || typeof body.request_id !== "string" || !body.request_id || body.request_id.length > 128 || !Number.isSafeInteger(body.revision) || body.revision < 1 || typeof body.snapshotId !== "string" || !body.snapshotId || !["mid", "natural"].includes(body.basis)) throw new Error();
      if ("scenario" in body && (!body.scenario || Object.keys(body.scenario).sort().join() !== "date,ivShift,spot")) throw new Error();
    } catch (error) { return c.json({ error: { code: error instanceof Error && error.message === "too_large" ? "request_too_large" : "invalid_request" } }, error instanceof Error && error.message === "too_large" ? 413 : 400); }
    const conversation = parseLotConversation(body.conversation);
    if (!conversation) return c.json({ error: { code: "invalid_request" } }, 400);
    const owner = c.get("session").owner;
    const result = await loadLotComparison(owner, c.req.param("id"), body, c.env);
    if (result.error) return c.json({ error: result.error }, result.status);
    let scenario;
    try { scenario = body.scenario === undefined ? undefined : calculateLotScenarioComparison(result.facts, body.scenario); }
    catch { return c.json({ error: { code: "incompatible_scenario", message: "Scenario coordinates must fit both complete inventories, follow the captured quotes and not pass the first remaining expiry." } }, 422); }
    const facts = { ...result.facts, ...(scenario ? { scenario } : {}) };
    const limited = await c.env.SPARRING_RATE_LIMITER?.limit({ key: owner });
    if (limited && !limited.success) return c.json({ error: { code: "rate_limited" } }, 429);
    if (!c.env.OPENROUTER_API_KEY) return c.json({ error: { code: "ai_unavailable", message: "Add OPENROUTER_API_KEY to enable discussion." } }, 503);
    try {
      const { reply, requestedScenarios } = await withAnalysisTrace(c.env.DB, traceContext(c, "lots", body.request_id), (prompts, observe) => discussLotComparison(facts, conversation, c.env.OPENROUTER_API_KEY!, providerFetch, prompts, observe));
      return c.json({ request_id: body.request_id, facts, reply, requestedScenarios });
    } catch (error) {
      return c.json({ request_id: body.request_id, error: { code: error instanceof AnalysisTraceError ? "trace_unavailable" : error instanceof AnalysisVerificationError ? "analysis_unverified" : "provider_error", message: "The discussion could not be verified and was withheld. No position or transaction changed." } }, error instanceof AnalysisTraceError ? 503 : 502);
    }
  });
  app.post("/api/strategies/:id/transactions/:preview?", async c => {
    if (c.req.param("preview") && c.req.param("preview") !== "preview") return c.notFound();
    let body: { revision: number; transaction: LotTransaction };
    try {
      body = await readJson(c.req.raw) as typeof body;
      if (!body || Object.keys(body).sort().join() !== "revision,transaction" || !Number.isSafeInteger(body.revision) || body.revision < 1) throw new Error();
    } catch (error) {
      return c.json({ error: { code: error instanceof Error && error.message === "too_large" ? "request_too_large" : "invalid_request" } }, error instanceof Error && error.message === "too_large" ? 413 : 400);
    }
    const store = createSavedStore(c.env.DB!), owner = c.get("session").owner, id = c.req.param("id");
    if (c.req.param("preview")) {
      const record = await store.get(owner, id);
      if (record.revision !== body.revision) throw new SavedStoreError("conflict", 409);
      try {
        const position = savedPosition(record);
        const next = recordLotTransaction(position.schemaVersion === 2 ? position : upgradePositionLots(position), body.transaction);
        return c.json({ revision: record.revision, projection: projectPositionLots(next) });
      } catch { throw new SavedStoreError("invalid_request", 400); }
    }
    const record = await store.transact(owner, id, body.revision, body.transaction);
    if (record.lifecycle?.schemaVersion !== 2) throw new Error("Lot transaction did not produce a lot ledger");
    return c.json({ record, projection: projectPositionLots(record.lifecycle) });
  });
  for (const [path, key] of [["lot-price-corrections", "correction"], ["lot-close-voids", "void"], ["lot-opening-price-corrections", "correction"]] as const) app.post(`/api/strategies/:id/${path}/:preview?`, async c => {
    if (c.req.param("preview") && c.req.param("preview") !== "preview") return c.notFound();
    let body: { revision: number; correction: PriceCorrection; void: CloseVoid };
    try {
      body = await readJson(c.req.raw) as typeof body;
      if (!body || Object.keys(body).sort().join() !== [key, "revision"].sort().join() || !Number.isSafeInteger(body.revision) || body.revision < 1) throw new Error();
    } catch (error) { return c.json({ error: { code: error instanceof Error && error.message === "too_large" ? "request_too_large" : "invalid_request" } }, error instanceof Error && error.message === "too_large" ? 413 : 400); }
    const store = createSavedStore(c.env.DB!), owner = c.get("session").owner, id = c.req.param("id");
    const current = await store.get(owner, id);
    const opening = path === "lot-opening-price-corrections";
    const openingCorrection = body.correction as unknown as OpeningPriceCorrection;
    if (!opening && current.lifecycle?.schemaVersion !== 2) return c.json({ error: { code: "legacy_view_required", message: "Use Manage closes for this original-inventory position." } }, 409);
    if (c.req.param("preview")) {
      if (current.revision !== body.revision) throw new SavedStoreError("conflict", 409);
      try {
        const saved = savedPosition(current), position = saved.schemaVersion === 2 ? saved : upgradePositionLots(saved);
        const next = opening ? recordLotOpeningPriceCorrection(position, openingCorrection) : key === "void" ? recordLotCloseVoid(position, body.void) : recordLotPriceCorrection(position, body.correction);
        return c.json({ revision: current.revision, projection: projectPositionLots(next) });
      } catch { throw new SavedStoreError("invalid_request", 400); }
    }
    const record = opening ? await store.correctOpeningPrice(owner, id, body.revision, openingCorrection) : key === "void" ? await store.voidClose(owner, id, body.revision, body.void) : await store.correctPrice(owner, id, body.revision, body.correction);
    if (record.lifecycle?.schemaVersion !== 2) throw new Error("Lot amendment did not retain its lot ledger");
    return c.json({ record, projection: projectPositionLots(record.lifecycle) });
  });
  for (const [path, key] of [["closes", "close"], ["price-corrections", "correction"], ["close-voids", "void"]] as const) app.post(`/api/strategies/:id/${path}/:preview?`, async c => {
    if (c.req.param("preview") && c.req.param("preview") !== "preview") return c.notFound();
    let body: { revision: number; close: CloseRequest; correction: PriceCorrection; void: CloseVoid };
    try {
      body = await readJson(c.req.raw) as typeof body;
      if (!body || Object.keys(body).sort().join() !== [key, "revision"].sort().join() || !Number.isSafeInteger(body.revision) || body.revision < 1) throw new Error();
    } catch (error) {
      return c.json({ error: { code: error instanceof Error && error.message === "too_large" ? "request_too_large" : "invalid_request" } }, error instanceof Error && error.message === "too_large" ? 413 : 400);
    }
    const store = createSavedStore(c.env.DB!), owner = c.get("session").owner, id = c.req.param("id");
    const current = await store.get(owner, id);
    if (current.lifecycle?.schemaVersion === 2) return c.json({ error: { code: "lot_view_required", message: "Use lot-specific actions for this position; original-inventory actions are unavailable." } }, 409);
    if (c.req.param("preview")) {
      const record = current;
      if (record.revision !== body.revision) throw new SavedStoreError("conflict", 409);
      try {
        const position = savedPosition(record);
        if (position.schemaVersion !== 1) throw new Error("Lot actions required");
        const next = key === "void" ? recordCloseVoid(position, body.void) : key === "correction" ? recordPriceCorrection(position, body.correction) : recordClose(position, body.close);
        return c.json({ revision: record.revision, projection: projectPosition(next) });
      } catch { throw new SavedStoreError("invalid_request", 400); }
    }
    const record = key === "void" ? await store.voidClose(owner, id, body.revision, body.void) : key === "correction" ? await store.correctPrice(owner, id, body.revision, body.correction) : await store.close(owner, id, body.revision, body.close);
    if (record.lifecycle?.schemaVersion !== 1) return c.json({ error: { code: "lot_view_required", message: "Position changed to dated lots. Reload its lot view." } }, 409);
    return c.json({ record, projection: projectPosition(record.lifecycle!) });
  });
  app.post('/api/strategies/import', async c => {
    let body: unknown;
    try { body = await readJson(c.req.raw, 2 * 1024 * 1024); }
    catch (error) { return c.json({ error: { code: error instanceof Error && error.message === 'too_large' ? 'request_too_large' : 'invalid_request' } }, error instanceof Error && error.message === 'too_large' ? 413 : 400); }
    const record = await createSavedStore(c.env.DB!).importRecord(c.get('session').owner, body);
    return c.json({ record, notice: 'Imported as a new saved position. File contents and recorded activity are user-supplied, not independently verified. Quotes are historical. Open workspace unchanged.' }, 201);
  });
  app.get("/api/strategies/:id/export", async c => {
    const record = await createSavedStore(c.env.DB!).get(c.get("session").owner, c.req.param("id"));
    return c.json({ format: "argus-saved-position", formatVersion: 1, exportedAt: new Date().toISOString(), record });
  });
  app.get("/api/strategies/:id", async c => {
    const record = await createSavedStore(c.env.DB!).get(c.get("session").owner, c.req.param("id"));
    if (record.lifecycle) return c.json({ error: { code: "lifecycle_view_required", message: "This position has recorded closes and cannot be loaded as its original strategy." } }, 409);
    if (validateConstruction(record.state).length || (record.state.pricing && !record.snapshot)) throw new Error("Invalid saved state");
    if (record.snapshot) {
      if (record.snapshot.underlying === undefined && record.state.underlying === "SPY") record.snapshot.underlying = "SPY";
      if (validateMarketConstruction(record.state, record.snapshot).length) throw new Error("Invalid saved pricing");
      record.snapshot = await chains.restore(record.snapshot, c.env, c.get("session").owner);
      record.state.pricing = { ...record.state.pricing!, snapshotId: record.snapshot.id, historical: true };
    }
    return c.json({ record });
  });
  app.on(["POST", "PUT", "DELETE"], ["/api/strategies", "/api/strategies/:id"], async c => {
    let body: { title: string; state: StrategyState; revision: number };
    try { body = await readJson(c.req.raw) as typeof body; if (!body || typeof body !== "object") throw new Error(); }
    catch (error) { return c.json({ error: { code: error instanceof Error && error.message === "too_large" ? "request_too_large" : "invalid_request" } }, error instanceof Error && error.message === "too_large" ? 413 : 400); }
    const store = createSavedStore(c.env.DB!), owner = c.get("session").owner, id = c.req.param("id");
    if (c.req.method === "DELETE") {
      if (!id) return c.json({ error: { code: "invalid_request" } }, 400);
      await store.remove(owner, id, body.revision);
      return c.json({ deleted: true });
    }
    if (c.req.method === "PUT" && !id || c.req.method === "POST" && id) return c.json({ error: { code: "invalid_request" } }, 400);
    const input = body.state;
    if (validateConstruction(input).length || typeof input.id !== "string" || typeof input.name !== "string") return c.json({ error: { code: "invalid_strategy" } }, 422);
    const snapshot = input.pricing ? await chains.get(input.pricing.snapshotId, c.env, owner) : undefined;
    if (input.pricing && !snapshot) return c.json({ error: { code: "snapshot_expired", message: "Refresh prices or reload the saved strategy before saving." } }, 409);
    if (snapshot && validateMarketConstruction(input, snapshot).length) return c.json({ error: { code: "invalid_market_state" } }, 422);
    const { version, name, underlying, spot, valuationTimestamp, rate, dividendYield, scenarioDate, scenarioSpot, ivShift } = input;
    const state: StrategyState = {
      id: input.id, version, name, underlying, spot, valuationTimestamp, rate, dividendYield, scenarioDate, scenarioSpot, ivShift,
      legs: input.legs.map(({ id, contractId, side, type, contracts, strike, expiry, entryPrice, iv, multiplier }) => ({ id, contractId, side, type, contracts, strike, expiry, entryPrice, iv, multiplier })),
      ...(input.excludedLegIds !== undefined ? { excludedLegIds: [...input.excludedLegIds] } : {}),
      ...(input.stock ? { stock: { shares: input.stock.shares, entryPrice: input.stock.entryPrice } } : {}),
      ...(input.feeAllowance !== undefined ? { feeAllowance: input.feeAllowance } : {}),
      ...(input.valuationModel !== undefined ? { valuationModel: input.valuationModel } : {}),
      ...(input.expiryIvShifts !== undefined ? { expiryIvShifts: input.expiryIvShifts.map(({ expiry, ivShift }) => ({ expiry, ivShift })) } : {}),
      ...(input.pricing ? { pricing: { mode: "market" as const, snapshotId: input.pricing.snapshotId, basis: input.pricing.basis, ...(input.pricing.entryMode ? { entryMode: input.pricing.entryMode } : {}), ...(snapshot?.historical ? { historical: true as const } : {}) } } : {}),
    };
    const record = id ? await store.update(owner, id, body.revision, body.title, state, snapshot) : await store.create(owner, body.title, state, snapshot);
    return c.json({ record }, id ? 200 : 201);
  });

  app.get("/api/context", async c => {
    const symbol = c.req.query("symbol") ?? "SPY";
    if (!/^[A-Z]{1,6}$/.test(symbol)) return c.json({ error: { code: "invalid_symbol" } }, 400);
    const limited = await c.env.SPARRING_RATE_LIMITER?.limit({ key: c.get("session").owner });
    if (limited && !limited.success) return c.json({ error: { code: "rate_limited" } }, 429);
    c.header("Cache-Control", "no-store");
    return c.json({ symbol, ...await loadContext(c.env, symbol) });
  });

  app.get("/api/symbols", async c => {
    const limited = await c.env.SPARRING_RATE_LIMITER?.limit({ key: c.get("session").owner });
    if (limited && !limited.success) return c.json({ error: { code: "rate_limited" } }, 429);
    try {
      return c.json(await searchSymbols(c.env, c.req.query("q") ?? "", providerFetch));
    } catch (error) {
      if (error instanceof Error && error.message === "invalid_query") return c.json({ error: { code: "invalid_query" } }, 400);
      return c.json({ error: { code: "symbols_unavailable" } }, 503);
    }
  });

  app.get("/api/chain", async (c) => {
    const symbol = c.req.query("symbol") ?? "SPY";
    if (!/^[A-Z]{1,6}$/.test(symbol)) return c.json({ error: { code: "invalid_symbol" } }, 400);
    const centerText = c.req.query("center"), center = centerText === undefined ? undefined : Number(centerText);
    const retain = c.req.query("retain")?.split(",");
    if (center !== undefined && (!Number.isFinite(center) || center <= 0 || center > 1_000_000) || retain && (!retain.length || retain.length > MAX_OPTION_LEGS || new Set(retain).size !== retain.length || retain.some(id => id.slice(0, 6) !== symbol.padEnd(6) || !/^\d{6}[CP]\d{8}$/.test(id.slice(6))))) return c.json({ error: { code: "invalid_chain_window" } }, 400);
    const dates = c.req.query("expiries")?.split(",");
    if (dates && (!dates.length || dates.length > MAX_OPTION_EXPIRIES || dates.some((date) => !/^\d{4}-\d{2}-\d{2}$/.test(date)) || new Set(dates).size !== dates.length)) return c.json({ error: { code: "invalid_expiries" } }, 400);
    const limited = await c.env?.SPARRING_RATE_LIMITER?.limit({ key: c.get("session").owner });
    if (limited && !limited.success) return c.json({ error: { code: "rate_limited", message: "Try refreshing later." } }, 429);
    try {
      const snapshot = await chains.load(c.env ?? {}, dates, c.get("session").owner, symbol, { center, retain });
      c.header("Cache-Control", "no-store");
      return c.json({ snapshot });
    } catch (error) {
      return c.json({ error: { code: "chain_unavailable", message: "Real option pricing is unavailable. Your current position is unchanged.", ...(c.get("session").local && error instanceof OptionChainLoadError ? { diagnostic: { stage: error.stage, reason: error.reason } } : {}) } }, 503);
    }
  });

  app.post("/api/price-history/:action?", async c => {
    const discussion = c.req.param("action") === "discuss";
    if (c.req.param("action") && !discussion) return c.notFound();
    if (!c.get("session").local) return c.json({ error: { code: "history_local_only", message: "Hosted history requires a configured relay and shared provider limits." } }, 503);
    let body: any;
    try { body = await readJson(c.req.raw); } catch { return c.json({ error: { code: "invalid_history_request" } }, 400); }
    if (!body || typeof body !== "object" || Object.keys(body).sort().join() !== (discussion ? "conversation,range,request_id,selectedDate,state" : "range,state") || !body.range || typeof body.range !== "object" || Object.keys(body.range).sort().join() !== "end,start") return c.json({ error: { code: "invalid_history_request" } }, 400);
    const conversation = discussion ? parseLotConversation(body.conversation) : null;
    if (discussion && (!conversation || typeof body.request_id !== "string" || !body.request_id.trim() || body.request_id.length > 128 || typeof body.selectedDate !== "string")) return c.json({ error: { code: "invalid_history_request" } }, 400);
    if (validateStrategy(body.state).length || body.state.pricing?.mode !== "market") return c.json({ error: { code: "invalid_market_state" } }, 422);
    const snapshot = await chains.get(body.state.pricing.snapshotId, c.env, c.get("session").owner);
    if (!snapshot) return c.json({ error: { code: "snapshot_expired" } }, 409);
    if (validateMarketStrategy(body.state, snapshot).length) return c.json({ error: { code: "invalid_market_state" } }, 422);
    try {
      const empty = buildPriceHistory(body.state, body.state.legs.map(() => ({ response: [] })), { response: [] }, body.range);
      if (discussion && !empty.rows.some(row => row.date === body.selectedDate)) throw new Error();
    }
    catch { return c.json({ error: { code: "invalid_history_request" } }, 400); }
    const limited = await c.env.SPARRING_RATE_LIMITER?.limit({ key: c.get("session").owner });
    if (limited && !limited.success) return c.json({ error: { code: "rate_limited" } }, 429);
    if (discussion && !c.env.OPENROUTER_API_KEY) return c.json({ error: { code: "ai_unavailable" } }, 503);
    let history: ReturnType<typeof buildPriceHistory>;
    try {
      history = await loadPriceHistory(body.state, body.range, c.env, thetaRequest);
    } catch { return c.json({ error: { code: "history_unavailable", message: "History unavailable or terminal busy. No missing prices have been substituted; your position is unchanged." } }, 503); }
    const result = { history, snapshotId: snapshot.id, positionVersion: body.state.version, range: body.range, source: "Theta EOD", basis: "Current inventory at daily EOD midpoints, not historical holdings, P/L or executable synchronized quotes. Report times are not quote timestamps." };
    if (!discussion) return c.json(result);
    try {
      const { reply } = await withAnalysisTrace(c.env.DB, traceContext(c, "history", body.request_id), (prompts, observe) => discussPriceHistory({ state: body.state, range: body.range, history, selectedDate: body.selectedDate }, conversation!, c.env.OPENROUTER_API_KEY!, providerFetch, prompts, observe));
      return c.json({ ...result, reply, request_id: body.request_id, selectedDate: body.selectedDate });
    } catch (error) {
      return c.json({ request_id: body.request_id, error: { code: error instanceof AnalysisTraceError ? "trace_unavailable" : error instanceof AnalysisVerificationError ? "analysis_unverified" : "provider_error", message: "History discussion could not be verified and was withheld. No position changed." } }, error instanceof AnalysisTraceError ? 503 : 502);
    }
  });

  app.post('/api/intraday-history/:action?', async c => {
    const discussion = c.req.param('action') === 'discuss' || c.req.param('action') === 'iv-discuss';
    const iv = c.req.param('action') === 'iv' || c.req.param('action') === 'iv-discuss';
    if (c.req.param('action') && !discussion && !iv) return c.notFound();
    let body: any;
    try { body = await readJson(c.req.raw); } catch { return c.json({ error: { code: 'invalid_history_request' } }, 400); }
    if (!body || typeof body !== 'object' || Object.keys(body).sort().join() !== (discussion ? iv ? 'contractId,conversation,range,request_id,selectedTime,state' : 'conversation,range,request_id,selectedTime,state' : 'range,state') || !body.range || typeof body.range !== 'object' || Object.keys(body.range).sort().join() !== 'end,start') return c.json({ error: { code: 'invalid_history_request' } }, 400);
    const conversation = discussion ? parseLotConversation(body.conversation) : null;
    if (discussion && (!conversation || typeof body.request_id !== 'string' || !body.request_id.trim() || body.request_id.length > 128 || !Number.isSafeInteger(body.selectedTime))) return c.json({ error: { code: 'invalid_history_request' } }, 400);
    if (validateStrategy(body.state).length || body.state.pricing?.mode !== 'market') return c.json({ error: { code: 'invalid_market_state' } }, 422);
    const session = c.get('session'), snapshot = await chains.get(body.state.pricing.snapshotId, c.env, session.owner);
    if (!snapshot) return c.json({ error: { code: 'snapshot_expired' } }, 409);
    if (validateMarketStrategy(body.state, snapshot).length) return c.json({ error: { code: 'invalid_market_state' } }, 422);
    try {
      const empty = (iv ? buildIvHistory : buildIntradayHistory)(body.state, body.range);
      if (discussion && !empty.rows.some(row => row.time === body.selectedTime)) throw new Error();
      if (discussion && iv && (typeof body.contractId !== 'string' || !body.state.legs.some((leg: StrategyState['legs'][number]) => leg.contractId === body.contractId))) throw new Error();
    }
    catch { return c.json({ error: { code: 'invalid_history_request' } }, 400); }
    if (!c.env.FEED || !c.env.TASTYTRADE_CLIENT_SECRET || !c.env.TASTYTRADE_REFRESH_TOKEN) return c.json({ error: { code: 'feed_unavailable' } }, 503);
    const limited = await c.env.SPARRING_RATE_LIMITER?.limit({ key: session.owner });
    if (limited && !limited.success) return c.json({ error: { code: 'rate_limited' } }, 429);
    if (discussion && !c.env.OPENROUTER_API_KEY) return c.json({ error: { code: 'ai_unavailable' } }, 503);
    let history: ReturnType<typeof buildIntradayHistory> | ReturnType<typeof buildIvHistory>;
    try {
      const response = await (await feedStub(c.env)).fetch(new Request(`https://feed.internal/${iv ? 'history-iv' : 'history'}`, { method: 'POST', headers: {
        'X-ARGUS-Feed-Selection': JSON.stringify({ underlying: snapshot.underlying, contractIds: body.state.legs.map((leg: StrategyState['legs'][number]) => leg.contractId) }),
        'X-ARGUS-Feed-Expires-At': String(session.expiresAt), 'X-ARGUS-History-Range': JSON.stringify(body.range),
      } }));
      if (!response.ok || Date.now() >= session.expiresAt) throw new Error();
      const raw = await response.json();
      if (Date.now() >= session.expiresAt) throw new Error();
      history = iv ? buildIvHistory(body.state, body.range, raw) : buildIntradayHistory(body.state, body.range, raw);
      if (Date.now() >= session.expiresAt) throw new Error();
    } catch { return c.json({ error: { code: 'history_unavailable', message: 'Intraday history unavailable or busy. Missing prices have not been substituted; your position is unchanged.' } }, 503); }
    const result = { history, snapshotId: snapshot.id, positionVersion: body.state.version, range: body.range };
    if (!discussion) return c.json(result);
    try {
      const { reply } = await withAnalysisTrace(c.env.DB, traceContext(c, "intraday", body.request_id), async (prompts, observe) => {
        const result = history.basis === 'option-trade-candle-iv'
          ? await discussIvHistory({ state: body.state, range: body.range, history, contractId: body.contractId, selectedTime: body.selectedTime }, conversation!, c.env.OPENROUTER_API_KEY!, providerFetch, prompts, observe)
          : await discussIntradayHistory({ state: body.state, range: body.range, history, selectedTime: body.selectedTime }, conversation!, c.env.OPENROUTER_API_KEY!, providerFetch, prompts, observe);
        if (Date.now() >= session.expiresAt) throw new Error('Session expired');
        return result;
      });
      if (Date.now() >= session.expiresAt) throw new Error('Session expired');
      return c.json({ ...result, reply, request_id: body.request_id, selectedTime: body.selectedTime, ...(iv ? { contractId: body.contractId } : {}) });
    } catch (error) {
      return c.json({ request_id: body.request_id, error: { code: error instanceof AnalysisTraceError ? 'trace_unavailable' : error instanceof AnalysisVerificationError ? 'analysis_unverified' : 'provider_error', message: 'Intraday discussion could not be verified and was withheld. No position changed.' } }, error instanceof AnalysisTraceError ? 503 : 502);
    }
  });

  app.get("/api/feed", async c => {
    if (c.req.header("Upgrade")?.toLowerCase() !== "websocket") return c.json({ error: { code: "websocket_required" } }, 426);
    const snapshot = await chains.get(c.req.query("snapshot") ?? "", c.env, c.get("session").owner);
    if (!snapshot) return c.json({ error: { code: "snapshot_expired" } }, 409);
    const selectedContracts = c.req.query("contracts");
    const contractIds = selectedContracts === "" ? [] : selectedContracts?.split(",") ?? [""];
    if (contractIds.length > MAX_OPTION_LEGS || new Set(contractIds).size !== contractIds.length || contractIds.some(id => !snapshot.contracts.some(contract => contract.contractId === id && Date.parse(contract.expiry) > Date.now()))) return c.json({ error: { code: "invalid_feed_selection" } }, 400);
    if (!c.env.FEED || !c.env.TASTYTRADE_CLIENT_SECRET || !c.env.TASTYTRADE_REFRESH_TOKEN) return c.json({ error: { code: "feed_unavailable" } }, 503);
    const limited = await c.env.SPARRING_RATE_LIMITER?.limit({ key: c.get("session").owner });
    if (limited && !limited.success) return c.json({ error: { code: "rate_limited" } }, 429);
    return (await feedStub(c.env)).fetch(new Request("https://feed.internal/", { headers: { Upgrade: "websocket", "X-ARGUS-Feed-Selection": JSON.stringify({ underlying: snapshot.underlying, contractIds }), "X-ARGUS-Feed-Expires-At": String(c.get("session").expiresAt) } }));
  });

  app.post("/api/feed/capture", async c => {
    let body: any;
    try { body = await readJson(c.req.raw); } catch { return c.json({ error: { code: "invalid_capture" } }, 400); }
    if (!body || typeof body !== "object" || Object.keys(body).some(key => !["snapshotId", "contractIds"].includes(key)) || typeof body.snapshotId !== "string" || !Array.isArray(body.contractIds) || body.contractIds.length > MAX_OPTION_LEGS || new Set(body.contractIds).size !== body.contractIds.length || body.contractIds.some((id: unknown) => typeof id !== "string")) return c.json({ error: { code: "invalid_capture" } }, 400);
    const owner = c.get("session").owner;
    const base = await chains.get(body.snapshotId, c.env, owner);
    if (!base) return c.json({ error: { code: "snapshot_expired" } }, 409);
    if (body.contractIds.some((id: string) => !base.contracts.some(contract => contract.contractId === id && Date.parse(contract.expiry) > Date.now()))) return c.json({ error: { code: "invalid_capture" } }, 400);
    if (!c.env.FEED || !c.env.TASTYTRADE_CLIENT_SECRET || !c.env.TASTYTRADE_REFRESH_TOKEN) return c.json({ error: { code: "feed_unavailable" } }, 503);
    const limited = await c.env.SPARRING_RATE_LIMITER?.limit({ key: owner });
    if (limited && !limited.success) return c.json({ error: { code: "rate_limited" } }, 429);
    try {
      const response = await (await feedStub(c.env)).fetch(new Request("https://feed.internal/capture", { method: "POST", headers: { "X-ARGUS-Feed-Selection": JSON.stringify({ underlying: base.underlying, contractIds: body.contractIds }) } }));
      if (!response.ok) throw new Error("Capture unavailable");
      const capture = await response.json() as import("./quote-feed").StreamCapture;
      return c.json({ snapshot: await chains.capture(base, body.contractIds, capture, c.env, owner) });
    } catch { return c.json({ error: { code: "capture_unavailable", message: "Dated stream capture unavailable. Complete recent quote and IV timestamps are required; refresh quotes instead. Position unchanged." } }, 409); }
  });

  app.get("/api/bootstrap", async (c) => {
    const session = c.get("session");
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(["argus-tab-draft-v1", session.local, session.owner])));
    const recoveryKey = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
    return c.json({
      chat_available: Boolean(c.env.OPENROUTER_API_KEY),
      model: MODEL,
      templates: TEMPLATES,
      session: { label: session.label, local: session.local, recoveryKey },
    });
  });

  app.post("/api/calculate", async (c) => {
    try {
      const state = (await readJson(c.req.raw)) as StrategyState;
      const snapshot = state?.pricing?.mode === "market" ? await chains.get(state.pricing.snapshotId, c.env ?? {}, c.get("session").owner) : undefined;
      if (state?.pricing?.mode === "market" && !snapshot) return c.json({ error: { code: "snapshot_expired", message: "Refresh option prices before continuing." } }, 409);
      const errors = validateStrategy(state);
      if (snapshot) errors.push(...validateMarketStrategy(state, snapshot));
      return errors.length > 0
        ? c.json({ error: { code: "invalid_strategy", message: errors.join("; ") } }, 422)
        : c.json({ metrics: calculateStrategy(state) });
    } catch (error) {
      if (error instanceof Error && error.message === "too_large") {
        return c.json({ error: { code: "request_too_large" } }, 413);
      }
      return c.json({ error: { code: "invalid_request" } }, 400);
    }
  });

  app.post("/api/sparring", async (c) => {
    let raw: unknown;
    try {
      raw = await readJson(c.req.raw);
    } catch (error) {
      if (error instanceof Error && error.message === "too_large") {
        return c.json({ error: { code: "request_too_large" } }, 413);
      }
      return c.json({ error: { code: "invalid_request" } }, 400);
    }
    const request = parseSparringRequest(raw);
    if (!request) return c.json({ error: { code: "invalid_request" } }, 400);
    const snapshot = request.state.pricing?.mode === "market" ? await chains.get(request.state.pricing.snapshotId, c.env, c.get("session").owner) : undefined;
    if (request.state.pricing?.mode === "market" && !snapshot) return c.json({ error: { code: "snapshot_expired", message: "Refresh option prices before asking for analysis." } }, 409);
    if (snapshot && validateMarketConstruction(request.state, snapshot).length) return c.json({ error: { code: "invalid_market_state", message: "Position inputs do not match the quote snapshot." } }, 422);

    const limited = await c.env.SPARRING_RATE_LIMITER?.limit({
      key: c.get("session").owner,
    });
    if (limited && !limited.success) {
      return c.json(
        {
          request_id: request.request_id,
          base_state_version: request.base_state_version,
          error: { code: "rate_limited", message: "Try again later." },
        },
        429,
      );
    }

    if (!c.env.OPENROUTER_API_KEY) {
      return c.json(
        {
          request_id: request.request_id,
          base_state_version: request.base_state_version,
          error: { code: "ai_unavailable", message: "Add OPENROUTER_API_KEY to enable chat." },
        },
        503,
      );
    }

    try {
      return c.json(await withAnalysisTrace(c.env.DB, traceContext(c, "sparring", request.request_id), async (prompts, observe) => {
        const context = await loadContext(c.env, request.state.underlying);
        return spar(request, c.env.OPENROUTER_API_KEY!, providerFetch, context, snapshot, prompts, observe);
      }));
    } catch (error) {
      if (error instanceof AnalysisTraceError) return c.json({ request_id: request.request_id, base_state_version: request.base_state_version, error: { code: "trace_unavailable", message: "Analysis tracing is unavailable. The response was withheld; your position is unchanged." } }, 503);
      if (error instanceof AnalysisVerificationError) return c.json({
        request_id: request.request_id,
        base_state_version: request.base_state_version,
        error: { code: "analysis_unverified", message: "The draft did not pass the analysis check and was withheld. Your position is unchanged." },
      }, 502);
      if (error instanceof CandidateSearchLimitError) return c.json({
        request_id: request.request_id, base_state_version: request.base_state_version,
        error: { code: "candidate_search_limit", message: "Candidate search exceeds 300,000 structures; narrow the quoted strike/expiry window. Your position is unchanged." },
      }, 422);
      if (error instanceof InvalidProposalError) {
        return c.json(
          {
            request_id: request.request_id,
            base_state_version: request.base_state_version,
            error: { code: "invalid_proposal", message: "The proposal was rejected; the strategy was not changed." },
          },
          422,
        );
      }
      return c.json(
        {
          request_id: request.request_id,
          base_state_version: request.base_state_version,
          error: { code: "provider_error", message: "The strategy was not changed." },
        },
        502,
      );
    }
  });

  app.get("/api/analysis-traces/:id", async c => {
    if (!c.env.DB) return c.json({ error: { code: "trace_unavailable" } }, 503);
    const trace = await readAnalysisTrace(c.env.DB, c.get("session").owner, c.req.param("id"));
    return trace ? c.json(trace) : c.json({ error: { code: "not_found" } }, 404);
  });
  app.all("/api/*", (c) => c.json({ error: { code: "not_found" } }, 404));
  app.get("*", c => c.env.ASSETS ? c.env.ASSETS.fetch(c.req.raw) : c.notFound());
  return app;
}

export default createApp();
export { QuoteFeed } from "./quote-feed";
