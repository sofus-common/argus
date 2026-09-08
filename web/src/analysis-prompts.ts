import configured from "../prompts/analysis-v13.json" with { type: "json" };

const keys = ["SYSTEM_PROMPT","VERIFICATION_PROMPT","BOUND_VERIFICATION_PROMPT","LOT_DISCUSSION_PROMPT","LOT_VERIFICATION_PROMPT","HISTORY_DISCUSSION_PROMPT","HISTORY_VERIFICATION_PROMPT","INTRADAY_DISCUSSION_PROMPT","INTRADAY_VERIFICATION_PROMPT"] as const;
const ivKeys = ["IV_DISCUSSION_PROMPT", "IV_VERIFICATION_PROMPT"] as const;
const performanceKeys = ["PERFORMANCE_DISCUSSION_PROMPT", "PERFORMANCE_VERIFICATION_PROMPT"] as const;
export type AnalysisPrompts = Readonly<{ version: string; prompts: Readonly<Record<typeof keys[number], string> & Partial<Record<typeof ivKeys[number] | typeof performanceKeys[number], string>>> }>;

export function readAnalysisPrompts(value: unknown): AnalysisPrompts {
  const invalid = () => { throw new Error("Invalid analysis prompt bundle"); };
  if (!value || typeof value !== "object" || Array.isArray(value)) return invalid();
  const bundle = value as Record<string, unknown>;
  if (Object.keys(bundle).sort().join() !== "prompts,version" || typeof bundle.version !== "string" || !/^[A-Za-z0-9._-]{1,64}$/.test(bundle.version)
    || !bundle.prompts || typeof bundle.prompts !== "object" || Array.isArray(bundle.prompts)) return invalid();
  const raw = bundle.prompts as Record<string, unknown>, encoder = new TextEncoder();
  const selectedKeys = [...keys, ...(ivKeys.some(key => Object.hasOwn(raw, key)) ? ivKeys : []), ...(performanceKeys.some(key => Object.hasOwn(raw, key)) ? performanceKeys : [])];
  if (Object.keys(raw).length !== selectedKeys.length || Object.keys(raw).some(key => !selectedKeys.includes(key as typeof selectedKeys[number]))) return invalid();
  const prompts = {} as Record<typeof keys[number], string> & Partial<Record<typeof ivKeys[number] | typeof performanceKeys[number], string>>;
  for (const key of selectedKeys) {
    const text = raw[key];
    if (typeof text !== "string" || !text.trim() || encoder.encode(text).byteLength > 64 * 1024) return invalid();
    prompts[key] = text;
  }
  const parsed = { version: bundle.version, prompts: Object.freeze(prompts) };
  if (encoder.encode(JSON.stringify(parsed)).byteLength > 128 * 1024) return invalid();
  return Object.freeze(parsed);
}

export const defaultAnalysisPrompts = readAnalysisPrompts(configured);
