import { beforeAll, expect, it, vi } from 'vitest';
import { env } from 'cloudflare:workers';
import migration from '../migrations/0003_quote_snapshots.sql?raw';
import promptMigration from '../migrations/0004_analysis_prompts.sql?raw';
import traceMigration from '../migrations/0005_analysis_traces.sql?raw';
import { createApp } from '../src/worker';
import { createOptionChainStore } from '../src/option-chain';
import { createMarketStrategy, type MarketSnapshot } from '../src/options';
import candidate from '../prompts/analysis-v3.json';
import withoutIv from '../prompts/analysis-v2.json';
import { readAnalysisPrompts } from '../src/analysis-prompts';
import { promptDigest, ANALYSIS_ENGINE_VERSION } from '../src/analysis-config';

const db = (env as { DB: D1Database }).DB;
beforeAll(async () => { await db.batch([...migration.split(';'), ...promptMigration.split(/;\s*(?=CREATE|$)/), ...traceMigration.split(/;\s*(?=CREATE|$)/)].filter(sql => sql.trim()).map(sql => db.prepare(sql))); });
const snapshot: MarketSnapshot = { id: 'original', source: 'Tastytrade', underlying: 'SPY', spot: 100, spotAsOf: '2026-09-04T20:00:00Z', retrievedAt: '2026-09-04T20:00:00Z', availableExpiries: ['2099-09-18'], contracts: [{ contractId: 'SPY   990918C00100000', type: 'call', strike: 100, expiry: '2099-09-18T20:00:00Z', multiplier: 100, bid: 2, ask: 3, iv: .3, quoteAsOf: '2026-09-04T20:00:00Z' }] };
const range = { start: Date.parse('2026-09-04T13:30:00Z'), end: Date.parse('2026-09-04T13:40:00Z') };
const request = (body: unknown, discuss = false) => new Request(`http://127.0.0.1/api/intraday-history${discuss ? '/discuss' : ''}`, { method: 'POST', headers: { 'content-type': 'application/json', origin: 'http://127.0.0.1', 'X-ARGUS-Request': '1' }, body: JSON.stringify(body) });
const ivRequest = (body: unknown) => { const original = request(body); return new Request(original.url + '/iv', original); };
const ivDiscussRequest = (body: unknown) => { const original = request(body); return new Request(original.url + '/iv-discuss', original); };
function fixture() {
  const provider = vi.fn<typeof fetch>(async () => { throw new Error('Unexpected direct provider access'); });
  const bars = [{ time: range.start, count: 1, open: 2, high: 3, low: 2, close: 2.5, volume: null }];
  const feed = vi.fn(async (_request: Request) => Response.json({ underlying: { symbol: 'SPY', basis: 'last-trade', bars }, contracts: [{ contractId: snapshot.contracts[0].contractId, basis: 'midpoint', bars }] }));
  const getByName = vi.fn((_name: string) => ({ fetch: feed }));
  const bindings = { DB: db, ARGUS_LOCAL_DEV: 'true', TASTYTRADE_CLIENT_SECRET: 'synthetic-secret', TASTYTRADE_REFRESH_TOKEN: 'synthetic-refresh', FEED: { getByName } as unknown as DurableObjectNamespace };
  return { provider, feed, getByName, bindings, app: createApp(provider) };
}

it('reloads owned IV for tool-free discussion and binds the verified response to contract and bucket', async () => {
  const f = fixture(), owned = await createOptionChainStore(f.provider).restore(snapshot, f.bindings, 'local-development');
  const state = createMarketStrategy('long-call', owned), before = structuredClone(state);
  const payload = { state, range, contractId: state.legs[0].contractId, selectedTime: range.start, request_id: 'iv-question', conversation: [{ role: 'user', content: 'Explain the IV.' }] };
  const bindings = { ...f.bindings, OPENROUTER_API_KEY: 'synthetic' };
  for (const invalid of [{ ...payload, history: {} }, { ...payload, contractId: 'foreign' }, { ...payload, selectedTime: range.end }, { ...payload, conversation: [] }]) expect((await f.app.fetch(ivDiscussRequest(invalid), bindings)).status).toBe(400);
  const foreign = await createOptionChainStore(f.provider).restore(snapshot, f.bindings, 'other-owner');
  expect((await f.app.fetch(ivDiscussRequest({ ...payload, state: createMarketStrategy('long-call', foreign) }), bindings)).status).toBe(409);
  expect((await f.app.fetch(ivDiscussRequest(payload), { ...bindings, SPARRING_RATE_LIMITER: { limit: async () => ({ success: false }) } })).status).toBe(429);
  expect(f.feed).not.toHaveBeenCalled(); expect(f.provider).not.toHaveBeenCalled();
  f.feed.mockImplementation(async () => Response.json({ contracts: [{ contractId: payload.contractId, basis: 'trade-candle', bars: [{ time: range.start, iv: 0 }] }] }));
  const missing = readAnalysisPrompts(withoutIv);
  await db.prepare('INSERT INTO analysis_prompt_bundles VALUES (?, ?, ?, ?, ?)').bind(missing.version, await promptDigest(missing), ANALYSIS_ENGINE_VERSION, JSON.stringify(missing), '2026-09-07T00:00:00Z').run();
  await db.prepare('INSERT INTO analysis_prompt_active VALUES (1, ?)').bind(missing.version).run();
  try {
    expect((await f.app.fetch(ivDiscussRequest(payload), bindings)).status).toBe(502);
    expect(f.provider).not.toHaveBeenCalled();
  } finally { await db.prepare('DELETE FROM analysis_prompt_active').run(); }
  const prompts = readAnalysisPrompts(candidate);
  await db.prepare('INSERT INTO analysis_prompt_bundles VALUES (?, ?, ?, ?, ?)').bind(prompts.version, await promptDigest(prompts), ANALYSIS_ENGINE_VERSION, JSON.stringify(prompts), '2026-09-07T00:00:00Z').run();
  await db.prepare('INSERT INTO analysis_prompt_active VALUES (1, ?)').bind(prompts.version).run();
  const reply = { text: 'Zero is reported IV, not missing data.', assumptions: [], objections: [], suggested_prompts: [] };
  let valid = true;
  f.provider.mockImplementation(async (_url, init) => {
    const body = JSON.parse(String(init?.body)), input = JSON.parse(body.messages[1].content);
    expect(body.tools).toBeUndefined(); expect(input.historyDisplay).toBeUndefined();
    expect(input.facts.basis).toBe('option-trade-candle-iv'); expect(input.facts.contract.contractId).toBe(payload.contractId);
    expect(input.facts.selected).toEqual({ time: new Date(range.start).toISOString(), iv: 0 });
    expect(input.facts.summary.missing).toBe(1);
    return Response.json({ choices: [{ message: { content: JSON.stringify(input.reply ? { valid } : reply) } }] });
  });
  try {
    const response = await f.app.fetch(ivDiscussRequest(payload), bindings), body = await response.json() as any;
    expect(response.status).toBe(200); expect(response.headers.get('X-ARGUS-Trace-Status')).toBe('complete');
    expect(body).toMatchObject({ reply, contractId: payload.contractId, selectedTime: payload.selectedTime, request_id: payload.request_id, snapshotId: owned.id, positionVersion: state.version, range });
    expect(new URL(f.feed.mock.calls.at(-1)![0].url).pathname).toBe('/history-iv');
    expect(f.provider).toHaveBeenCalledTimes(2); expect(state).toEqual(before);
    valid = false;
    const rejected = await f.app.fetch(ivDiscussRequest(payload), bindings);
    expect(rejected.status).toBe(502); expect(await rejected.text()).not.toContain(reply.text);
    let calls = 0, release!: () => void;
    f.provider.mockImplementation(async () => {
      if (++calls === 1) return Response.json({ choices: [{ message: { content: JSON.stringify(reply) } }] });
      return new Response(new ReadableStream({ start(controller) { release = () => { controller.enqueue(new TextEncoder().encode(JSON.stringify({ choices: [{ message: { content: '{"valid":true}' } }] }))); controller.close(); }; } }));
    });
    const pending = f.app.fetch(ivDiscussRequest(payload), bindings);
    await vi.waitFor(() => expect(calls).toBe(2));
    const expiresAt = Number(f.feed.mock.calls.at(-1)![0].headers.get('X-ARGUS-Feed-Expires-At'));
    const clock = vi.spyOn(Date, 'now').mockReturnValue(expiresAt + 1);
    try { release(); const expired = await pending; expect(expired.status).toBe(502); expect(await expired.text()).not.toContain(reply.text); }
    finally { clock.mockRestore(); }
  } finally { await db.prepare('DELETE FROM analysis_prompt_active').run(); }
});

it('serves owned exact-contract IV through private admission without inference or position changes', async () => {
  const f = fixture(), owned = await createOptionChainStore(f.provider).restore(snapshot, f.bindings, 'local-development');
  const state = createMarketStrategy('long-call', owned), before = structuredClone(state);
  f.feed.mockResolvedValue(Response.json({ contracts: [{ contractId: state.legs[0].contractId, basis: 'trade-candle', bars: [{ time: range.start, iv: 0 }] }] }));
  const response = await f.app.fetch(ivRequest({ state, range }), f.bindings);
  expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('no-store');
  expect(await response.json()).toEqual({ snapshotId: owned.id, positionVersion: state.version, range, history: { source: 'Tastytrade DXLink', intervalMs: 300000, basis: 'option-trade-candle-iv', rows: [
    { time: range.start, legs: [{ contractId: state.legs[0].contractId, iv: 0 }] },
    { time: range.start + 300000, legs: [{ contractId: state.legs[0].contractId, iv: null }] },
  ] } });
  expect(new URL(f.feed.mock.calls[0][0].url).pathname).toBe('/history-iv');
  expect(state).toEqual(before); expect(f.provider).not.toHaveBeenCalled();
});

it('rejects unauthorized, foreign and malformed IV requests and never accepts midpoint history as IV', async () => {
  const f = fixture(), store = createOptionChainStore(f.provider), owned = await store.restore(snapshot, f.bindings, 'local-development');
  const foreign = await store.restore(snapshot, f.bindings, 'other-owner'), state = createMarketStrategy('long-call', owned);
  expect((await f.app.fetch(ivRequest({ state, range }), {})).status).not.toBe(200);
  const crossSite = ivRequest({ state, range }); crossSite.headers.delete('X-ARGUS-Request');
  expect((await f.app.fetch(crossSite, f.bindings)).status).toBe(403);
  expect((await f.app.fetch(ivRequest({ state: createMarketStrategy('long-call', foreign), range }), f.bindings)).status).toBe(409);
  expect((await f.app.fetch(ivRequest({ state, range, conversation: [] }), f.bindings)).status).toBe(400);
  expect((await f.app.fetch(ivRequest({ state, range: { ...range, end: range.start } }), f.bindings)).status).toBe(400);
  expect((await f.app.fetch(ivRequest({ state, range }), { ...f.bindings, SPARRING_RATE_LIMITER: { limit: async () => ({ success: false }) } })).status).toBe(429);
  expect(f.feed).not.toHaveBeenCalled();
  expect((await f.app.fetch(ivRequest({ state, range }), f.bindings)).status).toBe(503);
  expect(f.provider).not.toHaveBeenCalled();
});

it('reloads owned intraday facts for verified discussion, rejecting supplied facts and invalid selection before access', async () => {
  const f = fixture(), owned = await createOptionChainStore(f.provider).restore(snapshot, f.bindings, 'local-development');
  const state = createMarketStrategy('long-call', owned), before = structuredClone(state);
  const payload = { state, range, selectedTime: range.start, request_id: 'intraday-question', conversation: [{ role: 'user', content: 'Explain this interval.' }] };
  const bindings = { ...f.bindings, OPENROUTER_API_KEY: 'synthetic' };
  for (const invalid of [{ ...payload, history: {} }, { ...payload, selectedTime: range.end }, { ...payload, selectedTime: String(range.start) }, { ...payload, conversation: [] }]) expect((await f.app.fetch(request(invalid, true), bindings)).status).toBe(400);
  expect((await f.app.fetch(request(payload, true), f.bindings)).status).toBe(503);
  const foreign = await createOptionChainStore(f.provider).restore(snapshot, f.bindings, 'other-owner');
  expect((await f.app.fetch(request({ ...payload, state: createMarketStrategy('long-call', foreign) }, true), bindings)).status).toBe(409);
  expect(f.feed).not.toHaveBeenCalled(); expect(f.provider).not.toHaveBeenCalled();
  const reply = { text: 'The selected inventory estimate is $250, not a fill or P/L.', assumptions: [], objections: [], suggested_prompts: [] };
  f.provider.mockImplementation(async (_url, init) => {
    const input = JSON.parse(String(init?.body)), facts = JSON.parse(input.messages[1].content);
    expect(input.tools).toBeUndefined(); expect(facts.facts.selectedTime).toBe('2026-09-04T13:30:00.000Z');
    expect(facts.facts.history.rows[0].value).toBe(250); expect(facts.facts.history.rows[1].value).toBeNull();
    return Response.json({ choices: [{ message: { content: JSON.stringify(facts.reply ? { valid: true } : reply) } }] });
  });
  const response = await f.app.fetch(request(payload, true), bindings), body = await response.json() as any;
  expect(response.headers.get('X-ARGUS-Trace-Status')).toBe('complete');
  expect(response.headers.get('X-ARGUS-Trace-Id')).toMatch(/^[a-f0-9-]{36}$/);
  expect(response.status).toBe(200); expect(body.reply).toEqual(reply); expect(body.request_id).toBe(payload.request_id); expect(body.selectedTime).toBe(range.start);
  expect(body.history.rows[0].value).toBe(250); expect(f.feed).toHaveBeenCalledOnce(); expect(f.provider).toHaveBeenCalledTimes(2); expect(state).toEqual(before);
  f.provider.mockImplementation(async () => Response.json({ choices: [{ message: { content: JSON.stringify({ valid: false }) } }] }));
  const rejected = await f.app.fetch(request(payload, true), bindings);
  expect(rejected.status).toBe(502); expect(await rejected.text()).not.toContain('"reply"');
  expect(rejected.headers.get('X-ARGUS-Trace-Status')).toBe('complete');
});

it('withholds a verified discussion when its authenticated session expires during inference', async () => {
  const f = fixture(), owned = await createOptionChainStore(f.provider).restore(snapshot, f.bindings, 'local-development'), state = createMarketStrategy('long-call', owned);
  const reply = { text: 'Synthetic reply', assumptions: [], objections: [], suggested_prompts: [] };
  let calls = 0, release!: () => void;
  f.provider.mockImplementation(async () => {
    if (++calls === 1) return Response.json({ choices: [{ message: { content: JSON.stringify(reply) } }] });
    return new Response(new ReadableStream({ start(controller) { release = () => { controller.enqueue(new TextEncoder().encode(JSON.stringify({ choices: [{ message: { content: '{"valid":true}' } }] }))); controller.close(); }; } }));
  });
  const pending = f.app.fetch(request({ state, range, selectedTime: range.start, request_id: 'expires', conversation: [{ role: 'user', content: 'Explain.' }] }, true), { ...f.bindings, OPENROUTER_API_KEY: 'synthetic' });
  await vi.waitFor(() => expect(calls).toBe(2));
  const expiresAt = Number(f.feed.mock.calls[0][0].headers.get('X-ARGUS-Feed-Expires-At'));
  const clock = vi.spyOn(Date, 'now').mockReturnValue(expiresAt + 1);
  try { release(); const response = await pending; expect(response.status).toBe(502); expect(await response.text()).not.toContain('Synthetic reply'); }
  finally { clock.mockRestore(); }
});

it('loads owned intraday data through shared admission and returns dated gaps without modifying state', async () => {
  const f = fixture(), owned = await createOptionChainStore(f.provider).restore(snapshot, f.bindings, 'local-development');
  const state = createMarketStrategy('long-call', owned), before = structuredClone(state);
  const response = await f.app.fetch(request({ state, range }), f.bindings);
  expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('no-store');
  const body = await response.json() as any;
  expect(body.snapshotId).toBe(owned.id); expect(body.positionVersion).toBe(state.version); expect(body.range).toEqual(range);
  expect(body.history).toMatchObject({ source: 'Tastytrade DXLink', intervalMs: 300000, basis: 'option-midpoints', rows: [{ time: range.start, value: 250 }, { time: range.start + 300000, value: null }] });
  expect(f.feed).toHaveBeenCalledOnce(); expect(f.getByName.mock.calls[0][0]).toMatch(/^[a-f0-9]{64}$/);
  const internal = f.feed.mock.calls[0][0];
  expect(internal.method).toBe('POST'); expect(new URL(internal.url).pathname).toBe('/history');
  expect(JSON.parse(internal.headers.get('X-ARGUS-Feed-Selection')!)).toEqual({ underlying: 'SPY', contractIds: [state.legs[0].contractId] });
  expect(JSON.parse(internal.headers.get('X-ARGUS-History-Range')!)).toEqual(range);
  expect(Number(internal.headers.get('X-ARGUS-Feed-Expires-At'))).toBeGreaterThan(Date.now());
  expect(state).toEqual(before); expect(f.provider).not.toHaveBeenCalled();
});

it('loads an exact owned seven-day range and rejects an eighth day before feed access', async () => {
  const f = fixture(), owned = await createOptionChainStore(f.provider).restore(snapshot, f.bindings, 'local-development');
  const state = createMarketStrategy('long-call', owned), week = { start: Date.parse('2026-08-31T00:00:00Z'), end: Date.parse('2026-09-07T00:00:00Z') };
  const response = await f.app.fetch(request({ state, range: week }), f.bindings);
  expect(response.status).toBe(200);
  const body = await response.json() as any;
  expect(body.range).toEqual(week); expect(body.history.rows).toHaveLength(2016);
  expect(body.history.rows.find((row: any) => row.time === range.start).value).toBe(250);
  expect(JSON.parse(f.feed.mock.calls[0][0].headers.get('X-ARGUS-History-Range')!)).toEqual(week);
  expect((await f.app.fetch(request({ state, range: { ...week, start: week.start - 300000 } }), f.bindings)).status).toBe(400);
  expect(f.feed).toHaveBeenCalledOnce(); expect(f.provider).not.toHaveBeenCalled();
});

it('rejects unauthorized, foreign, mismatched, malformed and rate-limited requests before shared feed access', async () => {
  const f = fixture(), store = createOptionChainStore(f.provider);
  const owned = await store.restore(snapshot, f.bindings, 'local-development'), foreign = await store.restore(snapshot, f.bindings, 'other-owner');
  const state = createMarketStrategy('long-call', owned);
  expect((await f.app.fetch(request({ state, range }), {})).status).not.toBe(200);
  const crossSite = request({ state, range }); crossSite.headers.delete('X-ARGUS-Request');
  expect((await f.app.fetch(crossSite, f.bindings)).status).toBe(403);
  expect((await f.app.fetch(request({ state: createMarketStrategy('long-call', foreign), range }), f.bindings)).status).toBe(409);
  const wrong = structuredClone(state); wrong.legs[0].strike++;
  expect((await f.app.fetch(request({ state: wrong, range }), f.bindings)).status).toBe(422);
  for (const body of [{ state, range, history: {} }, { state, range: { ...range, end: range.start } }, { state, range: { ...range, extra: true } }]) expect((await f.app.fetch(request(body), f.bindings)).status).toBe(400);
  expect((await f.app.fetch(request({ state, range }), { ...f.bindings, SPARRING_RATE_LIMITER: { limit: async () => ({ success: false }) } })).status).toBe(429);
  expect((await f.app.fetch(request({ state, range }), { ...f.bindings, FEED: undefined })).status).toBe(503);
  expect(f.getByName).not.toHaveBeenCalled(); expect(f.provider).not.toHaveBeenCalled();
});

it('withholds invalid or failed service responses instead of returning manufactured history', async () => {
  const f = fixture(), owned = await createOptionChainStore(f.provider).restore(snapshot, f.bindings, 'local-development'), state = createMarketStrategy('long-call', owned);
  for (const result of [Response.json({ private: 'upstream failure' }, { status: 503 }), Response.json({ underlying: { symbol: 'QQQ', basis: 'last-trade', bars: [] }, contracts: [] })]) {
    f.feed.mockResolvedValueOnce(result);
    const response = await f.app.fetch(request({ state, range }), f.bindings);
    expect(response.status).toBe(503); expect(await response.text()).not.toMatch(/private|upstream failure|QQQ/);
  }
});

it.each([false, true])('withholds a history body after session expiry (IV=%s)', async iv => {
  const f = fixture(), owned = await createOptionChainStore(f.provider).restore(snapshot, f.bindings, 'local-development'), state = createMarketStrategy('long-call', owned);
  let release!: () => void;
  const data = iv ? { contracts: [{ contractId: state.legs[0].contractId, basis: 'trade-candle', bars: [] }] } : { underlying: { symbol: 'SPY', basis: 'last-trade', bars: [] }, contracts: [{ contractId: state.legs[0].contractId, basis: 'midpoint', bars: [] }] };
  const stream = new ReadableStream({ start(controller) { release = () => { controller.enqueue(new TextEncoder().encode(JSON.stringify(data))); controller.close(); }; } });
  f.feed.mockResolvedValueOnce(new Response(stream));
  const pending = f.app.fetch((iv ? ivRequest : request)({ state, range }), f.bindings);
  await vi.waitFor(() => expect(f.feed).toHaveBeenCalledOnce());
  const expiresAt = Number(f.feed.mock.calls[0][0].headers.get('X-ARGUS-Feed-Expires-At'));
  const clock = vi.spyOn(Date, 'now').mockReturnValue(expiresAt + 1);
  try { release(); expect((await pending).status).toBe(503); }
  finally { clock.mockRestore(); }
});
