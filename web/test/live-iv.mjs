import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';

assert.ok([3, 4].includes(process.argv.length) && ['--self-check', '--run'].includes(process.argv[2]) && (process.argv.length === 3 || process.argv[3] === '--presentation'), 'Use --self-check or --run with optional --presentation');
const live = process.argv[2] === '--run';
const presentation = process.argv.includes('--presentation');
registerHooks({ resolve(specifier, context, next) { return next(specifier.startsWith('.') && !/\.[a-z]+$/i.test(specifier) ? new URL(`${specifier}.ts`, context.parentURL).href : specifier, context); } });
const { createStrategy } = await import('../src/options.ts');
const { buildIvHistory } = await import('../src/intraday-history.ts');
const { discussIvHistory, AnalysisVerificationError } = await import('../src/sparring.ts');
const { readAnalysisPrompts } = await import('../src/analysis-prompts.ts');
const prompts = readAnalysisPrompts(JSON.parse(readFileSync(process.env.ARGUS_PROMPT_CANDIDATE ? resolve(process.env.ARGUS_PROMPT_CANDIDATE) : new URL('../prompts/analysis-v3.json', import.meta.url), 'utf8')));
const digest = createHash('sha256').update(JSON.stringify(prompts)).digest('hex');
let apiKey = 'synthetic';
if (live) {
  const common = execFileSync('git', ['rev-parse', '--git-common-dir'], { encoding: 'utf8' }).trim();
  apiKey = parseEnv(readFileSync(resolve(dirname(resolve(common)), '.env'), 'utf8')).OPENROUTER_API_KEY;
  assert.ok(apiKey, 'Missing provider key');
}
const state = createStrategy('long-call');
state.pricing = { mode: 'market', snapshotId: 'synthetic-iv-eval', basis: 'mid' };
Object.assign(state.legs[0], { strike: 770, expiry: '2026-10-09T20:00:00.000Z', contractId: 'SPY   261009C00770000' });
const start = Date.parse('2026-09-04T13:30:00Z'), range = { start, end: start + 1200000 };
const history = buildIvHistory(state, range);
[0, null, .25, .1].forEach((iv, i) => { history.rows[i].legs[0].iv = iv; });
const facts = { state, range, history, contractId: state.legs[0].contractId, selectedTime: start + 600000 };
const conversation = [{ role: 'user', content: 'This is synthetic test data. Explain selected IV, its change from the previous reported observation, and whole-range change. Are gaps zero, and can this establish IV rank or why IV moved?' }];
const positive = 'The selected IV is 25%. Its change from the strictly previous reported observation is 25 percentage points. The whole requested range changes by 10 percentage points from first to last reported IV; its last observation occurs after selection. Zero is reported data; the missing bucket is not zero. IV rank and causes cannot be established.';
const cases = [
  ['generated', null, true],
  ['positive', positive, true],
  ['units', 'The selected IV increased by 25% relative to the previous reported observation.', false],
  ['gap', 'The second bucket reported IV of 0%.', false],
  ['future', 'The previous reported IV before the selected bucket was 10%.', false],
  ['aggregation', 'The selected 25% IV is the arithmetic average of all IV observations within that five-minute bucket.', false],
  ['observed-range-end', 'Across the whole requested range (2026-09-04T13:30:00.000Z to 2026-09-04T13:45:00.000Z, which includes an observation after the selected candle), IV changed by 10 percentage points from 0 to 0.10 (10%).', false],
  ['observed-rank-method', 'IV rank or percentile cannot be calculated because historical reference distributions and broader underlying IV series are not provided.', false],
];
let paid = 0, failures = 0, totalTokens = 0, costUsd = 0;
for (const [id, text, expected] of presentation ? [['fractional', null, true], ['tiny-negative', null, true]] : cases) {
  if (presentation) (id === 'fractional' ? [.0657629744290709, null, .0642588177451098, .05] : [.25, null, .249999, .249998]).forEach((iv, i) => { history.rows[i].legs[0].iv = iv; });
  const stages = []; let calls = 0, accepted = false, failure;
  const fetcher = async (url, init) => {
    const body = JSON.parse(init.body), input = JSON.parse(body.messages[1].content), verification = !!input.reply;
    calls++; assert.ok(calls <= 2); assert.equal(body.tools, undefined);
    assert.equal(input.facts.selectedChangePercentagePoints, (history.rows[2].legs[0].iv - history.rows[0].legs[0].iv) * 100);
    assert.equal(input.facts.summary.changePercentagePoints, (history.rows[3].legs[0].iv - history.rows[0].legs[0].iv) * 100);
    const frozenReply = { text: text ?? (id === 'fractional' ? 'Selected IV is approximately 6.43%, down approximately 0.15 percentage points from approximately 6.58%. The whole-range change is approximately -1.58 percentage points. Missing is not zero.' : id === 'tiny-negative' ? 'Selected IV is approximately 25.00%, decreasing by less than 0.01 percentage points. The whole-range change is also a decrease of less than 0.01 percentage points. Missing is not zero.' : positive), assumptions: [], objections: [], suggested_prompts: [] };
    let response;
    if (!live || (!verification && text !== null)) response = Response.json({ choices: [{ message: { content: JSON.stringify(verification ? { valid: expected } : frozenReply) } }] });
    else {
      assert.ok(++paid <= (presentation ? 4 : 9), 'Paid request budget exhausted');
      response = await fetch(url, init);
    }
    const raw = await response.clone().json();
    const content = raw.choices?.[0]?.message?.content;
    totalTokens += raw.usage?.total_tokens ?? 0; costUsd += raw.usage?.cost ?? 0;
    stages.push({ phase: verification ? 'verification' : 'generation', paid: live && (verification || text === null), status: response.status, content, totalTokens: raw.usage?.total_tokens, costUsd: raw.usage?.cost });
    return response;
  };
  try {
    const result = await discussIvHistory(facts, conversation, apiKey, fetcher, prompts);
    if (text === null && prompts.version === 'analysis-v4') {
      assert.ok(result.reply.text.trim().split(/\s+/).length <= 100, 'Generated explanation exceeds 100 words');
      assert.ok(!/\d+\.\d{3,}/.test(JSON.stringify(result.reply).replace(/\d{2}:\d{2}:\d{2}\.\d{3}Z/g, 'timestamp')), 'Generated explanation exposes excessive decimal precision');
      assert.ok(['assumptions', 'objections', 'suggested_prompts'].every(key => result.reply[key].length <= 2), 'Generated explanation repeats too many ancillary items');
    }
    accepted = true;
  }
  catch (error) { failure = error instanceof AnalysisVerificationError ? error.reason : error.name; }
  const pass = accepted === expected && (expected || failure === 'rejected');
  if (!pass) failures++;
  console.log(JSON.stringify({ id, expected, accepted, contractPass: pass, semanticReview: text === null ? 'required-even-if-verifier-accepts' : 'frozen-control', failure, calls, stages }));
}
console.log(JSON.stringify({ mode: live ? 'live-synthetic' : 'offline-transport-only', version: prompts.version, digest, paid, totalTokens, costUsd, failures }));
assert.equal(failures, 0, 'IV evaluation failed; do not activate');
