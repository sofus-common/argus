import { loadAnalysisPrompts, promptDigest, ANALYSIS_ENGINE_VERSION } from "./analysis-config";
import type { AnalysisPrompts } from "./analysis-prompts";

type Stage = "configuration" | "facts" | "generation-request" | "generation-output" | "tool-request" | "tool-admission" | "tool-result" | "tool-rejection" | "verification-request" | "verification-output" | "proposal-check" | "completion" | "failure" | "transport";
export type AnalysisObserver = (event: { stage: Stage; reason: string; input?: unknown; output?: unknown }) => void;
export class AnalysisTraceError extends Error { constructor() { super("Analysis trace unavailable"); } }
type TraceContext = {
  owner: string; kind: "sparring" | "lots" | "history" | "intraday"; requestId: string;
  secrets?: string[]; status: (id: string, status: "recording" | "complete" | "unavailable") => void;
};
type TraceRow = { id: string; kind: string; request_id: string; started_at: number; finished_at: number | null; outcome: "running" | "accepted" | "failed" | "incomplete"; event_count: number; part_count: number; total_bytes: number };
const MAX_EVENTS = 64, MAX_BYTES = 8 * 1024 * 1024, CHUNK_CHARS = 4096, BATCH_SIZE = 64;
const blocked = new Set(["headers", "authorization", "cookie", "setcookie", "reasoning", "reasoningdetails", "apikey", "accesstoken", "refreshtoken", "clientsecret"]);

export async function withAnalysisTrace<T>(db: D1Database | undefined, context: TraceContext, run: (prompts: AnalysisPrompts, observe: AnalysisObserver) => Promise<T>): Promise<T> {
  const id = crypto.randomUUID(), started = Date.now(), events: string[] = [];
  let bytes = 0, captureFailed = false, completedFailure = false;
  const secrets = [...new Set((context.secrets ?? []).filter(value => value.length > 0).flatMap(value => [value, JSON.stringify(value).slice(1, -1)]))];
  const redact = (value: string) => { for (const secret of secrets) value = value.split(secret).join("[REDACTED]"); return value; };
  const observe: AnalysisObserver = event => {
    if (captureFailed) return;
    try {
      if (events.length >= MAX_EVENTS || !event.reason || event.reason.length > 200) throw new Error();
      const serialized = JSON.stringify({ ...event, elapsedMs: Date.now() - started }, (key, value) => {
        if (blocked.has(key.toLowerCase().replace(/[-_]/g, "")) || secrets.some(secret => key.includes(secret))) return undefined;
        return typeof value === "string" ? redact(value) : value;
      });
      const size = new TextEncoder().encode(serialized).byteLength;
      if (bytes + size > MAX_BYTES) throw new Error();
      events.push(serialized); bytes += size;
    } catch { captureFailed = true; }
  };
  context.status(id, "recording");
  try {
    if (!db || !context.owner || context.owner.length > 2048 || !context.requestId || context.requestId.length > 128) throw new AnalysisTraceError();
    const created = await db.prepare("INSERT INTO analysis_traces (id,owner,kind,request_id,started_at,outcome) VALUES (?,?,?,?,?,'running')").bind(id, context.owner, context.kind, redact(context.requestId), started).run();
    if (!created.success || created.meta.changes !== 1) throw new AnalysisTraceError();
    let result: T | undefined, failure: unknown, failed = false;
    try {
      const prompts = await loadAnalysisPrompts(db);
      observe({ stage: "configuration", reason: "frozen_runtime_bundle", output: { version: prompts.version, digest: await promptDigest(prompts), engine: ANALYSIS_ENGINE_VERSION } });
      result = await run(prompts, observe);
    } catch (error) { failed = true; failure = error; }
    observe({ stage: failed ? "failure" : "completion", reason: "analysis_disposition", output: { outcome: failed ? "failed" : "accepted" } });
    let seq = 0, batch: D1PreparedStatement[] = [];
    const flush = async () => {
      if (!batch.length) return;
      const results = await db.batch(batch);
      if (results.some(row => !row.success || row.meta.changes !== 1)) throw new AnalysisTraceError();
      batch = [];
    };
    for (const [eventIndex, serialized] of events.entries()) {
      for (let offset = 0, chunk = 0; offset < serialized.length; offset += CHUNK_CHARS, chunk++) {
        // JSON encoding preserves surrogate halves when a Unicode character crosses a chunk.
        batch.push(db.prepare("INSERT INTO analysis_trace_parts (trace_id,seq,event_index,chunk_index,chunk_json) SELECT id,?,?,?,? FROM analysis_traces WHERE id = ? AND owner = ? AND outcome = 'running'")
          .bind(seq++, eventIndex, chunk, JSON.stringify(serialized.slice(offset, offset + CHUNK_CHARS)), id, context.owner));
        if (batch.length === BATCH_SIZE) await flush();
      }
    }
    batch.push(db.prepare("UPDATE analysis_traces SET outcome = ?,finished_at = ?,event_count = ?,part_count = ?,total_bytes = ? WHERE id = ? AND owner = ? AND outcome = 'running'")
      .bind(captureFailed ? "incomplete" : failed ? "failed" : "accepted", Date.now(), events.length, seq, bytes, id, context.owner));
    await flush();
    if (captureFailed) throw new AnalysisTraceError();
    context.status(id, "complete");
    if (failed) { completedFailure = true; throw failure; }
    return result as T;
  } catch (error) {
    // A completed failed analysis keeps its original error; telemetry must not turn it into success.
    if (completedFailure) throw error;
    context.status(id, "unavailable");
    console.error(JSON.stringify({ event: "analysis_trace_unavailable", traceId: id }));
    throw new AnalysisTraceError();
  }
}

export async function readAnalysisTrace(db: D1Database, owner: string, id: string) {
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(id)) return null;
  const row = await db.prepare("SELECT id,kind,request_id,started_at,finished_at,outcome,event_count,part_count,total_bytes FROM analysis_traces WHERE owner = ? AND id = ?").bind(owner, id).first<TraceRow>();
  if (!row) return null;
  if (row.outcome === "running" || row.outcome === "incomplete") return row;
  if (!["accepted", "failed"].includes(row.outcome) || !Number.isInteger(row.event_count) || row.event_count < 1 || row.event_count > MAX_EVENTS || !Number.isInteger(row.part_count) || row.part_count < row.event_count || row.part_count > Math.ceil(MAX_BYTES / CHUNK_CHARS) + MAX_EVENTS || !Number.isInteger(row.total_bytes) || row.total_bytes < 1 || row.total_bytes > MAX_BYTES) throw new AnalysisTraceError();
  const serialized: string[] = [];
  let index = -1, chunk = 0, bytes = 0;
  for (let offset = 0; offset < row.part_count; offset += BATCH_SIZE) {
    const { results } = await db.prepare("SELECT p.seq,p.event_index,p.chunk_index,p.chunk_json FROM analysis_trace_parts p JOIN analysis_traces t ON t.id = p.trace_id WHERE t.owner = ? AND t.id = ? AND p.seq >= ? ORDER BY p.seq LIMIT ?")
      .bind(owner, id, offset, Math.min(BATCH_SIZE, row.part_count - offset)).all<{ seq: number; event_index: number; chunk_index: number; chunk_json: string }>();
    if (results.length !== Math.min(BATCH_SIZE, row.part_count - offset)) throw new AnalysisTraceError();
    for (const [within, part] of results.entries()) {
      if (part.seq !== offset + within) throw new AnalysisTraceError();
      if (part.event_index === index + 1) { index++; chunk = 0; serialized.push(""); }
      if (index < 0 || index >= row.event_count || part.event_index !== index || part.chunk_index !== chunk++) throw new AnalysisTraceError();
      let value: unknown;
      try { value = JSON.parse(part.chunk_json); } catch { throw new AnalysisTraceError(); }
      if (typeof value !== "string" || !value.length || value.length > CHUNK_CHARS) throw new AnalysisTraceError();
      serialized[index] += value;
    }
  }
  if (serialized.length !== row.event_count) throw new AnalysisTraceError();
  const events = serialized.map(text => {
    bytes += new TextEncoder().encode(text).byteLength;
    try { return JSON.parse(text) as unknown; } catch { throw new AnalysisTraceError(); }
  });
  if (bytes !== row.total_bytes) throw new AnalysisTraceError();
  return { ...row, events };
}
