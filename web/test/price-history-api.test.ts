import { beforeAll, expect, it, vi } from 'vitest'
import { env } from 'cloudflare:workers'
import migration from '../migrations/0003_quote_snapshots.sql?raw'
import promptMigration from '../migrations/0004_analysis_prompts.sql?raw'
import traceMigration from '../migrations/0005_analysis_traces.sql?raw'
import { createApp } from '../src/worker'
import { createOptionChainStore } from '../src/option-chain'
import { createMarketStrategy, type MarketSnapshot } from '../src/options'

const db = (env as { DB: D1Database }).DB
const bindings = { DB: db, ARGUS_LOCAL_DEV: 'true', THETADATA_TERMINAL_URL: 'http://127.0.0.1:25503' }
beforeAll(async () => { await db.batch([...migration.split(';'), ...promptMigration.split(/;\s*(?=CREATE|$)/), ...traceMigration.split(/;\s*(?=CREATE|$)/)].filter(sql => sql.trim()).map(sql => db.prepare(sql))) })
const snapshot: MarketSnapshot = { id: 'original', source: 'Tastytrade', underlying: 'SPY', spot: 100, spotAsOf: '2026-09-04T20:00:00Z', retrievedAt: '2026-09-04T20:00:00Z', availableExpiries: ['2099-09-18'], contracts: [{ contractId: 'SPY   990918C00100000', type: 'call', strike: 100, expiry: '2099-09-18T20:00:00Z', multiplier: 100, bid: 2, ask: 3, iv: .3, quoteAsOf: '2026-09-04T20:00:00Z' }] }
const range = { start: '2026-09-04', end: '2026-09-04' }
const request = (state: unknown, requestedRange: unknown = range) => new Request('http://127.0.0.1/api/price-history', { method: 'POST', headers: { 'content-type': 'application/json', origin: 'http://127.0.0.1', 'X-ARGUS-Request': '1' }, body: JSON.stringify({ state, range: requestedRange }) })

it('grounds discussion in reloaded owned history and rejects browser facts before provider access', async () => {
  const reply = { text: 'The selected inventory midpoint is $250, not historical P/L.', assumptions: [], objections: [], suggested_prompts: [] }
  let inference = 0
  const provider = vi.fn<typeof fetch>(async (url, init) => {
    const path = new URL(String(url))
    if (path.hostname === 'openrouter.ai') {
      const input = JSON.parse(String(init?.body))
      expect(input.tools).toBeUndefined()
      expect(input.messages[1].content).toContain('"mid":250')
      expect(input.messages[1].content).toContain('"selectedDate":"2026-09-04"')
      return Response.json({ choices: [{ message: { content: JSON.stringify(inference++ ? { valid: true } : reply) } }] })
    }
    const row = { created: '2026-09-04T17:15:00', last_trade: '2026-09-04T16:00:00', bid: 2, ask: 3 }
    return Response.json(path.pathname === '/v3/option/history/eod' ? { response: [{ contract: { symbol: 'SPY', expiration: '2099-09-18', strike: 100, right: 'CALL' }, data: [row] }] } : { response: [{ ...row, bid: 99, ask: 101 }] })
  })
  const owned = await createOptionChainStore(provider).restore(snapshot, bindings, 'local-development')
  const state = createMarketStrategy('long-call', owned), app = createApp(provider)
  const payload = { state, range, selectedDate: range.start, request_id: 'history-question', conversation: [{ role: 'user', content: 'Explain the selected date.' }] }
  const discuss = (body: unknown) => new Request('http://127.0.0.1/api/price-history/discuss', { method: 'POST', headers: { 'content-type': 'application/json', origin: 'http://127.0.0.1', 'X-ARGUS-Request': '1' }, body: JSON.stringify(body) })
  const configured = { ...bindings, OPENROUTER_API_KEY: 'test-only' }
  for (const invalid of [{ ...payload, history: { rows: [] } }, { ...payload, selectedDate: '2026-09-05' }, { ...payload, conversation: [] }]) expect((await app.fetch(discuss(invalid), configured)).status).toBe(400)
  expect((await app.fetch(discuss(payload), bindings)).status).toBe(503)
  const foreign = await createOptionChainStore(provider).restore(snapshot, bindings, 'foreign')
  expect((await app.fetch(discuss({ ...payload, state: createMarketStrategy('long-call', foreign) }), configured)).status).toBe(409)
  expect(provider).not.toHaveBeenCalled()
  const response = await app.fetch(discuss(payload), configured)
  expect(response.status).toBe(200)
  expect(response.headers.get('X-ARGUS-Trace-Status')).toBe('complete')
  expect(response.headers.get('X-ARGUS-Trace-Id')).toMatch(/^[a-f0-9-]{36}$/)
  const body = await response.json() as any
  expect(body.reply).toEqual(reply)
  expect(body.request_id).toBe(payload.request_id)
  expect(body.history.rows[0].value.mid).toBe(250)
  expect(body.selectedDate).toBe(range.start)
  expect(inference).toBe(2)
}, 15000)

it('loads history only for an owned matching snapshot and preserves state', async () => {
  const provider = vi.fn<typeof fetch>(async url => {
    const path = new URL(String(url))
    expect(path.origin).toBe('http://127.0.0.1:25503')
    const row = { created: '2026-09-04T17:15:00', last_trade: '2026-09-04T16:00:00', bid: 2, ask: 3 }
    return Response.json(path.pathname === '/v3/option/history/eod' ? { response: [{ contract: { symbol: 'SPY', expiration: '2099-09-18', strike: 100, right: 'CALL' }, data: [row] }] } : { response: [{ ...row, bid: 99, ask: 101 }] })
  })
  const owned = await createOptionChainStore(provider).restore(snapshot, bindings, 'local-development')
  const state = createMarketStrategy('long-call', owned), before = structuredClone(state)
  const app = createApp(provider)
  const response = await app.fetch(request(state), bindings)
  expect(response.status).toBe(200)
  const body = await response.json() as any
  expect(body.history.rows[0].value).toEqual({ mid: 250, bidSide: 200, askSide: 300 })
  expect(body.snapshotId).toBe(owned.id)
  expect(body.positionVersion).toBe(state.version)
  expect(response.headers.get('Cache-Control')).toBe('no-store')
  expect(provider).toHaveBeenCalledTimes(2)
  expect(state).toEqual(before)
  const corrupted = structuredClone(state); corrupted.legs[0].strike = 101
  expect((await app.fetch(request(corrupted), bindings)).status).toBe(422)
  expect((await app.fetch(request(state, { start: 'bad', end: 'bad' }), bindings)).status).toBe(400)
  expect((await app.fetch(request(state), { ...bindings, SPARRING_RATE_LIMITER: { limit: async () => ({ success: false }) } })).status).toBe(429)
  const crossSite = request(state); crossSite.headers.delete('X-ARGUS-Request')
  expect((await app.fetch(crossSite, bindings)).status).toBe(403)
  expect(provider).toHaveBeenCalledTimes(2)
}, 15000)

it('rejects foreign snapshots and unauthenticated requests before Theta access', async () => {
  const provider = vi.fn<typeof fetch>(async () => { throw new Error('No provider access expected') })
  const foreign = await createOptionChainStore(provider).restore(snapshot, bindings, 'another-owner')
  const state = createMarketStrategy('long-call', foreign), app = createApp(provider)
  expect((await app.fetch(request(state), bindings)).status).toBe(409)
  expect((await app.fetch(request(state), {})).status).not.toBe(200)
  expect(provider).not.toHaveBeenCalled()
})
