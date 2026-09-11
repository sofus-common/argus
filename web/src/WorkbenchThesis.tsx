import { useEffect, useMemo, useState } from 'react'
import { PayoffChart } from './App'
import { validateStrategy, type StrategyState } from './options'

export function thesisDateUtc(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?$/.test(value)) return ''
  const canonical = value.length === 16 ? `${value}:00.000Z` : `${value.split('.')[0]}.${(value.split('.')[1] ?? '').padEnd(3, '0')}Z`
  const time = Date.parse(canonical)
  return Number.isFinite(time) && new Date(time).toISOString() === canonical ? canonical : ''
}

export function buildThesisScenario(state: StrategyState | null, targetSpot: number, targetDate: string): { scenario: StrategyState | null; error: string } {
  if (!state?.legs.length) return { scenario: null, error: 'Include an option position to test a thesis.' }
  if (!Number.isFinite(targetSpot) || targetSpot < .001 || targetSpot > 1_000_000) return { scenario: null, error: 'Enter a target price from 0.001 to 1,000,000.' }
  const time = Date.parse(targetDate)
  if (!Number.isFinite(time) || new Date(time).toISOString() !== targetDate) return { scenario: null, error: 'Enter a valid target date and time in UTC.' }
  if (time < Date.parse(state.valuationTimestamp) || time > Math.min(...state.legs.map(leg => Date.parse(leg.expiry)))) return { scenario: null, error: 'Target time must be between valuation and the first included option expiry.' }
  const scenario = { ...structuredClone(state), scenarioSpot: targetSpot, scenarioDate: targetDate }
  const errors = validateStrategy(scenario)
  return errors.length ? { scenario: null, error: errors.join('; ') } : { scenario, error: '' }
}

export function WorkbenchThesis({ state, thesis, onChange, onOptimize, optimizeEnabled }: { state: StrategyState | null; thesis?: StrategyState['thesis']; onChange: (patch: Partial<NonNullable<StrategyState['thesis']>>) => void; onOptimize: (target: { targetSpot: number; targetDate: string }) => void; optimizeEnabled: boolean }) {
  const [spot, setSpot] = useState(thesis?.targetSpot?.toString() ?? '')
  useEffect(() => { setSpot(thesis?.targetSpot?.toString() ?? '') }, [thesis])
  const date = thesis?.targetDate?.replace(/Z$/, '') ?? ''
  const [tested, setTested] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const { scenario, error } = useMemo(() => buildThesisScenario(state, spot.trim() ? Number(spot) : NaN, thesisDateUtc(date)), [state, spot, date])
  useEffect(() => { if (!scenario) setTested(false) }, [scenario])
  const invalidate = () => { setTested(false); setExpanded(false) }
  const firstExpiry = state?.legs.length ? state.legs.reduce((first, leg) => leg.expiry < first ? leg.expiry : first, state.legs[0].expiry) : undefined
  return <section className="workbench-thesis" aria-label="Test a thesis">
    <div className="workbench-thesis-fields">
      <label>Target price<input aria-label="Thesis target price" type="number" min="0.001" max="1000000" step="any" value={spot} onChange={event => { setSpot(event.target.value); invalidate() }} onBlur={event => { if (!event.target.validity.valid) setSpot(thesis?.targetSpot?.toString() ?? ''); else if ((spot ? Number(spot) : null) !== (thesis?.targetSpot ?? null)) onChange({ targetSpot: spot ? Number(spot) : null }) }} onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur() }} /></label>
      <label>Target date and time (UTC)<input aria-label="Thesis horizon UTC" type="datetime-local" step="0.001" min={state?.valuationTimestamp.replace(/Z$/, '')} max={firstExpiry?.replace(/Z$/, '')} value={date} onChange={event => { onChange({ targetDate: thesisDateUtc(event.target.value) || null }); invalidate() }} /></label>
      <button disabled={!scenario} onClick={() => { setTested(true); setExpanded(false) }}>Test thesis</button>
      <button disabled={!scenario || !optimizeEnabled} onClick={() => { if (scenario) onOptimize({ targetSpot: scenario.scenarioSpot, targetDate: scenario.scenarioDate }) }}>Optimize trade</button>
    </div>
    <p>Thesis, target and horizon are saved with the position and included in position review. Chart inspection does not change them.</p>
    {!optimizeEnabled && <p>Optimization needs a current quoted position, with no quote load, save or proposal review in progress.</p>}
    {error && <p role="status">{error}</p>}
    {tested && scenario && <details className="workbench-thesis-preview" open={expanded} onToggle={event => setExpanded(event.currentTarget.open)}>
      <summary>Thesis preview · {scenario.scenarioSpot} at {scenario.scenarioDate}</summary>
      <p>Read-only modeled P/L for included holdings at {scenario.scenarioDate} and target {scenario.scenarioSpot}{scenario.underlyingKind === 'cash-index' ? ' index points' : ' USD per share'}. Valuation basis: {scenario.valuationTimestamp} · {scenario.valuationModel ?? 'european-bsm-v1'} · rate {scenario.rate} · yield {scenario.dividendYield} · IV shift {scenario.ivShift} · cost allowance {scenario.feeAllowance ?? 0} USD. Held entries and version {scenario.version} are unchanged.</p>
      {!!scenario.expiryIvShifts?.length && <p>Additional expiry IV shifts: {scenario.expiryIvShifts.map(shift => `${shift.expiry}: ${shift.ivShift}`).join(' · ')}.</p>}
      {expanded && <PayoffChart state={scenario} metric="pnl" readOnly />}
    </details>}
  </section>
}
