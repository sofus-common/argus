import { useEffect, useState } from 'react'
import { PayoffChart, Heatmap, ScenarioTable, ScenarioInput, ChartRangeControls, chartMetrics, type ChartMetric } from './App'
import { effectiveIv, marketLeg, pnlDisplayBasis, SAMPLE_STRIKES, sampleContractId, translateStrikes, type MarketSnapshot, type ChartRange, type PnlDisplayMode, type StrategyState } from './options'
import { assertWorkbenchPosition } from './scenario-lab-model'
import { requestWorkspaceValuation } from './workspace-valuation-client'
import './lab-analysis-chart.css'

export function LabAnalysisChart({ state, snapshot, onChange, onPositionChange, onAsk }: { state: StrategyState; snapshot?: MarketSnapshot; onChange: (state: StrategyState) => void; onPositionChange?: (state: StrategyState) => void; onAsk?: () => void }) {
  const [view, setView] = useState<'curve' | 'heatmap' | 'table'>('curve')
  const [metric, setMetric] = useState<ChartMetric>('pnl')
  const [display, setDisplay] = useState<PnlDisplayMode>('pnl')
  const [range, setRange] = useState<ChartRange | undefined>(state.pricing ? undefined : { min: 80, max: 120 })
  const [baseline, setBaseline] = useState<StrategyState>()
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [result, setResult] = useState<{ source: StrategyState; view: string; range?: ChartRange; value?: Awaited<ReturnType<typeof requestWorkspaceValuation>>; error?: string }>()
  useEffect(() => {
    if (view === 'curve') return
    const controller = new AbortController()
    requestWorkspaceValuation(state, controller.signal, view, range).then(value => {
      if (!controller.signal.aborted) setResult({ source: state, view, range, value })
    }).catch(reason => {
      if (!controller.signal.aborted) setResult({ source: state, view, range, error: reason instanceof Error ? reason.message : 'Calculation unavailable.' })
    })
    return () => controller.abort()
  }, [state, view, range, attempt])
  const current = result?.source === state && result.view === view && result.range === range ? result : undefined
  const activeDisplay = pnlDisplayBasis(state, display) && (!baseline || pnlDisplayBasis(baseline, display)) ? display : 'pnl'
  const valuation = Date.parse(state.valuationTimestamp)
  const expiry = Math.min(...state.legs.map(leg => Date.parse(leg.expiry)))
  const select = (patch: Partial<StrategyState>) => {
    try { const next = { ...state, ...patch }; assertWorkbenchPosition(next, snapshot); onChange(next); setError('') }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Invalid inspection.') }
  }
  const strike = (source: StrategyState, id: string, requested: number, group: boolean, step?: -1 | 1) => {
    const leg = source.legs.find(item => item.id === id)!
    const strikes = snapshot ? [...new Set(snapshot.contracts.filter(c => c.type === leg.type && c.expiry === leg.expiry).map(c => c.strike))].sort((a,b) => a-b) : SAMPLE_STRIKES
    const nearest = step ? strikes[Math.max(0, Math.min(strikes.length - 1, strikes.indexOf(leg.strike) + step))] : strikes.reduce((a, b) => Math.abs(b - requested) < Math.abs(a - requested) ? b : a)
    const replacement = snapshot ? marketLeg(snapshot.contracts.find(c => c.type === leg.type && c.expiry === leg.expiry && c.strike === nearest)!, leg.side, leg.contracts, leg.id, source.pricing!.basis, source.pricing?.entryMode === 'fixed' ? leg : undefined) : { ...leg, strike: nearest, contractId: sampleContractId(leg.type, nearest, leg.expiry) }
    const next = group ? translateStrikes(source, id, requested, snapshot, step) : { ...source, legs: source.legs.map(item => item.id === id ? replacement : item) }
    assertWorkbenchPosition(next, snapshot)
    return next
  }
  return <section className="lac" aria-label="Interactive trade analysis">
    <header className="canvas-head"><h2>{view === 'curve' ? chartMetrics[metric].label : view === 'table' ? 'Scenario table' : 'Price × time'}</h2><div className="chart-controls"><select aria-label="Chart metric" value={metric} disabled={view !== 'curve'} onChange={event => setMetric(event.target.value as ChartMetric)}>{Object.entries(chartMetrics).map(([key, value]) => <option key={key} value={key}>{value.label}</option>)}</select><div className="segmented" aria-label="Analysis views">{(['curve', 'heatmap', 'table'] as const).map(name => <button key={name} className={view === name ? 'active' : ''} aria-pressed={view === name} onClick={() => setView(name)}>{name[0].toUpperCase() + name.slice(1)}</button>)}</div></div><div className="scenario"><label>IV shift · pts<ScenarioInput label="IV shift in percentage points" value={Number((state.ivShift * 100).toFixed(2))} onCommit={value => select({ ivShift: value / 100 })}/></label><label>At spot · $<ScenarioInput label="Scenario spot" value={state.scenarioSpot} onCommit={value => select({ scenarioSpot: value })}/></label></div></header>
    <p className="lac-note">Display inspection does not rewrite your thesis. Dragging strikes edits the hypothetical trade. {snapshot ? 'Dated market quotes; modeled outcomes are not executable fills.' : 'Synthetic model, not live quotes.'}</p>
    <div className="scenario-time"><label><span className="scenario-date-heading">Scenario date · UTC<button onClick={() => select({ scenarioDate: state.valuationTimestamp })}>Now</button></span><input type="datetime-local" aria-label="Scenario date UTC" step="0.001" min={new Date(valuation).toISOString().slice(0, -1)} max={new Date(expiry).toISOString().slice(0, -1)} value={new Date(state.scenarioDate).toISOString().slice(0, -1)} onChange={event => { const at = Date.parse(`${event.target.value}Z`); if (Number.isFinite(at)) select({ scenarioDate: new Date(at).toISOString() }) }}/></label><div><input type="range" aria-label="Scenario time" min={valuation} max={expiry} step={1} value={Date.parse(state.scenarioDate)} onChange={event => select({ scenarioDate: new Date(Number(event.target.value)).toISOString() })}/><small><span>Valuation · {state.valuationTimestamp.slice(0, 10)}</span><span>First expiry · {new Date(expiry).toISOString().slice(0, 10)}</span></small></div></div>
    <div className="chart-controls comparison-controls"><button onClick={() => { setBaseline(structuredClone(state)); setView('curve') }}>{baseline ? 'Replace baseline' : 'Freeze comparison'}</button>{baseline && <button onClick={() => setBaseline(undefined)}>Clear baseline</button>}</div>
    {error && <p role="alert">{error}</p>}{current?.error && <p role="alert">{current.error} <button onClick={() => setAttempt(value => value + 1)}>Retry calculation</button></p>}
    {view === 'curve' ? <PayoffChart state={state} metric={metric} pnlDisplay={activeDisplay} range={range} comparison={baseline} comparisonLabel="Frozen baseline" onStrike={strike} onStrikeCommit={(_, next) => onPositionChange?.(next)} readOnly={!onPositionChange}/> : view === 'table' ? <ScenarioTable state={state} pnlDisplay={activeDisplay} data={current?.value?.table} error={current?.error} onSelect={select} selectionNote="Select a price to inspect only. Show thesis scenario restores the thesis view; the saved position is unchanged."/> : <div className="heatmap-wrap"><Heatmap state={state} pnlDisplay={activeDisplay} points={current?.value?.heatmap} error={current?.error} onSelect={select}/><div className="heatmap-scale"><span>{activeDisplay === 'position-value' ? 'ZERO VALUE' : 'LOSS'}</span><i style={activeDisplay === 'position-value' ? { background: 'linear-gradient(90deg, rgba(117,153,233,.08), rgba(117,153,233,.7))' } : undefined}/><span>{activeDisplay === 'position-value' ? 'LARGER ABSOLUTE VALUE' : 'PROFIT'}</span></div><p className="heatmap-help">Click a cell to inspect its date and spot. Arrow keys inspect; Enter or Space selects. Modeled values, not forecasts.</p></div>}
    <div className="chart-inspection scenario-display"><label>Scenario value<select aria-label="Scenario value display" value={activeDisplay} disabled={view === 'curve' && metric !== 'pnl'} onChange={event => setDisplay(event.target.value as PnlDisplayMode)}><option value="pnl">P/L · USD</option><option value="position-value">Position value · USD</option><option value="risk-percent" disabled={!pnlDisplayBasis(state, 'risk-percent') || !!baseline && !pnlDisplayBasis(baseline, 'risk-percent')}>P/L / max loss · %</option></select></label><p>{activeDisplay === 'position-value' ? 'Signed model value, excluding entry costs and allowance. Positive value is not profit; negative value is a net liability.' : activeDisplay === 'risk-percent' ? 'P/L divided by exact intact-expiry maximum loss. Not margin return or a forecast. Compared positions use their own denominator.' : 'Modeled P/L after entry costs and the flat allowance. Display changes do not edit the position.'}</p></div>
    <details className="expiry-volatility"><summary>IV by expiry</summary><p>This single-expiry prototype uses the global IV shift above; per-expiry adjustments are not enabled.</p>{[...new Set(state.legs.map(leg => leg.expiry))].map(date => <p key={date}>{date.slice(0, 10)} · {state.legs.filter(leg => leg.expiry === date).map(leg => `${leg.type} $${leg.strike}: ${(effectiveIv(state, leg) * 100).toFixed(2)}%`).join(' · ')} effective IV</p>)}</details>
    <ChartRangeControls spot={state.spot} range={range} onChange={setRange}/><div className="chart-inspection"><button onClick={onAsk} disabled={!onAsk}>Ask about this chart</button></div>
  </section>
}
