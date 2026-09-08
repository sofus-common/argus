import { act, StrictMode, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { PriceHistory } from '../src/PriceHistory'
import { HistoryCharts } from '../src/HistoryCharts'
import { App, SnapshotAge, StreamedMarks, AssignmentOutcomes } from '../src/App'
import { SavedImport } from '../src/SavedImport'
import { calculateStrategy, createMarketStrategy, createStrategy, type MarketSnapshot } from '../src/options'
import { buildIntradayHistory, buildIvHistory } from '../src/intraday-history'
import { buildPriceHistory } from '../src/price-history'
import '../src/styles.css'

const button = document.querySelector<HTMLButtonElement>('#run')!, output = document.querySelector('#results')!, fixture = document.querySelector<HTMLDivElement>('#fixture')!
if (!import.meta.env.DEV) { button.disabled = true; output.textContent = 'Development only' }
else button.onclick = () => void run()
function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message) }

async function run() {
  button.disabled = true; output.textContent = ''
  const originalFetch = window.fetch, originalNow = Date.now
  const environment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }, priorAct = environment.IS_REACT_ACT_ENVIRONMENT
  environment.IS_REACT_ACT_ENVIRONMENT = true
  const today = new Date().toISOString().slice(0, 10), fixedNow = Date.parse(`${today}T14:12:34Z`)
  Date.now = () => fixedNow
  const state = createStrategy('bull-call')
  state.pricing = { mode: 'market', snapshotId: 'synthetic-history-ui', basis: 'mid' }
  state.legs.forEach((leg, i) => { leg.strike = 770 + i * 5; leg.expiry = '2027-10-09T20:00:00.000Z'; leg.contractId = `SPY   271009C00${leg.strike}000` })
  let root: Root | null = null, passed = 0, failed = 0, closes = 0
  type RequestBody = { state: typeof state; range: { start: number; end: number }; selectedTime?: number; contractId?: string; request_id?: string; conversation?: unknown[] }
  type DailyRequestBody = { state: typeof state; range: { start: string; end: string } }
  type PendingRequest = { url: string; signal?: AbortSignal | null; body: RequestBody | DailyRequestBody; finish: (change?: (body: any) => void, status?: number) => Promise<void> }
  let request: PendingRequest | null = null, requests = 0
  window.fetch = (async (url, init) => {
    assert(url === '/api/intraday-history' || url === '/api/intraday-history/iv' || url === '/api/intraday-history/iv-discuss' || url === '/api/intraday-history/discuss' || url === '/api/price-history', 'Unexpected request blocked')
    requests++
    const body = JSON.parse(String(init?.body))
    let resolve!: (response: Response) => void
    const promise = new Promise<Response>(done => { resolve = done })
    request = { url, signal: init?.signal, body, async finish(change, status = 200) {
      if (url === '/api/price-history') {
        const history = buildPriceHistory(body.state, body.state.legs.map(() => ({ response: [] })), { response: [] }, body.range)
        const response = { history, range: body.range, source: 'Theta EOD', snapshotId: body.state.pricing.snapshotId, positionVersion: body.state.version }
        change?.(response)
        await act(async () => { resolve(new Response(JSON.stringify(response), { status })); await promise })
        return
      }
      const bar = (slot: number, close: number) => ({ time: body.range.start + slot * 300000, count: 1, open: close, high: close, low: close, close, volume: null })
      const raw = { underlying: { symbol: 'SPY', basis: 'last-trade', bars: [bar(0, 770), bar(1, 771), bar(2, 772)] }, contracts: state.legs.map((leg, i) => ({ contractId: leg.contractId, basis: 'midpoint', bars: i ? [bar(0, 2), bar(1, 2)] : [bar(0, 2), bar(1, 1), bar(2, 3)] })) }
      const history = url === '/api/intraday-history/iv' || url === '/api/intraday-history/iv-discuss' ? buildIvHistory(body.state, body.range, { contracts: state.legs.map((leg, i) => ({ contractId: leg.contractId, basis: 'trade-candle', bars: [{ time: body.range.start, iv: i ? .25 : 0 }] })) }) : buildIntradayHistory(body.state, body.range, raw)
      const response = { history, range: body.range, snapshotId: body.state.pricing.snapshotId, positionVersion: body.state.version, ...(url.endsWith('discuss') ? { selectedTime: body.selectedTime, request_id: body.request_id, ...(body.contractId ? { contractId: body.contractId } : {}), reply: { text: 'Verified synthetic intraday discussion.', assumptions: [], objections: [], suggested_prompts: [] } } : {}) }
      change?.(response)
      await act(async () => { resolve(new Response(JSON.stringify(response), { status })); await promise })
    } }
    return promise
  }) as typeof fetch
  const current = () => { assert(request && typeof request.body.range.start === 'number', 'Intraday request not started'); return request as PendingRequest & { body: RequestBody } }
  const daily = () => { assert(request?.url === '/api/price-history' && typeof request.body.range.start === 'string', 'Daily request not started'); return request as PendingRequest & { body: DailyRequestBody } }
  function Host({ position = state }: { position?: typeof state }) { const [open, setOpen] = useState(true); return open ? <PriceHistory state={position} onClose={() => { closes++; setOpen(false) }} /> : null }
  async function unmount() { if (root) { await act(async () => root!.unmount()); root = null } }
  async function change(label: string, value: string) {
    const field = fixture.querySelector(`[aria-label="${label}"]`) as HTMLInputElement
    assert(field, `Missing ${label}`)
    const prototype = field.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype
    await act(async () => { Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(field, value); field.dispatchEvent(new Event('input', { bubbles: true })); field.dispatchEvent(new Event('change', { bubbles: true })) })
  }
  async function click(name: string) {
    const target = [...fixture.querySelectorAll('button')].find(item => item.textContent === name)
    assert(target && !target.disabled, `Missing or disabled ${name}`)
    await act(async () => target.click())
  }
  const settleTimers = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 25)) })
  async function mount(initialDaily = false) {
    root = createRoot(fixture); await act(async () => root!.render(<StrictMode><Host /></StrictMode>))
    if (initialDaily) { await settleTimers(); return }
    await change('History resolution', 'intraday'); await change('Intraday date UTC', today)
    if (request?.url === '/api/price-history') await request.finish()
  }
  async function test(name: string, check: () => Promise<void>, initialDaily = false) {
    try { request = null; requests = 0; await mount(initialDaily); await check(); passed++; output.textContent += `PASS ${name}\n` }
    catch (error) { failed++; output.textContent += `FAIL ${name}: ${error instanceof Error ? error.message : String(error)}\n` }
    finally { await unmount() }
  }
  try {
    await test('Saved JSON preview binds the chosen file, imports once and distinguishes uncertain writes from failed refreshes', async () => {
      await unmount(); const priorFetch = window.fetch;
      let posts = 0, refreshes = 0, failRefresh = false, deferRefresh = false;
      let resolveRefresh: (() => void) | undefined;
      let respond: ((response: Response) => void) | undefined, reject: ((error: Error) => void) | undefined;
      const payload = (title: string) => JSON.stringify({ format: 'argus-saved-position', formatVersion: 1, exportedAt: '2026-09-07T12:00:00.000Z', record: { title, revision: 3, lifecycle: null } });
      const selected: string[] = [];
      window.fetch = (async (url, init) => {
        assert(url === '/api/strategies/import' && init?.method === 'POST', 'Unexpected import request');
        posts++; selected.push(String(init.body));
        return new Promise<Response>((resolve, fail) => { respond = resolve; reject = fail });
      }) as typeof fetch;
      const onImported = async () => { refreshes++; if (deferRefresh) await new Promise<void>(resolve => { resolveRefresh = resolve }); if (failRefresh) throw new Error('List unavailable') };
      async function choose(file: File) {
        const input = fixture.querySelector<HTMLInputElement>('[aria-label="Saved JSON file"]')!;
        const files = new DataTransfer(); files.items.add(file);
        await act(async () => { input.files = files.files; input.dispatchEvent(new Event('change', { bubbles: true })); await file.text(); });
      }
      try {
        root = createRoot(fixture); await act(async () => root!.render(<SavedImport disabled={false} onImported={onImported} />));
        await act(async () => fixture.querySelector('summary')!.click());
        await choose(new File(['bad JSON'], 'bad.json'));
        assert(posts === 0 && !fixture.querySelector('.import-preview'), 'Invalid file reached upload');
        await choose(new File(['x'.repeat(2 * 1024 * 1024 + 1)], 'large.json'));
        assert(posts === 0 && fixture.textContent?.includes('exceeds'), 'Oversized file reached upload');
        const slow = new File([payload('Old file')], 'old.json'); let resolveOld: ((value: string) => void) | undefined;
        Object.defineProperty(slow, 'text', { value: () => new Promise<string>(resolve => { resolveOld = resolve }) });
        const input = fixture.querySelector<HTMLInputElement>('[aria-label="Saved JSON file"]')!, files = new DataTransfer(); files.items.add(slow);
        await act(async () => { input.files = files.files; input.dispatchEvent(new Event('change', { bubbles: true })); });
        await choose(new File([payload('Chosen file')], 'chosen.json'));
        await act(async () => resolveOld!(payload('Old file')));
        assert(fixture.querySelector('.import-preview strong')?.textContent === 'Chosen file' && posts === 0, 'Stale file read replaced preview or preview uploaded');
        const button = [...fixture.querySelectorAll('button')].find(item => item.textContent === 'Import as new saved position')!;
        await act(async () => { button.click(); button.click(); });
        assert(Number(posts) === 1 && selected[0] === payload('Chosen file') && !fixture.querySelector('.import-preview'), 'Confirmation posted twice or changed payload');
        await act(async () => respond!(Response.json({ record: { id: 'imported', revision: 1 } }, { status: 201 })));
        assert(refreshes === 1 && fixture.textContent?.includes('open strategy is unchanged'), 'Successful import did not refresh or report outcome');
        failRefresh = true;
        await choose(new File([payload('Refresh failure')], 'refresh.json')); await click('Import as new saved position');
        await act(async () => respond!(Response.json({ record: { id: 'imported2', revision: 1 } }, { status: 201 })));
        assert(fixture.textContent?.includes('Import succeeded, but') && !fixture.textContent.includes('outcome is unknown'), 'Refresh failure mislabeled confirmed import');
        await choose(new File([payload('Uncertain')], 'uncertain.json')); await click('Import as new saved position');
        await act(async () => reject!(new Error('Disconnected')));
        assert(fixture.textContent?.includes('outcome is unknown') && !fixture.querySelector('.import-preview') && Number(posts) === 3, 'Uncertain upload retried or retained confirmation');
        failRefresh = false; deferRefresh = true;
        await click('Refresh saved list');
        await choose(new File([payload('Next file')], 'next.json'));
        await act(async () => resolveRefresh!());
        assert(fixture.querySelector('.import-preview strong')?.textContent === 'Next file' && !fixture.textContent?.includes('Saved list refreshed'), 'Old refresh overwrote new selection feedback');
        deferRefresh = false;
        await click('Import as new saved position');
        let resolveBody: ((value: unknown) => void) | undefined;
        const response = Response.json({}, { status: 201 }); Object.defineProperty(response, 'json', { value: () => new Promise(resolve => { resolveBody = resolve }) });
        await act(async () => respond!(response));
        assert(resolveBody, 'Deferred response body did not start');
        const refreshesBeforeUnmount = refreshes;
        await unmount();
        await act(async () => resolveBody!({ record: { id: 'late-import', revision: 1 } }));
        assert(refreshes === refreshesBeforeUnmount, 'Unmounted import refreshed after late body parsing');
      } finally { await unmount(); window.fetch = priorFetch }
    });
    await test('Assignment outcomes retain existing shares, separate each short and fail closed on unavailable terms', async () => {
      await unmount(); const position = createStrategy('short-strangle');
      position.valuationTimestamp = new Date(fixedNow).toISOString(); position.scenarioDate = position.valuationTimestamp;
      position.stock = { shares: 150, entryPrice: 100 };
      position.pricing = { mode: 'market', snapshotId: 'assignment-ui', basis: 'mid' };
      position.legs.forEach(leg => { leg.expiry = '2027-10-09T20:00:00.000Z'; leg.strike = leg.type === 'call' ? 105 : 95; leg.contractId = `SPY   271009${leg.type === 'call' ? 'C' : 'P'}${String(leg.strike * 1000).padStart(8, '0')}` });
      const snapshot = { id: 'assignment-ui', underlying: 'SPY', source: 'Synthetic UI test', spot: position.spot, retrievedAt: position.valuationTimestamp, spotAsOf: position.valuationTimestamp, availableExpiries: ['2027-10-09'], contractTerms: { exerciseStyle: 'American', settlement: 'physical-shares', sharesPerContract: 100, settlementSession: 'PM' }, contracts: position.legs.map(leg => ({ ...leg, bid: leg.entryPrice, ask: leg.entryPrice, quoteAsOf: position.valuationTimestamp })) } as any;
      const unchanged = JSON.stringify(position), requestsBefore = requests;
      root = createRoot(fixture); await act(async () => root!.render(<AssignmentOutcomes state={position} snapshot={snapshot} />));
      const panel = fixture.querySelector('details')!; await act(async () => panel.querySelector('summary')!.click());
      assert(panel.open, 'Native disclosure did not open');
      const rows = [...fixture.querySelectorAll('article')]; assert(rows.length === 2, 'Expected two independent outcomes');
      const call = rows.find(row => row.getAttribute('aria-label')?.includes('call'))!, put = rows.find(row => row.getAttribute('aria-label')?.includes('put'))!;
      assert(call.textContent?.includes('+50 SPY') && call.textContent.includes('+$10,500.00'), 'Call assignment ignored held shares or cash sign');
      assert(put.textContent?.includes('+250 SPY') && put.textContent.includes('−$9,500.00'), 'Put outcome was cumulative or cash sign wrong');
      assert(call.querySelector('p')?.textContent?.includes('put') && !call.querySelector('p')?.textContent?.includes('call'), 'Assigned call still shown as remaining');
      assert(fixture.textContent?.includes('Broker policy not supplied') && fixture.textContent.includes('Not profit'), 'Operational scope missing');
      for (const unavailable of [undefined, { ...snapshot, contractTerms: undefined }, { ...snapshot, historical: true }, { ...snapshot, id: 'mismatch' }]) {
        await act(async () => root!.render(<AssignmentOutcomes state={position} snapshot={unavailable} />));
        assert(!fixture.querySelector('article') && fixture.textContent?.includes('unavailable'), 'Unavailable terms showed numeric outcomes');
      }
      await act(async () => root!.render(<AssignmentOutcomes state={{ ...position, legs: position.legs.map(leg => ({ ...leg, side: 'long' })) }} snapshot={snapshot} />));
      assert(fixture.textContent?.includes('No short options'), 'Long-only position implied assignment');
      assert(JSON.stringify(position) === unchanged && requests === requestsBefore, 'Panel mutated holdings or requested inference');
    });
    await test('Snapshot age advances independently of retrieval and ignores unselected contracts', async () => {
      await unmount(); const priorInterval = window.setInterval;
      let advance: (() => void) | undefined;
      window.setInterval = ((callback: TimerHandler, delay?: number) => {
        if (delay === 30000 && typeof callback === 'function') advance = callback as () => void;
        return priorInterval(callback, delay);
      }) as typeof window.setInterval;
      const snapshot = { retrievedAt: new Date(fixedNow).toISOString(), spotAsOf: new Date(fixedNow - 59000).toISOString(), contracts: [{ contractId: 'selected', quoteAsOf: new Date(fixedNow - 30000).toISOString() }, { contractId: 'unused', quoteAsOf: '2020-01-01T00:00:00Z' }] } as any;
      try {
        root = createRoot(fixture); await act(async () => root!.render(<SnapshotAge snapshot={snapshot} contracts={['selected']} />));
        assert(fixture.textContent?.includes('less than 1 minute ago') && !fixture.textContent?.includes('STALE'), 'Age used retrieval or unselected contract');
        assert(advance, 'Idle age clock missing'); Date.now = () => fixedNow + 61000;
        await act(async () => advance!()); assert(fixture.textContent?.includes('2 minutes ago'), 'Snapshot did not age while idle');
        Date.now = () => fixedNow + 86400000; await act(async () => advance!());
        assert(fixture.textContent?.includes('STALE QUOTES'), 'Snapshot failed to cross stale boundary');
        await act(async () => root!.render(<SnapshotAge snapshot={{ ...snapshot, historical: true }} contracts={['selected']} />));
        assert(fixture.textContent?.includes('HISTORICAL QUOTES'), 'Historical provenance lost');
        await act(async () => root!.render(<SnapshotAge snapshot={snapshot} contracts={['missing']} />));
        assert(fixture.textContent?.includes('Source time unavailable'), 'Missing selected contract presented as dated');
        await act(async () => root!.render(<SnapshotAge snapshot={{ ...snapshot, spotAsOf: new Date(Date.now() + 60000).toISOString() }} contracts={['selected']} />));
        assert(fixture.textContent?.includes('Future source time'), 'Future source presented as current');
      } finally { await unmount(); window.setInterval = priorInterval; Date.now = () => fixedNow }
    });
    await test('Reversible exclusion retains construction, restores through Undo and supports empty drafts', async () => {
      await unmount(); const priorFetch = window.fetch, priorWorker = window.Worker;
      const sentStates: ReturnType<typeof createStrategy>[] = [];
      const activeWorkers = new Set<Worker>();
      window.Worker = class extends priorWorker {
        constructor(url: string | URL, options?: WorkerOptions) { super(url, options); activeWorkers.add(this) }
        terminate() { activeWorkers.delete(this); super.terminate() }
        postMessage(message: any, options?: any) { if (message?.state?.legs) sentStates.push(structuredClone(message.state)); super.postMessage(message, options) }
      };
      let saved: { id: string; title: string; revision: number; createdAt: string; updatedAt: string; state: ReturnType<typeof createStrategy>; snapshot: null; lifecycle: null } | undefined;
      window.fetch = (async (url, init) => {
        if (url === '/api/bootstrap') return Response.json({ session: { label: 'Exclusion test', local: true, recoveryKey: 'disabled-in-test' } });
        if (url === '/api/strategies' && init?.method === 'POST') {
          const body = JSON.parse(String(init.body)), stamp = new Date(fixedNow).toISOString();
          saved = { id: 'excluded-test', title: body.title, revision: 1, createdAt: stamp, updatedAt: stamp, state: body.state, snapshot: null, lifecycle: null };
          return Response.json({ record: saved }, { status: 201 });
        }
        if (url === '/api/strategies') return Response.json({ strategies: saved ? [saved] : [] });
        if (url === '/api/strategies/excluded-test') return Response.json({ record: saved });
        throw new Error('Unexpected exclusion test request');
      }) as typeof fetch;
      const selection = () => [...fixture.querySelectorAll<HTMLInputElement>('.leg-list input[type="checkbox"]')];
      const rows = () => fixture.querySelectorAll('.leg-row').length;
      const held = () => [...fixture.querySelectorAll<HTMLInputElement>('.leg-list input:not([type="checkbox"]), .leg-list select')].map(input => input.value).join();
      const empty = () => fixture.querySelector('[aria-label="Empty analysis selection"]');
      try {
        root = createRoot(fixture); await act(async () => root!.render(<App />));
        const count = rows(), original = held();
        assert(count > 0 && selection().length === count, 'Each leg needs an analysis inclusion toggle');
        await act(async () => selection()[0].click());
        assert(sentStates.at(-1)?.legs.length === count - 1 && !sentStates.at(-1)?.excludedLegIds?.length, 'Worker received canonical excluded holdings instead of included projection');
        for (const checkbox of selection().filter(input => input.checked)) await act(async () => checkbox.click());
        assert(empty() && rows() === count && held() === original, 'Exclusion lost holdings or failed to clear analysis');
        assert(activeWorkers.size === 0, 'Empty selection retained a pricing worker');
        assert(selection().every(input => !input.checked), 'All-excluded selection not retained');
        await click('Save');
        for (let i = 0; i < 100 && (fixture.querySelector('[aria-label="Saved positions"]') as HTMLSelectElement | null)?.value !== 'excluded-test'; i++) await settleTimers();
        assert(saved?.state.legs.length === count && saved.state.excludedLegIds?.length === count, 'Save lost excluded inventory');
        await click('Include all legs');
        assert(!empty() && selection().every(input => input.checked) && held() === original, 'Re-inclusion changed held inputs');
        await act(async () => fixture.querySelector<HTMLButtonElement>('[aria-label="Undo"]')!.click());
        assert(empty() && selection().every(input => !input.checked), 'Undo did not restore all-excluded state');
        await click('Include all legs'); await click('Load');
        for (let i = 0; i < 100 && !empty(); i++) await settleTimers();
        assert(empty() && rows() === count && held() === original, 'Saved reload lost excluded inventory or selection');
        for (let i = 0; i < count; i++) await act(async () => fixture.querySelector<HTMLButtonElement>('.leg-row [aria-label="Remove leg"]')!.click());
        assert(empty() && rows() === 0, 'Last leg cannot be removed into empty construction');
        await click('＋ Add leg');
        assert(rows() === 1 && !empty(), 'Empty construction cannot add its first leg');
        const calendar = [...fixture.querySelectorAll<HTMLButtonElement>('.template-list button')].find(button => button.querySelector('span')?.textContent?.toLowerCase() === 'call calendar');
        assert(calendar, 'Calendar template missing'); await act(async () => calendar.click());
        const expiries = [...fixture.querySelectorAll<HTMLInputElement>('.leg-list [aria-label="Expiry"]')].map(input => input.value).sort();
        await act(async () => selection()[0].click());
        await change('Scenario date UTC', expiries[1].slice(0, -1));
        await act(async () => fixture.querySelectorAll<HTMLButtonElement>('.leg-row [aria-label="Remove leg"]')[1].click());
        assert(empty() && rows() === 1, 'Calendar exclusion did not retain near leg');
        await click('Include all legs');
        assert(empty(), 'Invalid near-expiry re-inclusion changed selection');
        await click('Reset scenario to valuation'); await click('Include all legs');
        assert(!empty() && selection()[0].checked, 'Empty calendar cannot recover its scenario date');
      } finally { await unmount(); window.fetch = priorFetch; window.Worker = priorWorker }
    });
    await test('AI proposals price included holdings and preserve excluded costs through Apply and Undo', async () => {
      await unmount(); const priorFetch = window.fetch, priorWorker = window.Worker;
      const sentStates: ReturnType<typeof createStrategy>[] = [];
      window.Worker = class extends priorWorker {
        postMessage(message: any, options?: any) { if (message?.state?.legs) sentStates.push(structuredClone(message.state)); super.postMessage(message, options) }
      };
      let requested: ReturnType<typeof createStrategy> | undefined, malicious = false;
      window.fetch = (async (url, init) => {
        if (url === '/api/bootstrap') return Response.json({ session: { label: 'AI exclusion test', local: true, recoveryKey: 'disabled-in-test' } });
        if (url === '/api/strategies') return Response.json({ strategies: [] });
        if (url === '/api/sparring') {
          const body = JSON.parse(String(init?.body)); requested = body.state;
          const next = structuredClone(body.state) as ReturnType<typeof createStrategy>;
          const active = next.legs.find(leg => !next.excludedLegIds?.includes(leg.id))!;
          active.contracts = 2; next.version++;
          if (malicious) next.legs.find(leg => next.excludedLegIds?.includes(leg.id))!.entryPrice += 1;
          return Response.json({ request_id: body.request_id, base_state_version: body.base_state_version, next_state: next,
            reply: { text: 'Increase the included quantity.', operations: [{ kind: 'set_contracts', leg_id: active.id, contracts: 2 }], assumptions: [], objections: [], suggested_prompts: [], evidence_ids: [], risk_classification: 'bounded' },
            calculated: { riskSummary: 'Included holdings only', dataMode: 'sample' }, market_context: { sources: [], retrievedAt: new Date(fixedNow).toISOString() } });
        }
        throw new Error('Unexpected AI exclusion request');
      }) as typeof fetch;
      const selection = () => [...fixture.querySelectorAll<HTMLInputElement>('.leg-list input[type="checkbox"]')];
      const held = () => [...fixture.querySelectorAll<HTMLInputElement>('.leg-list input:not([type="checkbox"]), .leg-list select')].map(input => input.value).join();
      const waitFor = async (check: () => boolean) => { for (let i = 0; i < 800 && !check(); i++) await settleTimers(); assert(check(), 'AI exclusion response did not settle') };
      try {
        root = createRoot(fixture); await act(async () => root!.render(<App />));
        await act(async () => selection()[0].click());
        const original = held(), count = selection().length;
        await click('Break the thesis');
        await waitFor(() => !!fixture.querySelector('.proposal-card'));
        assert(requested?.legs.length === count && requested.excludedLegIds?.length === 1, 'AI request lost canonical exclusion scope');
        const excluded = requested.legs.find(leg => requested!.excludedLegIds!.includes(leg.id))!;
        assert(sentStates.every(position => !position.excludedLegIds?.length) && sentStates.slice(-2).every(position => !position.legs.some(leg => leg.id === excluded.id)), 'Proposal pricing leaked excluded holdings');
        await click('Apply proposal');
        const quantities = [...fixture.querySelectorAll<HTMLInputElement>('.leg-list [aria-label="Contracts"]')];
        assert(!selection()[0].checked && selection().length === count && quantities[0].value === String(excluded.contracts) && quantities[1].value === '2', 'Apply changed excluded holdings or missed included quantity');
        assert(fixture.querySelector<HTMLInputElement>('.leg-list [aria-label="Entry premium"]')!.value === String(excluded.entryPrice), 'Apply changed excluded entry cost');
        await act(async () => fixture.querySelector<HTMLButtonElement>('[aria-label="Undo"]')!.click());
        assert(held() === original && !selection()[0].checked, 'AI Undo lost canonical holdings or exclusion');
        malicious = true; await click('Break the thesis');
        await waitFor(() => !fixture.querySelector('.thinking'));
        assert(!fixture.querySelector('.proposal-card') && held() === original && fixture.textContent?.includes('REVIEW FAILED'), 'Untrusted excluded-cost mutation was accepted');
      } finally { await unmount(); window.fetch = priorFetch; window.Worker = priorWorker }
    });
    await test('Quoted candidate transfer preserves excluded fixed-entry holdings and Undo', async () => {
      await unmount(); const priorFetch = window.fetch, priorSocket = window.WebSocket, priorWorker = window.Worker;
      const stamp = new Date(fixedNow - 120000).toISOString(), expiry = '2027-10-09T20:00:00.000Z';
      const snapshot: MarketSnapshot = { id: 'candidate-held-window', source: 'Tastytrade', underlying: 'SPY', spot: 100, spotAsOf: stamp, retrievedAt: stamp, availableExpiries: ['2027-10-09'], contracts: [90, 95, 100, 105, 110].flatMap(strike => (['call', 'put'] as const).map(type => ({ contractId: `SPY   271009${type === 'call' ? 'C' : 'P'}${String(strike * 1000).padStart(8, '0')}`, type, strike, expiry, multiplier: 100 as const, bid: 2, ask: 3, iv: .2, quoteAsOf: stamp }))) };
      const heldState = createMarketStrategy('bull-call', snapshot);
      heldState.pricing!.entryMode = 'fixed'; heldState.legs[0].entryPrice = 1.23; heldState.excludedLegIds = [heldState.legs[0].id];
      const seed = { id: 'candidate-held-seed', title: 'Held candidate fixture', revision: 1, createdAt: stamp, updatedAt: stamp, state: heldState, snapshot };
      let saved: typeof seed | undefined, maliciousCandidate: 'entry' | 'fixed' | undefined;
      let activeSnapshot = snapshot;
      const candidate = createMarketStrategy('long-put', snapshot);
      candidate.legs[0].id = 'candidate-put';
      const sentStates: ReturnType<typeof createStrategy>[] = [];
      window.Worker = class extends priorWorker { postMessage(message: any, options?: any) { if (message?.state?.legs) sentStates.push(structuredClone(message.state)); super.postMessage(message, options) } };
      window.WebSocket = class { close() {} } as unknown as typeof WebSocket;
      window.fetch = (async (url, init) => {
        if (url === '/api/bootstrap') return Response.json({ session: { label: 'Candidate test', local: true, recoveryKey: 'disabled-in-test' } });
        if (url === '/api/strategies' && init?.method === 'POST') {
          const body = JSON.parse(String(init.body)); saved = { ...seed, id: 'candidate-saved', title: body.title, state: body.state, snapshot: activeSnapshot };
          return Response.json({ record: saved }, { status: 201 });
        }
        if (url === '/api/strategies') return Response.json({ strategies: saved ? [seed, saved] : [seed] });
        if (url === '/api/strategies/candidate-held-seed') return Response.json({ record: seed });
        if (String(url).startsWith('/api/chain?')) {
          const retained = new URL(String(url), location.origin).searchParams.get('retain')?.split(',');
          assert(retained?.includes(heldState.legs[0].contractId) && retained.includes(candidate.legs[0].contractId), 'Candidate refresh lost retained or included contracts');
          activeSnapshot = { ...snapshot, id: 'candidate-refreshed', contracts: snapshot.contracts.map(contract => ({ ...contract, bid: 4, ask: 5 })) };
          return Response.json({ snapshot: activeSnapshot });
        }
        if (url === '/api/sparring') {
          const body = JSON.parse(String(init?.body)), next = { ...body.state, version: body.state.version + 1 };
          const offered = structuredClone(candidate);
          if (maliciousCandidate) offered.legs[0].entryPrice = 0.01;
          if (maliciousCandidate === 'fixed') offered.pricing!.entryMode = 'fixed';
          return Response.json({ request_id: body.request_id, base_state_version: body.base_state_version, next_state: next,
            reply: { text: 'Inspect this quoted alternative.', operations: [], assumptions: [], objections: [], suggested_prompts: [], evidence_ids: [], risk_classification: 'bounded' },
            calculated: { riskSummary: 'Included holdings only', dataMode: 'market-snapshot', candidateSearch: { baseVersion: body.state.version, snapshotId: snapshot.id, model: 'european-bsm-v1', coverage: 'Synthetic one-candidate fixture', probabilityBasis: 'Not a forecast', evaluated: 1, eligible: 1, request: { objective: 'target-pnl', targetSpot: candidate.scenarioSpot, targetDate: candidate.scenarioDate, basis: 'mid', feeAllowance: 0 }, candidates: [{ id: 'put-alternative', state: offered, metrics: calculateStrategy(offered), score: 1, probability: { probability: null, volatility: null, volatilityContractId: null, spot: candidate.spot, from: candidate.valuationTimestamp, expiry } }] } }, market_context: { sources: [], retrievedAt: stamp } });
        }
        throw new Error('Unexpected candidate fixture request');
      }) as typeof fetch;
      const waitFor = async (check: () => boolean) => { for (let i = 0; i < 800 && !check(); i++) await settleTimers(); assert(check(), `Candidate transfer did not settle: ${fixture.querySelector('[role="alert"]')?.textContent ?? ''}`) };
      const inputs = () => [...fixture.querySelectorAll<HTMLInputElement>('.leg-list input:not([type="checkbox"]), .leg-list select')].map(input => input.value).join();
      const inspect = async () => { const button = [...fixture.querySelectorAll('button')].filter(button => button.textContent === 'Inspect candidate' && !button.disabled).at(-1); assert(button, 'No current candidate to inspect'); await act(async () => button.click()) };
      try {
        root = createRoot(fixture); await act(async () => root!.render(<App />));
        await waitFor(() => !!fixture.querySelector('option[value="candidate-held-seed"]'));
        await change('Saved positions', seed.id); await click('Load');
        await waitFor(() => !!fixture.querySelector('.leg-list input[type="checkbox"]:not(:checked)'));
        const original = inputs();
        await click('Break the thesis'); await waitFor(() => !!fixture.querySelector('[aria-label="Ranked quoted candidates"]'));
        await inspect(); await waitFor(() => !!fixture.querySelector('.proposal-card'));
        await waitFor(() => !!fixture.querySelector('path.proposal-line')?.getAttribute('d'));
        assert(sentStates.some(position => position.legs.length === 1 && position.legs[0].contractId === candidate.legs[0].contractId), 'Candidate comparison was not projected');
        await click('Apply proposal'); await click('Save as new'); await waitFor(() => !!saved);
        assert(saved!.state.pricing?.entryMode === 'fixed' && saved!.state.excludedLegIds?.join() === heldState.excludedLegIds!.join(), 'Candidate lost fixed-entry mode or exclusion selection');
        assert(JSON.stringify(saved!.state.legs[0]) === JSON.stringify(heldState.legs[0]) && saved!.state.legs[1].contractId === candidate.legs[0].contractId, 'Candidate changed excluded cost or failed to replace included leg');
        const applied = inputs(); saved = undefined;
        await click('Refresh prices'); await waitFor(() => fixture.querySelector('.contract-quote')?.textContent?.includes('Bid $4.00') === true);
        await waitFor(() => ![...fixture.querySelectorAll('button')].some(button => button.textContent === 'Loading quotes…'));
        await click('Save as new'); await waitFor(() => !!saved);
        assert(inputs() === applied && saved!.state.pricing?.entryMode === 'fixed' && saved!.state.legs[1].entryPrice === candidate.legs[0].entryPrice, 'Quote refresh changed newly frozen or retained entry costs');
        await act(async () => fixture.querySelector<HTMLButtonElement>('[aria-label="Undo"]')!.click());
        await act(async () => fixture.querySelector<HTMLButtonElement>('[aria-label="Undo"]')!.click());
        assert(inputs() === original && fixture.querySelector('.leg-list input[type="checkbox"]:not(:checked)'), 'Candidate Undo did not restore held construction');
        for (const attack of ['entry', 'fixed'] as const) {
          maliciousCandidate = attack; await click('Break the thesis');
          await waitFor(() => !fixture.querySelector('.thinking'));
          await inspect(); await waitFor(() => !fixture.querySelector('.thinking'));
          assert(!fixture.querySelector('.proposal-card') && inputs() === original && fixture.querySelector('[role="alert"]'), `Untrusted ${attack} candidate pricing was promoted to held costs`);
        }
      } finally { await unmount(); window.fetch = priorFetch; window.WebSocket = priorSocket; window.Worker = priorWorker }
    });
    await test('Workspace captures preserve holdings and scenarios, group automatic Undo and reject late edits', async () => {
      await unmount(); const priorFetch = window.fetch, originalSocket = window.WebSocket, originalWorker = window.Worker;
      let socket: { onmessage?: (event: { data: string }) => void } | undefined, captures = 0;
      let release: (() => void) | undefined, delay = false;
      const stamp = new Date(fixedNow - 120000).toISOString(), expiry = '2027-10-09T20:00:00.000Z';
      const contracts = [90, 95, 100, 105, 110].flatMap(strike => ['call', 'put'].map(type => ({ contractId: `SPY   271009${type === 'call' ? 'C' : 'P'}${String(strike * 1000).padStart(8, '0')}`, type, strike, expiry, multiplier: 100, bid: 2, ask: 3, iv: .2, quoteAsOf: stamp })));
      const snapshot = { id: 'workspace-capture', source: 'Tastytrade', underlying: 'SPY', spot: 100, spotAsOf: stamp, retrievedAt: stamp, availableExpiries: ['2027-10-09'], contracts, contractTerms: undefined as MarketSnapshot['contractTerms'] };
      const contract = contracts.find(item => item.strike === 100 && item.type === 'call')!;
      let expectedSnapshot = snapshot.id, importedWorkspace = false;
      let delayLists = false; const listResponses: Array<(response: Response) => void> = [];
      window.WebSocket = class { constructor() { socket = this } onmessage?: (event: { data: string }) => void; close() {} } as unknown as typeof WebSocket;
      window.fetch = (async (url, init) => {
        const json = (body: unknown) => new Response(JSON.stringify(body));
        if (url === '/api/bootstrap') return json({ session: { label: 'Synthetic capture test', local: true, recoveryKey: 'disabled-in-test' } });
        if (url === '/api/strategies') return delayLists ? new Promise<Response>(resolve => listResponses.push(resolve)) : json({ strategies: importedWorkspace ? [{ id: 'imported-workspace', title: 'Imported fixture', revision: 1, createdAt: stamp, updatedAt: stamp }] : [] });
        if (url === '/api/strategies/import') { importedWorkspace = true; return Response.json({ record: { id: 'imported-workspace', revision: 1 } }, { status: 201 }) }
        if (String(url).startsWith('/api/chain?')) {
          assert(new URL(String(url), location.origin).searchParams.get('retain') !== '', 'Empty retained-contract query rejected by real endpoint');
          assert(new URL(String(url), location.origin).searchParams.get('expiries') !== '', 'Empty expiry query rejected by real endpoint');
          return json({ snapshot });
        }
        assert(url === '/api/feed/capture' && init?.method === 'POST', 'Unexpected workspace request blocked');
        const body = JSON.parse(String(init.body));
        if (Array.isArray(body.contractIds) && body.contractIds.length === 0) {
          assert(body.snapshotId === snapshot.id, 'Stock-only capture lost owned snapshot');
          const at = new Date(fixedNow).toISOString();
          return json({ snapshot: { ...snapshot, id: 'stock-capture', spot: 102, captureSource: 'DXLink', retrievedAt: at, spotAsOf: at, spotSourceTimes: { bid: at, ask: at }, availableExpiries: [], contracts: [] } });
        }
        assert(body.snapshotId === expectedSnapshot && JSON.stringify(body.contractIds) === JSON.stringify([contract.contractId]), 'Capture lost snapshot or contract identity');
        const index = ++captures, at = new Date(fixedNow).toISOString();
        if (delay) await new Promise<void>(resolve => { release = resolve });
        expectedSnapshot = `capture-${index}`;
        return json({ snapshot: { ...snapshot, id: expectedSnapshot, captureSource: 'DXLink', spot: 102 + index, retrievedAt: at, spotAsOf: at, spotSourceTimes: { bid: at, ask: at }, contracts: [{ ...contract, bid: 4, ask: 5, iv: delay ? .4 : .3, quoteAsOf: at, sourceTimes: { bid: at, ask: at, iv: at } }] } });
      }) as typeof fetch;
      const field = (label: string) => fixture.querySelector<HTMLInputElement>(`[aria-label="${label}"]`)!;
      const waitFor = async (check: () => boolean) => {
        for (let i = 0; i < 800 && !check(); i++) await settleTimers();
        assert(check(), `Workspace did not reach expected state: ${fixture.querySelector('#workspace-chart')?.textContent}`);
      };
      const auto = () => field('Automatic repricing');
      const termsText = () => fixture.querySelector('[aria-label="Recorded contract terms"]')?.textContent;
      const holdings = () => ['Entry premium', 'Contracts', 'Shares', 'Share entry cost'].map(label => field(label).value).join();
      const checkMobileLegs = () => {
        if (!matchMedia('(max-width: 720px)').matches) return;
        for (const row of fixture.querySelectorAll<HTMLElement>('.leg-row')) {
          assert(row.clientWidth > 0 && row.scrollWidth <= row.clientWidth, 'Mobile leg row requires horizontal scrolling');
          assert([...row.querySelectorAll('label > span')].every(label => getComputedStyle(label).display !== 'none'), 'Mobile leg labels hidden');
          assert([...row.querySelectorAll('input, select, button')].every(control => control.getBoundingClientRect().height >= 42), 'Mobile leg control too short');
        }
      };
      async function commitField(label: string, value: string) {
        field(label).focus(); await change(label, value); await act(async () => field(label).blur());
      }
      async function undo() { await act(async () => fixture.querySelector<HTMLButtonElement>('[aria-label="Undo"]')!.click()) }
      try {
        root = createRoot(fixture); await act(async () => root!.render(<App />));
        assert(fixture.querySelector('input[aria-label="Saved JSON file"]'), 'Saved workspace has no import file control');
        const originalInputs = () => [...fixture.querySelectorAll('#workspace-legs input, #workspace-legs select')].map(input => (input as HTMLInputElement).value).join();
        const beforeImport = originalInputs(), savedSelection = field('Saved positions').value;
        const importFile = new File([JSON.stringify({ format: 'argus-saved-position', formatVersion: 1, exportedAt: stamp, record: { id: 'exported-fixture', title: 'Imported fixture', revision: 1, createdAt: stamp, updatedAt: stamp, state: createStrategy('long-call'), snapshot: null, lifecycle: null } })], 'fixture.json', { type: 'application/json' });
        const files = new DataTransfer(); files.items.add(importFile);
        await act(async () => { field('Saved JSON file').files = files.files; field('Saved JSON file').dispatchEvent(new Event('change', { bubbles: true })); await importFile.text(); });
        await waitFor(() => !!fixture.querySelector('.import-preview'));
        assert(!importedWorkspace, 'File selection wrote a saved position');
        await click('Import as new saved position');
        await waitFor(() => !!fixture.querySelector('option[value="imported-workspace"]'));
        assert(originalInputs() === beforeImport && field('Saved positions').value === savedSelection && fixture.querySelector<HTMLButtonElement>('[aria-label="Undo"]')!.disabled, 'Import replaced holdings, selection or Undo');
        delayLists = true;
        await click('Refresh saved list'); await click('Refresh saved list');
        assert(listResponses.length === 2, 'Overlapping list reads did not start');
        await act(async () => listResponses[1](Response.json({ strategies: [{ id: 'newer-list', title: 'Newest saved list', revision: 1, createdAt: stamp, updatedAt: stamp }] })));
        await act(async () => listResponses[0](Response.json({ strategies: [] })));
        assert(fixture.querySelector('option[value="newer-list"]'), 'Late saved list replaced the newest response');
        delayLists = false;
        assert(termsText()?.includes('Supported contract terms are unavailable') && termsText()?.includes('do not infer'), 'Sample position inferred contract terms');
        checkMobileLegs();
        const checkChartControls = () => {
          const card = fixture.querySelector<HTMLElement>('#workspace-chart')!;
          const bounds = card.getBoundingClientRect();
          assert(bounds.left >= 0 && bounds.right <= document.documentElement.clientWidth, 'Chart card exceeds viewport');
          for (const control of card.querySelectorAll<HTMLElement>('.canvas-head button, .canvas-head select, .canvas-head input')) {
            const rect = control.getBoundingClientRect();
            assert(rect.width > 0 && rect.left >= bounds.left && rect.right <= bounds.right, `Chart control clipped: ${control.getAttribute('aria-label') ?? control.textContent}`);
            if (control.tagName === 'BUTTON') assert(control.scrollWidth <= control.clientWidth, `Chart button text clipped: ${control.textContent}`);
            if (matchMedia('(max-width: 720px)').matches) assert(rect.height >= 44, 'Mobile chart control is too short');
          }
        };
        checkChartControls();
        for (const metric of ['delta', 'gamma', 'theta', 'vega', 'rho', 'pnl']) { await change('Chart metric', metric); checkChartControls() }
        for (const mode of ['Table', 'Heatmap']) { await click(mode); checkChartControls() }
        await click('Preview American'); checkChartControls();
        await click('Return to European'); checkChartControls();
        await click('Curve'); checkChartControls();
        assert(fixture.querySelector<HTMLButtonElement>('[aria-label="Undo"]')!.disabled, 'Chart mode selection edited the position');
        const thesisPanel = fixture.querySelector<HTMLDetailsElement>('details.thesis-card')!;
        const undoDisabled = fixture.querySelector<HTMLButtonElement>('[aria-label="Undo"]')!.disabled;
        await click('Freeze comparison');
        const baselineText = fixture.querySelector('.comparison-banner details')!.textContent;
        await waitFor(() => !!fixture.querySelector('path.proposal-line')?.getAttribute('d'));
        const baselinePath = fixture.querySelector('path.proposal-line')!.getAttribute('d');
        assert(fixture.querySelector<HTMLButtonElement>('[aria-label="Undo"]')!.disabled === undoDisabled, 'Freezing comparison changed Undo');
        await change('Contracts', '2');
        await waitFor(() => !!fixture.querySelector('path.proposal-line')?.getAttribute('d'));
        assert(fixture.querySelector('.comparison-banner details')!.textContent === baselineText, 'Manual edit mutated frozen baseline');
        await undo();
        await waitFor(() => !!fixture.querySelector('path.proposal-line')?.getAttribute('d'));
        assert(fixture.querySelector('path.proposal-line')!.getAttribute('d') === baselinePath, 'Restored position changed baseline curve');
        const originalDate = field('Scenario date UTC').value;
        await change('Scenario time', '500');
        await waitFor(() => fixture.querySelector('.comparison-banner')!.textContent!.includes('overlay hidden'));
        assert(!fixture.querySelector('path.proposal-line'), 'Incompatible scenario retained overlay');
        await undo();
        assert(field('Scenario date UTC').value === originalDate, 'Scenario Undo failed');
        await waitFor(() => !!fixture.querySelector('path.proposal-line')?.getAttribute('d'));
        await change('Contracts', '2');
        await click('Replace baseline');
        assert(fixture.querySelector('.comparison-banner details')!.textContent !== baselineText, 'Replace baseline retained old inputs');
        await click('Clear baseline');
        assert(!fixture.querySelector('.comparison-banner') && field('Contracts').value === '2', 'Clearing baseline changed position or left comparison');
        await undo();
        const thesisField = fixture.querySelector<HTMLTextAreaElement>('#trade-thesis')!;
        assert(thesisPanel && !thesisPanel.open && thesisPanel.textContent?.includes('optional'), 'Empty thesis should start collapsed');
        await act(async () => thesisPanel.querySelector('summary')!.click());
        assert(thesisPanel.open, 'Thesis disclosure did not open');
        await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(thesisField, 'Expect a range-bound week'); thesisField.dispatchEvent(new Event('input', { bubbles: true })); });
        await act(async () => thesisPanel.querySelector('summary')!.click());
        assert(!thesisPanel.open && thesisField.value === 'Expect a range-bound week' && thesisPanel.querySelector('summary')!.textContent?.includes('Included in review'), 'Collapsing thesis lost text or its inclusion indicator');
        await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(thesisField, '   '); thesisField.dispatchEvent(new Event('input', { bubbles: true })); });
        assert(thesisPanel.querySelector('summary')!.textContent?.includes('optional'), 'Whitespace-only thesis incorrectly included');
        await act(async () => [...fixture.querySelectorAll<HTMLButtonElement>('.template-list button')].find(item => item.textContent?.includes('Long call'))!.click());
        await click('Use real prices'); await waitFor(() => !!auto());
        assert(termsText()?.includes('Supported contract terms are unavailable'), 'Quotes without recorded terms inferred exercise style');
        const comparison = () => fixture.querySelector<HTMLElement>('[aria-label="Quote and model comparison"]');
        assert(comparison(), 'Quote/model comparison missing');
        const expectedPnl = calculateStrategy(createMarketStrategy('long-call', snapshot as MarketSnapshot)).scenarioPnl;
        const usd = (value: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
        await waitFor(() => comparison()!.querySelectorAll('dd')[1]?.textContent === usd(expectedPnl));
        assert(comparison()!.querySelectorAll('dd')[0].textContent === '$0.00' && comparison()!.querySelectorAll('dd')[2].textContent === usd(expectedPnl), 'Quote/model comparison amounts do not reconcile');
        assert(comparison()!.textContent?.includes('not measured mispricing') && comparison()!.textContent?.includes(stamp), 'Quote/model scope or dated provenance missing');
        await act(async () => comparison()!.querySelector('summary')!.click());
        assert(comparison()!.scrollWidth <= comparison()!.clientWidth, 'Quote/model comparison overflows');
        checkMobileLegs();
        assert(field('Entry premium').readOnly && field('Implied volatility').readOnly && fixture.querySelector('.contract-quote')?.textContent?.includes(stamp), 'Quoted price controls or provenance missing');
        await click('Keep entry costs'); await change('Entry premium', '1.23'); await change('Contracts', '2');
        checkMobileLegs();
        assert(!field('Entry premium').readOnly && field('Implied volatility').readOnly && fixture.querySelector('.leg-row')?.textContent?.includes('Entry cost'), 'Held entry lost editable cost distinction');
        await click('Add shares'); await commitField('Shares', '50'); await commitField('Share entry cost', '98');
        const held = holdings(); assert(held === '1.23,2,50,98', 'Holding fixture did not commit');
        const optionCount = fixture.querySelectorAll('.leg-row').length;
        for (let index = 0; index < optionCount; index++) await act(async () => fixture.querySelector<HTMLButtonElement>('.leg-row [aria-label="Remove leg"]')!.click());
        assert(fixture.querySelectorAll('.leg-row').length === 0 && field('Shares').value === '50', 'Last option cannot be removed into stock-only holdings');
        await waitFor(() => fixture.querySelector('.metric-ribbon')?.textContent?.includes('$100') === true);
        assert(!fixture.querySelector('.expiry-reference') && !fixture.querySelector('[aria-label="Scenario time"]'), 'Stock-only view invented an option expiry');
        assert(fixture.textContent?.includes('Stock-only') && fixture.textContent?.includes('No option expiry'), 'Stock-only scope is not visible');
        await click('Table'); await waitFor(() => !!fixture.querySelector('[aria-label="Scenario P/L and Greeks"]'));
        await click('Curve');
        await click('Freeze comparison');
        await commitField('Shares', '60');
        await waitFor(() => !!fixture.querySelector('.proposal-line')?.getAttribute('d'));
        assert(!fixture.querySelector('.comparison-banner')?.textContent?.includes('overlay hidden'), 'Stock-only baseline is incompatible');
        await undo(); await click('Clear baseline');
        await click('Connect live feed');
        await act(async () => {
          socket?.onmessage?.({ data: JSON.stringify({ type: 'status', state: 'connected', message: 'Connected' }) });
          socket?.onmessage?.({ data: JSON.stringify({ type: 'quote', contractId: 'SPY', bid: 101, ask: 103, bidTime: fixedNow, askTime: fixedNow, receivedAt: new Date(fixedNow).toISOString() }) });
        });
        await click('Capture for analysis');
        assert(field('Shares').value === '50' && field('Share entry cost').value === '98' && fixture.querySelectorAll('.leg-row').length === 0, 'Underlying capture changed stock holdings');
        assert(!fixture.querySelector('[aria-label="Position snapshot source age"]')?.textContent?.includes('Source time unavailable'), 'Underlying capture lost its source time');
        await click('Disconnect');
        await click('Refresh prices');
        assert(!fixture.querySelector('.calculation-error') && field('Shares').value === '50' && field('Share entry cost').value === '98' && fixture.querySelectorAll('.leg-row').length === 0, 'Stock-only refresh failed or changed held inventory');
        await undo();
        await undo();
        for (let index = 0; index < optionCount; index++) await undo();
        assert(holdings() === held, 'Stock-only Undo lost option or stock costs');
        const snapshotAge = fixture.querySelector('[aria-label="Position snapshot source age"]')!.textContent;
        snapshot.contractTerms = { exerciseStyle: 'American', settlement: 'physical-shares', sharesPerContract: 100, settlementSession: 'PM' };
        await click('Connect live feed');
        const emit = async (value: unknown) => { await act(async () => socket?.onmessage?.({ data: JSON.stringify(value) })) };
        await emit({ type: 'status', state: 'connected', message: 'Connected' });
        for (const id of ['SPY', contract.contractId]) await emit({ type: 'quote', contractId: id, bid: 1, ask: 2, bidTime: fixedNow, askTime: fixedNow, receivedAt: new Date(fixedNow).toISOString() });
        await emit({ type: 'greeks', contractId: contract.contractId, iv: .3, time: fixedNow, receivedAt: new Date(fixedNow).toISOString() });
        assert(captures === 0 && fixture.querySelector('[aria-label="Position snapshot source age"]')!.textContent === snapshotAge, 'Uncaptured stream changed snapshot age');
        await waitFor(() => !auto().disabled); await act(async () => auto().click());
        await waitFor(() => captures >= 2 && field('Scenario spot').value === '104');
        assert(termsText()?.includes('Recorded snapshot terms: American exercise') && termsText()?.includes('100 shares per contract') && termsText()?.includes('PM settlement') && termsText()?.includes('not a current corporate-action check'), 'Captured recorded terms or scope missing');
        assert(holdings() === held && field('Implied volatility').value === '30', 'Automatic capture changed holdings or omitted IV');
        await act(async () => auto().click()); await undo(); expectedSnapshot = snapshot.id;
        assert(field('Scenario spot').value === '100' && field('Implied volatility').value === '20' && holdings() === held, 'Undo did not restore pre-session state');
        assert(termsText()?.includes('Supported contract terms are unavailable'), 'Undo retained contract terms from a later snapshot');
        const quoteBeforeScenario = comparison()!.querySelectorAll('dd')[0].textContent;
        await commitField('Scenario spot', '97.5');
        const changedScenario = createMarketStrategy('long-call', snapshot as MarketSnapshot);
        changedScenario.legs = changedScenario.legs.map(leg => ({ ...leg, contracts: 2, entryPrice: 1.23 }));
        changedScenario.stock = { shares: 50, entryPrice: 98 }; changedScenario.scenarioSpot = 97.5;
        const changedPnl = calculateStrategy(changedScenario).scenarioPnl;
        await waitFor(() => comparison()!.querySelectorAll('dd')[1]?.textContent === usd(changedPnl));
        assert(quoteBeforeScenario === '$354.00' && comparison()!.querySelectorAll('dd')[0].textContent === quoteBeforeScenario && comparison()!.querySelectorAll('dd')[2].textContent === usd(changedPnl - 354) && comparison()!.textContent?.includes('spot $97.50'), 'Held-entry difference, dated quote P/L or scenario labels are wrong');
        const future = new Date(fixedNow + 3600000).toISOString().slice(0, -1);
        await change('Scenario date UTC', future);
        await click('Capture for analysis');
        assert(field('Scenario spot').value === '97.5' && Date.parse(`${field('Scenario date UTC').value}Z`) === Date.parse(`${future}Z`) && holdings() === held, 'Capture changed deliberate scenario or holdings');
        const iv = field('Implied volatility').value;
        delay = true; await click('Capture for analysis'); assert(release, 'Delayed capture not started');
        await change('Entry premium', '1.25'); await act(async () => release!());
        assert(field('Entry premium').value === '1.25' && field('Implied volatility').value === iv, 'Late capture overwrote an edit');
        assert(fixture.textContent?.includes('The position changed while quotes loaded'), 'Late capture was not explicitly rejected');
        let pendingWorker: { onerror?: () => void } | undefined;
        window.Worker = class { onerror?: () => void; constructor() { pendingWorker = this } postMessage() {} terminate() {} } as unknown as typeof Worker;
        await commitField('Scenario spot', '98');
        assert(pendingWorker && comparison()!.querySelectorAll('dd')[1].textContent === 'Calculating…' && comparison()!.querySelectorAll('dd')[2].textContent === '—', 'Pending valuation retained previous model P/L or difference');
        await act(async () => pendingWorker!.onerror!());
        assert(comparison()!.querySelectorAll('dd')[1].textContent === 'Unavailable' && comparison()!.querySelectorAll('dd')[2].textContent === '—', 'Failed valuation retained previous model P/L or difference');
      } finally { release?.(); await unmount(); window.fetch = priorFetch; window.WebSocket = originalSocket; window.Worker = originalWorker }
    });
    await test('Stream eligibility ages without events, stops automatic capture and requires explicit recovery', async () => {
      await unmount(); const originalSocket = window.WebSocket;
      let socket: { onmessage?: (event: { data: string }) => void } | undefined, ticks = 0;
      const contract = state.legs[0].contractId!;
      window.WebSocket = class { constructor() { socket = this } onmessage?: (event: { data: string }) => void; close() {} } as unknown as typeof WebSocket;
      const emit = async (value: unknown) => { await act(async () => socket?.onmessage?.({ data: JSON.stringify(value) })) };
      const capture = () => [...fixture.querySelectorAll('button')].find(button => button.textContent === 'Capture for analysis')!;
      const automatic = () => fixture.querySelector<HTMLInputElement>('[aria-label="Automatic repricing"]')!;
      function StreamHost() { const [auto, setAuto] = useState(false); return <StreamedMarks snapshot={{ id: 'stream-ui', underlying: 'SPY' } as any} contracts={[contract]} captureEnabled reviewEnabled onCapture={() => {}} onReview={() => {}} automatic={auto} onAutomatic={setAuto} onTick={async () => { ticks++ }} /> }
      const quote = (id: string, time: number) => ({ type: 'quote', contractId: id, bid: 1, ask: 2, bidTime: time, askTime: time, receivedAt: new Date(time).toISOString() });
      const greeks = (time: number) => ({ type: 'greeks', contractId: contract, iv: .25, time, receivedAt: new Date(time).toISOString() });
      try {
        root = createRoot(fixture); await act(async () => root!.render(<StreamHost />));
        await click('Connect live feed'); await emit({ type: 'status', state: 'connected', message: 'Connected' });
        await emit(quote('SPY', fixedNow)); await emit(quote(contract, fixedNow));
        assert(capture().disabled && fixture.textContent?.includes('Waiting for complete'), 'Partial quote-only feed admitted');
        await emit(greeks(fixedNow)); assert(!capture().disabled, 'Complete dated feed rejected');
        await act(async () => automatic().click()); assert(ticks === 1 && automatic().checked, 'Automatic capture did not start');
        Date.now = () => fixedNow + 60001;
        await act(async () => { await new Promise(resolve => setTimeout(resolve, 1100)) });
        assert(capture().disabled && !automatic().checked && fixture.textContent?.includes('Stream updates too old'), 'Silent stream did not expire and stop automatic capture');
        await emit(quote('SPY', Date.now())); await emit(quote(contract, Date.now())); await emit(greeks(Date.now()));
        assert(!capture().disabled && !automatic().checked && ticks === 1, 'Recovery resumed capture without consent');
        await click('Disconnect'); assert(capture().disabled && fixture.textContent?.includes('Disconnected'), 'Disconnect kept capture eligible');
      } finally { await unmount(); window.WebSocket = originalSocket; Date.now = () => fixedNow }
    });
    await test('IV discussion binds contract and observations, keeps failed questions, and cancels switched selections', async () => {
      await change('History resolution', 'iv'); await click('Load history'); await current().finish();
      const question = () => fixture.querySelector<HTMLInputElement>('[aria-label="History question"]')!;
      await change('History question', 'Explain zero IV'); await click('Discuss history');
      const first = current();
      assert(first.url === '/api/intraday-history/iv-discuss' && first.body.contractId === state.legs[0].contractId && first.body.selectedTime === first.body.range.start, 'IV selection not sent');
      assert(!('history' in first.body), 'Browser supplied its own history');
      await first.finish(); assert(fixture.textContent?.includes('Verified synthetic intraday discussion.'), 'Valid IV reply missing');
      await change('Historical IV contract', '1');
      assert(!fixture.textContent?.includes('Verified synthetic intraday discussion.') && question().value === '', 'Previous contract conversation survived');
      for (const corrupt of [
        (body: any) => { body.contractId = state.legs[0].contractId; },
        (body: any) => { body.history.rows[0].legs[1].iv = .26; },
        (body: any) => { body.selectedTime += 300000; },
        (body: any) => { body.reply.operations = []; },
      ]) {
        await change('History question', 'Explain this contract'); await click('Discuss history'); await current().finish(corrupt);
        assert(!fixture.textContent?.includes('Verified synthetic intraday discussion.') && question().value === 'Explain this contract', 'Mismatched reply admitted or question lost');
      }
      await click('Discuss history'); await current().finish(undefined, 502);
      assert(question().value === 'Explain this contract' && !fixture.textContent?.includes('Verified synthetic intraday discussion.'), 'Rejected reply admitted');
      await click('Discuss history'); const late = current(); await change('Historical IV contract', '0');
      assert(late.signal?.aborted, 'Contract switch did not abort discussion'); await late.finish();
      assert(!fixture.textContent?.includes('Verified synthetic intraday discussion.'), 'Late contract reply survived');
      await change('History question', 'Inspect missing IV'); await click('Discuss history'); const prior = current();
      await change('Inspect history interval', '1'); assert(prior.signal?.aborted, 'Bucket switch did not abort discussion'); await prior.finish();
      assert(!fixture.textContent?.includes('Verified synthetic intraday discussion.'), 'Late bucket reply survived');
    });
    await test('IV mode keeps percentage units, contract selection and gaps without inference; mode changes discard late IV', async () => {
      await change('History resolution', 'iv'); await click('Load history'); const pending = current();
      assert(pending.url === '/api/intraday-history/iv', 'Wrong IV endpoint'); await pending.finish();
      const readout = () => fixture.querySelector('.history-readout')?.textContent ?? '';
      assert(readout().includes('0.00%') && fixture.querySelector('[aria-label="History question"]'), 'IV zero or discussion form missing');
      const facts = () => fixture.querySelector('[aria-label="Calculated historical IV facts"]')?.textContent ?? '';
      assert(facts().includes('0.00%') && facts().includes('0.00 percentage points') && facts().includes('Unavailable'), 'Calculated zero/range change or missing predecessor lost');
      const before = requests;
      await click('Zoom in'); await change('Historical IV contract', '1');
      assert(readout().includes('25.00%') && requests === before, 'Contract selector changed units or fetched');
      assert(facts().includes('25.00%') && !facts().includes('0.00%'), 'Facts retained previous contract values');
      assert([...fixture.querySelectorAll('button')].find(button => button.textContent === 'Reset zoom')?.disabled, 'Contract change retained old zoom');
      await change('Inspect history interval', '1'); assert(readout().includes('Unavailable'), 'Missing IV filled');
      assert(!fixture.querySelector('[aria-label="Historical underlying price"]') && !fixture.querySelector('.history-envelope'), 'IV invented monetary view');
      await click('Load history'); const late = current(); await change('History resolution', 'intraday');
      assert(late.signal?.aborted, 'Mode switch did not abort IV'); await late.finish();
      assert(!fixture.querySelector('.history-charts'), 'Late IV survived mode change');
      await click('Load history'); await current().finish();
      assert(fixture.querySelector('[aria-label="Historical underlying price"]') && readout().includes('$'), 'Price history did not return');
    });
    await test('History zoom and pan preserve global selection, prices and gaps without inspecting a new bucket', async () => {
      await unmount()
      const rows = Array.from({ length: 9 }, (_, i) => ({ label: `Bucket ${i}`, value: i === 3 ? null : i - 4, underlying: 770 + i }))
      const inspections: number[] = [], before = requests
      function ZoomHost() {
        const [selected, setSelected] = useState(4)
        return <HistoryCharts rows={rows} selected={selected} onInspect={index => { inspections.push(index); setSelected(index) }} intraday priceScale={100} />
      }
      root = createRoot(fixture); await act(async () => root!.render(<ZoomHost />))
      const underlying = () => fixture.querySelector('[aria-label="Historical underlying price"]')!
      const visible = () => [...underlying().querySelectorAll('.history-point title')].map(title => title.textContent?.split(':')[0]).join(',')
      const selected = () => fixture.querySelector<HTMLInputElement>('[aria-label="Inspect history interval"]')!
      const readout = () => fixture.querySelector('.history-readout')!.textContent ?? ''
      await click('Zoom in')
      assert(visible() === 'Bucket 2,Bucket 3,Bucket 4,Bucket 5,Bucket 6', 'Nine-row zoom did not center a five-row window on selected bucket')
      assert(inspections.length === 0 && selected().value === '4' && readout().includes('$0.00'), 'Zoom changed selection or genuine zero')
      assert(fixture.querySelector('[aria-label="Historical strategy value"]')!.querySelectorAll('.history-point').length === 4, 'Zoom filled the missing strategy bucket')
      await click('Later')
      assert(visible() === 'Bucket 4,Bucket 5,Bucket 6,Bucket 7,Bucket 8' && inspections.length === 0, 'Later pan did not move half a window without inspecting')
      const svg = underlying(), rect = svg.getBoundingClientRect()
      await act(async () => svg.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'mouse', button: 0, clientX: rect.left + rect.width * 100 / 720, clientY: rect.top + 50 })))
      assert(inspections.join(',') === '4' && selected().value === '4', 'Zoomed pointer mapped left edge to a local instead of global index')
      await change('Inspect history interval', '0')
      assert(selected().max === '8' && inspections.join(',') === '4,0' && visible() === 'Bucket 0,Bucket 1,Bucket 2,Bucket 3,Bucket 4', 'Global slider did not reveal bucket zero at unchanged window size')
      assert(readout().includes('-$4.00'), 'Zoomed selection changed signed inventory value')
      await click('Later'); await click('Earlier')
      assert(visible() === 'Bucket 0,Bucket 1,Bucket 2,Bucket 3,Bucket 4' && inspections.join(',') === '4,0', 'Pan changed selected facts or failed to return earlier')
      await change('Inspect history interval', '3')
      assert(readout().includes('Unavailable') && readout().includes('$773.00'), 'Zoom changed missing inventory or independent underlying value')
      const committed = inspections.join(',')
      await click('Zoom out')
      assert(underlying().querySelectorAll('.history-point').length === 9 && inspections.join(',') === committed, 'Zoom out did not restore full window without inspecting')
      await click('Zoom in'); await click('Reset zoom')
      assert(underlying().querySelectorAll('.history-point').length === 9 && selected().value === '3' && inspections.join(',') === committed && requests === before, 'Reset changed selection or fetched new history')
    })
    await test('Dense seven-day hover probe keeps all 2016 buckets and does not commit selection', async () => {
      await unmount()
      const start = Math.floor(fixedNow / 300000) * 300000 - 2016 * 300000
      const rows = Array.from({ length: 2016 }, (_, i) => ({ label: new Date(start + i * 300000).toISOString(), value: i - 1000, underlying: 770 + i / 1000 }))
      let inspections = 0
      root = createRoot(fixture)
      await act(async () => root!.render(<HistoryCharts rows={rows} selected={1000} onInspect={() => { inspections++ }} intraday priceScale={100} />))
      const charts = fixture.querySelectorAll('svg')
      assert(charts.length === 2 && [...charts].every(chart => chart.querySelectorAll('.history-point').length === 2016), 'Dense fixture did not render 2016 points per chart')
      const timings: number[] = [], before = requests
      for (const slot of [0, 183, 366, 549, 732, 915, 1098, 1281, 1464, 1647, 1830, 2015]) {
        const svg = charts[0], rect = svg.getBoundingClientRect(), began = performance.now()
        assert(rect.width > 0, 'Dense chart has no width')
        await act(async () => svg.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerType: 'mouse', clientX: rect.left + rect.width * (100 + slot / 2015 * 600) / 720, clientY: rect.top + 50 })))
        timings.push(performance.now() - began)
        assert(fixture.querySelector('.history-readout')?.textContent?.includes(rows[slot].label), `Dense hover readout missed bucket ${slot}`)
        assert(fixture.querySelector<HTMLInputElement>('[aria-label="Inspect history interval"]')?.value === '1000' && inspections === 0 && requests === before, 'Dense hover committed selection or fetched')
      }
      const ordered = [...timings].sort((a, b) => a - b)
      output.textContent += `PROBE dense-week hover: 2016 points/chart, 12 moves, median ${((ordered[5] + ordered[6]) / 2).toFixed(1)} ms, max ${ordered.at(-1)!.toFixed(1)} ms (diagnostic, no timing threshold).\n`
    })
    await test('Queued initial history is cancelled before fetch by mode, manual date and close changes', async () => {
      await unmount()
      const originalQueue = window.queueMicrotask
  try {
        for (const boundary of ['mode', 'date', 'close']) {
          request = null; requests = 0
          const queued: VoidFunction[] = []
          window.queueMicrotask = callback => { queued.push(() => callback()) }
          root = createRoot(fixture)
          await act(async () => root!.render(<StrictMode><Host /></StrictMode>))
          assert(queued.length > 0 && requests === 0, `${boundary}: initial work was not queued before fetch`)
          if (boundary === 'mode') await change('History resolution', 'intraday')
          if (boundary === 'date') {
            const start = fixture.querySelector<HTMLInputElement>('[aria-label="History start date"]')!.value
            await change('History start date', new Date(Date.parse(start) + 86400000).toISOString().slice(0, 10))
          }
          if (boundary === 'close') await click('Close history')
          window.queueMicrotask = originalQueue
          await act(async () => { for (const callback of queued) callback() })
          await settleTimers()
          assert(requests === 0 && !fixture.querySelector('.history-charts'), `${boundary}: cancelled queued work started a request`)
          await unmount()
        }
      } finally {
        window.queueMicrotask = originalQueue
      }
    })
    await test('Opening daily history automatically loads exactly one default seven-day request under StrictMode', async () => {
      assert(requests === 1, 'Opening history did not issue exactly one automatic request')
      const pending = daily(), days = (Date.parse(pending.body.range.end) - Date.parse(pending.body.range.start)) / 86400000 + 1
      assert(days === 7, 'Automatic opening range is not seven inclusive dates')
      assert(fixture.querySelector<HTMLInputElement>('[aria-label="History start date"]')?.value === pending.body.range.start && fixture.querySelector<HTMLInputElement>('[aria-label="History end date"]')?.value === pending.body.range.end, 'Automatic request does not match date controls')
      await pending.finish(); await settleTimers()
      assert(requests === 1 && fixture.querySelector('.history-charts'), 'Automatic result failed or retried unexpectedly')
    }, true)
    await test('Automatic history never retries after failure or deliberate changes and ignores invalidated late replies', async () => {
      for (const [index, boundary] of ['failure', 'date', 'mode', 'position', 'close'].entries()) {
        if (index) { await unmount(); request = null; requests = 0; await mount(true) }
        assert(requests === 1, `${boundary}: automatic request count incorrect`)
        const pending = daily()
        if (boundary === 'failure') await pending.finish(undefined, 503)
        if (boundary === 'date') await change('History start date', new Date(Date.parse(pending.body.range.start) + 86400000).toISOString().slice(0, 10))
        if (boundary === 'mode') await change('History resolution', 'intraday')
        if (boundary === 'position') await act(async () => root!.render(<StrictMode><Host position={{ ...state, version: state.version + 1 }} /></StrictMode>))
        if (boundary === 'close') await click('Close history')
        if (boundary !== 'failure') { assert(pending.signal?.aborted, `${boundary} did not abort automatic request`); await pending.finish() }
        await settleTimers()
        assert(requests === 1 && !fixture.querySelector('.history-charts'), `${boundary}: automatic retry or late chart appeared`)
        if (boundary === 'failure') assert(fixture.querySelector('[role="alert"]'), 'Automatic load failure not reported')
        if (boundary === 'position') assert(fixture.textContent?.includes('Position changed'), 'Stale position explanation missing')
        if (boundary === 'close') assert(!fixture.querySelector('dialog'), 'Closed history revived')
      }
    }, true)
    await test('Seven-day span keeps exact UTC dates and cancels pending loads when span changes', async () => {
      await change('Intraday span', '7'); await click('Load history'); const pending = current()
      assert(pending.body.range.start === Date.parse(`${today}T00:00:00Z`) - 6 * 86400000, 'Seven-day start incorrect')
      assert(pending.body.range.end === Math.floor(fixedNow / 300000) * 300000, 'Seven-day end includes unfinished interval')
      await pending.finish()
      const firstDate = new Date(pending.body.range.start).toISOString().slice(0, 10)
      assert(fixture.querySelector('.history-readout')?.textContent?.includes(`${firstDate} 00:05 UTC`), 'Multi-day selection lacks UTC date')
      const discussion = await discuss()
      assert(JSON.stringify(discussion.body.range) === JSON.stringify(pending.body.range), 'Discussion lost seven-day range')
      await change('Intraday span', '1'); assert(discussion.signal?.aborted, 'Span change did not abort discussion')
      await discussion.finish(); assert(!fixture.querySelector('.history-charts'), 'Late seven-day discussion survived span change')
      await click('Load history'); const single = current(); await change('Intraday span', '7')
      assert(single.signal?.aborted, 'Span change did not abort history load')
      await single.finish(); assert(!fixture.querySelector('.history-charts'), 'Late single-day history survived span change')
    })
    await test('Current UTC day ends at the last completed five-minute boundary', async () => {
      await click('Load history'); const pending = current()
      assert(pending.body.range.start === Date.parse(`${today}T00:00:00Z`), 'UTC midnight start incorrect')
      assert(pending.body.range.end === Math.floor(fixedNow / 300000) * 300000, 'Incomplete current bucket requested')
      await pending.finish()
      assert(fixture.querySelector('.history-charts'), 'Valid intraday response not rendered')
    })
    await test('Mode and date changes abort and ignore late responses even if fetch ignores cancellation', async () => {
      await click('Load history'); const first = current(); await change('History resolution', 'daily')
      assert(first.signal?.aborted, 'Mode switch did not abort'); await first.finish()
      assert(!fixture.querySelector('.history-charts'), 'Late intraday result survived daily switch')
      await change('History resolution', 'intraday'); await click('Load history'); const second = current()
      const previous = new Date(Date.parse(today) - 86400000).toISOString().slice(0, 10)
      await change('Intraday date UTC', previous); assert(second.signal?.aborted, 'Date change did not abort'); await second.finish()
      assert(!fixture.querySelector('.history-charts'), 'Late result survived date change')
    })
    await test('Close unmounts the real dialog, aborts pending work and suppresses late rendering', async () => {
      const before = closes; await click('Load history'); const pending = current(); await click('Close history')
      assert(closes === before + 1 && pending.signal?.aborted, 'Close did not clean up request')
      await pending.finish(); assert(!fixture.querySelector('dialog'), 'Closed dialog was revived')
    })
    await test('Shared native inspector and pointer preserve zero, negative and missing values without quote envelope', async () => {
      await click('Load history'); await current().finish()
      const readout = () => fixture.querySelector('.history-readout')?.textContent ?? ''
      assert(readout().includes('-$100.00') && readout().includes('00:05 UTC'), 'Negative slot not selected/rendered')
      assert(!fixture.querySelector('.history-envelope') && !fixture.querySelector('.history-interval'), 'Intraday quote envelope invented')
      await change('Inspect history interval', '0'); assert(readout().includes('00:00 UTC') && readout().includes('$0.00'), 'Genuine zero unavailable')
      await change('Inspect history interval', '2'); assert(readout().includes('00:10 UTC') && readout().includes('Unavailable') && readout().includes('$772.00'), 'Missing option did not preserve separate underlying')
      const svg = fixture.querySelector('[aria-label="Historical underlying price"]')!, rect = svg.getBoundingClientRect()
      assert(rect.width > 0, 'Chart has no rendered width')
      await act(async () => svg.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: rect.left + rect.width * 100 / 720, clientY: rect.top + 50 })))
      assert(readout().includes('00:00 UTC'), 'Underlying pointer did not update shared inspector')
      const guides = [...fixture.querySelectorAll('.history-guide')].map(guide => guide.getAttribute('x1'))
      assert(guides.length === 2 && guides[0] === guides[1], 'Chart guides diverged')
    })
    async function discuss() { await change('History question', 'Explain this interval'); await click('Discuss history'); return current() }
    const replyRendered = () => fixture.textContent?.includes('Verified synthetic intraday discussion.')
    await test('Mouse hover previews shared history without changing AI selection; only explicit inspection commits', async () => {
      await click('Load history'); const loaded = current(); await loaded.finish()
      const pending = await discuss(), before = requests
      const selected = () => fixture.querySelector<HTMLInputElement>('[aria-label="Inspect history interval"]')!.value
      const readout = () => fixture.querySelector('.history-readout')!.textContent ?? ''
      const rows = (loaded.body.range.end - loaded.body.range.start) / 300000
      async function pointer(type: string, slot: number, pointerType = 'mouse', button = 0) {
        const svg = fixture.querySelector('[aria-label="Historical underlying price"]')!, rect = svg.getBoundingClientRect()
        assert(rect.width > 0, 'Hover chart has no width')
        await act(async () => svg.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerType, button, clientX: rect.left + rect.width * (100 + slot / (rows - 1) * 600) / 720, clientY: rect.top + 50 })))
      }
      assert(selected() === '1' && readout().includes('-$100.00'), 'Initial selected bucket incorrect')
      await pointer('pointermove', 0, 'touch')
      assert(!readout().includes('Preview') && selected() === '1' && readout().includes('-$100.00'), 'Touch movement previewed or selected a bucket')
      for (const slot of [0, 2]) {
        await pointer('pointermove', slot)
        assert(readout().includes('Preview') && readout().includes(slot === 0 ? '00:00 UTC' : '00:10 UTC'), 'Mouse movement did not label the preview bucket')
        assert(readout().includes(slot === 0 ? '$0.00' : 'Unavailable'), 'Preview lost genuine zero or missing value')
        const guides = [...fixture.querySelectorAll('.history-guide')].map(guide => Number(guide.getAttribute('x1')))
        assert(guides.length === 2 && guides[0] === guides[1] && Math.abs(guides[0] - (100 + slot / (rows - 1) * 600)) < 1e-8, 'Preview guides did not share the hovered bucket')
        assert(selected() === '1' && requests === before && !pending.signal?.aborted && pending.body.selectedTime === loaded.body.range.start + 300000, 'Preview changed selected AI facts, refetched or aborted discussion')
      }
      await pointer('pointerdown', 0, 'mouse', 2)
      assert(selected() === '1' && !pending.signal?.aborted, 'Right click committed preview')
      await pointer('pointerout', 2)
      assert(!readout().includes('Preview') && readout().includes('Selected') && readout().includes('00:05 UTC') && readout().includes('-$100.00'), 'Pointer leave failed to restore selected readout')
      await pointer('pointermove', 0); await pointer('pointerdown', 0)
      assert(selected() === '0' && pending.signal?.aborted && !readout().includes('Preview'), 'Left click did not commit and invalidate pending discussion')
      await pending.finish(); assert(!replyRendered(), 'Old selection discussion survived commit')
      await pointer('pointermove', 2); await change('Inspect history interval', '1')
      assert(selected() === '1' && !readout().includes('Preview') && readout().includes('00:05 UTC') && readout().includes('-$100.00'), 'Native range change failed to clear hover preview')
      assert(requests === before, 'Preview or commit issued an unexpected fetch')
    })
    await test('Strategy-price display scales only the inventory chart and retains selection, totals and discussion without refetching', async () => {
      await click('Load history'); await current().finish()
      const chart = () => fixture.querySelector('[aria-label="Historical strategy value"]')!
      const underlying = () => fixture.querySelector('[aria-label="Historical underlying price"]')!.innerHTML
      const readout = () => fixture.querySelector('.history-readout')!.textContent
      const selected = () => fixture.querySelector<HTMLInputElement>('[aria-label="Inspect history interval"]')!.value
      const point = () => chart().querySelectorAll('.history-point title')[1]?.textContent
      const initial = { underlying: underlying(), readout: readout(), selected: selected() }
      assert(point()?.includes('-$100.00'), 'Initial chart does not use total inventory units')
      const pending = await discuss(), before = requests
      await click('Strategy price')
      assert(requests === before && !pending.signal?.aborted, 'Display toggle refetched or cancelled discussion')
      assert(point()?.includes('-$1.00') && !point()?.includes('-$100.00'), 'Inventory chart was not divided by the 100-share package scale')
      assert(fixture.querySelector('.history-chart-heading h3')?.textContent === 'Strategy price', 'Scaled chart is not labeled')
      assert(underlying() === initial.underlying && readout() === initial.readout && selected() === initial.selected, 'Display toggle changed underlying, raw totals or inspected bucket')
      await pending.finish(); assert(replyRendered(), 'Pending discussion was lost when display changed')
      await change('History question', 'Keep this unsent follow-up')
      await click('Total inventory')
      assert(requests === before && point()?.includes('-$100.00'), 'Returning to total inventory refetched or failed to restore units')
      assert(replyRendered() && fixture.querySelector<HTMLInputElement>('[aria-label="History question"]')?.value === 'Keep this unsent follow-up', 'Display toggle discarded conversation or draft question')
      assert(underlying() === initial.underlying && readout() === initial.readout && selected() === initial.selected, 'Returning to total inventory changed inspected data')
    })
    await test('Intraday discussion sends selected identity without browser history and renders only matching server facts', async () => {
      await click('Load history'); const loaded = current(); await loaded.finish()
      const pending = await discuss()
      assert(Object.keys(pending.body).sort().join() === 'conversation,range,request_id,selectedTime,state', 'Browser sent history or omitted discussion identity')
      assert(JSON.stringify(pending.body.range) === JSON.stringify(loaded.body.range) && pending.body.selectedTime === loaded.body.range.start + 300000, 'Discussion lost numeric range or selected interval')
      assert(typeof pending.body.request_id === 'string' && pending.body.request_id.length > 0, 'Discussion request ID missing')
      await pending.finish(); assert(replyRendered(), 'Valid matching reply not rendered')
      await click('Start new discussion')
      for (const corrupt of [
        (body: any) => { body.history.rows[0].underlying = 999 },
        (body: any) => { body.selectedTime += 300000 },
        (body: any) => { body.request_id = 'wrong-request' },
      ]) {
        const rejected = await discuss(); await rejected.finish(corrupt)
        assert(!replyRendered() && fixture.textContent?.includes('Reply discarded'), 'Changed facts or identity accepted')
        assert((fixture.querySelector('[aria-label="History question"]') as HTMLInputElement).value === 'Explain this interval', 'Rejected reply lost question')
      }
    })
    await test('Interval, mode, day and close abort discussion and ignore late replies', async () => {
      for (const boundary of ['interval', 'mode', 'day', 'close']) {
        await click('Load history'); await current().finish(); const pending = await discuss()
        if (boundary === 'interval') await change('Inspect history interval', '0')
        if (boundary === 'mode') await change('History resolution', 'daily')
        if (boundary === 'day') await change('Intraday date UTC', new Date(Date.parse(today) - 86400000).toISOString().slice(0, 10))
        if (boundary === 'close') await click('Close history')
        assert(pending.signal?.aborted, `${boundary} did not abort discussion`)
        await pending.finish(); assert(!replyRendered(), `${boundary} accepted late discussion`)
        if (boundary === 'mode') await change('History resolution', 'intraday')
      }
      assert(!fixture.querySelector('dialog'), 'Late discussion revived closed dialog')
    })
    await test('Daily quick ranges load once, anchor the latest completed date and discard stale manual-date responses', async () => {
      await change('History resolution', 'daily')
      const input = (label: string) => fixture.querySelector<HTMLInputElement>(`[aria-label="${label}"]`)!
      const lastDate = input('History end date').value
      const offset = (days: number) => new Date(Date.parse(lastDate) - days * 86400000).toISOString().slice(0, 10)
      const month = [...fixture.querySelectorAll('button')].find(item => item.textContent === '31 days')
      assert(month && month.getAttribute('aria-pressed') !== 'true', '31 days missing or incorrectly active before choosing it')
      for (const days of [14, 7]) {
        if (days === 7) await change('History end date', offset(1))
        const before = requests; await click(`${days} days`); const pending = daily()
        assert(requests === before + 1, `${days}-day button did not issue exactly one request`)
        assert(pending.body.range.start === offset(days - 1) && pending.body.range.end === lastDate, `${days}-day request did not anchor latest completed date`)
        assert(input('History start date').value === pending.body.range.start && input('History end date').value === lastDate, 'Daily date inputs do not match requested preset')
        await pending.finish(); assert(fixture.querySelector('.history-charts'), 'Validated daily history not rendered')
      }
      const before = requests; await click('31 days'); const pending = daily()
      assert(requests === before + 1 && pending.body.range.start === offset(30) && pending.body.range.end === lastDate, '31-day preset exceeded or missed exact inclusive range')
      await change('History start date', offset(29))
      assert(pending.signal?.aborted, 'Manual daily date edit did not abort preset request')
      await pending.finish(); assert(!fixture.querySelector('.history-charts'), 'Late preset response survived manual date change')
    })
  } finally {
    await unmount(); window.fetch = originalFetch; Date.now = originalNow
    if (priorAct === undefined) delete environment.IS_REACT_ACT_ENVIRONMENT; else environment.IS_REACT_ACT_ENVIRONMENT = priorAct
    output.textContent += `TOTAL ${passed} passed, ${failed} failed. Globals restored; no provider calls.\n`; button.disabled = false
  }
}
