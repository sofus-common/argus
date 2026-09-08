import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

if (!process.argv.includes('--run')) throw new Error('Pass --run to create and remove one synthetic local saved-position test record. Optional --discuss adds two paid inference calls; no orders or historical-provider calls.');
registerHooks({ resolve(specifier, context, next) { return next(specifier.startsWith('.') && !/\.[a-z]+$/i.test(specifier) ? new URL(`${specifier}.ts`, context.parentURL).href : specifier, context); } });
const { createMarketStrategy } = await import('../src/options.ts');
const { createPosition } = await import('../src/position-lifecycle.ts');
const base = 'http://127.0.0.1:5173';
const call = (path, body, method = body === undefined ? 'GET' : 'POST', timeout = 15000) => fetch(`${base}/api/strategies${path}`, { method, headers: { 'Content-Type': 'application/json', Origin: base, 'X-ARGUS-Request': '1' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(timeout) });
const stamp = '2026-09-01T12:00:00.000Z';
const snapshot = { id: 'synthetic-performance-proof', source: 'Tastytrade', underlying: 'SPY', spot: 100, spotAsOf: stamp, retrievedAt: stamp, availableExpiries: ['2026-10-09'], contracts: [{ contractId: 'SPY   261009C00100000', type: 'call', strike: 100, expiry: '2026-10-09T20:00:00.000Z', multiplier: 100, bid: 1.9, ask: 2.1, iv: .2, quoteAsOf: stamp }] };
const state = createMarketStrategy('long-call', snapshot);
state.pricing.entryMode = 'fixed'; state.feeAllowance = 7;
const input = { format: 'argus-saved-position', formatVersion: 1, exportedAt: new Date().toISOString(), record: { id: 'synthetic-source', title: 'SYNTHETIC local performance verification', revision: 1, createdAt: stamp, updatedAt: stamp, state, snapshot, lifecycle: createPosition(state) } };
let record, createdId;
try {
  const imported = await call('/import', input);
  assert.equal(imported.status, 201, 'Synthetic import must succeed');
  record = (await imported.json()).record;
  createdId = record.id;
  const loaded = await call(`/${record.id}/lots`);
  assert.equal(loaded.status, 200);
  const held = (await loaded.json()).projection.lots[0];
  const at = '2026-09-02T12:00:00.000Z';
  const replacement = { ...held.asset, contractId: 'SPY   261016C00105000', strike: 105, expiry: '2026-10-16T20:00:00.000Z' };
  const transaction = { id: crypto.randomUUID(), at, recordedAt: at, closes: [{ id: crypto.randomUUID(), lotId: held.id, quantity: 1, price: 3 }], opens: [{ id: 'replacement', asset: replacement, side: 'long', quantity: 1, entryPrice: 4 }] };
  const preview = await call(`/${record.id}/transactions/preview`, { revision: record.revision, transaction });
  assert.equal(preview.status, 200);
  const rolled = await call(`/${record.id}/transactions`, { revision: record.revision, transaction });
  assert.equal(rolled.status, 200); record = (await rolled.json()).record;
  assert.equal(record.id, createdId);
  assert.deepEqual(record.lifecycle.transactions[0].opens[0].asset, replacement);
  const end = '2026-09-03T12:00:00.000Z';
  const close = { id: crypto.randomUUID(), at: end, recordedAt: end, closes: [{ id: crypto.randomUUID(), lotId: 'replacement', quantity: 1, price: 5 }], opens: [] };
  const closed = await call(`/${record.id}/transactions`, { revision: record.revision, transaction: close });
  assert.equal(closed.status, 200); record = (await closed.json()).record;
  assert.equal(record.id, createdId);
  const range = { start: '2026-09-03', end: '2026-09-04' };
  const stale = await call(`/${record.id}/performance`, { revision: record.revision - 1, range });
  assert.equal(stale.status, 409);
  const performance = await call(`/${record.id}/performance`, { revision: record.revision, range });
  assert.equal(performance.status, 200);
  const body = await performance.json();
  assert.equal(body.savedId, createdId); assert.equal(body.revision, record.revision);
  assert.deepEqual(body.performance.rows.map(row => [row.status, row.grossRealizedPnl, row.unrealizedPnl, row.allowance, row.combinedPnl, row.changeUsd]), [['closed', 200, 0, 7, 193, null], ['closed', 200, 0, 7, 193, 0]]);
  if (process.argv.includes('--discuss')) {
    const requestId = crypto.randomUUID();
    const response = await call(`/${record.id}/performance/discuss`, { revision: record.revision, range, selectedDate: range.end, request_id: requestId, conversation: [{ role: 'user', content: 'Explain why recorded net P/L is $193 rather than gross realized $200, and why daily change is zero on September 4. Is another $7 deducted on September 4? Distinguish the closed recorded results from a current theoretical price or investment forecast. Do not invent percentage returns or change anything.' }] }, 'POST', 65000);
    const result = await response.json();
    console.log(JSON.stringify({ discussionStatus: response.status, traceId: response.headers.get('X-ARGUS-Trace-Id'), facts: body.performance, reply: result.reply, error: result.error }));
    assert.equal(response.status, 200, 'Recorded-performance discussion must pass');
    assert.equal(result.request_id, requestId); assert.equal(result.savedId, createdId); assert.equal(result.revision, record.revision); assert.equal(result.selectedDate, range.end);
    assert.deepEqual(result.performance, body.performance);
    assert.deepEqual(Object.keys(result.reply).sort(), ['assumptions', 'objections', 'suggested_prompts', 'text']);
    const unchanged = await call(`/${record.id}/export`); assert.equal(unchanged.status, 200);
    assert.deepEqual((await unchanged.json()).record, record, 'Discussion changed saved accounting');
  }
  const exported = await call(`/${record.id}/export`);
  assert.equal(exported.status, 200);
  assert.deepEqual((await exported.json()).record.lifecycle, record.lifecycle);
  const revisited = await call(`/${record.id}/lots`);
  assert.equal(revisited.status, 200);
  assert.equal((await revisited.json()).projection.netClosedPnl, 193);
  console.log(JSON.stringify({ passed: true, workflow: 'synthetic import -> preview changed-strike/expiry roll -> record roll -> close -> stale revision rejected -> closed daily P/L -> export -> revisit', netClosedPnl: 193, realHistoricalData: false, providerRetrieval: 'not required by closed-only calculation; not instrumented' }));
} finally {
  if (createdId) {
    const removed = await call(`/${createdId}`, { revision: record.revision }, 'DELETE');
    assert.equal(removed.status, 200, `Remove synthetic test record ${createdId} manually if its revision changed`);
    console.log('Removed only the synthetic record created by this run.');
  }
}
