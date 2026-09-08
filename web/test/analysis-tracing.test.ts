import { expect, it } from "vitest";
import { createStrategy } from "../src/options";
import { spar, discussLotComparison, type SparringRequest } from "../src/sparring";
import type { AnalysisObserver } from "../src/analysis-trace";

it("records HTTP failure status without response body and allowlists observed numeric provider usage", async () => {
  for (const mode of ["spar", "lots"] as const) for (const failure of ["initial", "verification", "none"] as const) {
    const events: Parameters<AnalysisObserver>[0][] = [];
    let calls = 0;
    const fetcher: typeof fetch = async () => {
      calls++;
      if (failure === "initial" || failure === "verification" && calls === 2) return new Response("RAW_PRIVATE_ERROR", { status: 429, headers: { "X-Private": "HEADER_SECRET" } });
      const draft = { text: "Synthetic.", assumptions: [], objections: [], suggested_prompts: [], ...(mode === "spar" ? { operations: [], risk_classification: "bounded", evidence_ids: [] } : {}) };
      return Response.json({ choices: [{ message: { content: JSON.stringify(calls === 1 ? draft : { valid: true }) } }], usage: { total_tokens: calls === 1 ? 12 : "13", extra: "PRIVATE_USAGE", reasoning_details: "PRIVATE_USAGE" } });
    };
    const observer: AnalysisObserver = event => { events.push(event); };
    const pending = mode === "spar" ? spar({ request_id: "trace-http", base_state_version: 1, state: createStrategy("long-call"), conversation: [{ role: "user", content: "Explain" }] }, "KEY", fetcher, undefined, undefined, undefined, observer)
      : discussLotComparison({ title: "Synthetic" } as Parameters<typeof discussLotComparison>[0], [{ role: "user", content: "Explain" }], "KEY", fetcher, undefined, observer);
    if (failure === "none") await pending; else await expect(pending).rejects.toThrow();
    if (failure !== "none") expect(events).toContainEqual({ stage: failure === "initial" ? "generation-output" : "verification-output", reason: "http-error", output: { status: 429 } });
    if (failure !== "initial") expect((events.find(event => event.stage === "generation-output")!.output as any).usage).toEqual({ total_tokens: 12 });
    if (failure === "none") expect((events.find(event => event.stage === "verification-output")!.output as any).usage).toBeUndefined();
    for (const event of events.filter(event => event.stage.endsWith('-request'))) {
      expect(event.output).toEqual({ reasoningEffort: event.stage === 'verification-request' ? 'low' : 'medium', reasoningExcluded: true });
      expect((event.input as any).reasoning).toBeUndefined();
    }
    for (const excluded of ["RAW_PRIVATE_ERROR", "HEADER_SECRET", "PRIVATE_USAGE", "reasoning_details"]) expect(JSON.stringify(events)).not.toContain(excluded);
    expect(calls).toBe(failure === "initial" ? 1 : 2);
  }
});

it("traces explicit bounded generation, tools and verification without transport headers or private reasoning", async () => {
  for (const mode of ["normal", "tool", "denied", "rejected"] as const) {
    const state = createStrategy("long-call"), original = structuredClone(state);
    const request: SparringRequest = { request_id: "trace-test", base_state_version: state.version, state, conversation: [{ role: "user", content: "Explain this scenario" }] };
    const events: Parameters<AnalysisObserver>[0][] = [], observe: AnalysisObserver = event => { events.push(event); };
    let calls = 0;
    const fetcher: typeof fetch = async (_url, init) => {
      calls++;
      const body = JSON.parse(String(init?.body));
      const verification = body.response_format?.json_schema.name === "analysis_verification";
      const tool = { id: "one", type: "function", function: { name: mode === "denied" ? "place_order" : "evaluate_scenarios", arguments: JSON.stringify({ scenarios: [{ scenarioSpot: 103, scenarioDate: state.scenarioDate, ivShift: 0 }] }) } };
      const draft = { text: "Synthetic scenario explanation.", assumptions: [], objections: [], suggested_prompts: [], operations: [], risk_classification: "bounded", evidence_ids: [] };
      return Response.json({ choices: [{ message: { reasoning_details: [{ secret: "PRIVATE_REASONING" }], reasoning: "PRIVATE_REASONING", content: JSON.stringify(verification ? { valid: mode !== "rejected" } : draft), ...((mode === "tool" || mode === "denied") && calls === 1 ? { tool_calls: [tool] } : {}) } }] });
    };
    const pending = spar(request, "PROVIDER_SECRET", fetcher, undefined, undefined, undefined, observe);
    if (mode === "denied" || mode === "rejected") await expect(pending).rejects.toThrow(); else await pending;
    expect(calls).toBe(mode === "tool" ? 3 : mode === "denied" ? 1 : 2);
    expect(events[0]).toMatchObject({ stage: "facts", reason: "validated-position" });
    expect(events.some(event => event.stage === "generation-request" && event.reason === "initial")).toBe(true);
    expect(events.some(event => event.stage === "generation-output")).toBe(true);
    if (mode === "tool") {
      expect(events.some(event => event.stage === "tool-admission")).toBe(true);
      expect(events.some(event => event.stage === "tool-result")).toBe(true);
      expect(events.some(event => event.stage === "generation-request" && event.reason === "resumed")).toBe(true);
      expect((events[0].output as any).requestedScenarios).toEqual([]);
    }
    if (mode === "denied") expect(events.some(event => event.stage === "tool-rejection")).toBe(true);
    else expect(events.some(event => event.stage === "verification-output")).toBe(true);
    if (mode === "rejected") expect(events.some(event => event.stage === "completion" && event.reason === "verification-rejected")).toBe(true);
    const encoded = JSON.stringify(events);
    for (const excluded of ["PRIVATE_REASONING", "reasoning_details", "PROVIDER_SECRET", "Authorization", "HTTP-Referer"]) expect(encoded).not.toContain(excluded);
    expect(state).toEqual(original);
  }
});

it("threads the observer through read-only discussion and records verification denial", async () => {
  const events: Parameters<AnalysisObserver>[0][] = [];
  let calls = 0;
  await expect(discussLotComparison({ title: "Synthetic tracing fixture" } as Parameters<typeof discussLotComparison>[0], [{ role: "user", content: "Explain" }], "SECRET", async () => {
    calls++;
    return Response.json({ choices: [{ message: { content: JSON.stringify(calls === 1 ? { text: "Synthetic", assumptions: [], objections: [], suggested_prompts: [] } : { valid: false }), reasoning_details: "PRIVATE_REASONING" } }] });
  }, undefined, event => { events.push(event); })).rejects.toThrow();
  expect(calls).toBe(2);
  expect(events.map(event => event.stage)).toContain("facts");
  expect(events.some(event => event.stage === "completion" && event.reason === "verification-rejected")).toBe(true);
  expect(JSON.stringify(events)).not.toContain("PRIVATE_REASONING");
});
