import { act, StrictMode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { DraftRecovery } from '../src/DraftRecovery'
import { App } from '../src/App'
import { createStrategy, type MarketSnapshot } from '../src/options'
import { readWorkspaceDraft, type WorkspaceDraft } from '../src/workspace-draft'

const run = document.querySelector<HTMLButtonElement>('#run')!
const results = document.querySelector<HTMLPreElement>('#results')!
const fixture = document.querySelector<HTMLDivElement>('#fixture')!
if (!import.meta.env.DEV) { run.disabled = true; results.textContent = 'Development only' }
else run.onclick = () => void check()

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message) }
function sample(market = false): WorkspaceDraft {
  const state = createStrategy('bull-call')
  let snapshot: MarketSnapshot | null = null
  if (market) {
    state.pricing = { mode: 'market', snapshotId: 'synthetic-original', basis: 'mid', entryMode: 'fixed' }
    state.legs.forEach(leg => { leg.contractId = `SPY   ${leg.expiry.slice(2, 10).replaceAll('-', '')}C${String(leg.strike * 1000).padStart(8, '0')}` })
    snapshot = { id: 'synthetic-original', underlying: state.underlying, source: 'Tastytrade', spot: state.spot, retrievedAt: state.valuationTimestamp, spotAsOf: state.valuationTimestamp, availableExpiries: [...new Set(state.legs.map(leg => leg.expiry.slice(0, 10)))], contracts: state.legs.map(leg => ({ ...leg, multiplier: 100, bid: 0, ask: 2, quoteAsOf: state.valuationTimestamp })) }
    state.stock = { shares: -100, entryPrice: 110 }; state.feeAllowance = 5
    state.expiryIvShifts = [{ expiry: state.legs[0].expiry, ivShift: .01 }]
  }
  return readWorkspaceDraft(JSON.stringify({ schemaVersion: 1, state, snapshot, title: 'Synthetic recovery', thesis: 'Synthetic thesis', composer: 'Synthetic question', savedAt: '2026-09-06T12:00:00.000Z' }))
}

async function check() {
  run.disabled = true; results.textContent = ''
  const storage = sessionStorage, prototype = Storage.prototype
  const original = { fetch: window.fetch, get: prototype.getItem, set: prototype.setItem, remove: prototype.removeItem }
  const environment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
  const previousAct = environment.IS_REACT_ACT_ENVIRONMENT
  environment.IS_REACT_ACT_ENVIRONMENT = true
  const owners = ['synthetic-draft-check-a', 'synthetic-draft-check-b', 'a'.repeat(64)]
  const key = (owner = owners[0]) => `argus.tab-draft.v1.${owner}`
  const saved = owners.map(owner => original.get.call(storage, key(owner)))
  let root: Root | null = null, restored: WorkspaceDraft[] = [], passed = 0, failed = 0
  const raw = (owner = owners[0]) => original.get.call(storage, key(owner))
  const seed = (value: string, owner = owners[0]) => original.set.call(storage, key(owner), value)
  const resetMocks = () => { window.fetch = original.fetch; prototype.getItem = original.get; prototype.setItem = original.set; prototype.removeItem = original.remove }
  const unmount = async () => { if (root) { await act(async () => root!.unmount()); root = null } }
  async function render(data = sample(), owner = owners[0], disabled = false, changed = true, onRestore = (draft: WorkspaceDraft) => { restored.push(draft) }) {
    root ??= createRoot(fixture)
    const { schemaVersion: _schema, savedAt: _savedAt, ...input } = data
    await act(async () => root!.render(<StrictMode><DraftRecovery key={owner} ownerKey={owner} data={input} changed={changed} disabled={disabled} onRestore={onRestore} /></StrictMode>))
  }
  async function click(label: string) {
    const button = [...fixture.querySelectorAll('button')].find(item => item.textContent === label)
    assert(button && !button.disabled, `Missing or disabled ${label}`)
    await act(async () => button.click())
  }
  function deferred() {
    let resolve!: (response: Response) => void
    const promise = new Promise<Response>(done => { resolve = done })
    let signal: AbortSignal | null | undefined
    window.fetch = (async (input, init) => { assert(input === '/api/bootstrap', 'Unexpected network request'); signal = init?.signal; return promise }) as typeof fetch
    return { get signal() { return signal }, async finish(owner = owners[0]) { await act(async () => { resolve(new Response(JSON.stringify({ session: { recoveryKey: owner } }), { status: 200 })); await promise }) } }
  }
  async function test(name: string, body: () => Promise<void>) {
    try {
      await unmount(); resetMocks(); restored = []
      owners.forEach(owner => original.remove.call(storage, key(owner)))
      await body(); passed++; results.textContent += `PASS ${name}\n`
    } catch (error) { failed++; results.textContent += `FAIL ${name}: ${error instanceof Error ? error.message : String(error)}\n` }
    finally { await unmount(); resetMocks() }
  }
  async function appRecovery(checkRaces: boolean) {
    const owner = owners[2], draft = sample(true)
    draft.state.legs[0].entryPrice = 3.015; draft.state.legs[1].entryPrice = 1.755
    const record = { id: 'synthetic-saved', title: 'Synthetic saved baseline', revision: 1, updatedAt: draft.savedAt, state: createStrategy('long-put'), snapshot: null }
    seed(JSON.stringify(draft), owner)
    const requests: string[] = [], unexpected: string[] = []
    let resolveChain!: (response: Response) => void, resolveReview!: (response: Response) => void, reviewSignal: AbortSignal | null | undefined
    const chain = new Promise<Response>(resolve => { resolveChain = resolve }), review = new Promise<Response>(resolve => { resolveReview = resolve })
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 })
    window.fetch = (async (input, init) => {
      const url = String(input), method = init?.method ?? 'GET'; requests.push(`${method} ${url}`)
      if (url === '/api/bootstrap' && method === 'GET') return json({ session: { label: 'Synthetic checks', local: true, recoveryKey: owner } })
      if (url === '/api/strategies' && method === 'GET') return json({ strategies: [record] })
      if (url === '/api/strategies/synthetic-saved' && method === 'GET') return json({ record })
      if (url.startsWith('/api/chain?') && method === 'GET') return chain
      if (url === '/api/sparring' && method === 'POST') { reviewSignal = init?.signal; return review }
      unexpected.push(`${method} ${url}`)
      return new Response(JSON.stringify({ error: { code: 'synthetic_unexpected', message: 'Harness blocked unexpected request' } }), { status: 503 })
    }) as typeof fetch
    root = createRoot(fixture)
    await act(async () => root!.render(<StrictMode><App /></StrictMode>))
    const select = fixture.querySelector('[aria-label="Saved positions"]') as unknown as HTMLSelectElement
    assert(select, 'App saved positions not mounted')
    await act(async () => { select.value = record.id; select.dispatchEvent(new Event('change', { bubbles: true })) })
    await click('Load')
    assert(fixture.querySelector('.saved-workspace summary')?.textContent?.includes(record.title), 'Saved baseline identity not loaded')
    assert(fixture.querySelector('h1')?.textContent === record.state.name, 'Saved baseline position not loaded')
    if (checkRaces) {
      await click('Use real prices'); await click('Break the thesis')
      assert(requests.some(request => request.startsWith('GET /api/chain?')) && requests.includes('POST /api/sparring'), 'Delayed requests not started')
    }
    await click('Restore tab draft')
    const value = (label: string) => fixture.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[aria-label="${label}"]`)?.value
    const costs = [...fixture.querySelectorAll<HTMLInputElement>('[aria-label="Entry premium"]')].map(input => Number(input.value))
    assert(JSON.stringify(costs) === '[3.015,1.755]', 'Restored App rounded or replaced entry costs')
    assert(value('Shares') === '-100' && value('Share entry cost') === '110' && value('Total cost allowance') === '5', 'Restored App lost stock or fees')
    assert(value('Saved strategy title') === draft.title && value('Ask ARGUS') === draft.composer && fixture.querySelector<HTMLTextAreaElement>('#trade-thesis')?.value === draft.thesis, 'Restored App lost draft text')
    const thesisPanel = fixture.querySelector<HTMLDetailsElement>('details.thesis-card')!
    assert(thesisPanel && !thesisPanel.open && !thesisPanel.hidden && thesisPanel.querySelector('summary')?.textContent?.includes('Included in review'), 'Restored thesis is not visibly included while collapsed')
    const requestsBeforeToggle = requests.length, storedBeforeToggle = raw(owner)
    await act(async () => thesisPanel.querySelector('summary')!.click())
    assert(thesisPanel.open && fixture.querySelector<HTMLTextAreaElement>('#trade-thesis')?.value === draft.thesis, 'Opening restored thesis lost its contents')
    await act(async () => thesisPanel.querySelector('summary')!.click())
    assert(!thesisPanel.open && requests.length === requestsBeforeToggle && raw(owner) === storedBeforeToggle, 'Thesis disclosure changed recovery or issued a request')
    assert(fixture.querySelector('.saved-workspace summary')?.textContent?.includes('Unsaved position') && select.value === '', 'Restore retained saved identity')
    assert(fixture.querySelector('.market-pill')?.textContent?.toLowerCase().includes('historical'), 'Recovered quotes not labeled historical')
    const recovered = readWorkspaceDraft(raw(owner)!)
    assert(recovered.snapshot?.historical && recovered.snapshot.id.startsWith('draft-') && recovered.state.pricing?.snapshotId === recovered.snapshot.id, 'App persistence lost recovered snapshot identity')
    assert(JSON.stringify({ ...recovered.state, version: draft.state.version, pricing: draft.state.pricing }) === JSON.stringify(draft.state), 'App restore changed contracts, costs or scenario')
    const misleadingProvenance = /historical saved quotes|saved snapshot/i.test(`${fixture.querySelector('.market-pill')?.textContent} ${fixture.querySelector('.quote-provenance')?.textContent} ${fixture.querySelector('[aria-label="Quote valuation"]')?.textContent}`)
    if (checkRaces) {
      assert(reviewSignal?.aborted, 'App restore did not abort pending review')
      await act(async () => {
        resolveChain(json({ snapshot: draft.snapshot }))
        resolveReview(json({ error: { code: 'synthetic_late', message: 'STALE REVIEW MUST NOT APPEAR' } }))
        await Promise.all([chain, review])
      })
      assert(raw(owner) === JSON.stringify(recovered), 'Late response changed recovered workspace')
      assert(!fixture.textContent?.includes('STALE REVIEW MUST NOT APPEAR') && !fixture.querySelector('.thinking') && !fixture.querySelector('.message.user'), 'Late review or old conversation survived restore')
      assert(!fixture.textContent?.includes('Loading quotes…') && !fixture.textContent?.includes('position changed while quotes loaded'), 'Late chain left stale loading/error state')
    }
    const undo = fixture.querySelector<HTMLButtonElement>('[aria-label="Undo"]')!
    await act(async () => undo.click())
    assert(fixture.querySelector('h1')?.textContent === record.state.name && fixture.querySelectorAll('.leg-row').length === 1, 'Undo did not restore previous loaded position')
    assert(fixture.querySelector('.saved-workspace summary')?.textContent?.includes('Unsaved position'), 'Undo unexpectedly reattached saved identity')
    assert(unexpected.length === 0 && !requests.some(request => /^(PUT|DELETE) |^POST \/api\/strategies/.test(request)), `Unexpected or saved mutation requests: ${unexpected.join(', ')}`)
    return misleadingProvenance
  }
  try {
    await test('Pending recovery blocks startup and subsequent workspace writes', async () => {
      const before = JSON.stringify(sample()); seed(before)
      await render(); await render({ ...sample(), composer: 'New workspace edit' })
      assert(raw() === before, 'Existing draft was overwritten')
      assert(fixture.textContent?.includes('Restore tab draft'), 'Recovery action missing')
    })
    await test('Delayed bootstrap cannot replace an edited workspace', async () => {
      const before = JSON.stringify(sample()); seed(before); const request = deferred()
      await render(); await click('Restore tab draft'); await render({ ...sample(), composer: 'Edited during request' }); await request.finish()
      assert(restored.length === 0 && raw() === before, 'Stale restore applied or draft lost')
      assert(fixture.textContent?.includes('Workspace changed'), 'Stale workspace explanation missing')
    })
    await test('Delayed bootstrap cannot restore into a busy workspace', async () => {
      seed(JSON.stringify(sample())); const request = deferred()
      await render(); await click('Restore tab draft'); await render(sample(), owners[0], true); await request.finish()
      assert(restored.length === 0, 'Busy workspace was replaced')
    })
    await test('Owner remount aborts old request even when fetch ignores abort', async () => {
      const first = JSON.stringify(sample()), second = JSON.stringify({ ...sample(), title: 'Second owner' })
      seed(first); seed(second, owners[1]); const request = deferred()
      await render(); await click('Restore tab draft'); await render(sample(), owners[1])
      assert(request.signal?.aborted, 'Old owner request not aborted'); await request.finish()
      assert(restored.length === 0 && raw() === first && raw(owners[1]) === second, 'Old response crossed owner boundary')
      assert(fixture.textContent?.includes('Second owner'), 'Second owner draft not shown')
    })
    await test('Bootstrap owner mismatch keeps the draft and refuses restore', async () => {
      const before = JSON.stringify(sample()); seed(before); const request = deferred()
      await render(); await click('Restore tab draft'); await request.finish(owners[1])
      assert(restored.length === 0 && raw() === before, 'Owner mismatch applied restore')
      assert(fixture.textContent?.includes('Private session changed'), 'Owner mismatch explanation missing')
    })
    await test('Malformed draft remains blocked until explicit discard', async () => {
      seed('{'); await render(); assert(raw() === '{', 'Malformed draft silently overwritten')
      assert(fixture.textContent?.includes('cannot be read'), 'Malformed draft explanation missing')
      await click('Discard tab draft'); assert(readWorkspaceDraft(raw()!).composer === sample().composer, 'New recovery not enabled after discard')
    })
    await test('Read and discard storage failures preserve recovery', async () => {
      const before = JSON.stringify(sample()); seed(before)
      prototype.getItem = function(name) { if (this === storage && name === key()) throw new Error('Synthetic read failure'); return original.get.call(this, name) }
      await render(); assert(fixture.textContent?.includes('cannot be read'), 'Read error missing')
      prototype.removeItem = function(name) { if (this === storage && name === key()) throw new Error('Synthetic remove failure'); return original.remove.call(this, name) }
      await click('Discard tab draft'); assert(raw() === before, 'Failed discard lost recovery')
      assert(fixture.textContent?.includes('was not discarded'), 'Discard error missing')
    })
    await test('Quota failure reports that new recovery was not written', async () => {
      prototype.setItem = function(name, value) { if (this === storage && name === key()) throw new DOMException('Synthetic quota', 'QuotaExceededError'); return original.set.call(this, name, value) }
      await render(); assert(raw() === null, 'Unexpected stored draft')
      assert(fixture.textContent?.includes('could not be updated'), 'Quota error missing')
    })
    await test('Restore callback failure keeps the original candidate', async () => {
      const before = JSON.stringify(sample()); seed(before); const request = deferred()
      await render(sample(), owners[0], false, true, () => { throw new Error('Synthetic restore failure') })
      await click('Restore tab draft'); await request.finish()
      assert(raw() === before && fixture.textContent?.includes('Restore tab draft'), 'Failed restore discarded candidate')
      assert(fixture.textContent?.includes('Synthetic restore failure'), 'Restore failure missing')
    })
    await test('Market recovery preserves costs and scenarios with unique historical snapshot identity', async () => {
      const draft = sample(true), before = JSON.stringify(draft), identities: string[] = []
      for (let attempt = 0; attempt < 2; attempt++) {
        await unmount(); seed(before); const request = deferred()
        await render(sample(), owners[0], false, false); await click('Restore tab draft'); await request.finish()
        const recovered = restored[attempt]
        assert(recovered?.snapshot?.historical && recovered.state.pricing?.historical, 'Recovery not historical')
        assert(recovered.snapshot.id.startsWith('draft-') && recovered.snapshot.id !== draft.snapshot!.id, 'Original snapshot identity reused')
        identities.push(recovered.snapshot.id)
        assert(JSON.stringify(recovered.state) === JSON.stringify({ ...draft.state, pricing: { ...draft.state.pricing, snapshotId: recovered.snapshot.id, historical: true } }), 'Costs, contracts or scenario changed')
        assert(recovered.title === draft.title && recovered.thesis === draft.thesis && recovered.composer === draft.composer, 'Draft text changed')
        assert(JSON.stringify(draft) === before, 'Source draft mutated')
      }
      assert(identities[0] !== identities[1], 'Repeated recoveries reused snapshot identity')
    })
    await test('Actual App market restore detaches saved identity, preserves inputs, suppresses delayed chain/review and supports Undo', async () => {
      await appRecovery(true)
    })
    await test('Actual App recovered historical provenance does not claim the unsaved draft was saved', async () => {
      assert(!await appRecovery(false), 'Recovered unsaved draft is labeled Historical saved quotes or Saved snapshot')
    })
  } finally {
    await unmount(); resetMocks()
    owners.forEach((owner, index) => { const value = saved[index]; if (value === null) original.remove.call(storage, key(owner)); else original.set.call(storage, key(owner), value) })
    if (previousAct === undefined) delete environment.IS_REACT_ACT_ENVIRONMENT; else environment.IS_REACT_ACT_ENVIRONMENT = previousAct
    results.textContent += `TOTAL ${passed} passed, ${failed} failed. Synthetic storage restored; no provider calls.\n`
    run.disabled = false
  }
}
