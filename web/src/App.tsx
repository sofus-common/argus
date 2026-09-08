import { useEffect, useLayoutEffect, useId, useMemo, useRef, useState } from 'react'
import { SymbolSearch } from './SymbolSearch'
import { OptionChainTable } from './OptionChainTable'
import { CandidateSearch, checkSearch, type CandidateSearchResult } from './CandidateSearch'
import { PriceHistory } from './PriceHistory'
import { streamFreshness } from './stream-freshness'
import { DraftRecovery } from './DraftRecovery'
import { SavedImport } from './SavedImport'
import { canMoveStrikeDrag, strikeDrag, type StrikeDrag } from './strike-drag'
import type { WorkspaceDraft } from './workspace-draft'
import {
  MAX_OPTION_LEGS,
  MAX_OPTION_EXPIRIES,
  pnlDisplayBasis,
  calculateConditionalAssignment,
  contractTermsFacts,
  isChartRange,
  type ChartRange,
  type PnlDisplayMode,
  expirationProbability,
  firstExpirySpreadLossBound,
  expirationDistribution,
  scenarioSpotAttribution,
  createStrategy,
  createMarketStrategy,
  marketLeg,
  quoteValuation,
  validateMarketStrategy,
  validateMarketConstruction,
  validateConstruction,
  projectAnalysisPosition,
  mergeAnalysisProposal,
  SAMPLE_EXPIRIES,
  SAMPLE_STRIKES,
  sampleContractId,
  translateStrikes,
  validateStrategy,
  effectiveIv,
  pruneExpiryIvShifts,
  TEMPLATES,
  type OptionLeg,
  type StrategyState,
  type TemplateId,
  type MarketSnapshot,
  type PricingBasis,
} from './options'
import type { SparringSuccess } from './sparring'
import { requestAmericanSurface } from './american-surface-client'
import { PositionLifecycle } from './PositionLifecycle'
import { LotManagement } from './LotManagement'
import { WorkspaceContext } from './WorkspaceContext'
import { requestWorkspaceValuation, requestFirstExpiryRange, requestFirstExpiryBreakevens } from './workspace-valuation-client'

const templates: Array<{ id: TemplateId; label: string; family: string; glyph: string }> = [
  { id: 'long-call', label: 'Long call', family: 'Directional', glyph: '╱' },
  { id: 'long-put', label: 'Long put', family: 'Directional', glyph: '╲' },
  { id: 'bull-call', label: 'Bull call', family: 'Verticals', glyph: '⌁' },
  { id: 'bear-put', label: 'Bear put', family: 'Verticals', glyph: '⌁' },
  { id: 'bull-put', label: 'Bull put', family: 'Verticals', glyph: '⌁' },
  { id: 'bear-call', label: 'Bear call', family: 'Verticals', glyph: '⌁' },
  { id: 'long-straddle', label: 'Long straddle', family: 'Volatility', glyph: '∨' },
  { id: 'long-strangle', label: 'Long strangle', family: 'Volatility', glyph: '⌄' },
  { id: 'inverse-iron-butterfly', label: 'Inverse iron butterfly', family: 'Volatility', glyph: '◇' },
  { id: 'inverse-iron-condor', label: 'Inverse iron condor', family: 'Volatility', glyph: '▱' },
  { id: 'short-call-butterfly', label: 'Short call butterfly', family: 'Volatility', glyph: '◇' },
  { id: 'short-put-butterfly', label: 'Short put butterfly', family: 'Volatility', glyph: '◇' },
  { id: 'short-call', label: 'Short call', family: 'Uncovered short', glyph: '╲' },
  { id: 'short-put', label: 'Short put', family: 'Uncovered short', glyph: '╱' },
  { id: 'short-straddle', label: 'Short straddle', family: 'Uncovered short', glyph: '∧' },
  { id: 'short-strangle', label: 'Short strangle', family: 'Uncovered short', glyph: '⌃' },
  { id: 'iron-butterfly', label: 'Iron butterfly', family: 'Neutral', glyph: '◇' },
  { id: 'call-butterfly', label: 'Call butterfly', family: 'Neutral', glyph: '◇' },
  { id: 'put-butterfly', label: 'Put butterfly', family: 'Neutral', glyph: '◇' },
  { id: 'iron-condor', label: 'Iron condor', family: 'Neutral', glyph: '▱' },
  { id: 'call-calendar', label: 'Call calendar', family: 'Time', glyph: 'Ⅱ' },
  { id: 'put-calendar', label: 'Put calendar', family: 'Time', glyph: 'Ⅱ' },
  { id: 'call-diagonal', label: 'Call diagonal', family: 'Time', glyph: 'Ⅱ' },
  { id: 'put-diagonal', label: 'Put diagonal', family: 'Time', glyph: 'Ⅱ' },
  { id: 'covered-call', label: 'Covered call', family: 'Stock + options', glyph: '┐' },
  { id: 'protective-put', label: 'Protective put', family: 'Stock + options', glyph: '└' },
  { id: 'collar', label: 'Collar', family: 'Stock + options', glyph: '⊏' },
]

const money = (value: number | null, fallback = '—', digits = 0) =>
  value == null || !Number.isFinite(value)
    ? fallback
    : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value)

const signed = (value: number, digits = 0) => `${value >= 0 ? '+' : ''}${value.toFixed(digits)}`
const shortDate = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
const holdingDescription = (stock: StrategyState['stock'], underlying: string) => stock ? `${signed(stock.shares)} ${underlying} shares · held entry $${stock.entryPrice.toFixed(2)} / share` : 'No shares'

export function AssignmentOutcomes({ state, snapshot }: { state: StrategyState; snapshot?: MarketSnapshot }) {
  const result = useMemo(() => { try { return calculateConditionalAssignment(state, snapshot) } catch { return null } }, [state, snapshot])
  const shorts = state.legs.filter(leg => leg.side === 'short')
  const describe = (id: string) => { const leg = state.legs.find(item => item.id === id)!; return `${leg.side} ${leg.contracts} × $${leg.strike} ${leg.type} · ${shortDate(leg.expiry)}` }
  return <details className="assignment-panel" aria-label="Conditional assignment outcomes">
    <summary><strong>Assignment outcomes</strong><span>{shorts.length ? `${shorts.length} short ${shorts.length === 1 ? 'leg' : 'legs'} · ${result?.scenarios ? 'calculated' : 'terms unavailable'}` : 'No short options'}</span></summary>
    {!shorts.length ? <p>No short options to assign. Long options may still require exercise decisions.</p> : !result?.scenarios ? <p>Share-delivery scenarios are unavailable. They require a matching, nonhistorical snapshot with recorded standard American, physically settled 100-share terms. No settlement terms are inferred from the ticker.</p> : <>
      <p>Starting inventory: <b>{signed(result.beforeShares)} {state.underlying} shares</b>. Each row independently assumes full assignment of one short leg; the other options remain unchanged.</p>
      <div className="assignment-outcomes">{result.scenarios.map(scenario => <article key={scenario.assignedLegId} aria-label={`Assignment of ${describe(scenario.assignedLegId)}`}>
        <h4>{describe(scenario.assignedLegId)}</h4>
        <dl><div><dt>Share change</dt><dd>{signed(scenario.shareChange)}</dd></div><div><dt>Resulting shares</dt><dd>{signed(scenario.resultingShares)} {state.underlying}</dd></div><div><dt>Gross strike cashflow</dt><dd>{scenario.grossStrikeCashflow >= 0 ? '+' : '−'}{money(Math.abs(scenario.grossStrikeCashflow), '—', 2)}</dd></div></dl>
        <p><b>Options remaining</b> {scenario.remainingOptionLegIds.length ? scenario.remainingOptionLegIds.map(describe).join('; ') : 'None'}. The assigned leg is no longer open.</p>
      </article>)}</div>
      <p>Not profit, buying power or an assignment forecast. No automatic long exercise, partial or combined assignments. Cashflow excludes premiums, fees, dividends and financing. Recorded terms are not a current corporate-action check.</p>
    </>}
    <p className="assignment-policy"><b>Broker policy not supplied</b> Exercise cutoff, margin requirements and liquidation timing are unknown. No orders or position changes are made.</p>
  </details>
}

function FirstExpiryAnalysis({ state, min, max, onAsk, busy }: { state: StrategyState; min: number; max: number; onAsk: () => void; busy: boolean }) {
  const request = useRef<AbortController | null>(null)
  const [result, setResult] = useState<{ source: StrategyState; value?: Awaited<ReturnType<typeof requestFirstExpiryRange>>; error?: string }>()
  useEffect(() => () => { request.current?.abort(); request.current = null }, [state, min, max])
  const current = result?.source === state ? result : undefined
  const calculate = async () => {
    request.current?.abort()
    const controller = new AbortController()
    request.current = controller
    setResult({ source: state })
    try {
      const value = await requestFirstExpiryRange(state, min, max, controller.signal)
      if (!controller.signal.aborted && request.current === controller) setResult({ source: state, value })
    } catch (error) {
      if (!controller.signal.aborted && request.current === controller) setResult({ source: state, error: error instanceof Error ? error.message : 'Range analysis unavailable.' })
    }
  }
  const loading = !!current && !current.value && !current.error
  return <section aria-label="First-expiry range analysis">
    <p>Refine the modeled high and low between ${min.toFixed(2)} and ${max.toFixed(2)}. On demand · $1 search tolerance · up to 256 spot evaluations.</p>
    <button className="undo-button" disabled={loading} onClick={() => void calculate()}>{loading ? 'Analyzing range…' : 'Analyze first-expiry range'}</button>
    {current?.error && <p role="alert">{current.error}</p>}
    {current?.value && <div role="status">
      <p>{current.value.status === 'tolerance-met' ? 'Search tolerance met' : 'Evaluation budget reached — uncertainty remains'} · {current.value.evaluations} evaluations.</p>
      <p>Minimum P/L estimate: {money(current.value.minimum.lower, '—', 2)} to {money(current.value.minimum.upper, '—', 2)}. Lowest evaluated {money(current.value.minimum.at.pnl, '—', 2)} at ${current.value.minimum.at.spot.toFixed(4)}.</p>
      <p>Maximum P/L estimate: {money(current.value.maximum.lower, '—', 2)} to {money(current.value.maximum.upper, '—', 2)}. Highest evaluated {money(current.value.maximum.at.pnl, '—', 2)} at ${current.value.maximum.at.spot.toFixed(4)}.</p>
      <p>{current.value.basis}</p>
      <button className="undo-button" disabled={busy} onClick={onAsk}>Ask ARGUS about this range</button>
    </div>}
  </section>
}

type BreakevenResult = { source: StrategyState; value?: Awaited<ReturnType<typeof requestFirstExpiryBreakevens>>; error?: string }

export function FirstExpiryBreakevens({ state, min, max, result, onResult }: { state: StrategyState; min: number; max: number; result?: BreakevenResult; onResult: (result: BreakevenResult) => void }) {
  const request = useRef<AbortController | null>(null)
  useEffect(() => () => { request.current?.abort(); request.current = null }, [state, min, max])
  const current = result?.source === state ? result : undefined
  const value = current?.value
  const loading = !!current && !value && !current.error && !!request.current && !request.current.signal.aborted
  const calculate = async () => {
    request.current?.abort()
    const controller = new AbortController()
    request.current = controller
    onResult({ source: state })
    try {
      const value = await requestFirstExpiryBreakevens(state, min, max, controller.signal)
      if (!controller.signal.aborted && request.current === controller) onResult({ source: state, value })
    } catch (error) {
      if (!controller.signal.aborted && request.current === controller) onResult({ source: state, error: error instanceof Error ? error.message : 'Breakeven search unavailable.' })
    }
  }
  return <section className="breakeven-analysis" aria-label="First-expiry breakeven search">
    <p>Find modeled zero-P/L candidates between ${min.toFixed(2)} and ${max.toFixed(2)}. On demand · $0.01 spot tolerance · up to 256 evaluations.</p>
    <button className="undo-button" disabled={loading} onClick={() => void calculate()}>{loading ? 'Finding candidates…' : 'Find first-expiry breakevens'}</button>
    {current?.error && <p role="alert">{current.error}</p>}
    {value && <div role="status">
      <p><strong>{value.status === 'spot-tolerance-met' ? 'Spot tolerance met' : 'Budget reached — unresolved intervals remain'}</strong> · {value.evaluations} evaluations · {shortDate(value.date)} first expiry · {state.valuationModel === 'american-crr-1024-v1' ? 'American model' : 'European model'}.</p>
      {value.candidates.length > 0 && <ul>{value.candidates.map(candidate => <li key={candidate.lower}><span className={`candidate-kind ${candidate.kind}`}>{candidate.kind === 'sign-changing' ? 'Sign-changing' : 'Unresolved'}</span><span>${candidate.lower.toFixed(4)} – ${candidate.upper.toFixed(4)}</span></li>)}</ul>}
      {value.evaluatedZeros.length > 0 && <p>Evaluated zero-P/L spots: {value.evaluatedZeros.map(spot => `$${spot.toFixed(4)}`).join(', ')}. These are model evaluations, not exact risk boundaries.</p>}
      {!value.candidates.length && !value.evaluatedZeros.length && <p>No candidates retained in this domain under the selected model and numerical enclosure estimates.</p>}
      <p>Intervals can contain multiple crossings or no crossing. Chart marks show only candidates within the visible P/L range, at first expiry—not the selected scenario date. Changes require a new search.</p>
      <details><summary>Calculation assumptions</summary><p>{value.basis}</p></details>
    </div>}
  </section>
}

function Metric({ label, value, tone, foot }: { label: string; value: string; tone?: string; foot?: string }) {
  return (
    <div className={`metric ${tone ?? ''}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      {foot && <small>{foot}</small>}
    </div>
  )
}

function ExpiryIvAssumptions({ shifts }: { shifts?: StrategyState['expiryIvShifts'] }) {
  return shifts?.length ? <p>Additional IV by expiry: {shifts.map(shift => `${shift.expiry.slice(0, 10)}: ${signed(shift.ivShift * 100, 2)} pts`).join(' · ')}. Held fixed across these scenarios.</p> : null
}

function SpotAttribution({ data }: { data?: ReturnType<typeof scenarioSpotAttribution> }) {
  return <details className="spot-attribution"><summary>Stock and option contributions</summary>{data ? <><p>Change from spot ${data.baseline.spot.toFixed(2)} at {data.baseline.date}, IV shift {signed(data.baseline.ivShift * 100, 2)} points.</p><ExpiryIvAssumptions shifts={data.baseline.expiryIvShifts} /><div className="leg-risk-scroll" tabIndex={0} role="region" aria-label="Scrollable spot contributions"><table aria-label="Spot-move contributions"><thead><tr><th scope="col">Spot</th><th scope="col">Stock change · $</th><th scope="col">Options change · $</th><th scope="col">Total change · $</th></tr></thead><tbody>{data.rows.map(row => <tr key={row.spot}><th scope="row">${row.spot.toFixed(2)}</th><td>{signed(row.stockChange, 2)}</td><td>{signed(row.optionChange, 2)}</td><td>{signed(row.pnlChange, 2)}</td></tr>)}</tbody></table></div><p>{data.basis}</p></> : <p>Current contributions unavailable until calculation completes.</p>}</details>
}

function ScenarioTable({ state, data, error, onSelect, pnlDisplay = 'pnl' }: { pnlDisplay?: PnlDisplayMode; state: StrategyState; data?: Awaited<ReturnType<typeof requestWorkspaceValuation>>['table']; error?: string; onSelect: (patch: Partial<StrategyState>) => void }) {
  const rows = data?.rows ?? []
  const basis = pnlDisplayBasis(state, pnlDisplay)!
  const root = useRef<HTMLDivElement>(null)
  const focusSpot = useRef<number | null>(null)
  function exportCsv() {
    if (!data) return
    const headers = ['Symbol', 'Model', 'Scenario date UTC', 'IV shift decimal', 'Rate decimal', 'Dividend yield decimal', 'Cost allowance USD', 'Quote snapshot ID', 'Valuation date UTC', 'Data basis', 'Spot USD', 'P/L USD', 'Delta per USD', 'Gamma per USD', 'Theta USD per calendar day', 'Vega USD per percentage point', 'Rho USD per percentage point']
    const metadata = [state.underlying, state.valuationModel ?? 'european-bsm-v1', state.scenarioDate, state.ivShift, state.rate, state.dividendYield, state.feeAllowance ?? 0, state.pricing?.snapshotId ?? '', state.valuationTimestamp, state.pricing ? 'Dated quote inputs; modeled scenarios, not fills or forecasts' : 'Sample/manual inputs; modeled scenarios, not fills or forecasts']
    const cell = (value: string | number) => typeof value === 'number' ? String(value) : '"' + (/^\s*[=+\-@\t\r]/.test(value) ? "'" + value : value).replaceAll('"', '""') + '"'
    const csv = [[...headers, 'Expiry IV shifts (additive decimals)', 'Display mode', 'Display unit', 'Risk denominator USD', 'Displayed value'], ...rows.map(row => [...metadata, row.spot, row.pnl, row.delta, row.gamma, row.theta, row.vega, row.rho, JSON.stringify(state.expiryIvShifts ?? []), pnlDisplay, basis.unit, basis.denominator ?? '', displayPnl(row.pnl, basis)])].map(row => row.map(cell).join(',')).join('\r\n')
    const link = document.createElement('a')
    link.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent('\uFEFF' + csv)
    link.download = 'argus-' + state.underlying + '-scenarios.csv'
    link.click()
  }
  useEffect(() => {
    if (!data || focusSpot.current === null) return
    if (document.activeElement === document.body) root.current?.querySelector<HTMLButtonElement>(`button[aria-label="Select scenario spot ${focusSpot.current}"]`)?.focus()
    focusSpot.current = null
  }, [data])
  return <><SpotAttribution data={data?.attribution} /><div className="scenario-table-wrap" ref={root}><button disabled={!data} onClick={exportCsv}>Export scenario CSV</button>{!data && <p role="status">{error ? 'Scenario table unavailable. Retry the position calculation above.' : 'Calculating scenario table…'}</p>}<p>At {state.scenarioDate} · position totals · fixed IV/rate/yield. Select a price to apply that scenario; Undo restores it.</p><div className="leg-risk-scroll" role="region" aria-label="Scrollable scenario table" tabIndex={0}><table aria-label="Scenario P/L and Greeks" aria-busy={!data}><thead><tr><th scope="col">Spot</th><th scope="col">{pnlDisplay === 'pnl' ? 'P/L · $' : `${basis.label} · ${basis.unit}`}</th><th scope="col">Delta</th><th scope="col">Gamma</th><th scope="col">Theta / day</th><th scope="col">Vega / pt</th><th scope="col">Rho / pt</th></tr></thead><tbody>{rows.map(row => <tr key={row.spot} data-spot={row.spot} className={row.spot === state.scenarioSpot ? 'selected-scenario' : ''}><th scope="row"><button aria-label={`Select scenario spot ${row.spot}`} aria-pressed={row.spot === state.scenarioSpot} onClick={event => { if (row.spot !== state.scenarioSpot) { if (event.currentTarget === document.activeElement) focusSpot.current = row.spot; onSelect({ scenarioSpot: row.spot }) } }}>${row.spot.toFixed(2)}</button>{row.spot === state.spot && <small>Quote spot</small>}{row.spot === state.scenarioSpot && <small>Selected</small>}</th>{(['pnl', 'delta', 'gamma', 'theta', 'vega', 'rho'] as const).map(key => <td key={key}>{signed(key === 'pnl' ? displayPnl(row.pnl, basis) : row[key], key === 'gamma' ? 3 : 2)}{key === 'pnl' && basis.unit === '%' ? '%' : ''}</td>)}</tr>)}</tbody></table></div><p>Greeks are local sensitivities: delta per $1 spot, gamma per $1, theta per calendar day, vega/rho per percentage point. Not realized returns, forecasts or margin requirements.</p></div></>
}
const displayPnl = (value: number, basis: NonNullable<ReturnType<typeof pnlDisplayBasis>>) => value * basis.scale + basis.offset

function DistributionCurve({ state, lower, upper }: { state: StrategyState; lower?: number; upper?: number }) {
  const clipId = useId().replaceAll(':', '')
  const distribution = useMemo(() => expirationDistribution(state), [state])
  if (distribution.reason) return <p>{distribution.reason}</p>
  if (distribution.pointMass !== null) return <p role="status">At expiry the model is a point mass at ${distribution.pointMass.toFixed(2)}; there is no continuous density curve.</p>
  const points = distribution.points
  const min = points[0].spot, max = points.at(-1)!.spot, peak = Math.max(...points.map(point => point.density))
  const x = (spot: number) => 52 + (spot - min) / (max - min) * 544
  const y = (density: number) => 150 - density / peak * 114
  const line = points.map((point, index) => `${index ? 'L' : 'M'}${x(point.spot)},${y(point.density)}`).join(' ')
  const area = `${line} L596,150 L52,150 Z`
  const left = lower === undefined ? 52 : Math.min(596, Math.max(52, x(lower)))
  const right = upper === undefined ? 52 : Math.min(596, Math.max(52, x(upper)))
  return <figure className="distribution-figure"><svg viewBox="0 0 620 188" role="img" aria-label="Conditional expiry price density, shaded selected range">
    <defs><clipPath id={clipId}><rect x={left} y="30" width={Math.max(0, right - left)} height="120" /></clipPath></defs>
    <text x="52" y="17">Probability density per $1</text><text x="48" y="40" textAnchor="end">{peak.toPrecision(2)}</text>
    <path d={area} fill="#607a9e" opacity=".15" /><path d={area} fill="#a6c6f4" opacity=".5" clipPath={`url(#${clipId})`} /><path d={line} fill="none" stroke="#a6c6f4" strokeWidth="2" />
    <line x1="52" y1="150" x2="596" y2="150" stroke="currentColor" opacity=".4" />
    {[min, min + (max - min) / 2, max].map((spot, index) => <text key={index} x={x(spot)} y="173" textAnchor={index === 0 ? 'start' : index === 2 ? 'end' : 'middle'}>${spot.toFixed(2)}</text>)}
  </svg><figcaption>Sampled density; shading shows the visible price range, not profit. Percentages use the CDF, not polygon area. {(distribution.omittedMass! * 100).toFixed(4)}% model mass lies outside this chart; range totals include those tails.</figcaption></figure>
}

function ProbabilityPanel({ state, pending, onExplain }: { state: StrategyState; pending: boolean; onExplain: (range: { lower: number; upper: number }) => void }) {
  const [lower, setLower] = useState(() => (state.scenarioSpot * .9).toFixed(2))
  const [upper, setUpper] = useState(() => (state.scenarioSpot * 1.1).toFixed(2))
  const valid = Number.isFinite(Number(lower)) && Number.isFinite(Number(upper)) && Number(lower) > 0 && Number(upper) > Number(lower)
  const probability = useMemo(() => expirationProbability(state, valid ? { lower: Number(lower), upper: Number(upper) } : undefined), [state, lower, upper, valid])
  const range = probability.priceRange
  const percent = (value: number) => `${(value * 100).toFixed(1)}%`
  return <details className="probability-context" aria-label="Model probability assumptions">
    <summary>Scenario → expiry chance of profit <strong>{probability.probability === null ? 'Unavailable' : percent(probability.probability)}</strong><span>Conditional model · not a forecast</span></summary>
    <p>{probability.reason ?? `Positive expiration P/L from $${probability.spot.toFixed(2)} at ${probability.from}, to ${probability.expiry}.`}</p>
    <fieldset className="probability-range"><legend>Expiry price range · read-only</legend>
      <label>Lower price<input aria-label="Probability lower price" type="number" min="0.01" step="any" value={lower} onChange={event => setLower(event.target.value)} /></label>
      <label>Upper price<input aria-label="Probability upper price" type="number" min="0.01" step="any" value={upper} onChange={event => setUpper(event.target.value)} /></label>
      {!valid ? <p role="status">Enter positive prices with upper above lower.</p> : range ? <div className="range-results" aria-label="Expiry price probabilities">
        <div className="range-mass" aria-hidden="true">{[range.below, range.between, range.above].map((value, index) => <i key={index} style={{ width: `${value * 100}%` }} />)}</div>
        <span>Below ${lower}<b>{percent(range.below)}</b></span><span>${lower}–${upper} inclusive<b>{percent(range.between)}</b></span><span>Above ${upper}<b>{percent(range.above)}</b></span>
      </div> : <p>Range probability unavailable for this position.</p>}
    </fieldset>
    <DistributionCurve state={state} lower={valid ? Number(lower) : undefined} upper={valid ? Number(upper) : undefined} />
    <button disabled={pending || !valid || !range} onClick={() => onExplain({ lower: Number(lower), upper: Number(upper) })}>Ask about this range</button>
    <p>Price-range probability is not chance of profit. Range controls do not change the position or Undo history.</p>
    <p>Distribution IV {probability.volatility === null ? 'unavailable' : (probability.volatility * 100).toFixed(2)}% · nearest-strike contract {probability.volatilityContractId} · rate {(probability.rate * 100).toFixed(2)}% · yield {(probability.dividendYield * 100).toFixed(2)}%.</p><p>{probability.basis}</p>
  </details>
}

function ScenarioInput({ value, label, onCommit }: { value: number; label: string; onCommit: (value: number) => void }) {
  const [draft, setDraft] = useState(String(value))
  useEffect(() => setDraft(String(value)), [value])
  const apply = () => {
    const parsed = Number(draft)
    if (draft.trim() && Number.isFinite(parsed)) onCommit(parsed)
    setDraft(String(value))
  }
  return <input aria-label={label} inputMode="decimal" value={draft} onChange={(event) => setDraft(event.target.value)} onBlur={apply} onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); if (event.key === 'Escape') setDraft(String(value)) }} />
}

export function SnapshotAge({ snapshot, contracts }: { snapshot: MarketSnapshot; contracts: string[] }) {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30000)
    return () => window.clearInterval(timer)
  }, [])
  const times = [snapshot.spotAsOf, ...contracts.map(id => snapshot.contracts.find(contract => contract.contractId === id)?.quoteAsOf)].map(value => value ? Date.parse(value) : NaN)
  const clock = Math.max(now, Date.now()), oldest = Math.min(...times)
  const known = times.every(time => Number.isFinite(time) && time > 0)
  const future = known && times.some(time => time > clock)
  const minutes = Math.floor((clock - oldest) / 60000)
  const age = minutes < 1 ? 'less than 1 minute ago' : minutes < 60 ? `${minutes} minute${minutes === 1 ? '' : 's'} ago` : minutes < 1440 ? `${Math.floor(minutes / 60)}h ${minutes % 60}m ago` : `${Math.floor(minutes / 1440)}d ${Math.floor(minutes % 1440 / 60)}h ago`
  return <div className="snapshot-age" aria-label="Position snapshot source age">
    <strong>{snapshot.historical ? 'HISTORICAL QUOTES' : known && !future && clock - oldest > 86400000 ? 'STALE QUOTES' : 'POSITION SNAPSHOT'}</strong>
    <span>{!known ? 'Source time unavailable' : future ? 'Future source time · age unavailable' : <>Oldest selected source: {age} · <time dateTime={new Date(oldest).toISOString()}>{new Date(oldest).toISOString().replace('T', ' ').replace('Z', ' UTC')}</time></>}</span>
    <small>Age uses the underlying and selected option sources, not retrieval time. Streamed marks do not update this snapshot until captured. Not a live fill.</small>
  </div>
}

export function StreamedMarks({ snapshot, contracts, onCapture, captureEnabled, onReview, reviewEnabled, automatic, onAutomatic, onTick }: { snapshot: MarketSnapshot; contracts: string[]; onCapture: () => void; captureEnabled: boolean; onReview: () => void; reviewEnabled: boolean; automatic: boolean; onAutomatic: (enabled: boolean) => void; onTick: () => Promise<unknown> }) {
  type Quote = { bid: number; ask: number; bidTime: number | null; askTime: number | null; receivedAt: string }
  type Greeks = { iv: number; time: number | null; receivedAt: string }
  type Index = { price: number; time: number | null; receivedAt: string }
  const socket = useRef<WebSocket | null>(null)
  const [status, setStatus] = useState('Disconnected')
  const [active, setActive] = useState(false)
  const [marks, setMarks] = useState<Record<string, { quote?: Quote; greeks?: Greeks; index?: Index }>>({})
  const [clock, setClock] = useState(Date.now)
  useEffect(() => {
    if (!active) return
    const timer = window.setInterval(() => setClock(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [active])
  const index = snapshot.underlyingKind === 'cash-index', underlying = marks[snapshot.underlying]
  const complete = !!(index ? underlying?.index : underlying?.quote) && contracts.every(id => marks[id]?.quote && marks[id]?.greeks)
  const sources = [...(index ? [underlying?.index?.time ?? null] : [underlying?.quote?.bidTime ?? null, underlying?.quote?.askTime ?? null]), ...contracts.flatMap(id => [marks[id]?.quote?.bidTime ?? null, marks[id]?.quote?.askTime ?? null, marks[id]?.greeks?.time ?? null])]
  const receipts = [index ? underlying?.index?.receivedAt : underlying?.quote?.receivedAt, ...contracts.flatMap(id => [marks[id]?.quote?.receivedAt, marks[id]?.greeks?.receivedAt])].map(value => value ? Date.parse(value) : NaN)
  const freshness = streamFreshness(sources, receipts, Math.max(clock, Date.now()))
  const capturable = status.startsWith('Connected') && complete && freshness === 'ready'
  const freshnessLabel = !complete ? 'Waiting for complete quote and IV coverage' : { ready: 'Within dated-capture limits', unknown: 'Source timestamps unknown', future: 'Future timestamps · capture unavailable', 'stale-source': 'Source data too old · capture unavailable', 'stale-receipt': 'Stream updates too old · capture unavailable', skewed: 'Source times too far apart · capture unavailable' }[freshness]
  useEffect(() => { if (automatic && !capturable) onAutomatic(false) }, [automatic, capturable])
  const tick = useRef(onTick)
  tick.current = onTick
  useEffect(() => {
    if (!automatic || !capturable) return
    let cancelled = false, busy = false
    const update = async () => {
      if (cancelled || busy || document.visibilityState !== 'visible') return
      busy = true
      try { await tick.current() } finally { busy = false }
    }
    void update()
    const timer = window.setInterval(() => void update(), 15_000)
    const visibility = () => { if (document.visibilityState !== 'visible') onAutomatic(false) }
    document.addEventListener('visibilitychange', visibility)
    return () => { cancelled = true; window.clearInterval(timer); document.removeEventListener('visibilitychange', visibility) }
  }, [automatic, capturable])
  const close = () => { const current = socket.current; socket.current = null; current?.close() }
  useEffect(() => () => close(), [])
  const disconnect = () => { onAutomatic(false); close(); setActive(false); setMarks({}); setStatus('Disconnected') }
  const connect = () => {
    disconnect()
    let ready = false
    setActive(true); setStatus('Connecting')
    const fail = () => { onAutomatic(false); close(); setActive(false); setMarks({}); setStatus('Feed unavailable. Connect again to retry.') }
    try {
      const url = new URL('/api/feed', window.location.href)
      url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
      url.search = new URLSearchParams({ snapshot: snapshot.id, contracts: contracts.join(',') }).toString()
      const current = new WebSocket(url)
      socket.current = current
      current.onerror = current.onclose = () => { if (socket.current === current) fail() }
      current.onmessage = event => {
        if (socket.current !== current) return
        try {
          if (typeof event.data !== 'string' || event.data.length > 16_384) throw Error()
          const value = JSON.parse(event.data)
          if (value?.type === 'status') {
            if (!['connecting', 'connected', 'reconnecting', 'unavailable'].includes(value.state) || typeof value.message !== 'string' || value.message.length > 300) throw Error()
            if (value.state === 'unavailable') fail()
            else {
              ready = value.state === 'connected'
              if (!ready) { onAutomatic(false); setMarks({}) }
              setStatus(ready ? 'Connected · timestamps determine quote freshness' : value.state === 'reconnecting' ? 'Reconnecting · marks cleared' : 'Connecting')
            }
            return
          }
          if (!value || !['quote', 'greeks', 'index'].includes(value.type) || ![snapshot.underlying, ...contracts].includes(value.contractId) || typeof value.receivedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(value.receivedAt) || !Number.isFinite(Date.parse(value.receivedAt))) throw Error()
          if (!ready) return
          const time = (stamp: unknown) => { if (stamp === null || stamp === 0) return null; if (typeof stamp !== 'number' || !Number.isSafeInteger(stamp) || stamp <= 0 || !Number.isFinite(new Date(stamp).getTime())) throw Error(); return stamp }
          if (value.type === 'index') {
            if (!index || value.contractId !== snapshot.underlying || typeof value.price !== 'number' || !Number.isFinite(value.price) || value.price <= 0 || value.price > 1_000_000) throw Error()
            const mark = { price: value.price, time: time(value.time), receivedAt: value.receivedAt }
            setMarks(previous => ({ ...previous, [value.contractId]: { index: mark } }))
          } else if (value.type === 'quote') {
            if (index && value.contractId === snapshot.underlying) throw Error()
            if (typeof value.bid !== 'number' || typeof value.ask !== 'number' || !Number.isFinite(value.bid) || !Number.isFinite(value.ask) || value.bid < 0 || value.ask <= 0 || value.ask < value.bid || value.ask > 1_000_000) throw Error()
            const quote = { bid: value.bid, ask: value.ask, bidTime: time(value.bidTime), askTime: time(value.askTime), receivedAt: value.receivedAt }
            setMarks(previous => ({ ...previous, [value.contractId]: { ...previous[value.contractId], quote } }))
          } else {
            if (!contracts.includes(value.contractId) || typeof value.iv !== 'number' || !Number.isFinite(value.iv) || value.iv <= 0 || value.iv > 10) throw Error()
            const greeks = { iv: value.iv, time: time(value.time), receivedAt: value.receivedAt }
            setMarks(previous => ({ ...previous, [value.contractId]: { ...previous[value.contractId], greeks } }))
          }
        } catch { fail() }
      }
    } catch { fail() }
  }
  const dated = (time: number | null) => time === null ? 'unknown' : new Date(time).toISOString()
  return <div className="streamed-marks" aria-label="Streamed market marks"><button onClick={active ? disconnect : connect}>{active ? 'Disconnect' : 'Connect live feed'}</button><span role="status">{status.startsWith('Connected') ? `Connected · ${freshnessLabel}` : status}</span><details><summary>Streamed marks · separate from position snapshot</summary><label><input type="checkbox" aria-label="Automatic repricing" checked={automatic} disabled={!automatic && (!captureEnabled || !reviewEnabled || !capturable)} onChange={event => onAutomatic(event.target.checked)} />Automatic repricing · every 15s</label><button disabled={!captureEnabled || !capturable} onClick={onCapture}>Capture for analysis</button><button disabled={!captureEnabled || !reviewEnabled || !capturable} onClick={onReview}>Capture and review</button><small>Capture and review updates the position snapshot, then requests AI analysis. If capture fails, no review starts.</small><small>Dated-capture limits: source age ≤5 minutes, receipt age ≤1 minute, source-time spread ≤1 minute. These limits do not guarantee current or executable prices.</small><small>Keep entry costs first. Capture requires complete recent source times; Now advances to capture time, future scenarios stay fixed. Only selected contracts are captured.</small><small>Without automatic repricing, marks are display-only until captured. Automatic mode follows spot when the scenario equals the previous quote spot; other targets stay fixed. Edits, AI review, hidden tabs and feed interruptions stop automatic mode. Held costs stay fixed. Receipt time does not establish market freshness.</small>{[snapshot.underlying, ...contracts].map(id => {
    const mark = marks[id]
    return mark && <div key={id}><b>{id}</b>{mark.index && <><span>Index level {mark.index.price.toFixed(2)}</span><small>dxFeed Trade timestamp {dated(mark.index.time)} · received {mark.index.receivedAt}. Not an executable quote or official settlement.</small></>}{mark.quote && <><span>Bid ${mark.quote.bid.toFixed(2)} / ask ${mark.quote.ask.toFixed(2)}</span><small>Bid time {dated(mark.quote.bidTime)} · ask time {dated(mark.quote.askTime)} · received {mark.quote.receivedAt}</small></>}{mark.greeks && <><span>IV {(mark.greeks.iv * 100).toFixed(2)}%</span><small>IV time {dated(mark.greeks.time)} · received {mark.greeks.receivedAt}</small></>}</div>
  })}</details></div>
}

const chartMetrics = {
  pnl: { label: 'P/L', unit: 'USD' },
  delta: { label: 'Delta', unit: 'USD per $1 spot move' },
  gamma: { label: 'Gamma', unit: 'delta change per $1 spot move' },
  theta: { label: 'Theta', unit: 'USD per calendar day' },
  vega: { label: 'Vega', unit: 'USD per volatility point' },
  rho: { label: 'Rho', unit: 'USD per rate point' },
} as const
type ChartMetric = keyof typeof chartMetrics

function RequestedScenarios({ scenarios, baseline, snapshot }: { scenarios: SparringSuccess['calculated']['requestedScenarios']; baseline: StrategyState; snapshot?: MarketSnapshot }) {
  const [preview, setPreview] = useState<SparringSuccess['calculated']['requestedScenarios'][number] | null>(null)
  return <><details className="source-evidence requested-scenarios"><summary>Requested what-if calculations</summary><p>Read-only model evaluations of the reviewed position. Entry costs and legs are unchanged; no scenario has been applied.</p>
    {scenarios.map((result, index) => <section key={result.id} aria-label={`Requested scenario ${index + 1}`}><b>Scenario {index + 1}</b>
      <button className="preview-chart-button" onClick={() => setPreview(result)}>Preview chart</button>
      <small>{result.scenario.scenarioDate} · spot ${result.scenario.scenarioSpot.toFixed(2)} · Global IV shift {signed(result.scenario.ivShift * 100, 2)} pts</small>
      {!!(result.scenario.legIvShifts?.length || baseline.expiryIvShifts?.length) && result.legVolatilities && <div aria-label="Hypothetical leg volatility assumptions"><b>Modeled IV by leg</b>
        {result.legVolatilities.map(leg => <p key={leg.legId}><b>{leg.side} ${leg.strike.toFixed(2)} {leg.type} · {(leg.modeledIv * 100).toFixed(2)}% IV</b>
          <small>{leg.legId} · {leg.expiry}</small><small>Stored IV {(leg.baseIv * 100).toFixed(2)}% + global {signed(leg.globalShift * 100, 2)} pts + expiry {signed((leg.expiryShift ?? 0) * 100, 2)} pts + leg {signed(leg.legShift * 100, 2)} pts</small>
        </p>)}<p>Hypothetical inputs only. Stored quotes and position costs are unchanged.</p>
      </div>}
      <dl><dt>Modeled P/L · USD</dt><dd>{signed(result.metrics.pnl, 2)}</dd><dt>Change vs selected scenario · USD</dt><dd>{signed(result.changesFromCurrent.pnl, 2)}</dd></dl>
      <p>Delta {signed(result.metrics.delta, 2)} · Gamma {signed(result.metrics.gamma, 3)} · Theta {signed(result.metrics.theta, 2)} / day · Vega {signed(result.metrics.vega, 2)} / vol pt · Rho {signed(result.metrics.rho, 2)} / rate pt</p>
      {result.pnlComparison && <><b>What changed the modeled P/L?</b>
        <small>Baseline: {result.pnlComparison.baseline.scenarioDate} · spot ${result.pnlComparison.baseline.scenarioSpot.toFixed(2)} · IV shift {signed(result.pnlComparison.baseline.ivShift * 100, 2)} pts · P/L {signed(result.pnlComparison.baselinePnl, 2)} USD</small>
        <dl><dt>Spot only · USD</dt><dd>{signed(result.pnlComparison.isolatedChanges.spot, 2)}</dd><dt>Date only · USD</dt><dd>{signed(result.pnlComparison.isolatedChanges.date, 2)}</dd><dt>IV only · USD</dt><dd>{signed(result.pnlComparison.isolatedChanges.iv, 2)}</dd><dt>Joint interaction residual · USD</dt><dd>{signed(result.pnlComparison.interactionResidual, 2)}</dd></dl>
        <p>Each isolated comparison changes one input and holds the other two at baseline. IV only includes all global and per-leg shifts together. Their sum plus the interaction residual equals the combined P/L change before rounding. This is model repricing, not a causal allocation of market returns.</p>
      </>}
      <p>{result.assumptions}</p>
    </section>)}<p>Position sensitivities include quantity and multiplier. Delta: USD per $1 spot move; gamma: delta change per $1; theta, vega and rho are USD in the units shown. These are modeled outcomes, not forecasts or fills.</p>
  </details>{preview && <ScenarioPreview baseline={baseline} snapshot={snapshot} result={preview} onClose={() => setPreview(null)} />}</>
}

function ScenarioPreview({ baseline, snapshot, result, onClose }: { baseline: StrategyState; snapshot?: MarketSnapshot; result: SparringSuccess['calculated']['requestedScenarios'][number]; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [metric, setMetric] = useState<ChartMetric>('pnl')
  useEffect(() => { dialog.current?.showModal() }, [])
  const preview = useMemo(() => {
    try {
      if (!baseline || validateStrategy(baseline).length || (baseline.pricing && (!snapshot || validateMarketStrategy(baseline, snapshot).length))) throw Error()
      const { scenarioDate, scenarioSpot, ivShift, legIvShifts } = result.scenario
      if (typeof ivShift !== 'number' || !Number.isFinite(ivShift) || Math.abs(ivShift) > 10 || !Number.isFinite(scenarioSpot) || scenarioSpot <= 0 || scenarioSpot > 1_000_000) throw Error()
      if (legIvShifts !== undefined && (!Array.isArray(legIvShifts) || legIvShifts.length > MAX_OPTION_LEGS)) throw Error()
      const shifts = legIvShifts ?? []
      if (new Set(shifts.map(shift => shift.legId)).size !== shifts.length || shifts.some(shift => !baseline.legs.some(leg => leg.id === shift.legId) || typeof shift.ivShift !== 'number' || !Number.isFinite(shift.ivShift) || Math.abs(shift.ivShift) > 10)) throw Error()
      const ledger = result.legVolatilities
      if (ledger !== undefined && (!Array.isArray(ledger) || ledger.length !== baseline.legs.length || new Set(ledger.map(leg => leg.legId)).size !== baseline.legs.length)) throw Error()
      if (ledger === undefined && (shifts.length || baseline.expiryIvShifts?.length)) throw Error()
      const near = (left: number, right: number) => Number.isFinite(left) && Number.isFinite(right) && Math.abs(left - right) <= 1e-12
      const legs = baseline.legs.map(leg => {
        const legShift = shifts.find(shift => shift.legId === leg.id)?.ivShift ?? 0
        const expiryShift = baseline.expiryIvShifts?.find(shift => shift.expiry === leg.expiry)?.ivShift ?? 0
        const modeledIv = leg.iv + ivShift + expiryShift + legShift
        if (ledger) {
          const row = ledger.find(item => item.legId === leg.id)
          if (!row || row.expiry !== leg.expiry || row.strike !== leg.strike || row.type !== leg.type || row.side !== leg.side || !near(row.baseIv, leg.iv) || !near(row.globalShift, ivShift) || !near(row.expiryShift ?? 0, expiryShift) || !near(row.legShift, legShift) || !near(row.modeledIv, modeledIv)) throw Error()
        }
        return { ...leg, iv: modeledIv }
      })
      const state = { ...structuredClone(baseline), scenarioDate, scenarioSpot, ivShift: 0, expiryIvShifts: undefined, legs }
      if (validateStrategy(state).length) throw Error()
      return { state, error: '' }
    } catch { return { state: null, error: 'This captured scenario could not be reconciled with its recorded position and IV assumptions. Preview unavailable; your workspace is unchanged.' } }
  }, [baseline, snapshot, result])
  const [validation, setValidation] = useState<{ source: typeof preview; metrics?: Record<ChartMetric, number>; error?: string }>()
  useEffect(() => {
    if (!preview.state) return
    const controller = new AbortController()
    void requestWorkspaceValuation(preview.state, controller.signal).then(({ metrics: value }) => {
      if (controller.signal.aborted) return
      const metrics = { pnl: value.scenarioPnl, delta: value.delta, gamma: value.gamma, theta: value.theta, vega: value.vega, rho: value.rho }
      const mismatch = (Object.keys(metrics) as ChartMetric[]).some(key => !Number.isFinite(result.metrics?.[key]) || Math.abs(metrics[key] - result.metrics[key]) > 1e-7)
      setValidation(mismatch ? { source: preview, error: 'This captured scenario could not be reconciled with its recorded position and IV assumptions. Preview unavailable; your workspace is unchanged.' } : { source: preview, metrics })
    }).catch(() => {
      if (!controller.signal.aborted) setValidation({ source: preview, error: 'Unable to check this captured scenario. Close and reopen the preview to retry; your workspace is unchanged.' })
    })
    return () => controller.abort()
  }, [preview, result])
  const checked = validation?.source === preview ? validation : undefined
  const previewError = preview.error || checked?.error
  return <dialog className="scenario-preview" aria-label="Scenario chart preview" ref={dialog} onClose={onClose}>
    <header><div><small>READ-ONLY · CAPTURED WHAT-IF</small><h2>Scenario chart preview</h2></div><button autoFocus onClick={() => dialog.current?.close()}>Close preview</button></header>
    <p className="preview-context">{baseline?.underlying} · {baseline?.name} · captured workspace v{baseline?.version}<br />No position, entry cost, saved state or quote changes.</p>
    {baseline?.stock && <p className="preview-context" aria-label="Captured share holding">Captured holding: {holdingDescription(baseline.stock, baseline.underlying)}. Shares remain marked at each modeled spot; no dividend, financing or borrow cashflows.</p>}
    {preview.state && checked?.metrics ? <>
      <p className="preview-context">{result.scenario.scenarioDate} · target spot ${result.scenario.scenarioSpot.toFixed(2)} · global IV shift {signed(result.scenario.ivShift * 100, 2)} pts<br />{snapshot ? `${snapshot.historical ? 'HISTORICAL QUOTES' : snapshot.captureSource ? 'CAPTURED POSITION QUOTES' : 'DATED POSITION QUOTES'} · ${snapshot.source} · retrieved ${snapshot.retrievedAt} · underlying as of ${snapshot.spotAsOf}` : `SAMPLE / MANUAL POSITION · valuation ${baseline.valuationTimestamp}`}</p>
      <div className="preview-toolbar"><label>Preview metric <select aria-label="Preview metric" value={metric} onChange={event => setMetric(event.target.value as ChartMetric)}>{Object.entries(chartMetrics).map(([key, value]) => <option key={key} value={key}>{value.label}</option>)}</select></label><span>Target {chartMetrics[metric].label}: {signed(checked.metrics[metric], metric === 'gamma' ? 3 : 2)} {chartMetrics[metric].unit}</span></div>
      <PayoffChart state={preview.state} metric={metric} readOnly />
      <details><summary>Captured model assumptions</summary><p>{result.assumptions}</p>{preview.state.legs.map(leg => <p key={leg.id}>{leg.id} · {leg.expiry} · modeled IV {(leg.iv * 100).toFixed(2)}%</p>)}<p>{preview.state.valuationModel === 'american-crr-1024-v1' ? 'American CRR' : 'European'}-model curves include the captured flat cost allowance, before unmodeled costs and assignment effects. Quote spot remains ${baseline.spot.toFixed(2)}; the target marker is hypothetical.</p></details>
    </> : previewError ? <p role="alert">{previewError}</p> : <p role="status">Checking captured scenario…</p>}
  </dialog>
}

function PositionComparison({ result, baseline: captured, current: capturedMetrics, snapshot }: { result: NonNullable<SparringSuccess['calculated']['positionComparison']>; baseline: StrategyState; current: SparringSuccess['metrics']; snapshot?: MarketSnapshot }) {
  const [chart, setChart] = useState(false)
  const baseline = result.baseline?.state ?? captured
  const current = result.baseline?.metrics ?? capturedMetrics
  const bound = (metrics: SparringSuccess['metrics'], key: 'maxProfit' | 'maxLoss') => metrics.mode === 'first-expiry' ? 'Not exact' : metrics[key] === null ? 'Unbounded' : money(metrics[key]!)
  return <details className="source-evidence requested-scenarios holdings-comparison" aria-label="Read-only holdings comparison"><summary>Calculated holdings comparison · no proposal</summary>
    <p>{baseline.underlying} · captured workspace v{baseline.version} · {baseline.scenarioDate} · spot ${baseline.scenarioSpot.toFixed(2)} · total global IV shift {signed(baseline.ivShift * 100, 2)} pts</p>
    {(baseline.scenarioSpot !== captured.scenarioSpot || baseline.scenarioDate !== captured.scenarioDate || baseline.ivShift !== captured.ivShift) && <p>Both positions are modeled at this requested scenario. The workspace remains at ${captured.scenarioSpot.toFixed(2)} on {captured.scenarioDate}, global IV shift {signed(captured.ivShift * 100, 2)} pts; no scenario controls were changed.</p>}
    {snapshot ? <details aria-label="Comparison quote timestamps"><summary>Captured quote timestamps · not live fills</summary><p>{snapshot.source} · retrieved {snapshot.retrievedAt}<br />Underlying mark: {snapshot.spotAsOf}</p>{snapshot.contracts.filter(contract => [...baseline.legs, ...result.state.legs].some(leg => leg.contractId === contract.contractId)).map(contract => <p key={contract.contractId}>{contract.contractId} · {contract.quoteAsOf}</p>)}<p>Separate timestamps may be asynchronous. Additional share purchase price is a hypothetical assumption, not a quoted offer. This comparison does not refresh quotes.</p></details> : <p>Sample/manual contracts and prices, not executable market quotes.</p>}
    <p>{result.assumptions}</p>
    {result.replacement && <p>Alternative for {result.replacement.legId}: {result.replacement.previousContractId} → {result.replacement.contractId}. New entry estimate ${result.replacement.entryPrice.toFixed(4)} per share · {result.replacement.basis} basis · bid ${result.replacement.bid.toFixed(4)} / ask ${result.replacement.ask.toFixed(4)} · {result.replacement.quoteAsOf}. This excludes the old leg's closing cashflows and realized P/L; it is not a roll debit or credit.</p>}
    <p>Additional share purchase assumption: {money(result.additionalShareCost)}. Compared holding: {result.state.stock ? holdingDescription(result.state.stock, baseline.underlying) : 'No shares'}.</p>
    {!!result.removedLegIds.length && <p>Excluded option legs: {result.removedLegIds.join(' · ')}. Exit proceeds and realized P/L are not included.</p>}
    <div className="leg-risk leg-risk-scroll" role="region" aria-label="Scrollable holdings comparison" tabIndex={0}><table aria-label="Holdings comparison metrics"><thead><tr><th scope="col">Metric</th><th scope="col">Captured holdings</th><th scope="col">Compared holdings</th></tr></thead><tbody>
      <tr><th scope="row">Payoff reference horizon</th>{[baseline, result.state].map((state, index) => {
        const expiry = state.legs.map(leg => leg.expiry).sort()[0]
        return <td key={index}><time dateTime={expiry}>{expiry.slice(0, 10)}<br />{expiry.slice(11, 19)} UTC</time><small>{[current, result.metrics][index].mode === 'first-expiry' ? 'First expiry · sampled only' : 'Intact expiry'}</small></td>
      })}</tr>
      <tr><th scope="row">Additional expiry IV shifts</th>{[baseline, result.state].map((state, index) => <td key={index}>{state.expiryIvShifts?.length ? state.expiryIvShifts.map(shift => <div key={shift.expiry}>{shift.expiry.slice(0, 10)}: {signed(shift.ivShift * 100, 2)} pts</div>) : 'None'}</td>)}</tr>
      <tr><th scope="row">Intact expiry breakevens · USD</th>{[current, result.metrics].map((metrics, index) => <td key={index}>{metrics.mode === 'first-expiry' ? 'Not exact' : metrics.breakevens.map(value => money(value, '—', 3)).join(' · ') || 'None'}</td>)}</tr>
      {(['scenarioPnl', 'maxProfit', 'maxLoss', 'delta', 'gamma', 'theta', 'vega', 'rho'] as const).map(key => <tr key={key}><th scope="row">{key === 'scenarioPnl' ? 'Modeled P/L · USD' : key === 'maxProfit' ? 'Intact expiry max profit' : key === 'maxLoss' ? 'Intact expiry max loss' : `${chartMetrics[key].label} · ${chartMetrics[key].unit}`}</th>{[current, result.metrics].map((metrics, index) => <td key={index}>{key === 'maxProfit' || key === 'maxLoss' ? bound(metrics, key) : signed(metrics[key], key === 'gamma' ? 3 : 2)}</td>)}</tr>)}
    </tbody></table></div>
    <button className="preview-chart-button" onClick={() => setChart(value => !value)}>{chart ? 'Hide holdings chart' : 'Show holdings chart'}</button>
    {chart && <PayoffChart state={baseline} comparison={result.state} comparisonLabel="Compared holdings" metric="pnl" readOnly />}
  </details>
}

function ChartAnalysis({ inspection }: { inspection: NonNullable<SparringSuccess['calculated']['chartInspection']> }) {
  const metric = inspection.metric
  const display = inspection.pnlDisplay
  const columns: ChartMetric[] = inspection.view === 'table' ? ['pnl', 'delta', 'gamma', 'theta', 'vega', 'rho'] : metric === 'pnl' ? ['pnl'] : [metric, 'pnl']
  return <details className="source-evidence chart-analysis"><summary>Chart scenarios for this analysis</summary>
    <p>{inspection.valuationModel === 'american-crr-1024-v1' ? 'American CRR · 1,024 steps' : 'European BSM'} · {inspection.view === 'table' ? 'Scenario table' : inspection.view === 'heatmap' ? 'Heatmap' : chartMetrics[metric].label} · {inspection.date} · spot ${inspection.spot.toFixed(2)} · IV shift {signed(inspection.ivShift * 100, 2)} pts</p>
    {inspection.range && <p>Captured display range: ${inspection.range.min}–${inspection.range.max}. Checkpoints do not establish extrema between samples.</p>}
    <ExpiryIvAssumptions shifts={inspection.expiryIvShifts} />
    {display && <p>{display.label} · {display.unit}{display.denominator !== null ? ` · risk denominator ${money(display.denominator)}` : ''}. Displayed from canonical dollar P/L; not realized return or margin return.</p>}
    <p>{inspection.assumptions}</p>
    <div className="leg-risk-scroll" role="region" aria-label="Scrollable captured scenarios" tabIndex={0}><table aria-label="Calculated chart scenarios"><thead><tr><th scope="col">Spot</th>{columns.map(key => <th scope="col" key={key}>{key === 'pnl' && display ? `${display.label} · ${display.unit}` : key === 'pnl' && metric !== 'pnl' ? 'P/L · USD' : chartMetrics[key].label}</th>)}</tr></thead><tbody>{inspection.points.map(point => <tr key={point.spot}><th scope="row">${point.spot.toFixed(2)}</th>{columns.map(key => <td key={key}>{key === 'pnl' && display ? `${signed(displayPnl(point.pnl, display))}${display.unit === '%' ? '%' : ''}` : key === 'pnl' && metric !== 'pnl' ? money(point.pnl) : signed(point[key], key === 'gamma' ? 3 : 2)}</td>)}</tr>)}</tbody></table></div>
    <p>{columns.map(key => key === 'pnl' && display ? `${display.label}: ${display.unit}` : `${chartMetrics[key].label}: ${chartMetrics[key].unit}`).join('; ')}. These scenarios belong to this analysis, not a later chart selection.</p>
    {inspection.spotAttribution && <SpotAttribution data={inspection.spotAttribution} />}
  </details>
}

function PayoffChart({ state: sourceState, comparison, comparisonLabel = 'Proposed', metric, onStrike, onStrikeCommit, onDragStart, readOnly = false, pnlDisplay = 'pnl', breakevens, range }: { range?: ChartRange; breakevens?: BreakevenResult['value']; pnlDisplay?: PnlDisplayMode; state: StrategyState; comparison?: StrategyState; comparisonLabel?: string; metric: ChartMetric; onStrike?: (source: StrategyState, id: string, strike: number, group: boolean, step?: -1 | 1) => StrategyState; onStrikeCommit?: (source: StrategyState, next: StrategyState) => void; onDragStart?: () => void; readOnly?: boolean }) {
  const [preview, setPreview] = useState<{ source: StrategyState; next: StrategyState }>()
  const state = preview?.source === sourceState ? preview.next : sourceState
  const [dragError, setDragError] = useState('')
  const [moveAll, setMoveAll] = useState(false)
  const svgId = useId()
  const basis = pnlDisplayBasis(state, pnlDisplay)
  const comparisonBasis = comparison ? pnlDisplayBasis(comparison, pnlDisplay) : basis
  const label = metric === 'pnl' ? basis?.label ?? 'Unavailable' : chartMetrics[metric].label
  const unit = metric === 'pnl' ? basis?.unit ?? '' : chartMetrics[metric].unit
  const profitColor = metric === 'pnl' && pnlDisplay !== 'position-value'
  const format = (value: number) => metric === 'pnl' ? unit === '%' ? `${signed(value, 2)}%` : money(value) : signed(value, metric === 'gamma' ? 3 : 2)
  const chart = useRef<SVGSVGElement>(null)
  const [{ width, height }, setSize] = useState({ width: 800, height: 215 })
  useEffect(() => {
    const element = chart.current
    if (!element) return
    const observer = new ResizeObserver(([entry]) => setSize({ width: entry.contentRect.width, height: entry.contentRect.height }))
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  const pad = { top: 24, right: 28, bottom: 44, left: 64 }
  const [dragRange, setDragRange] = useState<[number, number] | null>(null)
  const strikes = [...state.legs, ...(comparison?.legs ?? [])].map((leg) => leg.strike)
  const coordinates = [state.spot, state.scenarioSpot, ...strikes, ...(comparison ? [comparison.spot, comparison.scenarioSpot] : [])]
  const low = Math.min(...coordinates)
  const high = Math.max(...coordinates)
  const margin = Math.max(5, (high - low) * .35)
  const [minSpot, maxSpot] = dragRange ?? (range ? [range.min, range.max] : [Math.max(0, low - margin), high + margin])
  const [curveResult, setCurveResult] = useState<{ state: StrategyState; comparison?: StrategyState; minSpot: number; maxSpot: number; metric: ChartMetric; value?: NonNullable<Awaited<ReturnType<typeof requestWorkspaceValuation>>['curve']>; error?: string }>()
  const [curveAttempt, setCurveAttempt] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    const source = { state, comparison, minSpot, maxSpot, metric }
    requestWorkspaceValuation(state, controller.signal, { kind: 'curve', min: minSpot, max: maxSpot, metric, comparison }).then(result => {
      if (!controller.signal.aborted && result.curve) setCurveResult({ ...source, value: result.curve })
    }).catch(error => {
      if (!controller.signal.aborted) setCurveResult({ ...source, error: error instanceof Error ? error.message : 'Curve calculation failed.' })
    })
    return () => controller.abort()
  }, [state, comparison, minSpot, maxSpot, metric, curveAttempt])
  const currentResult = curveResult?.state === state && curveResult.comparison === comparison && curveResult.minSpot === minSpot && curveResult.maxSpot === maxSpot && curveResult.metric === metric ? curveResult : undefined
  const curve = currentResult?.value
  const showBreakevens = state === sourceState && !!curve && !!breakevens && metric === 'pnl' && pnlDisplay === 'pnl'
  const transform = (values: NonNullable<typeof curve>['points'], display = basis) => metric === 'pnl' && display ? values.map(point => ({ ...point, value: displayPnl(point.value, display) })) : values
  const points = transform(curve?.points ?? [])
  const expiration = transform(curve?.expiration ?? [])
  const compared = transform(curve?.compared ?? [], comparisonBasis)
  const allPnls = [...points, ...expiration, ...compared].map((point) => point.value)
  const maxAbs = Math.max(metric === 'pnl' ? unit === '%' ? 1 : 100 : 0.000001, ...allPnls.map(Math.abs))
  const x = (spot: number) => pad.left + ((spot - minSpot) / (maxSpot - minSpot)) * (width - pad.left - pad.right)
  const y = (pnl: number) => pad.top + ((maxAbs - pnl) / (maxAbs * 2)) * (height - pad.top - pad.bottom)
  const path = points.map((point, index) => `${index ? 'L' : 'M'} ${x(point.spot).toFixed(1)} ${y(point.value).toFixed(1)}`).join(' ')
  const comparisonPath = compared.map((point, index) => `${index ? 'L' : 'M'} ${x(point.spot).toFixed(1)} ${y(point.value).toFixed(1)}`).join(' ')
  const expiryPath = expiration.map((point, index) => `${index ? 'L' : 'M'} ${x(point.spot).toFixed(1)} ${y(point.value).toFixed(1)}`).join(' ')
  const area = curve ? `${path} L ${x(maxSpot)} ${y(0)} L ${x(minSpot)} ${y(0)} Z` : ''
  const [hover, setHover] = useState<{ spot: number; value: number; px: number; py: number } | null>(null)
  const [keyboardIndex, setKeyboardIndex] = useState(50)
  const dragRef = useRef<StrikeDrag | null>(null)
  const endDrag = (pointerId: number, cancel = false) => {
    const drag = dragRef.current
    const result = strikeDrag(drag, { kind: 'end', pointerId, cancel }, sourceState, readOnly)
    if (result.drag === drag) return
    dragRef.current = result.drag
    setPreview(undefined)
    setDragRange(null)
    if (result.commit) onStrikeCommit?.(result.commit.source, result.commit.next)
  }
  useLayoutEffect(() => {
    if (dragRef.current && (dragRef.current.source !== sourceState || readOnly)) endDrag(dragRef.current.pointerId, true)
  }, [sourceState, readOnly])
  useLayoutEffect(() => setHover(null), [state, metric, pnlDisplay, comparison, minSpot, maxSpot])

  const move = (clientX: number, bounds: DOMRect, pointerId: number) => {
    const px = Math.min(width - pad.right, Math.max(pad.left, ((clientX - bounds.left) / bounds.width) * width))
    const spot = minSpot + ((px - pad.left) / (width - pad.left - pad.right)) * (maxSpot - minSpot)
    const drag = dragRef.current
    if (drag && drag.pointerId !== pointerId) return
    if (drag && canMoveStrikeDrag(drag, pointerId, sourceState, readOnly)) {
      const requested = drag.strike + (clientX - drag.startX) / bounds.width * width / (width - pad.left - pad.right) * (maxSpot - minSpot)
      try {
        const next = onStrike?.(drag.source, drag.id, requested, drag.group) ?? drag.source
        if (!pnlDisplayBasis(next, pnlDisplay)) throw new Error('Choose P/L to preview a position without a positive exact expiry loss bound.')
        dragRef.current = strikeDrag(drag, { kind: 'preview', pointerId, next }, sourceState, readOnly).drag
        setPreview({ source: drag.source, next })
        setDragError('')
      } catch (error) {
        dragRef.current = strikeDrag(drag, { kind: 'preview', pointerId, next: drag.source }, sourceState, readOnly).drag
        setPreview(undefined)
        setDragError(error instanceof Error ? error.message : 'Strike movement unavailable.')
      }
    }
    if (!points.length) { setHover(null); return }
    const nearest = points.reduce((best, point) => Math.abs(point.spot - spot) < Math.abs(best.spot - spot) ? point : best)
    setHover({ spot: nearest.spot, value: nearest.value, px: x(nearest.spot), py: y(nearest.value) })
  }

  if (!basis || !comparisonBasis) return <p role="status">Risk percent unavailable: both positions need a positive exact expiry loss bound.</p>
  return (
    <div className="chart-wrap">
      {!curve && <p role="status" className="curve-status">{currentResult?.error ? <>{currentResult.error} <button onClick={() => { setCurveResult(undefined); setCurveAttempt(value => value + 1) }}>Retry curve calculation</button></> : 'Calculating current curve…'}</p>}
      <svg
        ref={chart}
        className="payoff-chart"
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-busy={!curve}
        tabIndex={0}
        aria-label={`${state.name} ${metric === 'pnl' && pnlDisplay === 'pnl' ? 'profit and loss' : label} curve`}
        onKeyDown={(event) => {
          if (!points.length || event.target !== event.currentTarget || !['ArrowLeft', 'ArrowRight'].includes(event.key)) return
          const index = Math.max(0, Math.min(points.length - 1, keyboardIndex + (event.key === 'ArrowLeft' ? -1 : 1)))
          const point = points[index]
          setKeyboardIndex(index)
          setHover({ spot: point.spot, value: point.value, px: x(point.spot), py: y(point.value) })
          event.preventDefault()
        }}
        onPointerMove={(event) => move(event.clientX, event.currentTarget.getBoundingClientRect(), event.pointerId)}
        onPointerLeave={() => { if (!dragRef.current) setHover(null) }}
        onPointerUp={event => endDrag(event.pointerId)}
        onPointerCancel={event => endDrag(event.pointerId, true)}
        onLostPointerCapture={event => endDrag(event.pointerId, true)}
      >
        <defs>
          <linearGradient id={`${svgId}-profitArea`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#41d6a3" stopOpacity=".25" />
            <stop offset="1" stopColor="#41d6a3" stopOpacity="0" />
          </linearGradient>
          <linearGradient id={`${svgId}-lossArea`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#ff7375" stopOpacity="0" />
            <stop offset="1" stopColor="#ff7375" stopOpacity=".2" />
          </linearGradient>
          <clipPath id={`${svgId}-profitClip`}><rect x="0" y="0" width={width} height={y(0)} /></clipPath>
          <clipPath id={`${svgId}-lossClip`}><rect x="0" y={y(0)} width={width} height={height - y(0)} /></clipPath>
          <clipPath id={`${svgId}-plotClip`}><rect x={pad.left} y={pad.top} width={Math.max(0, width - pad.left - pad.right)} height={height - pad.top - pad.bottom} /></clipPath>
          <filter id={`${svgId}-glow`}><feGaussianBlur stdDeviation="4" result="blur" /><feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
        </defs>
        {curve && [0, .25, .5, .75, 1].map((t) => {
          const yy = pad.top + t * (height - pad.top - pad.bottom)
          const value = maxAbs - t * maxAbs * 2
          return <g key={t}><line x1={pad.left} x2={width - pad.right} y1={yy} y2={yy} className={t === .5 ? 'zero-grid' : 'grid'} /><text x={pad.left - 12} y={yy + 4} textAnchor="end" className="axis-label">{format(value)}</text></g>
        })}
        {[0, .25, .5, .75, 1].map((t) => {
          const xx = pad.left + t * (width - pad.left - pad.right)
          const value = minSpot + t * (maxSpot - minSpot)
          return <g key={t}><line x1={xx} x2={xx} y1={pad.top} y2={height - pad.bottom} className="grid vertical" /><text x={xx} y={height - 17} textAnchor="middle" className="axis-label">${value.toFixed(range ? 2 : 0)}</text></g>
        })}
        {profitColor ? <>
        <path d={area} fill={`url(#${svgId}-profitArea)`} clipPath={`url(#${svgId}-profitClip)`} />
        <path d={area} fill={`url(#${svgId}-lossArea)`} clipPath={`url(#${svgId}-lossClip)`} />
        {state.legs.length > 0 && <path d={expiryPath} data-as-of={new Date(Math.min(...state.legs.map(leg => Date.parse(leg.expiry)))).toISOString()} className="expiry-reference" fill="none" stroke="#a0adc1" strokeWidth="1.5" strokeDasharray="3 5" />}
        <path d={path} className="payoff-line under" />
        <path d={path} className="payoff-line profit-line" clipPath={`url(#${svgId}-profitClip)`} filter={`url(#${svgId}-glow)`} />
        <path d={path} className="payoff-line loss-line" clipPath={`url(#${svgId}-lossClip)`} />
        </> : <path d={path} className="greek-line" fill="none" stroke="var(--cobalt)" strokeWidth="2.6" />}
        {metric === 'pnl' && !profitColor && <path d={expiryPath} className="expiry-reference" fill="none" stroke="#a0adc1" strokeWidth="1.5" strokeDasharray="3 5" />}
        {comparison && <path d={comparisonPath} className="proposal-line" fill="none" stroke="#b2a0ff" strokeWidth="3" strokeDasharray="8 6" />}
        {showBreakevens && <g className="breakeven-markers" data-as-of={breakevens.date} clipPath={`url(#${svgId}-plotClip)`}>
          {breakevens.candidates.filter(candidate => candidate.upper >= minSpot && candidate.lower <= maxSpot).map(candidate => <rect key={candidate.lower} className={candidate.kind} data-lower={candidate.lower} data-upper={candidate.upper} x={x(Math.max(minSpot, candidate.lower)) - 1} width={Math.max(2, x(Math.min(maxSpot, candidate.upper)) - x(Math.max(minSpot, candidate.lower)))} y={y(0) - 8} height="16"><title>First-expiry {candidate.kind} candidate: ${candidate.lower.toFixed(4)} to ${candidate.upper.toFixed(4)}</title></rect>)}
          {breakevens.evaluatedZeros.filter(spot => spot >= minSpot && spot <= maxSpot).map(spot => <circle key={spot} cx={x(spot)} cy={y(0)} r="4"><title>First-expiry evaluated zero P/L at ${spot.toFixed(4)}</title></circle>)}
        </g>}
        {state.spot >= minSpot && state.spot <= maxSpot && <g><line x1={x(state.spot)} x2={x(state.spot)} y1={pad.top} y2={height - pad.bottom} className="spot-line" />
        <text x={x(state.spot)} y={15} textAnchor="middle" className="spot-label">SPOT {state.spot.toFixed(2)}</text></g>}
        {curve && state.scenarioSpot >= minSpot && state.scenarioSpot <= maxSpot && <g className="scenario-target" data-spot={state.scenarioSpot}><line x1={x(state.scenarioSpot)} x2={x(state.scenarioSpot)} y1={pad.top} y2={height - pad.bottom} /><circle cx={x(state.scenarioSpot)} cy={y(metric === 'pnl' ? displayPnl(curve.target, basis) : curve.target)} r="5" /><text x={x(state.scenarioSpot)} y={30} textAnchor="middle">TARGET {state.scenarioSpot.toFixed(2)}</text></g>}
        {state.legs.map((leg, index) => (leg.strike >= minSpot && leg.strike <= maxSpot &&
          <g
            key={leg.id}
            className={`strike-marker${readOnly ? ' readonly' : ''}`}
            transform={`translate(${x(leg.strike)} 0)`}
            tabIndex={readOnly ? undefined : 0}
            role={readOnly ? 'img' : 'slider'}
            aria-label={`${leg.side} ${leg.type} strike`}
            aria-valuenow={readOnly ? undefined : leg.strike}
            aria-description={readOnly ? undefined : 'Hypothetical strike edit. Shift plus arrow keys or Shift-drag moves all option strikes together.'}
            onKeyDown={readOnly ? undefined : (event) => {
              if (event.key === 'Escape' && dragRef.current) { endDrag(dragRef.current.pointerId, true); event.preventDefault(); return }
              if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
                if (dragRef.current) return
                try {
                  const next = onStrike?.(sourceState, leg.id, leg.strike, event.shiftKey || moveAll, event.key === 'ArrowLeft' ? -1 : 1)
                  if (next && next !== sourceState) onStrikeCommit?.(sourceState, next)
                  setDragError('')
                } catch (error) { setDragError(error instanceof Error ? error.message : 'Strike movement unavailable.') }
                event.stopPropagation()
                event.preventDefault()
              }
            }}
            onPointerDown={readOnly ? undefined : (event) => {
              const result = strikeDrag(dragRef.current, { kind: 'start', primary: event.isPrimary, button: event.button, drag: { pointerId: event.pointerId, source: sourceState, next: sourceState, id: leg.id, group: event.shiftKey || moveAll, startX: event.clientX, strike: leg.strike } }, sourceState, readOnly)
              if (result.drag === dragRef.current) return
              dragRef.current = result.drag
              onDragStart?.()
              setDragError('')
              setDragRange([minSpot, maxSpot])
              event.currentTarget.setPointerCapture(event.pointerId)
              event.currentTarget.focus()
              event.preventDefault()
            }}
          >
            <line y1={height - pad.bottom - 18 - index * 30} y2={height - pad.bottom + 6} />
            <rect x="-31" y={height - pad.bottom - 44 - index * 30} width="62" height="26" rx="5" />
            <text y={height - pad.bottom - 26 - index * 30} textAnchor="middle" fontSize="13">{leg.side === 'long' ? 'B' : 'S'} {leg.strike}</text>
          </g>
        ))}
        {curve && hover && <g className="chart-hover"><line x1={hover.px} x2={hover.px} y1={pad.top} y2={height - pad.bottom} /><circle cx={hover.px} cy={hover.py} r="5" /><g transform={`translate(${Math.min(width - 168, hover.px + 12)} ${Math.max(12, hover.py - 54)})`}><rect width="148" height="44" rx="6" /><text x="10" y="17">{state.underlying} ${hover.spot.toFixed(2)}</text><text x="10" y="34" className={!profitColor ? undefined : hover.value >= 0 ? 'positive-text' : 'negative-text'}>{format(hover.value)} {metric === 'pnl' && pnlDisplay !== 'pnl' ? '' : label}</text></g></g>}
      </svg>
      {dragError && <p role="alert">{dragError}</p>}
      {!readOnly && <label><input type="checkbox" checked={moveAll} onChange={event => setMoveAll(event.target.checked)} /> Move all strikes</label>}
      {!readOnly && <p className="heatmap-help">Hypothetical editing · Shift-drag a strike or use Shift + arrow keys to move all option strikes together. Escape cancels a drag.</p>}
      {state !== sourceState && <p role="status">Hypothetical chart preview · release to apply; Escape cancels. Position totals remain unchanged until applied.</p>}
      {showBreakevens && <p className="breakeven-caption">First-expiry candidates · {shortDate(breakevens.date)} · outlined intervals, dots for evaluated zeros. Not exact breakevens.</p>}
      {curve && hover && <output className="sr-only" aria-live="polite">On {state.scenarioDate}, {state.underlying} ${hover.spot.toFixed(2)}, modeled {metric === 'pnl' && pnlDisplay === 'pnl' ? 'profit and loss' : label} {format(hover.value)} {unit}</output>}
      <div className="chart-caption"><span><i className={profitColor ? 'key curve' : 'key greek'} />Scenario · {shortDate(state.scenarioDate)}</span>{metric === 'pnl' && state.legs.length > 0 && <span><i className="key current" />{state.legs.some((leg) => leg.expiry !== state.legs[0].expiry) ? 'First-expiry reference' : 'Expiration reference'}</span>}{comparison && <span><i className="comparison-key" />{comparisonLabel} · same date</span>}{metric !== 'pnl' && <span>{label} · {chartMetrics[metric].unit} · modeled exposure, not P/L</span>}<span className="drag-hint">{readOnly ? 'Read-only · arrow keys to inspect' : 'Drag a strike · arrow keys to inspect'}</span></div>
    </div>
  )
}

function AmericanHeatmap({ state, pnlDisplay = 'pnl', range }: { state: StrategyState; pnlDisplay?: PnlDisplayMode; range?: ChartRange }) {
  const [result, setResult] = useState<{ source: StrategyState; range?: ChartRange; surface: Awaited<ReturnType<typeof requestAmericanSurface>> } | null>(null)
  const [error, setError] = useState<{ source: StrategyState; range?: ChartRange; message: string } | null>(null)
  useEffect(() => {
    const controller = new AbortController()
    void requestAmericanSurface(state, controller.signal, range).then(surface => {
      if (!controller.signal.aborted) setResult({ source: state, range, surface })
    }).catch(() => {
      if (!controller.signal.aborted) setError({ source: state, range, message: 'American preview unavailable for these inputs. Return to European valuation or change the position.' })
    })
    return () => controller.abort()
  }, [state, range])
  if (error?.source === state && error.range === range) return <div className="calculation-error" role="alert">{error.message}</div>
  if (result?.source !== state || result.range !== range) return <div className="heatmap-canvas-wrap" role="status" aria-live="polite"><p>Calculating American comparison… You can keep editing; obsolete calculations are cancelled.</p></div>
  return <Heatmap state={state} pnlDisplay={pnlDisplay} points={result.surface.points} readOnly onSelect={() => {}} />
}

function Heatmap({ state, onSelect, points, error, readOnly = false, pnlDisplay = 'pnl' }: { pnlDisplay?: PnlDisplayMode; state: StrategyState; onSelect: (scenario: { scenarioDate: string; scenarioSpot: number }) => void; points?: Awaited<ReturnType<typeof requestAmericanSurface>>['points'] | null; error?: string; readOnly?: boolean }) {
  const basis = pnlDisplayBasis(state, pnlDisplay)!
  const canvas = useRef<HTMLCanvasElement>(null)
  const [hover, setHover] = useState<{ x: number; y: number; spot: number; date: string; pnl: number } | null>(null)
  const cols = 44
  const rows = 18
  const plot = { left: 48, top: 12, right: 12, bottom: 30 }
  const firstExpiry = Math.min(...state.legs.map((leg) => +new Date(leg.expiry)))
  const minSpot = points?.[0]?.spot ?? Math.min(state.spot * .76, state.scenarioSpot, ...state.legs.map(leg => leg.strike))
  const maxSpot = points?.[43]?.spot ?? Math.max(state.spot * 1.24, state.scenarioSpot, ...state.legs.map(leg => leg.strike))
  const pointAt = (col: number, row: number) => {
    const point = points![row * cols + col]
    return { ...point, pnl: displayPnl(point.pnl, basis), date: new Date(point.date) }
  }
  useLayoutEffect(() => {
    const element = canvas.current
    if (!element) return
    const ctx = element.getContext('2d')
    if (!ctx) return
    if (!points) { ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, element.width, element.height); setHover(null); return }
    const draw = () => {
    setHover(null)
    const ratio = window.devicePixelRatio || 1
    const bounds = element.getBoundingClientRect()
    element.width = bounds.width * ratio
    element.height = bounds.height * ratio
    ctx.scale(ratio, ratio)
    const plotWidth = bounds.width - plot.left - plot.right
    const plotHeight = bounds.height - plot.top - plot.bottom
    const values: number[] = []
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        values.push(pointAt(col, row).pnl)
      }
    }
    const limit = Math.max(basis.unit === '%' ? 1 : 100, ...values.map(Math.abs))
    values.forEach((value, index) => {
      const strength = Math.min(1, Math.abs(value) / limit)
      const row = Math.floor(index / cols)
      const col = index % cols
      ctx.fillStyle = pnlDisplay === 'position-value' ? `rgba(117, 153, 233, ${.08 + strength * .62})` : value >= 0 ? `rgba(34, 179, 132, ${.08 + strength * .62})` : `rgba(231, 92, 94, ${.08 + strength * .62})`
      ctx.fillRect(plot.left + col * plotWidth / cols, plot.top + row * plotHeight / rows, plotWidth / cols + 1, plotHeight / rows + 1)
    })
    ctx.fillStyle = '#61707c'
    ctx.font = '12px Cascadia Code, monospace'
    ctx.textAlign = 'center'
    for (let index = 0; index < 5; index++) {
      const col = Math.round(index * (cols - 1) / 4)
      const point = pointAt(col, 0)
      ctx.fillText(`$${point.spot.toFixed(point.spot < 1 ? 2 : 0)}`, plot.left + (col + .5) * plotWidth / cols, bounds.height - 8)
    }
    ctx.textAlign = 'right'
    for (let index = 0; index < 4; index++) {
      const row = Math.round(index * (rows - 1) / 3)
      const point = pointAt(0, row)
      ctx.fillText(shortDate(point.date.toISOString()), plot.left - 7, plot.top + (row + .5) * plotHeight / rows + 3)
    }
    const selectedX = plot.left + (.5 + (state.scenarioSpot - minSpot) / (maxSpot - minSpot) * (cols - 1)) * plotWidth / cols
    const selectedY = plot.top + (.5 + (Date.parse(state.scenarioDate) - Date.parse(state.valuationTimestamp)) / (firstExpiry - Date.parse(state.valuationTimestamp)) * (rows - 1)) * plotHeight / rows
    if (selectedX >= plot.left && selectedX <= bounds.width - plot.right) {
      ctx.strokeStyle = '#f1f4fa'; ctx.lineWidth = 2
      ctx.beginPath(); ctx.arc(selectedX, selectedY, 5, 0, Math.PI * 2); ctx.stroke()
    }
    }
    draw()
    const observer = new ResizeObserver(draw)
    observer.observe(element)
    return () => observer.disconnect()
  }, [state, points, pnlDisplay])
  const selectCell = (col: number, row: number, x = 320, y = 120) => {
    const point = pointAt(Math.max(0, Math.min(cols - 1, col)), Math.max(0, Math.min(rows - 1, row)))
    setHover({ x, y, spot: point.spot, date: point.date.toISOString(), pnl: point.pnl })
  }
  const pointerCell = (clientX: number, clientY: number, bounds: DOMRect) => {
    const x = clientX - bounds.left, y = clientY - bounds.top
    const width = bounds.width - plot.left - plot.right, height = bounds.height - plot.top - plot.bottom
    if (x < plot.left || x > bounds.width - plot.right || y < plot.top || y > bounds.height - plot.bottom) return null
    const point = pointAt(Math.min(cols - 1, Math.floor((x - plot.left) / width * cols)), Math.min(rows - 1, Math.floor((y - plot.top) / height * rows)))
    return { x, y, spot: point.spot, date: point.date.toISOString(), pnl: point.pnl }
  }
  return <div className="heatmap-canvas-wrap">{!points && <p role="status">{error ? 'Heatmap unavailable. Retry the position calculation above.' : 'Calculating current heatmap…'}</p>}<canvas ref={canvas} className="heatmap" tabIndex={points ? 0 : -1} aria-busy={!points} aria-label={pnlDisplay !== 'pnl' ? `${basis.label} ${basis.unit} price by time field. Arrow keys inspect${readOnly ? '; read-only.' : '; Enter or Space selects a scenario.'}` : readOnly ? 'American valuation comparison. Arrow keys inspect. Read-only preview.' : 'Modeled price by time profit and loss field. Arrow keys inspect; Enter or Space selects a scenario.'} onClick={event => {
    if (!points) return
    const point = pointerCell(event.clientX, event.clientY, event.currentTarget.getBoundingClientRect())
    if (point && !readOnly) onSelect({ scenarioDate: point.date, scenarioSpot: point.spot })
  }} onKeyDown={(event) => {
    if (!points) return
    const currentCol = Math.round(((hover?.spot ?? state.scenarioSpot) - minSpot) / (maxSpot - minSpot) * (cols - 1))
    const currentRow = Math.round((Date.parse(hover?.date ?? state.scenarioDate) - Date.parse(state.valuationTimestamp)) / (firstExpiry - Date.parse(state.valuationTimestamp)) * (rows - 1))
    if (event.key === 'ArrowLeft') selectCell(currentCol - 1, currentRow)
    else if (event.key === 'ArrowRight') selectCell(currentCol + 1, currentRow)
    else if (event.key === 'ArrowUp') selectCell(currentCol, currentRow - 1)
    else if (event.key === 'ArrowDown') selectCell(currentCol, currentRow + 1)
    else if ((event.key === 'Enter' || event.key === ' ') && hover && !readOnly) onSelect({ scenarioDate: hover.date, scenarioSpot: hover.spot })
    else return
    event.preventDefault()
  }} onPointerLeave={() => setHover(null)} onPointerMove={(event) => {
    if (!points) return
    const bounds = event.currentTarget.getBoundingClientRect()
    setHover(pointerCell(event.clientX, event.clientY, bounds))
  }} />{hover && <output aria-live="polite" className="heatmap-tooltip" style={{ left: Math.max(4, Math.min(hover.x + 12, (canvas.current?.clientWidth ?? 0) - 210)), top: Math.max(4, hover.y - 56) }}><b>{hover.date.slice(0, 16).replace('T', ' ')} UTC</b><span>{state.underlying} ${hover.spot.toFixed(2)} · {signed(hover.pnl)} {basis.unit} {basis.label}</span></output>}</div>
}

function LegRow({ leg, snapshot, fixedEntry, included, onInclude, onChange, onRemove }: { leg: OptionLeg; snapshot?: MarketSnapshot; fixedEntry?: boolean; included: boolean; onInclude: () => void; onChange: (patch: Partial<OptionLeg>) => void; onRemove: () => void }) {
  const expiries = snapshot ? [...new Set(snapshot.contracts.filter((c) => c.type === leg.type && c.strike === leg.strike).map((c) => c.expiry))] : SAMPLE_EXPIRIES
  const strikes = snapshot ? [...new Set(snapshot.contracts.filter((c) => c.type === leg.type && c.expiry === leg.expiry).map((c) => c.strike))].sort((a,b) => a-b) : SAMPLE_STRIKES
  const quote = snapshot?.contracts.find((c) => c.contractId === leg.contractId)
  const selectContract = (patch: Partial<Pick<OptionLeg, 'type' | 'strike' | 'expiry'>>) => {
    const type = patch.type ?? leg.type
    const strike = patch.strike ?? leg.strike
    const expiry = patch.expiry ?? leg.expiry
    if (snapshot) {
      const contract = snapshot.contracts.find((c) => c.type === type && c.strike === strike && c.expiry === expiry)
      if (contract) onChange({ ...patch, contractId: contract.contractId })
    } else onChange({ ...patch, contractId: sampleContractId(type, strike, expiry) })
  }
  return (
    <div className="leg-row">
      <span className={`leg-index ${leg.side}`}><input type="checkbox" aria-label={`Include ${leg.id} in analysis`} checked={included} onChange={onInclude} /></span>
      <select aria-label="Position side" value={leg.side} onChange={(event) => onChange({ side: event.target.value as OptionLeg['side'] })}><option value="long">Buy</option><option value="short">Sell</option></select>
      <select aria-label="Option type" value={leg.type} onChange={(event) => selectContract({ type: event.target.value as OptionLeg['type'] })}><option value="call" disabled={!!snapshot && !snapshot.contracts.some(c => c.type === 'call' && c.strike === leg.strike && c.expiry === leg.expiry)}>Call</option><option value="put" disabled={!!snapshot && !snapshot.contracts.some(c => c.type === 'put' && c.strike === leg.strike && c.expiry === leg.expiry)}>Put</option></select>
      <label><span>Qty</span><input aria-label="Contracts" type="number" min="1" max="20" value={leg.contracts} onChange={(event) => { const value = Number(event.target.value); if (Number.isInteger(value) && value >= 1 && value <= 20) onChange({ contracts: value }) }} /></label>
      <label><span>Expiry</span><select aria-label="Expiry" value={leg.expiry} onChange={(event) => selectContract({ expiry: event.target.value })}>{expiries.map((expiry) => <option key={expiry} value={expiry}>{shortDate(expiry)}</option>)}</select></label>
      <label><span>Strike</span><div className="money-input"><b>$</b><select aria-label="Strike" value={leg.strike} onChange={(event) => selectContract({ strike: Number(event.target.value) })}>{strikes.map((strike) => <option key={strike} value={strike}>{strike}</option>)}</select></div></label>
      <label><span>{fixedEntry ? 'Entry cost' : 'Premium'}</span><div className="money-input"><b>$</b><input aria-label="Entry premium" readOnly={!!snapshot && !fixedEntry} title={quote ? `Bid $${quote.bid} / Ask $${quote.ask}` : undefined} type="number" step=".05" min="0" value={leg.entryPrice} onChange={(event) => { const value = Number(event.target.value); if (Number.isFinite(value) && value >= 0) onChange({ entryPrice: value }) }} /></div></label>
      <label><span>IV</span><div className="money-input"><input aria-label="Implied volatility" readOnly={!!snapshot} type="number" step="1" min="1" value={snapshot ? Number((leg.iv * 100).toFixed(2)) : Math.round(leg.iv * 100)} onChange={(event) => { const value = Number(event.target.value) / 100; if (Number.isFinite(value) && value > 0) onChange({ iv: value }) }} /><b>%</b></div></label>
      <button className="icon-button remove" onClick={onRemove} aria-label="Remove leg">×</button>
      {quote && <small className="contract-quote">Bid ${quote.bid.toFixed(2)} / Ask ${quote.ask.toFixed(2)} · {quote.quoteAsOf} · OI {quote.openInterest ?? '—'} · Volume {quote.volume ?? '—'}</small>}
      {!included && <small className="contract-quote">Excluded from analysis · holding and entry cost retained</small>}
    </div>
  )
}

type ChatMessage = { role: 'guide' | 'user' | 'argus'; text: string; note?: string; analysis?: Pick<SparringSuccess, 'reply' | 'calculated' | 'market_context'> & { positionVersion: number; positionName: string; positionUnderlying: string; position: StrategyState; positionSnapshot?: MarketSnapshot } }
type PendingProposal = Omit<SparringSuccess, 'calculated' | 'market_context'> & Partial<Pick<SparringSuccess, 'calculated' | 'market_context'>> & { before: SparringSuccess['metrics']; comparisonBaseline?: StrategyState; comparisonUnavailable?: string; lossBound?: ReturnType<typeof firstExpirySpreadLossBound> }
type SavedSummary = { id: string; title: string; revision: number; updatedAt: string }
type SavedRecord = SavedSummary & { state: StrategyState; snapshot: MarketSnapshot | null }
const workspaceContent = (state: StrategyState, title: string) => JSON.stringify([title.trim() || state.name, { ...state, version: 0 }])

const initialTemplate = (): TemplateId => {
  const requested = new URLSearchParams(window.location.search).get('template')
  return TEMPLATES.some((template) => template.id === requested) ? requested as TemplateId : 'iron-condor'
}

function ChartRangeControls({ spot, range, onChange }: { spot: number; range?: ChartRange; onChange: (range?: ChartRange) => void }) {
  const [min, setMin] = useState(String(Number((spot * .8).toFixed(2))))
  const [max, setMax] = useState(String(Number((spot * 1.2).toFixed(2))))
  const [error, setError] = useState('')
  return <form className="chart-range" aria-label="Chart price range" onSubmit={event => {
    event.preventDefault()
    const next = { min: Number(min), max: Number(max) }
    if (!isChartRange(next)) { setError('Enter positive bounds with From below To, up to $1,000,000.'); return }
    setError('')
    if (next.min !== range?.min || next.max !== range?.max) onChange(next)
  }}>
    <span className="range-heading">PRICE RANGE</span>
    <label>From $<input aria-label="Chart range from" type="number" step="any" min="0.00000001" max="1000000" required value={min} onChange={event => setMin(event.target.value)} /></label>
    <label>To $<input aria-label="Chart range to" type="number" step="any" min="0.00000001" max="1000000" required value={max} onChange={event => setMax(event.target.value)} /></label>
    <button type="submit">Apply range</button><button type="button" disabled={!range} onClick={() => { onChange(); setError('') }}>Auto range</button>
    <output aria-live="polite">{range ? `$${range.min}–$${range.max} · all views` : 'Auto · fitted per view'}</output>
    {error && <span role="alert">{error}</span>}
  </form>
}

export function App() {
  const [templateQuery, setTemplateQuery] = useState('')
  const [templateFamily, setTemplateFamily] = useState('All families')
  const params = useMemo(() => new URLSearchParams(window.location.search), [])
  const [strategy, setStrategy] = useState<StrategyState>(() => {
    const initial = createStrategy(initialTemplate())
    return params.get('custom') === '1' ? { ...initial, name: 'Custom strategy' } : initial
  })
  const [history, setHistory] = useState<StrategyState[]>([])
  const analysisState = useMemo(() => projectAnalysisPosition(strategy), [strategy])
  const hasExclusions = !!strategy.excludedLegIds?.length
  const analysisUnavailable = !analysisState
  const [rangeSelection, setRangeSelection] = useState<{ underlying: string; value: ChartRange }>()
  const chartRange = rangeSelection?.underlying === strategy.underlying ? rangeSelection.value : undefined
  const [breakevenResult, setBreakevenResult] = useState<BreakevenResult>()
  useEffect(() => setBreakevenResult(undefined), [strategy])
  const [snapshots, setSnapshots] = useState<Record<string, MarketSnapshot>>({})
  useEffect(() => {
    const retained = new Set([strategy, ...history].map(state => state.pricing?.snapshotId))
    setSnapshots(items => Object.keys(items).every(id => retained.has(id)) ? items : Object.fromEntries(Object.entries(items).filter(([id]) => retained.has(id))))
  }, [strategy, history])
  const [chainPending, setChainPending] = useState(false)
  const [automatic, setAutomatic] = useState(false)
  const automaticRef = useRef(false)
  const automaticGeneration = useRef(0)
  const automaticCheckpoint = useRef(false)
  const stopAutomatic = () => { automaticGeneration.current++; automaticRef.current = false; setAutomatic(false) }
  const [symbolDraft, setSymbolDraft] = useState('SPY')
  useEffect(() => setSymbolDraft(strategy.underlying), [strategy.underlying])
  const chainRequest = useRef(0)
  const [windowDates, setWindowDates] = useState<string[]>([])
  const [strikeCenter, setStrikeCenter] = useState('')
  const marketSnapshot = strategy.pricing ? snapshots[strategy.pricing.snapshotId] : undefined
  const contractTerms = contractTermsFacts(marketSnapshot)
  const quoteMark = useMemo(() => marketSnapshot && analysisState ? quoteValuation(analysisState, marketSnapshot) : null, [analysisState, marketSnapshot])
  useEffect(() => { if (marketSnapshot) { setWindowDates([...new Set(marketSnapshot.contracts.map(c => c.expiry.slice(0,10)))].sort()); setStrikeCenter(String(marketSnapshot.strikeCenter ?? marketSnapshot.spot)) } }, [marketSnapshot?.id])
  const [view, setView] = useState<'curve' | 'heatmap' | 'table'>(() => new URLSearchParams(window.location.search).get('view') === 'heatmap' ? 'heatmap' : 'curve')
  const [americanPreview, setAmericanPreview] = useState(false)
  const americanPreviewActive = useRef(false)
  americanPreviewActive.current = view === 'heatmap' && americanPreview && strategy.valuationModel !== 'american-crr-1024-v1'
  const [chartMetric, setChartMetric] = useState<ChartMetric>('pnl')
  const [pnlDisplay, setPnlDisplay] = useState<PnlDisplayMode>('pnl')
  const activePnlDisplay = view === 'curve' && chartMetric !== 'pnl' ? 'pnl' : pnlDisplay
  const displayBasis = analysisState ? pnlDisplayBasis(analysisState, activePnlDisplay) : null
  const [composer, setComposer] = useState('')
  const [pending, setPending] = useState(false)
  const reviewRequest = useRef<AbortController | null>(null)
  const reviewGeneration = useRef(0)
  useEffect(() => () => { reviewRequest.current?.abort(); reviewRequest.current = null }, [])
  const timeDrag = useRef<boolean | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const conversationPane = useRef<HTMLDivElement>(null)
  const [thesis, setThesis] = useState('')
  const [editError, setEditError] = useState('')
  const [proposal, setProposal] = useState<PendingProposal | null>(null)
  const [manualBaseline, setManualBaseline] = useState<StrategyState>()
  const [session, setSession] = useState<{ label: string; local: boolean; recoveryKey: string } | null>(null)
  const [saved, setSaved] = useState<SavedSummary[]>([])
  const savedListRequest = useRef(0)
  const savedListController = useRef<AbortController | null>(null)
  const [savedCursor, setSavedCursor] = useState<string | null>(null)
  const [savedListPending, setSavedListPending] = useState(false)
  const [savedIdentity, setSavedIdentity] = useState<SavedSummary | null>(null)
  const [savedTitle, setSavedTitle] = useState('')
  const [savedContent, setSavedContent] = useState<string | null>(() => workspaceContent(strategy, ''))
  const unsavedChanges = savedContent !== workspaceContent(strategy, savedTitle)
  useEffect(() => {
    if (!unsavedChanges) return
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [unsavedChanges])
  const titleRef = useRef('')
  const [selectedSaved, setSelectedSaved] = useState('')
  const selectedSavedRef = useRef(selectedSaved)
  useEffect(() => { selectedSavedRef.current = selectedSaved }, [selectedSaved])
  const [lifecycleSaved, setLifecycleSaved] = useState('')
  const [lotSaved, setLotSaved] = useState('')
  const [historyOpen, setHistoryOpen] = useState(false)
  const [workspaceBusy, setWorkspaceBusy] = useState(false)
  const [workspaceNotice, setWorkspaceNotice] = useState('')
  const [workspaceError, setWorkspaceError] = useState('')
  const workspaceRequest = useRef(0)
  const refreshSaved = async (cursor?: string) => {
    if (cursor && savedListController.current) return
    const sequence = ++savedListRequest.current
    savedListController.current?.abort()
    const controller = new AbortController()
    savedListController.current = controller
    setSavedListPending(true)
    try {
      const response = await fetch(`/api/strategies${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`, { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(12000)]) })
      const body = await response.json() as { strategies: SavedSummary[]; nextCursor?: string | null; error?: { message?: string } }
      if (sequence !== savedListRequest.current) return
      if (!response.ok) throw new Error(body.error?.message ?? 'Saved strategies unavailable.')
      if (!Array.isArray(body.strategies) || body.strategies.length > 50 || body.strategies.some(item => !item || typeof item.id !== 'string' || !item.id || item.id.length > 200 || typeof item.title !== 'string' || item.title.length > 120 || !Number.isSafeInteger(item.revision) || item.revision < 1 || typeof item.updatedAt !== 'string' || !Number.isFinite(Date.parse(item.updatedAt))) || new Set(body.strategies.map(item => item.id)).size !== body.strategies.length || (body.nextCursor != null && (typeof body.nextCursor !== 'string' || !/^[A-Za-z0-9_-]{1,1024}$/.test(body.nextCursor) || body.nextCursor === cursor))) throw new Error('Saved library response is invalid. Existing selections are unchanged.')
      setSaved(items => {
        const combined = new Map((cursor ? items : []).map(item => [item.id, item]))
        for (const item of body.strategies) if (!combined.has(item.id) || combined.get(item.id)!.revision <= item.revision) combined.set(item.id, item)
        return [...combined.values()]
      })
      setSavedCursor(body.nextCursor ?? null)
      if (!cursor && selectedSavedRef.current && !body.strategies.some(item => item.id === selectedSavedRef.current)) {
        setSelectedSaved('')
        setWorkspaceNotice('Saved library refreshed. Use Load more saved positions to select an older record again. The open position is unchanged.')
      }
    } catch (error) {
      if (sequence === savedListRequest.current) throw error
    } finally {
      if (sequence === savedListRequest.current) { savedListController.current = null; setSavedListPending(false) }
    }
  }
  useEffect(() => {
    let active = true
    void fetch('/api/bootstrap').then(async response => {
      const body = await response.json() as { session: { label: string; local: boolean; recoveryKey: string }; error?: { message?: string } }
      if (!active) return
      if (!response.ok) throw new Error(body.error?.message ?? 'Private session unavailable.')
      setSession(body.session)
      await refreshSaved()
    }).catch(error => { if (active) setWorkspaceError(error instanceof Error ? error.message : 'Private workspace unavailable.') })
    return () => { active = false; savedListRequest.current++; savedListController.current?.abort() }
  }, [])
  useEffect(() => {
    const pane = conversationPane.current
    if (pane) {
      const card = pane.querySelector('.proposal-card') ?? (!pending && messages.at(-1)?.role === 'argus' ? [...pane.querySelectorAll('.message.argus')].at(-1) : null)
      pane.scrollTop = card ? pane.scrollTop + card.getBoundingClientRect().top - pane.getBoundingClientRect().top : pane.scrollHeight
    }
  }, [messages, proposal, pending])
  const [showAssumptions, setShowAssumptions] = useState(false)
  const strategyRef = useRef(strategy)
  useEffect(() => { strategyRef.current = strategy }, [strategy])
  const [valuationResult, setValuationResult] = useState<{ source: StrategyState; view?: 'table' | 'heatmap'; range?: ChartRange; value?: Awaited<ReturnType<typeof requestWorkspaceValuation>>; error?: string }>()
  const [valuationAttempt, setValuationAttempt] = useState(0)
  const valuationView = view === 'table' || (!!analysisState?.legs.length && view === 'heatmap' && (!americanPreview || strategy.valuationModel === 'american-crr-1024-v1')) ? view : undefined
  useEffect(() => {
    if (!analysisState) { setValuationResult(undefined); return }
    const controller = new AbortController()
    requestWorkspaceValuation(analysisState, controller.signal, valuationView, chartRange).then(value => {
      if (!controller.signal.aborted) setValuationResult({ source: strategy, view: valuationView, range: chartRange, value })
    }).catch(error => {
      if (!controller.signal.aborted) setValuationResult({ source: strategy, view: valuationView, range: chartRange, error: error instanceof Error ? error.message : 'Position calculation failed.' })
    })
    return () => controller.abort()
  }, [strategy, analysisState, valuationAttempt, valuationView, chartRange])
  const currentValuation = valuationResult?.source === strategy && valuationResult.view === valuationView && valuationResult.range === chartRange ? valuationResult.value : undefined
  const valuationError = valuationResult?.source === strategy && valuationResult.view === valuationView && valuationResult.range === chartRange ? valuationResult.error : undefined
  const metrics = currentValuation?.metrics
  const legRisk = currentValuation?.legs
  const activeId = TEMPLATES.find((template) => template.name === strategy.name)?.id

  const commit = (next: StrategyState, remember = true, automaticUpdate = false) => {
    const current = strategyRef.current
    const candidate = { ...next, version: current.version + 1 }
    const errors = validateConstruction(candidate)
    if (errors.length) {
      setEditError(errors.some((error) => error.includes('contract ids')) ? 'That contract is already in this position. Edit its quantity or choose another strike.' : errors.join('. '))
      return false
    }
    if (!automaticUpdate) stopAutomatic()
    if (remember) setHistory((items) => [...items.slice(-19), current])
    strategyRef.current = candidate
    setStrategy(candidate)
    if (!projectAnalysisPosition(candidate)?.legs.length) { setView('curve'); setAmericanPreview(false) }
    if (candidate.excludedLegIds?.length || (!candidate.legs.length && !candidate.stock)) {
      reviewGeneration.current++; reviewRequest.current?.abort(); reviewRequest.current = null; setPending(false)
    }
    setProposal(null)
    setEditError('')
    return true
  }

  const restoreDraft = (draft: WorkspaceDraft) => {
    if (workspaceBusy) throw new Error('A saved workspace request is still pending. The draft was kept.')
    if (!commit(draft.state)) throw new Error('Recovered position failed validation. The draft was kept.')
    if (draft.snapshot) setSnapshots(items => ({ ...items, [draft.snapshot!.id]: draft.snapshot! }))
    chainRequest.current++; setChainPending(false)
    workspaceRequest.current++
    reviewGeneration.current++; reviewRequest.current?.abort(); reviewRequest.current = null
    setPending(false); setMessages([]); setProposal(null)
    setHistoryOpen(false); setLifecycleSaved(''); setLotSaved('')
    setSavedIdentity(null); setSavedContent(null); setSelectedSaved('')
    setSavedTitle(draft.title); titleRef.current = draft.title
    setThesis(draft.thesis); setComposer(draft.composer)
    setWorkspaceError('')
    setWorkspaceNotice(`Recovered a separate unsaved tab draft. Undo restores the previous position.${draft.snapshot ? ' Recovered quotes are historical; refresh before server analysis or saving. Keep entry costs before refreshing estimated entries. Expired contracts may no longer be refreshable.' : ' This is sample data, not market quotes.'}`)
  }

  const legUpdate = (current: StrategyState, id: string, patch: Partial<OptionLeg>) => {
    const normalize = (leg: OptionLeg) => {
      const next = { ...leg, ...patch }
      if (marketSnapshot && current.pricing) {
        const contract = marketSnapshot.contracts.find(c => c.type === next.type && c.strike === next.strike && c.expiry === next.expiry)
        if (!contract) throw new Error('No quoted contract at that strike and expiry.')
        const priced = marketLeg(contract, next.side, next.contracts, next.id, current.pricing.basis, current.pricing.entryMode === 'fixed' ? leg : undefined)
        return current.pricing.entryMode === 'fixed' && patch.entryPrice !== undefined ? { ...priced, entryPrice: patch.entryPrice } : priced
      }
      return { ...next, contractId: sampleContractId(next.type, next.strike, next.expiry) }
    }
    if (current.legs.some((leg) => leg.id === id && Object.entries(patch).every(([key, value]) => leg[key as keyof OptionLeg] === value))) return current
    const next = pruneExpiryIvShifts({ ...current, name: 'Custom strategy', legs: current.legs.map((leg) => leg.id === id ? normalize(leg) : leg) })
    const errors = validateConstruction(next)
    if (errors.length) throw new Error(errors.join('. '))
    return next
  }
  const updateLeg = (id: string, patch: Partial<OptionLeg>) => {
    const current = strategyRef.current
    try { const next = legUpdate(current, id, patch); if (next !== current) commit(next) }
    catch (error) { setEditError(error instanceof Error ? error.message : 'Contract unavailable.') }
  }

  const updateScenario = (patch: Partial<Pick<StrategyState, 'scenarioSpot' | 'ivShift' | 'scenarioDate'>>, remember = true) => {
    if (Object.entries(patch).every(([key, value]) => strategyRef.current[key as keyof StrategyState] === value)) return
    commit({ ...strategyRef.current, ...patch }, remember)
  }

  const changeExpiryIv = (expiry: string, ivShift: number) => {
    const current = strategyRef.current
    if ((current.expiryIvShifts?.find(shift => shift.expiry === expiry)?.ivShift ?? 0) === ivShift) return
    const shifts = (current.expiryIvShifts ?? []).filter(shift => shift.expiry !== expiry)
    if (ivShift !== 0) shifts.push({ expiry, ivShift })
    shifts.sort((a, b) => a.expiry.localeCompare(b.expiry))
    commit({ ...current, expiryIvShifts: shifts.length ? shifts : undefined })
  }

  const changeStock = (stock: StrategyState['stock']) => {
    const current = strategyRef.current
    if (current.stock?.shares === stock?.shares && current.stock?.entryPrice === stock?.entryPrice) return
    commit({ ...current, name: 'Custom strategy', stock })
  }

  const pickTemplate = (id: TemplateId) => {
    try { commit({ ...(marketSnapshot ? createMarketStrategy(id, marketSnapshot, strategy.pricing!.basis) : createStrategy(id)), valuationModel: strategyRef.current.valuationModel }) }
    catch (error) { setEditError(error instanceof Error ? error.message : 'Template unavailable in this chain window.') }
  }

  const loadMarket = async (preserve: boolean, dates?: string[], symbol = strategyRef.current.underlying, center = preserve && marketSnapshot ? marketSnapshot.strikeCenter ?? marketSnapshot.spot : undefined, capture = false, automaticUpdate = false) => {
    if (chainPending) return
    if (automaticUpdate && (!automaticRef.current || reviewRequest.current || proposal)) return
    if (!automaticUpdate) stopAutomatic()
    const autoGeneration = automaticGeneration.current
    if (!/^[A-Z]{1,6}$/.test(symbol)) return setEditError('Enter a standard equity or ETF ticker using 1–6 letters.')
    const sequence = ++chainRequest.current
    const before = strategyRef.current
    if (capture && before.pricing?.entryMode !== 'fixed') return setEditError('Keep entry costs before capturing stream prices.')
    setChainPending(true)
    setEditError('')
    try {
      const query = new URLSearchParams({ symbol, ...(dates?.length ? { expiries: dates.join(',') } : {}), ...(center !== undefined ? { center: String(center) } : {}), ...(preserve && before.pricing && before.legs.length ? { retain: before.legs.map(leg => leg.contractId).join(',') } : {}) })
      const response = capture ? await fetch('/api/feed/capture', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: window.location.origin, 'X-ARGUS-Request': '1' }, body: JSON.stringify({ snapshotId: before.pricing!.snapshotId, contractIds: before.legs.map(leg => leg.contractId) }) }) : await fetch(`/api/chain?${query}`)
      const body = await response.json() as { snapshot?: MarketSnapshot; error?: { message?: string } }
      if (automaticUpdate && (!automaticRef.current || autoGeneration !== automaticGeneration.current || document.visibilityState !== 'visible')) return
      if (!response.ok || !body.snapshot) throw new Error(body.error?.message ?? 'Unable to load option prices.')
      if (sequence !== chainRequest.current || strategyRef.current.version !== before.version) throw new Error('The position changed while quotes loaded. Load prices again.')
      const snapshot = body.snapshot
      if (snapshot.underlying !== symbol) throw new Error('Quotes do not match the requested symbol. Position preserved.')
      const basis = before.pricing?.basis ?? 'mid'
      let next: StrategyState
      if (preserve && before.pricing) {
        const legs = before.legs.map(leg => {
          const contract = snapshot.contracts.find(c => c.contractId === leg.contractId)
          if (!contract) throw new Error('A selected contract is missing from refreshed quotes. Position preserved.')
          return marketLeg(contract, leg.side, leg.contracts, leg.id, basis, before.pricing?.entryMode === 'fixed' ? leg : undefined)
        })
        if (before.legs.length && Date.parse(before.scenarioDate) !== Date.parse(before.valuationTimestamp) && Date.parse(before.scenarioDate) < Date.parse(snapshot.retrievedAt)) throw new Error(`Selected scenario date precedes ${capture ? 'the capture' : 'the refreshed quotes'}. Choose Now or a future scenario; position unchanged.`)
        const date = new Date(Math.max(Date.parse(before.scenarioDate), Date.parse(snapshot.retrievedAt))).toISOString()
        next = { ...before, legs, spot: snapshot.spot, valuationTimestamp: snapshot.retrievedAt, scenarioDate: date, pricing: { mode: 'market', snapshotId: snapshot.id, basis, ...(before.pricing?.entryMode ? { entryMode: before.pricing.entryMode } : {}) } }
      } else next = { ...createMarketStrategy((activeId ?? 'iron-condor') as TemplateId, snapshot, basis), valuationModel: before.valuationModel }
      if (automaticUpdate && before.scenarioSpot === before.spot) next.scenarioSpot = snapshot.spot
      const errors = validateMarketConstruction(next, snapshot)
      if (errors.length) throw new Error(errors.join('; '))
      setSnapshots(items => ({ ...items, [snapshot.id]: snapshot }))
      if (commit(next, !automaticUpdate || automaticCheckpoint.current, automaticUpdate)) {
        if (automaticUpdate) automaticCheckpoint.current = false
        setWindowDates([...new Set(snapshot.contracts.map(c => c.expiry.slice(0,10)))].sort())
        return { position: structuredClone(strategyRef.current), snapshot }
      }
    } catch (error) { if (automaticUpdate && autoGeneration !== automaticGeneration.current) return; if (automaticUpdate) stopAutomatic(); if (sequence === chainRequest.current) setEditError(error instanceof Error ? error.message : 'Option prices unavailable.') }
    finally { if (sequence === chainRequest.current) setChainPending(false) }
  }

  const changeBasis = (basis: PricingBasis) => {
    if (!marketSnapshot || !strategy.pricing) return
    commit({ ...strategy, pricing: { ...strategy.pricing, basis }, legs: strategy.legs.map(leg => marketLeg(marketSnapshot.contracts.find(c => c.contractId === leg.contractId)!, leg.side, leg.contracts, leg.id, basis, strategy.pricing!.entryMode === 'fixed' ? leg : undefined)) })
  }

  const setFixedEntry = (fixed: boolean) => {
    if (!marketSnapshot || !strategy.pricing) return
    commit({ ...strategy, pricing: { ...strategy.pricing, entryMode: fixed ? 'fixed' : undefined }, legs: fixed ? strategy.legs : strategy.legs.map(leg => marketLeg(marketSnapshot.contracts.find(c => c.contractId === leg.contractId)!, leg.side, leg.contracts, leg.id, strategy.pricing!.basis)) })
  }

  const addQuotedLeg = (contractId: string, side: OptionLeg['side']) => {
    const current = strategyRef.current
    const contract = marketSnapshot?.contracts.find(item => item.contractId === contractId)
    if (!marketSnapshot || !contract || !current.pricing || current.pricing.snapshotId !== marketSnapshot.id) return setEditError('Quote window changed. Select a contract from the current window.')
    const next = { ...current, name: 'Custom strategy', legs: [...current.legs, marketLeg(contract, side, 1, `leg-${crypto.randomUUID()}`, current.pricing.basis)] }
    const errors = validateMarketConstruction(next, marketSnapshot)
    if (errors.length) return setEditError(errors.join('. '))
    commit(next)
  }

  const addLeg = () => {
    if (strategy.legs.length >= MAX_OPTION_LEGS) return
    const basis = strategy.legs.at(-1) ?? createStrategy('long-call').legs[0]
    if (marketSnapshot) {
      const contract = marketSnapshot.contracts.filter(c => Date.parse(c.expiry) > Date.parse(strategy.valuationTimestamp) && Date.parse(c.expiry) >= Date.parse(strategy.scenarioDate) && !strategy.legs.some(leg => leg.contractId === c.contractId))
        .sort((a,b) => Number(b.expiry === basis.expiry) - Number(a.expiry === basis.expiry) || Number(b.type === basis.type) - Number(a.type === basis.type) || Math.abs(a.strike - strategy.spot) - Math.abs(b.strike - strategy.spot))[0]
      if (!contract) return setEditError('No additional quoted contract is available at this scenario date. Browse another chain window or choose an earlier scenario.')
      addQuotedLeg(contract.contractId, basis.side === 'long' ? 'short' : 'long')
      return
    }
    const strike = SAMPLE_STRIKES.find((candidate) => !strategy.legs.some((leg) => leg.type === basis.type && leg.expiry === basis.expiry && leg.strike === candidate)) ?? basis.strike
    commit({ ...strategy, name: 'Custom strategy', legs: [...strategy.legs, { ...basis, id: `leg-${crypto.randomUUID()}`, contractId: sampleContractId(basis.type, strike, basis.expiry), side: basis.side === 'long' ? 'short' : 'long', strike }] })
  }

  const undo = () => {
    const previous = history.at(-1)
    if (!previous) return
    if (commit(previous, false)) setHistory((items) => items.slice(0, -1))
  }

  const savedAction = async (action: 'save' | 'copy' | 'load' | 'delete') => {
    stopAutomatic()
    if (workspaceBusy) return
    const target = action === 'load' || action === 'delete' ? saved.find(item => item.id === selectedSaved) : savedIdentity
    if ((action === 'load' || action === 'delete') && !target) return
    if (action === 'delete' && !window.confirm(`Delete saved strategy “${target!.title}”? The open position will remain available.`)) return
    const sequence = ++workspaceRequest.current
    const before = strategyRef.current
    const title = titleRef.current
    setWorkspaceBusy(true)
    setWorkspaceError('')
    setWorkspaceNotice('')
    try {
      const updating = action === 'save' && !!target
      const response = await fetch(`/api/strategies${action === 'load' || action === 'delete' || updating ? `/${encodeURIComponent(target!.id)}` : ''}`, {
        method: action === 'load' ? 'GET' : action === 'delete' ? 'DELETE' : updating ? 'PUT' : 'POST',
        ...(action === 'load' ? {} : { headers: { 'content-type': 'application/json', 'X-ARGUS-Request': '1' }, body: JSON.stringify(action === 'delete' ? { revision: target!.revision } : { title: title.trim() || before.name, state: before, ...(updating ? { revision: target!.revision } : {}) }) }),
      })
      const body = (response.status === 204 ? {} : await response.json()) as { record?: SavedRecord; error?: { message?: string } }
      if (!response.ok) throw new Error(response.status === 409 ? action === 'load' ? 'This saved position cannot replace the builder. Use Manage closes to inspect recorded activity. Your current edits are intact.' : 'This saved strategy changed elsewhere or has recorded closes. Your edits are intact. Use Manage closes to inspect activity, or Save as new.' : body.error?.message ?? 'Workspace request failed. Your edits are intact.')
      if (action !== 'load') await refreshSaved()
      if (sequence !== workspaceRequest.current) return
      if (strategyRef.current.version !== before.version || titleRef.current !== title) {
        setWorkspaceNotice(action === 'load' ? 'Load not applied: your workspace changed while loading.' : action === 'delete' ? 'Saved copy deleted. Your current edits are unchanged.' : 'Submitted copy saved. Your newer workspace edits are unchanged; reload that copy before updating it.')
        if (action === 'delete' && savedIdentity?.id === target!.id) { setSavedIdentity(null); setSavedContent(null) }
        return
      }
      if (action === 'delete') {
        if (savedIdentity?.id === target!.id) { setSavedIdentity(null); setSavedContent(null) }
        setSelectedSaved('')
        setWorkspaceNotice('Saved copy deleted. The open position is unchanged.')
        return
      }
      const record = body.record as SavedRecord
      if (action === 'load') {
        const errors = validateConstruction(record.state)
        if (record.state.pricing) {
          if (!record.snapshot) throw new Error('Saved quote snapshot is missing. Your position is unchanged.')
          errors.push(...validateMarketConstruction(record.state, record.snapshot))
        }
        if (errors.length) throw new Error('Saved position failed validation. Your position is unchanged.')
        if (!commit(record.state)) return
        if (record.snapshot) setSnapshots(items => ({ ...items, [record.snapshot!.id]: record.snapshot! }))
        chainRequest.current++
        setChainPending(false)
      }
      setSavedIdentity(record)
      setSaved(items => items.some(item => item.id === record.id) ? items : [...items, record])
      setSavedContent(workspaceContent(strategyRef.current, record.title))
      setSelectedSaved(record.id)
      setSavedTitle(record.title)
      titleRef.current = record.title
      setWorkspaceNotice(action === 'load' ? 'Loaded saved position. Undo restores the previous position.' : 'Position saved. Subsequent changes are not saved automatically.')
    } catch (error) {
      if (sequence === workspaceRequest.current) setWorkspaceError(error instanceof Error ? error.message : 'Workspace request failed. Your edits are intact.')
    } finally { if (sequence === workspaceRequest.current) setWorkspaceBusy(false) }
  }

  const exportSaved = async () => {
    if (workspaceBusy || !selectedSaved) return
    const target = selectedSaved, sequence = ++workspaceRequest.current
    setWorkspaceBusy(true); setWorkspaceError(''); setWorkspaceNotice('')
    try {
      const response = await fetch(`/api/strategies/${encodeURIComponent(target)}/export`, { signal: AbortSignal.timeout(12000) })
      const body = await response.json() as { format?: string; formatVersion?: number; exportedAt?: string; record?: SavedRecord }
      if (!response.ok || body?.format !== 'argus-saved-position' || body.formatVersion !== 1 || body.record?.id !== target || !Number.isSafeInteger(body.record.revision) || body.record.revision < 1 || !Number.isFinite(Date.parse(body.exportedAt ?? ''))) throw new Error('Saved export unavailable. No file was downloaded; your workspace is unchanged.')
      if (sequence !== workspaceRequest.current) return
      const url = URL.createObjectURL(new Blob([JSON.stringify(body, null, 2)], { type: 'application/json' }))
      const link = document.createElement('a')
      link.href = url; link.download = `argus-position-${target.replace(/[^a-zA-Z0-9_-]/g, '')}-r${body.record.revision}.json`
      link.click(); setTimeout(() => URL.revokeObjectURL(url), 0)
      setWorkspaceNotice(`Exported saved revision ${body.record.revision} for “${body.record.title}”. Includes stored quotes and recorded history, not unsaved edits. Keep the file private; Import saved JSON creates a separate saved copy.`)
    } catch (error) {
      if (sequence === workspaceRequest.current) setWorkspaceError(error instanceof Error ? error.message : 'Saved export unavailable. Your workspace is unchanged.')
    } finally { if (sequence === workspaceRequest.current) setWorkspaceBusy(false) }
  }

  const newWorkspace = () => {
    workspaceRequest.current++
    setWorkspaceBusy(false)
    setSavedIdentity(null)
    setSavedContent(null)
    setSavedTitle('')
    titleRef.current = ''
    setSelectedSaved('')
    setWorkspaceNotice('New unsaved position.')
    setWorkspaceError('')
    pickTemplate('long-call')
  }

  const analyzeRemaining = (state: StrategyState, snapshotId: string) => {
    const snapshot = snapshots[snapshotId]
    if (workspaceBusy || snapshotId !== strategyRef.current.pricing?.snapshotId || !snapshot || state.pricing?.snapshotId !== snapshotId || state.pricing.entryMode !== 'fixed' || state.feeAllowance !== 0 || validateConstruction(state).length || validateMarketConstruction(state, snapshot).length) return false
    if (!commit({ ...state, name: 'Remaining holdings' })) return false
    workspaceRequest.current++
    setSavedIdentity(null); setSavedContent(null); setSelectedSaved(''); setSavedTitle(''); titleRef.current = ''
    setWorkspaceError('')
    setWorkspaceNotice('Separate unsaved analysis of remaining holdings. Excludes recorded realized P/L and the original position allowance. Saved history is unchanged; Undo restores the previous strategy.')
    return true
  }

  const captureAndReview = async () => {
    if (analysisUnavailable) return setEditError('Include at least one holding before requesting AI review.')
    if (reviewRequest.current || chainPending) return
    const generation = reviewGeneration.current
    const captured = await loadMarket(true, undefined, strategyRef.current.underlying, undefined, true)
    if (!captured || generation !== reviewGeneration.current || reviewRequest.current || captured.position.version !== strategyRef.current.version) return
    await spar('Review this freshly captured position snapshot. Challenge its risk and thesis using the supplied dated quotes and selected scenario. Distinguish quote marks from modeled P/L; do not change the position or imply an executable fill.', undefined, captured)
  }

  const spar = async (prompt = composer, probabilityRange?: { lower: number; upper: number }, source?: { position: StrategyState; snapshot: MarketSnapshot }, firstExpiryRange?: { min: number; max: number }) => {
    if (analysisUnavailable) return setEditError('AI analysis requires at least one included holding; your holdings are unchanged.')
    if (!prompt.trim() || reviewRequest.current) return
    stopAutomatic()
    const american = americanPreviewActive.current
    const reviewedPosition = structuredClone(source?.position ?? strategy)
    const reviewedSnapshot = source ? structuredClone(source.snapshot) : marketSnapshot ? structuredClone(marketSnapshot) : undefined
    reviewGeneration.current++
    const controller = new AbortController()
    reviewRequest.current = controller
    setMessages((items) => [...items, { role: 'user', text: prompt }])
    if (!source) setComposer('')
    setPending(true)
    setProposal(null)
    try {
      const conversation = [...messages, { role: 'user' as const, text: prompt }]
        .filter((message) => message.role !== 'guide')
        .slice(-12)
        .map((message) => ({ role: message.role === 'user' ? 'user' : 'assistant', content: message.analysis ? `[Review of ${message.analysis.positionName}, workspace version ${message.analysis.positionVersion}; ${message.analysis.positionVersion === reviewedPosition.version ? 'same workspace version' : 'earlier workspace version, not the current position'}; underlying ${message.analysis.positionUnderlying}]\n${message.text}` : message.text }))
      if (thesis.trim()) conversation[conversation.length - 1].content += `\nMy thesis: ${thesis.trim()}`
      const requestId = crypto.randomUUID()
      const baseVersion = reviewedPosition.version
      const response = await fetch('/api/sparring', { method: 'POST', signal: controller.signal, headers: { 'content-type': 'application/json', 'X-ARGUS-Request': '1' }, body: JSON.stringify({ request_id: requestId, base_state_version: baseVersion, state: reviewedPosition, conversation, ...(probabilityRange ? { probability_range: probabilityRange } : {}), ...(firstExpiryRange ? { first_expiry_range: firstExpiryRange } : {}), chart_context: { ...(american ? { view: 'heatmap', metric: 'pnl', valuationModel: 'american-crr-1024-v1' } : { view, metric: view === 'curve' ? chartMetric : 'pnl' }), ...(chartRange ? { range: chartRange } : {}), ...(activePnlDisplay !== 'pnl' && displayBasis ? { pnlDisplay: activePnlDisplay } : {}) } }) })
      const data = await response.json() as Partial<SparringSuccess> & { error?: { code: string; message?: string } }
      if (reviewRequest.current !== controller) return
      if (data.calculated?.candidateSearch) {
        if (!response.ok || !reviewedSnapshot || !data.reply || data.request_id !== requestId || data.base_state_version !== baseVersion || data.reply.operations.length || JSON.stringify(data.next_state) !== JSON.stringify(mergeAnalysisProposal(reviewedPosition, { ...projectAnalysisPosition(reviewedPosition)!, version: baseVersion + 1 }))) throw new Error('Candidate discovery must leave the reviewed holdings unchanged.')
        const search = data.calculated.candidateSearch
        data.calculated.candidateSearch = await checkSearch(search, projectAnalysisPosition(reviewedPosition)!, reviewedSnapshot, search.request, search.domain, controller.signal)
        if (reviewRequest.current !== controller || strategyRef.current.version !== baseVersion) return
      }
      if (data.next_state && data.reply) {
        if (data.request_id !== requestId || data.base_state_version !== baseVersion) throw new Error('Mismatched proposal identity')
        if (strategyRef.current.version !== baseVersion) {
          setMessages((items) => [...items, { role: 'argus', text: 'That proposal expired because the strategy changed while I was checking it.', note: 'STALE PROPOSAL · strategy unchanged' }])
          return
        }
        if (validateConstruction(data.next_state).length) throw new Error('The proposed position failed validation. Your position is unchanged.')
        if (data.next_state.pricing && (!reviewedSnapshot || validateMarketConstruction(data.next_state, reviewedSnapshot).length)) throw new Error('The proposal does not match the loaded quote snapshot.')
        const includedNext = projectAnalysisPosition(data.next_state), includedBefore = projectAnalysisPosition(reviewedPosition)
        if (!includedNext || !includedBefore || JSON.stringify(mergeAnalysisProposal(reviewedPosition, includedNext)) !== JSON.stringify(data.next_state)) throw new Error('The proposal changed retained holdings or analysis selection. Your position is unchanged.')
        if (data.reply.operations.length) {
          const [next, before] = await Promise.all([
            requestWorkspaceValuation(includedNext, controller.signal),
            requestWorkspaceValuation(includedBefore, controller.signal),
          ])
          if (reviewRequest.current !== controller) return
          if (strategyRef.current.version !== baseVersion) {
            setMessages((items) => [...items, { role: 'argus', text: 'That proposal expired because the strategy changed while I was checking it.', note: 'STALE PROPOSAL · strategy unchanged' }])
            return
          }
          setProposal({ ...data as SparringSuccess, metrics: next.metrics, before: before.metrics })
          setView('curve')
        }
      }
      setMessages((items) => [...items, { role: 'argus', text: data.reply?.text ?? data.error?.message ?? 'Live sparring is unavailable until an OpenRouter key is configured.', analysis: data.reply ? { reply: data.reply, calculated: data.calculated!, market_context: data.market_context!, positionVersion: baseVersion, positionName: reviewedPosition.name, positionUnderlying: reviewedPosition.underlying, position: projectAnalysisPosition(reviewedPosition)!, positionSnapshot: reviewedSnapshot } : undefined, note: data.error ? `${data.error.code.replaceAll('_', ' ')} · position unchanged` : data.reply?.operations.length ? 'PROPOSAL READY · review the comparison' : 'ARGUS · analysis' }])
    } catch (error) {
      if (reviewRequest.current !== controller) return
      setMessages((items) => [...items, { role: 'argus', text: error instanceof Error ? error.message : 'Unable to complete this review. Try again.', note: 'REVIEW FAILED · position unchanged' }])
    } finally {
      controller.abort()
      if (reviewRequest.current === controller) { reviewRequest.current = null; setPending(false) }
    }
  }

  const acceptProposal = () => {
    if (!proposal || strategy.version !== proposal.base_state_version) return setProposal(null)
    if (!commit(proposal.next_state)) return
    setMessages((items) => [...items, { role: 'argus', text: 'Proposal accepted. The builder now reflects the reviewed structure.', note: 'ACCEPTED · deterministic metrics refreshed' }])
    setProposal(null)
  }

  const inspectCandidate = async (search: CandidateSearchResult | null | undefined, snapshot: MarketSnapshot | undefined, id: string, analysis?: NonNullable<ChatMessage['analysis']>) => {
    if (reviewRequest.current || analysisUnavailable) return
    const current = strategyRef.current
    const candidate = search?.candidates.find(item => item.id === id)
    if (!search || !candidate || !snapshot || search.baseVersion !== current.version || analysis && analysis.positionVersion !== current.version || search.snapshotId !== current.pricing?.snapshotId || search.model !== (current.valuationModel ?? 'european-bsm-v1')) return setEditError('This candidate search is stale. Search again using the current position and quotes.')
    stopAutomatic()
    const controller = new AbortController()
    reviewRequest.current = controller
    setPending(true); setProposal(null)
    try {
      const includedNext = { ...structuredClone(candidate.state), id: current.id, version: current.version + 1 }
      if (includedNext.pricing?.entryMode !== undefined || validateMarketStrategy(includedNext, snapshot).length) throw new Error('Candidate entry estimates do not match its quoted snapshot.')
      const next = mergeAnalysisProposal(current, includedNext), includedBefore = projectAnalysisPosition(current)!
      if (validateMarketConstruction(next, snapshot).length) throw new Error('Candidate no longer matches its quoted snapshot.')
      const baselineInRange = !includedBefore.legs.length || Date.parse(includedNext.scenarioDate) <= Math.min(...includedBefore.legs.map(leg => Date.parse(leg.expiry)))
      const comparisonBaseline = baselineInRange ? { ...structuredClone(includedBefore), scenarioSpot: includedNext.scenarioSpot, scenarioDate: includedNext.scenarioDate } : undefined
      const [before, selected] = await Promise.all([requestWorkspaceValuation(comparisonBaseline ?? includedBefore, controller.signal), requestWorkspaceValuation(projectAnalysisPosition(next)!, controller.signal)])
      if (reviewRequest.current !== controller || strategyRef.current !== current) return
      if (JSON.stringify(selected.metrics) !== JSON.stringify(candidate.metrics)) throw new Error('Candidate metrics could not be reconciled. Position unchanged.')
      const mixedCandidate = new Set(includedNext.legs.map(leg => leg.expiry)).size > 1
      const lossBound = mixedCandidate ? firstExpirySpreadLossBound(includedNext) : undefined
      if (JSON.stringify(lossBound) !== JSON.stringify(candidate.lossBound) || lossBound && (lossBound.amount <= 0 || lossBound.amount > search.request.maxLoss)) throw new Error('Candidate first-expiry risk bound could not be reconciled. Position unchanged.')
      setView('curve')
      setProposal({ request_id: `candidate:${id}`, base_state_version: current.version, next_state: next, metrics: selected.metrics, before: before.metrics, comparisonBaseline, lossBound, ...(!baselineInRange ? { comparisonUnavailable: 'Target-date comparison unavailable: the search date is beyond the first held option expiry. Current metrics retain the workspace scenario; no settlement or post-expiry holdings are inferred.' } : {}), ...(analysis ? { calculated: analysis.calculated, market_context: analysis.market_context } : {}), reply: {
        text: 'Selected quoted alternative', operations: [], evidence_ids: [], suggested_prompts: [], risk_classification: lossBound ? 'bounded' : selected.metrics.maxLoss === null ? 'unbounded' : 'bounded',
        assumptions: ['Replace included holdings with this new position, not a roll or executed trade. Included entries and any shares are replaced by the displayed quoted option legs; excluded holdings and their costs are retained.', `Candidate entry basis: ${search.request.basis}; total fee allowance ${money(search.request.feeAllowance)}. ${comparisonBaseline ? 'Held baseline and candidate are repriced at the search target; differences are modeled scenarios, not trading edge.' : 'Current and candidate scenarios may differ; their P/L difference is not a like-for-like improvement.'}`],
        objections: ['Dated quote estimates are not fills. No assignment, margin or realized closing costs are modeled. This selection is locally recalculated, not a new AI review.'],
      } })
    } catch (error) {
      if (reviewRequest.current === controller) setEditError(error instanceof Error ? error.message : 'Candidate inspection unavailable.')
    } finally { controller.abort(); if (reviewRequest.current === controller) { reviewRequest.current = null; setPending(false) } }
  }

  const families = [...new Set(templates.map((template) => template.family))]
  const templateWords = templateQuery.toLowerCase().trim().split(/\s+/).filter(Boolean)
  const visibleTemplates = templates.filter(item => (templateFamily === 'All families' || item.family === templateFamily) && templateWords.every(word => `${item.label} ${item.id} ${item.family}`.toLowerCase().includes(word)))
  const mixedExpiry = !!analysisState?.legs.some((leg) => leg.expiry !== analysisState.legs[0].expiry)
  const americanModel = strategy.valuationModel === 'american-crr-1024-v1'
  const stockOnly = !!analysisState && analysisState.legs.length === 0
  const firstExpiry = !analysisState?.legs.length ? Date.parse(strategy.scenarioDate) : Math.min(...analysisState.legs.map(leg => Date.parse(leg.expiry)))
  const valuation = Date.parse(strategy.valuationTimestamp)
  const profitValue = !metrics ? '—' : mixedExpiry ? money(metrics.modeledHigh) : metrics.maxProfit == null ? 'Unbounded' : money(metrics.maxProfit)
  const lossValue = !metrics ? '—' : mixedExpiry ? money(metrics.modeledLow) : metrics.maxLoss == null ? 'Unbounded' : money(-Math.abs(metrics.maxLoss))
  const comparedPosition = useMemo(() => proposal ? projectAnalysisPosition(proposal.next_state) ?? undefined : manualBaseline, [proposal, manualBaseline])
  const comparisonCompatible = analysisState && comparedPosition && strategy.underlying === comparedPosition.underlying && strategy.valuationTimestamp === comparedPosition.valuationTimestamp && (strategy.valuationModel ?? 'european-bsm-v1') === (comparedPosition.valuationModel ?? 'european-bsm-v1') && Date.parse(strategy.scenarioDate) === Date.parse(comparedPosition.scenarioDate) && (!analysisState.legs.length || !comparedPosition.legs.length || firstExpiry === Math.min(...comparedPosition.legs.map((leg) => Date.parse(leg.expiry))))
  const brief = !metrics ? '' : stockOnly ? 'Stock-only mark P/L: no option expiry, time decay or IV sensitivity. Dividends, financing and borrow are excluded.' : metrics.breakevens.length === 2
    ? `At expiration, the position breaks even at $${metrics.breakevens[0].toFixed(2)} and $${metrics.breakevens[1].toFixed(2)}.`
    : mixedExpiry ? 'In P/L view, the solid curve models both legs at the selected scenario date. The dashed first-expiry reference values the remaining option theoretically; its value still depends on volatility.'
      : metrics.breakevens.length ? `At expiration, the position breaks even at $${metrics.breakevens[0].toFixed(2)}.` : 'This position has no isolated expiration breakeven in the model.'
  const briefVega = metrics ? Number(metrics.vega.toFixed(2)) : 0
  const briefQuestion = stockOnly ? 'Compare share quantities or add an option to model a hedge.' : analysisState?.legs.every(leg => Date.parse(leg.expiry) <= Date.parse(strategy.scenarioDate))
    ? strategy.stock ? 'All option legs have reached expiry; IV does not change their intrinsic payoff. Shares retain spot-price exposure. Exercise, assignment and resulting position changes are not simulated.' : 'All legs have reached expiry; IV does not change their modeled intrinsic payoff. Exercise and assignment are not simulated.'
    : briefVega === 0 ? 'Vega rounds to zero here. That does not rule out a change from a finite IV move; reprice the scenario to check.'
      : `${briefVega > 0 ? 'Positive' : 'Negative'} local vega: modeled value ${briefVega > 0 ? 'increases' : 'decreases'} for a small IV rise, other inputs fixed. Reprice a finite move to test your view.`
  const legDescription = (leg: OptionLeg) => `${leg.side === 'long' ? 'Buy' : 'Sell'} ${leg.contracts} × $${leg.strike} ${leg.type} · ${shortDate(leg.expiry)} · $${leg.entryPrice.toFixed(2)} · IV ${(leg.iv * 100).toFixed(0)}%`

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand"><span className="brand-mark">A</span><div><strong>ARGUS</strong><small>OPTIONS, INTERROGATED.</small></div></div>
        <div className="market-pill"><i /> {marketSnapshot?.imported ? 'Imported quotes · unverified' : marketSnapshot?.historical ? 'Historical quotes' : marketSnapshot ? 'Tastytrade quotes' : 'Replay-safe sample'} <span>{marketSnapshot ? 'timestamped' : 'not live'}</span></div>
        <div className="ticker-box"><span className="ticker-symbol">{strategy.underlying}</span><strong>${strategy.spot.toFixed(2)}</strong><em>{marketSnapshot ? 'SNAPSHOT' : 'FIXTURE'}</em></div>
        <div className="top-actions"><button disabled={chainPending} onClick={() => void loadMarket(!!marketSnapshot, marketSnapshot ? [...new Set(marketSnapshot.contracts.map(c => c.expiry.slice(0,10)))].sort() : undefined)}>{chainPending ? 'Loading quotes…' : marketSnapshot ? 'Refresh prices' : 'Use real prices'}</button>{marketSnapshot && <button onClick={() => { chainRequest.current++; setChainPending(false); commit({ ...createStrategy((activeId ?? 'iron-condor') as TemplateId), valuationModel: strategyRef.current.valuationModel }) }}>Sample mode</button>}</div>
      </header>

      <nav className="workspace-nav" aria-label="Workspace sections"><a href="#workspace-chart">Chart</a><a href="#workspace-legs">Legs</a><a href="#workspace-question">Ask ARGUS</a></nav>
      <div className="workspace">
        <aside className="strategy-rail">
          <div className="rail-title"><span>Strategy library</span></div>
          <button className="new-strategy" onClick={newWorkspace}><b>＋</b> New strategy</button>
          <div className="template-filters">
            <label>Find strategy<input type="search" value={templateQuery} onChange={event => setTemplateQuery(event.target.value)} placeholder="Name or family" /></label>
            <label>Strategy family<select value={templateFamily} onChange={event => setTemplateFamily(event.target.value)}><option>All families</option>{families.map(family => <option key={family}>{family}</option>)}</select></label>
            <div><span role="status">{visibleTemplates.length} of {templates.length} strategies</span>{(templateQuery || templateFamily !== 'All families') && <button aria-label="Clear strategy filters" onClick={() => { setTemplateQuery(''); setTemplateFamily('All families') }}>Clear</button>}</div>
          </div>
          <div className="template-list">
            {families.filter(family => visibleTemplates.some(item => item.family === family)).map((family) => <section key={family}><h2>{family}</h2>{visibleTemplates.filter((item) => item.family === family).map((item) => <button key={item.id} aria-pressed={activeId === item.id} className={activeId === item.id ? 'active' : ''} onClick={() => pickTemplate(item.id)}><i>{item.glyph}</i><span>{item.label}</span><kbd>{item.id.includes('calendar') ? '2x' : item.id.includes('iron') ? '4x' : ''}</kbd></button>)}</section>)}
          </div>
          {!visibleTemplates.length && <p className="template-empty">No matching strategies.<br /><small>Try another name or clear the filters.</small></p>}
          <div className="rail-foot"><span>{templates.length}</span><p>Curated templates<br /><small>+ custom composition</small></p></div>
        </aside>

        <section className="builder">
          <div className="context-strip">
            <div><span className="eyebrow">Strategy workspace</span><h1>{strategy.name}</h1></div>
            <div className="expiry-tabs"><span>Expiry focus</span>{[...new Set(strategy.legs.map((leg) => leg.expiry))].map((expiry, index) => <div className={index === 0 ? 'active' : ''} key={expiry}><b>{shortDate(expiry)}</b><small>{Math.max(0, Math.ceil((+new Date(expiry) - +new Date(strategy.valuationTimestamp)) / 86400000))} DTE</small></div>)}</div>
            <div className="workspace-actions"><button className="undo-button" disabled={!marketSnapshot || !analysisState || pending || chainPending || workspaceBusy} onClick={() => { stopAutomatic(); setHistoryOpen(true) }}>Price history</button><button className="icon-button" aria-label="Reset strategy" onClick={() => pickTemplate((activeId ?? 'iron-condor') as TemplateId)}>↻</button><button className="undo-button" aria-label="Undo" disabled={!history.length} onClick={undo}>↶ Undo</button></div>
          </div>

          <div className="workspace-tools" role="group" aria-label="Position and saved workspace controls">
          <form className="symbol-control" onSubmit={event => { event.preventDefault(); void loadMarket(false, undefined, symbolDraft.trim().toUpperCase()) }}>
            <label>Underlying<input aria-label="Underlying symbol" aria-describedby="symbol-help" maxLength={6} value={symbolDraft} autoCapitalize="characters" autoComplete="off" spellCheck={false} onChange={event => setSymbolDraft(event.target.value.toUpperCase())} /></label>
            <button type="submit" disabled={chainPending || !/^[A-Z]{1,6}$/.test(symbolDraft.trim())}>{chainPending ? 'Loading symbol…' : 'Load symbol'}</button>
            <small id="symbol-help">Standard equity / ETF · rebuilds template · Undo restores your position</small>
          </form>

          <SymbolSearch underlying={strategy.underlying} onSelect={setSymbolDraft} />

          <details className="saved-workspace">
            <summary>Saved workspace <span>{session ? `${session.local ? 'LOCAL · ' : ''}${session.label}` : 'Checking session…'} · {savedIdentity ? savedIdentity.title : 'Unsaved position'}{unsavedChanges ? ' · Unsaved changes' : ''}</span></summary>
            <div className="saved-controls">
              <label>Position title<input aria-label="Saved strategy title" maxLength={120} value={savedTitle} placeholder={strategy.name} onChange={event => { titleRef.current = event.target.value; setSavedTitle(event.target.value) }} /></label>
              <button disabled={workspaceBusy || !session} onClick={() => void savedAction('save')}>Save</button><button disabled={workspaceBusy || !session} onClick={() => void savedAction('copy')}>Save as new</button><button onClick={newWorkspace}>New</button>
              <label className="saved-picker">Saved positions<select aria-label="Saved positions" value={selectedSaved} onChange={event => setSelectedSaved(event.target.value)}><option value="">Choose a saved position</option>{saved.map(item => <option key={item.id} value={item.id}>{item.title} · {shortDate(item.updatedAt)} · r{item.revision}</option>)}</select></label>
              <button disabled={workspaceBusy || !session} onClick={() => void refreshSaved().catch(error => setWorkspaceError(error instanceof Error ? error.message : 'Saved library unavailable.'))}>Refresh saved positions</button>
              {savedCursor && <button disabled={workspaceBusy || savedListPending} onClick={() => void refreshSaved(savedCursor).catch(error => setWorkspaceError(error instanceof Error ? error.message : 'Saved library unavailable.'))}>Load more saved positions</button>}
              <small role="status">{savedListPending ? 'Loading saved positions…' : `${saved.length} saved positions loaded${savedCursor ? ' · more available' : ''}`}</small>
              <button disabled={workspaceBusy || !selectedSaved} onClick={() => void savedAction('load')}>Load</button><button disabled={workspaceBusy || !selectedSaved} onClick={() => void savedAction('delete')}>Delete</button>
              <button disabled={workspaceBusy || !selectedSaved} onClick={() => void exportSaved()}>Export saved JSON</button>
              <button disabled={workspaceBusy || !selectedSaved} onClick={() => setLifecycleSaved(selectedSaved)}>Manage closes</button>
              <button disabled={workspaceBusy || !selectedSaved} onClick={() => { stopAutomatic(); setLotSaved(selectedSaved) }}>Manage lots &amp; rolls</button>
            </div>
            <SavedImport disabled={workspaceBusy || !session} onImported={refreshSaved} />
            <small>Explicit position saves only; conversation is not saved. Unsaved position edits trigger a browser warning on reload or leaving where supported. Loading replaces the open position; Undo restores it. Quotes retain their original timestamps.</small>
          </details>
          </div>
          {session && /^[a-f0-9]{64}$/.test(session.recoveryKey) && <DraftRecovery key={session.recoveryKey} ownerKey={session.recoveryKey} data={{ state: strategy, snapshot: marketSnapshot ?? null, title: savedTitle, thesis, composer }} changed={unsavedChanges || !!thesis || !!composer} disabled={workspaceBusy} onRestore={restoreDraft} />}
          {workspaceBusy && <p className="workspace-notice" role="status">Updating saved workspace…</p>}
          {lifecycleSaved && <PositionLifecycle key={lifecycleSaved} savedId={lifecycleSaved} snapshotId={marketSnapshot?.id} onClose={() => setLifecycleSaved('')} onRecorded={refreshSaved} onAnalyze={analyzeRemaining} />}
          {lotSaved && <LotManagement key={lotSaved} savedId={lotSaved} source={strategy} snapshotId={marketSnapshot?.id} onClose={() => setLotSaved('')} onRecorded={refreshSaved} onAnalyze={analyzeRemaining} />}
          {historyOpen && analysisState && <PriceHistory key={strategy.version} state={analysisState} onClose={() => setHistoryOpen(false)} />}
          {workspaceNotice && <p className="workspace-notice" role="status">{workspaceNotice}</p>}
          {workspaceError && <p className="workspace-notice workspace-error" role="alert">{workspaceError}</p>}

          {marketSnapshot && <div className="market-pricing-panel">
            <SnapshotAge snapshot={marketSnapshot} contracts={strategy.legs.map(leg => leg.contractId!)} />
            <details className="quote-provenance"><summary><b>{marketSnapshot.historical ? 'HISTORICAL QUOTES' : marketSnapshot.captureSource ? 'Captured position · selected contracts only' : strategy.pricing?.entryMode === 'fixed' ? 'REAL CONTRACTS · HELD ENTRY COSTS' : 'REAL CONTRACTS · ESTIMATED ENTRY'}</b><small>Source details · not a live fill</small></summary><span>{marketSnapshot.contracts.length} quoted contracts in this window · underlying quote {marketSnapshot.spotAsOf}</span><span>Retrieved {marketSnapshot.retrievedAt} · retrieval does not establish source freshness. Rates/yield are model assumptions.</span>{marketSnapshot.captureSource && <><span>Refresh the chain to explore alternatives. Quote time is the oldest bid, ask or IV source time.</span><span>Underlying bid {marketSnapshot.spotSourceTimes?.bid} · ask {marketSnapshot.spotSourceTimes?.ask}</span>{marketSnapshot.contracts.map(contract => <span key={contract.contractId}>{contract.contractId} · bid {contract.sourceTimes?.bid} · ask {contract.sourceTimes?.ask} · IV {contract.sourceTimes?.iv}</span>)}</>}</details>
            {quoteMark && <details className="quote-model-comparison" aria-label="Quote and model comparison">
              <summary>Quote vs scenario P/L</summary>
              <dl><div><dt>Dated quote P/L</dt><dd>{money(quoteMark.pnl, '—', 2)}</dd></div><div><dt>Scenario-model P/L</dt><dd>{metrics ? money(metrics.scenarioPnl, '—', 2) : valuationError ? 'Unavailable' : 'Calculating…'}</dd></div><div><dt>Model minus quote</dt><dd>{metrics ? money(metrics.scenarioPnl - quoteMark.pnl, '—', 2) : '—'}</dd></div></dl>
              <p>Quotes: {quoteMark.oldestQuoteAt} to {quoteMark.newestQuoteAt}. {quoteMark.basis}</p>
              <p>Scenario: {strategy.scenarioDate} · spot {money(strategy.scenarioSpot, '—', 2)} · {americanModel ? 'American CRR · 1,024 steps' : 'European BSM'} · rate {(strategy.rate * 100).toFixed(2)}% · continuous yield {(strategy.dividendYield * 100).toFixed(2)}%.</p>
              <p>Included effective IV: {analysisState?.legs.map(leg => `${leg.side} ${leg.contracts} × $${leg.strike} ${leg.type} (${shortDate(leg.expiry)}): ${(effectiveIv(analysisState, leg) * 100).toFixed(2)}%`).join('; ') || 'No included options'}.</p>
              <p>Both subtract the same signed entry costs and flat allowance. The difference mixes quote/model and scenario assumptions; it is not measured mispricing, executable edge or realized P/L. This shows the selected valuation model, not a read-only American heatmap preview.</p>
            </details>}
            <label>Quote basis<select aria-label="Pricing basis" value={strategy.pricing!.basis} onChange={e => changeBasis(e.target.value as PricingBasis)}><option value="mid">Midpoint · not a promised fill</option><option value="natural">Natural bid / ask</option></select></label>
            <div><button onClick={() => setFixedEntry(strategy.pricing?.entryMode !== 'fixed')}>{strategy.pricing?.entryMode === 'fixed' ? 'Re-estimate entry' : 'Keep entry costs'}</button><details><summary>Entry cost policy</summary><span>{strategy.pricing?.entryMode === 'fixed' ? 'Held option per-share costs are editable below and survive quote refreshes. Not broker-confirmed fills.' : 'Option entry estimates follow quotes. Keep entry costs to retain or edit them.'}{strategy.stock && ' This control affects options only; share entry costs stay held and are edited separately.'}</span></details></div>
            {quoteMark && <details aria-label="Quote valuation"><summary><b>{strategy.stock ? 'Dated options + stock mark P/L' : 'Estimated liquidation P/L'} {money(quoteMark.pnl)}</b></summary><span>{strategy.stock ? 'Combined option estimate + stock mark' : 'Signed liquidation value'} {money(quoteMark.signedLiquidationValue)} − signed entry {money(quoteMark.signedEntry)} − cost allowance {money(quoteMark.feeAllowance ?? 0)}</span>{strategy.stock && <span>Shares marked at underlying snapshot spot: {money(quoteMark.signedStockValue ?? 0)} · {marketSnapshot?.spotAsOf}. Not an executable stock bid/ask.</span>}<details aria-label="Option quoted spreads"><summary>Quoted option spread width {money(quoteMark.optionQuotedSpreadWidth, '—', 2)}</summary><span>Midpoint to natural liquidation difference {money(quoteMark.optionMidToNaturalDifference, '—', 2)}</span>{quoteMark.optionSpreadLegs.map(leg => <span key={leg.legId}>{leg.contracts} × {leg.contractId} · bid {money(leg.bid, '—', 2)} / ask {money(leg.ask, '—', 2)} · position width {money(leg.positionWidthUsd, '—', 2)} · {leg.quoteAsOf}</span>)}<span>{quoteMark.optionSpreadBasis}</span></details><span>{quoteMark.basis} · {quoteMark.oldestQuoteAt} to {quoteMark.newestQuoteAt}</span><span>{quoteMark.historical ? 'Historical quotes. ' : ''}Not scenario-model P/L, realized returns, or a promised fill. Includes the supplied flat allowance, not actual broker fees.</span></details>}
            <StreamedMarks key={`${marketSnapshot.underlying}:${[...new Set(strategy.legs.map(leg => leg.contractId))].sort().join(',')}`} captureEnabled={!chainPending && strategy.pricing?.entryMode === 'fixed'} onCapture={() => void loadMarket(true, undefined, strategy.underlying, undefined, true)} onReview={() => void captureAndReview()} automatic={automatic} onAutomatic={enabled => { if (!enabled) return stopAutomatic(); if (chainPending || workspaceBusy || reviewRequest.current || proposal || strategyRef.current.pricing?.entryMode !== 'fixed') return; automaticGeneration.current++; automaticCheckpoint.current = true; automaticRef.current = true; setAutomatic(true) }} onTick={() => loadMarket(true, undefined, strategyRef.current.underlying, undefined, true, true)} reviewEnabled={!pending && !proposal && !workspaceBusy && !analysisUnavailable} snapshot={marketSnapshot} contracts={[...new Set(strategy.legs.map(leg => leg.contractId))].sort()} />
            <details><summary>Choose chain window</summary><div className="chain-window"><label>Strike center<input aria-label="Strike center" type="number" min="0.001" max="1000000" step="any" value={strikeCenter} onChange={e => setStrikeCenter(e.target.value)} /></label><button disabled={chainPending || !Number.isFinite(Number(strikeCenter)) || Number(strikeCenter) <= 0 || Number(strikeCenter) > 1000000} onClick={() => void loadMarket(true, [...new Set(marketSnapshot.contracts.map(c => c.expiry.slice(0,10)))].sort(), strategy.underlying, Number(strikeCenter))}>Browse strikes</button><small>Retains your selected legs and quantities. {strategy.pricing?.entryMode === 'fixed' ? 'Refreshes quotes; held entry costs remain unchanged.' : 'Refreshes quotes and re-estimates entry.'} Not realized returns.</small></div><div className="chain-window">{Array.from({ length: MAX_OPTION_EXPIRIES }, (_, index) => <label key={index}>Expiry {index+1}{index > 0 ? ' (optional)' : ''}<select aria-label={`Chain expiry ${index+1}`} value={windowDates[index] ?? ''} onChange={e => setWindowDates(dates => Object.assign([...dates], { [index]: e.target.value }))}><option value="" disabled={index === 0}>{index === 0 ? 'Choose expiry' : 'None'}</option>{marketSnapshot.availableExpiries.map(date => <option key={date} value={date}>{date}</option>)}</select></label>)}<button disabled={chainPending || !windowDates[0] || new Set(windowDates.filter(Boolean)).size !== windowDates.filter(Boolean).length} onClick={() => void loadMarket(false, windowDates.filter(Boolean))}>Rebuild template with these expiries</button><small>Calendars and diagonals need two expiries. Leave optional dates as None for a single-expiry window. Rebuilds the current template; custom legs and quantities are replaced. Refresh prices above preserves your legs.</small></div></details>
          </div>}


          {analysisState && <AssignmentOutcomes state={analysisState} snapshot={marketSnapshot ?? undefined} />}
          {analysisState && marketSnapshot && !marketSnapshot.historical && <CandidateSearch key={`${strategy.version}:${marketSnapshot.id}`} state={analysisState} snapshot={marketSnapshot} disabled={pending || chainPending || workspaceBusy || !!proposal} onSearch={stopAutomatic} onInspect={(search, snapshot, id) => void inspectCandidate(search, snapshot, id)} />}
          {hasExclusions && <p className="workspace-notice" role="note">Analysis includes {analysisState?.legs.length ?? 0} of {strategy.legs.length} option legs{strategy.stock ? " plus shares" : ""}. Exclusion is hypothetical: saved holdings, entry costs and full-inventory ledger totals are unchanged.{analysisState && <button onClick={() => commit({ ...strategyRef.current, excludedLegIds: undefined })}>Include all legs</button>}</p>}
          <div className="metric-ribbon">
            {metrics ? <>
            <Metric label={strategy.stock ? `${metrics.entryLabel} · incl. shares` : metrics.entryLabel} value={money(metrics.entryAmount)} foot={strategy.stock ? strategy.pricing?.entryMode === 'fixed' ? 'held stock + option costs' : 'held shares + option estimate' : strategy.pricing?.entryMode === 'fixed' ? 'held entry cost' : 'estimated entry'} />
            <Metric label={mixedExpiry ? 'Modeled high' : 'Max profit'} value={profitValue} tone="positive" foot={mixedExpiry ? 'sampled model range' : stockOnly ? 'share-price bound' : 'at expiry'} />
            <Metric label={mixedExpiry ? 'Modeled low' : 'Max loss'} value={lossValue} tone="negative" foot={mixedExpiry ? 'not exact risk' : strategy.feeAllowance ? 'after cost allowance' : 'before costs'} />
            <Metric label="Breakeven" value={mixedExpiry ? 'Not exact' : metrics.breakevens.map((value) => `$${value.toFixed(2)}`).join(' · ') || '—'} foot={mixedExpiry ? 'cross-expiry' : stockOnly ? 'share-price breakeven' : 'at expiry'} />
            <Metric label="Scenario P/L" value={money(metrics.scenarioPnl)} tone={metrics.scenarioPnl >= 0 ? 'positive' : 'negative'} foot={`at $${strategy.scenarioSpot.toFixed(0)} · modeled`} />
            </> : <p role="status">{valuationError ? <>{valuationError} <button onClick={() => { setValuationResult(undefined); setValuationAttempt(value => value + 1) }}>Retry calculation</button></> : !analysisState ? 'No priced position: add or include holdings.' : 'Calculating current position…'}</p>}
          </div>


          {metrics?.conditionalTail && <p role="note" aria-label="Conditional first-expiry tail">First-expiry {americanModel ? 'American' : 'European'} model: {metrics.conditionalTail.outcome === 'loss-unbounded' ? 'loss grows without bound as spot tends to infinity.' : metrics.conditionalTail.outcome === 'profit-unbounded' ? 'profit grows without bound as spot tends to infinity.' : metrics.conditionalTail.outcome === 'finite-limit' ? 'the upper-price tail has a finite limit—not a complete risk bound.' : 'the upper-price tail is numerically unresolved.'} Not lifetime or assignment risk.</p>}
          {mixedExpiry && metrics && <details className="source-evidence" aria-label="Sampled range assumptions"><summary>First-expiry range and tails</summary><p>{metrics.sampledRange.pointCount} spot samples from ${metrics.sampledRange.spotMin.toFixed(2)} to ${metrics.sampledRange.spotMax.toFixed(2)} at {metrics.sampledRange.date}. Sampled high {money(metrics.sampledRange.high.pnl)} at ${metrics.sampledRange.high.spot.toFixed(2)}; sampled low {money(metrics.sampledRange.low.pnl)} at ${metrics.sampledRange.low.spot.toFixed(2)}.</p><p>Fixed effective leg IV, rate and yield. This finite grid does not establish exact extrema, a loss cap, or a forecast of where price will finish. Assignment and settlement are not simulated.</p>{metrics.conditionalTail && <><p>At zero spot: {money(metrics.conditionalTail.zeroSpotPnl)} P/L. As spot tends to infinity: slope {metrics.conditionalTail.slope?.toPrecision(6) ?? 'unavailable'} USD per $1 spot, intercept {money(metrics.conditionalTail.intercept)}.</p><p>{metrics.conditionalTail.basis}</p></>}</details>}

          {mixedExpiry && metrics && <details className="source-evidence"><summary>Refine first-expiry high and low</summary><FirstExpiryAnalysis state={analysisState!} min={metrics.sampledRange.spotMin} max={metrics.sampledRange.spotMax} busy={pending || analysisUnavailable || (view === 'heatmap' && americanPreview && !americanModel)} onAsk={() => void spar(`Explain the first-expiry minimum and maximum P/L intervals between spot ${metrics.sampledRange.spotMin} and ${metrics.sampledRange.spotMax}, remaining search uncertainty and separate tail and assignment risks. Do not change the position.`, undefined, undefined, { min: metrics.sampledRange.spotMin, max: metrics.sampledRange.spotMax })} /></details>}
          {mixedExpiry && metrics && <details className="source-evidence"><summary>Find first-expiry breakeven candidates</summary><FirstExpiryBreakevens state={analysisState!} min={metrics.sampledRange.spotMin} max={metrics.sampledRange.spotMax} result={breakevenResult} onResult={setBreakevenResult} /></details>}

          <div className="canvas-card" id="workspace-chart" tabIndex={-1} role="region" aria-label="Strategy chart">
            <div className="canvas-head"><div><span className="eyebrow">Position landscape</span><h2>{view === 'table' ? 'Scenario table' : view === 'curve' ? chartMetric === 'pnl' ? displayBasis?.label ?? 'Unavailable' : `${chartMetrics[chartMetric].label} exposure` : 'Price × time surface'}</h2></div><div className="chart-controls">{view === 'heatmap' && !americanModel && <button className="undo-button" aria-pressed={americanPreview} onClick={() => setAmericanPreview(value => !value)}>{americanPreview ? 'Return to European' : 'Preview American'}</button>}{view === 'curve' && <select aria-label="Chart metric" value={chartMetric} onChange={event => setChartMetric(event.target.value as ChartMetric)}>{Object.entries(chartMetrics).map(([key, value]) => <option key={key} value={key}>{value.label}</option>)}</select>}<div className="segmented"><button className={view === 'curve' ? 'active' : ''} onClick={() => setView('curve')}>Curve</button><button className={view === 'heatmap' ? 'active' : ''} disabled={!analysisState?.legs.length} onClick={() => setView('heatmap')}>Heatmap</button><button className={view === 'table' ? 'active' : ''} onClick={() => setView('table')}>Table</button></div></div><div className="scenario"><label>IV shift · pts <ScenarioInput label="IV shift in percentage points" value={Number((strategy.ivShift * 100).toFixed(2))} onCommit={(value) => updateScenario({ ivShift: value / 100 })} /></label><label>At spot · $ <ScenarioInput label="Scenario spot" value={strategy.scenarioSpot} onCommit={(value) => updateScenario({ scenarioSpot: value })} /></label></div></div>
            {chartRange && <p className="chart-inspection heatmap-help">Display only · position and Undo unchanged. Off-range strikes and targets are hidden; Auto restores fitted views.</p>}
            {!!analysisState?.legs.length && <div className="scenario-time">
              <label htmlFor="scenario-date"><span className="scenario-date-heading">Scenario date · UTC<button type="button" title="Use the snapshot valuation time" onClick={() => updateScenario({ scenarioDate: strategy.valuationTimestamp })}>Now</button></span><input id="scenario-date" type="datetime-local" aria-label="Scenario date UTC" step="0.001" min={new Date(valuation).toISOString().slice(0, -1)} max={new Date(firstExpiry).toISOString().slice(0, -1)} value={new Date(strategy.scenarioDate).toISOString().slice(0, -1)} onChange={event => { const at = Date.parse(`${event.target.value}Z`); if (Number.isFinite(at)) updateScenario({ scenarioDate: new Date(at).toISOString() }) }} /></label>
              <div><input type="range" aria-label="Scenario time" aria-valuetext={strategy.scenarioDate} min="0" max="1000" step="1" value={(Date.parse(strategy.scenarioDate) - valuation) / (firstExpiry - valuation) * 1000} onPointerDown={event => { timeDrag.current = true; event.currentTarget.setPointerCapture(event.pointerId) }} onPointerUp={() => { timeDrag.current = null }} onPointerCancel={() => { timeDrag.current = null }} onBlur={() => { timeDrag.current = null }} onChange={event => {
                const at = valuation + (firstExpiry - valuation) * Number(event.target.value) / 1000
                updateScenario({ scenarioDate: new Date(at).toISOString() }, timeDrag.current !== false)
                if (timeDrag.current !== null) timeDrag.current = false
              }} /><small><span>Valuation · {shortDate(strategy.valuationTimestamp)}</span><span>First expiry · {shortDate(new Date(firstExpiry).toISOString())}</span></small></div>
            </div>}
            {stockOnly && <p role="status">Stock-only · No option expiry. Curve and table show share-price scenarios; dividends, financing and borrow are excluded.</p>}
            {!analysisState?.legs.length && strategy.scenarioDate !== strategy.valuationTimestamp && <button className="undo-button" onClick={() => updateScenario({ scenarioDate: strategy.valuationTimestamp })}>Reset scenario to valuation</button>}
            {editError && <div className="calculation-error" role="alert"><strong>Edit not applied</strong><span>{editError}</span><button onClick={() => setEditError('')}>Dismiss</button></div>}
            <div className="chart-controls comparison-controls"><button className="undo-button" disabled={!!proposal || !analysisState} onClick={() => { if (!analysisState) return; setManualBaseline(structuredClone(analysisState)); setView('curve') }}>{manualBaseline ? 'Replace baseline' : 'Freeze comparison'}</button>{manualBaseline && <button className="undo-button" onClick={() => setManualBaseline(undefined)}>Clear baseline</button>}</div>
            {comparedPosition && <div className="comparison-banner" role="status"><strong>{proposal ? 'Comparing proposed position' : `Frozen baseline · ${comparedPosition.underlying} · ${comparedPosition.name}`}</strong><span>{comparisonCompatible ? view === 'curve' ? 'Both curves share the selected date, valuation time and model; option expiry horizons match where both positions contain options.' : 'Switch to Curve to see the overlay.' : 'Different symbol, date, valuation time, model or expiry horizon. Curve overlay hidden.'}</span>{!proposal && <details><summary>Frozen inputs · not saved or sent to AI</summary><p>{comparedPosition.scenarioDate} · {comparedPosition.valuationModel ?? 'european-bsm-v1'} · rate {comparedPosition.rate} · yield {comparedPosition.dividendYield} · IV shift {signed(comparedPosition.ivShift * 100, 2)} pts · allowance {money(comparedPosition.feeAllowance ?? 0)}. Entry costs, shares and all leg assumptions remain frozen; differences are not realized P/L or trading edge.</p>{comparedPosition.expiryIvShifts?.map(shift => <p key={shift.expiry}>{shift.expiry}: additional IV shift {signed(shift.ivShift * 100, 2)} pts</p>)}<p>{holdingDescription(comparedPosition.stock, comparedPosition.underlying)}</p>{comparedPosition.legs.map(leg => <p key={leg.id}>{legDescription(leg)}</p>)}</details>}</div>}
            {!analysisState ? <section aria-label="Empty analysis selection" role="status"><h3>No holdings included in analysis</h3><p>Add an option or shares, or include retained legs below. No P/L, Greeks or expiry probabilities are calculated for an empty selection.</p>{hasExclusions && <button onClick={() => commit({ ...strategyRef.current, excludedLegIds: undefined })}>Include all legs</button>}</section> : !displayBasis ? <p role="status">Risk percent unavailable: choose P/L or position value. This position has no positive exact expiry loss bound.</p> : view === 'curve' ? <PayoffChart range={chartRange} pnlDisplay={activePnlDisplay} metric={chartMetric} state={analysisState} breakevens={breakevenResult?.source === analysisState ? breakevenResult.value : undefined} comparison={comparisonCompatible ? comparedPosition : undefined} comparisonLabel={proposal ? 'Proposed' : 'Frozen baseline'} onDragStart={stopAutomatic} onStrikeCommit={(source, next) => {
              if (strategyRef.current.version === source.version && next !== source) commit(pruneExpiryIvShifts({ ...strategyRef.current, name: next.name, legs: strategyRef.current.legs.map(leg => next.legs.find(updated => updated.id === leg.id) ?? leg) }))
            }} onStrike={(source, id, strike, group, step) => {
              if (strategyRef.current.version !== source.version) return source
              if (group) return translateStrikes(source, id, strike, marketSnapshot, step)
              const leg = source.legs.find(leg => leg.id === id)!
              const strikes = marketSnapshot ? marketSnapshot.contracts.filter(c => c.type === leg.type && c.expiry === leg.expiry).map(c => c.strike).sort((a,b) => a-b) : SAMPLE_STRIKES
              const nearest = step ? strikes[Math.max(0, Math.min(strikes.length - 1, strikes.indexOf(leg.strike) + step))] : strikes.reduce((a,b) => Math.abs(b-strike) < Math.abs(a-strike) ? b : a)
              return legUpdate(source, id, { strike: nearest })
            }} /> : view === 'table' ? <ScenarioTable state={analysisState} pnlDisplay={activePnlDisplay} data={currentValuation?.table} error={valuationError} onSelect={updateScenario} /> : <div className="heatmap-wrap">{americanPreview && !americanModel ? <AmericanHeatmap range={chartRange} state={analysisState} pnlDisplay={activePnlDisplay} /> : <Heatmap state={analysisState} pnlDisplay={activePnlDisplay} points={currentValuation?.heatmap} error={valuationError} onSelect={updateScenario} />}<div className="heatmap-scale"><span>{activePnlDisplay === 'position-value' ? 'ZERO VALUE' : 'LOSS'}</span><i style={activePnlDisplay === 'position-value' ? { background: 'linear-gradient(90deg, rgba(117,153,233,.08), rgba(117,153,233,.7))' } : undefined} /><span>{activePnlDisplay === 'position-value' ? 'LARGER ABSOLUTE VALUE' : 'PROFIT'}</span></div><p className="heatmap-help">{americanPreview && !americanModel ? 'American comparison · 1,024-step lattice · continuous yield. Read-only; hover or use arrows to inspect. AI can inspect seven American checkpoints at the selected date. Headline metrics and probabilities remain European. No discrete dividends, assignment or exercise cashflows.' : 'Click a cell to apply its date and spot. Arrow keys inspect; Enter or Space applies. Values are modeled, not forecasts.'}</p></div>}
            <div className="chart-inspection scenario-display"><label>Scenario value <select aria-label="Scenario value display" disabled={view === 'curve' && chartMetric !== 'pnl'} value={activePnlDisplay} onChange={event => setPnlDisplay(event.target.value as PnlDisplayMode)}><option value="pnl">P/L · USD</option><option value="position-value">Position value · USD</option><option value="risk-percent" disabled={!analysisState || !pnlDisplayBasis(analysisState, 'risk-percent')}>P/L / max loss · %</option></select></label><p>{activePnlDisplay === 'position-value' ? 'Signed model value of options and shares, excluding entry costs and allowance. Positive value is not profit; negative value is a net liability.' : activePnlDisplay === 'risk-percent' ? `P/L divided by exact intact-expiry maximum loss${displayBasis ? ` of ${money(displayBasis.denominator!)}` : ''}. Not margin return, realized return or a forecast. Compared positions use their own risk denominator.` : 'Modeled P/L after entry costs and the flat allowance. Display changes do not edit the position.'}</p></div><details className="expiry-volatility"><summary>IV by expiry{strategy.expiryIvShifts?.length ? ' · adjusted' : ''}</summary><p>Extra percentage-point shifts added to the global shift. Quoted IV and entry costs stay unchanged.</p>{[...new Set(strategy.legs.map(leg => leg.expiry))].sort().map(expiry => <div key={expiry}><label>{expiry.slice(0, 10)} · extra IV pts <ScenarioInput label={`IV shift for expiry ${expiry.slice(0, 10)}`} value={Number(((strategy.expiryIvShifts?.find(shift => shift.expiry === expiry)?.ivShift ?? 0) * 100).toFixed(4))} onCommit={value => changeExpiryIv(expiry, value / 100)} /></label><span>{strategy.legs.filter(leg => leg.expiry === expiry).map(leg => `${leg.type} $${leg.strike}: ${(effectiveIv(strategy, leg) * 100).toFixed(2)}%`).join(' · ')} effective IV</span></div>)}<button disabled={!strategy.expiryIvShifts?.length} onClick={() => commit({ ...strategyRef.current, expiryIvShifts: undefined })}>Reset expiry shifts</button></details>
            <ChartRangeControls key={strategy.underlying} spot={strategy.spot} range={chartRange} onChange={value => setRangeSelection(value ? { underlying: strategy.underlying, value } : undefined)} />
            <div className="chart-inspection"><button disabled={pending || analysisUnavailable || !displayBasis} onClick={() => void spar(`Explain this ${view === 'table' ? 'scenario table' : view === 'heatmap' ? 'price and time heatmap' : chartMetrics[chartMetric].label + ' curve'}. Compare the calculated spot scenarios at my selected date and IV, explain the exposure and P/L separately, and challenge my risk assumptions. Do not change the position.`)}>Ask about this chart</button></div>
            <div className="greek-strip">{metrics ? <><span>NET GREEKS</span><div><small>Δ Delta</small><b>{signed(metrics.delta, 2)}</b></div><div><small>Γ Gamma</small><b>{signed(metrics.gamma, 3)}</b></div><div><small>Θ Theta / day</small><b>{signed(metrics.theta, 2)}</b></div><div><small>V Vega / vol pt</small><b>{signed(metrics.vega, 2)}</b></div><div><small>ρ Rho / rate pt</small><b>{signed(metrics.rho, 2)}</b></div><p>{americanModel ? 'American CRR estimate' : 'European-model estimate'}<br /><button onClick={() => setShowAssumptions((shown) => !shown)}>View assumptions</button></p></> : <p>{analysisState ? 'Current Greeks unavailable until calculation completes.' : 'No Greeks for an empty selection.'}</p>}</div>
            {showAssumptions && <div className="assumptions-panel"><strong>Model assumptions</strong><label>Valuation model <select aria-label="Valuation model" value={strategy.valuationModel ?? 'european-bsm-v1'} onChange={event => { if (event.target.value !== (strategyRef.current.valuationModel ?? 'european-bsm-v1') && commit({ ...strategyRef.current, valuationModel: event.target.value as StrategyState['valuationModel'] })) setAmericanPreview(false) }}><option value="european-bsm-v1">European BSM</option><option value="american-crr-1024-v1">American CRR · 1,024 steps</option></select></label><span>{americanModel ? 'American CRR · 1,024 steps · early-exercise valuation with continuous yield. No discrete dividends or assignment cashflows.' : 'European Black–Scholes · no early exercise.'} Constant IV/rates · supplied flat cost allowance deducted; no actual fee schedule, slippage, dividends beyond the stated yield, or post-expiry position changes.{strategy.stock && ' Shares use mark-only accounting: delta equals signed shares; no dividend, financing, borrow or assignment cashflows. Option yield assumptions are not cash dividends credited to shares.'}</span><button onClick={() => setShowAssumptions(false)}>Close</button></div>}
          </div>
          {marketSnapshot && <OptionChainTable key={marketSnapshot.id} state={strategy} snapshot={marketSnapshot} comparisonPending={pending || workspaceBusy || analysisUnavailable} onDiscussActivity={question => void spar(question)} onAdd={addQuotedLeg} onSelect={(id, contract) => updateLeg(id, { contractId: contract.contractId, type: contract.type, strike: contract.strike, expiry: contract.expiry })} onCompare={(id, contract) => void spar(`Use compare_position with replaceLegId ${JSON.stringify(id)} and replacementContractId ${JSON.stringify(contract.contractId)} from this captured quote window. Compare the alternative position's modeled P/L, bounds, Greeks and quoted spread with my current position. Keep all other holdings and assumptions unchanged. This is a read-only alternative, not a roll: exclude closing proceeds and realized P/L, disclose quote timestamps and the replacement entry estimate. Return no workspace operations.`)} />}

          <div className="legs-card">
          {analysisState && <ProbabilityPanel key={strategy.underlying} state={analysisState} pending={pending || analysisUnavailable} onExplain={range => void spar(`Explain the conditional expiry price probabilities below $${range.lower}, between $${range.lower} and $${range.upper} inclusive, and above $${range.upper}. Distinguish these from chance of profit and touching a price. Do not change the position.`, range)} />}
            <div className="cost-allowance"><label>Total cost allowance · $<ScenarioInput label="Total cost allowance" value={strategy.feeAllowance ?? 0} onCommit={feeAllowance => { if ((strategyRef.current.feeAllowance ?? 0) !== feeAllowance) commit({ ...strategyRef.current, feeAllowance }) }} /></label><p>One flat total deducted once from modeled and quoted P/L. Not per contract, an actual payment, or a broker fee estimate. Quantity changes do not scale it; templates reset it. Asset entry and Greeks remain unchanged.</p></div>
            <div className="section-head" id="workspace-legs" tabIndex={-1} role="group" aria-label="Position construction"><div><span className="eyebrow">Position construction</span><h2>Legs <b>{strategy.legs.length}/{MAX_OPTION_LEGS}</b></h2></div><div className="holding-actions">{!strategy.stock && <button className="add-leg" onClick={() => changeStock({ shares: 100, entryPrice: strategyRef.current.spot })}>Add shares</button>}<button className="add-leg" disabled={strategy.legs.length >= MAX_OPTION_LEGS} onClick={addLeg}>＋ Add leg</button></div></div>
            {strategy.stock && <section className="stock-holding" aria-label="Share holding"><div><b>{strategy.underlying} shares</b><small>Held cost assumption · not a broker-confirmed fill</small></div><label>Signed shares<ScenarioInput label="Shares" value={strategy.stock.shares} onCommit={shares => changeStock({ ...strategyRef.current.stock!, shares })} /></label><label>Held entry · $ / share<ScenarioInput label="Share entry cost" value={strategy.stock.entryPrice} onCommit={entryPrice => changeStock({ ...strategyRef.current.stock!, entryPrice })} /></label><button onClick={() => changeStock(undefined)}>Remove shares</button><p>Positive shares are long; negative shares are short. Remove the holding instead of setting zero. Shares do not count toward the {MAX_OPTION_LEGS}-option limit. Costs survive quote refresh and basis changes; replacing a template resets the holding.</p></section>}
            <div className="leg-list">{strategy.legs.map((leg) => <LegRow key={leg.id} leg={leg} included={!strategy.excludedLegIds?.includes(leg.id)} onInclude={() => { const current = strategyRef.current; const excludedLegIds = current.excludedLegIds?.includes(leg.id) ? current.excludedLegIds.filter(id => id !== leg.id) : [...(current.excludedLegIds ?? []), leg.id]; commit({ ...current, excludedLegIds: excludedLegIds.length ? excludedLegIds : undefined }) }} snapshot={marketSnapshot} fixedEntry={strategy.pricing?.entryMode === 'fixed'} onChange={(patch) => updateLeg(leg.id, patch)} onRemove={() => commit(pruneExpiryIvShifts({ ...strategy, name: 'Custom strategy', excludedLegIds: strategy.excludedLegIds?.filter(id => id !== leg.id), legs: strategy.legs.filter((item) => item.id !== leg.id) }))} />)}</div>
            <details className="leg-risk"><summary>Greeks by leg</summary>{metrics && legRisk ? <><p>At {strategy.scenarioDate.replace('T', ' ').replace('Z', ' UTC')} · spot ${strategy.scenarioSpot.toFixed(2)} · IV shift {signed(strategy.ivShift * 100, 2)} pts. Option contributions include quantity and the 100-share multiplier; stock delta equals signed shares without a multiplier.</p><div className="leg-risk-scroll" tabIndex={0} role="region" aria-label="Scrollable leg Greeks"><table aria-label="Scenario Greeks by leg"><thead><tr><th scope="col">Leg</th><th scope="col">Δ Delta</th><th scope="col">Γ Gamma</th><th scope="col">Θ Theta / day</th><th scope="col">Vega / vol pt</th><th scope="col">Rho / rate pt</th></tr></thead><tbody>{analysisState!.legs.map((leg, index) => <tr key={leg.id}><th scope="row">{leg.side === 'long' ? 'Buy' : 'Sell'} {leg.contracts} × ${leg.strike} {leg.type}<small>{leg.expiry.slice(0, 10)}</small></th>{(['delta', 'gamma', 'theta', 'vega', 'rho'] as const).map(key => <td key={key}>{signed(legRisk[index].greeks[key], key === 'gamma' ? 3 : 2)}</td>)}</tr>)}{strategy.stock && <tr className="stock-greeks"><th scope="row">{signed(strategy.stock.shares)} {strategy.underlying} shares<small>Mark-only holding</small></th>{(['delta', 'gamma', 'theta', 'vega', 'rho'] as const).map(key => <td key={key}>{signed(key === 'delta' ? strategy.stock!.shares : 0, key === 'gamma' ? 3 : 2)}</td>)}</tr>}</tbody><tfoot><tr><th scope="row">Net</th>{(['delta', 'gamma', 'theta', 'vega', 'rho'] as const).map(key => <td key={key}>{signed(metrics[key], key === 'gamma' ? 3 : 2)}</td>)}</tr></tfoot></table></div><p>{americanModel ? 'American-model' : 'European-model'} local sensitivities, not forecasts. Delta: USD per $1 spot move; gamma: delta change per $1; theta: USD/calendar day; vega and rho: USD per percentage point. Rounding may affect displayed sums.</p></> : <p>{analysisState ? 'Current leg Greeks unavailable until calculation completes.' : 'No leg Greeks for an empty selection.'}</p>}</details>
            <div className="risk-note"><i>!</i><div><p aria-label="Recorded contract terms">{contractTerms.status === 'unknown' ? contractTerms.basis : `${marketSnapshot?.historical ? 'Historical' : 'Recorded'} snapshot terms: ${contractTerms.exerciseStyle} exercise · ${contractTerms.settlement === 'cash' ? `cash settlement with $${contractTerms.multiplier} multiplier` : `physical delivery of ${contractTerms.sharesPerContract} shares per contract`} · ${contractTerms.settlementSession} settlement. Recorded terms are not a current corporate-action check.`}</p><p><strong>Modeled, not guaranteed.</strong> Early-exercise valuation is not an exercise or assignment event. Exercise/assignment cashflows, actual fee schedules, slippage, and post-expiry position changes are not simulated in valuation.</p></div><button onClick={() => setShowAssumptions(true)}>Methodology</button></div>
          </div>
        </section>

        <aside className="sparring-rail">
          <div className="sparring-head"><div><span className="argus-orb"><i /></span><div><strong>ARGUS</strong><small><i /> SPARRING PARTNER</small></div></div></div>
          <WorkspaceContext key={strategy.underlying} symbol={strategy.underlying} sample={!strategy.pricing} />
          <details className="thesis-card" hidden={!!proposal}><summary>Your thesis <small>{thesis.trim() ? 'Included in review' : 'optional'}</small></summary><label className="sr-only" htmlFor="trade-thesis">Your thesis</label><textarea id="trade-thesis" value={thesis} maxLength={1000} onChange={(event) => setThesis(event.target.value)} placeholder="What do you expect to happen, and by when?" /></details>
          <div className="conversation" ref={conversationPane}>
            {!messages.length && metrics && <article className="position-brief"><div className="brief-heading"><span>POSITION BRIEF</span><small>Calculated locally</small></div><h3>{metrics.maxLoss == null && !mixedExpiry ? 'Your downside is uncapped.' : mixedExpiry ? 'Time changes this trade.' : `Know the ${money(metrics.maxLoss)} at risk.`}</h3><p>{brief}</p><div className="brief-facts"><span>Theta · local sensitivity<strong>{signed(Number(metrics.theta.toFixed(2)), 2)} USD / day</strong></span><span>Vega · local sensitivity<strong>{signed(briefVega, 2)} USD / IV point</strong></span></div><p className="brief-question">{briefQuestion}</p></article>}
            <div className="session-divider"><span>STRATEGY REVIEW</span></div>
            {messages.map((message, index) => <article key={index} className={`message ${message.role}`}><header>{message.role === 'user' ? 'YOU' : message.role === 'guide' ? 'ARGUS GUIDE' : 'ARGUS'}<time>{index ? 'now' : 'workspace'}</time></header>
              {message.analysis && <p className={`analysis-context${message.analysis.positionVersion !== strategy.version ? ' earlier' : ''}`}>{message.analysis.positionVersion === strategy.version ? 'Current position' : 'Earlier position · review again after edits'}<span>{message.analysis.positionUnderlying} · {message.analysis.positionName} · workspace v{message.analysis.positionVersion}</span></p>}
              {message.analysis && <small>AI interpretation, assumptions and objections may contain errors. Calculated results are shown separately.</small>}
              <p>{message.text}</p>
              {message.analysis && <div className="analysis-evidence">
                {message.analysis.calculated && <div className="verified-risk"><b>CALCULATED · {message.analysis.calculated.historicalQuotes ? 'HISTORICAL QUOTES' : message.analysis.calculated.dataMode === 'market-snapshot' ? 'QUOTED POSITION' : 'SAMPLE POSITION'}</b><p>{message.analysis.calculated.riskSummary}</p></div>}
                {!!message.analysis.calculated?.requestedScenarios?.length && <RequestedScenarios scenarios={message.analysis.calculated.requestedScenarios} baseline={message.analysis.position} snapshot={message.analysis.positionSnapshot} />}
                {message.analysis.calculated?.positionComparison && <PositionComparison result={message.analysis.calculated.positionComparison} baseline={message.analysis.position} current={message.analysis.calculated.metrics} snapshot={message.analysis.positionSnapshot} />}
                {message.analysis.calculated?.candidateSearch && <section className="verified-risk" aria-label="Ranked quoted candidates">
                  <b>QUOTED ALTERNATIVES · NEW POSITIONS</b>
                  <p>{message.analysis.calculated.candidateSearch.coverage}</p>
                  <p>{message.analysis.calculated.candidateSearch.assumptions}</p>
                  <details><summary>Search probability assumptions</summary><p>{message.analysis.calculated.candidateSearch.probabilityBasis}</p><p>Workspace probability after Apply uses your selected scenario and nearest strategy-leg IV; it can differ from these search figures.</p></details>
                  <p>{message.analysis.calculated.candidateSearch.evaluated} evaluated · {message.analysis.calculated.candidateSearch.eligible} within constraints · showing {message.analysis.calculated.candidateSearch.candidates.length}. Ranked by {message.analysis.calculated.candidateSearch.request.objective}.</p>
                  <p>Target ${message.analysis.calculated.candidateSearch.request.targetSpot} at {message.analysis.calculated.candidateSearch.request.targetDate} · {message.analysis.calculated.candidateSearch.model}. Not expected returns.</p>
                  {message.analysis.calculated.candidateSearch.candidates.map((candidate, rank) => <div key={candidate.id}>
                    <p><strong>{rank + 1}. {candidate.state.stock && `${candidate.state.stock.shares} shares at ${money(candidate.state.stock.entryPrice)} dated mark / `}{candidate.state.legs.map(legDescription).join(' / ')}</strong></p>
                    <p>Max profit at expiry {candidate.lossBound ? 'Not exact' : candidate.metrics.maxProfit === null ? 'Unbounded' : money(candidate.metrics.maxProfit)} · {candidate.lossBound ? `Conservative first-expiry loss bound ${money(candidate.lossBound.amount)} at ${candidate.lossBound.date}` : `max loss at expiry ${money(candidate.metrics.maxLoss)}`}</p>
                    {candidate.lossBound && <p>{candidate.lossBound.basis} This does not cap losses before first expiry or lifetime losses.</p>}
                    <p>Target P/L {money(candidate.metrics.scenarioPnl)} · score {candidate.score.toFixed(3)}</p>
                    <p>Modeled expiry profit probability: {candidate.probability.probability === null ? 'Unavailable' : `${(candidate.probability.probability * 100).toFixed(1)}%`} · not a forecast</p>
                    <details><summary>Probability reference</summary><p>From ${candidate.probability.spot} at {candidate.probability.from} to {candidate.probability.expiry}. IV {candidate.probability.volatility === null ? 'unavailable' : (candidate.probability.volatility * 100).toFixed(1)}% ({candidate.probability.volatilityContractId}).</p></details>
                    <button className="preview-chart-button" disabled={pending || chainPending || workspaceBusy || analysisUnavailable || message.analysis!.positionVersion !== strategy.version || message.analysis!.calculated.candidateSearch!.snapshotId !== strategy.pricing?.snapshotId} onClick={() => void inspectCandidate(message.analysis!.calculated.candidateSearch, message.analysis!.positionSnapshot, candidate.id, message.analysis!)}>Inspect candidate</button>
                  </div>)}
                  {message.analysis.positionVersion !== strategy.version && <p>Earlier search · run a new search before applying an alternative.</p>}
                </section>}
                {message.analysis.calculated?.expirationProbability?.priceRange && <div className="verified-risk" aria-label="Captured probability range"><b>CAPTURED EXPIRY PRICE RANGE</b><p>${message.analysis.calculated.expirationProbability.priceRange.lower}–${message.analysis.calculated.expirationProbability.priceRange.upper} inclusive · {(message.analysis.calculated.expirationProbability.priceRange.between * 100).toFixed(1)}% conditional model probability</p><p>From ${message.analysis.calculated.expirationProbability.spot} at {message.analysis.calculated.expirationProbability.from} to {message.analysis.calculated.expirationProbability.expiry}. IV {(message.analysis.calculated.expirationProbability.volatility * 100).toFixed(2)}%. Not chance of profit or a forecast.</p><details><summary>Captured distribution assumptions</summary><p>Below range {(message.analysis.calculated.expirationProbability.priceRange.below * 100).toFixed(1)}% · above range {(message.analysis.calculated.expirationProbability.priceRange.above * 100).toFixed(1)}%.</p><p>IV reference {message.analysis.calculated.expirationProbability.volatilityContractId} · rate {(message.analysis.calculated.expirationProbability.rate * 100).toFixed(2)}% · yield {(message.analysis.calculated.expirationProbability.dividendYield * 100).toFixed(2)}%.</p><p>{message.analysis.calculated.expirationProbability.basis}</p></details></div>}
                {message.analysis.calculated?.chartInspection && <ChartAnalysis inspection={message.analysis.calculated.chartInspection} />}
                {message.analysis.calculated?.scenario && <details className="source-evidence"><summary>Calculations for this analysis</summary><small>{message.analysis.calculated.scenario.date} · spot ${message.analysis.calculated.scenario.spot.toFixed(2)}</small>{message.analysis.calculated.scenario.valuation && <section><b>Position valuation · USD</b><span>Entry estimate (signed) {signed(message.analysis.calculated.scenario.valuation.signedEntryEstimate, 2)}</span><span>Cost allowance {signed(message.analysis.calculated.scenario.valuation.feeAllowance ?? 0, 2)}</span><span>Model value (signed) {signed(message.analysis.calculated.scenario.valuation.signedModelValue, 2)}</span><span>Option intrinsic (signed) {signed(message.analysis.calculated.scenario.valuation.signedIntrinsicValue, 2)}</span>{message.analysis.calculated.scenario.valuation.signedStockValue !== undefined && <span>Stock mark (signed) {signed(message.analysis.calculated.scenario.valuation.signedStockValue, 2)}</span>}<span>Model residual (signed) {signed(message.analysis.calculated.scenario.valuation.signedModelResidual, 2)}</span><span>Modeled P/L {signed(message.analysis.calculated.scenario.valuation.modelPnl, 2)}</span><p>Model value − entry estimate − cost allowance = modeled P/L. {message.analysis.calculated.scenario.valuation.signedStockValue !== undefined ? 'Model value − stock mark − option intrinsic = model residual' : 'Model value − intrinsic = model residual'}, not a share of entry cost. Long leg entry/model/intrinsic amounts add; short leg amounts subtract. Residual and P/L may have either sign. {message.analysis.calculated.scenario.valuation.entryBasis} {message.analysis.calculated.scenario.valuation.stockBasis}</p></section>}{message.analysis.calculated.scenario.legs.map(leg => <section key={leg.legId}><b>{leg.legId} · {leg.moneyness}</b><span>Model value ${leg.modelValuePerShare.toFixed(4)} / share</span><span>Intrinsic ${leg.intrinsicPerShare.toFixed(4)} / share</span><span>Model value minus intrinsic ${leg.modelValueMinusIntrinsicPerShare.toFixed(4)} / share</span></section>)}{message.analysis.calculated.scenario.timeStep && <section><b>Repriced through {shortDate(message.analysis.calculated.scenario.timeStep.date)}</b><span>Modeled value change {signed(message.analysis.calculated.scenario.timeStep.changeInValue, 2)} USD over {message.analysis.calculated.scenario.timeStep.calendarDays} calendar day(s)</span><p>{message.analysis.calculated.scenario.timeStep.assumptions}</p></section>}<p>{message.analysis.calculated.scenario.basis}</p></details>}
                {!!message.analysis.reply.objections?.length && <div><b>What could break the thesis</b><ul>{message.analysis.reply.objections.map((item, i) => <li key={i}>{item}</li>)}</ul></div>}
                {!!message.analysis.reply.assumptions?.length && <details><summary>Assumptions</summary><ul>{message.analysis.reply.assumptions.map((item, i) => <li key={i}>{item}</li>)}</ul></details>}
                {message.analysis.market_context && <details className="source-evidence"><summary>Sources & data gaps · {message.analysis.market_context.sources.filter((source) => source.status === 'available').length} available</summary><p>Context sources are separate from the position's pricing snapshot. Source availability does not mean the model used it.</p>{message.analysis.market_context.sources.map((source) => <section key={source.id}><b>{source.provider} · {message.analysis?.reply.evidence_ids?.includes(source.id) ? 'CITED' : source.status === 'available' ? 'AVAILABLE' : 'UNAVAILABLE'}</b><span>{source.url ? <a href={source.url} target="_blank" rel="noopener noreferrer">{source.label}</a> : source.label}</span><small>{source.id} · as of {source.asOf ?? 'not established'}</small><p>{source.summary}{source.reason ? ` ${source.reason}` : ''}</p></section>)}<small>Retrieved {message.analysis.market_context.retrievedAt}</small></details>}
              </div>}
              {message.note && <small>{message.note}</small>}</article>)}
            {proposal && <p className="comparison-scenarios">Scenario: {proposal.comparisonBaseline ? 'held baseline at target' : 'current'} ${(proposal.comparisonBaseline ?? strategy).scenarioSpot.toFixed(2)} on {shortDate((proposal.comparisonBaseline ?? strategy).scenarioDate)}, IV {signed(strategy.ivShift * 100, 1)} pts; proposed ${proposal.next_state.scenarioSpot.toFixed(2)} on {shortDate(proposal.next_state.scenarioDate)}, IV {signed(proposal.next_state.ivShift * 100, 1)} pts.</p>}
            {proposal?.comparisonBaseline && <section aria-label="Optimizer target comparison"><h3>Held versus candidate at search target</h3><p>Held entries and costs are unchanged. Both positions are modeled at ${proposal.comparisonBaseline.scenarioSpot.toFixed(2)} on {proposal.comparisonBaseline.scenarioDate}, using the captured valuation time and model. This read-only comparison does not change the workspace scenario. Different expiry payoffs are not being equated; the curves show target-date modeled P/L, not realized returns.</p><PayoffChart state={proposal.comparisonBaseline} comparison={comparedPosition} comparisonLabel="Candidate at target" metric="pnl" readOnly /></section>}
            {proposal?.comparisonUnavailable && <p role="status" aria-label="Optimizer comparison unavailable">{proposal.comparisonUnavailable}</p>}
            {proposal?.lossBound && <p aria-label="Candidate conservative first-expiry bound">Conservative first-expiry loss bound: {money(proposal.lossBound.amount)} at {proposal.lossBound.date}. Exact maximum loss and profit are not established. {proposal.lossBound.basis} This budget does not cap losses before first expiry or lifetime losses. Assignment, funding and slippage are excluded. Target P/L divided by this bound is a scenario ratio, not a return forecast.</p>}
            {proposal && <article className="proposal-card"><header>PROPOSED CHANGE <small>review before applying</small></header><div className="comparison-metrics"><span>Metric</span><span>{proposal.comparisonBaseline ? 'Held at target' : 'Current'}</span><span>Proposed</span><span>Entry</span><b>{proposal.before.entryLabel} {money(proposal.before.entryAmount)}</b><b>{proposal.metrics.entryLabel} {money(proposal.metrics.entryAmount)}</b><span>Max loss</span><b>{proposal.before.mode === 'first-expiry' ? 'Not exact' : money(proposal.before.maxLoss, 'Unbounded')}</b><b>{proposal.metrics.mode === 'first-expiry' ? 'Not exact' : money(proposal.metrics.maxLoss, 'Unbounded')}</b><span>Max profit</span><b>{proposal.before.mode === 'first-expiry' ? 'Not exact' : money(proposal.before.maxProfit, 'Unbounded')}</b><b>{proposal.metrics.mode === 'first-expiry' ? 'Not exact' : money(proposal.metrics.maxProfit, 'Unbounded')}</b><span>Cost allowance</span><b>{money(strategy.feeAllowance ?? 0, '—', 2)}</b><b>{money(proposal.next_state.feeAllowance ?? 0, '—', 2)}</b><span>Scenario P/L</span><b>{money(proposal.before.scenarioPnl)}</b><b>{money(proposal.metrics.scenarioPnl)}</b></div><div className="comparison-leg-list">{(strategy.stock || proposal.next_state.stock) && <section aria-label="Share holding comparison"><p><small>CURRENT</small>{holdingDescription(strategy.stock, strategy.underlying)}</p><p><small>PROPOSED</small>{holdingDescription(proposal.next_state.stock, proposal.next_state.underlying)}</p><p>Held per-share costs are assumptions, not confirmed trades or fills.</p></section>}{strategy.legs.filter((leg) => !proposal.next_state.legs.some((next) => legDescription(next) === legDescription(leg))).map((leg) => <p key={`before-${leg.id}`}><small>REMOVE</small>{legDescription(leg)}</p>)}{proposal.next_state.legs.filter((leg) => !strategy.legs.some((before) => legDescription(before) === legDescription(leg))).map((leg) => <p key={`after-${leg.id}`}><small>ADD</small>{legDescription(leg)}</p>)}</div>{proposal.reply.assumptions.length > 0 && <p><b>Assumes:</b> {proposal.reply.assumptions.join(' · ')}</p>}{proposal.reply.objections.length > 0 && <p><b>Objections:</b> {proposal.reply.objections.join(' · ')}</p>}<footer><button onClick={() => { setProposal(null); setMessages((items) => [...items, { role: 'argus', text: 'Proposal dismissed. Your current position is unchanged.' }]) }}>Keep current</button><button className="accept" onClick={acceptProposal}>Apply proposal</button></footer></article>}
            {pending && <article className="message argus thinking"><header>ARGUS <time>checking</time></header><p><i /><i /><i /></p><small>Calculations remain deterministic</small></article>}
          </div>
          <div className="prompt-chips" aria-disabled={analysisUnavailable}><button disabled={analysisUnavailable} onClick={() => spar('What breaks this trade?')}>Break the thesis</button><button disabled={analysisUnavailable} onClick={() => spar('Compare this with a calendar spread.')}>Compare structure</button><button disabled={analysisUnavailable} onClick={() => spar('Reduce downside without adding a fifth leg.')}>Reduce downside</button></div>
          {analysisUnavailable && <p role="note">AI review requires at least one included holding.</p>}
          {hasExclusions && !analysisUnavailable && <p role="note">AI reviews included holdings only. Proposals retain excluded legs and entry costs; exclusion does not close a holding.</p>}
          <form className="composer" onSubmit={(event) => { event.preventDefault(); void spar() }}><textarea id="workspace-question" aria-label="Ask ARGUS" placeholder="Challenge, compare, or reshape this trade…" value={composer} onChange={(event) => setComposer(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); void spar() } }} /><div><span>Ctrl / ⌘ + Enter</span><button disabled={!composer.trim() || pending || analysisUnavailable} aria-label="Send message">↑</button></div></form>
          <footer><span><i /> OpenRouter conversation</span><button onClick={() => { reviewGeneration.current++; reviewRequest.current?.abort(); reviewRequest.current = null; setPending(false); setMessages([]); setProposal(null) }}>Clear</button></footer>
        </aside>
      </div>
    </main>
  )
}
