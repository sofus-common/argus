import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { calculateStrategy, evaluateScenario, payoffSeries, sampleContractId, SAMPLE_EXPIRIES, type StrategyState } from './options'
import { assertLabPosition, createLabPosition, labScenarios, labThesisFit, readLabDraft } from './scenario-lab-model'
import './scenario-lab.css'

const dollars = (n: number | null) => n === null ? 'Unbounded' : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(n)
const shortDate = (date: string) => new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
const draftKey = 'argus-scenario-lab-prototype-v1'

function ScenarioLab() {
  const [position, setPosition] = useState(createLabPosition)
  const [thesis, setThesis] = useState('I expect a modest rise over the next month.')
  const [selected, setSelected] = useState(0)
  const [notice, setNotice] = useState('')
  const [question, setQuestion] = useState('')
  const [discussion, setDiscussion] = useState(false)
  const [horizon, setHorizon] = useState('')
  const [table, setTable] = useState(false)
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
    </section>
    <section className="lab-expiry"><span className="lab-label">EXPIRATION</span>{SAMPLE_EXPIRIES.map(date => <button key={date} aria-pressed={date === expiry} onClick={() => update({ ...position, scenarioDate: position.scenarioDate > date ? date : position.scenarioDate, legs: position.legs.map(leg => ({ ...leg, expiry: date, contractId: sampleContractId(leg.type, leg.strike, date) })) })}>{shortDate(date)}<small>2026</small></button>)}<p>Fixed sample · premiums held when editing · no live quotes</p></section>
    <section className="lab-position"><div className="lab-legs"><h1>Bull call spread <span>2 legs</span></h1>{position.legs.map((leg, i) => <div className="lab-leg" key={leg.id}><span className={i ? 'lab-sell' : 'lab-buy'}>{i ? 'SELL' : 'BUY'}</span><strong>Call</strong><label>Strike<select aria-label={`${i ? 'Short' : 'Long'} strike`} value={leg.strike} onChange={e => strike(i, Number(e.target.value))}>{Array.from({ length: 41 }, (_, j) => j + 80).map(n => <option key={n}>{n}</option>)}</select></label><label>Qty<input aria-label={`${i ? 'Short' : 'Long'} quantity`} type="number" min="1" max="10" value={leg.contracts} onChange={e => update({ ...position, legs: position.legs.map(l => ({ ...l, contracts: e.target.valueAsNumber })) })} /></label><label>Entry $<input aria-label={`${i ? 'Short' : 'Long'} entry premium`} type="number" min="0" step="0.05" value={leg.entryPrice} onChange={e => update({ ...position, legs: position.legs.map((l, j) => i === j ? { ...l, entryPrice: e.target.valueAsNumber } : l) })} /></label><span>{shortDate(leg.expiry)}</span></div>)}</div><div className="lab-metrics">{[[metrics.entryLabel, metrics.entryAmount], ['Max loss', metrics.maxLoss], ['Max profit', metrics.maxProfit]].map(([name, value]) => <div key={String(name)}><span>{name}</span><strong>{dollars(value as number | null)}</strong></div>)}<div><span>Breakeven</span><strong>{metrics.breakevens.map(dollars).join(' / ') || '—'}</strong></div></div></section>
    <div className="lab-risk-note"><span>Expiry bounds include the cost allowance; premium debit/credit excludes it.</span><span>Short call: early assignment exposure is not simulated.</span></div>
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
    <section className="lab-evidence"><details><summary>Pricing, costs & missing evidence</summary><div className="lab-evidence-grid"><div><strong>Entry assumptions</strong><p>Premiums stay fixed when strikes or expiry change. They are not refreshed quotes.</p><label>Total cost allowance $ <input aria-label="Total cost allowance" type="number" min="0" max="10000" step="1" value={position.feeAllowance ?? 0} onChange={e => update({ ...position, feeAllowance: e.target.valueAsNumber })}/></label><p>Deducted once from P/L. Does not scale with quantity. Not a broker fee estimate.</p></div><div><strong>Not available in this prototype</strong><p>Bid/ask, quote age, volume, open interest, liquidity and dated market evidence are not loaded. Entry quality cannot be assessed.</p><p>Alternative structures and AI thesis review are not connected. These results do not establish an edge.</p></div></div></details></section>
    <section className="lab-conversation"><span className="lab-context">{active.name}</span><input aria-label="Question about selected scenario" placeholder="Ask about this scenario…" value={question} maxLength={12000} onChange={e => setQuestion(e.target.value)}/><button onClick={() => setDiscussion(!discussion)} aria-expanded={discussion}>Preview context</button></section>
    {discussion && <aside className="lab-discussion"><strong>Conversation handoff · not connected in this prototype</strong><p>{question || 'What should I understand about this scenario?'}</p><p>Thesis: {thesis || 'Not set'}. Thesis target: ${position.scenarioSpot.toFixed(2)}; horizon: {horizon || 'Not set'}. Selected: {active.name}, price ${active.state.scenarioSpot.toFixed(2)}, {shortDate(active.state.scenarioDate)} at 20:00 UTC, IV {(22 + position.ivShift * 100).toFixed(0)}%, calculated P/L {dollars(active.pnl)}.</p><p>No AI request sent. Editing the position or selecting another scenario closes this context preview.</p></aside>}
    <footer className="lab-footer"><span role="status">{notice || 'Synthetic example · Sep 2026 · no market or broker connection'}</span><details><summary>Model & prototype limits</summary><p>Existing ARGUS European option engine. Spot $100; base IV 22%; rate 4%; yield 1.2%; multiplier 100; user-entered flat cost allowance. Premiums are fixed assumptions, not quotes. No assignment simulation. Same-expiry calls only. Thesis, horizon and draft save only to this browser, not your account. Scenario outcomes are not forecasts.</p></details></footer>
  </main>
}

createRoot(document.getElementById('root')!).render(<ScenarioLab />)
