import assert from 'node:assert/strict';
import { createMarketStrategy, calculateStrategy, validateMarketStrategy } from '../src/options.ts';

if (!process.argv.includes('--run')) throw new Error('Pass --run for real quote retrieval and up to four paid generation/verification requests.');
const base = 'http://127.0.0.1:5173';
const traceReadonly = process.argv.includes('--trace-readonly');
const symbol = process.argv.find(arg => arg.startsWith('--symbol='))?.slice(9) ?? 'SPY';
assert.match(symbol, /^[A-Z]{1,6}$/);
const loaded = await fetch(`${base}/api/chain?symbol=${symbol}`, { signal: AbortSignal.timeout(35000) });
assert.equal(loaded.status, 200);
const { snapshot } = await loaded.json();
assert.equal(snapshot.underlying, symbol);
const state = createMarketStrategy('long-call', snapshot);
if (traceReadonly) state.feeAllowance = 5;
const original = structuredClone(state);
const post = (route, body) => fetch(`${base}${route}`, { method: 'POST', headers: { 'content-type': 'application/json', Origin: base, 'X-ARGUS-Request': '1' }, body: JSON.stringify(body), signal: AbortSignal.timeout(45000) });
const calculated = await post('/api/calculate', state);
assert.equal(calculated.status, 200);
assert.deepEqual((await calculated.json()).metrics, calculateStrategy(state));
const forged = structuredClone(state);
forged.legs[0].entryPrice += 1;
assert.equal((await post('/api/calculate', forged)).status, 422);
assert.equal((await post('/api/calculate', { ...state, pricing: { ...state.pricing, snapshotId: 'unknown' } })).status, 409);
const prompts = traceReadonly ? ['Explain this quoted long call read-only. State the quote dates separately from retrieval time; do not claim fresh or executable prices. Explain gross entry cost, the $5 modeled allowance, net cost and intact-expiry risk using supplied facts. Do not search alternatives, request additional scenarios or change the position.'] : ['Explain the biggest risk in this quoted long call. Use its actual quote snapshot, not sample numbers. Do not change the builder.', 'Replace this position with a bull-call template using the loaded quote snapshot.'];
for (const prompt of prompts) {
  const requestId = crypto.randomUUID();
  const response = await post('/api/sparring', { request_id: requestId, base_state_version: state.version, state, conversation: [{ role: 'user', content: prompt }] });
  const result = await response.json();
  console.log(JSON.stringify({ status: response.status, requestId, traceId: response.headers.get('X-ARGUS-Trace-Id'), traceStatus: response.headers.get('X-ARGUS-Trace-Status'), prompt, reply: result.reply, metrics: result.metrics, error: result.error }));
  assert.equal(response.status, 200);
  assert.equal(result.calculated.dataMode, 'market-snapshot');
  assert.equal(result.next_state.underlying, symbol);
  assert.ok(result.market_context.sources.filter(source => source.id.startsWith('alpaca-quote') || source.id.startsWith('tastytrade-') || source.id.startsWith('theta-reference')).every(source => source.label.startsWith(symbol)));
  assert.deepEqual(validateMarketStrategy(result.next_state, snapshot), []);
  if (prompt.startsWith('Explain')) assert.equal(result.reply.operations.length, 0);
  else { assert.ok(result.reply.operations.length); assert.equal(result.next_state.name, 'Bull Call Spread'); }
  if (traceReadonly) {
    assert.equal(result.request_id, requestId);
    assert.equal(result.base_state_version, original.version);
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    assert.deepEqual(result.next_state, { ...original, version: original.version + 1 });
    assert.deepEqual(result.calculated.metrics, calculateStrategy(original));
    assert.deepEqual(state, original);
    assert.equal(response.headers.get('X-ARGUS-Trace-Status'), 'complete');
    const traceId = response.headers.get('X-ARGUS-Trace-Id');
    assert.match(traceId ?? '', /^[a-f0-9-]{36}$/);
    const readTrace = async () => {
      const response = await fetch(`${base}/api/analysis-traces/${traceId}`, { signal: AbortSignal.timeout(10000) });
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('Cache-Control'), 'no-store');
      return response.json();
    };
    const trace = await readTrace();
    assert.deepEqual(await readTrace(), trace);
    assert.equal(trace.id, traceId); assert.equal(trace.request_id, requestId);
    assert.equal(trace.kind, 'sparring'); assert.equal(trace.outcome, 'accepted');
    assert.ok(Number.isFinite(trace.finished_at) && trace.finished_at >= trace.started_at);
    assert.equal(trace.events.length, trace.event_count);
    const facts = trace.events.find(event => event.stage === 'facts');
    assert.deepEqual(facts.input.state, original);
    assert.deepEqual(facts.output.metrics, result.calculated.metrics);
    assert.deepEqual(snapshot.contractTerms, { exerciseStyle: 'American', settlement: 'physical-shares', sharesPerContract: 100, settlementSession: 'PM' });
    for (const [key, value] of Object.entries(snapshot.contractTerms)) assert.equal(facts.output.contractTerms[key], value);
    assert.deepEqual(facts.output.contractTerms, result.calculated.contractTerms);
    assert.equal(facts.output.contractTerms.status, 'provider-verified-standard-window');
    const requests = trace.events.filter(event => ['generation-request', 'verification-request'].includes(event.stage));
    assert.ok(requests.length >= 2 && requests.length <= 3);
    assert.equal(requests[0].reason, 'initial'); assert.equal(requests.at(-1).stage, 'verification-request');
    assert.equal(JSON.parse(requests[0].input.messages[1].content).option_snapshot.id, snapshot.id);
    assert.deepEqual(JSON.parse(requests.at(-1).input.messages[1].content).reply, result.reply);
    for (const request of requests) {
      const supplied = JSON.parse(request.input.messages[1].content);
      assert.deepEqual(supplied.calculated.contractTerms, facts.output.contractTerms);
      assert.equal(supplied.calculated.valuationModel, original.valuationModel ?? 'european-bsm-v1');
    }
    assert.equal(trace.events.find(event => event.stage === 'verification-output').output.content.valid, true);
    const accepted = trace.events.find(event => event.stage === 'proposal-check' && event.reason === 'deterministic-constraints-accepted');
    assert.deepEqual(accepted.output, { operations: result.reply.operations, next_state: result.next_state });
    assert.ok(trace.events.some(event => event.stage === 'completion' && event.reason === 'verified-reply-accepted'));
    assert.equal(trace.events.at(-1).reason, 'analysis_disposition');
    assert.equal(trace.events.at(-1).output.outcome, 'accepted');
    const checkKeys = value => {
      if (!value || typeof value !== 'object') return;
      for (const [key, child] of Object.entries(value)) {
        assert.ok(!['headers', 'authorization', 'cookie', 'setcookie', 'reasoning', 'reasoningdetails', 'apikey', 'accesstoken', 'refreshtoken', 'clientsecret'].includes(key.toLowerCase().replace(/[-_]/g, '')), 'Sensitive trace field');
        checkKeys(child);
      }
    };
    checkKeys(trace);
    const quoteTimes = snapshot.contracts.map(contract => contract.quoteAsOf).sort();
    console.log(JSON.stringify({ case: 'local-quoted-trace', traceId, requestId, source: snapshot.source, retrievedAt: snapshot.retrievedAt, spotAsOf: snapshot.spotAsOf, quoteOldest: quoteTimes[0], quoteNewest: quoteTimes.at(-1), contracts: snapshot.contracts.length, traceEvents: trace.event_count, traceBytes: trace.total_bytes, configuration: trace.events.find(event => event.stage === 'configuration').output, inferenceRequests: requests.length, totalTokens: trace.events.reduce((sum, event) => sum + (event.output?.usage?.total_tokens ?? 0), 0), persistedReadback: true, sourceUnchanged: true }));
  }
}
console.log(`Live chain contract checks passed: ${snapshot.contracts.length} contracts, calculator agreement, forged-price rejection, snapshot expiry guard and ${traceReadonly ? 'read-only analysis with persisted trace' : 'real-contract proposal'}. Review free-text correctness separately.`);
