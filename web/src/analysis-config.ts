import { defaultAnalysisPrompts, readAnalysisPrompts, type AnalysisPrompts } from "./analysis-prompts";

export const ANALYSIS_ENGINE_VERSION = "analysis-contract-v6";

export async function promptDigest(bundle: AnalysisPrompts): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(readAnalysisPrompts(bundle)));
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), byte => byte.toString(16).padStart(2, "0")).join("");
}

// An absent selection uses the shipped baseline; an invalid selected version never falls back.
export async function loadAnalysisPrompts(db?: D1Database): Promise<AnalysisPrompts> {
  if (!db) return defaultAnalysisPrompts;
  const row = await db.prepare("SELECT a.version AS selected_version, b.version, b.digest, b.engine_version, b.bundle_json, b.evaluated_at FROM analysis_prompt_active a LEFT JOIN analysis_prompt_bundles b ON b.version = a.version WHERE a.singleton = 1").first<{
    selected_version: string; version: string | null; digest: string; engine_version: string; bundle_json: string; evaluated_at: string;
  }>();
  if (!row) return defaultAnalysisPrompts;
  const bundle = readAnalysisPrompts(JSON.parse(row.bundle_json));
  if (row.version !== bundle.version || row.selected_version !== bundle.version || row.engine_version !== ANALYSIS_ENGINE_VERSION || !Number.isFinite(Date.parse(row.evaluated_at)) || row.digest !== await promptDigest(bundle)) throw new Error("Invalid active analysis prompt bundle");
  return bundle;
}
