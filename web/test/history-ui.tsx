import { act, StrictMode, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { PriceHistory } from '../src/PriceHistory'
import { HistoryCharts } from '../src/HistoryCharts'
import { App, SnapshotAge, StreamedMarks, AssignmentOutcomes } from '../src/App'
import { SavedImport } from '../src/SavedImport'
import { PositionPerformance } from '../src/PositionPerformance'
import { LotManagement } from '../src/LotManagement'
import type { SavedStrategy } from '../src/saved-strategies'
import { buildPositionPerformance } from '../src/position-performance'
import { createPosition } from '../src/position-lifecycle'
import { projectPositionLots, recordLotTransaction, upgradePositionLots } from '../src/position-lots'
import { calculateStrategy, compareSearchCandidate, parseComparisonIntent, renderCandidateComparison, createMarketStrategy, createStrategy, mergeAnalysisProposal, projectAnalysisPosition, searchCandidates, scenarioFacts, type MarketSnapshot } from '../src/options'
import { buildIntradayHistory, buildIvHistory } from '../src/intraday-history'
import { buildPriceHistory } from '../src/price-history'
import '../src/styles.css'

const button = document.querySelector<HTMLButtonElement>('#run')!, output = document.querySelector('#results')!, fixture = document.querySelector<HTMLDivElement>('#fixture')!
if (!import.meta.env.DEV) { button.disabled = true; output.textContent = 'Development only' }
else button.onclick = () => void run()
function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message) }

async function run() {
  button.disabled = true; output.textContent = ''
  const originalFetch = window.fetch, originalNow = Date.now, originalDate = Date
  const environment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }, priorAct = environment.IS_REACT_ACT_ENVIRONMENT
  environment.IS_REACT_ACT_ENVIRONMENT = true
  const today = new Date().toISOString().slice(0, 10), fixedNow = Date.parse(`${today}T14:12:34Z`)
  Date.now = () => fixedNow
  globalThis.Date = new Proxy(originalDate, { construct(target, args) { return Reflect.construct(target, args.length ? args : [fixedNow]) } })
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
    const prototype = field.tagName === 'SELECT' ? HTMLSelectElement.prototype : field.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
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
    await test('Index daily option values retain gaps and reject stock-shaped index references', async () => {
      await unmount();
      const index = structuredClone(state);
      index.underlying = 'XSP'; index.underlyingKind = 'cash-index'; index.valuationModel = 'european-bsm-v1';
      index.legs.forEach(leg => { leg.contractId = leg.contractId!.replace('SPY', 'XSP'); });
      root = createRoot(fixture); await act(async () => root!.render(<Host position={index} />)); await settleTimers();
      const complete = (body: any) => {
        body.history = buildPriceHistory(index, index.legs.map((leg, i) => ({ response: [{ contract: { symbol: 'XSP', strike: leg.strike, right: leg.type.toUpperCase(), expiration: leg.expiry.slice(0, 10) }, data: [{ created: `${body.range.end}T16:00:00`, last_trade: `${body.range.end}T15:59:00`, bid: i ? 1 : 3, ask: i ? 2 : 4 }] }] })), { response: [] }, body.range);
      };
      await daily().finish(complete);
      assert(fixture.textContent?.includes('Index reference unavailable') && fixture.textContent.includes('not an official settlement value'), 'Index reference limitation missing');
      assert(fixture.textContent?.includes('1 complete strategy dates / 7') && fixture.querySelector('.history-readout')?.textContent?.includes('$200.00'), 'Valid index option composite missing');
      assert(!fixture.textContent?.includes('per share') && !fixture.textContent?.includes('100-share'), 'Index premiums labeled as shares');
      const modes = fixture.querySelector('[aria-label="History resolution"]')!;
      assert([...modes.querySelectorAll('option')].filter(option => option.value !== 'daily').every(option => option.disabled), 'Unsupported index intraday mode selectable');
      assert(fixture.querySelector('[aria-label="Historical index reference"]')?.querySelectorAll('.history-point').length === 0, 'Index reference invented');
      await click('Strategy price');
      assert(fixture.querySelector('.history-readout')?.textContent?.includes('2.00 points') && fixture.querySelector('.history-readout')?.textContent?.includes('$200.00'), 'Index premium conversion changed total USD or mislabeled points');
      assert(fixture.querySelector('[aria-label="Historical strategy value"] .history-point title')?.textContent?.includes('2.00 points'), 'Normalized index plot not in points');
      const before = requests; await change('History resolution', 'intraday');
      assert(requests === before && (modes as unknown as { value: string }).value === 'daily', 'Programmatic unsupported index mode admitted');
      await click('Load history');
      await daily().finish(body => { complete(body); body.history.rows.at(-1).underlying = { bid: 770, ask: 771, mid: 770.5, created: `${body.range.end}T16:00:00`, lastTrade: `${body.range.end}T15:59:00` }; });
      assert(fixture.querySelector('[role="alert"]') && !fixture.querySelector('.history-charts'), 'Stock-shaped index history rendered');
    });
    await test('Performance discussion refreshes accounting and rejects altered or stale responses', async () => {
      await unmount(); const priorFetch = window.fetch;
      const stamp = '2026-09-01T12:00:00.000Z', expiry = '2026-10-09T20:00:00.000Z', range = { start: '2026-09-01', end: '2026-09-03' };
      const snapshot: MarketSnapshot = { id: 'discuss-performance', source: 'Tastytrade', underlying: 'SPY', spot: 100, spotAsOf: stamp, retrievedAt: stamp, availableExpiries: ['2026-10-09'], contracts: [{ contractId: 'SPY   261009C00100000', type: 'call', strike: 100, expiry, multiplier: 100, bid: 1.9, ask: 2.1, iv: .2, quoteAsOf: stamp }] };
      const held = createMarketStrategy('long-call', snapshot); held.pricing!.entryMode = 'fixed'; held.feeAllowance = 7;
      const record = { id: 'performance-chat', title: 'Discussion fixture', revision: 3, createdAt: stamp, updatedAt: stamp, state: held, snapshot, lifecycle: createPosition(held) }, original = JSON.stringify(held);
      const performance = (mid: number) => buildPositionPerformance(upgradePositionLots(record.lifecycle), [{ response: [{ contract: { symbol: 'SPY', strike: 100, expiration: '2026-10-09', right: 'CALL' }, data: [1, 3].map(day => ({ bid: mid - .1, ask: mid + .1, created: `2026-09-0${day}T17:15:00.000`, last_trade: `2026-09-0${day}T16:00:00.000` })) }] }], { response: [] }, range);
      const envelope = (mid: number) => ({ savedId: record.id, revision: record.revision, range, source: 'Theta EOD', performance: performance(mid) });
      const calls: Array<{ signal?: AbortSignal | null; body: any; finish: (value: any) => void }> = [];
      window.fetch = (async (url, init) => {
        const body = JSON.parse(String(init?.body));
        if (url === '/api/strategies/performance-chat/performance') return Response.json(envelope(2));
        assert(url === '/api/strategies/performance-chat/performance/discuss', 'Unexpected performance discussion request');
        assert(Object.keys(body).sort().join() === 'conversation,range,request_id,revision,selectedDate' && body.revision === 3 && JSON.stringify(body.range) === JSON.stringify(range), 'Discussion sent unbound identity or client-calculated history');
        return new Promise<Response>(resolve => calls.push({ body, signal: init?.signal, finish: value => resolve(Response.json(value)) }));
      }) as typeof fetch;
      const waitFor = async (check: () => boolean) => { for (let i = 0; i < 100 && !check(); i++) await settleTimers(); assert(check(), 'Performance discussion did not settle') };
      const reply = (index: number) => ({ ...envelope(3), request_id: calls[index].body.request_id, selectedDate: calls[index].body.selectedDate, reply: { text: 'Refreshed net P/L is $93.00.', assumptions: [], objections: [], suggested_prompts: [] } });
      const chat = () => fixture.querySelector('[aria-label="Read-only performance discussion"]');
      const ask = async () => { await change('Performance question', 'Explain the selected P/L and gaps.'); await click('Discuss performance') };
      try {
        root = createRoot(fixture); await act(async () => root!.render(<PositionPerformance record={record} />));
        await change('Performance start date', range.start); await change('Performance end date', range.end); await click('Load position performance');
        await waitFor(() => !!fixture.querySelector('[aria-label="Selected performance accounting"]'));
        assert(chat() && calls.length === 0, 'Loaded performance has no explicit read-only discussion');
        await ask(); assert(calls[0].body.selectedDate === range.end, 'Discussion lost selected date');
        await act(async () => calls[0].finish(reply(0))); await waitFor(() => chat()?.textContent?.includes('Refreshed net P/L') === true);
        assert(fixture.querySelector('[aria-label="Selected performance accounting"]')?.textContent?.includes('$93.00') && JSON.stringify(held) === original, 'Fresh discussion did not update validated accounting or mutated holdings');
        for (const attack of ['amount', 'date', 'revision', 'operations']) {
          await click('Start new performance discussion'); await ask(); const index = calls.length - 1, body: any = reply(index);
          if (attack === 'amount') body.performance.rows[2].combinedPnl = 999;
          if (attack === 'date') body.selectedDate = range.start;
          if (attack === 'revision') body.revision = 2;
          if (attack === 'operations') body.reply.operations = [];
          await act(async () => calls[index].finish(body)); await waitFor(() => !!chat()?.querySelector('[role="alert"]'));
          assert(!chat()?.textContent?.includes('Refreshed net P/L'), `Altered ${attack} reply displayed`);
        }
        await ask(); const delayed = calls.length - 1; await change('Inspect history date', '1');
        assert(calls[delayed].signal?.aborted, 'Selected date did not cancel discussion');
        await act(async () => calls[delayed].finish(reply(delayed))); assert(!chat()?.textContent?.includes('Refreshed net P/L'), 'Late selected-date response displayed');
        await ask(); const changedRange = calls.length - 1; await change('Performance end date', range.start);
        assert(calls[changedRange].signal?.aborted && !chat(), 'Range change did not discard discussion');
        await change('Performance end date', range.end); await click('Load position performance'); await waitFor(() => !!chat());
        await ask(); const reloaded = calls.length - 1; await click('Load position performance'); await waitFor(() => !!chat());
        assert(calls[reloaded].signal?.aborted && !chat()?.textContent?.includes('Refreshed net P/L'), 'Explicit reload retained discussion');
        await ask(); const changedRecord = calls.length - 1;
        await act(async () => root!.render(<PositionPerformance record={{ ...record, revision: 4 }} />));
        assert(calls[changedRecord].signal?.aborted && !chat(), 'Record change retained discussion');
        await act(async () => root!.render(<PositionPerformance record={record} />)); await click('Load position performance'); await waitFor(() => !!chat());
        await ask(); const closing = calls.length - 1; await unmount(); assert(calls[closing].signal?.aborted, 'Unmount did not cancel discussion');
      } finally { await unmount(); window.fetch = priorFetch }
    });
    await test('Saved library pages reach older positions and discard pages after a refresh', async () => {
      await unmount(); const priorFetch = window.fetch;
      const stamp = new Date(fixedNow - 120000).toISOString();
      const records = Array.from({ length: 51 }, (_, i) => ({ id: `library-${i}`, title: `Library position ${i}`, revision: 1, createdAt: stamp, updatedAt: stamp, state: createStrategy('long-call'), snapshot: null }));
      let defer = false, release: (() => void) | undefined, deferRefresh = false, refreshRelease: (() => void) | undefined, deferLoad = false, loadRelease: (() => void) | undefined;
      const loaded: string[] = [];
      window.fetch = (async (url, init) => {
        if (url === '/api/bootstrap') return Response.json({ session: { label: 'Library fixture', local: true, recoveryKey: 'disabled-in-test' } });
        if (url === '/api/strategies') {
          if (deferRefresh) return new Promise<Response>(resolve => { refreshRelease = () => resolve(Response.json({ strategies: records.slice(0, 50), nextCursor: 'page-two' })); });
          return Response.json({ strategies: records.slice(0, 50), nextCursor: 'page-two' });
        }
        if (url === '/api/strategies?cursor=page-two') {
          if (defer) return new Promise<Response>(resolve => { release = () => resolve(Response.json({ strategies: [records[50]], nextCursor: null })); });
          return Response.json({ strategies: [records[50]], nextCursor: null });
        }
        if (url === '/api/strategies/library-50') { loaded.push(String(url)); if (deferLoad) return new Promise<Response>(resolve => { loadRelease = () => resolve(Response.json({ record: records[50] })); }); return Response.json({ record: records[50] }); }
        throw new Error(`Unexpected library request: ${String(url)} ${init?.method ?? 'GET'}`);
      }) as typeof fetch;
      const waitFor = async (check: () => boolean) => { for (let i = 0; i < 200 && !check(); i++) await settleTimers(); assert(check(), 'Library state did not settle'); };
      try {
        root = createRoot(fixture); await act(async () => root!.render(<App />));
        await waitFor(() => fixture.querySelectorAll('[aria-label="Saved positions"] option').length === 51);
        assert([...fixture.querySelectorAll('button')].some(node => node.textContent === 'Load more saved positions'), 'Saved library has no next-page control');
        await change('Saved positions', records[0].id); await click('Load more saved positions');
        await waitFor(() => fixture.querySelectorAll('[aria-label="Saved positions"] option').length === 52);
        assert((fixture.querySelector('[aria-label="Saved positions"]') as unknown as { value: string }).value === records[0].id, 'Loading a page changed selection');
        await change('Saved positions', records[50].id); await click('Load');
        await waitFor(() => loaded.length === 1);
        assert((fixture.querySelector('[aria-label="Saved strategy title"]') as HTMLInputElement).value === records[50].title, 'Older saved record did not reopen');
        deferRefresh = true; deferLoad = true;
        await click('Refresh saved positions'); await waitFor(() => !!refreshRelease);
        await click('Load'); await waitFor(() => !!loadRelease);
        await act(async () => refreshRelease!()); refreshRelease = undefined;
        await waitFor(() => fixture.querySelectorAll('[aria-label="Saved positions"] option').length === 51);
        await act(async () => loadRelease!()); loadRelease = undefined;
        await waitFor(() => fixture.querySelectorAll('[aria-label="Saved positions"] option').length === 52);
        assert((fixture.querySelector('[aria-label="Saved positions"]') as unknown as { value: string }).value === records[50].id, 'Late load stranded its selected older summary');
        deferRefresh = false; deferLoad = false;
        await click('Refresh saved positions');
        await waitFor(() => fixture.querySelectorAll('[aria-label="Saved positions"] option').length === 51);
        assert((fixture.querySelector('[aria-label="Saved positions"]') as unknown as { value: string }).value === '', 'Refresh left a stranded older selection');
        defer = true; await click('Load more saved positions'); await waitFor(() => !!release);
        await click('Refresh saved positions'); await act(async () => release!()); release = undefined;
        await settleTimers();
        assert(fixture.querySelectorAll('[aria-label="Saved positions"] option').length === 51, 'Stale next page survived refresh');
      } finally { release?.(); refreshRelease?.(); loadRelease?.(); await unmount(); window.fetch = priorFetch }
    });
    await test('Tracking overview filters loaded positions without replacing builder edits', async () => {
      await unmount(); const priorFetch = window.fetch;
      const stamp = new Date(fixedNow).toISOString();
      const tracking = { underlying: 'SPY', status: 'open', remainingLots: 2, optionContracts: 3, signedShares: -100, grossRealizedPnl: 125, allowance: 5, netClosedPnl: null, asOf: stamp };
      let calls = 0, malformed = false;
      window.fetch = (async url => {
        if (url === '/api/bootstrap') return Response.json({ session: { label: 'Overview fixture', local: true, recoveryKey: 'disabled-in-test' } });
        if (url === '/api/strategies') return Response.json({ strategies: [
          { id: 'tracked', title: 'Recorded spread', revision: ++calls, updatedAt: stamp, tracking: calls === 1 ? tracking : { ...tracking, status: 'closed', remainingLots: 0, optionContracts: 0, signedShares: 0, netClosedPnl: malformed ? 999 : 120 } },
          { id: 'analysis', title: 'QQQ idea', revision: 1, updatedAt: stamp, tracking: { ...tracking, underlying: 'QQQ', status: 'not-tracked', remainingLots: null, optionContracts: null, signedShares: null, grossRealizedPnl: null, allowance: null, netClosedPnl: null, asOf: null } },
          { id: 'legacy', title: 'Unavailable record', revision: 1, updatedAt: stamp },
        ] });
        if (url === '/api/strategies/tracked/lots') return Response.json({ error: { message: 'Fixture inspection unavailable' } }, { status: 422 });
        throw new Error(`Unexpected overview request: ${String(url)}`);
      }) as typeof fetch;
      const waitFor = async (check: () => boolean) => { for (let i = 0; i < 400 && !check(); i++) await settleTimers(); assert(check(), `Overview did not reach expected state: ${fixture.querySelector('.workspace-error')?.textContent ?? ''}; calls=${calls}; malformed=${malformed}`) };
      try {
        root = createRoot(fixture); await act(async () => root!.render(<App />));
        await waitFor(() => fixture.querySelectorAll('[aria-label="Saved position tracking"] tbody tr').length === 3);
        const overview = () => fixture.querySelector('[aria-label="Saved position tracking"]')!;
        assert(overview().textContent?.includes('Not valued') && overview().textContent?.includes('Not tracked') && !overview().textContent?.includes('NaN'), 'Unavailable accounting displayed as a mark');
        await change('Filter loaded positions', 'spy'); assert(overview().querySelectorAll('tbody tr').length === 1, 'Underlying filter failed');
        const before = fixture.querySelector<HTMLInputElement>('[aria-label="Contracts"]')!.value;
        const inspect = fixture.querySelector<HTMLButtonElement>('[aria-label="Inspect Recorded spread"]')!;
        assert(inspect && !inspect.disabled, 'Tracking inspection is unavailable');
        await act(async () => inspect.click()); await waitFor(() => fixture.textContent?.includes('Fixture inspection unavailable') === true);
        assert(fixture.querySelector<HTMLInputElement>('[aria-label="Contracts"]')!.value === before, 'Inspection replaced builder holdings');
        await change('Filter loaded positions', 'missing'); assert(overview().textContent?.includes('No matching loaded positions'), 'Empty filter hid its scope');
        await change('Filter loaded positions', ''); await change('Tracking status', 'closed'); assert(overview().querySelectorAll('tbody tr').length === 0, 'Status filter failed');
        await click('Refresh saved positions'); await waitFor(() => overview().querySelectorAll('tbody tr').length === 1);
        assert(overview().textContent?.includes('Closed') && overview().textContent?.includes('$120'), 'Refreshed closed accounting did not replace old revision');
        malformed = true; await click('Refresh saved positions'); await waitFor(() => fixture.querySelector('.workspace-notice.workspace-error')?.textContent?.includes('Saved tracking response is invalid') === true);
        assert(overview().textContent?.includes('$120') && !overview().textContent?.includes('$999') && overview().textContent?.includes('r2'), 'Malformed tracking replaced validated prior accounting');
      } finally { await unmount(); window.fetch = priorFetch }
    });
    await test('Saved revision automatically compares original holdings with unsaved edits', async () => {
      await unmount(); const priorFetch = window.fetch, priorConfirm = window.confirm;
      const state = createStrategy('long-call'), stamp = new Date(fixedNow).toISOString();
      const seed = { id: 'revision-baseline', title: 'Saved original', revision: 1, updatedAt: stamp, state, snapshot: null };
      let stored = structuredClone(seed), mode: 'normal' | 'conflict' | 'late' | 'invalid' | 'altered' = 'normal', release: (() => void) | undefined, deleted = false;
      window.confirm = () => true;
      window.fetch = (async (url, init) => {
        if (url === '/api/bootstrap') return Response.json({ session: { label: 'Saved comparison fixture', local: true, recoveryKey: 'disabled-in-test' } });
        if (url === '/api/strategies') return Response.json({ strategies: deleted ? [] : [stored] });
        if (url === '/api/strategies/revision-baseline' && init?.method === 'PUT') {
          const body = JSON.parse(String(init.body));
          if (mode === 'conflict') return Response.json({ error: { message: 'Revision conflict' } }, { status: 409 });
          const next = { ...stored, revision: stored.revision + 1, title: body.title, state: Object.fromEntries(Object.entries(body.state).reverse()) as unknown as typeof state };
          if (mode === 'invalid') return Response.json({ record: { ...next, id: 'unexpected-record' } });
          if (mode === 'altered') return Response.json({ record: { ...next, state: { ...next.state, legs: next.state.legs.map(leg => ({ ...leg, entryPrice: leg.entryPrice + 1 })) } } });
          if (mode === 'late') return new Promise<Response>(resolve => { release = () => { stored = next; resolve(Response.json({ record: next })); }; });
          stored = next; return Response.json({ record: stored });
        }
        if (url === '/api/strategies/revision-baseline' && init?.method === 'DELETE') { deleted = true; return new Response(null, { status: 204 }); }
        if (url === '/api/strategies/revision-baseline') return Response.json({ record: stored });
        throw new Error(`Unexpected saved comparison request: ${String(url)}`);
      }) as typeof fetch;
      const waitFor = async (check: () => boolean, stage: string) => { for (let i = 0; i < 400 && !check(); i++) await settleTimers(); assert(check(), `Saved comparison ${stage}: ${fixture.querySelector('.workspace-error')?.textContent ?? ''}`) };
      try {
        root = createRoot(fixture); await act(async () => root!.render(<App />));
        await waitFor(() => !!fixture.querySelector('option[value="revision-baseline"]'), 'list');
        await change('Saved positions', seed.id); await click('Load');
        await waitFor(() => fixture.querySelector('.leg-list [aria-label="Contracts"]')?.getAttribute('value') === '1', 'load');
        await change('Saved strategy title', 'Title-only edit'); assert(!fixture.querySelector('.comparison-banner'), 'Title-only change created a holdings comparison'); await change('Saved strategy title', seed.title);
        await change('Contracts', '2');
        assert(fixture.querySelector('.comparison-banner')?.textContent?.includes('Saved revision 1'), 'Editing a loaded saved position did not expose its original revision without manual Freeze');
        assert(!fixture.querySelector('[aria-label="Original saved curve"] svg'), 'Original curve was calculated before explicit inspection');
        await waitFor(() => !!fixture.querySelector('#workspace-chart path.proposal-line')?.getAttribute('d'), 'original versus edited overlay');
        assert(state.legs[0].contracts === 1 && fixture.querySelector<HTMLInputElement>('.leg-list [aria-label="Contracts"]')?.value === '2', 'Saved comparison changed original or edited quantities');
        await change('Entry premium', '7'); assert(state.legs[0].entryPrice !== 7, 'Editing mutated saved entry cost');
        await click('Save'); await waitFor(() => stored.revision === 2 && !fixture.querySelector('.comparison-banner'), 'save establishes reordered revision baseline');
        await change('Contracts', '3'); assert(fixture.querySelector('.comparison-banner')?.textContent?.includes('Saved revision 2'), 'Accepted save did not advance original revision');
        await act(async () => fixture.querySelector<HTMLButtonElement>('[aria-label="Undo"]')!.click()); assert(!fixture.querySelector('.comparison-banner'), 'Undo to saved inputs left a false comparison');
        await act(async () => fixture.querySelector<HTMLButtonElement>('[aria-label="Undo"]')!.click()); assert(fixture.querySelector('.comparison-banner')?.textContent?.includes('Saved revision 2') && stored.state.legs[0].entryPrice === 7, 'Undo rewound saved revision or entry costs');
        await click('Freeze comparison'); assert(fixture.querySelector('.comparison-banner')?.textContent?.includes('Frozen baseline'), 'Manual baseline did not take precedence');
        await change('Contracts', '4'); await click('Use saved baseline'); assert(fixture.querySelector('.comparison-banner')?.textContent?.includes('Saved revision 2'), 'Clearing manual baseline did not restore saved original');
        const checkbox = fixture.querySelector<HTMLInputElement>('.leg-list input[type="checkbox"]')!;
        await act(async () => checkbox.click()); assert(stored.state.excludedLegIds === undefined && fixture.querySelector('[aria-label="Empty analysis selection"]'), 'Exclusion changed saved analysis selection');
        await act(async () => checkbox.click());
        const changedDate = new Date(Date.parse(state.scenarioDate) + 86400000).toISOString().slice(0, -1);
        await change('Scenario date UTC', changedDate);
        assert(fixture.querySelector('.comparison-banner')?.textContent?.includes('Curve overlay hidden') && !fixture.querySelector('#workspace-chart path.proposal-line'), 'Incompatible saved date overlay was admitted');
        const currentDate = fixture.querySelector<HTMLInputElement>('[aria-label="Scenario date UTC"]')!.value;
        await act(async () => fixture.querySelector<HTMLDetailsElement>('[aria-label="Original saved curve"]')!.querySelector('summary')!.click());
        await waitFor(() => !!fixture.querySelector('[aria-label="Original saved curve"] svg'), 'read-only original inspection');
        assert(fixture.querySelector<HTMLInputElement>('[aria-label="Scenario date UTC"]')!.value === currentDate && fixture.querySelector('.comparison-banner')?.textContent?.includes(stored.state.scenarioDate), 'Original inspection changed controls or lost saved date');
        mode = 'conflict'; await click('Save'); await waitFor(() => !!fixture.querySelector('.workspace-error'), 'conflict'); assert(fixture.querySelector('.comparison-banner')?.textContent?.includes('Saved revision 2'), 'Conflict replaced original revision');
        mode = 'invalid'; await click('Save'); await waitFor(() => fixture.querySelector('.workspace-error')?.textContent?.includes('response failed validation') === true, 'invalid response'); assert(fixture.querySelector('.comparison-banner')?.textContent?.includes('Saved revision 2'), 'Malformed save response replaced original revision');
        mode = 'altered'; await click('Save'); await waitFor(() => fixture.querySelector('.workspace-error')?.textContent?.includes('differs from submitted holdings') === true, 'altered valid response'); assert(fixture.querySelector('.comparison-banner')?.textContent?.includes('Saved revision 2'), 'Valid-but-different save response replaced original revision');
        mode = 'late'; await click('Save'); await waitFor(() => !!release, 'pending save'); await change('Contracts', '5'); await act(async () => release!()); release = undefined;
        await waitFor(() => fixture.querySelector('.workspace-notice')?.textContent?.includes('newer workspace edits') === true, 'late save ignored'); assert(fixture.querySelector('.comparison-banner')?.textContent?.includes('Saved revision 2'), 'Late save replaced comparison anchor');
        await click('New'); assert(!fixture.querySelector('.comparison-banner'), 'New workspace retained saved original');
        await change('Saved positions', seed.id); await click('Load'); await waitFor(() => fixture.querySelector<HTMLInputElement>('[aria-label="Contracts"]')?.value === '4', 'reload latest saved revision');
        await change('Contracts', '6'); assert(fixture.querySelector('.comparison-banner')?.textContent?.includes('Saved revision 3'), 'Reload did not select actual latest saved revision');
        await click('Delete'); await waitFor(() => deleted && !fixture.querySelector('.comparison-banner'), 'deleted active identity clears baseline'); assert(fixture.querySelector<HTMLInputElement>('[aria-label="Contracts"]')?.value === '6', 'Deleting original changed open holdings');
      } finally { release?.(); await unmount(); window.fetch = priorFetch; window.confirm = priorConfirm }
    });
    for (const symbol of ['SPY', 'XSP']) await test(`${symbol} calendar discovery preserves bound scope through comparison, save, reopen and Undo`, async () => {
      await unmount(); const priorFetch = window.fetch, priorSocket = window.WebSocket;
      const priorDate = Date, priorNow = Date.now;
      globalThis.Date = originalDate; Date.now = originalNow;
      const stamp = new Date(Date.now() - 120000).toISOString(), dates = ['2027-10-09T20:00:00.000Z', '2027-10-16T20:00:00.000Z'];
      const type = symbol === 'XSP' ? 'put' : 'call', model = symbol === 'XSP' ? 'european-bsm-v1' : 'american-crr-1024-v1';
      const snapshot: MarketSnapshot = { id: 'mixed-discovery', source: 'Tastytrade', underlying: symbol, ...(symbol === 'XSP' ? { underlyingKind: 'cash-index' as const, indexSourceTime: stamp, contractTerms: { exerciseStyle: 'European' as const, settlement: 'cash' as const, multiplier: 100 as const, settlementSession: 'PM' as const } } : {}), spot: 100, spotAsOf: stamp, retrievedAt: stamp, availableExpiries: dates.map(date => date.slice(0, 10)), contracts: dates.flatMap(expiry => [95, 100, 105].map(strike => ({ contractId: `${symbol}   ${expiry.slice(2, 10).replaceAll('-', '')}${type === 'call' ? 'C' : 'P'}${String(strike * 1000).padStart(8, '0')}`, type, strike, expiry, multiplier: 100 as const, bid: 2, ask: 3, iv: .25, quoteAsOf: stamp }))) };
      const held = createMarketStrategy(type === 'put' ? 'long-put' : 'long-call', snapshot); held.valuationModel = model; held.dividendYield = .02; held.pricing!.entryMode = 'fixed'; held.legs[0].entryPrice = 1.23; held.feeAllowance = 5;
      const seed = { id: 'mixed-seed', title: 'Mixed search fixture', revision: 1, createdAt: stamp, updatedAt: stamp, state: held, snapshot };
      let saved: typeof seed | undefined, mode: 'normal' | 'altered' | 'deferred' = 'normal', release: (() => void) | undefined, calls = 0;
      let chatMode: 'normal' | 'altered' | 'prose' | 'intent' | 'assumptions' | 'objections' | 'suggested_prompts' | 'deferred' = 'normal', chatCalls = 0, releaseChat: (() => void) | undefined, chatSignal: AbortSignal | undefined;
      window.WebSocket = class { close() {} } as unknown as typeof WebSocket;
      window.fetch = (async (url, init) => {
        if (url === '/api/bootstrap') return Response.json({ session: { label: 'Mixed fixture', local: true, recoveryKey: 'disabled-in-test' } });
        if (url === '/api/strategies' && init?.method === 'POST') { saved = { ...seed, id: 'mixed-copy', state: JSON.parse(String(init.body)).state }; return Response.json({ record: saved }, { status: 201 }); }
        if (url === '/api/strategies') return Response.json({ strategies: saved ? [seed, saved] : [seed] });
        if (url === '/api/strategies/mixed-seed') return Response.json({ record: seed });
        if (url === '/api/strategies/mixed-copy') return Response.json({ record: saved });
        if (url === '/api/sparring') {
          chatCalls++; const body = JSON.parse(String(init?.body));
          assert(body.candidate_selection && !body.chart_context && !body.probability_range && !body.first_expiry_range, 'Candidate discussion mixed analysis contexts');
          assert(body.state.legs.length === 1 && body.state.legs[0].entryPrice === 1.23 && body.state.pricing.entryMode === 'fixed', 'Candidate discussion replaced canonical held entry');
          const positionComparison = compareSearchCandidate(body.state, snapshot, body.candidate_selection);
          const comparisonIntent = parseComparisonIntent({ topics: ['target-pnl', 'cost-basis'], scope: 'supplied-comparison', requestedScenario: null });
          assert(comparisonIntent, 'Synthetic candidate intent invalid');
          const reply = { ...renderCandidateComparison(positionComparison, comparisonIntent), operations: [], evidence_ids: [], risk_classification: 'bounded' };
          if (chatMode === 'altered') positionComparison.metrics.scenarioPnl += 1;
          if (chatMode === 'prose') reply.text = 'FORGED CANDIDATE COMMENTARY';
          if (chatMode === 'assumptions' || chatMode === 'objections' || chatMode === 'suggested_prompts') reply[chatMode] = ['FORGED CANDIDATE COMMENTARY'];
          const result = { request_id: body.request_id, base_state_version: body.base_state_version, next_state: { ...body.state, version: body.state.version + 1 }, metrics: calculateStrategy(projectAnalysisPosition(body.state)!), reply, calculated: { metrics: calculateStrategy(projectAnalysisPosition(body.state)!), scenario: scenarioFacts(projectAnalysisPosition(body.state)!), riskSummary: 'Synthetic comparison', dataMode: 'market-snapshot', positionComparison, comparisonIntent: chatMode === 'intent' ? { ...comparisonIntent, extra: 'untrusted' } : comparisonIntent }, market_context: { sources: [], retrievedAt: stamp } };
          if (chatMode === 'deferred') { chatSignal = init?.signal ?? undefined; return new Promise<Response>(resolve => { releaseChat = () => resolve(Response.json(result)); }); }
          return Response.json(result);
        }
        if (url === '/api/candidates') {
          calls++; const body = JSON.parse(String(init?.body)), result = searchCandidates(body.state, snapshot, body.search, body.domain);
          assert(result.candidates.length > 0, 'No calendar candidates in fixture');
          if (mode === 'altered') result.candidates[0].lossBound!.amount += 1;
          if (mode === 'deferred') return new Promise<Response>(resolve => { release = () => resolve(Response.json({ search: result })); });
          return Response.json({ search: result });
        }
        throw new Error(`Unexpected mixed search request: ${String(url)}`);
      }) as typeof fetch;
      const waitFor = async (check: () => boolean, stage: string) => { for (let i = 0; i < 800 && !check(); i++) await settleTimers(); assert(check(), `Mixed discovery ${stage}: ${[...fixture.querySelectorAll('[role="alert"], .workspace-error')].map(node => node.textContent).join(' | ')}`) };
      const inputs = () => [...fixture.querySelectorAll<HTMLInputElement>('.leg-list input, .leg-list select')].map(field => field.value).join();
      const configure = async () => {
        await change('Optimizer target date UTC', dates[0].slice(0, 19)); await change('Optimizer target price', '100');
        await act(async () => fixture.querySelector<HTMLInputElement>('[aria-label="Optimizer options only"]')!.click());
        await act(async () => fixture.querySelector<HTMLInputElement>(`[aria-label="Optimizer ${type} calendar"]`)!.click());
      };
      try {
        root = createRoot(fixture); await act(async () => root!.render(<App />));
        await waitFor(() => !!fixture.querySelector('option[value="mixed-seed"]'), 'seed');
        await change('Saved positions', seed.id); await click('Load');
        await waitFor(() => !!fixture.querySelector(`[aria-label="Optimizer ${type} calendar"]`) && !fixture.querySelector<HTMLInputElement>(`[aria-label="Optimizer ${type} calendar"]`)!.disabled, 'selected model');
        if (symbol === 'XSP') assert(fixture.querySelector<HTMLInputElement>('[aria-label="Optimizer call calendar"]')?.disabled && fixture.querySelector<HTMLInputElement>('[aria-label="Optimizer call diagonal"]')?.disabled && !fixture.querySelector<HTMLInputElement>('[aria-label="Optimizer put diagonal"]')?.disabled, 'European positive-yield call families were admitted or put families disabled');
        const before = inputs(); await configure(); await click('Find strategies');
        await waitFor(() => !!fixture.querySelector('[aria-label="Deterministic quoted candidates"]'), 'ranking');
        assert(fixture.querySelector('[aria-label="Deterministic quoted candidates"]')!.textContent!.toLowerCase().includes('conservative'), 'Calendar bound not labeled');
        await click('Inspect strategy'); await waitFor(() => !!fixture.querySelector('.proposal-card'), 'inspection');
        await waitFor(() => !!fixture.querySelector('[aria-label="Optimizer target comparison"] path.proposal-line')?.getAttribute('d'), 'target comparison');
        assert(inputs() === before, 'Calendar inspection changed held entries');
        const comparisonScenarios = fixture.querySelector('.comparison-scenarios')?.textContent ?? '';
        assert(symbol === 'XSP' ? (comparisonScenarios.match(/index points/g)?.length ?? 0) === 2 && !comparisonScenarios.includes('$') : (comparisonScenarios.match(/\$/g)?.length ?? 0) === 2 && !comparisonScenarios.includes('index points'), 'Held/proposed scenario summary units do not match underlying kind');
        const boundScope = fixture.querySelector('[aria-label="Candidate conservative first-expiry bound"]')?.textContent ?? '';
        assert(boundScope.includes('Conservative first-expiry loss bound') && boundScope.includes('does not establish pre-expiry or lifetime loss caps'), 'Inspection omitted bound scope');
        await click('Discuss candidate'); await waitFor(() => fixture.querySelectorAll('[aria-label="Read-only holdings comparison"]').length === 1, 'candidate discussion');
        const calculations = fixture.querySelector('[aria-label="Captured analysis calculations"]');
        assert(calculations, 'Candidate reply omitted calculation units fixture');
        const calculationUnits = calculations.textContent ?? '', targetDescription = fixture.querySelector('[aria-label="Optimizer target comparison"] > p')?.textContent ?? '';
        assert(symbol === 'XSP' ? calculationUnits.includes('index points') && calculationUnits.includes('premium points') && !calculationUnits.includes('/ share') && !calculationUnits.includes('spot $') && targetDescription.includes('index points') && !targetDescription.includes('at $') : calculationUnits.includes('/ share') && calculationUnits.includes('spot $') && targetDescription.includes('at $'), 'Candidate calculation or target units do not match underlying kind');
        await change('Ask ARGUS', 'What is the main downside of this candidate?'); await act(async () => fixture.querySelector<HTMLButtonElement>('[aria-label="Send message"]')!.click());
        await waitFor(() => fixture.querySelectorAll('[aria-label="Read-only holdings comparison"]').length === 2, 'candidate follow-up');
        assert(inputs() === before && !!fixture.querySelector('.proposal-card') && fixture.querySelectorAll('[aria-label="Read-only holdings comparison"]').length === 2, 'Candidate discussion discarded inspection or changed holdings');
        for (const attack of ['altered', 'prose', 'intent', 'assumptions', 'objections', 'suggested_prompts'] as const) {
          chatMode = attack; const failures = fixture.textContent?.match(/REVIEW FAILED/g)?.length ?? 0;
          await click('Discuss candidate'); await waitFor(() => (fixture.textContent?.match(/REVIEW FAILED/g)?.length ?? 0) === failures + 1, `candidate ${attack} tamper`);
          assert(!fixture.textContent?.includes('FORGED CANDIDATE COMMENTARY') && fixture.querySelectorAll('[aria-label="Read-only holdings comparison"]').length === 2 && inputs() === before && !!fixture.querySelector('.proposal-card'), 'Unvalidated comparison prose reached UI or discarded selection');
        }
        chatMode = 'deferred'; await click('Discuss candidate'); await waitFor(() => !!releaseChat, 'candidate pending');
        await click('Keep current'); assert(chatSignal?.aborted && !fixture.querySelector('.proposal-card') && inputs() === before, 'Dismiss did not cancel candidate request');
        await act(async () => releaseChat!()); releaseChat = undefined; await settleTimers();
        assert(fixture.querySelectorAll('[aria-label="Read-only holdings comparison"]').length === 2 && !fixture.querySelector('.proposal-card') && inputs() === before && chatCalls === 9, 'Dismissed late candidate discussion survived');
        await click('Inspect strategy'); await waitFor(() => !!fixture.querySelector('.proposal-card'), 'reinspection');
        await click('Apply proposal'); await click('Save as new'); await waitFor(() => !!saved, 'save');
        assert(saved!.state.legs.length === 2 && new Set(saved!.state.legs.map(leg => leg.expiry)).size === 2 && saved!.state.valuationModel === model && saved!.state.underlyingKind === held.underlyingKind && saved!.state.dividendYield === held.dividendYield && saved!.state.legs.every(leg => leg.type === type), 'Calendar transfer lost expiries, explicit model or underlying identity');
        await act(async () => fixture.querySelector<HTMLButtonElement>('[aria-label="Undo"]')!.click()); assert(inputs() === before, 'Calendar Undo lost held inputs');
        const savedComparison = fixture.querySelector('.comparison-banner');
        assert(savedComparison && savedComparison.textContent?.includes('Saved revision 1'), 'Undo after candidate save lost saved original baseline');
        if (symbol === 'XSP') {
          const originals = savedComparison.querySelector('details')?.textContent ?? '';
          assert(originals.includes('index points') && originals.includes('premium points') && !originals.includes('$100'), 'Saved index original inputs have incorrect spot or premium units');
        }
        assert(!fixture.querySelector('[aria-label="Original saved curve"] svg'), 'Saved candidate original curve ran before inspection');
        await act(async () => fixture.querySelector('[aria-label="Original saved curve"] summary')!.dispatchEvent(new MouseEvent('click', { bubbles: true })));
        await waitFor(() => !!fixture.querySelector('[aria-label="Original saved curve"] svg'), 'saved candidate original curve');
        const originalAxis = [...fixture.querySelectorAll('[aria-label="Original saved curve"] svg .grid.vertical')].map(line => line.parentElement!.querySelector('text')!.textContent ?? '');
        assert(originalAxis.length === 5 && originalAxis.every(label => symbol === 'XSP' ? label.endsWith('pts') && !label.includes('$') : label.startsWith('$') && !label.includes('pts')), 'Original saved curve spot-axis units incorrect');
        await change('Saved positions', 'mixed-copy'); await click('Load'); await waitFor(() => fixture.querySelectorAll('.leg-row').length === 2, 'reopen');
        await act(async () => fixture.querySelector<HTMLButtonElement>('[aria-label="Undo"]')!.click()); assert(inputs() === before, 'Reopened calendar Undo changed holding');
        await configure(); mode = 'altered'; await click('Find strategies'); await waitFor(() => !!fixture.querySelector('[aria-label="Strategy optimizer"] [role="alert"]'), 'tamper');
        assert(!fixture.querySelector('[aria-label="Deterministic quoted candidates"]') && inputs() === before, 'Altered bound reached builder');
        mode = 'deferred'; await click('Find strategies'); await waitFor(() => !!release, 'pending');
        await change('Optimizer maximum entry outlay', '9999'); await act(async () => release!()); release = undefined;
        await settleTimers(); assert(!fixture.querySelector('[aria-label="Deterministic quoted candidates"]') && calls === 3, 'Cancelled calendar search survived');
      } finally { release?.(); releaseChat?.(); await unmount(); window.fetch = priorFetch; window.WebSocket = priorSocket; globalThis.Date = priorDate; Date.now = priorNow }
    });
    await test('Three-expiry tail reaches the rendered workspace through the valuation worker', async () => {
      await unmount(); const priorFetch = window.fetch, priorSocket = window.WebSocket;
      const stamp = new Date(fixedNow - 120000).toISOString(), dates = ['2027-09-10T20:00:00.000Z', '2027-10-08T20:00:00.000Z', '2027-11-12T20:00:00.000Z'];
      const snapshot: MarketSnapshot = { id: 'three-expiry-tail', source: 'Tastytrade', underlying: 'SPY', spot: 100, spotAsOf: stamp, retrievedAt: stamp, availableExpiries: dates.map(date => date.slice(0, 10)), contracts: dates.map((expiry, index) => ({ contractId: `SPY   ${expiry.slice(2, 10).replaceAll('-', '')}${index ? 'C' : 'P'}00100000`, type: index ? 'call' : 'put', strike: 100, expiry, multiplier: 100, bid: 2, ask: 3, iv: .2, quoteAsOf: stamp })) };
      const held = createMarketStrategy('long-put', snapshot);
      held.dividendYield = .02; held.valuationModel = 'european-bsm-v1';
      held.legs = snapshot.contracts.map((contract, index) => ({ id: `tail-${index}`, contractId: contract.contractId, type: contract.type, side: index === 1 ? 'short' : 'long', contracts: 1, strike: contract.strike, expiry: contract.expiry, multiplier: 100, entryPrice: 2.5, iv: contract.iv }));
      const record = { id: 'three-expiry-saved', title: 'Three expiry tail', revision: 1, createdAt: stamp, updatedAt: stamp, state: held, snapshot };
      window.WebSocket = class { close() {} } as unknown as typeof WebSocket;
      window.fetch = (async url => {
        if (url === '/api/bootstrap') return Response.json({ session: { label: 'Tail fixture', local: true, recoveryKey: 'disabled-in-test' } });
        if (url === '/api/strategies') return Response.json({ strategies: [record] });
        if (url === '/api/strategies/three-expiry-saved') return Response.json({ record });
        throw new Error(`Unexpected tail request: ${String(url)}`);
      }) as typeof fetch;
      const waitFor = async (check: () => boolean) => { for (let i = 0; i < 800 && !check(); i++) await settleTimers(); assert(check(), 'Three-expiry workspace did not settle') };
      try {
        root = createRoot(fixture); await act(async () => root!.render(<App />));
        await waitFor(() => !!fixture.querySelector('option[value="three-expiry-saved"]'));
        await change('Saved positions', record.id); await click('Load');
        await waitFor(() => !!fixture.querySelector('[aria-label="Conditional first-expiry tail"]'));
        const tail = fixture.querySelector('[aria-label="Conditional first-expiry tail"]')!.textContent!;
        assert(tail.includes('loss grows without bound') && !tail.includes('finite limit'), `Wrong rendered three-expiry tail: ${tail}`);
        const years = (index: number) => (Date.parse(dates[index]) - Date.parse(dates[0])) / (365 * 86400000);
        const expectedSlope = 100 * (Math.exp(-.02 * years(2)) - Math.exp(-.02 * years(1)));
        const provenance = fixture.querySelector('[aria-label="Sampled range assumptions"]')!.textContent!;
        assert(provenance.includes(`slope ${expectedSlope.toPrecision(6)} USD per $1 spot`), `Rendered slope does not match independent dated-carry expression: ${provenance}`);
        assert(tail.includes('Not lifetime or assignment risk'), 'Conditional tail lost its risk scope');
      } finally { await unmount(); window.fetch = priorFetch; window.WebSocket = priorSocket }
    });
    for (const symbol of ['SPY', 'XSP']) await test(`${symbol} lot manager rolls, revisits and closes saved holdings with revision-bound performance`, async () => {
      await unmount(); const priorFetch = window.fetch;
      const stamp = '2026-09-01T12:00:00.000Z', range = { start: '2026-09-01', end: '2026-09-03' };
      const snapshot: MarketSnapshot = { id: 'roll-performance-quotes', source: 'Tastytrade', underlying: symbol, ...(symbol === 'XSP' ? { underlyingKind: 'cash-index' as const, indexSourceTime: stamp, contractTerms: { exerciseStyle: 'European' as const, settlement: 'cash' as const, multiplier: 100 as const, settlementSession: 'PM' as const } } : {}), spot: 100, spotAsOf: stamp, retrievedAt: stamp, availableExpiries: ['2026-10-09', '2026-10-16'], contracts: [100, 105].map((strike, index) => ({ contractId: `${symbol}   2610${index ? '16' : '09'}C${String(strike * 1000).padStart(8, '0')}`, type: 'call', strike, expiry: `2026-10-${index ? '16' : '09'}T20:00:00.000Z`, multiplier: 100, bid: 1.9, ask: 2.1, iv: .2, quoteAsOf: stamp })) };
      const held = createMarketStrategy('long-call', snapshot); held.pricing!.entryMode = 'fixed'; held.legs[0].contracts = 2; held.feeAllowance = 7;
      const source = createMarketStrategy('long-call', { ...snapshot, contracts: [snapshot.contracts[1]] });
      let saved: SavedStrategy = { id: 'roll-performance', title: 'Recorded roll fixture', revision: 1, createdAt: stamp, updatedAt: stamp, state: held, snapshot, lifecycle: createPosition(held) };
      const originalState = JSON.stringify(saved.state), sourceState = JSON.stringify(source);
      let confirmed = 0, callbacks = 0, dismissed = 0;
      const performanceRevisions: number[] = [];
      const ledger = () => saved.lifecycle!.schemaVersion === 2 ? saved.lifecycle! : upgradePositionLots(saved.lifecycle!);
      const loaded = () => ({ record: saved, projection: projectPositionLots(ledger()) });
      const marks = (index: number) => ({ response: [{ contract: { symbol, strike: index ? 105 : 100, expiration: `2026-10-${index ? '16' : '09'}`, right: 'CALL' }, data: [1, 2, 3].map(day => { const mid = index ? day === 3 ? 6.5 : 6 : day === 1 ? 3 : day === 2 ? 4 : 4.5; return { bid: mid - .1, ask: mid + .1, created: `2026-09-0${day}T17:15:00.000`, last_trade: `2026-09-0${day}T16:00:00.000` } }) }] });
      window.fetch = (async (url, init) => {
        const endpoint = '/api/strategies/roll-performance';
        if (url === `${endpoint}/lots`) return Response.json(loaded());
        const body = JSON.parse(String(init?.body)); assert(body.revision === saved.revision, 'Lot workflow used a stale saved revision');
        if (url === `${endpoint}/performance`) {
          assert(JSON.stringify(body.range) === JSON.stringify(range), 'Performance lost the selected date range');
          performanceRevisions.push(body.revision);
          const performance = buildPositionPerformance(ledger(), saved.lifecycle!.schemaVersion === 2 ? [marks(0), marks(1)] : [marks(0)], { response: [] }, range);
          return Response.json({ savedId: saved.id, revision: saved.revision, range, source: 'Theta EOD', performance });
        }
        if (url === `${endpoint}/transactions/preview`) return Response.json({ revision: saved.revision, projection: projectPositionLots(recordLotTransaction(ledger(), body.transaction)) });
        if (url === `${endpoint}/transactions`) {
          saved = { ...saved, revision: saved.revision + 1, updatedAt: new Date().toISOString(), lifecycle: recordLotTransaction(ledger(), body.transaction) }; confirmed++;
          return Response.json(loaded());
        }
        throw new Error('Unexpected lot performance fixture request');
      }) as typeof fetch;
      const waitFor = async (check: () => boolean) => { for (let i = 0; i < 200 && !check(); i++) await settleTimers(); assert(check(), `Lot performance workflow did not settle: ${fixture.querySelector('[role="alert"]')?.textContent ?? ''}`) };
      const mountManager = async (captured = source) => { root = createRoot(fixture); await act(async () => root!.render(<LotManagement savedId={saved.id} source={captured} onClose={() => { dismissed++ }} onRecorded={async () => { callbacks++ }} onAnalyze={() => { throw new Error('Recorded workflow changed builder') }} />)); await waitFor(() => !!fixture.querySelector('[aria-label="Saved position performance"]')) };
      const loadPerformance = async () => { await change('Performance start date', range.start); await change('Performance end date', range.end); await click('Load position performance'); await waitFor(() => !!fixture.querySelector('[aria-label="Selected performance accounting"]')) };
      const accounting = (name: string) => [...fixture.querySelectorAll('[aria-label="Selected performance accounting"] dt')].find(item => item.textContent === name)?.nextElementSibling?.textContent;
      const check = async (label: string) => { const input = fixture.querySelector<HTMLInputElement>(`[aria-label="${label}"]`); assert(input && !input.disabled, `Missing ${label}`); await act(async () => input.click()) };
      try {
        if (symbol === 'XSP') {
          const mismatched = structuredClone(source); delete mismatched.underlyingKind; mismatched.stock = { shares: 100, entryPrice: 100 };
          await mountManager(mismatched);
          assert(!fixture.querySelector('[aria-label="Open leg stock"]') && !fixture.querySelector(`[aria-label="Open leg ${source.legs[0].id}"]`), 'Index record offered stock or mismatched-kind openings');
          await unmount();
        }
        await mountManager();
        if (symbol === 'XSP') assert(fixture.textContent?.includes('premium points') && !fixture.textContent.includes('per share'), 'Index lot manager mislabeled premium units');
        await loadPerformance();
        if (symbol === 'XSP') assert(fixture.querySelector('[aria-label="Selected performance accounting"]')?.textContent?.includes('premium points'), 'Index performance lost premium units');
        assert(accounting('Gross realized P/L') === '$0.00' && accounting('Remaining unrealized P/L') === '$500.00' && accounting('Net position P/L') === '$493.00', 'Legacy position performance did not reconcile');
        await check('Close lot initial:option:0'); await change('Close quantity initial:option:0', '1'); await change('Close price initial:option:0', '3');
        await check(`Open leg ${source.legs[0].id}`); await change(`Open price ${source.legs[0].id}`, '4'); await change('Transaction UTC datetime', '2026-09-02T12:00:00');
        await click('Preview transaction'); await waitFor(() => !!fixture.querySelector('[aria-label="Transaction preview"]'));
        assert(confirmed === 0 && saved.revision === 1 && !fixture.querySelector('[aria-label="Saved position performance"]'), 'Preview wrote a transaction or retained stale performance');
        if (symbol === 'XSP') { const previewText = fixture.querySelector('[aria-label="Transaction preview"]')?.textContent ?? ''; assert(previewText.includes('3 premium points') && previewText.includes('4 premium points') && !previewText.includes('per share'), 'Index transaction preview mislabeled execution premiums'); }
        await click('Confirm recorded transaction'); await waitFor(() => callbacks === 1 && !!fixture.querySelector('[aria-label="Saved position performance"]'));
        assert(Number(saved.revision) === 2 && saved.lifecycle?.schemaVersion === 2 && saved.lifecycle.transactions.length === 1, 'Roll was not recorded exactly once');
        assert(!fixture.querySelector('[aria-label="Selected performance accounting"]'), 'Recording retained performance from the prior revision');
        await loadPerformance();
        assert(accounting('Gross realized P/L') === '$100.00' && accounting('Remaining unrealized P/L') === '$500.00' && accounting('Position allowance · deducted once') === '$7.00' && accounting('Net position P/L') === '$593.00', 'Rolled performance did not reconcile realized, remaining and allowance');
        await change('Inspect history date', '0'); assert(accounting('Net position P/L') === '$193.00', 'Roll was applied before its execution date');
        await change('Inspect history date', '1'); assert(accounting('Net position P/L') === '$493.00', 'Roll date did not include the replacement holding');
        await click('Close'); assert(dismissed === 1, 'Lot manager did not close'); await unmount(); await mountManager();
        assert(Number(saved.revision) === 2 && fixture.querySelector('.lot-inventory')?.textContent?.includes(snapshot.contracts[1].contractId), 'Revisit lost the saved replacement holding');
        await loadPerformance(); assert(accounting('Net position P/L') === '$593.00', 'Revisited performance changed');
        for (const lot of projectPositionLots(ledger()).lots) {
          await check(`Close lot ${lot.id}`); await change(`Close price ${lot.id}`, lot.asset.kind === 'option' && lot.asset.strike === 100 ? '4.5' : '6.5');
        }
        await change('Transaction UTC datetime', '2026-09-03T12:00:00'); await click('Preview transaction'); await waitFor(() => !!fixture.querySelector('[aria-label="Transaction preview"]'));
        await click('Confirm recorded transaction'); await waitFor(() => callbacks === 2 && !!fixture.querySelector('[aria-label="Saved position performance"]'));
        await loadPerformance();
        assert(projectPositionLots(ledger()).status === 'closed' && accounting('Gross realized P/L') === '$600.00' && accounting('Remaining unrealized P/L') === '$0.00' && accounting('Net position P/L') === '$593.00', 'Final close lost realized reconciliation');
        assert(performanceRevisions.join() === '1,2,2,3' && Number(confirmed) === 2 && JSON.stringify(saved.state) === originalState && JSON.stringify(source) === sourceState, 'Saved revisions or original builder holdings changed unexpectedly');
      } finally { await unmount(); window.fetch = priorFetch }
    });
    await test('Saved performance validates dated P/L, gaps, response identity and cancellation', async () => {
      await unmount(); const priorFetch = window.fetch;
      const stamp = '2026-09-01T12:00:00.000Z', expiry = '2026-10-09T20:00:00.000Z';
      const snapshot: MarketSnapshot = { id: 'performance-quotes', source: 'Tastytrade', underlying: 'SPY', spot: 100, spotAsOf: stamp, retrievedAt: stamp, availableExpiries: ['2026-10-09'], contracts: [{ contractId: 'SPY   261009C00100000', type: 'call', strike: 100, expiry, multiplier: 100, bid: 1.9, ask: 2.1, iv: .2, quoteAsOf: stamp }] };
      const held = createMarketStrategy('long-call', snapshot); held.pricing!.entryMode = 'fixed'; held.feeAllowance = 7;
      const record = { id: 'performance-saved', title: 'Performance fixture', revision: 3, createdAt: stamp, updatedAt: stamp, state: held, snapshot, lifecycle: createPosition(held) };
      const range = { start: '2026-09-01', end: '2026-09-03' };
      const performance = buildPositionPerformance(upgradePositionLots(record.lifecycle), [{ response: [{ contract: { symbol: 'SPY', strike: 100, expiration: '2026-10-09', right: 'CALL' }, data: [1, 3].map(day => ({ bid: day === 1 ? 2.9 : .9, ask: day === 1 ? 3.1 : 1.1, created: `2026-09-0${day}T17:15:00.000`, last_trade: `2026-09-0${day}T16:00:00.000` })) }] }], { response: [] }, range);
      const response = () => ({ savedId: record.id, revision: record.revision, range, source: 'Theta EOD', performance });
      const calls: Array<{ signal?: AbortSignal | null; finish: (body: unknown) => void }> = [];
      window.fetch = (async (url, init) => {
        assert(url === '/api/strategies/performance-saved/performance', 'Unexpected performance request');
        const body = JSON.parse(String(init?.body)); assert(body.revision === 3 && body.range.start === range.start && body.range.end === range.end, 'Performance request lost revision or selected dates');
        return new Promise<Response>(resolve => calls.push({ signal: init?.signal, finish: body => resolve(Response.json(body)) }));
      }) as typeof fetch;
      const waitFor = async (check: () => boolean) => { for (let i = 0; i < 100 && !check(); i++) await settleTimers(); assert(check(), 'Performance workflow did not settle') };
      try {
        root = createRoot(fixture); await act(async () => root!.render(<PositionPerformance record={record} />));
        await change('Performance start date', range.start); await change('Performance end date', range.end);
        await click('Load position performance'); assert(calls.length === 1 && fixture.textContent?.includes('Loading recorded-position history'), 'Explicit load did not start');
        await act(async () => calls[0].finish(response())); await waitFor(() => !!fixture.querySelector('[aria-label="Selected performance accounting"]'));
        assert(fixture.querySelectorAll('svg').length === 1 && fixture.querySelectorAll('[data-history-segment]').length === 2, 'Saved performance bridged missing marks or included an underlying plot');
        assert(fixture.textContent?.includes('-$107.00') && fixture.textContent.includes('$93.00') && fixture.textContent.includes('2026-09-03T17:15:00.000'), 'P/L or raw report times were lost');
        await change('Inspect history date', '1');
        assert(fixture.querySelector('[aria-label="Selected performance accounting"]')?.textContent?.includes('No admissible dated mark'), 'Missing lot identity was not explained');
        await click('Load position performance'); const tampered = structuredClone(response()); tampered.performance.rows[0].combinedPnl = 999;
        await act(async () => calls[1].finish(tampered)); await waitFor(() => !!fixture.querySelector('[role="alert"]'));
        assert(!fixture.querySelector('svg'), 'Altered P/L was displayed');
        await click('Load position performance'); await act(async () => calls[2].finish({ ...response(), revision: 2 }));
        await waitFor(() => !!fixture.querySelector('[role="alert"]')); assert(!fixture.querySelector('svg'), 'Stale revision was displayed');
        await click('Load position performance'); await change('Performance end date', '2026-09-02');
        assert(calls[3].signal?.aborted, 'Date change did not cancel performance');
        await act(async () => calls[3].finish(response())); assert(!fixture.querySelector('svg'), 'Late response survived date change');
        await change('Performance end date', range.end); await click('Load position performance'); await unmount();
        assert(calls[4].signal?.aborted, 'Unmount did not cancel performance');
      } finally { await unmount(); window.fetch = priorFetch }
    });
    await test('Performance chart preserves P/L gaps and does not reuse fixed-inventory labels', async () => {
      await unmount();
      root = createRoot(fixture);
      await act(async () => root!.render(<HistoryCharts performanceLabel="Net position P/L" rows={[{ label: '2026-09-01', value: 0, underlying: null }, { label: '2026-09-02', value: null, underlying: null }, { label: '2026-09-03', value: -10, underlying: null }]} selected={0} onInspect={() => {}} />));
      assert(fixture.querySelectorAll('svg').length === 1 && fixture.querySelectorAll('[data-history-segment]').length === 2, 'Performance chart bridged a gap or retained underlying plot');
      assert(fixture.textContent?.includes('Net position P/L') && fixture.textContent.includes('$0.00'), 'Performance chart omitted label or zero');
      assert(!/Fixed current holdings|Current inventory|Quote sides|point for discussion/.test(fixture.textContent ?? ''), 'Performance chart reused misleading inventory labels');
    });
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
    await test('Mocked AI stock and calendar discovery validates before rendering and requires explicit Apply', async () => {
      await unmount(); const priorFetch = window.fetch, priorSocket = window.WebSocket;
      const stamp = new Date(fixedNow - 120000).toISOString(), dates = ['2027-10-09T20:00:00.000Z', '2027-10-16T20:00:00.000Z'];
      const snapshot: MarketSnapshot = { id: 'ai-domain-window', source: 'Tastytrade', underlying: 'SPY', spot: 100, spotAsOf: stamp, retrievedAt: stamp, availableExpiries: dates.map(date => date.slice(0, 10)), contracts: dates.flatMap(expiry => [95, 100, 105].flatMap(strike => (['call', 'put'] as const).map(type => ({ contractId: `SPY   ${expiry.slice(2, 10).replaceAll('-', '')}${type === 'call' ? 'C' : 'P'}${String(strike * 1000).padStart(8, '0')}`, type, strike, expiry, multiplier: 100 as const, bid: 2, ask: 3, iv: .25, quoteAsOf: stamp })))) };
      const held = createMarketStrategy('long-call', snapshot); held.valuationModel = 'american-crr-1024-v1';
      const seed = { id: 'ai-domain-seed', title: 'Synthetic AI domains', revision: 1, createdAt: stamp, updatedAt: stamp, state: held, snapshot };
      let family: 'protective-put' | 'call-calendar' = 'protective-put', attack: 'bound' | 'domain' | 'outlay' | undefined, saved: typeof seed | undefined, calls = 0;
      window.WebSocket = class { close() {} } as unknown as typeof WebSocket;
      window.fetch = (async (url, init) => {
        if (url === '/api/bootstrap') return Response.json({ session: { label: 'Mocked AI domains', local: true, recoveryKey: 'disabled-in-test' } });
        if (url === '/api/strategies' && init?.method === 'POST') { saved = { ...seed, id: 'ai-domain-copy', state: JSON.parse(String(init.body)).state }; return Response.json({ record: saved }, { status: 201 }); }
        if (url === '/api/strategies') return Response.json({ strategies: [seed] });
        if (url === '/api/strategies/ai-domain-seed') return Response.json({ record: seed });
        if (url === '/api/sparring') {
          calls++; const body = JSON.parse(String(init?.body));
          const candidateSearch = searchCandidates(projectAnalysisPosition(body.state)!, snapshot, { targetSpot: 100, targetDate: dates[0], maxLoss: 20000, feeAllowance: 5, basis: 'mid', objective: 'target-pnl' }, { families: [family], maxEntryOutlay: 20000 });
          assert(candidateSearch.candidates.length > 0, 'AI domain fixture has no candidate');
          if (attack === 'bound') candidateSearch.candidates[0].lossBound!.amount += 1;
          if (attack === 'domain') candidateSearch.domain!.families = ['options'];
          if (attack === 'outlay') candidateSearch.domain!.maxEntryOutlay = 0;
          return Response.json({ request_id: body.request_id, base_state_version: body.base_state_version, next_state: { ...body.state, version: body.state.version + 1 }, reply: { text: 'Synthetic mocked AI discovery.', operations: [], assumptions: [], objections: [], suggested_prompts: [], evidence_ids: [], risk_classification: 'bounded' }, calculated: { riskSummary: 'Synthetic test only', dataMode: 'market-snapshot', candidateSearch }, market_context: { sources: [], retrievedAt: stamp } });
        }
        throw new Error(`Unexpected mocked AI domain request: ${String(url)}`);
      }) as typeof fetch;
      const waitFor = async (check: () => boolean, stage: string) => { for (let i = 0; i < 800 && !check(); i++) await settleTimers(); assert(check(), `AI domain ${stage}: ${fixture.textContent?.slice(-1500)}`) };
      const inputs = () => [...fixture.querySelectorAll<HTMLInputElement>('.leg-list input, .leg-list select, [aria-label="Shares"], [aria-label="Share entry cost"], [aria-label="Scenario spot"], [aria-label="Scenario date UTC"]')].map(field => field.value).join();
      try {
        root = createRoot(fixture); await act(async () => root!.render(<App />));
        await waitFor(() => !!fixture.querySelector('option[value="ai-domain-seed"]'), 'seed'); await change('Saved positions', seed.id); await click('Load');
        await waitFor(() => !fixture.querySelector<HTMLInputElement>('[aria-label="Optimizer call calendar"]')?.disabled, 'model');
        const before = inputs();
        for (family of ['protective-put', 'call-calendar'] as const) {
          const displayed = fixture.querySelectorAll('[aria-label="Ranked quoted candidates"]').length;
          await click('Break the thesis'); await waitFor(() => fixture.querySelectorAll('[aria-label="Ranked quoted candidates"]').length === displayed + 1, `${family} render`);
          const card = [...fixture.querySelectorAll('[aria-label="Ranked quoted candidates"]')].at(-1)!;
          assert(family === 'protective-put' ? /100 shares/i.test(card.textContent ?? '') : /conservative.*first.expiry/i.test(card.textContent ?? '') && !card.textContent?.includes('Unbounded'), 'AI candidate omitted stock or conservative risk scope');
          await act(async () => card.querySelector<HTMLButtonElement>('button')!.click()); await waitFor(() => !!fixture.querySelector('.proposal-card'), `${family} inspect`);
          await waitFor(() => !!fixture.querySelector('[aria-label="Optimizer target comparison"] path.proposal-line')?.getAttribute('d'), `${family} target comparison`);
          assert(inputs() === before && !saved, 'AI search or inspection changed holdings before Apply');
          await click('Apply proposal'); await click('Save as new'); await waitFor(() => !!saved, `${family} save`);
          assert(family === 'protective-put' ? saved!.state.stock?.shares === 100 && saved!.state.stock.entryPrice === snapshot.spot : new Set(saved!.state.legs.map(leg => leg.expiry)).size === 2 && !saved!.state.stock, 'AI candidate Apply lost stock or mixed expiries');
          await act(async () => fixture.querySelector<HTMLButtonElement>('[aria-label="Undo"]')!.click()); saved = undefined; assert(inputs() === before, 'AI candidate Undo changed original holdings');
        }
        for (attack of ['bound', 'domain', 'outlay'] as const) {
          const displayed = fixture.querySelectorAll('[aria-label="Ranked quoted candidates"]').length;
          await click('Break the thesis'); await waitFor(() => !fixture.querySelector('.thinking'), `${attack} rejection`);
          assert(fixture.querySelectorAll('[aria-label="Ranked quoted candidates"]').length === displayed && inputs() === before && !fixture.querySelector('.proposal-card') && fixture.textContent?.includes('REVIEW FAILED'), `Forged ${attack} was displayed or changed holdings`);
        }
        assert(calls === 5, 'Mocked AI acceptance path was skipped');
      } finally { await unmount(); window.fetch = priorFetch; window.WebSocket = priorSocket }
    });
    await test('Quoted candidate transfer preserves excluded fixed-entry holdings and Undo', async () => {
      await unmount(); const priorFetch = window.fetch, priorSocket = window.WebSocket, priorWorker = window.Worker;
      const stamp = new Date(fixedNow - 120000).toISOString(), expiry = '2027-10-09T20:00:00.000Z';
      const snapshot: MarketSnapshot = { id: 'candidate-held-window', source: 'Tastytrade', underlying: 'SPY', spot: 100, spotAsOf: stamp, retrievedAt: stamp, availableExpiries: ['2027-10-09'], contracts: [90, 95, 100, 105, 110].flatMap(strike => (['call', 'put'] as const).map(type => ({ contractId: `SPY   271009${type === 'call' ? 'C' : 'P'}${String(strike * 1000).padStart(8, '0')}`, type, strike, expiry, multiplier: 100 as const, bid: 2, ask: 3, iv: .2, quoteAsOf: stamp }))) };
      const heldState = createMarketStrategy('bull-call', snapshot);
      heldState.pricing!.entryMode = 'fixed'; heldState.legs[0].entryPrice = 1.23; heldState.excludedLegIds = [heldState.legs[0].id];
      heldState.stock = { shares: 50, entryPrice: 100 };
      const seed = { id: 'candidate-held-seed', title: 'Held candidate fixture', revision: 1, createdAt: stamp, updatedAt: stamp, state: heldState, snapshot };
      let saved: typeof seed | undefined, maliciousCandidate: 'entry' | 'fixed' | undefined;
      let activeSnapshot = snapshot;
      let candidate = createMarketStrategy('long-put', snapshot);
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
          const body = JSON.parse(String(init?.body)), next = mergeAnalysisProposal(body.state, { ...projectAnalysisPosition(body.state)!, version: body.state.version + 1 });
          const candidateSearch = searchCandidates(projectAnalysisPosition(body.state)!, activeSnapshot, { targetSpot: 90, targetDate: expiry, maxLoss: 300, feeAllowance: 0, basis: 'mid', objective: 'target-pnl' });
          candidate = structuredClone(candidateSearch.candidates[0].state);
          if (maliciousCandidate) candidateSearch.candidates[0].state.legs[0].entryPrice = 0.01;
          if (maliciousCandidate === 'fixed') candidateSearch.candidates[0].state.pricing!.entryMode = 'fixed';
          return Response.json({ request_id: body.request_id, base_state_version: body.base_state_version, next_state: next,
            reply: { text: 'Inspect this quoted alternative.', operations: [], assumptions: [], objections: [], suggested_prompts: [], evidence_ids: [], risk_classification: 'bounded' },
            calculated: { riskSummary: 'Included holdings only', dataMode: 'market-snapshot', candidateSearch }, market_context: { sources: [], retrievedAt: stamp } });
        }
        throw new Error('Unexpected candidate fixture request');
      }) as typeof fetch;
      const waitFor = async (check: () => boolean) => { for (let i = 0; i < 800 && !check(); i++) await settleTimers(); assert(check(), `Candidate transfer did not settle: ${fixture.querySelector('[role="alert"]')?.textContent ?? ''}`) };
      const inputs = () => [...fixture.querySelectorAll<HTMLInputElement>('.leg-list input:not([type="checkbox"]), .leg-list select')].map(input => input.value).join();
      const inspect = async () => { const button = [...fixture.querySelectorAll<HTMLButtonElement>('[aria-label="Ranked quoted candidates"]')].at(-1)?.querySelector<HTMLButtonElement>('button'); assert(button && !button.disabled, 'No current candidate to inspect'); await act(async () => button.click()) };
      try {
        root = createRoot(fixture); await act(async () => root!.render(<App />));
        await waitFor(() => !!fixture.querySelector('option[value="candidate-held-seed"]'));
        await change('Saved positions', seed.id); await click('Load');
        await waitFor(() => !!fixture.querySelector('.leg-list input[type="checkbox"]:not(:checked)'));
        const original = inputs();
        await click('Break the thesis'); await waitFor(() => !!fixture.querySelector('[aria-label="Ranked quoted candidates"]'));
        await inspect(); await waitFor(() => !!fixture.querySelector('.proposal-card'));
        await waitFor(() => !!fixture.querySelector('[aria-label="Optimizer target comparison"] path.proposal-line')?.getAttribute('d'));
        assert(fixture.querySelector<HTMLInputElement>('[aria-label="Shares"]')?.value === '50', 'AI inspection changed held shares before Apply');
        assert(sentStates.some(position => position.legs.length === 1 && position.legs[0].contractId === candidate.legs[0].contractId), 'Candidate comparison was not projected');
        await click('Apply proposal'); await click('Save as new'); await waitFor(() => !!saved);
        assert(saved!.state.pricing?.entryMode === 'fixed' && saved!.state.excludedLegIds?.join() === heldState.excludedLegIds!.join() && !saved!.state.stock, 'Candidate lost fixed-entry mode, exclusion selection or explicit share replacement');
        assert(JSON.stringify(saved!.state.legs[0]) === JSON.stringify(heldState.legs[0]) && saved!.state.legs[1].contractId === candidate.legs[0].contractId, 'Candidate changed excluded cost or failed to replace included leg');
        const applied = inputs(); saved = undefined;
        await click('Refresh prices'); await waitFor(() => fixture.querySelector('.contract-quote')?.textContent?.includes('Bid $4.00') === true);
        await waitFor(() => ![...fixture.querySelectorAll('button')].some(button => button.textContent === 'Loading quotes…'));
        await click('Save as new'); await waitFor(() => !!saved);
        assert(inputs() === applied && saved!.state.pricing?.entryMode === 'fixed' && saved!.state.legs[1].entryPrice === candidate.legs[0].entryPrice, 'Quote refresh changed newly frozen or retained entry costs');
        await act(async () => fixture.querySelector<HTMLButtonElement>('[aria-label="Undo"]')!.click());
        await act(async () => fixture.querySelector<HTMLButtonElement>('[aria-label="Undo"]')!.click());
        assert(inputs() === original && fixture.querySelector('.leg-list input[type="checkbox"]:not(:checked)') && fixture.querySelector<HTMLInputElement>('[aria-label="Shares"]')?.value === '50' && fixture.querySelector<HTMLInputElement>('[aria-label="Share entry cost"]')?.value === '100', 'Candidate Undo did not restore held construction and shares');
        for (const attack of ['entry', 'fixed'] as const) {
          const displayed = fixture.querySelectorAll('[aria-label="Ranked quoted candidates"]').length;
          maliciousCandidate = attack; await click('Break the thesis');
          await waitFor(() => !fixture.querySelector('.thinking'));
          assert(!fixture.querySelector('.proposal-card') && inputs() === original && fixture.querySelectorAll('[aria-label="Ranked quoted candidates"]').length === displayed && fixture.textContent?.includes('REVIEW FAILED'), `Untrusted ${attack} candidate pricing was displayed or promoted to held costs`);
        }
      } finally { await unmount(); window.fetch = priorFetch; window.WebSocket = priorSocket; window.Worker = priorWorker }
    });
    await test('Direct optimizer ranks without AI, applies quoted candidates and rejects stale or altered results', async () => {
      await unmount(); const priorFetch = window.fetch, priorSocket = window.WebSocket;
      const stamp = new Date(fixedNow - 120000).toISOString(), expiry = '2027-10-09T20:00:00.000Z';
      const snapshot: MarketSnapshot = { id: 'direct-window', source: 'Tastytrade', underlying: 'SPY', spot: 100, spotAsOf: stamp, retrievedAt: stamp, availableExpiries: ['2027-10-09'], contracts: [90, 95, 100, 105, 110].flatMap(strike => (['call', 'put'] as const).map(type => ({ contractId: `SPY   271009${type === 'call' ? 'C' : 'P'}${String(strike * 1000).padStart(8, '0')}`, type, strike, expiry, multiplier: 100 as const, bid: 2, ask: 3, iv: .2, quoteAsOf: stamp }))) };
      const held = createMarketStrategy('bull-call', snapshot);
      held.pricing!.entryMode = 'fixed'; held.legs[0].entryPrice = 1.23; held.excludedLegIds = [held.legs[0].id];
      const seed = { id: 'direct-seed', title: 'Direct optimizer fixture', revision: 1, createdAt: stamp, updatedAt: stamp, state: held, snapshot };
      let activeSnapshot = snapshot, saved: typeof seed | undefined, searches = 0, aiCalls = 0;
      let mode: 'normal' | 'deferred' | 'altered' | 'stock-altered' = 'normal', release: (() => void) | undefined;
      let ranked: ReturnType<typeof searchCandidates> | undefined;
      window.WebSocket = class { close() {} } as unknown as typeof WebSocket;
      window.fetch = (async (url, init) => {
        if (url === '/api/bootstrap') return Response.json({ session: { label: 'Direct optimizer', local: true, recoveryKey: 'disabled-in-test' } });
        if (url === '/api/strategies' && init?.method === 'POST') { const body = JSON.parse(String(init.body)); saved = { ...seed, id: 'direct-saved', state: body.state, snapshot: activeSnapshot }; return Response.json({ record: saved }, { status: 201 }); }
        if (url === '/api/strategies') return Response.json({ strategies: saved ? [seed, saved] : [seed] });
        if (url === '/api/strategies/direct-seed') return Response.json({ record: seed });
        if (url === '/api/strategies/direct-saved') return Response.json({ record: saved });
        if (String(url).startsWith('/api/chain?')) { activeSnapshot = { ...snapshot, id: 'direct-refreshed', availableExpiries: ['2027-10-09', '2027-10-16'], contracts: snapshot.contracts.flatMap(contract => [{ ...contract, bid: 4, ask: 5 }, { ...contract, contractId: contract.contractId.replace('271009', '271016'), expiry: '2027-10-16T20:00:00.000Z', bid: 4, ask: 5 }]) }; return Response.json({ snapshot: activeSnapshot }); }
        if (url === '/api/sparring') { aiCalls++; throw new Error('Direct optimizer must not call AI'); }
        if (url === '/api/candidates') {
          searches++; const body = JSON.parse(String(init?.body)); ranked = searchCandidates(body.state, activeSnapshot, body.search, body.domain);
          assert(ranked.candidates.length > 0, 'Deterministic fixture yielded no ranked candidates');
          const response = structuredClone(ranked);
          if (mode === 'altered') response.candidates[0].state.legs[0].entryPrice = .01;
          if (mode === 'stock-altered') response.candidates[0].state.stock!.shares = 99;
          if (mode === 'deferred') return await new Promise<Response>(resolve => { release = () => resolve(Response.json({ search: response })); });
          return Response.json({ search: response });
        }
        throw new Error(`Unexpected direct optimizer request: ${String(url)}`);
      }) as typeof fetch;
      const waitFor = async (check: () => boolean, stage: string) => { for (let i = 0; i < 800 && !check(); i++) await settleTimers(); assert(check(), `Direct optimizer ${stage} did not settle: ${[...fixture.querySelectorAll('[role="alert"], .workspace-error')].map(element => element.textContent).join(' | ')}; searches=${searches}; optimizer=${fixture.querySelector('[aria-label="Strategy optimizer"]')?.textContent ?? 'missing'}`) };
      const inputs = () => [...fixture.querySelectorAll<HTMLInputElement>('.leg-list input:not([type="checkbox"]), .leg-list select')].map(input => input.value).join();
      const configure = async () => { await change('Optimizer target price', '120'); await change('Optimizer target date UTC', expiry.slice(0, 19)); await change('Optimizer maximum loss', '1000'); await change('Optimizer fee allowance', '0'); await change('Optimizer quote basis', 'mid'); await change('Optimizer objective', 'target-pnl'); };
      try {
        root = createRoot(fixture); await act(async () => root!.render(<App />));
        await waitFor(() => !!fixture.querySelector('option[value="direct-seed"]'), 'seed');
        await change('Saved positions', seed.id); await click('Load');
        await waitFor(() => !!fixture.querySelector('.leg-list input[type="checkbox"]:not(:checked)'), 'load');
        const scenario = () => ['Scenario spot', 'Scenario date UTC'].map(label => (fixture.querySelector(`[aria-label="${label}"]`) as HTMLInputElement).value).join();
        const original = inputs(), originalScenario = scenario(); await configure(); await click('Find strategies');
        await waitFor(() => !!fixture.querySelector('[aria-label="Deterministic quoted candidates"]'), 'ranking');
        const chosen = ranked!.candidates[0];
        await click('Inspect strategy'); await waitFor(() => !!fixture.querySelector('.proposal-card'), 'inspection');
        await waitFor(() => !!fixture.querySelector('[aria-label="Optimizer target comparison"] path.proposal-line')?.getAttribute('d'), 'comparison chart');
        const expectedBaseline = calculateStrategy({ ...projectAnalysisPosition(held)!, scenarioSpot: 120, scenarioDate: expiry });
        const pnlLabel = [...fixture.querySelectorAll('.comparison-metrics span')].find(element => element.textContent === 'Scenario P/L');
        const expectedMoney = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(expectedBaseline.scenarioPnl);
        assert(pnlLabel?.nextElementSibling?.textContent === expectedMoney, 'Optimizer did not reprice held baseline at the search target');
        assert(inputs() === original && scenario() === originalScenario, 'Inspect changed held inputs or workspace scenario');
        await click('Keep current');
        assert(!fixture.querySelector('.proposal-card') && inputs() === original && scenario() === originalScenario, 'Cancel changed held inputs or workspace scenario');
        await click('Inspect strategy'); await waitFor(() => !!fixture.querySelector('.proposal-card'), 'reinspection');
        await click('Apply proposal'); await click('Save as new'); await waitFor(() => !!saved, 'save');
        assert(saved!.state.pricing?.entryMode === 'fixed' && saved!.state.excludedLegIds?.join() === held.excludedLegIds!.join(), 'Direct transfer lost fixed costs or exclusions');
        assert(JSON.stringify(saved!.state.legs[0]) === JSON.stringify(held.legs[0]), 'Direct transfer changed excluded held cost');
        assert(saved!.state.legs.slice(1).map(leg => leg.contractId).join() === chosen.state.legs.map(leg => leg.contractId).join(), 'Applied holdings differ from inspected deterministic result');
        await act(async () => fixture.querySelector<HTMLButtonElement>('[aria-label="Undo"]')!.click());
        assert(inputs() === original, 'Direct candidate Undo changed original construction');
        mode = 'deferred'; await configure(); await click('Find strategies'); await waitFor(() => !!release, 'deferred version search');
        await click('Include all legs'); await act(async () => release!()); release = undefined;
        await settleTimers(); assert(!fixture.querySelector('[aria-label="Deterministic quoted candidates"]'), 'Late optimizer result survived position version change');
        await act(async () => fixture.querySelector<HTMLButtonElement>('[aria-label="Undo"]')!.click());
        await configure(); await click('Find strategies'); await waitFor(() => !!release, 'deferred snapshot search');
        await click('Refresh prices'); await waitFor(() => fixture.querySelector('.contract-quote')?.textContent?.includes('Bid $4.00') === true, 'refresh');
        await act(async () => release!()); release = undefined;
        await settleTimers(); assert(!fixture.querySelector('[aria-label="Deterministic quoted candidates"]'), 'Late optimizer result survived snapshot replacement');
        mode = 'altered'; await configure(); const unchanged = inputs(); await click('Find strategies');
        await waitFor(() => !!fixture.querySelector('[aria-label="Strategy optimizer"] [role="alert"]'), 'tamper rejection');
        assert(!fixture.querySelector('[aria-label="Deterministic quoted candidates"]') && !fixture.querySelector('.proposal-card') && inputs() === unchanged, 'Altered candidate reached inspection or changed holdings');
        mode = 'normal'; await change('Optimizer target date UTC', '2027-10-16T20:00:00'); await click('Find strategies');
        await waitFor(() => !!fixture.querySelector('[aria-label="Deterministic quoted candidates"]'), 'later-date ranking');
        await click('Inspect strategy'); await waitFor(() => !!fixture.querySelector('.proposal-card'), 'later-date inspection');
        assert(fixture.querySelector('[aria-label="Optimizer comparison unavailable"]')?.textContent?.includes('beyond the first held option expiry') && !fixture.querySelector('[aria-label="Optimizer target comparison"]'), 'Unsupported held horizon produced a fabricated target comparison');
        await click('Keep current'); assert(inputs() === unchanged, 'Horizon-unavailable inspection changed holdings');
        await configure(); await change('Optimizer maximum entry outlay', '20000');
        const toggle = async (label: string) => act(async () => fixture.querySelector<HTMLInputElement>(`[aria-label="${label}"]`)!.click());
        await toggle('Optimizer options only'); await toggle('Optimizer protective put');
        await click('Find strategies'); await waitFor(() => !!fixture.querySelector('[aria-label="Deterministic quoted candidates"]'), 'stock ranking');
        await click('Inspect strategy'); await waitFor(() => !!fixture.querySelector('.proposal-card'), 'stock inspection');
        await click('Apply proposal'); saved = undefined; await click('Save as new'); await waitFor(() => !!saved, 'stock save');
        assert(saved!.state.stock?.shares === 100 && saved!.state.stock.entryPrice === snapshot.spot, 'Stock candidate transfer lost captured shares');
        assert(JSON.stringify(saved!.state.legs[0]) === JSON.stringify(held.legs[0]), 'Stock transfer changed excluded held cost');
        await act(async () => fixture.querySelector<HTMLButtonElement>('[aria-label="Undo"]')!.click());
        assert(inputs() === unchanged && !fixture.querySelector('[aria-label="Shares"]'), 'Stock candidate Undo did not restore original position');
        await change('Saved positions', 'direct-saved'); await click('Load');
        await waitFor(() => (fixture.querySelector('[aria-label="Shares"]') as HTMLInputElement)?.value === '100', 'stock reopen');
        assert((fixture.querySelector('[aria-label="Share entry cost"]') as HTMLInputElement)?.value === String(snapshot.spot), 'Reopened stock entry cost changed');
        await act(async () => fixture.querySelector<HTMLButtonElement>('[aria-label="Undo"]')!.click());
        assert(inputs() === unchanged && !fixture.querySelector('[aria-label="Shares"]'), 'Reopened stock Undo changed original position');
        await configure(); await change('Optimizer maximum entry outlay', '20000'); await toggle('Optimizer options only'); await toggle('Optimizer protective put');
        mode = 'stock-altered'; await click('Find strategies'); await waitFor(() => !!fixture.querySelector('[aria-label="Strategy optimizer"] [role="alert"]'), 'stock tamper');
        assert(!fixture.querySelector('[aria-label="Deterministic quoted candidates"]') && inputs() === unchanged, 'Forged stock candidate reached builder');
        mode = 'deferred'; await click('Find strategies'); await waitFor(() => !!release, 'domain deferred');
        await change('Optimizer maximum entry outlay', '19000'); await act(async () => release!()); release = undefined;
        await settleTimers(); assert(!fixture.querySelector('[aria-label="Deterministic quoted candidates"]'), 'Changed outlay admitted stale domain result');
        assert(searches === 8 && aiCalls === 0, 'Direct optimizer skipped an acceptance path or used AI');
      } finally { release?.(); await unmount(); window.fetch = priorFetch; window.WebSocket = priorSocket }
    });
    await test('XSP builder keeps European cash-index identity through loading, templates, save, reopen and Undo', async () => {
      await unmount(); const priorFetch = window.fetch, priorSocket = window.WebSocket;
      const stamp = new Date(fixedNow - 120000).toISOString(), expiry = '2027-10-09T20:00:00.000Z';
      const snapshot: MarketSnapshot = { id: 'index-builder', source: 'Tastytrade', underlying: 'XSP', underlyingKind: 'cash-index', spot: 100, spotAsOf: stamp, indexSourceTime: stamp, retrievedAt: stamp, availableExpiries: ['2027-10-09'], contractTerms: { exerciseStyle: 'European', settlement: 'cash', multiplier: 100, settlementSession: 'PM' }, contracts: [90, 95, 100, 105, 110].flatMap(strike => (['call', 'put'] as const).map(type => ({ contractId: `XSP   271009${type === 'call' ? 'C' : 'P'}${String(strike * 1000).padStart(8, '0')}`, type, strike, expiry, multiplier: 100 as const, bid: 2, ask: 3, iv: .2, quoteAsOf: stamp }))) };
      let saved: Omit<SavedStrategy, 'lifecycle'> | undefined, chains = 0;
      window.WebSocket = class { close() {} } as unknown as typeof WebSocket;
      window.fetch = (async (url, init) => {
        if (url === '/api/bootstrap') return Response.json({ session: { label: 'Index builder', local: true, recoveryKey: 'disabled-in-test' } });
        if (url === '/api/strategies' && init?.method === 'POST') { const body = JSON.parse(String(init.body)); saved = { id: 'index-saved', title: body.title, revision: 1, createdAt: stamp, updatedAt: stamp, state: body.state, snapshot }; return Response.json({ record: saved }, { status: 201 }); }
        if (url === '/api/strategies') return Response.json({ strategies: saved ? [saved] : [] });
        if (url === '/api/strategies/index-saved') return Response.json({ record: saved });
        if (String(url).startsWith('/api/chain?')) { assert(new URL(String(url), location.origin).searchParams.get('symbol') === 'XSP', 'Unexpected index fixture symbol'); chains++; return Response.json({ snapshot }); }
        throw new Error(`Unexpected index builder request: ${String(url)}`);
      }) as typeof fetch;
      const waitFor = async (check: () => boolean, stage: string) => { for (let i = 0; i < 400 && !check(); i++) await settleTimers(); assert(check(), `Index builder ${stage}: ${fixture.querySelector('.workspace-error')?.textContent ?? ''}`) };
      const model = () => fixture.querySelector<HTMLInputElement>('[aria-label="Valuation model"]')!;
      const inputs = () => [...fixture.querySelectorAll<HTMLInputElement>('.leg-list input:not([type="checkbox"]), .leg-list select')].map(input => input.value).join();
      const undo = async () => act(async () => fixture.querySelector<HTMLButtonElement>('[aria-label="Undo"]')!.click());
      const indexControls = () => {
        assert(model()?.value === 'european-bsm-v1' && !model().querySelector('option[value="american-crr-1024-v1"]'), 'Index offered American valuation');
        assert(![...fixture.querySelectorAll('button')].some(button => button.textContent === 'Add shares' || button.textContent === 'Preview American'), 'Index offered shares or American preview');
        assert(!fixture.querySelector('[aria-label="Optimizer covered call"], [aria-label="Optimizer protective put"], [aria-label="Optimizer collar"]'), 'Index optimizer offered stock-backed families');
        for (const name of ['Covered call', 'Protective put', 'Collar']) { const button = [...fixture.querySelectorAll<HTMLButtonElement>('.template-list button')].find(item => item.querySelector('span')?.textContent === name); assert(!button || button.disabled, `Index offered ${name}`); }
      };
      try {
        root = createRoot(fixture); await act(async () => root!.render(<App />));
        await waitFor(() => !fixture.querySelector('.saved-workspace summary')?.textContent?.includes('Checking session'), 'bootstrap');
        await click('Methodology'); const equityInputs = inputs();
        await click('Heatmap'); await click('Preview American');
        assert(fixture.querySelector('.heatmap-wrap')?.textContent?.includes('American comparison'), 'Equity preview did not activate');
        await change('Underlying symbol', 'XSP'); await click('Load symbol');
        await waitFor(() => !!fixture.querySelector('.market-pricing-panel'), 'default model load');
        indexControls(); assert(fixture.querySelector('[aria-label="Recorded contract terms"]')?.textContent?.includes('cash settlement'), 'Index cash terms missing');
        await waitFor(() => !!fixture.querySelector('canvas.heatmap[aria-busy="false"][aria-label^="Modeled price by time"]'), 'European heatmap after equity preview');
        assert(!fixture.querySelector('.heatmap-wrap')?.textContent?.includes('American comparison'), 'Index retained stale American preview');
        await click('Curve');
        await undo(); assert(inputs() === equityInputs && model().querySelector('option[value="american-crr-1024-v1"]'), 'Index Undo failed to restore equity');
        await change('Valuation model', 'american-crr-1024-v1');
        await change('Underlying symbol', 'XSP'); await click('Load symbol');
        await waitFor(() => !!fixture.querySelector('.market-pricing-panel'), 'American equity load'); indexControls();
        const longCall = [...fixture.querySelectorAll<HTMLButtonElement>('.template-list button')].find(item => item.querySelector('span')?.textContent === 'Long call');
        assert(longCall && !longCall.disabled, 'Index long call missing'); await act(async () => longCall.click());
        assert(fixture.querySelectorAll('.leg-row').length === 1, 'Index template did not rebuild'); indexControls();
        await click('Heatmap'); indexControls(); await click('Curve');
        await click('Save as new'); await waitFor(() => !!saved, 'save');
        assert(saved!.state.underlyingKind === 'cash-index' && saved!.state.valuationModel === 'european-bsm-v1' && !saved!.state.stock, 'Saved index identity or model lost');
        await undo(); await undo(); assert(model().value === 'american-crr-1024-v1' && inputs() === equityInputs, 'Index Undo failed to restore American equity');
        await change('Saved positions', 'index-saved'); await click('Load');
        await waitFor(() => !!fixture.querySelector('.market-pricing-panel'), 'reopen'); indexControls();
        assert(fixture.querySelectorAll('.leg-row').length === 1 && chains === 2, 'Reopen lost template or unexpectedly refetched');
        await undo(); assert(model().value === 'american-crr-1024-v1' && inputs() === equityInputs, 'Reopen Undo failed to restore equity');
      } finally { await unmount(); window.fetch = priorFetch; window.WebSocket = priorSocket }
    });
    await test('One-to-four expiry windows support eight-leg construction, saved selection, held refresh and Undo', async () => {
      await unmount(); const priorFetch = window.fetch, priorSocket = window.WebSocket;
      const stamp = new Date(fixedNow - 120000).toISOString(), dates = ['2027-10-09', '2027-10-16', '2027-10-23', '2027-10-30'];
      const snapshot: MarketSnapshot = { id: 'expiry-window', source: 'Tastytrade', underlying: 'SPY', spot: 100, spotAsOf: stamp, retrievedAt: stamp, availableExpiries: dates, contracts: dates.flatMap(date => Array.from({ length: 25 }, (_, index) => 88 + index).flatMap(strike => (['call', 'put'] as const).map(type => ({ contractId: `SPY   ${date.slice(2).replaceAll('-', '')}${type === 'call' ? 'C' : 'P'}${String(strike * 1000).padStart(8, '0')}`, type, strike, expiry: `${date}T20:00:00.000Z`, multiplier: 100 as const, bid: 2, ask: 3, iv: .2, quoteAsOf: stamp })))) };
      const seedSnapshot = { ...snapshot, contracts: snapshot.contracts.filter(c => dates.slice(0, 2).includes(c.expiry.slice(0, 10))) };
      const seed = { id: 'expiry-seed', title: 'Expiry fixture', revision: 1, createdAt: stamp, updatedAt: stamp, state: createMarketStrategy('bull-call', seedSnapshot), snapshot: seedSnapshot };
      let requestedDates: string[] = [], calls = 0, activeSnapshot = seedSnapshot, saved: typeof seed | undefined;
      window.WebSocket = class { close() {} } as unknown as typeof WebSocket;
      window.fetch = (async (url, init) => {
        if (url === '/api/bootstrap') return Response.json({ session: { label: 'Expiry test', local: true, recoveryKey: 'disabled-in-test' } });
        if (url === '/api/strategies' && init?.method === 'POST') {
          const body = JSON.parse(String(init.body)); saved = { ...seed, id: 'wide-saved', title: body.title, state: body.state, snapshot: activeSnapshot };
          return Response.json({ record: saved }, { status: 201 });
        }
        if (url === '/api/strategies') return Response.json({ strategies: saved ? [seed, saved] : [seed] });
        if (url === '/api/strategies/expiry-seed') return Response.json({ record: seed });
        if (url === '/api/strategies/wide-saved') return Response.json({ record: saved });
        if (String(url).startsWith('/api/chain?')) {
          const query = new URL(String(url), location.origin).searchParams;
          requestedDates = query.get('expiries')?.split(',') ?? dates; calls++;
          if (query.has('retain')) assert(query.get('retain')!.split(',').length === 8, 'Refresh omitted held or excluded contracts');
          activeSnapshot = { ...snapshot, id: `expiry-${calls}`, contracts: snapshot.contracts.filter(c => requestedDates.includes(c.expiry.slice(0, 10))).map(c => query.has('retain') ? { ...c, bid: 4, ask: 5 } : c) };
          return Response.json({ snapshot: activeSnapshot });
        }
        throw new Error('Unexpected expiry test request');
      }) as typeof fetch;
      const waitFor = async (check: () => boolean, step = 'Expiry workflow') => { for (let i = 0; i < 400 && !check(); i++) await settleTimers(); assert(check(), `${step} did not settle: ${fixture.querySelector('[role="alert"]')?.textContent ?? ''}`) };
      const rebuild = () => [...fixture.querySelectorAll('button')].find(button => button.textContent === 'Rebuild template with these expiries')!;
      const inputs = () => [...fixture.querySelectorAll<HTMLInputElement>('.leg-list input:not([type="checkbox"]), .leg-list select')].map(input => input.value).join();
      try {
        root = createRoot(fixture); await act(async () => root!.render(<App />));
        await waitFor(() => !!fixture.querySelector('option[value="expiry-seed"]'));
        await change('Saved positions', seed.id); await click('Load');
        await waitFor(() => !!fixture.querySelector('[aria-label="Chain expiry 1"]'));
        await change('Chain expiry 1', ''); assert(rebuild().disabled, 'Missing first date was allowed');
        await change('Chain expiry 1', dates[0]); await change('Chain expiry 2', '');
        assert(!rebuild().disabled, 'Single-date rebuild is disabled');
        const original = inputs();
        await click('Rebuild template with these expiries');
        await waitFor(() => calls === 1 && !rebuild().disabled);
        assert(requestedDates.join() === dates[0] && inputs() === original, 'Single-date rebuild changed contracts or sent a blank expiry');
        assert([...fixture.querySelectorAll('.leg-list [aria-label="Expiry"]')].every(select => select.querySelectorAll('option').length === 1), 'Rebuild retained second-date contracts');
        await act(async () => fixture.querySelector<HTMLButtonElement>('[aria-label="Undo"]')!.click());
        assert([...fixture.querySelectorAll('.leg-list [aria-label="Expiry"]')].every(select => select.querySelectorAll('option').length === 2), 'Undo did not restore the two-date catalog');
        await change('Chain expiry 2', dates[0]); assert(rebuild().disabled, 'Duplicate dates were allowed');
        await change('Chain expiry 2', dates[1]); await click('Rebuild template with these expiries');
        await waitFor(() => calls === 2 && !rebuild().disabled);
        assert(requestedDates.join() === dates.slice(0, 2).join(), 'Two-date request lost an expiry');
        const calendar = [...fixture.querySelectorAll<HTMLButtonElement>('.template-list button')].find(button => button.querySelector('span')?.textContent === 'Call calendar');
        assert(calendar, 'Missing calendar template'); await act(async () => calendar.click());
        assert(calendar.getAttribute('aria-pressed') === 'true' && new Set([...fixture.querySelectorAll('.leg-list [aria-label="Expiry"]')].map(select => (select as unknown as HTMLSelectElement).value)).size === 2, 'Calendar did not activate two distinct expiries');
        const held = inputs(); await change('Chain expiry 2', ''); await click('Rebuild template with these expiries');
        await waitFor(() => calls === 3 && !!fixture.querySelector('[role="alert"]'));
        assert(inputs() === held, 'Failed calendar rebuild changed the held construction');
        for (let index = 1; index < 4; index++) await change(`Chain expiry ${index + 1}`, dates[index]);
        await change('Chain expiry 4', dates[2]); assert(rebuild().disabled, 'Duplicate optional dates were allowed');
        await change('Chain expiry 4', dates[3]); await click('Rebuild template with these expiries');
        await waitFor(() => calls === 4 && !rebuild().disabled);
        assert(requestedDates.join() === dates.join(), 'Four-date request lost an expiry');
        assert(fixture.querySelectorAll('.option-chain-table tbody tr').length === 200, 'Contract table truncated the four-date window');
        assert(fixture.querySelector('[aria-label="Strike activity expiry"]')?.querySelectorAll('option').length === 4, 'Activity omitted later expiries');
        await change('Target leg', 'add-long');
        for (const date of dates.slice(1)) {
          for (const strike of [90, 95]) {
            const contract = snapshot.contracts.find(c => c.expiry.startsWith(date) && c.strike === strike && c.type === 'put')!;
            const add = fixture.querySelector<HTMLButtonElement>(`[aria-label="Add ${contract.contractId} as long leg"]`);
            assert(add && !add.disabled, 'Quoted construction stopped before eight legs');
            await act(async () => add.click());
          }
        }
        assert(fixture.querySelectorAll('.leg-row').length === 8, 'Eight-leg construction was not retained');
        assert(new Set([...fixture.querySelectorAll('.leg-list [aria-label="Expiry"]')].map(select => (select as unknown as HTMLSelectElement).value)).size === 4, 'Construction lost one of four expiries');
        assert([...fixture.querySelectorAll<HTMLButtonElement>('.add-leg')].some(button => button.textContent?.includes('Add leg') && button.disabled), 'Editor permitted a ninth leg');
        assert([...fixture.querySelectorAll<HTMLButtonElement>('.option-chain-table button')].filter(button => button.getAttribute('aria-label')?.startsWith('Add ')).every(button => button.disabled), 'Chain permitted a ninth leg');
        await act(async () => fixture.querySelector<HTMLButtonElement>('[aria-label="Undo"]')!.click());
        assert(fixture.querySelectorAll('.leg-row').length === 7, 'Undo did not remove only the eighth leg');
        const lastContract = snapshot.contracts.find(c => c.expiry.startsWith(dates[3]) && c.strike === 95 && c.type === 'put')!;
        await act(async () => fixture.querySelector<HTMLButtonElement>(`[aria-label="Add ${lastContract.contractId} as long leg"]`)!.click());
        await click('Keep entry costs');
        await act(async () => fixture.querySelector<HTMLInputElement>('.leg-list input[type="checkbox"]')!.click());
        const heldInputs = inputs();
        await click('Freeze comparison');
        await waitFor(() => !!fixture.querySelector('path.proposal-line')?.getAttribute('d'), 'Wide comparison');
        await click('Save as new'); await waitFor(() => !!saved && (fixture.querySelector('[aria-label="Saved positions"]') as unknown as HTMLSelectElement).value === saved.id, 'Wide save');
        assert(saved!.state.legs.length === 8 && saved!.state.excludedLegIds?.length === 1 && saved!.state.pricing?.entryMode === 'fixed', 'Saving lost wide holdings, selection or fixed costs');
        await click('Include all legs'); await click('Load');
        await waitFor(() => !!fixture.querySelector('.leg-list input[type="checkbox"]:not(:checked)'), 'Wide reopen');
        assert(inputs() === heldInputs, 'Reopening changed the eight-leg construction');
        await click('Refresh prices'); await waitFor(() => fixture.querySelector('.contract-quote')?.textContent?.includes('Bid $4.00') === true, 'Wide refresh');
        assert(inputs() === heldInputs && fixture.querySelectorAll('.leg-row').length === 8 && fixture.querySelector('.leg-list input[type="checkbox"]:not(:checked)'), 'Refresh lost wide inventory, exclusion or held costs');
        await act(async () => fixture.querySelector<HTMLButtonElement>('[aria-label="Undo"]')!.click());
        assert(inputs() === heldInputs && fixture.querySelector('.contract-quote')?.textContent?.includes('Bid $2.00'), 'Refresh Undo failed to restore quotes and held construction');
      } finally { await unmount(); window.fetch = priorFetch; window.WebSocket = priorSocket }
    });
    await test('Workspace captures preserve holdings and scenarios, group automatic Undo and reject late edits', async () => {
      await unmount(); const priorFetch = window.fetch, originalSocket = window.WebSocket, originalWorker = window.Worker;
      let socket: { onmessage?: (event: { data: string }) => void } | undefined, captures = 0, chainRequests = 0;
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
          chainRequests++;
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
      const waitFor = async (check: () => boolean, stage: string) => {
        for (let i = 0; i < 800 && !check(); i++) await settleTimers();
        assert(check(), `Workspace ${stage} did not reach expected state; chain requests=${chainRequests}; captures=${captures}; errors=${[...fixture.querySelectorAll('[role="alert"], .calculation-error, .workspace-error')].map(node => node.textContent).join(' | ')}; comparison=${fixture.querySelector('.comparison-banner')?.textContent}; chart=${fixture.querySelector('#workspace-chart')?.textContent}`);
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
        await waitFor(() => !!fixture.querySelector('.import-preview'), 'import preview');
        assert(!importedWorkspace, 'File selection wrote a saved position');
        await click('Import as new saved position');
        await waitFor(() => !!fixture.querySelector('option[value="imported-workspace"]'), 'imported saved list');
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
        await waitFor(() => !!fixture.querySelector('path.proposal-line')?.getAttribute('d'), 'freeze comparison curve');
        const baselinePath = fixture.querySelector('path.proposal-line')!.getAttribute('d');
        assert(fixture.querySelector<HTMLButtonElement>('[aria-label="Undo"]')!.disabled === undoDisabled, 'Freezing comparison changed Undo');
        await change('Contracts', '2');
        await waitFor(() => !!fixture.querySelector('path.proposal-line')?.getAttribute('d'), 'edited quantity comparison');
        assert(fixture.querySelector('.comparison-banner details')!.textContent === baselineText, 'Manual edit mutated frozen baseline');
        await undo();
        await waitFor(() => !!fixture.querySelector('path.proposal-line')?.getAttribute('d'), 'quantity Undo comparison');
        assert(fixture.querySelector('path.proposal-line')!.getAttribute('d') === baselinePath, 'Restored position changed baseline curve');
        const originalDate = field('Scenario date UTC').value;
        await change('Scenario time', '500');
        await waitFor(() => fixture.querySelector('.comparison-banner')!.textContent!.includes('overlay hidden'), 'incompatible date guard');
        assert(!fixture.querySelector('path.proposal-line'), 'Incompatible scenario retained overlay');
        await undo();
        assert(field('Scenario date UTC').value === originalDate, 'Scenario Undo failed');
        await waitFor(() => !!fixture.querySelector('path.proposal-line')?.getAttribute('d'), 'scenario Undo comparison');
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
        await click('Use real prices'); await waitFor(() => !!auto(), 'first quote load');
        assert(termsText()?.includes('Supported contract terms are unavailable'), 'Quotes without recorded terms inferred exercise style');
        const comparison = () => fixture.querySelector<HTMLElement>('[aria-label="Quote and model comparison"]');
        assert(comparison(), 'Quote/model comparison missing');
        const expectedPnl = calculateStrategy(createMarketStrategy('long-call', snapshot as MarketSnapshot)).scenarioPnl;
        const usd = (value: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
        await waitFor(() => comparison()!.querySelectorAll('dd')[1]?.textContent === usd(expectedPnl), 'initial quoted model P/L');
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
        await waitFor(() => fixture.querySelector('.metric-ribbon')?.textContent?.includes('$100') === true, 'stock-only ribbon');
        assert(!fixture.querySelector('.expiry-reference') && !fixture.querySelector('[aria-label="Scenario time"]'), 'Stock-only view invented an option expiry');
        assert(fixture.textContent?.includes('Stock-only') && fixture.textContent?.includes('No option expiry'), 'Stock-only scope is not visible');
        await click('Table'); await waitFor(() => !!fixture.querySelector('[aria-label="Scenario P/L and Greeks"]'), 'stock-only table');
        await click('Curve');
        await click('Freeze comparison');
        await commitField('Shares', '60');
        await waitFor(() => !!fixture.querySelector('.proposal-line')?.getAttribute('d'), 'stock-only comparison');
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
        await waitFor(() => !auto().disabled, 'automatic capture eligible'); await act(async () => auto().click());
        await waitFor(() => captures >= 2 && field('Scenario spot').value === '104', 'second automatic capture');
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
        await waitFor(() => comparison()!.querySelectorAll('dd')[1]?.textContent === usd(changedPnl), 'changed scenario P/L');
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
    await test('Index streams display levels and require dated index, option and IV coverage', async () => {
      await unmount(); const originalSocket = window.WebSocket;
      let socket: { onmessage?: (event: { data: string }) => void } | undefined;
      window.WebSocket = class { constructor() { socket = this } onmessage?: (event: { data: string }) => void; close() {} } as unknown as typeof WebSocket;
      const emit = async (value: unknown) => { await act(async () => socket?.onmessage?.({ data: JSON.stringify(value) })) };
      const contract = 'XSP   261009C00768000', receivedAt = new Date(fixedNow).toISOString();
      const capture = () => [...fixture.querySelectorAll('button')].find(button => button.textContent === 'Capture for analysis')!;
      try {
        root = createRoot(fixture); await act(async () => root!.render(<StreamedMarks snapshot={{ id: 'index-ui', underlying: 'XSP', underlyingKind: 'cash-index' } as any} contracts={[contract]} captureEnabled reviewEnabled onCapture={() => {}} onReview={() => {}} automatic={false} onAutomatic={() => {}} onTick={async () => {}} />));
        await click('Connect live feed'); await emit({ type: 'status', state: 'connected', message: 'Connected' });
        await emit({ type: 'index', contractId: 'XSP', price: 768.25, time: fixedNow, receivedAt });
        assert(fixture.textContent?.includes('Index level 768.25') && fixture.textContent.includes('dxFeed Trade timestamp'), 'Index event was not displayed with its source semantics');
        assert(capture().disabled, 'Index alone admitted without option coverage');
        await emit({ type: 'quote', contractId: contract, bid: 2, ask: 3, bidTime: fixedNow, askTime: fixedNow, receivedAt });
        await emit({ type: 'greeks', contractId: contract, iv: .2, time: fixedNow, receivedAt });
        assert(!capture().disabled, 'Complete index capture was not eligible');
        await emit({ type: 'status', state: 'reconnecting', message: 'Retry' });
        assert(capture().disabled && !fixture.textContent?.includes('Index level 768.25'), 'Reconnect retained index marks');
        await emit({ type: 'status', state: 'connected', message: 'Connected' });
        await emit({ type: 'quote', contractId: 'XSP', bid: 768, ask: 769, bidTime: fixedNow, askTime: fixedNow, receivedAt });
        assert(capture().disabled && fixture.textContent?.includes('Feed unavailable'), 'Index accepted an equity-shaped quote');
      } finally { await unmount(); window.WebSocket = originalSocket }
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
    await unmount(); window.fetch = originalFetch; globalThis.Date = originalDate; Date.now = originalNow
    if (priorAct === undefined) delete environment.IS_REACT_ACT_ENVIRONMENT; else environment.IS_REACT_ACT_ENVIRONMENT = priorAct
    output.textContent += `TOTAL ${passed} passed, ${failed} failed. Globals restored; no provider calls.\n`; button.disabled = false
  }
}
