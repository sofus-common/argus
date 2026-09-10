import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { calculateStrategy, evaluateScenario, payoffSeries, sampleContractId, SAMPLE_EXPIRIES, type StrategyState } from './options'
import { assertLabPosition, createLabPosition, labScenarios, labThesisFit, readLabDraft, optimizeLab, labFamily } from './scenario-lab-model'
import './scenario-lab.css'

const dollars = (n: number | null) => n === null ? 'Unbounded' : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(n)
const shortDate = (date: string) => new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
const draftKey = 'argus-scenario-lab-prototype-v1'
const holdings = (state: StrategyState) => [...state.legs.map(leg => `${leg.side === 'long' ? 'Buy' : 'Sell'} ${leg.contracts} × ${leg.strike} ${leg.type}`), ...(state.stock ? [`${state.stock.shares} shares · entry ${dollars(state.stock.entryPrice)}`] : [])].join(' · ')

function OptimizerPlot({ current, candidate }: { current: StrategyState; candidate: StrategyState }) {
  const min = Math.min(95, current.scenarioSpot - 2, ...current.legs.map(l => l.strike - 2), ...candidate.legs.map(l => l.strike - 2))
  const max = Math.max(110, current.scenarioSpot + 2, ...current.legs.map(l => l.strike + 2), ...candidate.legs.map(l => l.strike + 2))
  const curves = [current, candidate].map(state => payoffSeries(state, min, max, 100, Date.parse(state.scenarioDate)))
  const low = Math.min(0, ...curves.flat().map(p => p.pnl)) - 20, high = Math.max(0, ...curves.flat().map(p => p.pnl)) + 20
  const y = (value: number) => 160 - (value - low) / (high - low) * 130
  return <svg viewBox="0 0 800 190" role="img" aria-label="Current and candidate payoff at the same thesis horizon"><line x1="70" x2="780" y1={y(0)} y2={y(0)} className="lab-zero"/>{[low, 0, high].map(value => <text key={value} x="5" y={y(value)}>{dollars(value)}</text>)}{curves.map((curve, i) => <path key={i} d={curve.map((p, j) => `${j ? 'L' : 'M'}${70 + (p.spot - min) / (max - min) * 710},${y(p.pnl)}`).join(' ')} className={i ? 'lab-scenario-curve' : 'lab-expiration-curve'} />)}<text x="70" y="185">${min.toFixed(0)}</text><text x="650" y="185">Underlying price · ${max.toFixed(0)}</text></svg>
}

function ScenarioLab() {
  const [position, setPosition] = useState(createLabPosition)
  const [thesis, setThesis] = useState('I expect a modest rise over the next month.')
  const [selected, setSelected] = useState(0)
  const [notice, setNotice] = useState('')
  const [question, setQuestion] = useState('')
  const [discussion, setDiscussion] = useState(false)
  const [horizon, setHorizon] = useState('')
  const [table, setTable] = useState(false)
  const [optimizer, setOptimizer] = useState(false)
  const [budget, setBudget] = useState('300')
  const [collateralBudget, setCollateralBudget] = useState('10000')
  const [objective, setObjective] = useState<'profit' | 'return'>('profit')
  const [search, setSearch] = useState<{ key: string; result: ReturnType<typeof optimizeLab> } | null>(null)
  const [preview, setPreview] = useState<number | null>(null)
  const [searchError, setSearchError] = useState('')
  const searchKey = JSON.stringify([position, horizon, budget, objective, collateralBudget])
  const result = search?.key === searchKey ? search.result : null
  const candidate = result && preview !== null ? result.candidates[preview] : null
  const scenarios = labScenarios(position, position.scenarioSpot, position.scenarioDate)
  const active = scenarios[selected]
  const greeks = evaluateScenario(active.state)
  const fit = labThesisFit(position, horizon)
  const metrics = calculateStrategy(position)
  const expiry = position.legs[0].expiry
  const min = Math.min(95, position.scenarioSpot - 2, ...position.legs.map(l => l.strike - 3))
  const max = Math.max(110, position.scenarioSpot + 2, ...position.legs.map(l => l.strike + 3))
  const expiration = payoffSeries(active.state, min, max, 100)
  const modeled = payoffSeries(active.state, min, max, 100, Date.parse(active.state.scenarioDate))
  const low = Math.min(-100, ...expiration.map(p => p.pnl), ...modeled.map(p => p.pnl)) - 60
  const high = Math.max(100, ...expiration.map(p => p.pnl), ...modeled.map(p => p.pnl)) + 60
  const x = (spot: number) => 64 + (spot - min) / (max - min) * 1180
  const y = (pnl: number) => 265 - (pnl - low) / (high - low) * 230
  const path = (points: typeof expiration) => points.map((p, i) => `${i ? 'L' : 'M'}${x(p.spot)},${y(p.pnl)}`).join(' ')
  function update(next: StrategyState) {
    try { assertLabPosition(next) } catch (error) { setNotice((error as Error).message); return }
    setPosition(next); setNotice('Unsaved changes'); setDiscussion(false)
  }
  function strike(index: number, value: number) {
    update({ ...position, legs: position.legs.map((leg, i) => i === index ? { ...leg, strike: value, contractId: sampleContractId(leg.type, value, leg.expiry) } : leg) })
  }
  function quantity(index: number, value: number) {
    const scale = value / position.legs[index].contracts
    update({ ...position, legs: position.legs.map(leg => ({ ...leg, contracts: leg.contracts * scale })), ...(position.stock ? { stock: { ...position.stock, shares: position.stock.shares * scale } } : {}) })
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
      const restored = readLabDraft(raw)
      const draft = restored.draft
      setPosition(draft.state); setThesis(draft.thesis); setHorizon(restored.horizon); setQuestion(draft.composer); setSelected(0); setDiscussion(false); setNotice('Prototype draft restored.')
    } catch { setNotice('Saved prototype draft is invalid; current work is unchanged.') }
  }
  return <main className="lab">
    <header className="lab-header"><a className="lab-brand" href="/prototype.html">ARGUS<span> / Scenario Lab</span></a><span className="lab-badge">LOCAL PROTOTYPE</span><div className="lab-header-right">Illustrative SPY <strong>$100.00</strong><button onClick={load}>Open draft</button><button className="lab-primary" onClick={save}>Save draft</button></div></header>
    <section className="lab-thesis"><label htmlFor="thesis">MY THESIS <small>Optional · your view, not a forecast</small></label><input id="thesis" value={thesis} maxLength={12000} placeholder="What do you expect, and why?" onChange={e => { setThesis(e.target.value); setNotice('Unsaved changes') }} /><label>Target $<input aria-label="Target price" type="number" min="80" max="120" step="0.5" value={position.scenarioSpot} onChange={e => update({ ...position, scenarioSpot: e.target.valueAsNumber })} /></label></section>
    <section className="lab-horizon"><label>Thesis horizon <input aria-label="Thesis horizon" type="date" value={horizon} min="2026-09-01" onChange={e => { setHorizon(e.target.value); setNotice('Unsaved changes'); setDiscussion(false) }} /></label><span>When do you expect the target? Separate from expiry and the chart date. Dates use 20:00 UTC.</span></section>
    <section className="lab-fit" aria-label="Trade fit guidance">
      <div><span className="lab-label">DOES THE TRADE EXPRESS YOUR VIEW?</span><h2>{fit.status === 'missing' ? 'Set a horizon to test your target.' : fit.status === 'after-expiry' ? 'Your trade expires before your thesis horizon.' : fit.status === 'invalid' ? 'Choose a valid horizon on or after Sep 1, 2026.' : `${dollars(fit.pnl)} modeled at your target and horizon.`}</h2><p>{fit.status === 'calculated' ? `At $${position.scenarioSpot.toFixed(2)} on ${shortDate(horizon)}, IV ${(22 + position.ivShift * 100).toFixed(0)}%. ${fit.pnl! < 0 ? 'Reaching this target still leaves a modeled loss.' : 'This outcome is conditional, not evidence that the view is correct.'}` : fit.status === 'after-expiry' ? 'No post-expiry result is calculated. Reconsider the trade expiry or your horizon; neither is changed automatically.' : 'Your thesis text is not interpreted here. Enter the price and date assumptions you want to test.'}</p></div>
      <button disabled={fit.status !== 'calculated'} onClick={() => { update({ ...position, scenarioDate: `${horizon}T20:00:00.000Z` }); setSelected(0) }}>Show thesis scenario</button>
      <button aria-expanded={optimizer} onClick={() => setOptimizer(!optimizer)}>Optimize · sample</button>
    </section>
    {optimizer && <section className="lab-optimizer" aria-label="Sample optimizer">
      <h2>Find a better fit <small>Deterministic · synthetic prices</small></h2>
      <p>Long calls, bull-call and bull-put spreads, covered calls, cash-secured puts and call butterflies · strikes $95–$110. Same expiry and base quantity; butterfly ratios and stock coverage retained. Target ${position.scenarioSpot.toFixed(2)} on {horizon || 'a horizon you must set'}; IV {(22 + position.ivShift * 100).toFixed(0)}%. No calendars, probability ranking or live liquidity filtering.</p>
<div className="lab-search-controls"><label>Maximum loss $ <input aria-label="Optimizer maximum loss" type="number" min="0.01" max="100000" value={budget} onChange={e => setBudget(e.target.value)}/></label><label>Stock / cash budget $ <input aria-label="Optimizer collateral limit" type="number" min="0" value={collateralBudget} onChange={e => setCollateralBudget(e.target.value)}/></label><label>Rank by <select aria-label="Optimizer objective" value={objective} onChange={e => setObjective(e.target.value as 'profit' | 'return')}><option value="profit">Target-date profit · $</option><option value="return">Target-date return / max loss · %</option></select></label><button onClick={() => { setPreview(null); setSearch(null); setSearchError(''); try { setSearch({ key: searchKey, result: optimizeLab(position, horizon, Number(budget), objective, Number(collateralBudget)) }) } catch (error) { setSearchError((error as Error).message) } }}>Search strategies</button></div>
      {searchError && <p role="alert">{searchError}</p>}{search && !result && <p role="status">Inputs changed. Search again before previewing or applying.</p>}
      {result && <><p>{result.searched} combinations checked · {result.eligible} structures within limits · showing the best eligible result per family, up to 6. Your current structure can also be a family winner. Missing families are outside the search criteria or failed the loss or stock/cash limit; covered calls and cash-secured puts generally require larger budgets. Ranking is conditional, not a recommendation. Results may still lose money.</p><p>Fair comparison: current structure and candidates both use valuation-time model premiums (22% IV, rounded to cents) and illustrative stock entry at $100. Your manual entry costs remain unchanged until Apply. Flat cost allowance included in risk and P/L. Stock/cash budget covers covered-call shares and cash-secured-put strike reserves only, not other option debits or broker margin. Equal base quantity does not mean equal exposure.</p>
      <div className="lab-table"><table><caption>Same target, horizon and IV · family ratios shown · max loss is an expiry bound</caption><thead><tr><th>Structure / holdings</th><th>Entry outlay</th><th>Stock / cash reserved</th><th>Max loss</th><th>Target P/L</th><th>Return / risk</th><th>Smaller move</th><th>At expiry</th><th>Action</th></tr></thead><tbody>{[result.current, ...result.candidates].map((c, i) => <tr key={i}><td>{i ? `#${i}` : 'Current · repriced'} · {c.family}<br/><small>{holdings(c.state)}</small><br/><small>{c.riskNote}</small></td><td>{dollars(c.debit)}<br/><small>Negative = credit; stock included</small></td><td>{dollars(c.collateral)}{!i && c.collateral > Number(collateralBudget) ? ' · over limit' : ''}</td><td>{dollars(c.maxLoss)}{!i && c.maxLoss > Number(budget) ? ' · over budget' : ''}</td><td>{dollars(c.pnl)}</td><td>{c.returnOnRisk === null ? '—' : `${(c.returnOnRisk * 100).toFixed(1)}%`}</td><td>{dollars(c.smaller)}</td><td>{dollars(c.later)}</td><td>{i > 0 && <button aria-label={`Preview candidate ${i}`} aria-pressed={preview === i - 1} onClick={() => setPreview(i - 1)}>Preview</button>}</td></tr>)}</tbody></table></div>
      {!result.candidates.length && <p role="status">No strategy meets these loss and stock/cash limits in the searched range.</p>}
      {candidate && <div className="lab-optimizer-preview"><h3>{result.current.family} vs {candidate.family}</h3><p>{holdings(candidate.state)}</p><p><span className="lab-solid">Current · model-priced</span> <span className="lab-dashed">Candidate · model-priced</span> · both at {shortDate(candidate.state.scenarioDate)}. Target P/L difference: {dollars(candidate.pnl - result.current.pnl)}; max-loss difference: {dollars(candidate.maxLoss - result.current.maxLoss)}.</p><p>{candidate.riskNote} Stock / cash reserved: {dollars(candidate.collateral)}.</p><OptimizerPlot current={result.current.state} candidate={candidate.state}/><p>Apply replaces the option legs, stock holding and entry costs with the shown synthetic candidate and sets the chart to the thesis horizon. It does not save, close an existing trade or place a trade.</p><button onClick={() => setPreview(null)}>Dismiss preview</button> <button className="lab-primary" onClick={() => { update(candidate.state); setSelected(0); setSearch(null); setPreview(null); setNotice('Sample candidate applied to draft. Holdings and entry costs replaced with model assumptions; not saved.') }}>Apply to draft</button></div>}</>}
    </section>}
    <section className="lab-expiry"><span className="lab-label">EXPIRATION</span>{SAMPLE_EXPIRIES.map(date => <button key={date} aria-pressed={date === expiry} onClick={() => update({ ...position, scenarioDate: position.scenarioDate > date ? date : position.scenarioDate, legs: position.legs.map(leg => ({ ...leg, expiry: date, contractId: sampleContractId(leg.type, leg.strike, date) })) })}>{shortDate(date)}<small>2026</small></button>)}<p>Fixed sample · premiums held when editing · no live quotes</p></section>
    <section className="lab-position"><div className="lab-legs"><h1>{labFamily(position)} <span>{position.legs.length} option {position.legs.length === 1 ? 'leg' : 'legs'}{position.stock ? ' + shares' : ''}</span></h1>{position.legs.map((leg, i) => <div className="lab-leg" key={leg.id}><span className={leg.side === 'short' ? 'lab-sell' : 'lab-buy'}>{leg.side === 'short' ? 'SELL' : 'BUY'}</span><strong>{leg.type === 'call' ? 'Call' : 'Put'}</strong><label>Strike<select aria-label={`Leg ${i + 1} ${leg.side} ${leg.type} strike`} value={leg.strike} onChange={e => strike(i, Number(e.target.value))}>{Array.from({ length: 41 }, (_, j) => j + 80).map(n => <option key={n}>{n}</option>)}</select></label><label>Qty<input aria-label={`Leg ${i + 1} quantity`} type="number" min="1" step="1" value={leg.contracts} onChange={e => quantity(i, e.target.valueAsNumber)} /></label><label>Entry $<input aria-label={`Leg ${i + 1} entry premium`} type="number" min="0" step="0.05" value={leg.entryPrice} onChange={e => update({ ...position, legs: position.legs.map((l, j) => i === j ? { ...l, entryPrice: e.target.valueAsNumber } : l) })} /></label><span>{shortDate(leg.expiry)}</span></div>)}{position.stock && <div className="lab-leg"><span className="lab-buy">HOLD</span><strong>{position.stock.shares} SPY shares</strong><span>Entry {dollars(position.stock.entryPrice)} / share</span></div>}<small>Quantity edits scale every leg and any shares together, preserving family ratios.</small></div><div className="lab-metrics">{[[metrics.entryLabel, metrics.entryAmount], ['Max loss', metrics.maxLoss], ['Max profit', metrics.maxProfit]].map(([name, value]) => <div key={String(name)}><span>{name}</span><strong>{dollars(value as number | null)}</strong></div>)}<div><span>Breakeven</span><strong>{metrics.breakevens.map(dollars).join(' / ') || '—'}</strong></div></div></section>
    <div className="lab-risk-note"><span>Expiry bounds include the cost allowance; entry debit/credit excludes it; shares are included.</span><span>Exercise and early assignment cashflows are not simulated.</span></div>
    <section className="lab-chart" aria-label="Scenario chart"><div className="lab-chart-heading"><span>P/L <small>USD · position total</small></span><div><span className="lab-solid">At expiry</span><span className="lab-dashed">{active.name} · {shortDate(active.state.scenarioDate)}</span></div></div><div className="lab-plot" role="region" aria-label="Scrollable payoff plot" tabIndex={0}><svg viewBox="0 0 1280 300" role="img" aria-label={`${active.name} payoff curve; selected outcome ${dollars(active.pnl)}`}>
      {Array.from({ length: 5 }, (_, i) => low + (high - low) * i / 4).map(v => <g key={v}><line x1="64" x2="1244" y1={y(v)} y2={y(v)} className="lab-grid"/><text x="52" y={y(v) + 4} textAnchor="end">{dollars(v)}</text></g>)}
      {Array.from({ length: 9 }, (_, i) => min + (max - min) * i / 8).map(v => <g key={v}><line x1={x(v)} x2={x(v)} y1="35" y2="265" className="lab-grid"/><text x={x(v)} y="288" textAnchor="middle">${v.toFixed(1)}</text></g>)}
      <line x1="64" x2="1244" y1={y(0)} y2={y(0)} className="lab-zero"/><path d={path(expiration)} className="lab-expiration-curve"/><path d={path(modeled)} className="lab-scenario-curve"/>
      <line x1={x(active.state.scenarioSpot)} x2={x(active.state.scenarioSpot)} y1="35" y2="265" className="lab-target-line"/><circle cx={x(active.state.scenarioSpot)} cy={y(active.pnl)} r="5" className="lab-point"/>
    </svg></div><div className="lab-controls"><label>Target <b>${position.scenarioSpot.toFixed(2)}</b><input aria-label="Target slider" type="range" min="80" max="120" step="0.25" value={position.scenarioSpot} onChange={e => update({ ...position, scenarioSpot: +e.target.value })}/></label><label>Base date <b>{shortDate(position.scenarioDate)}</b><input aria-label="Base scenario date" type="date" min={position.valuationTimestamp.slice(0, 10)} max={expiry.slice(0, 10)} value={position.scenarioDate.slice(0, 10)} onChange={e => update({ ...position, scenarioDate: `${e.target.value}T20:00:00.000Z` })}/></label><label>IV shift <b>{(position.ivShift * 100).toFixed(0)} pts</b><input aria-label="IV shift" type="range" min="-15" max="30" value={position.ivShift * 100} onChange={e => update({ ...position, ivShift: +e.target.value / 100 })}/></label></div></section>
    <section className="lab-analysis" aria-label="Selected scenario analysis">
      <div className="lab-selected-summary"><strong>{active.name} · {dollars(active.pnl)}</strong><span>At ${active.state.scenarioSpot.toFixed(2)} · {shortDate(active.state.scenarioDate)} · IV {(22 + position.ivShift * 100).toFixed(0)}%</span><button aria-expanded={table} onClick={() => setTable(!table)}>{table ? 'Hide scenario table' : 'Show scenario table'}</button></div>
      <dl className="lab-greeks">{([['Delta', greeks.delta, 'USD / $1 move'], ['Gamma', greeks.gamma, 'delta / $1 move'], ['Theta', greeks.theta, 'USD / day'], ['Vega', greeks.vega, 'USD / IV point'], ['Rho', greeks.rho, 'USD / rate point']] as const).map(([name, value, unit]) => <div key={name}><dt>{name}</dt><dd>{value.toFixed(2)}</dd><small>{unit}</small></div>)}</dl><small>{active.state.scenarioDate === expiry ? 'At expiry: terminal-value sensitivities, not protection from risk.' : 'Local model sensitivities at the selected scenario, not a forecast of daily returns.'}</small>
      {table && <div className="lab-table" role="region" aria-label="Scenario table" tabIndex={0}><table><caption>Same selected date and IV · sample prices across the chart range · costs included</caption><thead><tr><th>Spot</th><th>Selected-date P/L</th><th>Expiry P/L</th></tr></thead><tbody>{payoffSeries(active.state, min, max, 8, Date.parse(active.state.scenarioDate)).map(row => <tr key={row.spot}><td>${row.spot.toFixed(2)}</td><td>{dollars(row.pnl)}</td><td>{dollars(evaluateScenario({ ...active.state, scenarioSpot: row.spot, scenarioDate: expiry }).pnl)}</td></tr>)}</tbody></table></div>}
    </section>
    <section className="lab-tray" aria-label="Scenario comparison"><div className="lab-tray-intro"><h2>Test the thesis.</h2><p>Same trade.<br/>Change one assumption.</p><small>Later means at expiry,<br/>never after it.</small></div>{scenarios.map((scenario, i) => <button className="lab-scenario" key={scenario.name} aria-pressed={selected === i} onClick={() => { setSelected(i); setDiscussion(false) }}><header><strong>{i + 1}. {scenario.name}</strong><span>{selected === i ? 'Selected' : 'Inspect'}</span></header><div className="lab-scenario-body"><dl><div><dt>Price</dt><dd>${scenario.state.scenarioSpot.toFixed(2)}</dd></div><div><dt>Date</dt><dd>{shortDate(scenario.state.scenarioDate)}</dd></div><div><dt>IV</dt><dd>{(22 + position.ivShift * 100).toFixed(0)}%</dd></div></dl><div className="lab-outcome"><small>Modeled P/L</small><strong className={scenario.pnl < 0 ? 'lab-negative' : 'lab-positive'}>{dollars(scenario.pnl)}</strong><small>{scenario.state.scenarioDate === expiry ? 'At expiry' : 'Before expiry'}</small></div></div></button>)}</section>
    <section className="lab-evidence"><details><summary>Pricing, costs & missing evidence</summary><div className="lab-evidence-grid"><div><strong>Entry assumptions</strong><p>Premiums stay fixed when strikes or expiry change. They are not refreshed quotes.</p><label>Total cost allowance $ <input aria-label="Total cost allowance" type="number" min="0" max="10000" step="1" value={position.feeAllowance ?? 0} onChange={e => update({ ...position, feeAllowance: e.target.valueAsNumber })}/></label><p>Deducted once from P/L. Does not scale with quantity. Not a broker fee estimate.</p></div><div><strong>Not available in this prototype</strong><p>Bid/ask, quote age, volume, open interest, liquidity and dated market evidence are not loaded. Entry quality cannot be assessed.</p><p>Only the six named same-expiry families are searched; calendars and AI thesis review are not connected. These results do not establish an edge.</p></div></div></details></section>
    <section className="lab-conversation"><span className="lab-context">{active.name}</span><input aria-label="Question about selected scenario" placeholder="Ask about this scenario…" value={question} maxLength={12000} onChange={e => setQuestion(e.target.value)}/><button onClick={() => setDiscussion(!discussion)} aria-expanded={discussion}>Preview context</button></section>
    {discussion && <aside className="lab-discussion"><strong>Conversation handoff · not connected in this prototype</strong><p>{question || 'What should I understand about this scenario?'}</p><p>Thesis: {thesis || 'Not set'}. Thesis target: ${position.scenarioSpot.toFixed(2)}; horizon: {horizon || 'Not set'}. Selected: {active.name}, price ${active.state.scenarioSpot.toFixed(2)}, {shortDate(active.state.scenarioDate)} at 20:00 UTC, IV {(22 + position.ivShift * 100).toFixed(0)}%, calculated P/L {dollars(active.pnl)}.</p><p>No AI request sent. Editing the position or selecting another scenario closes this context preview.</p></aside>}
    <footer className="lab-footer"><span role="status">{notice || 'Synthetic example · Sep 2026 · no market or broker connection'}</span><details><summary>Model & prototype limits</summary><p>Existing ARGUS European option engine. Spot $100; base IV 22%; rate 4%; yield 1.2%; multiplier 100; user-entered flat cost allowance. Premiums are fixed assumptions, not quotes. No assignment simulation. Six supported same-expiry families only; no calendars. Shares use mark-only valuation; dividends, financing and borrow cashflows are not modeled. Thesis, horizon and draft save only to this browser, not your account. Scenario outcomes are not forecasts.</p></details></footer>
  </main>
}

createRoot(document.getElementById('root')!).render(<ScenarioLab />)
