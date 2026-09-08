import { env } from "cloudflare:workers";
import snapshotMigration from "../migrations/0003_quote_snapshots.sql?raw";
import promptMigration from "../migrations/0004_analysis_prompts.sql?raw";
import traceMigration from "../migrations/0005_analysis_traces.sql?raw";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { calculateStrategy, createStrategy, createMarketStrategy, scenarioTable, scenarioSpotAttribution, searchCandidates, type MarketSnapshot } from "../src/options";
import { MODEL, RESPONSE_SCHEMA, spar, strategyFacts, parseSparringRequest, discussLotComparison, parseLotConversation, type LotDiscussionFacts, type ProviderFetch } from "../src/sparring";
import { createApp, type Bindings } from "../src/worker";
import { createPosition } from "../src/position-lifecycle";
import { projectPositionLots, upgradePositionLots } from "../src/position-lots";

const local = { ARGUS_LOCAL_DEV: "true" };
const traceDB = (env as { DB: D1Database }).DB;
beforeAll(async () => { await traceDB.batch([...promptMigration.split(/;\s*(?=CREATE|$)/), ...traceMigration.split(/;\s*(?=CREATE|$)/)].filter(sql => sql.trim()).map(sql => traceDB.prepare(sql))); });
it("protects symbol discovery and keeps provider failures and credentials private", async () => {
  const provider = vi.fn<typeof fetch>(async input => String(input).endsWith("/oauth/token") ? new Response(JSON.stringify({ access_token: "private-token" })) : new Response(JSON.stringify({ data: { items: [{ symbol: "AAPL", description: "Apple Inc.", options: true, "instrument-type": "Equity" }] } })));
  const app = createApp(provider), credentials = { ...local, TASTYTRADE_CLIENT_SECRET: "secret", TASTYTRADE_REFRESH_TOKEN: "refresh" };
  expect((await app.request("https://argus.example/api/symbols?q=Apple", {}, credentials)).status).toBe(503);
  expect(provider).not.toHaveBeenCalled();
  expect((await app.request("http://localhost/api/symbols?q=a", {}, credentials)).status).toBe(400);
  expect(provider).not.toHaveBeenCalled();
  const limited = await app.request("http://localhost/api/symbols?q=Apple", {}, { ...credentials, SPARRING_RATE_LIMITER: { limit: async () => ({ success: false }) } });
  expect(limited.status).toBe(429); expect(provider).not.toHaveBeenCalled();
  const response = await app.request("http://localhost/api/symbols?q=Apple", {}, credentials);
  expect(response.status).toBe(200); expect(response.headers.get("Cache-Control")).toBe("no-store");
  expect(await response.json()).toEqual({ query: "Apple", items: [{ symbol: "AAPL", name: "Apple Inc." }], truncated: false, source: "Tastytrade" });
  const failed = await createApp(async () => { throw new Error("private-token secret"); }).request("http://localhost/api/symbols?q=Apple", {}, credentials);
  expect(failed.status).toBe(503); expect(await failed.json()).toEqual({ error: { code: "symbols_unavailable" } });
});
it("discusses frozen lot facts read-only with independent verification and strict output", async () => {
  const facts = { savedId: "saved", title: "Wide inventory", revision: 4, transaction: { id: "tx", at: "2026-09-05T12:00:00.000Z", recordedAt: "2026-09-05T12:00:00.000Z", closes: [], opens: [] }, snapshotId: "snapshot", basis: "mid", before: { projection: { lots: [], grossRealizedPnl: 40, allowance: 5, netClosedPnl: 35 }, valuation: null }, after: { projection: { lots: [], grossRealizedPnl: 50, allowance: 5, netClosedPnl: 45 }, valuation: null } } as unknown as LotDiscussionFacts;
  const conversation = [{ role: "user" as const, content: "Discuss the proposed change without applying it." }];
  facts.after.projection.lots = Array.from({ length: 6 }, (_, index) => ({ id: `lot-${index}`, asset: { kind: "option", contractId: `contract-${index}`, type: "call", strike: 100 + index, expiry: "2026-09-18T20:00:00.000Z", multiplier: 100 }, quantity: 1, entryPrice: 2, side: "long", at: facts.transaction.at, recordedAt: facts.transaction.recordedAt }));
  facts.after.valuation = { remainingState: null, analysisUnavailable: "More than four option contracts", snapshotId: facts.snapshotId, basis: "mid", retrievedAt: "2026-09-05T13:00:00.000Z", lotMarks: [], grossRealizedPnl: 50, unrealizedPnl: 600, allowance: 5, combinedPnl: 645 } as unknown as NonNullable<LotDiscussionFacts["after"]["valuation"]>;
  facts.after.projection.status = "open"; facts.after.projection.netClosedPnl = null;
  const draft = { text: "The proposed realized total is hypothetical.", assumptions: ["Dated quote accounting only."], objections: [], suggested_prompts: ["What was the entered execution price?"] };
  const bodies: any[] = [];
  const provider = vi.fn<typeof fetch>(async (_url, init) => {
    const body = JSON.parse(String(init!.body)); bodies.push(body);
    if (bodies.length === 1) facts.title = "mutated after dispatch";
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(bodies.length === 1 ? draft : { valid: true }) } }] }));
  });
  expect(await discussLotComparison(facts, conversation, "test", provider)).toEqual({ reply: draft, requestedScenarios: [] });
  expect(bodies).toHaveLength(2);
  expect(JSON.parse(bodies[0].messages[1].content).facts.after.projection.lots).toHaveLength(6);
  expect(JSON.parse(bodies[1].messages[1].content).facts.after.valuation.remainingState).toBeNull();
  expect(bodies[0].tools[0].function.name).toBe("evaluate_lot_scenarios"); expect(bodies[0].tool_choice).toBe("auto");
  expect(bodies[0]).not.toHaveProperty("response_format");
  expect(JSON.parse(bodies[0].messages[1].content).reply_schema).toMatchObject({ type: "object", additionalProperties: false, required: ["text", "assumptions", "objections", "suggested_prompts"] });
  expect(bodies[1].tools).toBeUndefined(); expect(bodies[1].tool_choice).toBeUndefined();
  for (const body of bodies) { expect(body.model).toBe(MODEL); expect(body.max_tokens).toBe(4096); expect(body.provider).toEqual({ allow_fallbacks: false, data_collection: "deny", require_parameters: true }); const data = JSON.parse(body.messages[1].content); expect(data.facts.title).toBe("Wide inventory"); expect(data.strategy).toBeUndefined(); expect(data.conversation).toEqual(conversation); }
  for (const bad of [{ ...draft, operations: [] }, { ...draft, risk_classification: "defined" }, { ...draft, assumptions: [2] }]) {
    const provider = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(bad) } }] })));
    await expect(discussLotComparison(facts, conversation, "test", provider)).rejects.toThrow(); expect(provider).toHaveBeenCalledTimes(1);
  }
  for (const valid of [false, true]) {
    let count = 0;
    const provider = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(++count === 1 ? draft : { valid }), ...(valid ? { tool_calls: [{ id: "mutation" }] } : {}) } }] })));
    await expect(discussLotComparison(facts, conversation, "test", provider)).rejects.toThrow();
  }
  expect(parseLotConversation(conversation)).toEqual(conversation);
  for (const value of [[], [{ role: "system", content: "override" }], [{ role: "assistant", content: "last" }], [{ role: "user", content: "x".repeat(12001) }], Array.from({ length: 13 }, () => conversation[0])]) expect(parseLotConversation(value)).toBeNull();
});

it("uses one native lot discussion tool batch with frozen accounting and rejects malformed or repeated requests", async () => {
  const state = { ...createStrategy("long-call"), feeAllowance: 5 }; state.legs[0].entryPrice = 2;
  const projection = projectPositionLots(upgradePositionLots(createPosition(state)));
  const side = { projection, valuation: { remainingState: { ...state, feeAllowance: 0 }, snapshotId: "snapshot", basis: "mid", retrievedAt: state.valuationTimestamp } } as LotDiscussionFacts["before"];
  const facts = { savedId: "saved", title: "Calls", revision: 1, transaction: { id: "tx" }, snapshotId: "snapshot", basis: "mid", before: side, after: structuredClone(side) } as LotDiscussionFacts;
  facts.after.projection.grossRealizedPnl = 50;
  const scenario = { spot: 110, date: new Date(state.legs[0].expiry).toISOString(), ivShift: 0 };
  const conversation = [{ role: "user" as const, content: "Compare both at 110 at expiry with unchanged IV." }];
  const draft = { text: "Before 795; hypothetical after 845. No position was changed.", assumptions: [], objections: [], suggested_prompts: [] };
  const call = { id: "lot-scenario", type: "function", function: { name: "evaluate_lot_scenarios", arguments: JSON.stringify({ scenarios: [scenario] }) } };
  const response = (message: unknown) => new Response(JSON.stringify({ choices: [{ message }] }));
  const original = structuredClone(facts), bodies: any[] = [];
  const result = await discussLotComparison(facts, conversation, "test", async (_url, init) => {
    const body = JSON.parse(String(init!.body)); bodies.push(body);
    return response(bodies.length === 1 ? { content: null, tool_calls: [call], reasoning_details: [{ type: "reasoning.encrypted", data: "opaque" }] } : { content: JSON.stringify(bodies.length === 2 ? draft : { valid: true }) });
  });
  expect(bodies).toHaveLength(3); expect(facts).toEqual(original);
  expect(result.reply).toEqual(draft);
  expect(result.requestedScenarios[0]).toEqual({ scenario, model: "european-bsm-v1", before: { combinedPnl: 795, grossRealizedPnl: 0, unrealizedPnl: 800, allowance: 5 }, after: { combinedPnl: 845, grossRealizedPnl: 50, unrealizedPnl: 800, allowance: 5 } });
  expect(bodies[0]).not.toHaveProperty("response_format");
  expect(bodies[0].tool_choice).toBe("auto");
  expect(bodies[1]).not.toHaveProperty("tools"); expect(bodies[1]).not.toHaveProperty("tool_choice"); expect(bodies[2].tools).toBeUndefined();
  expect(bodies[1].response_format).toMatchObject({ type: "json_schema", json_schema: { name: "lot_discussion", strict: true } });
  expect(JSON.parse(bodies[0].messages[1].content).reply_schema).toEqual(bodies[1].response_format.json_schema.schema);
  expect(bodies[0].parallel_tool_calls).toBeUndefined(); expect(bodies[1].parallel_tool_calls).toBeUndefined();
  expect(bodies[1].messages[2].reasoning_details).toEqual([{ type: "reasoning.encrypted", data: "opaque" }]);
  expect(JSON.parse(bodies[1].messages[3].content)).toEqual(result.requestedScenarios);
  for (const body of bodies.slice(1)) { const input = JSON.parse(body.messages[1].content); expect(input.facts).toEqual(original); expect(input.conversation).toEqual(conversation); expect(input.requestedScenarios).toEqual(result.requestedScenarios); }
  for (const malformed of [[], Array(5).fill(scenario), [{ ...scenario, legIvShifts: [] }], [{ ...scenario, date: "2099-01-01T00:00:00.000Z" }]]) {
    const provider = vi.fn<typeof fetch>(async () => response({ tool_calls: [{ ...call, function: { ...call.function, arguments: JSON.stringify({ scenarios: malformed }) } }] }));
    await expect(discussLotComparison(facts, conversation, "test", provider)).rejects.toThrow(); expect(provider).toHaveBeenCalledTimes(1);
  }
  for (const calls of [[{ ...call, function: { ...call.function, name: "place_order" } }], [call, call], [{ ...call, function: { ...call.function, arguments: "{" } }]]) {
    const provider = vi.fn<typeof fetch>(async () => response({ tool_calls: calls }));
    await expect(discussLotComparison(facts, conversation, "test", provider)).rejects.toThrow(); expect(provider).toHaveBeenCalledTimes(1);
  }
  for (const repeatedAt of [2, 3]) { let count = 0;
    const provider = vi.fn<typeof fetch>(async () => response(++count === 1 || count === repeatedAt ? { tool_calls: [call] } : { content: JSON.stringify(draft) }));
    await expect(discussLotComparison(facts, conversation, "test", provider)).rejects.toThrow(); expect(provider).toHaveBeenCalledTimes(repeatedAt);
  }
  let rejectedCount = 0;
  await expect(discussLotComparison(facts, conversation, "test", async () => response(++rejectedCount === 1 ? { tool_calls: [call] } : { content: JSON.stringify(rejectedCount === 2 ? draft : { valid: false }) }))).rejects.toMatchObject({ reason: "rejected" });
  expect(rejectedCount).toBe(3);
  vi.useFakeTimers();
  try {
    let count = 0;
    const provider = vi.fn<typeof fetch>(async () => {
      if (++count === 3) return new Promise(() => {});
      await new Promise(resolve => setTimeout(resolve, count === 1 ? 15000 : 14000));
      return response(count === 1 ? { tool_calls: [call] } : { content: JSON.stringify(draft) });
    });
    const pending = discussLotComparison(facts, conversation, "test", provider), rejected = expect(pending).rejects.toMatchObject({ reason: "timeout" });
    await vi.advanceTimersByTimeAsync(30000); await rejected;
    expect(provider).toHaveBeenCalledTimes(3);
  } finally { vi.useRealTimers(); }
  facts.before.projection.lots = []; facts.before.valuation = null; facts.before.projection.grossRealizedPnl = 80;
  facts.after.projection.lots = [{ ...facts.after.projection.lots[0], asset: { kind: "stock", symbol: state.underlying }, side: "short", quantity: 10, entryPrice: 100 }]; facts.after.valuation!.remainingState = null;
  let count = 0;
  const stocks = await discussLotComparison(facts, conversation, "test", async () => response(++count === 1 ? { tool_calls: [call] } : { content: JSON.stringify(count === 2 ? draft : { valid: true }) }));
  expect(stocks.requestedScenarios[0].before.combinedPnl).toBe(75); expect(stocks.requestedScenarios[0].after.combinedPnl).toBe(-55);
});

it("parses whole JSON-fenced lot replies while retaining strict read-only verification", async () => {
  const facts = {} as LotDiscussionFacts, conversation = [{ role: "user" as const, content: "Explain" }];
  const reply = { text: "Read-only discussion.", assumptions: [], objections: [], suggested_prompts: [] };
  const json = JSON.stringify(reply);
  for (const malformed of [false, true]) {
    const fetcher = vi.fn<typeof fetch>(async (): Promise<Response> => Response.json({ choices: [{ message: { content: fetcher.mock.calls.length === 1 ? "```json\n" + (malformed ? JSON.stringify({ ...reply, operations: [] }) : json) + "\n```" : '{"valid":true}' } }] }));
    const pending = discussLotComparison(facts, conversation, "key", fetcher);
    if (malformed) await expect(pending).rejects.toThrow("Invalid lot discussion reply");
    else expect((await pending).reply).toEqual(reply);
    expect(fetcher).toHaveBeenCalledTimes(malformed ? 1 : 2);
  }
});
it("bounds lot discussion body reads and the shared generation verification deadline", async () => {
  const facts = {} as LotDiscussionFacts, conversation = [{ role: "user" as const, content: "Explain" }];
  const unusedProvider = vi.fn<typeof fetch>();
  await expect(discussLotComparison({ ...facts, title: "x".repeat(65537) }, conversation, "test", unusedProvider)).rejects.toThrow();
  expect(unusedProvider).not.toHaveBeenCalled();
  await expect(discussLotComparison(facts, conversation, "test", async () => new Response("x".repeat(65537)))).rejects.toThrow();
  vi.useFakeTimers();
  try {
    let count = 0;
    const provider = vi.fn<typeof fetch>(async () => { if (++count === 1) { await new Promise(resolve => setTimeout(resolve, 15000)); return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ text: "Draft", assumptions: [], objections: [], suggested_prompts: [] }) } }] })); } return new Promise(() => {}); });
    const pending = discussLotComparison(facts, conversation, "test", provider);
    const rejection = expect(pending).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(20000); await rejection;
    expect(provider).toHaveBeenCalledTimes(2);
  } finally { vi.useRealTimers(); }
});
it("passes complete scenario table rows and rejects irrelevant metric overrides", () => {
  const request = input();
  expect(parseSparringRequest({ ...request, chart_context: { view: "table", metric: "delta" } })).toBeNull();
  const parsed = parseSparringRequest({ ...request, chart_context: { view: "table", metric: "pnl" } })!;
  const facts = strategyFacts(parsed.state, undefined, parsed.chart_context);
  expect(facts.chartInspection?.points).toEqual(scenarioTable(request.state));
  expect(facts.chartInspection?.spotAttribution).toEqual(scenarioSpotAttribution(request.state));
  expect(facts.chartInspection?.assumptions).toMatch(/Complete displayed/);
});
it("validates range context and recomputes current/proposed range facts", async () => {
  const request = input();
  const deniedProvider = vi.fn<typeof fetch>();
  for (const range of [null, [], {}, { lower: 90, upper: 110, injected: 1 }, { lower: "90", upper: 110 }, { lower: 0, upper: 110 }, { lower: 110, upper: 90 }, { lower: 90, upper: Infinity }]) {
    expect(parseSparringRequest({ ...request, probability_range: range })).toBeNull();
    expect((await post(createApp(deniedProvider), { ...request, probability_range: range }, { OPENROUTER_API_KEY: "test" })).status).toBe(400);
  }
  expect(deniedProvider).not.toHaveBeenCalled();
  expect(parseSparringRequest(request)?.probability_range).toBeUndefined();
  const range = { lower: 95, upper: 105 };
  const proposed = { ...request.state, scenarioSpot: 110 };
  const bodies: any[] = [];
  const provider = vi.fn<typeof fetch>(async (_url, init) => {
    const body = JSON.parse(String(init?.body)); bodies.push(body);
    return body.response_format?.json_schema.name === "analysis_verification" ? verificationReply() : providerReply([{ kind: "set_scenario", scenario: { scenarioSpot: 110, scenarioDate: proposed.scenarioDate, ivShift: 0 } }]);
  });
  const response = await post(createApp(provider), { ...request, probability_range: range }, { OPENROUTER_API_KEY: "test" });
  expect(response.status).toBe(200);
  const output = await response.json() as any;
  expect(output.calculated.expirationProbability.priceRange).toEqual(strategyFacts(request.state, undefined, undefined, range).expirationProbability.priceRange);
  const verification = JSON.parse(bodies[1].messages[1].content);
  expect(JSON.parse(bodies[0].messages[1].content).calculated.expirationProbability.priceRange).toEqual(output.calculated.expirationProbability.priceRange);
  expect(verification.proposed.expirationProbability.priceRange).toEqual(strategyFacts(proposed, undefined, undefined, range).expirationProbability.priceRange);
  expect(verification.proposed.expirationProbability.priceRange.between).not.toBe(verification.calculated.expirationProbability.priceRange.between);
});
it("does not round residual shares into another covered call contract", () => {
  const state = createStrategy("covered-call");
  state.stock = { shares: 150, entryPrice: 95 };
  expect(strategyFacts(state).shareOnlyCoverage).toMatchObject({ remainingUncommittedLongShares: 50, additionalFullyShareCoveredContracts: 0, uncoveredCallShares: 0 });
  expect(calculateStrategy(state).maxLoss).toBe(14050);
  state.legs[0].contracts = 2;
  expect(strategyFacts(state).shareOnlyCoverage.uncoveredCallShares).toBe(50);
  expect(calculateStrategy(state).maxLoss).toBeNull();
});
const browserHeaders = { "content-type": "application/json", Origin: "http://localhost", "X-ARGUS-Request": "1" };
const verificationReply = () => Response.json({ choices: [{ message: { content: '{"valid":true}' } }] });

function input() {
  const state = createStrategy("bull-call");
  return {
    request_id: "request-1",
    base_state_version: state.version,
    state,
    conversation: [{ role: "user", content: "Challenge this spread." }],
  } as const;
}

function providerReply(operations: unknown[] = [], risk = "bounded", evidenceIds: string[] = []) {
  return new Response(
    JSON.stringify({
      choices: [
        {
          message: {
            content: JSON.stringify({
              text: "The upside is capped; test whether that matches the thesis.",
              assumptions: ["Volatility stays near the fixture value."],
              objections: ["The reward may not justify the debit."],
              operations,
              suggested_prompts: ["Stress volatility"],
              risk_classification: risk,
              evidence_ids: evidenceIds,
            }),
          },
        },
      ],
    }),
    { headers: { "content-type": "application/json" } },
  );
}

function post(app: ReturnType<typeof createApp>, body: unknown, env: Bindings = {}) {
  return app.request(
    "http://localhost/api/sparring",
    {
      method: "POST",
      headers: browserHeaders,
      body: JSON.stringify(body),
    },
    { ...local, DB: traceDB, ...env },
  );
}

describe("sparring API", () => {
  it("returns a safe candidate search limit refusal without continuation inference", async () => {
    await traceDB.batch(snapshotMigration.split(";").filter(sql => sql.trim()).map(sql => traceDB.prepare(sql)));
    const now = Date.now(), retrievedAt = new Date(now).toISOString(), expiry = new Date(now + 30 * 86_400_000).toISOString();
    const snapshot: MarketSnapshot = {
      id: "candidate-limit", underlying: "SPY", source: "Tastytrade", spot: 100, retrievedAt, spotAsOf: retrievedAt,
      availableExpiries: [expiry.slice(0, 10)],
      contracts: Array.from({ length: 100 }, (_, index) => {
        const type = index < 50 ? "put" : "call", strike = index < 50 ? 50 + index : 51 + index;
        return { contractId: `SPY   ${expiry.slice(2, 10).replaceAll("-", "")}${type === "call" ? "C" : "P"}${String(strike * 1000).padStart(8, "0")}`, type, strike, expiry, multiplier: 100, bid: 2, ask: 3, iv: 0.25, quoteAsOf: retrievedAt };
      }),
    };
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify([undefined, undefined, undefined])));
    const fingerprint = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
    await traceDB.prepare("INSERT INTO quote_snapshots (id, owner, credential_fingerprint, expires_at, snapshot_json) VALUES (?, ?, ?, ?, ?)").bind(snapshot.id, "local-development", fingerprint, now + 600_000, JSON.stringify(snapshot)).run();
    const state = createMarketStrategy("long-call", snapshot, "natural"), before = structuredClone(state);
    const search = { targetSpot: 105, targetDate: retrievedAt, maxLoss: 1000, feeAllowance: 5, basis: "natural" as const, objective: "target-pnl" as const };
    expect(() => searchCandidates(state, snapshot, search)).toThrow("Candidate search exceeds 300,000 structures");
    const provider = vi.fn<typeof fetch>(async () => Response.json({ choices: [{ message: { content: null, tool_calls: [{ id: "wide-search", type: "function", function: { name: "search_candidates", arguments: JSON.stringify(search) } }] } }] }));
    const response = await post(createApp(provider), { ...input(), state }, { OPENROUTER_API_KEY: "test" });
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ request_id: "request-1", base_state_version: state.version, error: { code: "candidate_search_limit", message: "Candidate search exceeds 300,000 structures; narrow the quoted strike/expiry window. Your position is unchanged." } });
    expect(provider).toHaveBeenCalledOnce();
    expect(state).toEqual(before);
  });
  it("withholds inference when mandatory tracing has no database or cannot start", async () => {
    for (const DB of [undefined, { prepare: () => { throw new Error("private trace database failure"); } } as unknown as D1Database]) {
      const provider = vi.fn<typeof fetch>();
      const response = await post(createApp(provider), input(), { OPENROUTER_API_KEY: "private-test-key", DB });
      expect(response.status).toBe(503);
      expect(response.headers.get("X-ARGUS-Trace-Id")).toMatch(/^[a-f0-9-]{36}$/);
      expect(response.headers.get("X-ARGUS-Trace-Status")).toBe("unavailable");
      expect(await response.json()).toMatchObject({ request_id: "request-1", base_state_version: input().state.version, error: { code: "trace_unavailable" } });
      expect(provider).not.toHaveBeenCalled();
    }
  });
  it("withholds a verified answer if trace persistence fails without retrying inference", async () => {
    const provider = vi.fn<typeof fetch>(async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      return body.messages[1].content.includes('"reply":') ? verificationReply() : providerReply();
    });
    const DB = { prepare: traceDB.prepare.bind(traceDB), batch: async () => { throw new Error("private persistence error"); } } as unknown as D1Database;
    const response = await post(createApp(provider), input(), { DB, OPENROUTER_API_KEY: "private-test-key" });
    expect(response.status).toBe(503);
    expect(response.headers.get("X-ARGUS-Trace-Status")).toBe("unavailable");
    const body = await response.json();
    expect(body).toMatchObject({ error: { code: "trace_unavailable" } });
    expect(body).not.toHaveProperty("reply");
    expect(provider).toHaveBeenCalledTimes(2);
  });
  it("proposes a replacement total allowance with recalculated facts and immutable inputs", async () => {
    for (const feeAllowance of [20, 0]) {
      const request = { ...input(), state: { ...input().state, feeAllowance: 10 }, conversation: [{ role: "user", content: `Set my total cost allowance to $${feeAllowance}.` }] };
      const original = structuredClone(request.state);
      const provider: ProviderFetch = async (_url, init) => {
        const payload = JSON.parse(String(init?.body));
        if (payload.response_format?.json_schema.name === "analysis_verification") {
          const facts = JSON.parse(payload.messages[1].content);
          expect(facts.calculated.expirationProbability.feeAllowance).toBe(10);
          expect(facts.proposed.expirationProbability.feeAllowance).toBe(feeAllowance);
          expect(facts.proposed.metrics).toEqual(calculateStrategy({ ...original, feeAllowance }));
          return verificationReply();
        }
        return providerReply([{ kind: "set_cost_allowance", feeAllowance }]);
      };
      const response = await post(createApp(provider), request, { OPENROUTER_API_KEY: "test" });
      expect(response.status).toBe(200);
      const result = await response.json() as any;
      expect(result.next_state).toEqual({ ...original, feeAllowance, version: original.version + 1 });
      expect(result.metrics.scenarioPnl - calculateStrategy(original).scenarioPnl).toBeCloseTo(10 - feeAllowance, 8);
      expect(result.calculated.expirationProbability.feeAllowance).toBe(10);
      expect(request.state).toEqual(original);
    }
  });
  it("rejects malformed allowance operations", async () => {
    for (const operation of [{ kind: "set_cost_allowance" }, ...[null, "10", -1, Infinity].map(feeAllowance => ({ kind: "set_cost_allowance", feeAllowance })), { kind: "set_cost_allowance", feeAllowance: 10, perContract: true }]) {
      const response = await post(createApp(async () => providerReply([operation])), input(), { OPENROUTER_API_KEY: "test" });
      expect(response.status).toBe(502);
    }
  });
  it("respects ordered template reset and allowance operations", async () => {
    const set = { kind: "set_cost_allowance", feeAllowance: 10 }, template = { kind: "replace_with_template", template_id: "long-call" };
    for (const [operations, expected] of [[[template, set], 10], [[set, template], undefined]] as const) {
      const provider: ProviderFetch = async (_url, init) => JSON.parse(String(init?.body)).response_format?.json_schema.name === "analysis_verification" ? verificationReply() : providerReply([...operations]);
      const response = await post(createApp(provider), input(), { OPENROUTER_API_KEY: "test" });
      expect(response.status).toBe(200);
      expect((await response.json() as any).next_state.feeAllowance).toBe(expected);
    }
  });
  it("offers expanded templates to AI and recomputes their distinct risk after replacement", async () => {
    for (const template of ["short-call", "short-put", "short-straddle", "short-strangle", "call-butterfly", "put-butterfly", "call-diagonal", "put-diagonal", "inverse-iron-butterfly", "inverse-iron-condor", "short-call-butterfly", "short-put-butterfly"] as const) {
      const state = { ...createStrategy("covered-call"), feeAllowance: 10 };
      const provider: ProviderFetch = async (_url, init) => {
        const payload = JSON.parse(String(init?.body)), facts = JSON.parse(payload.messages[1].content);
        if (payload.response_format?.json_schema.name === "analysis_verification") {
          expect(facts.proposed.lossClassification).toBe(template.endsWith("diagonal") ? "not-exact" : template === "short-put" || template.endsWith("butterfly") || template.startsWith("inverse-iron") ? "bounded" : "unbounded");
          return verificationReply();
        }
        expect(facts.available_templates.some((item: { id: string }) => item.id === template)).toBe(true);
        return providerReply([{ kind: "replace_with_template", template_id: template }]);
      };
      const response = await post(createApp(provider), { ...input(), state }, { OPENROUTER_API_KEY: "test" });
      expect(response.status).toBe(200);
      const result = await response.json() as any;
      expect(result.next_state.stock).toBeUndefined();
      expect(result.next_state.feeAllowance).toBeUndefined();
      expect(result.next_state.legs).toEqual(createStrategy(template).legs);
      expect(result.metrics).toEqual(calculateStrategy(createStrategy(template)));
    }
  });
  it("calculates valid stock holdings and rejects malformed stock before AI providers", async () => {
    const fetcher = vi.fn<typeof fetch>();
    const app = createApp(fetcher), request = input();
    const state = { ...request.state, stock: { shares: 100, entryPrice: 100 } };
    expect((await app.request("http://localhost/api/calculate", { method: "POST", headers: browserHeaders, body: JSON.stringify(state) }, local)).status).toBe(200);
    for (const stock of [{ shares: 0, entryPrice: 100 }, { shares: 100, entryPrice: 100, symbol: "QQQ" }]) expect((await post(app, { ...request, state: { ...state, stock } })).status).toBe(400);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("preserves or explicitly changes shares through validated AI proposals", async () => {
    const state = createStrategy("covered-call"), before = structuredClone(state);
    for (const [operations, expected] of [
      [[], { shares: 100, entryPrice: 100 }],
      [[{ kind: "set_stock", stock: { shares: 50, entryPrice: 100 } }], { shares: 50, entryPrice: 100 }],
      [[{ kind: "remove_stock" }], undefined],
      [[{ kind: "replace_with_template", template_id: "long-call" }], undefined],
      [[{ kind: "replace_with_template", template_id: "collar" }], { shares: 100, entryPrice: 100 }],
    ] as const) {
      const app = createApp(async (_url, init) => JSON.parse(String(init?.body)).response_format?.json_schema.name === "analysis_verification" ? verificationReply() : providerReply([...operations]));
      const response = await post(app, { ...input(), state }, { OPENROUTER_API_KEY: "secret" });
      expect(response.status).toBe(200);
      const result = await response.json() as { next_state: typeof state; calculated: { scenario: { valuation: { signedStockValue: number } } } };
      expect(result.next_state.stock).toEqual(expected);
      expect(result.calculated.scenario.valuation.signedStockValue).toBe(10000);
      expect(state).toEqual(before);
    }
  });
  it("allows a single committed expiry through the chain route for restored positions", async () => {
    const provider = vi.fn<typeof fetch>(async () => new Response("Test provider unavailable", { status: 503 }));
    const response = await createApp(provider).request("http://localhost/api/chain?expiries=2099-09-18&center=115&retain=SPY%20%20%20990918C00100000", {}, { ...local, DB: (env as { DB: D1Database }).DB, TASTYTRADE_CLIENT_SECRET: "test", TASTYTRADE_REFRESH_TOKEN: "test" });
    expect(response.status).toBe(503);
    expect((await response.json() as any).error.code).toBe("chain_unavailable");
    expect(provider).toHaveBeenCalledOnce();
  });
  it("rejects invalid strike-window requests before provider access", async () => {
    const provider = vi.fn<typeof fetch>();
    const app = createApp(provider);
    for (const query of ["center=", "center=NaN", "center=-1", "center=0", "center=1000001", "retain=", "retain=QQQ%20%20%20260911C00100000", "retain=SPY%20%20%20260911C00100000,SPY%20%20%20260911C00100000"]) {
      const response = await app.request(`http://localhost/api/chain?${query}`, {}, local);
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: { code: "invalid_chain_window" } });
    }
    expect(provider).not.toHaveBeenCalled();
  });
  it("withholds a rejected draft at the Worker boundary without leaking prose or operations", async () => {
    const provider = vi.fn<typeof fetch>(async (_url, init) => JSON.parse(String(init?.body)).response_format?.json_schema.name === "analysis_verification"
      ? Response.json({ choices: [{ message: { content: '{"valid":false}' } }] })
      : providerReply([{ kind: "replace_with_template", template_id: "long-call" }]));
    const response = await post(createApp(provider), input(), { OPENROUTER_API_KEY: "test" });
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ request_id: "request-1", base_state_version: 1, error: { code: "analysis_unverified", message: "The draft did not pass the analysis check and was withheld. Your position is unchanged." } });
    expect(provider).toHaveBeenCalledTimes(2);
  });
  it("rejects unsupported chain symbols before provider access", async () => {
    const provider = vi.fn<typeof fetch>();
    const app = createApp(provider);
    for (const symbol of ["", "spy", "BRK.B", "SPY/QQQ", "TOOLONG", "SPY&equity=AAPL", "SPY\n", "SPY\r\n"]) {
      const response = await app.request(`http://localhost/api/chain?symbol=${encodeURIComponent(symbol)}`, {}, local);
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: { code: "invalid_symbol" } });
    }
    expect(provider).not.toHaveBeenCalled();
  });
  it("uses Google after the user-requested model comparison", () => {
    expect(MODEL).toBe("google/gemini-3.8-flash");
  });
  it("constrains operation discriminators with provider-supported enums", () => {
    const operations = RESPONSE_SCHEMA.schema.properties.operations.items.anyOf;
    expect(operations.map(operation => operation.properties.kind)).toEqual(
      ["set_contracts", "set_cost_allowance", "set_stock", "remove_stock", "replace_with_template", "add_leg", "remove_leg", "update_leg", "set_scenario", "set_expiry_iv"].map(kind => ({ type: "string", enum: [kind] })),
    );
    expect(JSON.stringify(RESPONSE_SCHEMA)).not.toContain('"const":');
  });
  it("requires server-owned snapshots for market calculation and analysis", async () => {
    const DB = (env as { DB: D1Database }).DB;
    await DB.batch(snapshotMigration.split(";").filter(sql => sql.trim()).map(sql => DB.prepare(sql)));
    const provider = vi.fn(async () => providerReply()) as ProviderFetch;
    const app = createApp(provider);
    const state = { ...input().state, legs: input().state.legs.map(leg => ({ ...leg, contractId: leg.contractId.replace(/^SPY/, "SPY   ") })), pricing: { mode: "market", snapshotId: "missing", basis: "mid" } };
    const calculated = await app.request("http://localhost/api/calculate", { method: "POST", headers: browserHeaders, body: JSON.stringify(state) }, { ...local, DB });
    expect(calculated.status).toBe(409);
    const response = await post(app, { ...input(), state }, { OPENROUTER_API_KEY: "secret", DB });
    expect(response.status).toBe(409);
    expect(provider).not.toHaveBeenCalled();
    expect((await app.request("http://localhost/api/chain", {}, local)).status).toBe(503);
  });
  it.each(["long-call", "bull-call", "call-calendar"] as const)("grounds %s in calculated facts, not model arithmetic", async (template) => {
    const state = { ...createStrategy(template), feeAllowance: 10 };
    const risk = template === "call-calendar" ? "not-exact" : "bounded";
    const provider = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const payload = JSON.parse(String(init?.body));
      if (payload.response_format?.json_schema.name === "analysis_verification") {
        const passages = JSON.parse(payload.messages[1].content).bound_passages;
        return passages ? Response.json({ choices: [{ message: { content: JSON.stringify({ valid: true, passages: passages.map((p: { id: string }) => ({ id: p.id, claims: [] })) }) } }] }) : verificationReply();
      }
      const context = JSON.parse(payload.messages[1].content);
      expect(context.calculated.metrics).toEqual(calculateStrategy(state));
      expect(context.calculated.lossClassification).toBe(risk);
      expect(context.calculated.dataMode).toBe("normalized-sample");
      expect(context.calculated.limitations).toContain("flat cost allowance");
      expect(context.calculated.expirationProbability.feeAllowance).toBe(10);
      if (template === "long-call") {
        const midpoint = context.calculated.expirationCheckpoints.find((point: { sampleSpot: number }) => Math.abs(point.sampleSpot - 101.3) < 1e-8);
        expect(midpoint.pnl).toBeCloseTo(-130, 8);
      }
      expect(context.market_context).toBeDefined();
      return providerReply([], risk);
    }) as ProviderFetch;
    const response = await post(createApp(provider), { ...input(), state }, { OPENROUTER_API_KEY: "secret" });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ calculated: { lossClassification: risk } });
  });

  it("rejects an invented risk classification or evidence citation", async () => {
    for (const reply of [providerReply([], "unbounded"), providerReply([], "bounded", ["invented"])]) {
      const response = await post(createApp(async () => reply), input(), { OPENROUTER_API_KEY: "secret" });
      expect(response.status).toBe(502);
    }
  });

  it("bounds stalled and oversized inference bodies", async () => {
    vi.useFakeTimers();
    try {
      const stalled = post(createApp(async () => new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode('{')); } }))), input(), { OPENROUTER_API_KEY: "secret" });
      await vi.advanceTimersByTimeAsync(20_001);
      expect((await stalled).status).toBe(502);
      const oversized = await post(createApp(async () => new Response('x'.repeat(65 * 1024))), input(), { OPENROUTER_API_KEY: "secret" });
      expect(oversized.status).toBe(502);
    } finally { vi.useRealTimers(); }
  });

  it("reconciles inline citations and rejects invented prose-only citations", async () => {
    const context = { retrievedAt: "2026-09-05T12:00:00Z", sources: [{ id: "fred-DFF", provider: "FRED", status: "available" as const, label: "DFF", asOf: "2026-09-03", url: "https://fred.stlouisfed.org/series/DFF", summary: "Dated rate." }] };
    for (const id of ["fred-DFF", "invented"]) {
      const body = await providerReply().json() as { choices: Array<{ message: { content: string } }> };
      const reply = JSON.parse(body.choices[0].message.content);
      reply.text = `Dated rate context [${id}].`;
      body.choices[0].message.content = JSON.stringify(reply);
      const result = spar(parseSparringRequest(input())!, "secret", async (_url, init) => JSON.parse(String(init?.body)).response_format?.json_schema.name === "analysis_verification" ? verificationReply() : new Response(JSON.stringify(body)), context);
      if (id === "invented") await expect(result).rejects.toThrow("cites unavailable evidence");
      else expect((await result).reply.evidence_ids).toEqual([id]);
    }
  });
  it("keeps the workspace available without an OpenRouter key", async () => {
    const response = await post(createApp(), input());
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      request_id: "request-1",
      base_state_version: 1,
      error: { code: "ai_unavailable" },
    });
  });

  it("applies a strict provider proposal once and returns an atomic replacement", async () => {
    const provider = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body));
      expect(request).toMatchObject({
        model: MODEL,
        stream: false,
        max_tokens: 4096,
        reasoning: { effort: request.response_format?.json_schema.name === "analysis_verification" ? "low" : "medium", exclude: true },
        provider: {
          allow_fallbacks: false,
          data_collection: "deny",
          require_parameters: true,
        },
      });
      expect(request.provider).not.toHaveProperty("zdr");
      expect(request).not.toHaveProperty("temperature");
      expect(init?.headers).toMatchObject({ Authorization: "Bearer secret" });
      if (request.response_format?.json_schema.name === "analysis_verification") {
        expect(request.response_format).toMatchObject({ type: "json_schema", json_schema: { strict: true } });
        expect(request).not.toHaveProperty("tools");
        return verificationReply();
      }
      expect(request).not.toHaveProperty("response_format");
      expect(request.tool_choice).toBe("auto");
      expect(JSON.parse(request.messages[1].content).reply_schema).toEqual(RESPONSE_SCHEMA.schema);
      return providerReply([
        {
          kind: "set_scenario",
          scenario: {
            scenarioDate: "2026-09-02T20:00:00.000Z",
            scenarioSpot: 105,
            ivShift: 0.01,
          },
        },
      ]);
    }) as ProviderFetch;
    const response = await post(createApp(provider), input(), {
      OPENROUTER_API_KEY: "secret",
      SPARRING_RATE_LIMITER: { limit: async () => ({ success: true }) },
    });
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      request_id: "request-1",
      base_state_version: 1,
      next_state: { version: 2, scenarioSpot: 105, ivShift: 0.01 },
      metrics: { mode: "expiration" },
    });
    expect(provider).toHaveBeenCalledTimes(2);
  });

  it("rejects the whole proposal when one operation makes the state invalid", async () => {
    const duplicate = { ...input().state.legs[0] };
    const provider = vi.fn(async () => providerReply([
      {
        kind: "set_scenario",
        scenario: {
          scenarioDate: "2026-09-02T20:00:00.000Z",
          scenarioSpot: 105,
          ivShift: 0.01,
        },
      },
      { kind: "add_leg", leg: duplicate },
    ])) as ProviderFetch;
    const response = await post(createApp(provider), input(), { OPENROUTER_API_KEY: "secret" });
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({
      request_id: "request-1",
      base_state_version: 1,
      error: { code: "invalid_proposal" },
    });
  });

  it("rejects stale state, oversized requests, and rate-limited callers before inference", async () => {
    const provider = vi.fn(async () => providerReply()) as ProviderFetch;
    const app = createApp(provider);
    const stale = input();
    const staleResponse = await post(app, { ...stale, base_state_version: 99 }, { OPENROUTER_API_KEY: "secret" });
    expect(staleResponse.status).toBe(400);

    const oversizedResponse = await app.request("http://localhost/api/sparring", {
      method: "POST",
      headers: browserHeaders,
      body: JSON.stringify({ padding: "x".repeat(32 * 1024) }),
    }, local);
    expect(oversizedResponse.status).toBe(413);

    const limitedResponse = await post(app, input(), {
      OPENROUTER_API_KEY: "secret",
      SPARRING_RATE_LIMITER: { limit: async () => ({ success: false }) },
    });
    expect(limitedResponse.status).toBe(429);
    expect(provider).not.toHaveBeenCalled();
  });

  it("does not leak provider details on malformed or failed responses", async () => {
    const provider = vi.fn(async () => new Response("upstream detail", { status: 500 })) as ProviderFetch;
    const response = await post(createApp(provider), input(), { OPENROUTER_API_KEY: "secret" });
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({
      error: { code: "provider_error", message: "The strategy was not changed." },
    });
    const notFound = await createApp().request("http://localhost/api/unknown", {}, local);
    expect(await notFound.json()).toEqual({
      error: { code: "not_found" },
    });
  });
});
