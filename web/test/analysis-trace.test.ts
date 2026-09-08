import { env } from "cloudflare:workers";
import { beforeAll, expect, it, vi } from "vitest";
import promptMigration from "../migrations/0004_analysis_prompts.sql?raw";
import traceMigration from "../migrations/0005_analysis_traces.sql?raw";
import { withAnalysisTrace, readAnalysisTrace, AnalysisTraceError } from "../src/analysis-trace";

const db = (env as { DB: D1Database }).DB;
beforeAll(async () => { await db.batch((promptMigration + traceMigration).split(/;\s*(?=CREATE|$)/).filter(sql => sql.trim()).map(sql => db.prepare(sql))); });
const context = () => ({ owner: crypto.randomUUID(), kind: "sparring" as const, requestId: "same-client-id", secrets: ["synthetic-private-key"], status: vi.fn() });

it("persists complete owner-private frozen events without credential or reasoning fields", async () => {
  const ctx = context();
  ctx.requestId = "synthetic-private-key";
  const prefix = '{"stage":"facts","reason":"validated_facts","input":{"text":"';
  const text = "x".repeat(4096 - prefix.length - 1) + "😀中文".repeat(75000);
  const output = await withAnalysisTrace(db, ctx, async (_prompts, observe) => {
    const facts = { text, headers: { Authorization: "secret" }, nested: { reasoning_details: "private-thought", api_key: "secret" }, "synthetic-private-key": "must be omitted", echo: "synthetic-private-key", value: 1 };
    observe({ stage: "facts", reason: "validated_facts", input: facts });
    facts.value = 2;
    return { reply: "ok" };
  });
  expect(output).toEqual({ reply: "ok" });
  const id = ctx.status.mock.calls[0][0];
  expect(ctx.status).toHaveBeenLastCalledWith(id, "complete");
  const trace = await readAnalysisTrace(db, ctx.owner, id) as any;
  expect(trace.outcome).toBe("accepted");
  expect(trace.request_id).toBe("[REDACTED]");
  expect(trace.events.find((event: any) => event.stage === "facts").input).toEqual({ text, nested: {}, echo: "[REDACTED]", value: 1 });
  expect(JSON.stringify(trace)).not.toMatch(/private-thought|synthetic-private-key|Authorization/);
  expect(trace.events[0]).toMatchObject({ stage: "configuration", output: { digest: expect.stringMatching(/^[a-f0-9]{64}$/) } });
  expect(await readAnalysisTrace(db, "other-owner", id)).toBeNull();
  expect(await readAnalysisTrace(db, ctx.owner, "not-a-uuid")).toBeNull();
});

it("latches event and byte limits instead of silently truncating a released answer", async () => {
  for (const mode of ["events", "bytes"] as const) {
    const ctx = context(), run = vi.fn<Parameters<typeof withAnalysisTrace>[2]>(async (_prompts, observe) => {
      if (mode === "events") for (let index = 0; index < 65; index++) observe({ stage: "facts", reason: "bounded_capture", output: index });
      else observe({ stage: "facts", reason: "bounded_capture", output: "x".repeat(8 * 1024 * 1024) });
      return "must not escape";
    });
    await expect(withAnalysisTrace(db, ctx, run)).rejects.toBeInstanceOf(AnalysisTraceError);
    expect(run).toHaveBeenCalledTimes(1);
    expect((await readAnalysisTrace(db, ctx.owner, ctx.status.mock.calls[0][0]) as any).outcome).toBe("incomplete");
  }
});

it("records rejected analysis without changing its failure or retrying it", async () => {
  const ctx = context(), rejected = new Error("sensitive provider error synthetic-private-key");
  const action = vi.fn(async () => { throw rejected; });
  await expect(withAnalysisTrace(db, ctx, action)).rejects.toBe(rejected);
  expect(action).toHaveBeenCalledTimes(1);
  const trace = await readAnalysisTrace(db, ctx.owner, ctx.status.mock.calls[0][0]) as any;
  expect(trace.outcome).toBe("failed");
  expect(JSON.stringify(trace)).not.toContain(rejected.message);
});

it("fails closed on missing storage, capture failure and trace writes without inference retries", async () => {
  const action = vi.fn(async () => "answer");
  await expect(withAnalysisTrace(undefined, context(), action)).rejects.toBeInstanceOf(AnalysisTraceError);
  expect(action).not.toHaveBeenCalled();
  const ctx = context();
  await expect(withAnalysisTrace(db, ctx, async (_prompts, observe) => {
    const circular: any = {}; circular.self = circular;
    observe({ stage: "facts", reason: "invalid_capture", input: circular });
    return "must not escape";
  })).rejects.toBeInstanceOf(AnalysisTraceError);
  expect(ctx.status).toHaveBeenLastCalledWith(expect.any(String), "unavailable");
  const incomplete = await readAnalysisTrace(db, ctx.owner, ctx.status.mock.calls[0][0]) as any;
  expect(incomplete.outcome).toBe("incomplete");
  expect(incomplete.events).toBeUndefined();
  for (const failOn of ["INSERT INTO analysis_traces", "INSERT INTO analysis_trace_parts", "UPDATE analysis_traces SET outcome = ?"]) {
    const broken = { prepare: (sql: string) => { if (sql.startsWith(failOn)) throw new Error("storage failed"); return db.prepare(sql); }, batch: db.batch.bind(db) } as D1Database;
    const run = vi.fn(async () => "answer");
    await expect(withAnalysisTrace(broken, context(), run)).rejects.toBeInstanceOf(AnalysisTraceError);
    expect(run).toHaveBeenCalledTimes(failOn === "INSERT INTO analysis_traces" ? 0 : 1);
  }
});

it("rejects missing or corrupted chunks instead of presenting a partial trace as complete", async () => {
  const ctx = context();
  await withAnalysisTrace(db, ctx, async () => "ok");
  const id = ctx.status.mock.calls[0][0];
  await db.prepare("DELETE FROM analysis_trace_parts WHERE trace_id = ? AND seq = 0").bind(id).run();
  await expect(readAnalysisTrace(db, ctx.owner, id)).rejects.toBeInstanceOf(AnalysisTraceError);
});
