import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

if (!process.argv.includes('--run')) throw new Error('Pass --run to create and remove one synthetic local saved-position test record. No orders, inference or provider calls.');
registerHooks({ resolve(specifier, context, next) { return next(specifier.startsWith('.') && !/\.[a-z]+$/i.test(specifier) ? new URL(`${specifier}.ts`, context.parentURL).href : specifier, context); } });
const { createMarketStrategy } = await import('../src/options.ts');
const { createPosition } = await import('../src/position-lifecycle.ts');
const base = 'http://127.0.0.1:5173';
const call = (path, body, method = body === undefined ? 'GET' : 'POST') => fetch(`${base}/api/strategies${path}`, { method, headers: { 'Content-Type': 'application/json', Origin: base, 'X-ARGUS-Request': '1' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(15000) });
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
