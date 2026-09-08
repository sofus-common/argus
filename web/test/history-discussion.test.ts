import { expect, it, vi } from 'vitest';
import { createStrategy } from '../src/options';
import { buildPriceHistory } from '../src/price-history';
import { discussPriceHistory, discussIntradayHistory, discussPositionPerformance, MODEL } from '../src/sparring';
import { buildIntradayHistory } from '../src/intraday-history';
import { buildPositionPerformance } from '../src/position-performance';
import { createPosition } from '../src/position-lifecycle';
import { upgradePositionLots, recordLotTransaction } from '../src/position-lots';
import { defaultAnalysisPrompts } from '../src/analysis-prompts';

function performanceFacts() {
  const state = { ...createStrategy('long-call'), legs: [], stock: { shares: 100, entryPrice: 100 }, feeAllowance: 5, valuationTimestamp: '2026-09-01T12:00:00.000Z', scenarioDate: '2026-09-01T12:00:00.000Z', pricing: { mode: 'market' as const, snapshotId: 'recorded', basis: 'mid' as const, entryMode: 'fixed' as const } };
  let position = upgradePositionLots(createPosition(state));
  position = recordLotTransaction(position, { id: 'private-close-event', at: '2026-09-03T12:00:00.000Z', recordedAt: '2026-09-03T12:00:00.000Z', opens: [], closes: [{ id: 'close', lotId: 'initial:stock', quantity: 100, price: 102 }] });
  const range = { start: '2026-09-01', end: '2026-09-04' };
  const performance = buildPositionPerformance(position, [], { response: [{ bid: 100.9, ask: 101.1, created: '2026-09-01T17:15:00.000', last_trade: '2026-09-01T16:00:00.000' }] }, range);
  return { position, facts: { savedId: 'saved-performance', revision: 2, range, performance, selectedDate: '2026-09-03' } };
}

it('discusses frozen recorded performance in two calls without ledger, price scaling or tools', async () => {
  const { position, facts } = performanceFacts(), before = structuredClone(facts), ledger = structuredClone(position), bodies: any[] = [];
  const answer = { text: 'Recorded combined P/L on the selected closed date is $195 after the allowance.', assumptions: [], objections: [], suggested_prompts: [] };
  expect(await discussPositionPerformance(position, facts, conversation, 'test', async (_url, init) => {
    bodies.push(JSON.parse(String(init!.body))); facts.selectedDate = 'changed';
    return response({ content: JSON.stringify(bodies.length === 1 ? answer : { valid: true }) });
  })).toEqual({ reply: answer });
  expect(bodies).toHaveLength(2); expect(position).toEqual(ledger);
  for (const body of bodies) {
    const input = JSON.parse(body.messages[1].content);
    expect(input.facts).toEqual(before); expect(input.historyDisplay).toBeUndefined(); expect(input.facts.position).toBeUndefined(); expect(input.facts.state).toBeUndefined();
    expect(body.tools).toBeUndefined(); expect(body.tool_choice).toBeUndefined(); expect(JSON.stringify(body)).not.toContain('private-close-event');
    expect(input.facts.performance.rows.map((row: any) => row.combinedPnl)).toEqual([95, null, 195, 195]);
    expect(input.facts.performance.rows.map((row: any) => row.changeUsd)).toEqual([null, null, null, 0]);
  }
});

it('rejects performance identity, selection and accounting tampering before inference', async () => {
  const fetcher = vi.fn<typeof fetch>();
  for (const change of [(f: any) => { f.savedId = ''; }, (f: any) => { f.revision = 0; }, (f: any) => { f.selectedDate = '2026-08-31'; }, (f: any) => { f.performance.rows[0].combinedPnl++; }, (f: any) => { f.extra = true; }]) {
    const { position, facts } = performanceFacts(); change(facts);
    await expect(discussPositionPerformance(position, facts, conversation, 'test', fetcher)).rejects.toThrow();
  }
  expect(fetcher).not.toHaveBeenCalled();
});

it('withholds performance discussion on tools, mutation fields or rejected verification', async () => {
  for (const kind of ['tools', 'operations', 'rejected']) {
    const { position, facts } = performanceFacts(); let calls = 0;
    const fetcher: typeof fetch = async () => {
      calls++;
      return response(kind === 'tools' ? { tool_calls: [{ type: 'function', function: { name: 'evaluate_lot_scenarios', arguments: '{}' } }] } : { content: JSON.stringify(calls === 1 ? { ...draft, ...(kind === 'operations' ? { operations: [] } : {}) } : { valid: false }) });
    };
    await expect(discussPositionPerformance(position, facts, conversation, 'test', fetcher)).rejects.toThrow(); expect(calls).toBe(kind === 'rejected' ? 2 : 1);
  }
  const { position, facts } = performanceFacts(), prompts = { ...defaultAnalysisPrompts.prompts };
  delete prompts.PERFORMANCE_DISCUSSION_PROMPT; delete prompts.PERFORMANCE_VERIFICATION_PROMPT;
  const fetcher = vi.fn<typeof fetch>();
  await expect(discussPositionPerformance(position, facts, conversation, 'test', fetcher, { ...defaultAnalysisPrompts, prompts })).rejects.toThrow('not configured');
  expect(fetcher).not.toHaveBeenCalled();
});

function facts(contracts = 1) {
  const state = createStrategy('bull-call');
  state.valuationTimestamp = state.scenarioDate = '2026-09-06T12:00:00Z';
  state.pricing = { mode: 'market', snapshotId: 'snapshot', basis: 'mid' };
  state.legs.forEach((leg, i) => { leg.strike = 770 + i * 5; leg.expiry = '2026-10-09T20:00:00Z'; leg.contractId = `SPY   261009C00${leg.strike}000`; });
  state.legs.forEach(leg => { leg.contracts = contracts; });
  const range = { start: '2026-09-04', end: '2026-09-05' };
  const mark = (bid: number, ask: number) => ({ bid, ask, created: '2026-09-04T17:15:00', last_trade: '2026-09-04T16:00:00' });
  const history = buildPriceHistory(state, state.legs.map((leg, i) => ({ response: [{ contract: { symbol: 'SPY', expiration: '2026-10-09', right: 'CALL', strike: leg.strike }, data: [mark(i ? 8.88 : 11.64, i ? 8.92 : 11.68)] }] })), { response: [mark(770.23, 770.25)] }, range, new Date('2026-09-06T12:00:00Z'));
  return { state, range, history, selectedDate: range.end };
}
const conversation = [{ role: 'user' as const, content: 'What does the selected date tell me?' }];
const draft = { text: 'The selected date is unavailable, not a zero value.', assumptions: ['Current fixed inventory only.'], objections: [], suggested_prompts: [] };
const response = (message: object) => new Response(JSON.stringify({ choices: [{ message }] }));

it('shares frozen normalized display units with generation and verification without changing daily facts', async () => {
  for (const selectedDate of ['2026-09-04', '2026-09-05']) {
    const input = facts(2); input.selectedDate = selectedDate;
    const before = structuredClone(input), bodies: any[] = [];
    await discussPriceHistory(input, conversation, 'test', async (_url, init) => {
      bodies.push(JSON.parse(String(init!.body)));
      return response({ content: JSON.stringify(bodies.length === 1 ? draft : { valid: true }) });
    });
    for (const body of bodies) {
      const data = JSON.parse(body.messages[1].content);
      expect(data.facts).toEqual(before);
      expect(data.historyDisplay.priceDivisor).toBe(200);
      if (selectedDate === '2026-09-04') expect(data.historyDisplay.selectedPrice).toBeCloseTo(2.76);
      else expect(data.historyDisplay.selectedPrice).toBeNull();
      expect(body.messages[0].content).toContain('historyDisplay');
    }
    expect(input).toEqual(before);
  }
});

function intradayFacts(full = false, days = 1) {
  const state = createStrategy(full ? 'iron-condor' : 'bull-call');
  if (full) state.legs.push(...state.legs.map((leg, i) => ({ ...leg, id: `extra-${i}` })));
  state.pricing = { mode: 'market', snapshotId: 'intraday-snapshot', basis: 'mid' };
  state.legs.forEach((leg, i) => { leg.type = 'call'; leg.strike = 770 + i * 5; leg.expiry = '2026-10-09T20:00:00.000Z'; leg.contractId = `SPY   261009C00${leg.strike}000`; });
  const start = Date.parse(days > 1 ? '2026-08-28T00:00:00Z' : '2026-09-04T00:00:00Z');
  const range = { start, end: start + (full ? days * 86400000 : 600000) };
  const bars = (close: number) => Array.from({ length: full ? 288 * days : 1 }, (_, i) => ({ time: range.start + i * 300000, count: 1, open: close, high: close, low: close, close, volume: null }));
  const history = buildIntradayHistory(state, range, { underlying: { symbol: 'SPY', basis: 'last-trade', bars: bars(770) }, contracts: state.legs.map((leg, i) => ({ contractId: leg.contractId, basis: 'midpoint', bars: bars(i + 1.23456789) })) });
  return { state, range, history, selectedTime: range.end - 300000 };
}
const readableFacts = (facts: ReturnType<typeof intradayFacts>) => ({ ...facts, range: { start: new Date(facts.range.start).toISOString(), end: new Date(facts.range.end).toISOString() }, selectedTime: new Date(facts.selectedTime).toISOString(), history: { ...facts.history, rows: facts.history.rows.map(row => ({ ...row, time: new Date(row.time).toISOString() })) } });

it('discusses immutable intraday facts without tools and independently verifies bucket pricing semantics', async () => {
  const input = intradayFacts(), before = structuredClone(input), bodies: any[] = [];
  const fetcher = vi.fn<typeof fetch>(async (_url, init) => {
    bodies.push(JSON.parse(String(init!.body)));
    input.selectedTime = 0;
    return response({ content: JSON.stringify(bodies.length === 1 ? draft : { valid: true }) });
  });
  expect(await discussIntradayHistory(input, conversation, 'test', fetcher)).toEqual({ reply: draft });
  expect(bodies).toHaveLength(2);
  for (const body of bodies) {
    expect(body.model).toBe(MODEL); expect(body.tools).toBeUndefined(); expect(body.tool_choice).toBeUndefined();
    expect(body.response_format).toMatchObject({ type: "json_schema", json_schema: { strict: true } });
    const presented = JSON.parse(body.messages[1].content).facts;
    expect(presented).toEqual(readableFacts(before));
    expect(JSON.parse(body.messages[1].content).historyDisplay).toEqual({ priceDivisor: 100, selectedPrice: null });
    expect(presented.selectedTime).toBe('2026-09-04T00:05:00.000Z');
    expect(presented.history.rows[0].time).toBe('2026-09-04T00:00:00.000Z');
    expect(body.messages[0].content).toContain('option midpoint bucket closes');
    expect(body.messages[0].content).toContain('underlying last-trade');
    expect(body.messages[0].content).toContain('server-formatted ISO timestamps in UTC');
    expect(body.messages[0].content).toContain('show human-readable UTC dates and times, not raw epoch numbers');
    expect(body.messages[0].content).toContain('not synchronized');
    expect(body.messages[0].content).toContain('not historical holdings or P/L');
    expect(body.messages[0].content).toContain('unavailable, not zero');
    expect(body.messages[0].content).toContain('IV/Greeks');
  }
  expect(bodies[1].messages[0].content).toContain('Independently verify');
  expect(bodies[1].messages[0].content).toContain('A later disclaimer does not cure');
});

it('withholds failed intraday verification and rejects malformed facts before inference', async () => {
  const unused = vi.fn<typeof fetch>();
  for (const change of [(input: any) => { input.selectedTime++; }, (input: any) => { input.history.rows[0].value++; }, (input: any) => { input.history.rows[0].legs[0].contractId = 'foreign'; }, (input: any) => { input.history.basis = 'wrong'; }, (input: any) => { input.extra = true; }]) {
    const input = intradayFacts(); change(input); await expect(discussIntradayHistory(input, conversation, 'test', unused)).rejects.toThrow();
  }
  expect(unused).not.toHaveBeenCalled();
  let calls = 0;
  await expect(discussIntradayHistory(intradayFacts(), conversation, 'test', async () => response({ content: JSON.stringify(++calls === 1 ? draft : { valid: false }) }))).rejects.toMatchObject({ reason: 'rejected' });
  expect(calls).toBe(2);
});

it('retains all 288 eight-leg intraday buckets within a bounded inference payload', async () => {
  const input = intradayFacts(true), bytes = new TextEncoder().encode(JSON.stringify(input)).length, bodies: any[] = [];
  expect(bytes).toBeGreaterThan(64 * 1024);
  const fetcher = vi.fn<typeof fetch>(async (_url, init) => { bodies.push(JSON.parse(String(init!.body))); return response({ content: JSON.stringify(bodies.length === 1 ? draft : { valid: true }) }); });
  await discussIntradayHistory(input, conversation, 'test', fetcher);
  for (const body of bodies) {
    const facts = JSON.parse(body.messages[1].content).facts;
    expect(facts.history.rows).toHaveLength(288); expect(facts.history.rows.every((row: any) => row.legs.length === 8)).toBe(true);
    expect(facts).toEqual(readableFacts(input)); expect(new TextEncoder().encode(body.messages[1].content).length).toBeLessThanOrEqual(256 * 1024);
    expect(JSON.parse(body.messages[1].content).historyDisplay.selectedPrice).toBeCloseTo(input.history.rows.at(-1)!.value! / 100);
  }
});

it('retains all 2016 eight-leg weekly buckets in both bounded AI passes', async () => {
  const input = intradayFacts(true, 7), bodies: any[] = [];
  await discussIntradayHistory(input, conversation, 'test', async (_url, init) => {
    bodies.push(JSON.parse(String(init!.body)));
    return response({ content: JSON.stringify(bodies.length === 1 ? draft : { valid: true }) });
  });
  expect(bodies).toHaveLength(2);
  for (const body of bodies) {
    const data = JSON.parse(body.messages[1].content);
    expect(data.facts).toEqual(readableFacts(input));
    expect(data.facts.history.rows).toHaveLength(2016);
    expect(data.facts.history.rows.every((row: any) => row.legs.length === 8)).toBe(true);
    expect(new TextEncoder().encode(body.messages[1].content).length).toBeGreaterThan(256 * 1024);
    expect(new TextEncoder().encode(body.messages[1].content).length).toBeLessThan(2 * 1024 * 1024);
  }
});

it('discusses validated frozen daily facts without tools and independently checks the draft', async () => {
  const input = facts(), bodies: any[] = [];
  const provider = vi.fn<typeof fetch>(async (_url, init) => {
    bodies.push(JSON.parse(String(init!.body)));
    if (bodies.length === 1) input.selectedDate = 'changed after dispatch';
    return response({ content: JSON.stringify(bodies.length === 1 ? draft : { valid: true }) });
  });
  expect(await discussPriceHistory(input, conversation, 'test', provider)).toEqual({ reply: draft });
  expect(bodies).toHaveLength(2);
  for (const body of bodies) {
    expect(body.model).toBe(MODEL);
    expect(body.tools).toBeUndefined(); expect(body.tool_choice).toBeUndefined();
    expect(body.provider).toEqual({ allow_fallbacks: false, data_collection: 'deny', require_parameters: true });
    const data = JSON.parse(body.messages[1].content);
    expect(data.facts.selectedDate).toBe('2026-09-05');
    expect(data.facts.history.rows[1].value).toBeNull();
    expect(data.facts.history.rows[0].value.mid).toBeCloseTo(276);
    expect(data.conversation).toEqual(conversation);
    expect(body.messages[0].content).toContain('not historical holdings or P/L');
    expect(body.messages[0].content).toContain('not synchronized quote times');
    expect(body.messages[0].content).toContain('not executable prices or confidence intervals');
    expect(body.messages[0].content).toContain('not closing trade prices');
    expect(body.messages[0].content).toContain('not evidence that a leg closed');
    expect(body.messages[0].content).toContain('For bidSide use reported long bids and short asks; for askSide use long asks and short bids');
  }
  expect(JSON.parse(bodies[1].messages[1].content).reply).toEqual(draft);
  expect(bodies[1].messages[0].content).toContain('Independently verify');
  expect(bodies[1].messages[0].content).toContain('A later disclaimer does not cure');
});

it('retains 31 complete dates for eight legs and stock in both daily discussion passes', async () => {
  const state = facts().state;
  state.legs = Array.from({ length: 8 }, (_, i) => ({ ...state.legs[i % 2], id: `leg-${i}`, strike: 770 + i * 5, contractId: `SPY   261009C00${770 + i * 5}000` }));
  state.stock = { shares: -100, entryPrice: 750 };
  const range = { start: '2026-08-06', end: '2026-09-05' };
  const marks = (bid: number) => Array.from({ length: 31 }, (_, i) => {
    const date = new Date(Date.parse(range.start) + i * 86400000).toISOString().slice(0, 10);
    return { bid, ask: bid + .02, created: `${date}T17:15:00.000`, last_trade: `${date}T16:00:00.000` };
  });
  const history = buildPriceHistory(state, state.legs.map((leg, i) => ({ response: [{ contract: { symbol: 'SPY', expiration: '2026-10-09', right: 'CALL', strike: leg.strike }, data: marks(i + 1.23456789) }] })), { response: marks(770.23) }, range, new Date('2026-09-06T12:00:00Z'));
  const input = { state, range, history, selectedDate: range.end }, bodies: any[] = [];
  await discussPriceHistory(input, conversation, 'test', async (_url, init) => {
    bodies.push(JSON.parse(String(init!.body)));
    return response({ content: JSON.stringify(bodies.length === 1 ? draft : { valid: true }) });
  });
  expect(bodies).toHaveLength(2);
  for (const body of bodies) {
    expect(JSON.parse(body.messages[1].content).facts).toEqual(input);
    expect(new TextEncoder().encode(body.messages[1].content).length).toBeLessThanOrEqual(64 * 1024);
  }
  expect(history.rows).toHaveLength(31);
  expect(history.rows.every(row => row.legs.length === 8 && row.value !== null)).toBe(true);
});

it('rejects invalid or oversized facts before inference and withholds tool calls and unverifiable output', async () => {
  const unused = vi.fn<typeof fetch>();
  const incorrect = facts(); incorrect.history.rows[0].value!.mid++;
  const oversized = facts(); oversized.selectedDate = 'x'.repeat(65537);
  for (const input of [
    { ...facts(), selectedDate: '2026-09-03' },
    { ...facts(), history: { rows: [] } },
    { ...facts(), extra: 'x'.repeat(65537) },
    incorrect, oversized,
  ]) await expect(discussPriceHistory(input, conversation, 'test', unused)).rejects.toThrow();
  expect(unused).not.toHaveBeenCalled();
  const tool = vi.fn<typeof fetch>(async () => response({ tool_calls: [{ id: 'no-tools' }], content: JSON.stringify(draft) }));
  await expect(discussPriceHistory(facts(), conversation, 'test', tool)).rejects.toThrow();
  expect(tool).toHaveBeenCalledTimes(1);
  for (const verdict of [{ valid: false }, { valid: true, extra: true }, { valid: 'true' }]) {
    let calls = 0;
    await expect(discussPriceHistory(facts(), conversation, 'test', async () => response({ content: JSON.stringify(++calls === 1 ? draft : verdict) }))).rejects.toMatchObject({ reason: verdict.valid === false ? 'rejected' : 'invalid_output' });
    expect(calls).toBe(2);
  }
  let calls = 0;
  await expect(discussPriceHistory(facts(), conversation, 'test', async () => response({ content: JSON.stringify(++calls === 1 ? draft : { valid: true }), ...(calls === 2 ? { tool_calls: [{ id: 'forbidden-verifier-tool' }] } : {}) }))).rejects.toMatchObject({ reason: 'invalid_output' });
});
