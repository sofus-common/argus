import { expect, it, vi } from 'vitest';
import { createStrategy } from '../src/options';
import { buildIvHistory } from '../src/intraday-history';
import { defaultAnalysisPrompts } from '../src/analysis-prompts';
import { discussIvHistory } from '../src/sparring';
import withoutIv from '../prompts/analysis-v2.json';

function fixture() {
  const state = createStrategy('long-call');
  state.pricing = { mode: 'market', snapshotId: 'iv-test', basis: 'mid' };
  Object.assign(state.legs[0], { strike: 770, expiry: '2026-10-09T20:00:00.000Z', contractId: 'SPY   261009C00770000' });
  const start = Date.parse('2026-09-04T13:30:00Z'), range = { start, end: start + 900000 };
  const history = buildIvHistory(state, range);
  [0, null, .25].forEach((iv, i) => { history.rows[i].legs[0].iv = iv; });
  return { state, range, history, contractId: state.legs[0].contractId!, selectedTime: start + 600000 };
}
const conversation = [{ role: 'user' as const, content: 'Explain the selected IV change' }];
const bundle = { ...defaultAnalysisPrompts, prompts: { ...defaultAnalysisPrompts.prompts, IV_DISCUSSION_PROMPT: 'Explain validated IV facts', IV_VERIFICATION_PROMPT: 'Verify validated IV facts' } };
const reply = { text: 'The selected change is 25 percentage points.', assumptions: [], objections: [], suggested_prompts: [] };
const response = (value: unknown) => Response.json({ choices: [{ message: { content: JSON.stringify(value) } }] });

it('uses two frozen, tool-free calls with calculated IV facts and traces', async () => {
  const facts = fixture(), configured = structuredClone(bundle), bodies: any[] = [], events: any[] = [];
  const fetcher: typeof fetch = async (_url, init) => {
    bodies.push(JSON.parse(String(init?.body)));
    facts.history.rows[0].legs[0].iv = .99;
    configured.prompts.IV_VERIFICATION_PROMPT = 'mutated';
    return response(bodies.length === 1 ? reply : { valid: true });
  };
  expect(await discussIvHistory(facts, conversation, 'test', fetcher, configured, event => { events.push(event); })).toEqual({ reply });
  expect(bodies).toHaveLength(2);
  expect(bodies.map(body => body.messages[0].content)).toEqual([bundle.prompts.IV_DISCUSSION_PROMPT, bundle.prompts.IV_VERIFICATION_PROMPT]);
  const inputs = bodies.map(body => JSON.parse(body.messages[1].content));
  expect(inputs[0].facts).toEqual(inputs[1].facts);
  expect(inputs[0].facts.observations.map((row: any) => row.iv)).toEqual([0, null, .25]);
  expect(inputs[0].facts.selectedChangePercentagePoints).toBe(25);
  expect(inputs[0].facts.previousReported.time).toBe(new Date(facts.range.start).toISOString());
  expect(inputs[0].facts.summary.missing).toBe(1);
  for (const [i, body] of bodies.entries()) {
    expect(body.tools).toBeUndefined(); expect(body.tool_choice).toBeUndefined();
    expect(inputs[i].historyDisplay).toBeUndefined(); expect(inputs[i].facts.state).toBeUndefined();
  }
  expect(events.map(event => event.stage)).toEqual(['facts', 'generation-request', 'transport', 'transport', 'generation-output', 'proposal-check', 'verification-request', 'transport', 'transport', 'verification-output', 'completion']);
  expect(events.filter(event => event.stage === 'transport').map(event => event.reason)).toEqual(['headers-received', 'body-complete', 'headers-received', 'body-complete']);
});

it('rejects invalid bindings or missing prompts before inference', async () => {
  const fetcher = vi.fn<typeof fetch>();
  await expect(discussIvHistory(fixture(), conversation, 'test', fetcher, withoutIv)).rejects.toThrow('not configured');
  for (const change of [
    (facts: any) => { facts.contractId = 'foreign'; },
    (facts: any) => { facts.selectedTime++; },
    (facts: any) => { facts.history.rows[0].legs[0].iv = -1; },
    (facts: any) => { facts.extra = true; },
  ]) { const facts = fixture(); change(facts); await expect(discussIvHistory(facts, conversation, 'test', fetcher, bundle)).rejects.toThrow(); }
  expect(fetcher).not.toHaveBeenCalled();
});

it('withholds rejected replies and never retries or admits tools or operations', async () => {
  for (const draft of [reply, { ...reply, operations: [] }, 'tool']) {
    let calls = 0;
    const fetcher: typeof fetch = async () => {
      calls++;
      return draft === 'tool' ? Response.json({ choices: [{ message: { tool_calls: [{ type: 'function', function: { name: 'evaluate_lot_scenarios', arguments: '{}' } }] } }] }) : response(calls === 1 ? draft : { valid: false });
    };
    await expect(discussIvHistory(fixture(), conversation, 'test', fetcher, bundle)).rejects.toThrow();
    expect(calls).toBe(draft === reply ? 2 : 1);
  }
});
