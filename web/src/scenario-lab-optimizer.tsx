import { useEffect, useId, useRef, useState } from 'react'
import { evaluateScenario, payoffSeries, sampleContractId, SAMPLE_EXPIRIES, type StrategyState } from './options'
import { labThesisFit, optimizeLab } from './scenario-lab-model'
import { WheelPicker, WheelPickerWrapper } from '@ncdai/react-wheel-picker'
import '@ncdai/react-wheel-picker/style.css'
import './scenario-lab-optimizer.css'

type Search = ReturnType<typeof optimizeLab>
type Candidate = Search['current']
type Props = { position: StrategyState; thesis: string; horizon: string; onBack: () => void; onApply: (state: StrategyState, horizon: string) => void }
const money = (value: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(value)
const dateLabel = (value: string) => new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
const legsLabel = (state: StrategyState) => [...state.legs.map(leg => `${leg.side === 'long' ? 'Buy' : 'Sell'} ${leg.contracts} × ${leg.strike}${leg.type === 'call' ? 'C' : 'P'}`), ...(state.stock ? [`${state.stock.shares} shares at ${money(state.stock.entryPrice)}`] : [])].join(' · ')

function ExpiryWheel({ expiry, valuation, onChange }: { expiry: string; valuation: string; onChange: (date: string) => void }) {
  const container = useRef<HTMLElement>(null)
  useEffect(() => {
    const wheel = container.current?.querySelector('[data-rwp]')
    if (!wheel) return
    for (const [key, value] of Object.entries({ role: 'spinbutton', 'aria-label': 'Trade expiry wheel', 'aria-valuemin': '1', 'aria-valuemax': String(SAMPLE_EXPIRIES.length), 'aria-valuenow': String(SAMPLE_EXPIRIES.findIndex(date => date === expiry) + 1), 'aria-valuetext': dateLabel(expiry) })) wheel.setAttribute(key, value)
  }, [expiry])
  return <section ref={container} className="opt-expiry-wheel" aria-label="Trade expiry">
    <div className="opt-expiry-caption"><h2>Trade expiry</h2><strong>{dateLabel(expiry)}</strong><small>Separate from your thesis horizon</small></div>
    <WheelPickerWrapper className="opt-wheel">
      <WheelPicker value={expiry} onValueChange={date => { if (SAMPLE_EXPIRIES.some(available => available === date)) onChange(date) }} infinite={false} visibleCount={12} optionItemHeight={40}
        options={SAMPLE_EXPIRIES.map(date => ({ value: date, textValue: dateLabel(date), label: <span className="opt-wheel-date"><span>{dateLabel(date)}</span><small>{(Date.parse(date) - Date.parse(valuation)) / 86400000} DTE</small></span> }))}
        classNames={{ optionItem: 'opt-wheel-option', highlightWrapper: 'opt-wheel-highlight', highlightItem: 'opt-wheel-selected' }}/>
    </WheelPickerWrapper>
    <small className="opt-expiry-help">Scroll or drag to choose<br/>Arrow keys supported · 2 sample dates<br/>DTE from sample valuation</small>
  </section>
}

function ExpiryPlot({ state }: { state: StrategyState }) {
  const id = useId()
  const min = Math.min(95, state.scenarioSpot - 1, ...state.legs.map(leg => leg.strike - 1))
  const max = Math.max(110, state.scenarioSpot + 1, ...state.legs.map(leg => leg.strike + 1))
  const expiry = state.legs[0].expiry
  const points = new Map(payoffSeries(state, min, max, 80).map(point => [point.spot, point.pnl]))
  for (const leg of state.legs) points.set(leg.strike, evaluateScenario({ ...state, scenarioSpot: leg.strike, scenarioDate: expiry }).pnl)
  const curve = [...points].sort((a, b) => a[0] - b[0])
  const low = Math.min(0, ...points.values()), high = Math.max(0, ...points.values())
  const margin = Math.max(10, (high - low) * .12), floor = low - margin, ceiling = high + margin
  const x = (spot: number) => 54 + (spot - min) / (max - min) * 342
  const y = (pnl: number) => 204 - (pnl - floor) / (ceiling - floor) * 174
  const path = curve.map(([spot, pnl], i) => `${i ? 'L' : 'M'}${x(spot)},${y(pnl)}`).join(' ')
  return <svg className="opt-payoff" viewBox="0 0 420 248" role="img" aria-label={`Expiration payoff for ${legsLabel(state)}; prices ${min} to ${max}; no probability forecast`}>
    <defs><clipPath id={`${id}-gain`}><rect x="54" y="0" width="342" height={y(0)} /></clipPath><clipPath id={`${id}-loss`}><rect x="54" y={y(0)} width="342" height={248 - y(0)} /></clipPath></defs>
    {[0, 1, 2, 3, 4].map(i => { const value = floor + (ceiling - floor) * i / 4; return <g key={i}><line x1="54" x2="396" y1={y(value)} y2={y(value)} className="opt-gridline"/><text x="47" y={y(value) + 4} textAnchor="end">{Math.round(value).toLocaleString('en-US')}</text></g> })}
    {[0, 1, 2, 3, 4].map(i => { const spot = min + (max - min) * i / 4; return <g key={i}><line x1={x(spot)} x2={x(spot)} y1="30" y2="204" className="opt-gridline"/><text x={x(spot)} y="221" textAnchor="middle">{spot.toFixed(1)}</text></g> })}
    <line x1="54" x2="396" y1={y(0)} y2={y(0)} className="opt-zero"/>
    <path d={path} className="opt-gain-line" clipPath={`url(#${id}-gain)`}/><path d={path} className="opt-loss-line" clipPath={`url(#${id}-loss)`}/>
    <text x="225" y="242" textAnchor="middle">Underlying price at expiry ($)</text><text transform="translate(12 117) rotate(-90)" textAnchor="middle">P/L (USD)</text>
  </svg>
}

function Confirmation({ candidate, current, horizon, onClose, onApply }: { candidate: Candidate; current: Candidate; horizon: string; onClose: () => void; onApply: Props['onApply'] }) {
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => { dialog.current?.showModal() }, [])
  return <dialog className="opt-confirm" ref={dialog} aria-label="Review candidate before applying" onClose={onClose}>
    <header><div><small>PREVIEW · NO CHANGES APPLIED</small><h2>{candidate.family}</h2></div><button onClick={onClose} aria-label="Close candidate preview">×</button></header>
    <p>{legsLabel(candidate.state)}</p><p>{candidate.riskNote}</p>
    <div className="opt-confirm-table"><table><caption>Both repriced from the same synthetic entry basis · target {money(candidate.state.scenarioSpot)} on {dateLabel(candidate.state.scenarioDate)}</caption><thead><tr><th>Metric</th><th>Current structure</th><th>Candidate</th></tr></thead><tbody>
      <tr><th>Target P/L</th><td>{money(current.pnl)}</td><td>{money(candidate.pnl)}</td></tr>
      <tr><th>Expiry maximum loss</th><td>{money(current.maxLoss)}</td><td>{money(candidate.maxLoss)}</td></tr>
      <tr><th>Stock / cash reserved</th><td>{money(current.collateral)}</td><td>{money(candidate.collateral)}</td></tr>
      <tr><th>Smaller-move P/L</th><td>{money(current.smaller)}</td><td>{money(candidate.smaller)}</td></tr>
      <tr><th>Target at expiry P/L</th><td>{money(current.later)}</td><td>{money(candidate.later)}</td></tr>
    </tbody></table></div><ExpiryPlot state={candidate.state}/>
    <p>Apply replaces the draft's option legs, shares and entry costs with this synthetic structure, and sets its target, expiry and chart date to these search inputs. Your thesis horizon becomes {dateLabel(`${horizon}T20:00:00.000Z`)}. Nothing is saved or traded; existing closing cashflows are not modeled.</p>
    <footer><button onClick={onClose}>Keep workbench unchanged</button><button className="opt-primary" onClick={() => onApply(structuredClone(candidate.state), horizon)}>Apply to draft</button></footer>
  </dialog>
}

export function LabOptimizer({ position, thesis, horizon: originalHorizon, onBack, onApply }: Props) {
  const heading = useRef<HTMLHeadingElement>(null)
  const [source] = useState(() => structuredClone(position))
  const [target, setTarget] = useState(String(position.scenarioSpot))
  const [horizon, setHorizon] = useState(originalHorizon)
  const [expiry, setExpiry] = useState(position.legs[0].expiry)
  const [budget, setBudget] = useState('300')
  const [cash, setCash] = useState('10000')
  const [objective, setObjective] = useState<'profit' | 'return'>('profit')
  const [preview, setPreview] = useState<number | null>(null)
  const key = JSON.stringify([target, horizon, expiry, budget, cash, objective])
  const [search, setSearch] = useState<{ key: string; result: Search } | null>(() => {
    try { return labThesisFit(position, originalHorizon).status === 'calculated' ? { key, result: optimizeLab(position, originalHorizon, 300, 'profit', 10000) } : null } catch { return null }
  })
  const [error, setError] = useState('')
  useEffect(() => { heading.current?.focus() }, [])
  const result = search?.key === key ? search.result : null
  const candidate = result && preview !== null ? result.candidates[preview] : undefined
  const dte = (Date.parse(expiry) - Date.parse(source.valuationTimestamp)) / 86400000
  const outlook = Number(target) > 103 ? 'Very bullish' : Number(target) > source.spot ? 'Bullish' : ''
  function runSearch() {
    setPreview(null); setSearch(null); setError('')
    try {
      if (!target.trim() || !budget.trim() || !cash.trim()) throw new Error('Enter target, maximum loss and stock/cash budget.')
      const state = { ...source, scenarioSpot: Number(target), scenarioDate: source.scenarioDate > expiry ? expiry : source.scenarioDate, legs: source.legs.map(leg => ({ ...leg, expiry, contractId: sampleContractId(leg.type, leg.strike, expiry) })) }
      setSearch({ key, result: optimizeLab(state, horizon, Number(budget), objective, Number(cash)) })
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Search unavailable.') }
  }
  return <main className="opt-screen">
    <header className="opt-header"><div className="opt-brand">ARGUS <span>/ Scenario Lab</span></div><nav aria-label="Prototype screen"><button onClick={onBack}>Workbench</button><span aria-current="page">Optimize</span></nav><small>LOCAL PROTOTYPE · SYNTHETIC</small></header>
    <section className="opt-thesis"><span>MY THESIS</span><p>{thesis || 'No written thesis. Search uses only the explicit price and date below.'}</p><button onClick={onBack}>Edit in workbench</button></section>
    <section className="opt-assumption-panel" aria-label="Optimizer assumptions">
      <div className="opt-outlooks"><h2>Market outlook</h2><div>{[['Very bearish', '↓↓'], ['Bearish', '↓'], ['Neutral', '→'], ['Either direction', '↔'], ['Bullish', '↑'], ['Very bullish', '↑↑']].map(([label, arrow], i) => <button key={label} disabled={i < 4} aria-pressed={outlook === label} title={i < 4 ? 'Not supported by this bullish prototype' : 'Fixed synthetic target preset, not a forecast'} onClick={() => setTarget(i === 4 ? '103' : '106')}><b aria-hidden="true">{arrow}</b><span>{label}</span></button>)}</div><small>Bullish families only. Presets: $103 / $106; not implied-move forecasts.</small></div>
      <div className="opt-assumptions"><h2>Assumptions</h2><div><label>Target price $<input aria-label="Optimizer target price" type="number" min="80" max="120" step="0.25" value={target} onChange={event => setTarget(event.target.value)}/></label><label>Thesis horizon<input aria-label="Optimizer thesis horizon" type="date" min="2026-09-01" value={horizon} onChange={event => setHorizon(event.target.value)}/></label><label>Max loss $<input aria-label="Optimizer maximum loss" type="number" min="0.01" max="100000" value={budget} onChange={event => setBudget(event.target.value)}/></label><label>Stock / cash budget $<input aria-label="Optimizer collateral limit" type="number" min="0" max="1000000" value={cash} onChange={event => setCash(event.target.value)}/></label></div></div>
      <div className="opt-expiry-summary"><h2>Trade expiry</h2><strong>{dateLabel(expiry)}</strong><span>{dte} days from sample valuation</span><small>{!horizon ? 'Set an independent thesis horizon.' : `${horizon}T20:00:00.000Z` > expiry ? 'Expires before thesis horizon.' : horizon === expiry.slice(0, 10) ? 'Matches thesis horizon.' : 'Thesis horizon and expiry are separate.'}</small></div>
    </section>
    <ExpiryWheel expiry={expiry} valuation={source.valuationTimestamp} onChange={setExpiry}/>
    <section className="opt-ranking"><label>Rank by<select aria-label="Optimizer objective" value={objective} onChange={event => setObjective(event.target.value as 'profit' | 'return')}><option value="profit">Target-date profit · $</option><option value="return">Target-date return / max loss · %</option></select></label><div className="opt-chance"><div><span>Higher return</span><span>Higher chance</span></div><input type="range" min="0" max="100" value="0" disabled aria-label="Return versus chance unavailable"/><small>Probability and balanced scoring are not implemented.</small></div><button className="opt-primary" onClick={runSearch}>Search strategies</button><span className="opt-risk-filter">Limited expiry loss only<small>Not a guarantee against assignment or funding risk</small></span></section>
    <section className="opt-results" aria-label="Optimizer results"><div className="opt-results-heading"><div><h1 ref={heading} tabIndex={-1}>Compare ways to express your view</h1><p>Same target, horizon and pricing assumptions. Preview before applying.</p></div><span>{result ? `${result.searched} checked · ${result.eligible} eligible` : 'Synthetic model search · not trading advice'}</span></div>
      {error && <p className="opt-status" role="alert">{error}</p>}
      {!result && <p className="opt-status" role="status">{search ? 'Assumptions changed. Search again before previewing or applying.' : !horizon ? 'Set your thesis horizon, then search. No date is assumed for you.' : 'Search the supported families using your assumptions.'}</p>}
      {result && <><p className="opt-results-note">Best eligible result per family, ranked by {objective === 'profit' ? 'target-date dollar profit' : 'target-date P/L divided by expiry maximum loss'}. Same base quantity, not equal exposure. Missing families are outside the search criteria or budgets; results can lose money.</p><div className="opt-cards">{result.candidates.map((item, index) => <article className="opt-card" key={item.family}><header><h2>{item.family}</h2><small>#{index + 1} · {item.state.legs[0].contracts} base quantity</small></header><p className="opt-card-legs">{legsLabel(item.state)}</p><dl className="opt-card-metrics"><div><dt>{item.debit >= 0 ? 'Entry outlay' : 'Entry credit'}</dt><dd>{money(Math.abs(item.debit))}</dd></div><div><dt>Expiry max loss</dt><dd className="opt-negative">{money(item.maxLoss)}</dd></div><div><dt>Target-date P/L</dt><dd className={item.pnl < 0 ? 'opt-negative' : 'opt-positive'}>{money(item.pnl)}</dd></div><div><dt>Return / risk</dt><dd>{item.returnOnRisk === null ? '—' : `${(item.returnOnRisk * 100).toFixed(1)}%`}</dd></div></dl><ExpiryPlot state={item.state}/><p className="opt-card-cash">Stock / cash reserved <strong>{money(item.collateral)}</strong></p><p className="opt-card-risk">{item.riskNote}</p><button className="opt-preview-button" onClick={() => setPreview(index)} aria-label={`Preview candidate ${index + 1}`}>Preview candidate</button></article>)}</div>{!result.candidates.length && <p className="opt-status" role="status">No supported strategy meets these loss and stock/cash limits.</p>}</>}
    </section>
    <footer className="opt-method"><details><summary>Methodology & prototype limits</summary><p>Searches long calls, bull-call spreads, bull-put spreads, covered calls, cash-secured puts and target-centred call butterflies. Strikes $95–$110, selected sample expiry and base quantity; no calendars. Best eligible result per family, not six guaranteed results. The current structure can also win its family.</p><p>Entry premiums are European-model values at the fixed September 1, 2026 valuation, $100 spot and 22% IV, rounded to cents. Rate 4%, yield 1.2%. Target-date IV is {(22 + source.ivShift * 100).toFixed(1)}%; cost allowance {money(source.feeAllowance ?? 0)} is deducted once. Current structure is repriced on the same basis, not evaluated at your manual or actual fills.</p><p>Stock/cash budget reserves $100 per covered-call share or the full cash-secured-put strike obligation. It is not a broker margin estimate and does not cap other option debits. Entry outlay includes shares and excludes the flat allowance. No bid/ask, quote age, liquidity filter or probability calculation. Stock dividends, financing, borrow, exercise and assignment cashflows are not simulated.</p><p>Card curves show expiration P/L; target-date metrics can differ. Return/risk is a conditional scenario ratio, not expected return. Outlook presets do not interpret your thesis. Search edits stay on this screen until Apply; Back discards them. Nothing is saved or traded and no AI call is made.</p></details><span>ARGUS / Scenario Lab</span></footer>
    {candidate && result && <Confirmation candidate={candidate} current={result.current} horizon={horizon} onClose={() => setPreview(null)} onApply={onApply}/>}
  </main>
}
