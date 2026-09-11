import assert from 'node:assert/strict';
import { createMarketStrategy, calculateStrategy, evaluateScenario, marketLeg, validateMarketStrategy, searchCandidates } from '../src/options.ts';

function assertSearchEqual(actual, expected) {
  const normalized = structuredClone(actual);
  assert.equal(normalized.candidates.length, expected.candidates.length);
  normalized.candidates.forEach((candidate, index) => {
    const reference = expected.candidates[index];
    if (reference.probability.probability !== null) {
      assert.ok(Number.isFinite(candidate.probability.probability) && candidate.probability.probability >= 0 && candidate.probability.probability <= 1 && Math.abs(candidate.probability.probability - reference.probability.probability) <= 1e-12, 'Probability replay exceeds numerical tolerance');
      candidate.probability.probability = reference.probability.probability;
    }
    if (['balanced', 'expiry-probability'].includes(expected.request.objective)) {
      assert.ok(Number.isFinite(candidate.score) && Math.abs(candidate.score - reference.score) <= 1e-12, 'Score replay exceeds numerical tolerance');
      candidate.score = reference.score;
    }
  });
  assert.deepEqual(normalized, expected);
}

if (!process.argv.includes('--run')) throw new Error('Pass --run for real quote retrieval and up to four paid generation/verification requests; --wide uses at most three; --optimizer makes no inference requests.');
const base = 'http://127.0.0.1:5173';
const optimizer = process.argv.includes('--optimizer');
const wide = process.argv.includes('--wide');
assert.ok(!optimizer || !wide && !process.argv.includes('--trace-readonly'), 'Optimizer mode is separate from inference checks');
const traceReadonly = wide || process.argv.includes('--trace-readonly');
const symbol = process.argv.find(arg => arg.startsWith('--symbol='))?.slice(9) ?? 'SPY';
assert.match(symbol, /^[A-Z]{1,6}$/);
const loaded = await fetch(`${base}/api/chain?symbol=${symbol}`, { signal: AbortSignal.timeout(35000) });
assert.equal(loaded.status, 200);
let { snapshot } = await loaded.json();
if (wide) {
  const dates = snapshot.availableExpiries.slice(0, 4);
  assert.equal(dates.length, 4, 'Four listed expiry dates required');
  const expanded = await fetch(`${base}/api/chain?${new URLSearchParams({ symbol, expiries: dates.join(',') })}`, { signal: AbortSignal.timeout(35000) });
  assert.equal(expanded.status, 200);
  snapshot = (await expanded.json()).snapshot;
  assert.deepEqual([...new Set(snapshot.contracts.map(leg => leg.expiry.slice(0, 10)))].sort(), dates.sort());
}
assert.equal(snapshot.underlying, symbol);
const state = createMarketStrategy('long-call', snapshot);
if (wide) {
  state.legs = [...new Set(snapshot.contracts.map(leg => leg.expiry))].sort().flatMap(expiry => {
    const calls = snapshot.contracts.filter(leg => leg.expiry === expiry && leg.type === 'call').sort((a, b) => Math.abs(a.strike - snapshot.spot) - Math.abs(b.strike - snapshot.spot) || a.strike - b.strike).slice(0, 2).sort((a, b) => a.strike - b.strike);
    assert.equal(calls.length, 2);
    return calls.map((leg, i) => marketLeg(leg, i ? 'short' : 'long', 1, leg.contractId, state.pricing.basis));
  });
  state.pricing.entryMode = 'fixed';
  state.name = 'Four-expiry paired calls';
  assert.equal(state.legs.length, 8);
  assert.deepEqual(validateMarketStrategy(state, snapshot), []);
}
if (traceReadonly) state.feeAllowance = 5;
const original = structuredClone(state);
const post = (route, body) => fetch(`${base}${route}`, { method: 'POST', headers: { 'content-type': 'application/json', Origin: base, 'X-ARGUS-Request': '1' }, body: JSON.stringify(body), signal: AbortSignal.timeout(45000) });
const calculated = await post('/api/calculate', state);
assert.equal(calculated.status, 200);
assert.deepEqual((await calculated.json()).metrics, calculateStrategy(state));
const forged = structuredClone(state);
if (wide) forged.legs[0].iv += 1;
else forged.legs[0].entryPrice += 1;
assert.equal((await post('/api/calculate', forged)).status, 422);
assert.equal((await post('/api/calculate', { ...state, pricing: { ...state.pricing, snapshotId: 'unknown' } })).status, 409);
if (optimizer) {
  const search = { targetSpot: state.spot * 1.02, targetDate: state.scenarioDate, maxLoss: 1000, feeAllowance: 5, basis: 'mid', objective: 'target-pnl' };
  const response = await post('/api/candidates', { state, search });
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body.error));
  assertSearchEqual(body.search, searchCandidates(state, snapshot, search));
  const blendedSearch = { ...search, objective: 'balanced', chanceWeight: 50 };
  const blendedResponse = await post('/api/candidates', { state, search: blendedSearch });
  assert.equal(blendedResponse.status, 200);
  const blended = (await blendedResponse.json()).search;
  assertSearchEqual(blended, searchCandidates(state, snapshot, blendedSearch));
  assert.ok(blended.candidates.length > 0);
  assert.ok(body.search.candidates.length > 0);
  for (const candidate of body.search.candidates) {
    assert.deepEqual(candidate.metrics, calculateStrategy(candidate.state));
    assert.deepEqual(validateMarketStrategy(candidate.state, snapshot), []);
    assert.ok(candidate.metrics.maxLoss <= search.maxLoss);
  }
  const domain = { families: ['covered-call', 'protective-put', 'collar'], maxEntryOutlay: state.spot * 105 };
  const stockSearch = { ...search, maxLoss: state.spot * 105 };
  const stockResponse = await post('/api/candidates', { state, search: stockSearch, domain });
  const stockBody = await stockResponse.json();
  assert.equal(stockResponse.status, 200, JSON.stringify(stockBody.error));
  assertSearchEqual(stockBody.search, searchCandidates(state, snapshot, stockSearch, domain));
  assert.ok(stockBody.search.candidates.length > 0);
  for (const candidate of stockBody.search.candidates) {
    assert.deepEqual(candidate.state.stock, { shares: 100, entryPrice: snapshot.spot });
    assert.deepEqual(candidate.metrics, calculateStrategy(candidate.state));
    assert.deepEqual(validateMarketStrategy(candidate.state, snapshot), []);
    assert.ok(Math.max(0, -candidate.metrics.entryAccounting.netEntryCashFlowAfterAllowance) <= domain.maxEntryOutlay);
  }
  const mixedState = { ...state, valuationModel: 'american-crr-1024-v1' };
  const mixedDomain = { families: ['call-calendar', 'put-calendar', 'call-diagonal', 'put-diagonal'], maxEntryOutlay: 5000 };
  const mixedSearch = { ...search, maxLoss: 5000 };
  const mixedResponse = await post('/api/candidates', { state: mixedState, search: mixedSearch, domain: mixedDomain });
  const mixedBody = await mixedResponse.json();
  assert.equal(mixedResponse.status, 200, JSON.stringify(mixedBody.error));
  assert.ok(mixedBody.search.candidates.length > 0);
  for (const candidate of mixedBody.search.candidates) {
    const short = candidate.state.legs.find(leg => leg.side === 'short'), long = candidate.state.legs.find(leg => leg.side === 'long');
    assert.equal(candidate.state.legs.length, 2); assert.equal(short.type, long.type);
    assert.ok(Date.parse(short.expiry) < Date.parse(long.expiry));
    const debit = (long.entryPrice - short.entryPrice) * 100 + mixedSearch.feeAllowance;
    const bound = Math.max(0, debit + 100 * Math.max(0, long.type === 'call' ? long.strike - short.strike : short.strike - long.strike));
    assert.ok(Math.abs(candidate.lossBound.amount - bound) < 1e-8);
    assert.equal(candidate.lossBound.date, short.expiry);
    assert.ok(bound <= mixedSearch.maxLoss && Math.max(0, debit) <= mixedDomain.maxEntryOutlay);
    assert.equal(candidate.metrics.maxLoss, null); assert.equal(candidate.probability.probability, null);
    assert.deepEqual(candidate.metrics, calculateStrategy(candidate.state));
    assert.deepEqual(validateMarketStrategy(candidate.state, snapshot), []);
  }
  assert.deepEqual(state, original);
  console.log(JSON.stringify({ passed: true, contracts: snapshot.contracts.length, retrievedAt: snapshot.retrievedAt, spotAsOf: snapshot.spotAsOf, oldestQuote: snapshot.contracts.map(c => c.quoteAsOf).sort()[0], evaluated: body.search.evaluated, eligible: body.search.eligible, returned: body.search.candidates.length, stockEvaluated: stockBody.search.evaluated, stockReturned: stockBody.search.candidates.length, mixedEvaluated: mixedBody.search.evaluated, mixedReturned: mixedBody.search.candidates.length, inferenceRequests: 0, sourceUnchanged: true, coverage: body.search.coverage }));
  process.exit(0);
}
const target = { scenarioDate: state.scenarioDate, scenarioSpot: state.spot, ivShift: 0, legIvShifts: state.legs.map((leg, i) => ({ legId: leg.id, ivShift: (i + 1) / 100 })) };
const prompts = wide ? [`Read-only: price exactly this one hypothetical scenario with evaluate_scenarios: ${JSON.stringify(target)}. Include every listed leg adjustment exactly once. Explain the scenario P/L versus the current baseline, with the first-expiry horizon and mixed-expiry limitations. These fixed analysis entries are not confirmed fills. Do not search, change the builder or claim execution.`] : traceReadonly ? ['Explain this quoted long call read-only. State the quote dates separately from retrieval time; do not claim fresh or executable prices. Explain gross entry cost, the $5 modeled allowance, net cost and intact-expiry risk using supplied facts. Do not search alternatives, request additional scenarios or change the position.'] : ['Explain the biggest risk in this quoted long call. Use its actual quote snapshot, not sample numbers. Do not change the builder.', 'Replace this position with a bull-call template using the loaded quote snapshot.'];
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
  if (wide || prompt.startsWith('Explain')) assert.equal(result.reply.operations.length, 0);
  else { assert.ok(result.reply.operations.length); assert.equal(result.next_state.name, 'Bull Call Spread'); }
  if (traceReadonly) {
    assert.equal(result.request_id, requestId);
    assert.equal(result.base_state_version, original.version);
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    assert.deepEqual(result.next_state, { ...original, version: original.version + 1 });
    assert.deepEqual(result.calculated.metrics, calculateStrategy(original));
    assert.deepEqual(state, original);
    if (wide) {
      assert.equal(result.calculated.requestedScenarios.length, 1);
      const point = result.calculated.requestedScenarios[0];
      assert.deepEqual(point.scenario, target);
      assert.equal(point.legVolatilities.length, 8);
      const repriced = { ...original, ...target, ivShift: 0, expiryIvShifts: [], legs: original.legs.map((leg, i) => ({ ...leg, iv: leg.iv + target.legIvShifts[i].ivShift })) };
      assert.deepEqual(point.metrics, evaluateScenario(repriced));
      const singleLegSum = repriced.legs.reduce((sum, leg) => sum + evaluateScenario({ ...repriced, legs: [leg], feeAllowance: 0 }).pnl, 0) - original.feeAllowance;
      assert.ok(Math.abs(point.metrics.pnl - singleLegSum) < 1e-6, 'Scenario P/L must reconcile to independently repriced legs and one allowance');
    }
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
    if (wide) assert.equal(requests.length, 3, 'One generation, one tool continuation and one verifier required');
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
console.log(`Live chain contract checks passed: ${snapshot.contracts.length} contracts, calculator agreement, forged-input rejection, snapshot expiry guard and ${wide ? 'eight-leg four-expiry scenario with persisted trace' : traceReadonly ? 'read-only analysis with persisted trace' : 'real-contract proposal'}. Review free-text correctness separately.`);
