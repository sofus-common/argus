import { defaultAnalysisPrompts, readAnalysisPrompts, type AnalysisPrompts } from "./analysis-prompts";
import operationalReference from "../knowledge/options-operations-v1.json" with { type: "json" };
import type { AnalysisObserver } from "./analysis-trace";
import {
  TEMPLATES,
  calculateStrategy,
  calculateConditionalAssignment,
  contractTermsFacts,
  firstExpiryRange,
  pnlDisplayBasis,
  type PnlDisplayMode,
  searchCandidates,
  CandidateSearchLimitError,
  expirationProbability,
  scenarioTable,
  scenarioSpotAttribution,
  isChartRange,
  type ChartRange,
  evaluateScenario,
  effectiveIv,
  pruneExpiryIvShifts,
  quoteValuation,
  scenarioFacts,
  createStrategy,
  createMarketStrategy,
  marketLeg,
  validateMarketStrategy,
  payoffSeries,
  validateStrategy,
  type OptionLeg,
  type StrategyMetrics,
  type StrategyState,
  type TemplateId,
  type MarketSnapshot,
} from "./options";
import type { MarketContext } from "./market-context";
import { americanScenario } from "./american-surface";
import { calculateLotScenarioComparison, type LotScenario } from "./lot-scenarios";
import { historyPriceScale, readPriceHistory, type buildPriceHistory, type HistoricalRange } from "./price-history";
import { readIntradayHistory, buildIvDiscussionFacts, type buildIvHistory, type buildIntradayHistory } from "./intraday-history";

import type { LotTransaction, projectPositionLots, valuePositionLots } from "./position-lots";

export const MODEL = "google/gemini-3.8-flash";
export const MAX_MESSAGES = 12;
export const MAX_CONVERSATION_CHARS = 12_000;
export const MAX_OUTPUT_TOKENS = 4096;
export const PROVIDER_TIMEOUT_MS = 20_000;
export const SCENARIO_TOOL_TIMEOUT_MS = 30_000;

function observeAnalysis(observer: AnalysisObserver | undefined, event: Parameters<AnalysisObserver>[0]) {
  if (observer) observer(JSON.parse(JSON.stringify(event, (key, value) => /^(reasoning|reasoning_details|analysis|headers|authorization)$/i.test(key) ? undefined : value)));
}

function observedBody(observer: AnalysisObserver | undefined, verification: boolean, resumed: boolean, body: unknown): string {
  const encoded = JSON.stringify(body);
  const settings = record(record(body)?.reasoning);
  const output = { reasoningEffort: settings?.effort === 'low' || settings?.effort === 'medium' ? settings.effort : null, reasoningExcluded: typeof settings?.exclude === 'boolean' ? settings.exclude : null };
  observeAnalysis(observer, { stage: verification ? "verification-request" : "generation-request", reason: verification ? "independent-verification" : resumed ? "resumed" : "initial", input: body, output });
  return encoded;
}

function observeProviderOutput(observer: AnalysisObserver | undefined, verification: boolean, resumed: boolean, message: ProviderMessage | undefined, rawUsage?: unknown) {
  if (!observer) return;
  let content: unknown = message?.content;
  try { if (typeof content === "string") content = JSON.parse(content); } catch {}
  const tokens = record(rawUsage)?.total_tokens;
  const usage = typeof tokens === "number" && Number.isSafeInteger(tokens) && tokens >= 0 ? { total_tokens: tokens } : undefined;
  observeAnalysis(observer, { stage: verification ? "verification-output" : "generation-output", reason: verification ? "provider-verdict" : resumed ? "resumed" : "initial", output: { content, ...(message?.tool_calls !== undefined ? { tool_calls: message.tool_calls } : {}), ...(usage ? { usage } : {}) } });
}

export type ConversationMessage = {
  role: "user" | "assistant";
  content: string;
};

export type SparringRequest = {
  request_id: string;
  base_state_version: number;
  state: StrategyState;
  conversation: ConversationMessage[];
  probability_range?: { lower: number; upper: number };
  first_expiry_range?: { min: number; max: number };
  chart_context?: { view: "curve" | "heatmap" | "table"; metric: "pnl" | "delta" | "gamma" | "theta" | "vega" | "rho"; valuationModel?: "american-crr-1024-v1"; pnlDisplay?: PnlDisplayMode; range?: ChartRange };
};

type Operation =
  | { kind: "set_expiry_iv"; expiry: string; ivShift: number }
  | { kind: "set_contracts"; leg_id: string; contracts: number }
  | { kind: "set_cost_allowance"; feeAllowance: number }
  | { kind: "set_stock"; stock: NonNullable<StrategyState["stock"]> }
  | { kind: "remove_stock" }
  | { kind: "replace_with_template"; template_id: string }
  | { kind: "add_leg"; leg: OptionLeg }
  | { kind: "remove_leg"; leg_id: string }
  | { kind: "update_leg"; leg_id: string; leg: OptionLeg }
  | {
      kind: "set_scenario";
      scenario: Pick<StrategyState, "scenarioDate" | "scenarioSpot" | "ivShift" | "expiryIvShifts">;
    };

export type SparringReply = {
  text: string;
  assumptions: string[];
  objections: string[];
  operations: Operation[];
  suggested_prompts: string[];
  risk_classification: "bounded" | "unbounded" | "not-exact";
  evidence_ids: string[];
};

export type SparringSuccess = {
  request_id: string;
  base_state_version: number;
  reply: SparringReply;
  next_state: StrategyState;
  metrics: StrategyMetrics;
  calculated: ReturnType<typeof strategyFacts>;
  market_context: MarketContext;
};

type ProviderMessage = { content?: string | null; tool_calls?: unknown; reasoning_details?: unknown };
type ProviderResponse = { choices?: Array<{ message?: ProviderMessage }>; usage?: unknown };
type PositionComparison = {
  state: StrategyState; metrics: StrategyMetrics;
  baseline: { state: StrategyState; metrics: StrategyMetrics };
  lossClassification: "bounded" | "unbounded" | "not-exact";
  profitClassification: "bounded" | "unbounded" | "not-exact";
  additionalShareCost: number; removedLegIds: string[]; assumptions: string;
  replacement?: { legId: string; previousContractId: string; contractId: string; entryPrice: number; basis: "mid" | "natural"; bid: number; ask: number; quoteAsOf: string };
};
type RequestedScenario = {
  id: string;
  scenario: Pick<StrategyState, "scenarioDate" | "scenarioSpot" | "ivShift"> & { legIvShifts?: Array<{ legId: string; ivShift: number }> };
  legVolatilities: Array<Pick<OptionLeg, "expiry" | "strike" | "type" | "side"> & { legId: string; baseIv: number; globalShift: number; expiryShift?: number; legShift: number; modeledIv: number }>;
  metrics: ReturnType<typeof evaluateScenario>;
  changesFromCurrent: ReturnType<typeof evaluateScenario>;
  pnlComparison: {
    baseline: Pick<StrategyState, "scenarioDate" | "scenarioSpot" | "ivShift" | "expiryIvShifts">;
    baselinePnl: number;
    isolatedChanges: { spot: number; date: number; iv: number };
    interactionResidual: number;
  };
  assumptions: string;
};

export type ProviderFetch = typeof fetch;

export type LotDiscussionFacts = {
  scenario?: ReturnType<typeof import("./lot-scenarios").calculateLotScenarioComparison>;
  savedId: string; title: string; revision: number; transaction: LotTransaction; snapshotId: string; basis: "mid" | "natural";
  before: { projection: ReturnType<typeof projectPositionLots>; valuation: ReturnType<typeof valuePositionLots> | null };
  after: { projection: ReturnType<typeof projectPositionLots>; valuation: ReturnType<typeof valuePositionLots> | null };
};
export type LotDiscussionReply = { text: string; assumptions: string[]; objections: string[]; suggested_prompts: string[] };

export function parseLotConversation(value: unknown): ConversationMessage[] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_MESSAGES) return null;
  const messages: ConversationMessage[] = [];
  let size = 0;
  for (const raw of value) {
    const message = record(raw);
    if (!message || Object.keys(message).sort().join() !== "content,role" || !["user", "assistant"].includes(String(message.role)) || typeof message.content !== "string" || !message.content.trim()) return null;
    size += message.content.length;
    messages.push({ role: message.role as ConversationMessage["role"], content: message.content });
  }
  return size <= MAX_CONVERSATION_CHARS && messages.at(-1)?.role === "user" ? messages : null;
}

const LOT_DISCUSSION_SCHEMA = { name: "lot_discussion", strict: true, schema: { type: "object", additionalProperties: false, required: ["text", "assumptions", "objections", "suggested_prompts"], properties: { text: { type: "string" }, assumptions: { type: "array", items: { type: "string" } }, objections: { type: "array", items: { type: "string" } }, suggested_prompts: { type: "array", items: { type: "string" } } } } };
const LOT_SCENARIO_TOOLS = [{ type: "function", function: {
  name: "evaluate_lot_scenarios", description: "Read-only conditional model P/L for both unchanged explicit-lot inventories at 1-4 coordinates. Date is canonical UTC between captured quotes/inventory and first remaining option expiry. ivShift is total additive decimal shift to every option IV on both sides (.01 = one percentage point). No execution, lot, cost or workspace changes.",
  parameters: { type: "object", additionalProperties: false, required: ["scenarios"], properties: { scenarios: { type: "array", minItems: 1, maxItems: 4, items: { type: "object", additionalProperties: false, required: ["spot", "date", "ivShift"], properties: { spot: { type: "number", exclusiveMinimum: 0, maximum: 1_000_000 }, date: { type: "string", format: "date-time" }, ivShift: { type: "number", minimum: -10, maximum: 10 } } } } } },
} }];

// ponytail: retain all 2016 four-leg weekly buckets within 2 MiB; use scoped retrieval if longer history exceeds this bound.
const INTRADAY_DISCUSSION_BYTES = 2 * 1024 * 1024;

export async function discussLotComparison(facts: LotDiscussionFacts, conversation: ConversationMessage[], apiKey: string, providerFetch: ProviderFetch = fetch, prompts: AnalysisPrompts = defaultAnalysisPrompts, observer?: AnalysisObserver): Promise<{ reply: LotDiscussionReply; requestedScenarios: ReturnType<typeof calculateLotScenarioComparison>[] }> {
  return discussReadOnly(facts, conversation, apiKey, providerFetch, "lots", prompts, observer);
}

export type PriceHistoryDiscussionFacts = { state: StrategyState; range: HistoricalRange; history: ReturnType<typeof buildPriceHistory>; selectedDate: string };
export async function discussPriceHistory(facts: PriceHistoryDiscussionFacts, conversation: ConversationMessage[], apiKey: string, providerFetch: ProviderFetch = fetch, prompts: AnalysisPrompts = defaultAnalysisPrompts, observer?: AnalysisObserver): Promise<{ reply: LotDiscussionReply }> {
  if (!record(facts) || Object.keys(facts).sort().join() !== "history,range,selectedDate,state" || new TextEncoder().encode(JSON.stringify(facts)).byteLength > 64 * 1024) throw new Error("Invalid history discussion facts");
  const captured = structuredClone(facts);
  captured.history = readPriceHistory({ history: captured.history, range: captured.range, source: "Theta EOD", snapshotId: captured.state.pricing?.snapshotId, positionVersion: captured.state.version }, captured.state, captured.range);
  if (!captured.history.rows.some(row => row.date === captured.selectedDate)) throw new Error("Invalid selected history date");
  const { reply } = await discussReadOnly(captured, conversation, apiKey, providerFetch, "history", prompts, observer);
  return { reply };
}

export type IntradayHistoryDiscussionFacts = { state: StrategyState; range: { start: number; end: number }; history: ReturnType<typeof buildIntradayHistory>; selectedTime: number };
export async function discussIntradayHistory(facts: IntradayHistoryDiscussionFacts, conversation: ConversationMessage[], apiKey: string, providerFetch: ProviderFetch = fetch, prompts: AnalysisPrompts = defaultAnalysisPrompts, observer?: AnalysisObserver): Promise<{ reply: LotDiscussionReply }> {
  if (!record(facts) || Object.keys(facts).sort().join() !== 'history,range,selectedTime,state' || new TextEncoder().encode(JSON.stringify(facts)).byteLength > INTRADAY_DISCUSSION_BYTES) throw new Error('Invalid intraday discussion facts');
  const captured = structuredClone(facts);
  captured.history = readIntradayHistory({ history: captured.history, range: captured.range, snapshotId: captured.state.pricing?.snapshotId, positionVersion: captured.state.version }, captured.state, captured.range);
  if (!captured.history.rows.some(row => row.time === captured.selectedTime)) throw new Error('Invalid selected intraday bucket');
  const { reply } = await discussReadOnly(captured, conversation, apiKey, providerFetch, 'intraday', prompts, observer);
  return { reply };
}

export type IvHistoryDiscussionFacts = { state: StrategyState; range: { start: number; end: number }; history: ReturnType<typeof buildIvHistory>; contractId: string; selectedTime: number };
export async function discussIvHistory(facts: IvHistoryDiscussionFacts, conversation: ConversationMessage[], apiKey: string, providerFetch: ProviderFetch = fetch, prompts: AnalysisPrompts = defaultAnalysisPrompts, observer?: AnalysisObserver): Promise<{ reply: LotDiscussionReply }> {
  if (!record(facts) || Object.keys(facts).sort().join() !== 'contractId,history,range,selectedTime,state' || new TextEncoder().encode(JSON.stringify(facts)).byteLength > INTRADAY_DISCUSSION_BYTES) throw new Error('Invalid IV discussion facts');
  const captured = structuredClone(facts);
  const prepared = buildIvDiscussionFacts(captured.state, captured.range, captured.history, captured.contractId, captured.selectedTime);
  const { reply } = await discussReadOnly(prepared, conversation, apiKey, providerFetch, 'iv', prompts, observer);
  return { reply };
}

async function discussReadOnly(facts: LotDiscussionFacts | PriceHistoryDiscussionFacts | IntradayHistoryDiscussionFacts | ReturnType<typeof buildIvDiscussionFacts>, conversation: ConversationMessage[], apiKey: string, providerFetch: ProviderFetch, kind: "lots" | "history" | "intraday" | "iv", bundle: AnalysisPrompts, observer?: AnalysisObserver): Promise<{ reply: LotDiscussionReply; requestedScenarios: ReturnType<typeof calculateLotScenarioComparison>[] }> {
  const { prompts } = readAnalysisPrompts(bundle);
  if (kind === 'iv' && (!prompts.IV_DISCUSSION_PROMPT || !prompts.IV_VERIFICATION_PROMPT)) throw new Error('IV discussion prompts are not configured');
  const prompt = kind === 'iv' ? prompts.IV_DISCUSSION_PROMPT : kind === 'intraday' ? prompts.INTRADAY_DISCUSSION_PROMPT : kind === "history" ? prompts.HISTORY_DISCUSSION_PROMPT : prompts.LOT_DISCUSSION_PROMPT;
  const inputLimit = kind === 'intraday' || kind === 'iv' ? INTRADAY_DISCUSSION_BYTES : 64 * 1024;
  const messages = parseLotConversation(conversation);
  if (!messages) throw new Error("Invalid lot conversation");
  const captured = structuredClone(facts);
  const intraday = kind === 'intraday' ? captured as IntradayHistoryDiscussionFacts : null;
  const presented = intraday ? { ...intraday, range: { start: new Date(intraday.range.start).toISOString(), end: new Date(intraday.range.end).toISOString() }, selectedTime: new Date(intraday.selectedTime).toISOString(), history: { ...intraday.history, rows: intraday.history.rows.map(row => ({ ...row, time: new Date(row.time).toISOString() })) } } : captured;
  const daily = kind === 'history' ? captured as PriceHistoryDiscussionFacts : null;
  const priceDivisor = intraday || daily ? historyPriceScale((intraday ?? daily)!.state) : null;
  const selectedValue = intraday ? intraday.history.rows.find(row => row.time === intraday.selectedTime)?.value : daily?.history.rows.find(row => row.date === daily.selectedDate)?.value?.mid;
  const historyDisplay = kind === 'lots' || kind === 'iv' ? undefined : { priceDivisor, selectedPrice: priceDivisor && selectedValue != null ? selectedValue / priceDivisor : null };
  const frozen = JSON.stringify({ facts: presented, historyDisplay, conversation: messages });
  let requestedScenarios: ReturnType<typeof calculateLotScenarioComparison>[] = [];
  let toolMessages: Record<string, unknown>[] = [];
  // ponytail: reject over 64 KiB rather than truncate lots; add explicit scoped analysis if larger inventories need it.
  if (new TextEncoder().encode(frozen).byteLength > inputLimit) throw new Error("Lot discussion facts exceed the analysis limit.");
  if (observer) observeAnalysis(observer, { stage: "facts", reason: "validated-read-only-facts", output: JSON.parse(frozen) });
  const controller = new AbortController();
  const startedAt = Date.now();
  let timeout: ReturnType<typeof setTimeout>, expire: () => void;
  const deadline = new Promise<never>((_, reject) => { expire = () => { controller.abort(); reject(new Error("Provider timed out")); }; timeout = setTimeout(expire, PROVIDER_TIMEOUT_MS); });
  let verification = false;
  let reason: AnalysisVerificationError["reason"] = "provider_error";
  const complete = async (reply?: LotDiscussionReply, resumed = false) => {
    if (Date.now() - startedAt >= (toolMessages.length ? SCENARIO_TOOL_TIMEOUT_MS : PROVIDER_TIMEOUT_MS)) throw new Error("Provider timed out");
    const selectingTool = !reply && kind === "lots" && !toolMessages.length;
    const content = JSON.stringify({ ...JSON.parse(frozen), requestedScenarios, ...(selectingTool ? { reply_schema: LOT_DISCUSSION_SCHEMA.schema } : {}), ...(reply ? { reply } : {}) });
    if (new TextEncoder().encode(content).byteLength > inputLimit) throw new Error("Lot discussion facts exceed the analysis limit.");
    const response = await Promise.race([deadline, providerFetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST", signal: controller.signal,
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", "HTTP-Referer": "https://github.com/wibo/argus", "X-Title": "ARGUS" },
      body: observedBody(observer, !!reply, resumed, { model: MODEL, stream: false, max_tokens: MAX_OUTPUT_TOKENS, reasoning: { effort: reply ? "low" : "medium", exclude: true },
        messages: [{ role: "system", content: reply ? kind === 'iv' ? prompts.IV_VERIFICATION_PROMPT : kind === 'intraday' ? prompts.INTRADAY_VERIFICATION_PROMPT : kind === "history" ? prompts.HISTORY_VERIFICATION_PROMPT : prompts.LOT_VERIFICATION_PROMPT : prompt }, { role: "user", content }, ...(!reply ? toolMessages : [])],
        ...(selectingTool ? { tools: LOT_SCENARIO_TOOLS, tool_choice: "auto" } : { response_format: { type: "json_schema", json_schema: reply ? VERIFICATION_SCHEMA : LOT_DISCUSSION_SCHEMA } }),
        provider: { allow_fallbacks: false, data_collection: "deny", require_parameters: true },
      }),
    })]);
    if (!response.ok) { observeAnalysis(observer, { stage: reply ? "verification-output" : "generation-output", reason: "http-error", output: { status: response.status } }); await Promise.race([deadline, response.body?.cancel()]); throw new Error("Lot discussion provider failed"); }
    reason = "invalid_output";
    if (!response.body) throw new Error("Missing provider body");
    const reader = response.body.getReader(), cancel = () => { void reader.cancel().catch(() => {}); };
    controller.signal.addEventListener("abort", cancel, { once: true });
    try {
      const provider = await Promise.race([deadline, (async () => {
        let size = 0, body = "";
        const decoder = new TextDecoder();
        for (;;) { const chunk = await reader.read(); if (chunk.done) break; size += chunk.value.byteLength; if (size > 64 * 1024) throw new Error("Oversized provider response"); body += decoder.decode(chunk.value, { stream: true }); }
        return JSON.parse(body + decoder.decode()) as ProviderResponse;
      })()]);
      const message = provider.choices?.[0]?.message;
      if (!message) throw new Error("Invalid read-only discussion response");
      observeProviderOutput(observer, !!reply, resumed, message, provider.usage);
      return message;
    } finally { controller.signal.removeEventListener("abort", cancel); cancel(); }
  };
  try {
    let message = await complete();
    if (hasToolCalls(message.tool_calls)) {
      observeAnalysis(observer, { stage: "tool-request", reason: "model-requested-tool", input: message.tool_calls });
      if (kind !== "lots") { observeAnalysis(observer, { stage: "tool-rejection", reason: "history-tools-disabled" }); throw new Error("History discussion cannot call tools"); }
      let call: Record<string, unknown>;
      try {
        if (!Array.isArray(message.tool_calls) || message.tool_calls.length !== 1) throw new Error();
        const parsed = record(message.tool_calls[0]), fn = record(parsed?.function);
        if (!parsed || Object.keys(parsed).some(key => !["id", "type", "function", "index"].includes(key)) || (parsed.index !== undefined && (!Number.isInteger(parsed.index) || (parsed.index as number) < 0)) || typeof parsed.id !== "string" || parsed.id.length < 1 || parsed.id.length > 128 || parsed.type !== "function" || !fn || Object.keys(fn).length !== 2 || fn.name !== "evaluate_lot_scenarios" || typeof fn.arguments !== "string" || new TextEncoder().encode(fn.arguments).byteLength > 16 * 1024) throw new Error();
        const args = record(JSON.parse(fn.arguments));
        if (!args || Object.keys(args).join() !== "scenarios" || !Array.isArray(args.scenarios) || args.scenarios.length < 1 || args.scenarios.length > 4) throw new Error();
        observeAnalysis(observer, { stage: "tool-admission", reason: "allowed-read-only-tool", input: { name: fn.name, arguments: args } });
        requestedScenarios = args.scenarios.map(value => {
          const scenario = record(value);
          if (!scenario || Object.keys(scenario).sort().join() !== "date,ivShift,spot") throw new Error();
          return calculateLotScenarioComparison(captured as LotDiscussionFacts, scenario as LotScenario);
        });
        call = parsed;
      } catch { observeAnalysis(observer, { stage: "tool-rejection", reason: "invalid-tool-input-or-calculation" }); throw new Error("Invalid lot scenario tool request"); }
      observeAnalysis(observer, { stage: "tool-result", reason: "deterministic-calculation", output: requestedScenarios });
      if (controller.signal.aborted || Date.now() - startedAt >= PROVIDER_TIMEOUT_MS) throw new Error("Provider timed out");
      clearTimeout(timeout!);
      timeout = setTimeout(expire!, Math.max(0, SCENARIO_TOOL_TIMEOUT_MS - (Date.now() - startedAt)));
      toolMessages = [
        { role: "assistant", content: message.content ?? null, tool_calls: message.tool_calls, ...(message.reasoning_details !== undefined ? { reasoning_details: message.reasoning_details } : {}) },
        { role: "tool", tool_call_id: call.id, content: JSON.stringify(requestedScenarios) },
      ];
      message = await complete(undefined, true);
    }
    if (hasToolCalls(message.tool_calls)) observeAnalysis(observer, { stage: "tool-rejection", reason: "tool-budget-exhausted" });
    if (hasToolCalls(message.tool_calls) || typeof message.content !== "string") throw new Error("Invalid read-only discussion response");
    const raw = record(parseDraftJson(message.content));
    if (!raw || Object.keys(raw).sort().join() !== "assumptions,objections,suggested_prompts,text" || typeof raw.text !== "string" || !raw.text.trim() || !["assumptions", "objections", "suggested_prompts"].every(key => Array.isArray(raw[key]) && (raw[key] as unknown[]).every(item => typeof item === "string"))) throw new Error("Invalid lot discussion reply");
    const reply = raw as LotDiscussionReply;
    observeAnalysis(observer, { stage: "proposal-check", reason: "read-only-schema-accepted", output: reply });
    verification = true; reason = "provider_error";
    const checked = await complete(reply);
    if (hasToolCalls(checked.tool_calls) || typeof checked.content !== "string") throw new Error("Invalid lot discussion verification response");
    const verdict = record(JSON.parse(checked.content));
    if (verdict && Object.keys(verdict).length === 1 && verdict.valid === false) reason = "rejected";
    if (!verdict || Object.keys(verdict).length !== 1 || verdict.valid !== true) throw new Error("Lot discussion verification rejected");
    observeAnalysis(observer, { stage: "completion", reason: "verified-reply-accepted" });
    return { reply, requestedScenarios };
  } catch (error) {
    observeAnalysis(observer, { stage: "completion", reason: verification ? reason === "rejected" ? "verification-rejected" : "verification-failed" : "generation-or-tool-failed" });
    if (verification) throw new AnalysisVerificationError("Lot discussion could not be verified.", controller.signal.aborted ? "timeout" : reason);
    throw error;
  } finally { clearTimeout(timeout!); }
}

export class InvalidProposalError extends Error {}
export class AnalysisVerificationError extends Error {
  readonly reason: "timeout" | "rejected" | "invalid_output" | "provider_error";
  constructor(message = "Analysis could not be verified.", reason: AnalysisVerificationError["reason"] = "provider_error") {
    super(message);
    this.reason = reason;
  }
}

const VERIFICATION_SCHEMA = {
  name: "analysis_verification", strict: true,
  schema: { type: "object", additionalProperties: false, properties: { valid: { type: "boolean" } }, required: ["valid"] },
};
const BOUND_KINDS = ["loss-cap", "sampled-loss", "no-supplied-exact-bound", "mathematical-nonexistence"];
const BOUND_SUBJECTS = ["current", "other", "unclear"];
const BOUND_VERIFICATION_SCHEMA = {
  ...VERIFICATION_SCHEMA,
  schema: { type: "object", additionalProperties: false, required: ["valid", "passages"], properties: {
    valid: { type: "boolean" }, passages: { type: "array", items: { type: "object", additionalProperties: false, required: ["id", "claims"], properties: {
      id: { type: "string" }, claims: { type: "array", items: { type: "object", additionalProperties: false, required: ["quote", "kind", "subject", "conditional"], properties: {
        quote: { type: "string" }, kind: { type: "string", enum: BOUND_KINDS }, subject: { type: "string", enum: BOUND_SUBJECTS }, conditional: { type: "boolean" },
      } } },
    } } },
  } },
};

export function currentBoundVeto(passages: Array<{ id: string; text: string }>, value: unknown): boolean {
  const result = record(value);
  if (!result || Object.keys(result).sort().join() !== "passages,valid" || typeof result.valid !== "boolean" || !Array.isArray(result.passages) || result.passages.length !== passages.length) throw new Error("Invalid bound projection");
  const seen = new Set<string>();
  let veto = false;
  for (const raw of result.passages) {
    const item = record(raw);
    const source = passages.find(p => p.id === item?.id);
    if (!item || !source || seen.has(source.id) || Object.keys(item).sort().join() !== "claims,id" || !Array.isArray(item.claims)) throw new Error("Invalid bound passage");
    seen.add(source.id);
    for (const rawClaim of item.claims) {
      const claim = record(rawClaim);
      if (!claim || Object.keys(claim).sort().join() !== "conditional,kind,quote,subject" || typeof claim.quote !== "string" || !claim.quote.trim() || !source.text.includes(claim.quote) || typeof claim.kind !== "string" || !BOUND_KINDS.includes(claim.kind) || typeof claim.subject !== "string" || !BOUND_SUBJECTS.includes(claim.subject) || typeof claim.conditional !== "boolean") throw new Error("Invalid bound claim");
      if (claim.subject === "current" && ["loss-cap", "mathematical-nonexistence"].includes(String(claim.kind))) veto = true;
    }
  }
  return veto;
}
const FIRST_EXPIRY_TOOL = { type: "function", function: {
  name: "analyze_first_expiry",
  description: "Read-only numerical minimum/maximum P/L intervals over an explicit finite spot range at first expiry. Uses the unchanged current position/model/IV, $1 search tolerance and at most 256 spot evaluations. Not certified pricing-error bounds, lifetime risk or breakevens. No orders or workspace changes.",
  parameters: { type: "object", additionalProperties: false, required: ["min", "max"], properties: { min: { type: "number", minimum: 0, maximum: 1_000_000 }, max: { type: "number", exclusiveMinimum: 0, maximum: 1_000_000 } } },
} };
const SCENARIO_TOOLS = [{ type: "function", function: {
  name: "evaluate_scenarios",
  description: "Read-only pricing of 1-4 hypothetical scenarios for the unchanged current position. Date must be full UTC from valuation through first expiry. ivShift is the total additive decimal shift to every leg's stored IV (0.05 means +5 percentage points). Optional legIvShifts adds an extra decimal shift for specified current leg IDs. No orders or workspace changes.",
  parameters: { type: "object", additionalProperties: false, required: ["scenarios"], properties: {
    scenarios: { type: "array", minItems: 1, maxItems: 4, items: { type: "object", additionalProperties: false, required: ["scenarioDate", "scenarioSpot", "ivShift"], properties: {
      scenarioDate: { type: "string", format: "date-time" }, scenarioSpot: { type: "number", exclusiveMinimum: 0, maximum: 1_000_000 }, ivShift: { type: "number", minimum: -10, maximum: 10 },
      legIvShifts: { type: "array", maxItems: 4, items: { type: "object", additionalProperties: false, required: ["legId", "ivShift"], properties: { legId: { type: "string" }, ivShift: { type: "number", minimum: -10, maximum: 10 } } } },
    } } },
  } },
} }];
const POSITION_COMPARISON_TOOL = { type: "function", function: {
  name: "compare_position", description: "Read-only comparison of additional shares, excluded legs or an alternative quoted contract. Pair replaceLegId with replacementContractId from the snapshot. Replacement uses new quoted entry, not roll economics. Existing long shares retain weighted basis. No orders, closing proceeds, realized P/L or workspace changes; a nonzero stock holding may remain without options. Negative existing stock is unsupported.",
  parameters: { type: "object", additionalProperties: false, properties: { additionalShares: { type: "integer", minimum: 1 }, purchasePrice: { type: "number", minimum: 0 }, removeLegIds: { type: "array", maxItems: 4, items: { type: "string" } }, replaceLegId: { type: "string" }, replacementContractId: { type: "string" }, scenarioSpot: { type: "number", exclusiveMinimum: 0, maximum: 1000000 }, scenarioDate: { type: "string" }, ivShift: { type: "number", minimum: -10, maximum: 10, description: "Total additive global IV shift in decimal units for BOTH positions; 0.05 means +5 percentage points. Replaces, not adds to, the captured global shift; expiry shifts remain." } } },
} };

const CANDIDATE_TOOL = { type: "function", function: {
  name: "search_candidates",
  description: "Read-only search for NEW quoted long-option, same-expiry long straddle/strangle, vertical, 1:2:1 butterfly and iron butterfly/condor alternatives in both directions. Requires explicit target spot/date and dollar loss budget. Does not adjust held positions or place orders. Fee allowance is a total dollar estimate per candidate. Current window only; searches over 300,000 structures require a narrower window. expiry-probability ranks snapshot-to-expiry risk-neutral profit probability, not a forecast.",
  parameters: { type: "object", additionalProperties: false, required: ["targetSpot", "targetDate", "maxLoss", "feeAllowance", "basis", "objective"], properties: {
    targetSpot: { type: "number", exclusiveMinimum: 0, maximum: 1_000_000 }, targetDate: { type: "string", format: "date-time" },
    maxLoss: { type: "number", exclusiveMinimum: 0 }, feeAllowance: { type: "number", minimum: 0 },
    basis: { type: "string", enum: ["mid", "natural"] }, objective: { type: "string", enum: ["target-pnl", "return-on-risk", "expiry-probability"] },
  } },
} };

const LEG_SCHEMA = {
  type: "object",
  properties: {
    id: { type: "string" },
    contractId: { type: "string" },
    side: { type: "string", enum: ["long", "short"] },
    type: { type: "string", enum: ["call", "put"] },
    contracts: { type: "integer", minimum: 1 },
    strike: { type: "number", exclusiveMinimum: 0 },
    expiry: { type: "string" },
    entryPrice: { type: "number", minimum: 0 },
    iv: { type: "number", exclusiveMinimum: 0 },
    multiplier: { type: "number", enum: [100] },
  },
  required: [
    "id",
    "contractId",
    "side",
    "type",
    "contracts",
    "strike",
    "expiry",
    "entryPrice",
    "iv",
    "multiplier",
  ],
  additionalProperties: false,
} as const;

export const RESPONSE_SCHEMA = {
  name: "argus_sparring_reply",
  strict: true,
  schema: {
    type: "object",
    properties: {
      text: { type: "string", maxLength: 1_500 },
      risk_classification: { type: "string", enum: ["bounded", "unbounded", "not-exact"] },
      evidence_ids: { type: "array", items: { type: "string", maxLength: 80 }, maxItems: 8 },
      assumptions: {
        type: "array",
        items: { type: "string", maxLength: 300 },
        maxItems: 5,
      },
      objections: {
        type: "array",
        items: { type: "string", maxLength: 300 },
        maxItems: 5,
      },
      operations: {
        type: "array",
        maxItems: 6,
        items: {
          anyOf: [
            { type: "object", properties: { kind: { type: "string", enum: ["set_contracts"] }, leg_id: { type: "string" }, contracts: { type: "integer", minimum: 1, maximum: 9007199254740991 } }, required: ["kind", "leg_id", "contracts"], additionalProperties: false },
            { type: "object", properties: { kind: { type: "string", enum: ["set_cost_allowance"] }, feeAllowance: { type: "number", minimum: 0 } }, required: ["kind", "feeAllowance"], additionalProperties: false },
            {
              type: "object",
              properties: { kind: { type: "string", enum: ["set_stock"] }, stock: { type: "object", properties: { shares: { type: "integer", minimum: -9007199254740991, maximum: 9007199254740991 }, entryPrice: { type: "number", minimum: 0 } }, required: ["shares", "entryPrice"], additionalProperties: false } },
              required: ["kind", "stock"], additionalProperties: false,
            },
            { type: "object", properties: { kind: { type: "string", enum: ["remove_stock"] } }, required: ["kind"], additionalProperties: false },
            {
              type: "object",
              properties: {
                kind: { type: "string", enum: ["replace_with_template"] },
                template_id: { type: "string" },
              },
              required: ["kind", "template_id"],
              additionalProperties: false,
            },
            {
              type: "object",
              properties: {
                kind: { type: "string", enum: ["add_leg"] },
                leg: LEG_SCHEMA,
              },
              required: ["kind", "leg"],
              additionalProperties: false,
            },
            {
              type: "object",
              properties: {
                kind: { type: "string", enum: ["remove_leg"] },
                leg_id: { type: "string" },
              },
              required: ["kind", "leg_id"],
              additionalProperties: false,
            },
            {
              type: "object",
              properties: {
                kind: { type: "string", enum: ["update_leg"] },
                leg_id: { type: "string" },
                leg: LEG_SCHEMA,
              },
              required: ["kind", "leg_id", "leg"],
              additionalProperties: false,
            },
            {
              type: "object",
              properties: {
                kind: { type: "string", enum: ["set_scenario"] },
                scenario: {
                  type: "object",
                  properties: {
                    scenarioDate: { type: "string" },
                    scenarioSpot: { type: "number", exclusiveMinimum: 0 },
                    ivShift: { type: "number" },
                  },
                  required: ["scenarioDate", "scenarioSpot", "ivShift"],
                  additionalProperties: false,
                },
              },
              required: ["kind", "scenario"],
              additionalProperties: false,
            },
            {
              type: "object", additionalProperties: false,
              properties: { kind: { type: "string", enum: ["set_expiry_iv"] }, expiry: { type: "string", format: "date-time" }, ivShift: { type: "number", minimum: -10, maximum: 10 } },
              required: ["kind", "expiry", "ivShift"],
            },
          ],
        },
      },
      suggested_prompts: {
        type: "array",
        items: { type: "string", maxLength: 160 },
        maxItems: 4,
      },
    },
    required: [
      "text",
      "assumptions",
      "objections",
      "operations",
      "suggested_prompts",
      "risk_classification",
      "evidence_ids",
    ],
    additionalProperties: false,
  },
} as const;


function isAmericanPreview(state: StrategyState, chartContext?: SparringRequest["chart_context"]) {
  return chartContext?.valuationModel === "american-crr-1024-v1" && state.valuationModel !== "american-crr-1024-v1";
}

export function strategyFacts(state: StrategyState, snapshot?: MarketSnapshot, chartContext?: SparringRequest["chart_context"], probabilityRange?: SparringRequest["probability_range"]) {
  const range = chartContext?.range;
  const metrics = calculateStrategy(state);
  const displayBasis = chartContext?.pnlDisplay ? pnlDisplayBasis(state, chartContext.pnlDisplay) : null;
  const preview = isAmericanPreview(state, chartContext);
  const modelDescription = state.valuationModel === "american-crr-1024-v1" ? "American 1024-step CRR" : "European-model";
  const longShares = Math.max(state.stock?.shares ?? 0, 0);
  const shortCallDeliverableShares = state.legs.filter(leg => leg.side === "short" && leg.type === "call").reduce((total, leg) => total + leg.contracts * leg.multiplier, 0);
  const remainingUncommittedLongShares = Math.max(longShares - shortCallDeliverableShares, 0);
  const lossClassification = metrics.mode === "first-expiry" ? "not-exact" : metrics.maxLoss === null ? "unbounded" : "bounded";
  const boundaries = [...new Set([...state.legs.map((leg) => leg.strike), ...metrics.breakevens])].sort((a, b) => a - b);
  const checkpoints = [...boundaries, ...boundaries.slice(1).map((value, index) => (value + boundaries[index]) / 2)].sort((a, b) => a - b);
  return {
    dataMode: state.pricing?.mode === "market" ? "market-snapshot" : "normalized-sample",
    valuationModel: state.valuationModel ?? "european-bsm-v1",
    operationalReference: structuredClone(operationalReference),
    conditionalAssignment: calculateConditionalAssignment(state, snapshot),
    contractTerms: contractTermsFacts(snapshot),
    historicalQuotes: state.pricing?.historical === true,
    captureProvenance: snapshot?.captureSource ? { source: snapshot.captureSource, capturedAt: snapshot.retrievedAt, underlying: snapshot.spotSourceTimes, contracts: snapshot.contracts.map(contract => ({ contractId: contract.contractId, sourceTimes: contract.sourceTimes })) } : null,
    quoteValuation: snapshot ? quoteValuation(state, snapshot) : null,
    metrics,
    expirationProbability: expirationProbability(state, probabilityRange),
    shareOnlyCoverage: {
      longShares, shortCallDeliverableShares, remainingUncommittedLongShares,
      uncoveredCallShares: Math.max(shortCallDeliverableShares - longShares, 0),
      additionalFullyShareCoveredContracts: Math.floor(remainingUncommittedLongShares / 100),
      basis: "Share-only coverage across all short calls, not overall risk or margin. Long options can offset risk; expiries can differ. Use total payoff bounds for overall risk. Standard contracts require 100 shares each; fractional contracts are unavailable.",
    },
    scenario: scenarioFacts(state),
    requestedScenarios: [] as RequestedScenario[],
    candidateSearch: null as ReturnType<typeof searchCandidates> | null,
    firstExpiryRange: null as ReturnType<typeof firstExpiryRange> | null,
    positionComparison: null as PositionComparison | null,
    chartInspection: chartContext ? {
      ...(range ? { range: { ...range } } : {}),
      ...(chartContext.pnlDisplay ? { pnlDisplay: displayBasis ? { mode: chartContext.pnlDisplay, ...displayBasis } : null } : {}),
      valuationModel: chartContext.valuationModel ?? state.valuationModel ?? "european-bsm-v1",
      legVolatilities: state.legs.map(leg => ({ legId: leg.id, iv: effectiveIv(state, leg) })),
      view: chartContext.view, metric: chartContext.metric, date: state.scenarioDate, spot: state.scenarioSpot, ivShift: state.ivShift,
      ...(state.expiryIvShifts ? { expiryIvShifts: structuredClone(state.expiryIvShifts) } : {}),
      spotAttribution: chartContext.view === "table" ? scenarioSpotAttribution(state, range) : null,
      assumptions: metrics.mode === "spot" ? "Share-price scenarios using signed shares and held entry cost, less the supplied allowance once. No option expiry or IV sensitivity; dividends, financing and borrow are excluded. These are hypothetical prices, not forecasts or execution prices." : preview ? `American 1024-step CRR: seven hypothetical spot checkpoints${range ? " evenly spaced across the selected price range" : ""} at the selected date and effective per-leg IV, continuous rate/yield. Not the full time surface, execution prices, probabilities or exact global bounds. Read-only comparison; canonical metrics and probabilities remain European. No discrete dividends or assignment cashflows.` : `${modelDescription}: ${chartContext.view === "table" ? `Complete displayed scenario-table rows at the selected date, IV, rate and yield, ${range ? "within the selected price range; exact quote spot, target and strikes are included only when in range" : "including exact quote spot, target and strikes"}. P/L and Greeks are position totals, not forecasts or probabilities. Discrete rows do not establish between-row extrema.` : `Seven hypothetical spot checkpoints${range ? " evenly spaced across the selected price range" : ""} at fixed selected date, IV, rate and yield; not probabilities, forecasts or full chart data. Sparse points do not establish universal interval or exact threshold claims. The heatmap also spans dates not sampled here.`}`,
      points: chartContext.view === "table" ? scenarioTable(state, range) : (range ? Array.from({ length: 7 }, (_, index) => index === 6 ? range.max : range.min + (range.max - range.min) * index / 6) : [0.9, 0.95, 0.999, 1, 1.001, 1.05, 1.1].map(factor => state.scenarioSpot * factor)).map(spot => {
        return { spot, ...(preview ? americanScenario({ ...state, scenarioSpot: spot }) : evaluateScenario({ ...state, scenarioSpot: spot })) };
      }),
    } : null,
    expirationCheckpoints: metrics.mode === "expiration" ? checkpoints.map((spot) => ({ sampleSpot: spot, pnl: payoffSeries(state, spot, spot + 1, 1)[0].pnl })) : [],
    lossClassification,
    profitClassification: metrics.mode === "first-expiry" ? "not-exact" : metrics.maxProfit === null ? "unbounded" : "bounded",
    valuationTimestamp: state.valuationTimestamp,
    greekScenario: { date: state.scenarioDate, spot: state.scenarioSpot, ivShift: state.ivShift, ...(state.expiryIvShifts ? { expiryIvShifts: state.expiryIvShifts } : {}) },
    greekUnits: "Position totals, NOT per share: delta USD P/L per $1 spot move; gamma change in position delta per $1 spot move; theta USD/calendar day; vega USD/volatility percentage point; rho USD/rate percentage point. All local sensitivities at greekScenario, not constant daily forecasts.",
    limitations: metrics.mode === "spot" ? "No option expiry. Signed-share P/L uses held entry cost and the supplied allowance once. Excludes slippage, taxes, dividends, financing and borrow; underlying marks are not guaranteed execution prices." : `Intact-position expiration payoff after any supplied flat cost allowance, before unmodeled slippage, taxes and assignment/exercise cashflows. No discrete dividends, stock dividend, financing or borrow cashflows. Pre-expiry ${modelDescription} estimates; mixed-expiry strategies show only a modeled first-expiry range; exact global extrema are not calculated by this engine. ${state.pricing ? "Timestamped option quotes and underlying marks are not guaranteed execution prices." : "No live option chain or execution prices."}`,
    riskSummary: metrics.mode === "first-expiry"
      ? `Mixed-expiry strategy: exact global maximum loss and profit are not calculated by this engine. A missing result does not establish mathematical nonexistence or unbounded risk. The displayed range is modeled at first expiry only. Separate conditionalTail facts identify the model-specific upper-price asymptote (${metrics.conditionalTail?.outcome}); a finite tail does not establish complete risk bounds. Neither the tail nor the sampled range represents lifetime or assignment risk.`
      : `${state.pricing ? "Estimated" : "Sample"} ${metrics.mode === "spot" ? "Share-price loss" : "expiration loss"}: ${metrics.maxLoss === null ? "unbounded" : `bounded at $${metrics.maxLoss.toFixed(2)}`}. Profit: ${metrics.maxProfit === null ? "unbounded" : `bounded at $${metrics.maxProfit.toFixed(2)}`}. Assumes position remains intact; after any supplied flat cost allowance, before unmodeled costs and assignment effects.`,
  };
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function parseDraftJson(content: string): unknown {
  const fenced = /^\s*```json\r?\n([\s\S]*?)\r?\n```\s*$/.exec(content);
  return JSON.parse(fenced ? fenced[1] : content);
}

function strings(value: unknown, maxItems: number, maxLength: number): string[] | null {
  if (
    !Array.isArray(value) ||
    value.length > maxItems ||
    value.some((item) => typeof item !== "string" || item.length > maxLength)
  ) {
    return null;
  }
  return value as string[];
}

function leg(value: unknown): OptionLeg | null {
  const item = record(value);
  if (
    !item ||
    Object.keys(item).length !== LEG_SCHEMA.required.length ||
    typeof item.id !== "string" ||
    typeof item.contractId !== "string" ||
    (item.side !== "long" && item.side !== "short") ||
    (item.type !== "call" && item.type !== "put") ||
    !Number.isInteger(item.contracts) ||
    (item.contracts as number) < 1 ||
    typeof item.strike !== "number" ||
    !Number.isFinite(item.strike) ||
    item.strike <= 0 ||
    typeof item.expiry !== "string" ||
    typeof item.entryPrice !== "number" ||
    !Number.isFinite(item.entryPrice) ||
    item.entryPrice < 0 ||
    typeof item.iv !== "number" ||
    !Number.isFinite(item.iv) ||
    item.iv <= 0 ||
    item.multiplier !== 100
  ) {
    return null;
  }
  return item as unknown as OptionLeg;
}

function parseOperation(value: unknown): Operation | null {
  const item = record(value);
  if (!item || typeof item.kind !== "string") return null;
  if (item.kind === "set_expiry_iv") return Object.keys(item).length === 3 && typeof item.expiry === "string" && typeof item.ivShift === "number" && Number.isFinite(item.ivShift) && Math.abs(item.ivShift) <= 10 ? { kind: "set_expiry_iv", expiry: item.expiry, ivShift: item.ivShift } : null;
  if (item.kind === "set_contracts") return Object.keys(item).length === 3 && typeof item.leg_id === "string" && Number.isSafeInteger(item.contracts) && (item.contracts as number) > 0 ? { kind: "set_contracts", leg_id: item.leg_id, contracts: item.contracts as number } : null;
  if (item.kind === "set_cost_allowance") return Object.keys(item).length === 2 && typeof item.feeAllowance === "number" && Number.isFinite(item.feeAllowance) && item.feeAllowance >= 0 ? { kind: "set_cost_allowance", feeAllowance: item.feeAllowance } : null;
  if (item.kind === "remove_stock") return Object.keys(item).length === 1 ? { kind: "remove_stock" } : null;
  if (item.kind === "set_stock") {
    const stock = record(item.stock);
    return Object.keys(item).length === 2 && stock && Object.keys(stock).length === 2 && Number.isSafeInteger(stock.shares) && stock.shares !== 0 && typeof stock.entryPrice === "number" && Number.isFinite(stock.entryPrice) && stock.entryPrice >= 0
      ? { kind: "set_stock", stock: { shares: stock.shares as number, entryPrice: stock.entryPrice } } : null;
  }
  if (item.kind === "replace_with_template" && Object.keys(item).length === 2 && typeof item.template_id === "string") {
    return { kind: item.kind, template_id: item.template_id };
  }
  if (item.kind === "add_leg" && Object.keys(item).length === 2) {
    const parsedLeg = leg(item.leg);
    return parsedLeg ? { kind: item.kind, leg: parsedLeg } : null;
  }
  if (item.kind === "remove_leg" && Object.keys(item).length === 2 && typeof item.leg_id === "string") {
    return { kind: item.kind, leg_id: item.leg_id };
  }
  if (item.kind === "update_leg" && Object.keys(item).length === 3 && typeof item.leg_id === "string") {
    const parsedLeg = leg(item.leg);
    return parsedLeg ? { kind: item.kind, leg_id: item.leg_id, leg: parsedLeg } : null;
  }
  if (item.kind === "set_scenario") {
    const scenario = record(item.scenario);
    if (
      scenario &&
      Object.keys(item).length === 2 &&
      !Object.keys(scenario).some(key => !["scenarioDate", "scenarioSpot", "ivShift", "expiryIvShifts"].includes(key)) &&
      (scenario.expiryIvShifts === undefined || (Array.isArray(scenario.expiryIvShifts) && scenario.expiryIvShifts.length <= 2 && scenario.expiryIvShifts.every(raw => { const shift = record(raw); return shift && Object.keys(shift).length === 2 && typeof shift.expiry === "string" && typeof shift.ivShift === "number" && Number.isFinite(shift.ivShift) && Math.abs(shift.ivShift) <= 10; }))) &&
      typeof scenario.scenarioDate === "string" &&
      typeof scenario.scenarioSpot === "number" &&
      Number.isFinite(scenario.scenarioSpot) &&
      typeof scenario.ivShift === "number" &&
      Number.isFinite(scenario.ivShift)
    ) {
      return {
        kind: item.kind,
        scenario: {
          scenarioDate: scenario.scenarioDate,
          scenarioSpot: scenario.scenarioSpot,
          ivShift: scenario.ivShift,
          ...(scenario.expiryIvShifts !== undefined ? { expiryIvShifts: scenario.expiryIvShifts as NonNullable<StrategyState["expiryIvShifts"]> } : {}),
        },
      };
    }
  }
  return null;
}

function readFirstExpiryBounds(value: unknown): { min: number; max: number } | null {
  const bounds = record(value);
  return bounds && Object.keys(bounds).sort().join() === "max,min" && typeof bounds.min === "number" && typeof bounds.max === "number" && Number.isFinite(bounds.min) && Number.isFinite(bounds.max) && bounds.min >= 0 && bounds.max > bounds.min && bounds.max <= 1_000_000 ? { min: bounds.min, max: bounds.max } : null;
}

export function parseSparringRequest(value: unknown): SparringRequest | null {
  const item = record(value);
  if (
    !item ||
    typeof item.request_id !== "string" ||
    item.request_id.length < 1 ||
    item.request_id.length > 128 ||
    !Number.isInteger(item.base_state_version) ||
    !Array.isArray(item.conversation) ||
    item.conversation.length < 1 ||
    item.conversation.length > MAX_MESSAGES
  ) {
    return null;
  }
  const conversation: ConversationMessage[] = [];
  let characters = 0;
  for (const raw of item.conversation) {
    const message = record(raw);
    if (
      !message ||
      (message.role !== "user" && message.role !== "assistant") ||
      typeof message.content !== "string" ||
      message.content.length < 1
    ) {
      return null;
    }
    characters += message.content.length;
    conversation.push({ role: message.role, content: message.content });
  }
  if (
    characters > MAX_CONVERSATION_CHARS ||
    conversation.at(-1)?.role !== "user" ||
    !record(item.state)
  ) {
    return null;
  }
  const state = item.state as unknown as StrategyState;
  if (state.version !== item.base_state_version || validateStrategy(state).length > 0) {
    return null;
  }
  const chartContext = record(item.chart_context);
  const probabilityRange = record(item.probability_range);
  const firstExpiryBounds = readFirstExpiryBounds(item.first_expiry_range);
  if (item.first_expiry_range !== undefined && (!firstExpiryBounds || isAmericanPreview(state, item.chart_context as SparringRequest["chart_context"]))) return null;
  if (item.probability_range !== undefined && (!probabilityRange || Object.keys(probabilityRange).length !== 2 || typeof probabilityRange.lower !== "number" || typeof probabilityRange.upper !== "number" || !Number.isFinite(probabilityRange.lower) || !Number.isFinite(probabilityRange.upper) || probabilityRange.lower <= 0 || probabilityRange.upper <= probabilityRange.lower)) return null;
  if (item.chart_context !== undefined && (!chartContext || Object.keys(chartContext).some(key => !["view", "metric", "valuationModel", "pnlDisplay", "range"].includes(key)) || (chartContext.range !== undefined && !isChartRange(chartContext.range)) || !["curve", "heatmap", "table"].includes(chartContext.view as string) || !["pnl", "delta", "gamma", "theta", "vega", "rho"].includes(chartContext.metric as string) || (chartContext.view !== "curve" && chartContext.metric !== "pnl") || (chartContext.valuationModel !== undefined && (chartContext.valuationModel !== "american-crr-1024-v1" || chartContext.view !== "heatmap")) || (chartContext.pnlDisplay !== undefined && (!["pnl", "position-value", "risk-percent"].includes(chartContext.pnlDisplay as string) || chartContext.metric !== "pnl" || !pnlDisplayBasis(state, chartContext.pnlDisplay as PnlDisplayMode))))) return null;
  return {
    request_id: item.request_id,
    base_state_version: item.base_state_version as number,
    state,
    conversation,
    ...(chartContext ? { chart_context: { view: chartContext.view, metric: chartContext.metric, ...(chartContext.valuationModel ? { valuationModel: chartContext.valuationModel } : {}), ...(chartContext.pnlDisplay ? { pnlDisplay: chartContext.pnlDisplay } : {}), ...(isChartRange(chartContext.range) ? { range: { min: chartContext.range.min, max: chartContext.range.max } } : {}) } as SparringRequest["chart_context"] } : {}),
    ...(probabilityRange ? { probability_range: { lower: probabilityRange.lower as number, upper: probabilityRange.upper as number } } : {}),
    ...(firstExpiryBounds ? { first_expiry_range: firstExpiryBounds } : {}),
  };
}

function parseReply(value: unknown): SparringReply | null {
  const item = record(value);
  const assumptions = strings(item?.assumptions, 5, 300);
  const objections = strings(item?.objections, 5, 300);
  const suggested = strings(item?.suggested_prompts, 4, 160);
  const evidenceIds = strings(item?.evidence_ids, 8, 80);
  if (
    !item ||
    Object.keys(item).length !== RESPONSE_SCHEMA.schema.required.length ||
    typeof item.text !== "string" ||
    item.text.length > 1_500 ||
    !assumptions ||
    !objections ||
    !suggested ||
    !evidenceIds ||
    typeof item.risk_classification !== "string" ||
    !["bounded", "unbounded", "not-exact"].includes(item.risk_classification) ||
    !Array.isArray(item.operations) ||
    item.operations.length > 6
  ) {
    return null;
  }
  const operations = item.operations.map(parseOperation);
  if (operations.some((operation) => operation === null)) return null;
  return {
    text: item.text,
    assumptions,
    objections,
    operations: operations as Operation[],
    suggested_prompts: suggested,
    risk_classification: item.risk_classification as SparringReply["risk_classification"],
    evidence_ids: evidenceIds,
  };
}

function applyOperations(state: StrategyState, operations: Operation[], snapshot?: MarketSnapshot): StrategyState {
  let next = structuredClone(state);
  let explicitExpiryShifts = false;
  for (const operation of operations) {
    if (operation.kind === "replace_with_template") {
      if (!TEMPLATES.some((template) => template.id === operation.template_id)) {
        throw new Error("Unknown strategy template");
      }
      const replacement = snapshot ? createMarketStrategy(operation.template_id as TemplateId, snapshot, state.pricing!.basis) : createStrategy(operation.template_id as TemplateId);
      next = { ...replacement, id: state.id, version: state.version, valuationModel: state.valuationModel ?? "european-bsm-v1" };
    } else if (operation.kind === "set_expiry_iv") {
      if (!next.legs.some(leg => leg.expiry === operation.expiry)) throw new Error("Unknown expiry");
      next.expiryIvShifts = [...(next.expiryIvShifts ?? []).filter(shift => shift.expiry !== operation.expiry), ...(operation.ivShift === 0 ? [] : [{ expiry: operation.expiry, ivShift: operation.ivShift }])];
      explicitExpiryShifts = true;
    } else if (operation.kind === "set_contracts") {
      const leg = next.legs.find(item => item.id === operation.leg_id);
      if (!leg) throw new Error("Unknown leg");
      leg.contracts = operation.contracts;
    } else if (operation.kind === "set_cost_allowance") {
      next.feeAllowance = operation.feeAllowance;
    } else if (operation.kind === "set_stock") {
      next.stock = { ...operation.stock };
    } else if (operation.kind === "remove_stock") {
      if (!next.stock) throw new Error("No stock holding to remove");
      delete next.stock;
    } else if (operation.kind === "add_leg") {
      next.legs.push(operation.leg);
    } else if (operation.kind === "remove_leg") {
      const originalLength = next.legs.length;
      next.legs = next.legs.filter((item) => item.id !== operation.leg_id);
      if (next.legs.length === originalLength) throw new Error("Unknown leg");
    } else if (operation.kind === "update_leg") {
      const index = next.legs.findIndex((item) => item.id === operation.leg_id);
      if (index < 0 || operation.leg.id !== operation.leg_id) throw new Error("Unknown leg");
      next.legs[index] = operation.leg;
    } else {
      Object.assign(next, operation.scenario);
      if (operation.scenario.expiryIvShifts !== undefined) explicitExpiryShifts = true;
    }
  }
  next.version = state.version + 1;
  if (snapshot) {
    next.legs = next.legs.map((item) => {
      const contract = snapshot.contracts.find((contract) => contract.contractId === item.contractId);
      if (!contract) throw new Error("Proposed contract is outside the quote snapshot");
      const prior = next.pricing?.entryMode === "fixed" ? state.legs.find(leg => leg.contractId === item.contractId && leg.side === item.side) : undefined;
      return marketLeg(contract, item.side, item.contracts, item.id, next.pricing!.basis, prior);
    });
  }
  if (!explicitExpiryShifts) next = pruneExpiryIvShifts(next);
  const errors = validateStrategy(next);
  if (snapshot) errors.push(...validateMarketStrategy(next, snapshot));
  if (errors.length > 0) throw new Error(errors.join("; "));
  return next;
}

function hasToolCalls(value: unknown): boolean {
  return value !== undefined && value !== null && (!Array.isArray(value) || value.length > 0);
}

function comparePosition(state: StrategyState, value: unknown, snapshot?: MarketSnapshot): PositionComparison {
  const args = record(value);
  if (!args || Object.keys(args).some(key => !["additionalShares", "purchasePrice", "removeLegIds", "replaceLegId", "replacementContractId", "scenarioSpot", "scenarioDate", "ivShift"].includes(key)) || (state.stock?.shares ?? 0) < 0) throw new Error("Invalid position comparison");
  if (args.scenarioSpot !== undefined && (typeof args.scenarioSpot !== "number" || !Number.isFinite(args.scenarioSpot) || args.scenarioSpot <= 0 || args.scenarioSpot > 1_000_000)) throw new Error("Invalid comparison spot");
  if (args.scenarioDate !== undefined && (typeof args.scenarioDate !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(args.scenarioDate) || !Number.isFinite(Date.parse(args.scenarioDate)) || new Date(args.scenarioDate).toISOString() !== args.scenarioDate)) throw new Error("Invalid comparison date");
  if (args.ivShift !== undefined && (typeof args.ivShift !== "number" || !Number.isFinite(args.ivShift) || Math.abs(args.ivShift) > 10)) throw new Error("Invalid comparison IV shift");
  state = { ...structuredClone(state), ...(args.scenarioSpot !== undefined ? { scenarioSpot: args.scenarioSpot as number } : {}), ...(args.scenarioDate !== undefined ? { scenarioDate: args.scenarioDate as string } : {}), ...(args.ivShift !== undefined ? { ivShift: args.ivShift as number } : {}) };
  if (validateStrategy(state).length || (snapshot && validateMarketStrategy(state, snapshot).length)) throw new Error("Unsupported comparison baseline");
  const baseline = { state: structuredClone(state), metrics: calculateStrategy(state) };
  const replacing = args.replaceLegId !== undefined || args.replacementContractId !== undefined;
  const buying = args.additionalShares !== undefined || args.purchasePrice !== undefined;
  if (buying && (!Number.isSafeInteger(args.additionalShares) || (args.additionalShares as number) <= 0 || typeof args.purchasePrice !== "number" || !Number.isFinite(args.purchasePrice) || args.purchasePrice < 0)) throw new Error("Invalid share purchase");
  const removedLegIds = args.removeLegIds === undefined ? [] : args.removeLegIds;
  if (!Array.isArray(removedLegIds) || removedLegIds.length > 4 || new Set(removedLegIds).size !== removedLegIds.length || removedLegIds.some(id => typeof id !== "string" || !state.legs.some(leg => leg.id === id)) || (!buying && !replacing && !removedLegIds.length)) throw new Error("Invalid excluded legs");
  let next = structuredClone(state);
  let replacement: PositionComparison["replacement"];
  if (replacing) {
    const old = state.legs.find(leg => leg.id === args.replaceLegId);
    const contract = snapshot?.contracts.find(contract => contract.contractId === args.replacementContractId);
    if (typeof args.replaceLegId !== "string" || typeof args.replacementContractId !== "string" || !snapshot || !state.pricing || validateMarketStrategy(state, snapshot).length || !old || !contract || removedLegIds.includes(old.id) || state.legs.some(leg => leg.contractId === contract.contractId)) throw new Error("Invalid alternative contract");
    const leg = marketLeg(contract, old.side, old.contracts, old.id, state.pricing.basis);
    next.legs = next.legs.map(item => item.id === old.id ? leg : item);
    replacement = { legId: old.id, previousContractId: old.contractId, contractId: contract.contractId, entryPrice: leg.entryPrice, basis: state.pricing.basis, bid: contract.bid, ask: contract.ask, quoteAsOf: contract.quoteAsOf };
  }
  const additionalShareCost = buying ? (args.additionalShares as number) * (args.purchasePrice as number) : 0;
  if (buying) {
    const shares = (state.stock?.shares ?? 0) + (args.additionalShares as number);
    next.stock = { shares, entryPrice: ((state.stock ? state.stock.shares * state.stock.entryPrice : 0) + additionalShareCost) / shares };
  }
  next.legs = next.legs.filter(leg => !removedLegIds.includes(leg.id));
  next = pruneExpiryIvShifts(next);
  if (!Number.isFinite(additionalShareCost) || validateStrategy(next).length || (snapshot && validateMarketStrategy(next, snapshot).length)) throw new Error("Unsupported position comparison");
  const metrics = calculateStrategy(next);
  return { state: next, metrics, baseline, ...(replacement ? { replacement } : {}), lossClassification: metrics.mode === "first-expiry" ? "not-exact" : metrics.maxLoss === null ? "unbounded" : "bounded", profitClassification: metrics.mode === "first-expiry" ? "not-exact" : metrics.maxProfit === null ? "unbounded" : "bounded", additionalShareCost, removedLegIds: [...removedLegIds], assumptions: "Hypothetical position comparison, not a trade or workspace proposal. Added shares use the supplied hypothetical purchase price and weighted existing long-share basis. Retained option entry prices, base IV and fees remain unchanged. Both sides use the same requested spot, date and total global IV shift; the global shift replaces, not adds to, the captured shift. Matching expiry shifts remain additive; removed expiries are pruned. Excluded legs and their entry cashflows are omitted, not closed: no exit proceeds, realized P/L, assignment or financing cashflows. Additional share cost is capital spent, not maximum loss. Mixed-expiry extrema remain sampled, not exact." + (replacement ? " The replacement is an alternative position with a new dated quote entry estimate and quote IV; the original leg cost is omitted. This is not roll economics: no close proceeds or realized P/L." : "") };
}

function evaluateRequestedScenarios(state: StrategyState, value: unknown, snapshot?: MarketSnapshot): RequestedScenario[] {
  const args = record(value);
  if (!args || Object.keys(args).length !== 1 || !Array.isArray(args.scenarios) || args.scenarios.length < 1 || args.scenarios.length > 4) throw new Error("Invalid scenario tool request");
  const current = evaluateScenario(state);
  return args.scenarios.map((value, index) => {
    const item = record(value);
    if (!item || Object.keys(item).some(key => !["scenarioDate", "scenarioSpot", "ivShift", "legIvShifts"].includes(key)) || typeof item.scenarioDate !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/.test(item.scenarioDate) || !Number.isFinite(Date.parse(item.scenarioDate)) || new Date(item.scenarioDate).toISOString() !== (item.scenarioDate.includes(".") ? item.scenarioDate : item.scenarioDate.replace("Z", ".000Z")) || typeof item.scenarioSpot !== "number" || !Number.isFinite(item.scenarioSpot) || item.scenarioSpot <= 0 || item.scenarioSpot > 1_000_000 || typeof item.ivShift !== "number" || !Number.isFinite(item.ivShift) || Math.abs(item.ivShift) > 10) throw new Error("Invalid scenario tool request");
    const legIvShifts: Array<{ legId: string; ivShift: number }> = [];
    if (item.legIvShifts !== undefined) {
      if (!Array.isArray(item.legIvShifts) || item.legIvShifts.length > 4) throw new Error("Invalid scenario tool request");
      for (const raw of item.legIvShifts) {
        const shift = record(raw);
        if (!shift || Object.keys(shift).length !== 2 || typeof shift.legId !== "string" || !state.legs.some(leg => leg.id === shift.legId) || legIvShifts.some(leg => leg.legId === shift.legId) || typeof shift.ivShift !== "number" || !Number.isFinite(shift.ivShift) || Math.abs(shift.ivShift) > 10) throw new Error("Invalid scenario tool request");
        legIvShifts.push({ legId: shift.legId, ivShift: shift.ivShift });
      }
    }
    const scenario = { scenarioDate: item.scenarioDate, scenarioSpot: item.scenarioSpot, ivShift: item.ivShift, ...(item.legIvShifts !== undefined ? { legIvShifts } : {}) };
    const coordinates = { ...state, scenarioDate: scenario.scenarioDate, scenarioSpot: scenario.scenarioSpot };
    if (validateStrategy(coordinates).length || (snapshot && validateMarketStrategy(coordinates, snapshot).length)) throw new Error("Invalid scenario tool request");
    const legVolatilities = state.legs.map(leg => {
      const legShift = legIvShifts.find(shift => shift.legId === leg.id)?.ivShift ?? 0;
      const expiryShift = (state.expiryIvShifts ?? []).find(shift => shift.expiry === leg.expiry)?.ivShift ?? 0;
      return { legId: leg.id, expiry: leg.expiry, strike: leg.strike, type: leg.type, side: leg.side, baseIv: leg.iv, globalShift: scenario.ivShift, ...(state.expiryIvShifts?.length ? { expiryShift } : {}), legShift, modeledIv: effectiveIv({ ...state, ivShift: scenario.ivShift }, leg) + legShift };
    });
    if (legVolatilities.some(leg => !Number.isFinite(leg.modeledIv) || leg.modeledIv <= 0)) throw new Error("Invalid scenario tool request");
    const legs = state.legs.map((leg, index) => ({ ...leg, iv: legVolatilities[index].modeledIv }));
    const next = { ...coordinates, legs, ivShift: 0, expiryIvShifts: [] };
    const metrics = evaluateScenario(next);
    const changesFromCurrent = Object.fromEntries((Object.keys(metrics) as Array<keyof typeof metrics>).map(field => [field, Number((metrics[field] - current[field]).toFixed(8))])) as typeof metrics;
    const isolatedChanges = {
      spot: Number((evaluateScenario({ ...state, scenarioSpot: scenario.scenarioSpot }).pnl - current.pnl).toFixed(8)),
      date: Number((evaluateScenario({ ...state, scenarioDate: scenario.scenarioDate }).pnl - current.pnl).toFixed(8)),
      iv: Number((evaluateScenario({ ...state, legs, ivShift: 0, expiryIvShifts: [] }).pnl - current.pnl).toFixed(8)),
    };
    const pnlComparison = {
      baseline: { scenarioDate: state.scenarioDate, scenarioSpot: state.scenarioSpot, ivShift: state.ivShift, ...(state.expiryIvShifts ? { expiryIvShifts: structuredClone(state.expiryIvShifts) } : {}) },
      baselinePnl: current.pnl, isolatedChanges,
      interactionResidual: Number((changesFromCurrent.pnl - isolatedChanges.spot - isolatedChanges.date - isolatedChanges.iv).toFixed(8)),
    };
    if (![...Object.values(metrics), ...Object.values(changesFromCurrent), ...Object.values(isolatedChanges), pnlComparison.baselinePnl, pnlComparison.interactionResidual].every(Number.isFinite)) throw new Error("Invalid scenario tool request");
    return { id: `scenario-${index + 1}`, scenario, legVolatilities, metrics, changesFromCurrent, pnlComparison, assumptions: `Hypothetical ${state.valuationModel === "american-crr-1024-v1" ? "American 1024-step CRR" : "European-model"} repricing; position legs, quantities, entry costs, rate, yield and quote snapshot unchanged. Modeled IV = stored leg IV + total global ivShift + existing expiry shift + optional legIvShifts adjustment, each once as additive decimals. IV-only uses the complete target vector; spot/date comparisons retain baseline global and expiry IV shifts. Changes compare the selected current scenario, not realized returns; no probabilities, fills or workspace changes.` };
  });
}

export async function spar(
  request: SparringRequest,
  apiKey: string,
  providerFetch: ProviderFetch = fetch,
  marketContext: MarketContext = { retrievedAt: new Date().toISOString(), sources: [] },
  snapshot?: MarketSnapshot,
  bundle: AnalysisPrompts = defaultAnalysisPrompts,
  observer?: AnalysisObserver,
): Promise<SparringSuccess> {
  const { prompts } = readAnalysisPrompts(bundle);
  const startedAt = Date.now();
  const preview = isAmericanPreview(request.state, request.chart_context);
  const firstExpiryBounds = readFirstExpiryBounds(request.first_expiry_range);
  if (request.first_expiry_range !== undefined && (!firstExpiryBounds || preview)) throw new Error("Invalid explicit first-expiry analysis");
  if (request.state.pricing && (!snapshot || validateMarketStrategy(request.state, snapshot).length)) throw new Error("A verified market snapshot is required");
  const calculated = strategyFacts(request.state, snapshot, request.chart_context, request.probability_range);
  if (firstExpiryBounds) calculated.firstExpiryRange = firstExpiryRange(request.state, { ...firstExpiryBounds, tolerance: 1, maxEvaluations: 256 });
  observeAnalysis(observer, { stage: "facts", reason: "validated-position", input: { state: request.state, chart_context: request.chart_context, probability_range: request.probability_range, first_expiry_range: request.first_expiry_range }, output: calculated });
  const candidateAvailable = () => !!snapshot && !snapshot.historical && [snapshot.retrievedAt, snapshot.spotAsOf, ...snapshot.contracts.map(c => c.quoteAsOf)].every(value => { const time = Date.parse(value); return Number.isFinite(time) && time <= Date.now() && Date.now() - time <= 300_000; });
  const controller = new AbortController();
  let verificationReason: AnalysisVerificationError["reason"] = "provider_error";
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let expire: () => void;
  const deadline = new Promise<never>((_, reject) => {
    expire = () => { controller.abort(); reject(new Error("Provider timed out")); };
    timeout = setTimeout(expire, Math.max(0, PROVIDER_TIMEOUT_MS - (Date.now() - startedAt)));
  });
  let toolMessages: Array<Record<string, unknown>> = [];
  let draftMessages: Array<Record<string, unknown>> | undefined;
  let boundPassages: Array<{ id: string; text: string }> | undefined;
  const complete = async (verification?: unknown, resumed = false): Promise<ProviderResponse> => {
    if (Date.now() - startedAt >= (toolMessages.length ? SCENARIO_TOOL_TIMEOUT_MS : PROVIDER_TIMEOUT_MS)) throw new Error("Provider timed out");
    const selectingTool = !verification && !preview && !firstExpiryBounds && !toolMessages.length;
    const response = await Promise.race([deadline, providerFetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://github.com/wibo/argus",
        "X-Title": "ARGUS",
      },
      body: observedBody(observer, !!verification, resumed, {
        model: MODEL,
        stream: false,
        max_tokens: MAX_OUTPUT_TOKENS,
        reasoning: { effort: verification ? "low" : "medium", exclude: true },
        messages: verification ? [{ role: "system", content: prompts.VERIFICATION_PROMPT + (boundPassages ? `\n${prompts.BOUND_VERIFICATION_PROMPT}` : "") }, { role: "user", content: JSON.stringify(verification) }] : [
          ...(draftMessages ??= [
          { role: "system", content: prompts.SYSTEM_PROMPT },
          {
            role: "user",
            content: JSON.stringify({
              strategy: request.state,
              ...(selectingTool ? { reply_schema: RESPONSE_SCHEMA.schema } : {}),
              calculated,
              available_templates: TEMPLATES.map(({ id, name }) => ({ id, name })),
              option_snapshot: snapshot ?? null,
              market_context: {
                retrievedAt: marketContext.retrievedAt,
                evidence: marketContext.sources.filter((source) => source.status === "available" && source.asOf !== null),
                gaps: marketContext.sources.filter((source) => source.status !== "available" || source.asOf === null).map((source) => ({ provider: source.provider, reason: source.reason ?? source.summary })),
              },
              conversation: request.conversation,
            }),
          },
          ]),
          ...toolMessages,
        ],
        ...(selectingTool ? { tools: [...SCENARIO_TOOLS, POSITION_COMPARISON_TOOL, FIRST_EXPIRY_TOOL, ...(candidateAvailable() ? [CANDIDATE_TOOL] : [])], tool_choice: "auto" } : { response_format: { type: "json_schema", json_schema: verification ? boundPassages ? BOUND_VERIFICATION_SCHEMA : VERIFICATION_SCHEMA : RESPONSE_SCHEMA } }),
        provider: {
          allow_fallbacks: false,
          data_collection: "deny",
          require_parameters: true,
        },
      }),
      signal: controller.signal,
    })]);
    if (!response.ok) { observeAnalysis(observer, { stage: verification ? "verification-output" : "generation-output", reason: "http-error", output: { status: response.status } }); await Promise.race([deadline, response.body?.cancel()]); throw new Error(`Provider returned ${response.status}`); }
    if (!response.body) {
      if (verification) verificationReason = "invalid_output";
      throw new Error("Missing provider body");
    }
    const reader = response.body.getReader();
    const cancel = () => { void reader.cancel().catch(() => {}); };
    controller.signal.addEventListener("abort", cancel, { once: true });
    try {
      return await Promise.race([deadline, (async () => {
        let size = 0;
        let body = "";
        const decoder = new TextDecoder();
        for (;;) {
          const chunk = await reader.read();
          if (chunk.done) break;
          size += chunk.value.byteLength;
          if (size > 64 * 1024) {
            if (verification) verificationReason = "invalid_output";
            throw new Error("Oversized provider response");
          }
          body += decoder.decode(chunk.value, { stream: true });
        }
        if (verification) verificationReason = "invalid_output";
        const parsed = JSON.parse(body + decoder.decode()) as ProviderResponse;
        observeProviderOutput(observer, !!verification, resumed, parsed.choices?.[0]?.message, parsed.usage);
        return parsed;
      })()]);
    } finally {
      controller.signal.removeEventListener("abort", cancel);
      cancel();
    }
  };
  try {
    let provider = await complete();
    const message = provider.choices?.[0]?.message;
    if (message && hasToolCalls(message.tool_calls)) {
      observeAnalysis(observer, { stage: "tool-request", reason: "model-requested-tool", input: message.tool_calls });
      if (firstExpiryBounds) { observeAnalysis(observer, { stage: "tool-rejection", reason: "explicit-analysis-tools-disabled" }); throw new Error("Explicit first-expiry analysis does not allow tool selection"); }
      if (preview) { observeAnalysis(observer, { stage: "tool-rejection", reason: "preview-tools-disabled" }); throw new Error("American preview does not support additional scenario tools"); }
      let call: Record<string, unknown>;
      try {
        if (!Array.isArray(message.tool_calls) || message.tool_calls.length !== 1) throw new Error();
        const parsed = record(message.tool_calls[0]);
        const fn = record(parsed?.function);
        if (!parsed || Object.keys(parsed).some(key => !["id", "type", "function", "index"].includes(key)) || (parsed.index !== undefined && (!Number.isInteger(parsed.index) || (parsed.index as number) < 0)) || typeof parsed.id !== "string" || parsed.id.length < 1 || parsed.id.length > 128 || parsed.type !== "function" || !fn || Object.keys(fn).length !== 2 || !["evaluate_scenarios", "search_candidates", "compare_position", "analyze_first_expiry"].includes(String(fn.name)) || typeof fn.arguments !== "string" || new TextEncoder().encode(fn.arguments).byteLength > 16 * 1024) throw new Error();
        observeAnalysis(observer, { stage: "tool-admission", reason: "allowed-read-only-tool", input: { name: fn.name, arguments: JSON.parse(fn.arguments) } });
        if (fn.name === "search_candidates") {
          if (!snapshot || !candidateAvailable()) throw new Error("Fresh candidate quotes required");
          calculated.candidateSearch = searchCandidates(request.state, snapshot, JSON.parse(fn.arguments));
        } else if (fn.name === "analyze_first_expiry") {
          const bounds = readFirstExpiryBounds(JSON.parse(fn.arguments));
          if (!bounds) throw new Error();
          calculated.firstExpiryRange = firstExpiryRange(request.state, { min: bounds.min, max: bounds.max, tolerance: 1, maxEvaluations: 256 });
        } else if (fn.name === "compare_position") calculated.positionComparison = comparePosition(request.state, JSON.parse(fn.arguments), snapshot);
        else calculated.requestedScenarios = evaluateRequestedScenarios(request.state, JSON.parse(fn.arguments), snapshot);
        call = parsed;
      } catch (error) {
        observeAnalysis(observer, { stage: "tool-rejection", reason: error instanceof CandidateSearchLimitError ? "candidate-search-limit" : "invalid-tool-input-or-calculation" });
        if (error instanceof CandidateSearchLimitError) throw error;
        throw new Error("Invalid scenario tool request");
      }
      observeAnalysis(observer, { stage: "tool-result", reason: "deterministic-calculation", output: calculated.firstExpiryRange ?? calculated.positionComparison ?? calculated.candidateSearch ?? calculated.requestedScenarios });
      if (controller.signal.aborted || Date.now() - startedAt >= PROVIDER_TIMEOUT_MS) throw new Error("Provider timed out");
      clearTimeout(timeout);
      timeout = setTimeout(expire!, Math.max(0, SCENARIO_TOOL_TIMEOUT_MS - (Date.now() - startedAt)));
      toolMessages = [
        { role: "assistant", content: message.content ?? null, tool_calls: message.tool_calls, ...(message.reasoning_details !== undefined ? { reasoning_details: message.reasoning_details } : {}) },
        { role: "tool", tool_call_id: call.id, content: JSON.stringify(calculated.firstExpiryRange ?? calculated.positionComparison ?? calculated.candidateSearch ?? calculated.requestedScenarios) },
      ];
      provider = await complete(undefined, true);
      if (hasToolCalls(provider.choices?.[0]?.message?.tool_calls)) { observeAnalysis(observer, { stage: "tool-rejection", reason: "tool-budget-exhausted" }); throw new Error("Scenario tool limit reached"); }
    }
    const content = provider.choices?.[0]?.message?.content;
    if (typeof content !== "string") throw new Error("Provider response is missing content");
    const reply = parseReply(parseDraftJson(content));
    if (!reply) { observeAnalysis(observer, { stage: "proposal-check", reason: "reply-schema-rejected" }); throw new Error("Provider response failed schema validation"); }
    observeAnalysis(observer, { stage: "proposal-check", reason: "checking-deterministic-constraints", input: reply });
    if (calculated.candidateSearch && reply.operations.length) { observeAnalysis(observer, { stage: "proposal-check", reason: "read-only-operations-rejected" }); throw new InvalidProposalError("Candidate search is read-only; inspect an alternative before changing the workspace."); }
    if (calculated.positionComparison && reply.operations.length) { observeAnalysis(observer, { stage: "proposal-check", reason: "read-only-operations-rejected" }); throw new InvalidProposalError("Position comparison is read-only; no workspace changes are permitted."); }
    if (calculated.firstExpiryRange && reply.operations.length) { observeAnalysis(observer, { stage: "proposal-check", reason: "read-only-operations-rejected" }); throw new InvalidProposalError("First-expiry analysis is read-only; no workspace changes are permitted."); }
    if (preview && reply.operations.length) { observeAnalysis(observer, { stage: "proposal-check", reason: "read-only-operations-rejected" }); throw new InvalidProposalError("American preview is read-only; return to European valuation before changing the position."); }
    const prose = [reply.text, ...reply.assumptions, ...reply.objections, ...reply.suggested_prompts].join("\n");
    const inlineCitations = [...new Set([...prose.matchAll(/\[([a-z][a-z0-9-]*(?:,\s*[a-z][a-z0-9-]*)*)\]/gi)].flatMap((match) => match[1].split(/,\s*/)))];
    if (reply.risk_classification !== calculated.lossClassification || [...reply.evidence_ids, ...inlineCitations].some((id) => !marketContext.sources.some((source) => source.id === id && source.status === "available" && source.asOf !== null))) {
      observeAnalysis(observer, { stage: "proposal-check", reason: "risk-or-evidence-rejected" });
      throw new Error("Provider response contradicts calculated risk or cites unavailable evidence");
    }
    reply.evidence_ids = inlineCitations;
    let next: StrategyState;
    try {
      next = applyOperations(request.state, reply.operations, snapshot);
    } catch (error) {
      observeAnalysis(observer, { stage: "proposal-check", reason: "operations-rejected" });
      throw new InvalidProposalError(error instanceof Error ? error.message : "Invalid proposal");
    }
    observeAnalysis(observer, { stage: "proposal-check", reason: "deterministic-constraints-accepted", output: { operations: reply.operations, next_state: next } });
    try {
      if (calculated.lossClassification === "not-exact" && !reply.operations.length && !calculated.positionComparison && !calculated.candidateSearch && !preview) {
        const segmenter = new Intl.Segmenter("en", { granularity: "sentence" });
        boundPassages = [reply.text, ...reply.assumptions, ...reply.objections, ...reply.suggested_prompts].flatMap(text => text.split("\n").flatMap(line => [...segmenter.segment(line)].map(part => part.segment)).filter(text => text.trim())).map((text, index) => ({ id: `p${index}`, text }));
      }
      const verified = await complete({ strategy: request.state, conversation: request.conversation, calculated, proposed_state: next, proposed: preview ? calculated : strategyFacts(next, snapshot, request.chart_context, request.probability_range), reply, market_context: marketContext, option_snapshot: snapshot ?? null, ...(boundPassages ? { bound_passages: boundPassages } : {}) });
      verificationReason = "invalid_output";
      if (hasToolCalls(verified.choices?.[0]?.message?.tool_calls)) throw new Error("Unexpected verification tool call");
      const content = verified.choices?.[0]?.message?.content;
      const verdict = typeof content === "string" ? JSON.parse(content) : null;
      const veto = boundPassages ? currentBoundVeto(boundPassages, verdict) : false;
      const validShape = verdict && typeof verdict === "object" && !Array.isArray(verdict) && Object.keys(verdict).length === (boundPassages ? 2 : 1);
      if (validShape && (verdict.valid === false || veto)) verificationReason = "rejected";
      if (!validShape || verdict.valid !== true || veto) throw new Error("Verification rejected");
    } catch { observeAnalysis(observer, { stage: "completion", reason: verificationReason === "rejected" ? "verification-rejected" : "verification-failed" }); throw new AnalysisVerificationError("Analysis could not be verified.", controller.signal.aborted ? "timeout" : verificationReason); }
    observeAnalysis(observer, { stage: "completion", reason: "verified-reply-accepted" });
    return {
      request_id: request.request_id,
      base_state_version: request.base_state_version,
      reply,
      next_state: next,
      metrics: calculateStrategy(next),
      calculated,
      market_context: marketContext,
    };
  } catch (error) {
    if (!(error instanceof AnalysisVerificationError)) observeAnalysis(observer, { stage: "completion", reason: error instanceof InvalidProposalError ? "proposal-rejected" : "generation-or-tool-failed" });
    throw error;
  } finally { clearTimeout(timeout); }
}
