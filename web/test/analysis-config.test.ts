import { beforeAll, expect, it, vi } from "vitest";
import { env } from "cloudflare:workers";
import migration from "../migrations/0004_analysis_prompts.sql?raw";
import traceMigration from "../migrations/0005_analysis_traces.sql?raw";
import { ANALYSIS_ENGINE_VERSION, loadAnalysisPrompts, promptDigest } from "../src/analysis-config";
import { defaultAnalysisPrompts, readAnalysisPrompts, type AnalysisPrompts } from "../src/analysis-prompts";
import { createApp } from "../src/worker";
import { createMarketStrategy, createStrategy, type MarketSnapshot } from "../src/options";
import { spar } from "../src/sparring";
import previous from "../prompts/analysis-v12.json";
import performanceBaseline from "../prompts/analysis-v13.json";
import namedFamilyCandidate from "../prompts/analysis-v17.json";
import discoveryCandidate from "../prompts/analysis-v18.json";

const db = (env as { DB: D1Database }).DB;
it('round-trips discovery intent under an isolated version without changing baseline capabilities', async () => {
  const bundle = readAnalysisPrompts({ ...discoveryCandidate, version: 'discovery-intent-storage-test' });
  await insert(bundle); await select(bundle.version);
  try {
    const captured = await loadAnalysisPrompts(db);
    expect(captured).toEqual(bundle);
    expect(captured.prompts).toEqual(discoveryCandidate.prompts);
    expect(captured.prompts.CANDIDATE_TOOL_DESCRIPTION).toBeUndefined();
    expect(Object.isFrozen(captured.prompts)).toBe(true);
    expect(defaultAnalysisPrompts.version).toBe('analysis-v16');
    expect(defaultAnalysisPrompts.prompts.DISCOVERY_INTENT_PROMPT).toBeUndefined();
  } finally { await db.prepare('DELETE FROM analysis_prompt_active WHERE singleton = 1').run(); }
});
it('round-trips named-family prompt strings under an isolated test version', async () => {
  expect(await promptDigest(readAnalysisPrompts(namedFamilyCandidate))).toBe('1614daf56155e9e12d4fc4d7fcece747bb6598748048db2bed00a6a9ee6b6053');
  const bundle = readAnalysisPrompts({ ...namedFamilyCandidate, version: 'named-family-storage-test' });
  expect(bundle.prompts).toEqual(namedFamilyCandidate.prompts);
  await insert(bundle); await select(bundle.version);
  try {
    const captured = await loadAnalysisPrompts(db);
    expect(captured).toEqual(bundle);
    expect(captured.prompts.CANDIDATE_TOOL_DESCRIPTION).toBeUndefined();
    expect(Object.isFrozen(captured.prompts)).toBe(true);
    expect(defaultAnalysisPrompts.version).toBe('analysis-v16');
    expect(defaultAnalysisPrompts.prompts.NAMED_CANDIDATE_TOOL_DESCRIPTION).toBeUndefined();
  } finally { await db.prepare('DELETE FROM analysis_prompt_active WHERE singleton = 1').run(); }
});
it("ships qualified comparison intent while preserving historical performance prompt ancestry", async () => {
  expect(defaultAnalysisPrompts.version).toBe("analysis-v16");
  expect(await promptDigest(defaultAnalysisPrompts)).toBe("89531521ca027b5cfa34d05f501fd2fec704b6f82f78811776ea2e4e7acad356");
  const historical = readAnalysisPrompts(performanceBaseline);
  expect(historical.version).toBe("analysis-v13");
  expect(ANALYSIS_ENGINE_VERSION).toBe("analysis-contract-v7");
  for (const [key, value] of Object.entries(previous.prompts)) {
    expect(historical.prompts[key as keyof typeof historical.prompts]).toBe(value);
  }
  for (const [key, value] of Object.entries(historical.prompts)) expect(defaultAnalysisPrompts.prompts[key as keyof typeof defaultAnalysisPrompts.prompts]).toBe(value);
});
it('requires paired optional performance prompts and admits older unrelated bundles', () => {
  expect(readAnalysisPrompts(previous).version).toBe('analysis-v12');
  for (const missing of ['PERFORMANCE_DISCUSSION_PROMPT', 'PERFORMANCE_VERIFICATION_PROMPT'] as const) {
    const prompts = { ...defaultAnalysisPrompts.prompts }; delete prompts[missing];
    expect(() => readAnalysisPrompts({ ...defaultAnalysisPrompts, prompts })).toThrow();
  }
  for (const key of ['PERFORMANCE_DISCUSSION_PROMPT', 'PERFORMANCE_VERIFICATION_PROMPT'] as const) for (const term of ['17:15 America/New_York', 'grossRealizedPnl', 'allowance once', 'adjacent complete calendar', 'zero', 'assignment', 'capital', 'selectedDate']) expect(defaultAnalysisPrompts.prompts[key]).toContain(term);
});
it("requires explicit discovery domains and keeps candidate risk horizons separate", () => {
  for (const key of ["SYSTEM_PROMPT", "VERIFICATION_PROMPT"] as const) {
    const prompt = defaultAnalysisPrompts.prompts[key];
    for (const term of ["domain.families", "maxEntryOutlay", "covered-call", "protective-put", "collar", "call-calendar", "put-calendar", "call-diagonal", "put-diagonal", "lossBound", "before first expiry", "100 shares", "Inspect candidate", "silently substitute"])
      expect(prompt, `${key} missing ${term}`).toContain(term);
  }
});
it("qualifies exact candidate bytes through storage and provider boundaries without replacing the baseline", async () => {
  const { ARGUS_PROMPT_EXPECTED_DIGEST: expected, ARGUS_PROMPT_CANDIDATE_JSON: json } = env as { ARGUS_PROMPT_EXPECTED_DIGEST?: string; ARGUS_PROMPT_CANDIDATE_JSON?: string };
  expect(Boolean(json)).toBe(Boolean(expected));
  if (!json) return;
  const bundle = readAnalysisPrompts(JSON.parse(json));
  expect(await promptDigest(bundle)).toBe(expected);
  await insert(bundle);
  await select(bundle.version);
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime("2026-09-08T12:00:00.000Z");
  try {
    const selected = await loadAnalysisPrompts(db), systems: string[] = [];
    expect(selected).toEqual(bundle);
    expect(await promptDigest(selected)).toBe(expected);
    const fetcher: typeof fetch = async (_url, init) => {
      const body = JSON.parse(String(init?.body)); systems.push(body.messages[0].content);
      if (systems.length === 1 && bundle.prompts.CANDIDATE_TOOL_DESCRIPTION) expect(body.tools.find((tool: { function: { name: string } }) => tool.function.name === "search_candidates").function.description).toBe(bundle.prompts.CANDIDATE_TOOL_DESCRIPTION);
      const draft = { text: "Synthetic reply.", assumptions: [], objections: [], suggested_prompts: [], operations: [], risk_classification: "bounded", evidence_ids: [] };
      return Response.json({ choices: [{ message: { content: JSON.stringify(systems.length === 1 ? draft : { valid: true }) } }] });
    };
    const snapshot: MarketSnapshot = { id: "candidate-qualification", source: "Tastytrade", underlying: "SPY", spot: 650, retrievedAt: new Date().toISOString(), spotAsOf: new Date().toISOString(), availableExpiries: ["2026-09-15"], contracts: [{ contractId: "SPY   260915C00650000", type: "call", strike: 650, expiry: "2026-09-15T20:15:00.000Z", multiplier: 100, bid: 2, ask: 3, iv: 0.25, quoteAsOf: new Date().toISOString() }] };
    await spar({ request_id: "candidate-qualification", base_state_version: 1, state: createMarketStrategy("long-call", snapshot), conversation: [{ role: "user", content: "Explain" }] }, "test", fetcher, undefined, snapshot, selected);
    expect(systems).toEqual([bundle.prompts.SYSTEM_PROMPT, bundle.prompts.VERIFICATION_PROMPT]);
    expect(defaultAnalysisPrompts.version).toBe("analysis-v16");
  } finally {
    vi.useRealTimers();
    await db.prepare("DELETE FROM analysis_prompt_active WHERE singleton = 1").run();
  }
});
beforeAll(async () => { await db.batch([...migration.split(/;\s*(?=CREATE|$)/), ...traceMigration.split(/;\s*(?=CREATE|$)/)].filter(sql => sql.trim()).map(sql => db.prepare(sql))); });
const candidate = (version: string) => readAnalysisPrompts({ ...defaultAnalysisPrompts, version });
async function insert(bundle: AnalysisPrompts, override: { digest?: string; engine?: string; json?: string; evaluated?: string } = {}) {
  await db.prepare("INSERT INTO analysis_prompt_bundles (version, digest, engine_version, bundle_json, evaluated_at) VALUES (?, ?, ?, ?, ?)")
    .bind(bundle.version, override.digest ?? await promptDigest(bundle), override.engine ?? ANALYSIS_ENGINE_VERSION, override.json ?? JSON.stringify(bundle), override.evaluated ?? "2026-09-07T12:00:00Z").run();
}
async function select(version: string) {
  await db.prepare("INSERT INTO analysis_prompt_active (singleton, version) VALUES (1, ?) ON CONFLICT(singleton) DO UPDATE SET version = excluded.version").bind(version).run();
}

it("uses the shipped baseline when storage or an active selection is absent", async () => {
  expect(await loadAnalysisPrompts()).toBe(defaultAnalysisPrompts);
  expect(await loadAnalysisPrompts(db)).toBe(defaultAnalysisPrompts);
});

it("loads a selected immutable version and retains the frozen captured bundle across activation", async () => {
  const first = candidate("first"), second = candidate("second");
  await insert(first);
  await insert(second);
  await select(first.version);
  const captured = await loadAnalysisPrompts(db);
  expect(captured).toEqual(first);
  expect(Object.isFrozen(captured)).toBe(true);
  expect(Object.isFrozen(captured.prompts)).toBe(true);
  await expect(db.prepare("UPDATE analysis_prompt_bundles SET bundle_json = ? WHERE version = ?").bind(JSON.stringify(second), first.version).run()).rejects.toThrow();
  await expect(insert(first)).rejects.toThrow();
  await select(second.version);
  await expect(db.prepare("DELETE FROM analysis_prompt_bundles WHERE version = ?").bind(first.version).run()).rejects.toThrow();
  expect(await loadAnalysisPrompts(db)).toEqual(second);
  expect(captured).toEqual(first);
});

it("canonicalizes prompt key ordering for hashing and loading", async () => {
  const bundle = candidate("canonical");
  const reordered = { prompts: Object.fromEntries(Object.entries(bundle.prompts).reverse()), version: bundle.version };
  expect(await promptDigest(reordered as AnalysisPrompts)).toBe(await promptDigest(bundle));
  await insert(bundle, { json: JSON.stringify(reordered) });
  await select(bundle.version);
  expect(await loadAnalysisPrompts(db)).toEqual(bundle);
});

it("rejects tampering, incompatible engines and invalid evaluation dates without baseline fallback", async () => {
  const cases = [
    { digest: "0".repeat(64) },
    { engine: "other-engine" },
    { engine: "analysis-contract-v1" },
    { engine: "analysis-contract-v2" },
    { engine: "analysis-contract-v3" },
    { engine: "analysis-contract-v4" },
    { engine: "analysis-contract-v6" },
    { evaluated: "not-a-date" },
    { json: JSON.stringify({ ...defaultAnalysisPrompts, version: "wrong-version" }) },
    { json: JSON.stringify({ ...defaultAnalysisPrompts, prompts: {} }) },
    { json: "not-json" },
  ];
  for (const [index, override] of cases.entries()) {
    const bundle = candidate(`invalid-${index}`);
    await insert(bundle, override);
    await select(bundle.version);
    await expect(loadAnalysisPrompts(db)).rejects.toThrow();
  }
});

it("withholds HTTP analysis before provider access when the active bundle is invalid", async () => {
  const bundle = candidate("invalid-http");
  await insert(bundle, { digest: "0".repeat(64) });
  await select(bundle.version);
  const provider = vi.fn<typeof fetch>();
  const state = createStrategy("long-call");
  const response = await createApp(provider).request("http://127.0.0.1:5173/api/sparring", {
    method: "POST", headers: { "Content-Type": "application/json", Origin: "http://127.0.0.1:5173", "X-ARGUS-Request": "1" },
    body: JSON.stringify({ request_id: "invalid-config-test", base_state_version: state.version, state, conversation: [{ role: "user", content: "Explain" }] }),
  }, { ARGUS_LOCAL_DEV: "true", DB: db, OPENROUTER_API_KEY: "synthetic-key" });
  expect(response.status).toBe(502);
  expect(provider).not.toHaveBeenCalled();
  expect(await response.text()).not.toContain("synthetic-key");
});
