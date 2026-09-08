import { beforeAll, expect, it, vi } from "vitest";
import { env } from "cloudflare:workers";
import migration from "../migrations/0004_analysis_prompts.sql?raw";
import traceMigration from "../migrations/0005_analysis_traces.sql?raw";
import { ANALYSIS_ENGINE_VERSION, loadAnalysisPrompts, promptDigest } from "../src/analysis-config";
import { defaultAnalysisPrompts, readAnalysisPrompts, type AnalysisPrompts } from "../src/analysis-prompts";
import { createApp } from "../src/worker";
import { createStrategy } from "../src/options";

const db = (env as { DB: D1Database }).DB;
it("binds candidate evaluation to the exact imported prompt bytes", async () => {
  const expected = (env as { ARGUS_PROMPT_EXPECTED_DIGEST?: string }).ARGUS_PROMPT_EXPECTED_DIGEST;
  if (expected) expect(await promptDigest(defaultAnalysisPrompts)).toBe(expected);
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
