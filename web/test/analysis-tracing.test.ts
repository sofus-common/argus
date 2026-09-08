import { expect, it, vi } from "vitest";
import { createStrategy } from "../src/options";
import { spar, discussLotComparison, type SparringRequest } from "../src/sparring";
import type { AnalysisObserver } from "../src/analysis-trace";

it('distinguishes stalled fetch, stalled body and malformed JSON without private diagnostics', async () => {
  for (const mode of ['spar', 'lots'] as const) for (const phase of ['fetch', 'body', 'parse'] as const) {
    vi.useFakeTimers();
    try {
      const events: Parameters<AnalysisObserver>[0][] = [];
      const provider = vi.fn<typeof fetch>(async () => phase === 'fetch' ? new Promise<Response>(() => {}) : phase === 'body'
        ? new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('PRIVATE_BODY')); } }), { headers: { 'X-Private': 'PRIVATE_HEADER' } })
        : new Response('PRIVATE_INVALID_JSON', { headers: { 'X-Private': 'PRIVATE_HEADER' } }));
      const observe: AnalysisObserver = event => { events.push(event); };
      const pending = mode === 'spar' ? spar({ request_id: 'transport-test', base_state_version: 1, state: createStrategy('long-call'), conversation: [{ role: 'user', content: 'Explain' }] }, 'PRIVATE_KEY', provider, undefined, undefined, undefined, observe)
        : discussLotComparison({ title: 'Synthetic' } as Parameters<typeof discussLotComparison>[0], [{ role: 'user', content: 'Explain' }], 'PRIVATE_KEY', provider, undefined, observe);
      const rejected = expect(pending).rejects.toThrow();
      if (phase !== 'parse') await vi.advanceTimersByTimeAsync(20_001);
      await rejected;
      const transport = events.filter(event => event.stage === 'transport');
      expect(transport.map(event => event.reason)).toEqual(phase === 'fetch' ? ['provider-failed'] : phase === 'body' ? ['headers-received', 'provider-failed'] : ['headers-received', 'body-complete', 'provider-failed']);
      expect(transport.at(-1)?.output).toEqual({ call: 'generation', resumed: false, phase, deadlineAborted: phase !== 'parse', errorName: phase === 'parse' ? 'SyntaxError' : 'Error' });
      if (phase !== 'fetch') expect(transport[0].output).toEqual({ call: 'generation', resumed: false, status: 200 });
      if (phase === 'parse') expect(transport[1].output).toEqual({ call: 'generation', resumed: false, bytes: 20 });
      for (const value of ['PRIVATE_BODY', 'PRIVATE_INVALID_JSON', 'PRIVATE_HEADER', 'PRIVATE_KEY']) expect(JSON.stringify(events)).not.toContain(value);
      expect(provider).toHaveBeenCalledOnce();
    } finally { vi.useRealTimers(); }
  }
});

it('never copies an arbitrary exception name or message into transport diagnostics', async () => {
  const events: Parameters<AnalysisObserver>[0][] = [];
  const error = new Error('PRIVATE_ERROR_MESSAGE'); error.name = 'PRIVATE_ERROR_NAME';
  await expect(spar({ request_id: 'transport-error', base_state_version: 1, state: createStrategy('long-call'), conversation: [{ role: 'user', content: 'Explain' }] }, 'KEY', async () => { throw error; }, undefined, undefined, undefined, event => { events.push(event); })).rejects.toBe(error);
  expect(events.find(event => event.stage === 'transport')?.output).toEqual({ call: 'generation', resumed: false, phase: 'fetch', deadlineAborted: false, errorName: 'Error' });
  expect(JSON.stringify(events)).not.toContain('PRIVATE_ERROR');
});

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
    expect(events.length).toBeLessThanOrEqual(24);
    expect(events.filter(event => event.stage === 'transport').map(event => ({ reason: event.reason, call: (event.output as any).call, resumed: (event.output as any).resumed }))).toEqual([
      ...['headers-received', 'body-complete'].map(reason => ({ reason, call: 'generation', resumed: false })),
      ...(mode === 'tool' ? ['headers-received', 'body-complete'].map(reason => ({ reason, call: 'generation', resumed: true })) : []),
      ...(mode !== 'denied' ? ['headers-received', 'body-complete'].map(reason => ({ reason, call: 'verification', resumed: false })) : []),
    ]);
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
