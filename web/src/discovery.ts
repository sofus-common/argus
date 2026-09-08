import { CANDIDATE_OPTION_FAMILIES, type CandidateSearchDomain, type searchCandidates } from './options';

type Evidence = { message: number; quote: string };
const fields = ['targetSpot', 'targetDate', 'maxLoss', 'feeAllowance', 'basis', 'objective', 'maxEntryOutlay'] as const;
type Field = typeof fields[number];
export type RawDiscoveryIntent = { scope: 'search' | 'unclear' | 'unsupported'; families: Evidence[] | null } & Record<Field, Evidence | null>;
export type DiscoveryIntent = {
  scope: RawDiscoveryIntent['scope']; evidence: RawDiscoveryIntent;
  families: CandidateSearchDomain['families'] | null;
  targetSpot: number | null; targetDate: string | null; maxLoss: number | null; feeAllowance: number | null;
  basis: 'mid' | 'natural' | null; objective: 'target-pnl' | 'return-on-risk' | 'expiry-probability' | null; maxEntryOutlay: number | null;
};
const evidenceSchema = { type: 'object', additionalProperties: false, required: ['message', 'quote'], properties: { message: { type: 'integer', minimum: 0, maximum: 39 }, quote: { type: 'string', minLength: 1, maxLength: 256 } } };
export const DISCOVERY_INTENT_SCHEMA = {
  name: 'discovery_intent', strict: true, schema: {
    type: 'object', additionalProperties: false, required: ['scope', 'families', ...fields], properties: {
      scope: { type: 'string', enum: ['search', 'unclear', 'unsupported'] },
      families: { anyOf: [{ type: 'array', minItems: 1, maxItems: 24, items: evidenceSchema }, { type: 'null' }] },
      ...Object.fromEntries(fields.map(field => [field, { anyOf: [evidenceSchema, { type: 'null' }] }])),
    },
  },
};
const number = '(\\$?(?:[0-9]{1,3}(?:,[0-9]{3})+|[0-9]+)(?:\\.[0-9]+)?)(?:\\s+USD)?';
const link = '\\s*(?:(?:is|of|at)\\s+|[:=]\\s*)?';
const patterns: Record<Field, string> = {
  targetSpot: `(?:target spot|target [A-Z][A-Z0-9.]{0,9} at)${link}${number}`,
  targetDate: '(?:on\\s+|target date\\s*(?:is\\s+|[:=]\\s*))(\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z)',
  maxLoss: `(?:maximum loss|max loss)${link}${number}`,
  feeAllowance: `(?:total fee allowance|fee allowance)${link}${number}`,
  maxEntryOutlay: `(?:maximum net entry outlay|net entry outlay|max entry outlay)${link}${number}`,
  basis: '(?:(?:basis\\s+)?(natural|mid)(?: quote pricing)?)',
  objective: '(?:rank by )?(target P/L|target-pnl|return on risk|return-on-risk|expiry probability|expiry-probability)',
};
const families = [...CANDIDATE_OPTION_FAMILIES, 'options', 'covered-call', 'protective-put', 'collar', 'call-calendar', 'put-calendar', 'call-diagonal', 'put-diagonal'] as CandidateSearchDomain['families'];
const aliases = new Map<string, CandidateSearchDomain['families'][number]>();
for (const family of families) {
  const spaced = family.replaceAll('-', ' ');
  for (const alias of [family, spaced, spaced.endsWith('y') ? `${spaced.slice(0, -1)}ies` : `${spaced}s`, ...(/^(bull|bear)-(call|put)$/.test(family) ? [`${spaced} spread`, `${spaced} spreads`] : []), ...(family === 'iron-condor' ? ['standard iron condor', 'standard iron condors'] : [])]) aliases.set(alias, family);
}
function parsed(field: Field, quote: string, underlying: string): number | string | null {
  const match = new RegExp(`^${patterns[field]}$`, 'i').exec(quote);
  if (!match) return null;
  const namedTarget = field === 'targetSpot' ? /^target ([A-Z][A-Z0-9.]{0,9}) at\b/i.exec(quote)?.[1] : undefined;
  if (namedTarget && namedTarget.toUpperCase() !== underlying && namedTarget.toLowerCase() !== 'spot') return null;
  const value = match[1];
  if (field === 'targetDate') return Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value ? value : null;
  if (field === 'basis') return value.toLowerCase();
  if (field === 'objective') return ({ 'target p/l': 'target-pnl', 'return on risk': 'return-on-risk', 'expiry probability': 'expiry-probability' } as Record<string, string>)[value.toLowerCase()] ?? value.toLowerCase();
  const amount = Number(value.replace(/[$,]/g, ''));
  return Number.isFinite(amount) && amount >= 0 && amount <= (field === 'targetSpot' ? 1_000_000 : 1_000_000_000) && (!['targetSpot', 'maxLoss'].includes(field) || amount > 0) ? amount : null;
}
function boundary(text: string, index: number, quote: string, numeric = false) {
  const before = text.slice(0, index), after = text.slice(index + quote.length);
  if (numeric && !/^\s*(?:$|[.!?;,](?!\d)|(?:on|and|with)\b)/i.test(after)) return false;
  if (numeric && /(?:\b[A-Z]{3}|[\p{Sc}])\s*$/u.test(before)) return false;
  return !/[\w$-]$/.test(before) && !/^[\w%+*/-]/.test(after) && !/^\s*(?:[+*/%]|million\b|thousand\b|hundred\b|(?:to|or)\s+\$?\d|(?:EUR|GBP|percent)\b|per\s+(?:leg|contract|share))/i.test(after) && !/^[.,]\d/.test(after) && !/\b(?:not|never|ignore|without|instead of|rather than|don't)\b[^.!?;,\n]*$/i.test(before);
}
export function parseDiscoveryIntent(raw: unknown, conversation: ReadonlyArray<{ role: string; content: string }>, underlying: string): DiscoveryIntent | null {
  if (typeof underlying !== 'string' || !/^[A-Z][A-Z0-9.]{0,9}$/.test(underlying) || !raw || typeof raw !== 'object' || Array.isArray(raw) || Object.keys(raw).sort().join() !== ['scope', 'families', ...fields].sort().join() || !Array.isArray(conversation) || conversation.length > 40) return null;
  const input = raw as RawDiscoveryIntent;
  if (!['search', 'unclear', 'unsupported'].includes(input.scope)) return null;
  const bound = (value: Evidence | null): boolean => value === null || !!value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).sort().join() === 'message,quote' && Number.isInteger(value.message) && value.message >= 0 && value.message < conversation.length && conversation[value.message]?.role === 'user' && typeof value.quote === 'string' && value.quote.length > 0 && value.quote.length <= 256 && typeof conversation[value.message].content === 'string' && conversation[value.message].content.includes(value.quote);
  if (fields.some(field => !bound(input[field])) || input.families !== null && (!Array.isArray(input.families) || !input.families.length || input.families.length > 24 || input.families.some(item => item === null || !bound(item)))) return null;
  const result: DiscoveryIntent = { scope: input.scope, evidence: structuredClone(input), families: null, targetSpot: null, targetDate: null, maxLoss: null, feeAllowance: null, basis: null, objective: null, maxEntryOutlay: null };
  for (const field of fields) {
    const item = input[field];
    if (!item) continue;
    const content = conversation[item.message].content, index = content.indexOf(item.quote);
    const numeric = !['targetDate', 'basis', 'objective'].includes(field);
    const value = boundary(content, index, item.quote, numeric) ? parsed(field, item.quote, underlying) : null;
    if (value === null) continue;
    const competing = conversation.filter(message => message.role === 'user').flatMap(message => [...message.content.matchAll(new RegExp(patterns[field], 'gi'))].map(match => boundary(message.content, match.index!, match[0], numeric) ? parsed(field, match[0], underlying) : null));
    if (competing.some(other => other !== value)) continue;
    Object.assign(result, { [field]: value });
  }
  if (input.families) {
    const selected = input.families.map(item => {
      const content = conversation[item.message].content, index = content.indexOf(item.quote);
      return boundary(content, index, item.quote) && !/(?:inverse|short|broken wing|not)\s+$/i.test(content.slice(0, index)) ? aliases.get(item.quote.toLowerCase()) : undefined;
    });
    const familyPattern = new RegExp(`\\b(?:${[...aliases.keys()].filter(alias => !['options', 'optionss'].includes(alias)).sort((a, b) => b.length - a.length).join('|')})\\b`, 'gi');
    const mentioned = conversation.filter(message => message.role === 'user').flatMap(message => [...message.content.matchAll(familyPattern)].map(match => aliases.get(match[0].toLowerCase())));
    if (selected.every((family): family is CandidateSearchDomain['families'][number] => !!family) && new Set(selected).size === selected.length && mentioned.every(family => !!family && selected.includes(family))) result.families = selected;
  }
  return result;
}
export function renderDiscovery(intent: DiscoveryIntent, search: ReturnType<typeof searchCandidates> | null) {
  const reply = { text: '', assumptions: [] as string[], objections: [] as string[], suggested_prompts: [] as string[] };
  if (intent.scope !== 'search') return { ...reply, text: 'Please specify a supported new strategy search and explicit target, risk, fees, pricing basis, ranking and net entry outlay. This mode does not place orders or adjust held positions.' };
  const questions: string[] = [];
  if (intent.families === null) questions.push('Which supported strategy family should I search? For a butterfly, choose call-butterfly, put-butterfly, short-call-butterfly, short-put-butterfly, iron-butterfly or inverse-iron-butterfly.');
  const missing: Record<Field, string> = {
    targetSpot: 'Provide the target spot, for example: target spot is $103.', targetDate: 'Provide the target date as an exact UTC timestamp, for example: target date is 2027-10-09T20:00:00.000Z.',
    maxLoss: 'Provide the positive maximum loss, for example: maximum loss is $2000.', feeAllowance: 'Provide the total fee allowance, including explicit zero, for example: total fee allowance $0.',
    basis: 'Choose natural quote pricing or mid quote pricing.', objective: 'Choose rank by target P/L, rank by return on risk or rank by expiry probability.',
    maxEntryOutlay: 'What maximum net entry outlay should I use? Provide a labeled amount, for example: net entry outlay is $1500; explicit zero is allowed.',
  };
  for (const field of fields) if (intent[field] === null) questions.push(missing[field]);
  if (questions.length) return { ...reply, text: questions.join('\n'), assumptions: ['Only explicit supported user evidence is retained. Missing, conflicting or unsupported constraints are not guessed; no search or position change occurred.'] };
  if (!search) return { ...reply, text: 'No validated search result is available. Your position is unchanged.' };
  if (fields.filter(field => field !== 'maxEntryOutlay').some(field => search.request[field as keyof typeof search.request] !== intent[field]) || search.domain?.maxEntryOutlay !== intent.maxEntryOutlay || JSON.stringify(search.domain.families) !== JSON.stringify(intent.families)) throw new Error('Discovery result does not match the validated intent');
  const money = (value: number) => `USD ${value.toFixed(2)}`;
  const lines = [`${search.candidates.length} ranked candidates from ${search.evaluated} evaluated structures (${search.eligible} eligible), ranked by ${search.request.objective}. Target ${search.request.targetSpot} on ${search.request.targetDate}.`];
  for (const [index, candidate] of search.candidates.entries()) {
    const metrics = candidate.metrics;
    const legs = candidate.state.legs.map(leg => `${leg.side} ${leg.contracts} ${leg.type} ${leg.strike} exp ${leg.expiry}`).join('; ');
    const risk = candidate.lossBound ? `conservative first-expiry loss bound ${money(candidate.lossBound.amount)} at ${candidate.lossBound.date}; not an attained maximum or lifetime cap` : `intact-expiry maximum loss ${metrics.maxLoss === null ? 'unbounded in this model' : money(metrics.maxLoss)}; maximum profit ${metrics.maxProfit === null ? 'unbounded in this model' : money(metrics.maxProfit)}`;
    lines.push(`${index + 1}. ${candidate.state.stock ? `${candidate.state.stock.shares} long shares; ` : ''}${legs}. Conditional target P/L ${money(metrics.scenarioPnl)}; net entry cashflow after allowance ${money(metrics.entryAccounting.netEntryCashFlowAfterAllowance)} (positive received, negative paid); ${risk}. ${candidate.probability.probability === null ? 'Mixed-expiry probability unavailable.' : `Model probability of positive intact-expiry P/L ${(candidate.probability.probability * 100).toFixed(2)}% at ${candidate.probability.expiry}.`}`);
  }
  lines.push('Your position is unchanged. Inspect a candidate, then explicitly Apply it to the builder; no order is placed.');
  return { ...reply, text: lines.join('\n'), assumptions: [search.coverage, search.assumptions, search.probabilityBasis, 'Ranking covers only the searched quoted window and explicit constraints, not a global optimum. Quotes are estimates, not executable fills.'], suggested_prompts: ['Explain the constraints used in this search.'] };
}
