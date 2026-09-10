import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { calculateStrategy, createStrategy, evaluateScenario, sampleContractId, LAB_SAMPLE_EXPIRIES, type StrategyState, type TemplateId } from './options'
import { assertLabPosition, createLabPosition, labScenarios, labThesisFit, readLabDraft, labFamily } from './scenario-lab-model'
import { LabOptimizer } from './scenario-lab-optimizer'
import { LabAnalysisChart } from './lab-analysis-chart'
import { LabStrategyPicker } from './lab-strategy-picker'
import './scenario-lab.css'

const dollars = (n: number | null) => n === null ? 'Unbounded' : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(n)
const shortDate = (date: string) => new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
const draftKey = 'argus-scenario-lab-prototype-v1'
function ScenarioLab() {
  const [position, setPosition] = useState(createLabPosition)
  const [thesis, setThesis] = useState('I expect a modest rise over the next month.')
  const [selected, setSelected] = useState(0)
  const [inspection, setInspection] = useState<{ spot: number; date: string } | null>(null)
  const [notice, setNotice] = useState('')
  const [question, setQuestion] = useState('')
  const [discussion, setDiscussion] = useState(false)
  const [horizon, setHorizon] = useState('')
  const [optimizer, setOptimizer] = useState(false)
  const [library, setLibrary] = useState(false)
  const scenarios = labScenarios(position, position.scenarioSpot, position.scenarioDate)
  const scenario = scenarios[selected]
  const activeState = inspection ? { ...scenario.state, scenarioSpot: inspection.spot, scenarioDate: inspection.date } : scenario.state
  const activeName = inspection ? 'Custom inspection' : scenario.name
  const greeks = evaluateScenario(activeState)
  const fit = labThesisFit(position, horizon)
  const metrics = calculateStrategy(position)
  const expiry = position.legs[0].expiry
  function update(next: StrategyState) {
    try { assertLabPosition(next) } catch (error) { setNotice((error as Error).message); return false }
    setPosition(next); setInspection(null); setNotice('Unsaved changes'); setDiscussion(false)
    return true
  }
  function inspect(next: StrategyState) {
    try { assertLabPosition(next) } catch (error) { setNotice((error as Error).message); return }
    setInspection({ spot: next.scenarioSpot, date: next.scenarioDate }); setDiscussion(false)
  }
  function strike(index: number, value: number) {
    update({ ...position, legs: position.legs.map((leg, i) => i === index ? { ...leg, strike: value, contractId: sampleContractId(leg.type, value, leg.expiry) } : leg) })
  }
  function quantity(index: number, value: number) {
    const scale = value / position.legs[index].contracts
    update({ ...position, legs: position.legs.map(leg => ({ ...leg, contracts: leg.contracts * scale })), ...(position.stock ? { stock: { ...position.stock, shares: position.stock.shares * scale } } : {}) })
  }
  function chooseStrategy(id: TemplateId) {
    const template = createStrategy(id)
    if (!update({ ...template, scenarioSpot: position.scenarioSpot, scenarioDate: position.scenarioDate, ivShift: position.ivShift, feeAllowance: position.feeAllowance,
      legs: template.legs.map(leg => ({ ...leg, expiry, contractId: sampleContractId(leg.type, leg.strike, expiry) })) })) return
    setSelected(0); setLibrary(false); setNotice('Template applied with illustrative entry premiums; thesis preserved. Not saved.')
  }
  function save() {
    try {
      localStorage.setItem(draftKey, JSON.stringify({ version: 2, horizon, draft: { schemaVersion: 1, state: position, snapshot: null, title: 'Scenario Lab', thesis, composer: question, savedAt: new Date().toISOString() } }))
      setNotice('Draft and thesis saved in this browser only.')
    } catch { setNotice('Browser storage unavailable. Draft was not saved.') }
  }
  function load() {
    try {
      const raw = localStorage.getItem(draftKey)
      if (!raw) { setNotice('No prototype draft saved in this browser.'); return }
      const restored = readLabDraft(raw), draft = restored.draft
      setPosition(draft.state); setThesis(draft.thesis); setHorizon(restored.horizon); setQuestion(draft.composer); setSelected(0); setInspection(null); setDiscussion(false); setNotice('Prototype draft restored.')
    } catch { setNotice('Saved prototype draft is invalid; current work is unchanged.') }
  }
  if (optimizer) return <LabOptimizer position={position} thesis={thesis} horizon={horizon} onBack={() => setOptimizer(false)} onApply={(state, nextHorizon) => { assertLabPosition(state); update(state); setHorizon(nextHorizon); setSelected(0); setOptimizer(false); setNotice('Synthetic candidate applied to draft; not saved.'); }} />
  return <main className="lab">
    <header className="lab-header"><a className="lab-brand" href="/prototype.html">ARGUS<span> / Workbench</span></a><nav aria-label="Workspace"><span aria-current="page">Workbench</span><button onClick={() => setOptimizer(true)}>Optimize</button></nav><div className="lab-header-right"><span className="lab-badge">LOCAL · SYNTHETIC</span><button onClick={load}>Open draft</button><button className="lab-primary" onClick={save}>Save draft</button></div></header>
    <section className="lab-thesis" aria-label="Your trading thesis"><div className="lab-thesis-title"><span className="lab-label">START WITH YOUR VIEW</span><span>SPY <b>$100.00</b> <small>Illustrative spot</small></span></div><div className="lab-thesis-fields"><label className="lab-thesis-copy">My thesis<input id="thesis" value={thesis} maxLength={12000} placeholder="What do you expect, and why?" onChange={e => { setThesis(e.target.value); setNotice('Unsaved changes'); setDiscussion(false) }} /></label><label>Target price $<input aria-label="Target price" type="number" min="80" max="120" step="0.5" value={position.scenarioSpot} onChange={e => update({ ...position, scenarioSpot: e.target.valueAsNumber })} /></label><label>Thesis horizon<input aria-label="Thesis horizon" type="date" min={position.valuationTimestamp.slice(0, 10)} value={horizon} onChange={e => { setHorizon(e.target.value); setNotice('Unsaved changes'); setDiscussion(false) }} /></label></div></section>
    <section className="lab-fit" aria-label="Trade fit guidance"><div><span className="lab-label">THESIS CHECK</span><h2>{fit.status === 'missing' ? 'When does your view need to play out?' : fit.status === 'after-expiry' ? 'This trade expires before your thesis horizon.' : fit.status === 'invalid' ? 'Choose a valid horizon on or after Sep 1, 2026.' : `${dollars(fit.pnl)} modeled at your target and horizon.`}</h2><p>{fit.status === 'calculated' ? 'A conditional outcome, not proof of the thesis. Test what happens if you are early, late or wrong.' : 'Set price and time explicitly. The thesis horizon and trade expiry are separate.'}</p></div><button disabled={fit.status !== 'calculated'} onClick={() => { inspect({ ...position, scenarioDate: `${horizon}T20:00:00.000Z` }); setSelected(0) }}>Show thesis scenario</button><button className="lab-primary" onClick={() => setOptimizer(true)}>Optimize · sample</button></section>
    <div className="lab-workspace"><div className="lab-main">
      <section className="lab-position"><div className="lab-trade-heading"><div><span className="lab-label">EXPRESS YOUR VIEW</span><h1>{labFamily(position)} <span>{position.legs.length} option {position.legs.length === 1 ? 'leg' : 'legs'}{position.stock ? ' + shares' : ''}</span></h1></div><button onClick={() => setLibrary(true)}>Change strategy</button><label>Trade expiry<select aria-label="Workbench expiry" value={expiry} onChange={e => { const date = e.target.value; update({ ...position, scenarioDate: position.scenarioDate > date ? date : position.scenarioDate, legs: position.legs.map(leg => ({ ...leg, expiry: date, contractId: sampleContractId(leg.type, leg.strike, date) })) }) }}>{LAB_SAMPLE_EXPIRIES.map(date => <option key={date} value={date}>{shortDate(date)} {date.slice(0, 4)}</option>)}</select></label></div><div className="lab-metrics">{[[metrics.entryLabel, metrics.entryAmount], ['Expiry max loss', metrics.maxLoss], ['Expiry max profit', metrics.maxProfit]].map(([name, value]) => <div key={String(name)}><span>{name}</span><strong>{dollars(value as number | null)}</strong></div>)}<div><span>Breakeven at expiry</span><strong>{metrics.breakevens.map(dollars).join(' / ') || '—'}</strong></div></div></section>
      <LabAnalysisChart state={activeState} onChange={inspect}/>
      <div className="lab-controls"><label>Inspect price <b>{dollars(activeState.scenarioSpot)}</b><input aria-label="Chart price" type="range" min="80" max="120" step="0.25" value={activeState.scenarioSpot} onChange={e => inspect({ ...activeState, scenarioSpot: +e.target.value })}/></label><label>Inspect date <b>{shortDate(activeState.scenarioDate)}</b><input aria-label="Base scenario date" type="date" min={position.valuationTimestamp.slice(0, 10)} max={expiry.slice(0, 10)} value={activeState.scenarioDate.slice(0, 10)} onChange={e => inspect({ ...activeState, scenarioDate: `${e.target.value}T20:00:00.000Z` })}/></label><label>IV shift <b>{(position.ivShift * 100).toFixed(0)} pts</b><input aria-label="IV shift" type="range" min="-15" max="30" value={position.ivShift * 100} onChange={e => update({ ...position, ivShift: +e.target.value / 100 })}/></label></div><p className="lab-caption">Chart inspection does not change your thesis target or horizon. IV changes affect all modeled scenarios.</p>
      <section className="lab-analysis" aria-label="Selected scenario analysis"><div className="lab-selected-summary"><strong>{activeName} <b className={greeks.pnl < 0 ? 'lab-negative' : 'lab-positive'}>{dollars(greeks.pnl)}</b></strong><span>At {dollars(activeState.scenarioSpot)} · {shortDate(activeState.scenarioDate)} · IV {(22 + position.ivShift * 100).toFixed(0)}%</span></div><dl className="lab-greeks">{([['Delta', greeks.delta, 'USD / $1 move'], ['Gamma', greeks.gamma, 'delta / $1 move'], ['Theta', greeks.theta, 'USD / day'], ['Vega', greeks.vega, 'USD / IV point'], ['Rho', greeks.rho, 'USD / rate point']] as const).map(([name, value, unit]) => <div key={name}><dt>{name}</dt><dd>{value.toFixed(2)}</dd><small>{unit}</small></div>)}</dl></section>
      <details className="lab-leg-editor" open><summary>Position details <span>{position.legs.length} legs · edit strikes, size and entry assumptions</span></summary><div className="lab-legs">{position.legs.map((leg, i) => <div className="lab-leg" key={leg.id}><span className={leg.side === 'short' ? 'lab-sell' : 'lab-buy'}>{leg.side === 'short' ? 'SELL' : 'BUY'}</span><strong>{leg.type === 'call' ? 'Call' : 'Put'}</strong><label>Strike<select aria-label={`Leg ${i + 1} ${leg.side} ${leg.type} strike`} value={leg.strike} onChange={e => strike(i, Number(e.target.value))}>{Array.from({ length: 41 }, (_, j) => j + 80).map(n => <option key={n}>{n}</option>)}</select></label><label>Qty<input aria-label={`Leg ${i + 1} quantity`} type="number" min="1" step="1" value={leg.contracts} onChange={e => quantity(i, Number(e.target.value))}/></label><label>Entry $<input aria-label={`Leg ${i + 1} entry premium`} type="number" min="0" step="0.05" value={leg.entryPrice} onChange={e => update({ ...position, legs: position.legs.map((l, j) => i === j ? { ...l, entryPrice: e.target.valueAsNumber } : l) })}/></label><small>{shortDate(leg.expiry)}</small></div>)}{position.stock && <p>{position.stock.shares} SPY shares · entry {dollars(position.stock.entryPrice)} per share</p>}<p className="lab-caption">Size edits scale the whole structure. Premiums remain fixed when strikes or expiry change; they are not refreshed quotes.</p></div></details>
      <details className="lab-evidence"><summary>Pricing assumptions & costs</summary><div className="lab-evidence-grid"><div><label>Total cost allowance $ <input aria-label="Total cost allowance" type="number" min="0" max="10000" step="1" value={position.feeAllowance ?? 0} onChange={e => update({ ...position, feeAllowance: e.target.valueAsNumber })}/></label><p>Deducted once. Does not scale with quantity. Not a broker fee estimate.</p></div><p>European model · base IV 22% · rate 4% · yield 1.2%. No live bid/ask, quote age, liquidity or market evidence. Expiry bounds include costs and shares, not early-assignment cashflows.</p></div></details>
    </div><aside className="lab-side" aria-label="Thesis testing and conversation"><section className="lab-sparring"><header><span className="lab-label">ARGUS / SPARRING PARTNER</span><small>CONTEXT PREVIEW</small></header><h2>Challenge the trade.<br/>Not just the direction.</h2><p>Keep the conversation attached to the thesis, position and scenario you are inspecting.</p><div className="lab-prompts">{['What would invalidate my thesis?', 'What if I am right, but late?', 'Where is this trade fragile?'].map(text => <button key={text} onClick={() => { setQuestion(text); setDiscussion(true) }}>{text}<span aria-hidden="true">↗</span></button>)}</div><label className="lab-question-label">Ask about this scenario<textarea aria-label="Question about selected scenario" placeholder="Challenge an assumption…" value={question} maxLength={12000} onChange={e => { setQuestion(e.target.value); setDiscussion(false) }}/></label><button className="lab-primary" onClick={() => setDiscussion(!discussion)} aria-expanded={discussion}>Preview context</button><small>No AI request is sent in this prototype.</small>{discussion && <div className="lab-discussion"><strong>Conversation handoff · not connected</strong><p>{question || 'What should I understand about this scenario?'}</p><p>Thesis: {thesis || 'Not set'}. Target: {dollars(position.scenarioSpot)}; horizon: {horizon || 'Not set'}. Inspecting {activeName}, {dollars(activeState.scenarioSpot)}, {shortDate(activeState.scenarioDate)}, IV {(22 + position.ivShift * 100).toFixed(0)}%, calculated P/L {dollars(greeks.pnl)}.</p></div>}</section>
      <section className="lab-tray" aria-label="Scenario comparison"><div className="lab-tray-intro"><span className="lab-label">TEST THE THESIS</span><h2>One trade. Different outcomes.</h2></div>{scenarios.map((item, i) => <button className="lab-scenario" key={item.name} aria-pressed={selected === i && !inspection} onClick={() => { setSelected(i); setInspection(null); setDiscussion(false) }}><header><strong>{item.name}</strong><b className={item.pnl < 0 ? 'lab-negative' : 'lab-positive'}>{dollars(item.pnl)}</b></header><small>{dollars(item.state.scenarioSpot)} · {shortDate(item.state.scenarioDate)} · {(22 + position.ivShift * 100).toFixed(0)}% IV</small></button>)}<p className="lab-caption">Conditional outcomes, not assigned probabilities. “Later” means expiry, never after it.</p></section>
    </aside></div>
    <footer className="lab-footer"><span role="status">{notice || 'Synthetic example · no market or broker connection'}</span><span>Local draft only · six interactive strategy families · no assignment simulation</span></footer>
    {library && <LabStrategyPicker onClose={() => setLibrary(false)} onSelect={chooseStrategy}/>}
  </main>
}

createRoot(document.getElementById('root')!).render(<ScenarioLab />)
