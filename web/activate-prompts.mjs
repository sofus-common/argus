import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readAnalysisPrompts } from "./src/analysis-prompts.ts";

// Local-only administration: never accepts a remote flag or calls an inference provider.
const root = dirname(fileURLToPath(import.meta.url));
if (process.argv.length !== 3) throw new Error("Usage: node activate-prompts.mjs <candidate.json>");
const candidate = JSON.parse(readFileSync(resolve(process.argv[2]), "utf8"));
const bundle = readAnalysisPrompts(candidate);
const json = JSON.stringify(bundle);
const digest = createHash("sha256").update(json).digest("hex");
const engine = readFileSync(join(root, "src/analysis-config.ts"), "utf8").match(/export const ANALYSIS_ENGINE_VERSION = "([a-z0-9-]+)";/)?.[1];
if (!engine) throw new Error("Cannot determine analysis contract version");
const matches = row => row.version === bundle.version && row.digest === digest && row.engine_version === engine && row.bundle_json === json && Number.isFinite(Date.parse(row.evaluated_at));
const expected = { version: bundle.version, digest, engine_version: engine, bundle_json: json, evaluated_at: new Date().toISOString() };
assert(matches(expected));
for (const corruption of [{ bundle_json: "null" }, { evaluated_at: "invalid" }, { digest: "wrong" }, { version: "" }, { engine_version: "wrong" }]) assert(!matches({ ...expected, ...corruption }));
const directory = mkdtempSync(join(tmpdir(), "argus-prompt-eval-"));
const run = (file, args, env = process.env, capture = false) => execFileSync(process.execPath, [join(root, "node_modules", file), ...args], { cwd: root, env, ...(capture ? { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] } : { stdio: "inherit" }) });
try {
  // Freeze bytes before testing; the full suite checks baseline contracts and explicit candidate loading/transport.
  const frozen = join(directory, "candidate.json");
  writeFileSync(frozen, json);
  run("vitest/vitest.mjs", ["run", "--maxWorkers=1"], { ...process.env, ARGUS_PROMPT_CANDIDATE: frozen, ARGUS_PROMPT_EXPECTED_DIGEST: digest });
  const quote = value => `'${String(value).replaceAll("'", "''")}'`;
  const sql = join(directory, "activate.sql");
  writeFileSync(sql, `INSERT INTO analysis_prompt_bundles (version,digest,engine_version,bundle_json,evaluated_at) VALUES (${[bundle.version,digest,engine,json,new Date().toISOString()].map(quote).join(",")}) ON CONFLICT(version) DO NOTHING;\nINSERT INTO analysis_prompt_active (singleton,version) SELECT 1,version FROM analysis_prompt_bundles WHERE version=${quote(bundle.version)} AND digest=${quote(digest)} AND engine_version=${quote(engine)} AND bundle_json=${quote(json)} ON CONFLICT(singleton) DO UPDATE SET version=excluded.version;`);
  run("wrangler/bin/wrangler.js", ["d1", "execute", "DB", "--local", "--config", "wrangler.local.json", "--file", sql]);
  const selected = JSON.parse(run("wrangler/bin/wrangler.js", ["d1", "execute", "DB", "--local", "--config", "wrangler.local.json", "--json", "--command", "SELECT b.version,b.digest,b.engine_version,b.bundle_json,b.evaluated_at FROM analysis_prompt_active a JOIN analysis_prompt_bundles b ON a.version=b.version WHERE a.singleton=1"], process.env, true));
  if (!selected.some(result => result.success && result.results.some(matches))) throw new Error("Activation readback failed; use a new version for changed prompt bytes");
  console.log(`Activated local prompt ${bundle.version} (${digest}). Offline contract regressions passed; model-quality evaluation remains separate.`);
} finally {
  if (dirname(resolve(directory)) !== resolve(tmpdir())) throw new Error("Unexpected temporary directory scope");
  rmSync(directory, { recursive: true, force: true });
}
