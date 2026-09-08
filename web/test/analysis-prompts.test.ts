import { expect, it } from "vitest";
import { defaultAnalysisPrompts, readAnalysisPrompts } from "../src/analysis-prompts";
import { createStrategy } from "../src/options";
import { spar, discussLotComparison, discussPriceHistory, discussIntradayHistory } from "../src/sparring";
import { buildPriceHistory } from "../src/price-history";
import { buildIntradayHistory } from "../src/intraday-history";
import { promptDigest } from "../src/analysis-config";
import previousBundle from "../prompts/analysis-v2.json";
import ivCandidate from "../prompts/analysis-v3.json";
import conciseCandidate from "../prompts/analysis-v4.json";
import factualCandidate from "../prompts/analysis-v5.json";
import selectionCandidate from "../prompts/analysis-v9.json";
import transferCandidate from "../prompts/analysis-v10.json";
import europeanCandidate from "../prompts/analysis-v14.json";

it('versions European search without changing unrelated prompt strings or activating the candidate', () => {
  const candidate = readAnalysisPrompts(europeanCandidate);
  expect(candidate.version).toBe('analysis-v14');
  expect(candidate.prompts.CANDIDATE_TOOL_DESCRIPTION).toContain('European put calendars/diagonals');
  for (const key of Object.keys(defaultAnalysisPrompts.prompts) as Array<keyof typeof defaultAnalysisPrompts.prompts>) {
    if (key === 'SYSTEM_PROMPT' || key === 'VERIFICATION_PROMPT') {
      expect(candidate.prompts[key]).toContain('dividend yield at or below zero');
      expect(candidate.prompts[key]).not.toContain('selected American model');
    } else expect(candidate.prompts[key]).toBe(defaultAnalysisPrompts.prompts[key]);
  }
  expect(defaultAnalysisPrompts.version).toBe('analysis-v13');
});

it('preserves the active baseline digest and admits a bounded optional versioned search description', async () => {
  expect(defaultAnalysisPrompts.version).toBe('analysis-v13');
  expect(await promptDigest(defaultAnalysisPrompts)).toBe('c3eabc1493a100f4bd77c20b583e460a1b3161180fce6e97c737043c8499be89');
  const bundle = { ...defaultAnalysisPrompts, version: 'search-test', prompts: { ...defaultAnalysisPrompts.prompts, CANDIDATE_TOOL_DESCRIPTION: 'Synthetic description' } };
  expect(readAnalysisPrompts(bundle).prompts).toMatchObject({ CANDIDATE_TOOL_DESCRIPTION: 'Synthetic description' });
  for (const text of ['', ' ', 1, 'x'.repeat(65537)]) expect(() => readAnalysisPrompts({ ...bundle, prompts: { ...bundle.prompts, CANDIDATE_TOOL_DESCRIPTION: text } })).toThrow();
});

it('versions frozen quote-estimate provenance without changing unrelated prompts', () => {
  const candidate = readAnalysisPrompts(transferCandidate), previous = readAnalysisPrompts(selectionCandidate);
  for (const key of Object.keys(previous.prompts) as Array<keyof typeof previous.prompts>) {
    if (key === 'SYSTEM_PROMPT' || key === 'VERIFICATION_PROMPT') {
      expect(candidate.prompts[key]).toContain(previous.prompts[key]);
      expect(candidate.prompts[key]).toContain('broker-confirmed fills');
    } else expect(candidate.prompts[key]).toBe(previous.prompts[key]);
  }
});

it('versions selection scope without changing unrelated discussion prompts', () => {
  const candidate = readAnalysisPrompts(selectionCandidate), previous = readAnalysisPrompts(factualCandidate);
  expect(candidate.version).toBe('analysis-v9');
  for (const key of Object.keys(previous.prompts) as Array<keyof typeof previous.prompts>) {
    if (key === 'SYSTEM_PROMPT' || key === 'VERIFICATION_PROMPT') {
      expect(candidate.prompts[key]).toContain(previous.prompts[key]);
      expect(candidate.prompts[key]).toContain('analysis_scope');
    } else expect(candidate.prompts[key]).toBe(previous.prompts[key]);
  }
});

it('changes only factual verification while preserving the mixed-expiry projection contract', () => {
  const candidate = readAnalysisPrompts(factualCandidate), previous = readAnalysisPrompts(conciseCandidate);
  expect(candidate.version).toBe('analysis-v5');
  for (const key of Object.keys(previous.prompts) as Array<keyof typeof previous.prompts>) {
    if (key !== 'VERIFICATION_PROMPT') expect(candidate.prompts[key]).toBe(previous.prompts[key]);
  }
  expect(candidate.prompts.VERIFICATION_PROMPT).toContain('include the complete passage projection');
  expect(candidate.prompts.VERIFICATION_PROMPT).not.toContain('return exactly {"valid":false}');
});

it('changes only IV generation presentation in the concise candidate', () => {
  const concise = readAnalysisPrompts(conciseCandidate), previous = readAnalysisPrompts(ivCandidate);
  expect(concise.version).toBe('analysis-v4');
  for (const key of Object.keys(previous.prompts) as Array<keyof typeof previous.prompts>) {
    if (key === 'IV_DISCUSSION_PROMPT') expect(concise.prompts[key]).toContain(previous.prompts[key]);
    else expect(concise.prompts[key]).toBe(previous.prompts[key]);
  }
});

it("preserves old bundle digests and admits IV prompts only as a complete pair", async () => {
  expect(await promptDigest(readAnalysisPrompts(previousBundle))).toBe("4c0a44126518221fa780f42c330ce5718669aea321a0a4954cee716c224244e5");
  const candidate = readAnalysisPrompts(ivCandidate);
  expect(candidate.version).toBe('analysis-v3');
  expect(candidate.prompts).toMatchObject(previousBundle.prompts);
  expect(candidate.prompts.IV_DISCUSSION_PROMPT).toBeTruthy();
  expect(candidate.prompts.IV_VERIFICATION_PROMPT).toBeTruthy();
  const pair = { IV_DISCUSSION_PROMPT: "Explain supplied IV facts", IV_VERIFICATION_PROMPT: "Check supplied IV facts" };
  expect(readAnalysisPrompts({ ...previousBundle, prompts: { ...previousBundle.prompts, ...pair } }).prompts).toMatchObject(pair);
  for (const extra of [{ IV_DISCUSSION_PROMPT: pair.IV_DISCUSSION_PROMPT }, { IV_VERIFICATION_PROMPT: pair.IV_VERIFICATION_PROMPT }, { ...pair, IV_DISCUSSION_PROMPT: "" }, { ...pair, IV_VERIFICATION_PROMPT: 1 }]) {
    expect(() => readAnalysisPrompts({ ...previousBundle, prompts: { ...previousBundle.prompts, ...extra } })).toThrow();
  }
});

it("validates complete bounded prompt bundles in canonical immutable order", () => {
  const keys = ["SYSTEM_PROMPT", "VERIFICATION_PROMPT", "BOUND_VERIFICATION_PROMPT", "LOT_DISCUSSION_PROMPT", "LOT_VERIFICATION_PROMPT", "HISTORY_DISCUSSION_PROMPT", "HISTORY_VERIFICATION_PROMPT", "INTRADAY_DISCUSSION_PROMPT", "INTRADAY_VERIFICATION_PROMPT"];
  if (defaultAnalysisPrompts.prompts.IV_DISCUSSION_PROMPT !== undefined) keys.push('IV_DISCUSSION_PROMPT', 'IV_VERIFICATION_PROMPT');
  if (defaultAnalysisPrompts.prompts.PERFORMANCE_DISCUSSION_PROMPT !== undefined) keys.push('PERFORMANCE_DISCUSSION_PROMPT', 'PERFORMANCE_VERIFICATION_PROMPT');
  expect(Object.keys(defaultAnalysisPrompts.prompts)).toEqual(keys);
  const reversed = { prompts: Object.fromEntries(Object.entries(defaultAnalysisPrompts.prompts).reverse()), version: "test-bundle.2" };
  const parsed = readAnalysisPrompts(reversed);
  expect(Object.keys(parsed)).toEqual(["version", "prompts"]);
  expect(Object.keys(parsed.prompts)).toEqual(keys);
  expect(Object.isFrozen(parsed) && Object.isFrozen(parsed.prompts)).toBe(true);
  reversed.prompts.SYSTEM_PROMPT = "changed";
  expect(parsed.prompts.SYSTEM_PROMPT).toBe(defaultAnalysisPrompts.prompts.SYSTEM_PROMPT);
  for (const change of [
    (value: any) => { value.extra = true; },
    (value: any) => { value.version = "../bad"; },
    (value: any) => { value.version = "x".repeat(65); },
    (value: any) => { delete value.prompts.LOT_VERIFICATION_PROMPT; },
    (value: any) => { value.prompts.OTHER = "unexpected"; },
    (value: any) => { value.prompts.SYSTEM_PROMPT = "  "; },
    (value: any) => { value.prompts.SYSTEM_PROMPT = 2; },
    (value: any) => { value.prompts.SYSTEM_PROMPT = "x".repeat(65537); },
    (value: any) => { for (const key of keys) value.prompts[key] = "x".repeat(16000); },
  ]) { const value = structuredClone(defaultAnalysisPrompts); change(value); expect(() => readAnalysisPrompts(value)).toThrow("Invalid analysis prompt bundle"); }
});

it("pins runtime generation and verification prompts for sparring and all read-only discussion modes", async () => {
  const state = createStrategy("long-call");
  state.pricing = { mode: "market", snapshotId: "prompt-test", basis: "mid" };
  state.legs[0].strike = 770; state.legs[0].expiry = "2026-10-09T20:00:00.000Z"; state.legs[0].contractId = "SPY   261009C00770000";
  const dailyRange = { start: "2026-09-04", end: "2026-09-04" };
  const daily = { state, range: dailyRange, selectedDate: dailyRange.start, history: buildPriceHistory(state, [{ response: [] }], { response: [] }, dailyRange) };
  const range = { start: Date.parse("2026-09-04T00:00:00Z"), end: Date.parse("2026-09-04T00:05:00Z") };
  const intraday = { state, range, selectedTime: range.start, history: buildIntradayHistory(state, range) };
  for (const mode of ["spar", "lots", "history", "intraday"] as const) {
    const bundle = structuredClone(defaultAnalysisPrompts);
    const configured = { version: "test-runtime", prompts: { ...bundle.prompts } };
    for (const key of Object.keys(configured.prompts) as Array<keyof typeof configured.prompts>) configured.prompts[key] += `\nSynthetic override ${key}`;
    const captured = structuredClone(configured), systems: string[] = [];
    const fetcher: typeof fetch = async (_url, init) => {
      const body = JSON.parse(String(init?.body)); systems.push(body.messages[0].content);
      configured.prompts.VERIFICATION_PROMPT = "mutated after generation";
      configured.prompts.LOT_VERIFICATION_PROMPT = "mutated after generation";
      configured.prompts.HISTORY_VERIFICATION_PROMPT = "mutated after generation";
      configured.prompts.INTRADAY_VERIFICATION_PROMPT = "mutated after generation";
      const draft = { text: "Synthetic reply.", assumptions: [], objections: [], suggested_prompts: [], ...(mode === "spar" ? { operations: [], risk_classification: "bounded", evidence_ids: [] } : {}) };
      return Response.json({ choices: [{ message: { content: JSON.stringify(systems.length === 1 ? draft : { valid: true }) } }] });
    };
    if (mode === "spar") await spar({ request_id: "prompt-test", base_state_version: 1, state: createStrategy("long-call"), conversation: [{ role: "user", content: "Explain" }] }, "test", fetcher, undefined, undefined, configured);
    if (mode === "lots") await discussLotComparison({ title: "Synthetic prompt transport fixture" } as Parameters<typeof discussLotComparison>[0], [{ role: "user", content: "Explain" }], "test", fetcher, configured);
    if (mode === "history") await discussPriceHistory(daily, [{ role: "user", content: "Explain" }], "test", fetcher, configured);
    if (mode === "intraday") await discussIntradayHistory(intraday, [{ role: "user", content: "Explain" }], "test", fetcher, configured);
    const pair = mode === "spar" ? [captured.prompts.SYSTEM_PROMPT, captured.prompts.VERIFICATION_PROMPT] : mode === "lots" ? [captured.prompts.LOT_DISCUSSION_PROMPT, captured.prompts.LOT_VERIFICATION_PROMPT] : mode === "history" ? [captured.prompts.HISTORY_DISCUSSION_PROMPT, captured.prompts.HISTORY_VERIFICATION_PROMPT] : [captured.prompts.INTRADAY_DISCUSSION_PROMPT, captured.prompts.INTRADAY_VERIFICATION_PROMPT];
    expect(systems).toEqual(pair);
  }
});
