import { useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { calculateStrategy, createStrategy, createMarketStrategy, marketLeg, evaluateScenario, sampleContractId, LAB_SAMPLE_EXPIRIES, type MarketSnapshot, type MarketContract, type StrategyState, type TemplateId } from './options'
import { assertLabPosition, assertWorkbenchPosition, createLabPosition, labScenarios, labThesisFit, readLabDraft, labFamily } from './scenario-lab-model'
import { validatedSnapshot } from './market-snapshot'
import { SymbolSearch } from './SymbolSearch'
import { OptionChainTable } from './OptionChainTable'
import { LabOptimizer } from './scenario-lab-optimizer'
import { LabAnalysisChart } from './lab-analysis-chart'
import { LabStrategyPicker } from './lab-strategy-picker'
import './scenario-lab.css'

const dollars = (n: number | null) => n === null ? 'Unbounded' : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(n)
const shortDate = (date: string) => new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
const draftKey = 'argus-scenario-lab-prototype-v1'
function ScenarioLab() {
  const [position, setPosition] = useState(createLabPosition)
  const [snapshot, setSnapshot] = useState<MarketSnapshot | null>(null)
  const [symbol, setSymbol] = useState('SPY')
  const [pending, setPending] = useState(false)
  const request = useRef(0)
  const revision = useRef(0)
  const [thesis, setThesis] = useState('I expect a modest rise over the next month.')
  const [selected, setSelected] = useState(0)
  const [inspection, setInspection] = useState<Pick<StrategyState, 'scenarioSpot' | 'scenarioDate' | 'ivShift'> | null>(null)
  const [notice, setNotice] = useState('')
  const [noticeArea, setNoticeArea] = useState<'header' | 'market' | 'position' | 'thesis'>('header')
  const conversation = useRef<HTMLElement>(null)
  const [question, setQuestion] = useState('')
  const [discussion, setDiscussion] = useState(false)
  const [horizon, setHorizon] = useState('')
  const [optimizer, setOptimizer] = useState(false)
  const [library, setLibrary] = useState(false)
  const scenarios = useMemo(() => labScenarios(position, position.scenarioSpot, position.scenarioDate, snapshot ?? undefined), [position, snapshot])
  const scenario = scenarios[selected]
  const activeState = useMemo(() => inspection ? { ...scenario.state, ...inspection } : scenario.state, [scenario.state, inspection])
  const activeName = inspection ? 'Custom inspection' : scenario.name
  const greeks = evaluateScenario(activeState)
  const fit = labThesisFit(position, horizon, snapshot ?? undefined)
  const metrics = calculateStrategy(position)
  const expiry = position.legs[0].expiry
  function update(next: StrategyState, area: 'position' | 'thesis' = 'position') {
    setNoticeArea(area)
    try { assertWorkbenchPosition(next, snapshot ?? undefined) } catch (error) { setNotice((error as Error).message); return false }
    revision.current++
    setPosition(next); setInspection(null); setNotice('Unsaved changes'); setDiscussion(false)
    return true
  }
  function inspect(next: StrategyState) {
    try { assertWorkbenchPosition(next, snapshot ?? undefined) } catch (error) { setNotice((error as Error).message); return }
    setInspection({ scenarioSpot: next.scenarioSpot, scenarioDate: next.scenarioDate, ivShift: next.ivShift }); setDiscussion(false)
  }
  function strike(index: number, value: number) {
    if (snapshot) {
      const leg = position.legs[index], contract = snapshot.contracts.find(c => c.type === leg.type && c.expiry === leg.expiry && c.strike === value)
      if (contract) selectContract(leg.id, contract)
      return
    }
    update({ ...position, legs: position.legs.map((leg, i) => i === index ? { ...leg, strike: value, contractId: sampleContractId(leg.type, value, leg.expiry) } : leg) })
  }
  function quantity(index: number, value: number) {
    const scale = value / position.legs[index].contracts
    update({ ...position, legs: position.legs.map(leg => ({ ...leg, contracts: leg.contracts * scale })), ...(position.stock ? { stock: { ...position.stock, shares: position.stock.shares * scale } } : {}) })
  }
  function chooseStrategy(id: TemplateId) {
    if (snapshot) {
      try {
        const template = createMarketStrategy(id, snapshot, position.pricing!.basis)
        if (!update({ ...template, scenarioSpot: position.scenarioSpot, scenarioDate: position.scenarioDate, feeAllowance: position.feeAllowance })) return
        setSelected(0); setLibrary(false); setNotice('Quoted template applied; entry estimates replaced, thesis preserved.')
      } catch (error) { setNotice((error as Error).message) }
      return
    }
    const template = createStrategy(id)
    if (!update({ ...template, scenarioSpot: position.scenarioSpot, scenarioDate: position.scenarioDate, ivShift: position.ivShift, feeAllowance: position.feeAllowance,
      legs: template.legs.map(leg => ({ ...leg, expiry, contractId: sampleContractId(leg.type, leg.strike, expiry) })) })) return
    setSelected(0); setLibrary(false); setNotice('Template applied with illustrative entry premiums; thesis preserved. Not saved.')
  }
  function save() {
    setNoticeArea('header')
    try {
      localStorage.setItem(draftKey, JSON.stringify({ version: 2, horizon, draft: { schemaVersion: 1, state: position, snapshot, title: 'Scenario Lab', thesis, composer: question, savedAt: new Date().toISOString() } }))
      setNotice('Draft and thesis saved in this browser only.')
    } catch { setNotice('Browser storage unavailable. Draft was not saved.') }
  }
  function load() {
    setNoticeArea('header')
    try {
      const raw = localStorage.getItem(draftKey)
      if (!raw) { setNotice('No prototype draft saved in this browser.'); return }
      const restored = readLabDraft(raw), draft = restored.draft
      request.current++; revision.current++; setPending(false); setSnapshot(draft.snapshot); setSymbol(draft.state.underlying)
      setPosition(draft.state); setThesis(draft.thesis); setHorizon(restored.horizon); setQuestion(draft.composer); setSelected(0); setInspection(null); setDiscussion(false); setNotice('Prototype draft restored.')
    } catch { setNotice('Saved prototype draft is invalid; current work is unchanged.') }
  }
  async function loadSymbol(date?: string) {
    if (pending) return
    setNoticeArea('market')
    const ticker = date ? position.underlying : symbol.trim().toUpperCase()
    if (!/^[A-Z]{1,6}$/.test(ticker)) { setNotice('Enter a ticker using 1–6 letters.'); return }
    if (!window.confirm(date ? 'Rebuild the current template for this expiry? Custom legs and quantities are replaced using new quote estimates. Your thesis stays.' : `Load ${ticker}? This replaces the current trade and clears its thesis, target and horizon. Save your draft first if needed.`)) return
    const sequence = ++request.current, before = revision.current
    setPending(true); setNotice('Loading quoted option chain…')
    try {
      const response = await fetch(`/api/chain?${new URLSearchParams({ symbol: ticker, ...(date ? { expiries: date.slice(0, 10) } : {}) })}`, { signal: AbortSignal.timeout(30000) })
      const body = await response.json() as { snapshot?: unknown; error?: { message?: string } }
      if (!response.ok || !body.snapshot) throw new Error(body.error?.message ?? 'Unable to load option prices.')
      const quotes = validatedSnapshot(body.snapshot as MarketSnapshot)
      if (quotes.underlying !== ticker) throw new Error('Quotes do not match the requested symbol.')
      const next = createMarketStrategy(date ? position.id as TemplateId : 'bull-call', quotes)
      if (date) next.scenarioSpot = position.scenarioSpot
      assertWorkbenchPosition(next, quotes)
      if (sequence !== request.current) return
      if (before !== revision.current) throw new Error('Your work changed while quotes loaded. Load again; current work is preserved.')
      revision.current++; setSnapshot(quotes); setPosition(next); setSymbol(ticker); setSelected(0); setInspection(null); setDiscussion(false)
      if (!date) { setThesis(''); setHorizon(''); setQuestion('') }
      setNotice('Dated market quotes loaded. Entry prices are midpoint estimates, not fills. Not saved.')
    } catch (error) { if (sequence === request.current) setNotice((error as Error).message) }
    finally { if (sequence === request.current) setPending(false) }
  }
  function selectContract(id: string, contract: MarketContract) {
    update({ ...position, legs: position.legs.map(leg => leg.id === id ? marketLeg(contract, leg.side, leg.contracts, leg.id, position.pricing!.basis) : leg) })
  }
  if (optimizer) return <LabOptimizer position={position} thesis={thesis} horizon={horizon} onBack={() => setOptimizer(false)} onApply={(state, nextHorizon) => { assertLabPosition(state); update(state); setHorizon(nextHorizon); setSelected(0); setOptimizer(false); setNotice('Synthetic candidate applied to draft; not saved.'); }} />
  return <main className="lab">
    <header className="lab-header"><a className="lab-brand" href="/prototype.html">ARGUS<span> / Workbench</span></a><nav aria-label="Workspace"><span aria-current="page">Workbench</span><button disabled={pending || !!snapshot} title={snapshot ? 'The prototype optimizer supports sample data only.' : undefined} onClick={() => setOptimizer(true)}>Optimize</button></nav><div className="lab-header-right"><span className="lab-badge">{snapshot ? 'DATED MARKET QUOTES' : 'LOCAL · SYNTHETIC'}</span><button onClick={load}>Open draft</button><button className="lab-primary" onClick={save}>Save draft</button></div></header>
    {notice && noticeArea === 'header' && <p className="lab-notice" role="status">{notice}</p>}
    <section className="lab-market" aria-label="Market symbol"><form className="symbol-control" onSubmit={e => { e.preventDefault(); void loadSymbol() }}><label>Symbol<input aria-label="Symbol" value={symbol} maxLength={6} onChange={e => { revision.current++; setSymbol(e.target.value.toUpperCase()) }}/></label><button className="lab-primary" disabled={pending}>{pending ? 'Loading quotes…' : 'Load symbol'}</button><strong>{position.underlying} {dollars(position.spot)}</strong><span>{snapshot ? `${snapshot.source} · dated quote` : 'Illustrative spot · no market quotes loaded'}</span></form><SymbolSearch underlying={position.underlying} onSelect={ticker => { revision.current++; setSymbol(ticker) }} selectionHint="Use Load symbol to replace the trade and reset the thesis. Save your draft first if needed."/><details className="lab-quote-details"><summary>Quote details & loading policy</summary><p>Loading a symbol replaces the trade and resets the thesis. Dated quotes are not streaming prices or guaranteed fills.</p>{snapshot && <p>Spot as of {snapshot.spotAsOf} · retrieved {snapshot.retrievedAt}</p>}</details>{notice && noticeArea === 'market' && <p className="lab-notice" role="status">{notice}</p>}{snapshot && <button onClick={() => { if (!window.confirm('Return to synthetic SPY and replace the current trade and thesis?')) return; request.current++; revision.current++; setPending(false); setSnapshot(null); setPosition(createLabPosition()); setSymbol('SPY'); setThesis('I expect a modest rise over the next month.'); setHorizon(''); setQuestion(''); setInspection(null); setSelected(0); setDiscussion(false); setNotice('Synthetic example restored.') }}>Sample mode</button>}</section>
    <section className="lab-thesis" aria-label="Your trading thesis"><div className="lab-thesis-fields"><label className="lab-thesis-copy">My thesis<input id="thesis" value={thesis} maxLength={12000} placeholder="What do you expect, and why?" onChange={e => { revision.current++; setThesis(e.target.value); setNotice('Unsaved changes'); setDiscussion(false) }} /></label><label>Target price $<input aria-label="Target price" type="number" min={snapshot ? .001 : 80} max={snapshot ? 1000000 : 120} step="0.5" value={position.scenarioSpot} onChange={e => update({ ...position, scenarioSpot: e.target.valueAsNumber }, 'thesis')} /></label><label>Thesis horizon<input aria-label="Thesis horizon" type="date" min={position.valuationTimestamp.slice(0, 10)} value={horizon} onChange={e => { revision.current++; setHorizon(e.target.value); setNotice('Unsaved changes'); setDiscussion(false) }} /></label></div></section>
    {notice && noticeArea === 'thesis' && <p className="lab-notice" role="status">{notice}</p>}
    <section className="lab-fit" aria-label="Trade fit guidance"><div><h2>{fit.status === 'missing' ? 'When does your view need to play out?' : fit.status === 'after-expiry' ? 'This trade expires before your thesis horizon.' : fit.status === 'invalid' ? `Choose a valid horizon on or after ${shortDate(position.valuationTimestamp)}.` : `${dollars(fit.pnl)} modeled at your target and horizon.`}</h2><p>{fit.status === 'calculated' ? 'A conditional outcome, not proof of the thesis. Test what happens if you are early, late or wrong.' : 'Set price and time explicitly. The thesis horizon and trade expiry are separate.'}</p></div><button disabled={fit.status !== 'calculated'} onClick={() => { inspect({ ...position, scenarioDate: `${horizon}T20:00:00.000Z` }); setSelected(0) }}>Show thesis scenario</button><button className="lab-primary" disabled={pending || !!snapshot} title={snapshot ? 'Sample optimizer is unavailable for market quotes.' : undefined} onClick={() => setOptimizer(true)}>Optimize · sample</button></section>
    <div className="lab-workspace"><div className="lab-main">
      <section className="lab-position"><div className="lab-trade-heading"><div><h1>{snapshot ? position.name : labFamily(position)} <span>{position.legs.length} option {position.legs.length === 1 ? 'leg' : 'legs'}{position.stock ? ' + shares' : ''}</span></h1></div><button onClick={() => setLibrary(true)}>Change strategy</button><label>Trade expiry<select aria-label="Workbench expiry" disabled={pending} value={snapshot ? expiry.slice(0, 10) : expiry} onChange={e => { const date = e.target.value; if (snapshot) { void loadSymbol(date); return } update({ ...position, scenarioDate: position.scenarioDate > date ? date : position.scenarioDate, legs: position.legs.map(leg => ({ ...leg, expiry: date, contractId: sampleContractId(leg.type, leg.strike, date) })) }) }}>{(snapshot ? snapshot.availableExpiries : LAB_SAMPLE_EXPIRIES).map(date => <option key={date} value={date}>{shortDate(date)} {date.slice(0, 4)}</option>)}</select></label></div><div className="lab-metrics">{[[metrics.entryLabel, metrics.entryAmount], ['Expiry max loss', metrics.maxLoss], ['Expiry max profit', metrics.maxProfit]].map(([name, value]) => <div key={String(name)}><span>{name}</span><strong>{dollars(value as number | null)}</strong></div>)}<div><span>Breakeven at expiry</span><strong>{metrics.breakevens.map(dollars).join(' / ') || '—'}</strong></div></div></section>
      <section className="lab-tray" aria-label="Scenario comparison"><div className="lab-tray-intro"><span className="lab-label">TEST THE THESIS</span><h2>One trade. Different outcomes.</h2></div>{scenarios.map((item, i) => <button className="lab-scenario" key={item.name} aria-pressed={selected === i && !inspection} onClick={() => { setSelected(i); setInspection(null); setDiscussion(false) }}><header><strong>{item.name}</strong><b className={item.pnl < 0 ? 'lab-negative' : 'lab-positive'}>{dollars(item.pnl)}</b></header><small>{dollars(item.state.scenarioSpot)} · {shortDate(item.state.scenarioDate)} · {snapshot ? `IV shift ${(position.ivShift * 100).toFixed(1)} pts` : `${((position.legs[0].iv + position.ivShift) * 100).toFixed(0)}% IV`}</small></button>)}<p className="lab-caption">Conditional outcomes, not assigned probabilities. “Later” means expiry, never after it.</p></section>
      {notice && noticeArea === 'position' && <p className="lab-notice" role="status">{notice}</p>}
      <LabAnalysisChart thesisTarget={position.scenarioSpot} key={`chart-${snapshot?.id ?? 'sample'}`} snapshot={snapshot ?? undefined} state={activeState} onChange={inspect} onPositionChange={next => update({ ...position, legs: next.legs })} onAsk={() => { setQuestion('Explain this chart and challenge the trade assumptions.'); setDiscussion(true); conversation.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }) }}/>
      <p className="lab-caption">Chart price, date and IV inspect a scenario without changing your thesis. {snapshot ? 'Dragging strikes replaces contracts and re-estimates entry from this quote window.' : 'Dragging strikes edits the hypothetical position; entry premiums stay fixed.'}</p>
      <section className="lab-analysis" aria-label="Selected scenario analysis"><div className="lab-selected-summary"><strong>{activeName} <b className={greeks.pnl < 0 ? 'lab-negative' : 'lab-positive'}>{dollars(greeks.pnl)}</b></strong><span>At {dollars(activeState.scenarioSpot)} · {shortDate(activeState.scenarioDate)} · {snapshot ? `IV shift ${(activeState.ivShift * 100).toFixed(1)} pts` : `IV ${((position.legs[0].iv + activeState.ivShift) * 100).toFixed(0)}%`}</span></div><dl className="lab-greeks">{([['Delta', greeks.delta, 'USD / $1 move'], ['Gamma', greeks.gamma, 'delta / $1 move'], ['Theta', greeks.theta, 'USD / day'], ['Vega', greeks.vega, 'USD / IV point'], ['Rho', greeks.rho, 'USD / rate point']] as const).map(([name, value, unit]) => <div key={name}><dt>{name}</dt><dd>{value.toFixed(2)}</dd><small>{unit}</small></div>)}</dl></section>
      <details className="lab-leg-editor" open><summary>Position details <span>{position.legs.length} legs · edit strikes, size and entry assumptions</span></summary><div className="lab-legs">{position.legs.map((leg, i) => <div className="lab-leg" key={leg.id}><span className={leg.side === 'short' ? 'lab-sell' : 'lab-buy'}>{leg.side === 'short' ? 'SELL' : 'BUY'}</span><strong>{leg.type === 'call' ? 'Call' : 'Put'}</strong><label>Strike<select aria-label={`Leg ${i + 1} ${leg.side} ${leg.type} strike`} value={leg.strike} onChange={e => strike(i, Number(e.target.value))}>{(snapshot ? snapshot.contracts.filter(c => c.type === leg.type && c.expiry === leg.expiry).map(c => c.strike).sort((a, b) => a - b) : Array.from({ length: 41 }, (_, j) => j + 80)).map(n => <option key={n}>{n}</option>)}</select></label><label>Qty<input aria-label={`Leg ${i + 1} quantity`} type="number" min="1" step="1" value={leg.contracts} onChange={e => quantity(i, Number(e.target.value))}/></label><label>Entry $<input aria-label={`Leg ${i + 1} entry premium`} readOnly={!!snapshot} title={snapshot ? 'Midpoint quote estimate; select a different quoted contract to change it.' : undefined} type="number" min="0" step="0.05" value={leg.entryPrice} onChange={e => update({ ...position, legs: position.legs.map((l, j) => i === j ? { ...l, entryPrice: e.target.valueAsNumber } : l) })}/></label><small>{shortDate(leg.expiry)}</small></div>)}{position.stock && <p>{position.stock.shares} {position.underlying} shares · entry {dollars(position.stock.entryPrice)} per share</p>}<p className="lab-caption">{snapshot ? 'Size edits scale the whole structure. Contract replacements use dated midpoint estimates; entry premiums are read-only. No order is submitted.' : 'Size edits scale the whole structure. Premiums remain fixed when strikes or expiry change; they are not refreshed quotes.'}</p></div></details>
      <details className="lab-evidence"><summary>Pricing assumptions & costs</summary><div className="lab-evidence-grid"><div><label>Total cost allowance $ <input aria-label="Total cost allowance" type="number" min="0" max="10000" step="1" value={position.feeAllowance ?? 0} onChange={e => update({ ...position, feeAllowance: e.target.valueAsNumber })}/></label><p>Deducted once. Does not scale with quantity. Not a broker fee estimate.</p></div><p>European model · {snapshot ? 'contract-specific quoted IV' : 'base IV 22%'} · assumed rate {(position.rate * 100).toFixed(1)}% · assumed yield {(position.dividendYield * 100).toFixed(1)}%. {snapshot ? 'Dated midpoint entries, not execution prices. Not a model of early exercise or assignment.' : 'No live bid/ask, quote age, liquidity or market evidence.'} Expiry bounds include costs and shares, not early-assignment cashflows.</p></div></details>
      {snapshot && <OptionChainTable recoveryHint="Save your draft before editing if you want to restore it later." key={snapshot.id} state={position} snapshot={snapshot} comparisonPending={true} onDiscussActivity={() => {}} onCompare={() => {}} onSelect={selectContract} onAdd={(contractId, side) => { const contract = snapshot.contracts.find(c => c.contractId === contractId); if (contract) update({ ...position, name: 'Custom quoted strategy', legs: [...position.legs, marketLeg(contract, side, 1, crypto.randomUUID(), position.pricing!.basis)] }) }}/>}
    </div><aside className="lab-side" aria-label="Thesis testing and conversation"><section className="lab-sparring" ref={conversation}><header><span className="lab-label">ARGUS / SPARRING PARTNER</span><small>CONTEXT PREVIEW</small></header><h2>Challenge this trade</h2><p>Context preview only · AI is not connected.</p><div className="lab-prompts">{['What would invalidate my thesis?', 'What if I am right, but late?', 'Where is this trade fragile?'].map(text => <button key={text} onClick={() => { setQuestion(text); setDiscussion(true) }}>{text}<span aria-hidden="true">↗</span></button>)}</div><label className="lab-question-label">Ask about this scenario<textarea aria-label="Question about selected scenario" placeholder="Challenge an assumption…" value={question} maxLength={12000} onChange={e => { revision.current++; setQuestion(e.target.value); setDiscussion(false) }}/></label><button className="lab-primary" onClick={() => setDiscussion(!discussion)} aria-expanded={discussion}>Preview context</button><small>No AI request is sent in this prototype.</small>{discussion && <div className="lab-discussion"><strong>Conversation handoff · not connected</strong><p>{question || 'What should I understand about this scenario?'}</p><p>Thesis: {thesis || 'Not set'}. Target: {dollars(position.scenarioSpot)}; horizon: {horizon || 'Not set'}. Inspecting {activeName}, {dollars(activeState.scenarioSpot)}, {shortDate(activeState.scenarioDate)}, {snapshot ? `IV shift ${(activeState.ivShift * 100).toFixed(1)} pts` : `IV ${((position.legs[0].iv + activeState.ivShift) * 100).toFixed(0)}%`}, calculated P/L {dollars(greeks.pnl)}.</p></div>}</section>
    </aside></div>
    <footer className="lab-footer"><span>{snapshot ? 'Dated quote snapshot · no broker order connection' : 'Synthetic example · no market or broker connection'}</span><span>Local draft only · six interactive strategy families · no assignment simulation</span></footer>
    {library && <LabStrategyPicker market={!!snapshot} onClose={() => setLibrary(false)} onSelect={chooseStrategy}/>}
  </main>
}

createRoot(document.getElementById('root')!).render(<ScenarioLab />)
