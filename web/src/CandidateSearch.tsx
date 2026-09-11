import { useEffect, useRef, useState, type ReactNode } from 'react'
import { CANDIDATE_OPTION_FAMILIES, candidateOptionFamily, candidateStrategyFamily, expirationProbability, firstExpirySpreadLossBound, validateMarketStrategy, type MarketSnapshot, type StrategyState, type searchCandidates } from './options'
import { requestWorkspaceValuation, requestOptimizerSensitivity } from './workspace-valuation-client'
import { ExpiryPlot } from './scenario-lab-optimizer'
import type { optimizerSensitivity } from './optimizer-sensitivity'

export type CandidateSearchResult = ReturnType<typeof searchCandidates>

export function CandidateStress({ state, snapshot }: { state: StrategyState; snapshot: MarketSnapshot }) {
  const [result, setResult] = useState<ReturnType<typeof optimizerSensitivity> | null>(null)
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)
  const request = useRef<AbortController | null>(null)
  useEffect(() => () => request.current?.abort(), [state, snapshot])
  const calculate = async () => {
    request.current?.abort()
    const controller = new AbortController(); request.current = controller
    setPending(true); setError(''); setResult(null)
    try { const value = await requestOptimizerSensitivity(state, snapshot, controller.signal); if (!controller.signal.aborted) setResult(value) }
    catch { if (!controller.signal.aborted) setError('Stress comparison unavailable for this quoted position. No synthetic fallback was used.') }
    finally { if (!controller.signal.aborted) setPending(false) }
  }
  return <details className="candidate-stress"><summary>Stress price, time, IV & entry costs</summary>
    <button type="button" disabled={pending} onClick={() => void calculate()}>{pending ? 'Calculating stress…' : 'Calculate stress comparison'}</button>
    {error && <p role="alert">{error}</p>}
    {result && <><p>{result.assumptions}</p><div className="candidate-stress-table"><table><caption>Same position · dated quotes · modeled P/L in USD</caption><thead><tr><th>Scenario</th><th>P/L</th><th>Change vs target</th></tr></thead><tbody>
      <tr><th>Target baseline</th><td>{money(result.baseline.pnl)}</td><td>—</td></tr>
      {result.scenarios.map(row => <tr key={row.name}><th>{row.name}</th><td title={row.unavailable ?? undefined}>{row.pnl === null ? 'Unavailable' : money(row.pnl)}</td><td>{row.pnl === null ? '—' : money(row.pnl - result.baseline.pnl)}</td></tr>)}
      {result.entries?.map(row => <tr key={row.basis}><th>{row.basis === 'mid' ? 'Midpoint' : 'Natural'} entry estimate</th><td>{money(row.pnl)}</td><td>{money(row.pnl - result.baseline.pnl)}</td></tr>)}
    </tbody></table></div></>}
  </details>
}
type Search = CandidateSearchResult['request']
type Domain = NonNullable<Parameters<typeof searchCandidates>[3]>
const familyLabels = { options: 'Options only', 'long-call': 'Long call', 'long-put': 'Long put', 'bull-call': 'Bull call spread', 'bear-call': 'Bear call spread', 'bull-put': 'Bull put spread', 'bear-put': 'Bear put spread', 'long-straddle': 'Long straddle', 'long-strangle': 'Long strangle', 'call-butterfly': 'Call butterfly', 'put-butterfly': 'Put butterfly', 'short-call-butterfly': 'Short call butterfly', 'short-put-butterfly': 'Short put butterfly', 'iron-butterfly': 'Iron butterfly', 'inverse-iron-butterfly': 'Inverse iron butterfly', 'iron-condor': 'Iron condor', 'inverse-iron-condor': 'Inverse iron condor', 'covered-call': 'Covered call', 'protective-put': 'Protective put', collar: 'Collar', 'call-calendar': 'Call calendar', 'put-calendar': 'Put calendar', 'call-diagonal': 'Call diagonal', 'put-diagonal': 'Put diagonal' } as const
const specificOptionFamily = (family: string) => CANDIDATE_OPTION_FAMILIES.some(value => value === family)
const mixedFamily = (family: string) => family.endsWith('-calendar') || family.endsWith('-diagonal')
const supportedFamily = (family: string, state: StrategyState) => !mixedFamily(family) || state.valuationModel === 'american-crr-1024-v1' || (state.valuationModel ?? 'european-bsm-v1') === 'european-bsm-v1' && (!family.startsWith('call-') || state.dividendYield <= 0)
const entryOutlay = (state: StrategyState) => Math.max(0, state.legs.reduce((sum, leg) => sum + (leg.side === 'long' ? 1 : -1) * leg.entryPrice * leg.contracts * leg.multiplier, (state.stock?.shares ?? 0) * (state.stock?.entryPrice ?? 0)) + (state.feeAllowance ?? 0))
const money = (value: number | null) => value === null ? 'Unbounded' : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value)

export async function checkSearch(raw: unknown, state: StrategyState, snapshot: MarketSnapshot, input: Search, domain: Domain | undefined, signal: AbortSignal): Promise<CandidateSearchResult> {
  if (!input || Object.keys(input).sort().join() !== 'basis,feeAllowance,maxLoss,objective,targetDate,targetSpot' || !Number.isFinite(input.targetSpot) || input.targetSpot <= 0 || input.targetSpot > 1000000 || !Number.isFinite(input.maxLoss) || input.maxLoss <= 0 || !Number.isFinite(input.feeAllowance) || input.feeAllowance < 0 || !['mid', 'natural'].includes(input.basis) || !['target-pnl', 'return-on-risk', 'expiry-probability'].includes(input.objective) || typeof input.targetDate !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/.test(input.targetDate) || !Number.isFinite(Date.parse(input.targetDate)) || new Date(input.targetDate).toISOString() !== (input.targetDate.includes('.') ? input.targetDate : input.targetDate.replace('Z', '.000Z')) || Date.parse(input.targetDate) < Date.parse(snapshot.retrievedAt)) throw new Error('Invalid candidate search constraints.')
  if (domain !== undefined && (!domain || Object.keys(domain).sort().join() !== (domain.resultMode === 'best-per-family' ? 'families,maxEntryOutlay,resultMode' : 'families,maxEntryOutlay') || !Array.isArray(domain.families) || !domain.families.length || new Set(domain.families).size !== domain.families.length || domain.families.some(family => !Object.hasOwn(familyLabels, family) || !supportedFamily(family, state)) || !Number.isFinite(domain.maxEntryOutlay) || domain.maxEntryOutlay < 0 || domain.families.some(mixedFamily) && input.objective === 'expiry-probability')) throw new Error('Invalid candidate search domain.')
  const result = raw as CandidateSearchResult
  if (!result || JSON.stringify(result.domain) !== JSON.stringify(domain) || result.snapshotId !== snapshot.id || result.baseVersion !== state.version || result.model !== (state.valuationModel ?? 'european-bsm-v1') || !result.request || Object.keys(result.request).sort().join() !== Object.keys(input).sort().join() || Object.keys(input).some(key => result.request[key as keyof Search] !== input[key as keyof Search])) throw new Error('Search response does not match this position, snapshot and request.')
  const grouped = domain?.resultMode === 'best-per-family'
  if (grouped ? !Number.isSafeInteger(result.eligibleFamilies) || result.eligibleFamilies! < 0 || result.eligibleFamilies! > 25 || result.eligibleFamilies! > result.eligible || (result.eligible > 0 && result.eligibleFamilies === 0) : result.eligibleFamilies !== undefined) throw new Error('Search family coverage is invalid.')
  if ([result.planned, result.evaluated, result.eligible, result.excludedRisk, result.excludedBudget, result.excludedBeforeTarget, ...(domain ? [result.excludedCost] : [])].some(count => typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0) || !domain && result.excludedCost !== undefined || result.planned > 300000 || result.evaluated !== result.planned || result.eligible + result.excludedRisk + result.excludedBudget + (result.excludedCost ?? 0) !== result.evaluated || result.excludedBeforeTarget > snapshot.contracts.length || !Array.isArray(result.candidates) || result.candidates.length !== (grouped ? result.eligibleFamilies : Math.min(result.eligible, 5)) || new Set(result.candidates.map(candidate => candidate?.id)).size !== result.candidates.length || [result.coverage, result.assumptions, result.probabilityBasis].some(text => typeof text !== 'string' || text.length > 4000)) throw new Error('Search coverage is invalid.')
  const seenFamilies = new Set<string>()
  for (const [index, candidate] of result.candidates.entries()) {
    const next = candidate?.state
    if (!next || validateMarketStrategy(next, snapshot).length || next.id !== 'candidate' || next.version !== state.version || next.name !== 'Quoted candidate' || next.excludedLegIds !== undefined || next.expiryIvShifts !== undefined || next.pricing?.entryMode !== undefined || next.pricing?.basis !== input.basis || next.scenarioSpot !== input.targetSpot || next.scenarioDate !== input.targetDate || next.feeAllowance !== input.feeAllowance || next.rate !== state.rate || next.dividendYield !== state.dividendYield || next.ivShift !== state.ivShift || next.valuationModel !== state.valuationModel || next.legs.length > 4 || next.legs.some(leg => leg.id !== leg.contractId)) throw new Error('Candidate does not match the searched position assumptions.')
    const id = (next.stock ? `stock:100@${snapshot.spot}|` : '') + next.legs.map(leg => `${leg.side}:${leg.contractId}${leg.contracts === 1 ? '' : `*${leg.contracts}`}`).join('|')
    if (grouped) {
      const family = candidateStrategyFamily(next)
      if (!family || seenFamilies.has(family)) throw new Error('Search repeats a strategy family.')
      seenFamilies.add(family)
    }
    if (candidate.id !== id) throw new Error('Candidate identity is invalid.')
    const mixed = new Set(next.legs.map(leg => leg.expiry)).size > 1
    if (mixed) {
      const [short, long] = next.legs
      const family = `${short.type}-${short.strike === long.strike ? 'calendar' : 'diagonal'}` as Domain['families'][number]
      if (next.legs.length !== 2 || next.stock || short.side !== 'short' || long.side !== 'long' || short.type !== long.type || short.contracts !== 1 || long.contracts !== 1 || Date.parse(short.expiry) >= Date.parse(long.expiry) || Date.parse(input.targetDate) > Date.parse(short.expiry) || !supportedFamily(family, next) || input.objective === 'expiry-probability' || !domain?.families.includes(family)) throw new Error('Mixed-expiry candidate is outside the selected family, date or supported model assumptions.')
    } else if (next.stock) {
      const put = next.legs.find(leg => leg.type === 'put' && leg.side === 'long'), call = next.legs.find(leg => leg.type === 'call' && leg.side === 'short')
      const family = next.legs.length === 1 && call ? 'covered-call' : next.legs.length === 1 && put ? 'protective-put' : next.legs.length === 2 && put && call && put.strike <= call.strike ? 'collar' : null
      if (next.stock.shares !== 100 || next.stock.entryPrice !== snapshot.spot || next.legs.some(leg => leg.contracts !== 1) || !family || !domain?.families.includes(family)) throw new Error('Stock-backed candidate is outside the selected families or captured share price.')
    } else {
      const family = candidateOptionFamily(next.legs)
      if (!family || domain && !domain.families.includes('options') && !domain.families.includes(family)) throw new Error('Option-only candidate is outside the selected families.')
    }
    const { metrics } = await requestWorkspaceValuation(next, signal)
    const lossBound = mixed ? firstExpirySpreadLossBound(next) : undefined
    const risk = lossBound?.amount ?? metrics.maxLoss
    if (JSON.stringify(lossBound) !== JSON.stringify(candidate.lossBound) || mixed && (metrics.maxLoss !== null || metrics.maxProfit !== null) || JSON.stringify(metrics) !== JSON.stringify(candidate.metrics) || risk === null || risk <= 0 || risk > input.maxLoss || domain && entryOutlay(next) > domain.maxEntryOutlay) throw new Error('Candidate pricing or loss budget could not be reconciled.')
    const reference = snapshot.contracts.filter(contract => contract.expiry === next.legs[0].expiry).sort((a, b) => Math.abs(a.strike - snapshot.spot) - Math.abs(b.strike - snapshot.spot) || a.contractId.localeCompare(b.contractId))[0]
    const probability = expirationProbability({ ...next, scenarioSpot: snapshot.spot, scenarioDate: snapshot.retrievedAt }, undefined, reference)
    const score = input.objective === 'expiry-probability' ? probability.probability : input.objective === 'return-on-risk' ? metrics.scenarioPnl / risk : metrics.scenarioPnl
    const previous = result.candidates[index - 1]
    if (JSON.stringify(probability) !== JSON.stringify(candidate.probability) || score === null || !Number.isFinite(score) || candidate.score !== score || previous && (previous.score < score || previous.score === score && previous.id.localeCompare(candidate.id) > 0)) throw new Error('Candidate ranking or probability could not be reconciled.')
  }
  return result
}

export function CandidateComparison({ result, snapshot, disabled, onInspect, renderComparison }: { result: CandidateSearchResult; snapshot: MarketSnapshot; disabled: boolean; onInspect: (search: CandidateSearchResult, snapshot: MarketSnapshot, id: string) => void; renderComparison: (states: StrategyState[]) => ReactNode }) {
  const [selection, setSelection] = useState({ result, snapshot, ids: [] as string[] })
  useEffect(() => { setSelection({ result, snapshot, ids: [] }) }, [result, snapshot])
  const selected = selection.result === result && selection.snapshot === snapshot ? selection.ids : []
  const setSelected = (ids: string[]) => setSelection({ result, snapshot, ids })
  const pair = result.candidates.filter(candidate => selected.includes(candidate.id))
  return <>
      {result.candidates.length > 1 && <p>Select two alternatives to compare before changing your position.</p>}
      {result.candidates.map((candidate, index) => <label className="candidate-select" key={candidate.id}><input type="checkbox" aria-label={`Compare candidate ${index + 1}`} checked={selected.includes(candidate.id)} disabled={disabled || selected.length === 2 && !selected.includes(candidate.id)} onChange={event => setSelected(event.target.checked ? [...selected, candidate.id] : selected.filter(id => id !== candidate.id))} />Compare candidate {index + 1} · {familyLabels[candidateStrategyFamily(candidate.state) ?? 'options']} · {candidate.state.legs.map(leg => `${leg.side} ${leg.strike}${leg.type === 'call' ? 'C' : 'P'}`).join(' / ')}</label>)}
      {pair.length === 2 && <section className="candidate-comparison" role="region" aria-label="Candidate comparison">
        <header><h3>Compare alternatives</h3><button disabled={disabled} onClick={() => setSelected([])}>Clear comparison</button></header>
        <p>New-position estimates · {result.request.targetDate} · target {snapshot.underlyingKind === 'cash-index' ? `${result.request.targetSpot} index points` : money(result.request.targetSpot)} · {result.request.basis} quotes · {result.model}. Same snapshot and search constraints; your holdings are unchanged.</p>
        <div className="candidate-table" tabIndex={0} role="region" aria-label="Candidate metrics"><table><thead><tr><th scope="col">Metric</th>{pair.map(candidate => <th scope="col" key={candidate.id}>Candidate {result.candidates.indexOf(candidate) + 1}</th>)}</tr></thead><tbody>
          {([
            ['Target P/L', (candidate) => money(candidate.metrics.scenarioPnl)],
            ['Net entry outlay', (candidate) => money(entryOutlay(candidate.state))],
            ['Loss measure', (candidate) => candidate.lossBound ? `${money(candidate.lossBound.amount)} conservative first-expiry bound` : `${money(candidate.metrics.maxLoss)} exact expiry max loss`],
            ['Maximum profit', (candidate) => candidate.lossBound ? 'Not exact' : money(candidate.metrics.maxProfit)],
            ['Modeled expiry profit probability', (candidate) => candidate.probability.probability === null ? 'Unavailable' : `${(candidate.probability.probability * 100).toFixed(1)}%`],
            ['Delta · USD per underlying unit', (candidate) => candidate.metrics.delta.toFixed(3)],
            ['Gamma · delta change per underlying unit', (candidate) => candidate.metrics.gamma.toFixed(3)],
            ['Theta · USD per day', (candidate) => money(candidate.metrics.theta)],
            ['Vega · USD per IV percentage point', (candidate) => money(candidate.metrics.vega)],
            ['Rho · USD per rate percentage point', (candidate) => money(candidate.metrics.rho)],
          ] satisfies Array<[string, (candidate: CandidateSearchResult['candidates'][number]) => string]>).map(([label, value]) => <tr key={label}><th scope="row">{label}</th>{pair.map(candidate => <td key={candidate.id}>{value(candidate)}</td>)}</tr>)}
          <tr><th scope="row">Next step</th>{pair.map(candidate => <td key={candidate.id}><button disabled={disabled} onClick={() => onInspect(result, snapshot, candidate.id)}>Inspect strategy</button></td>)}</tr>
        </tbody></table></div>
        <p>Greeks are local sensitivities at the target, not finite-move forecasts. Probability is a model estimate, not a forecast. Outlay is not margin or total capital at risk.</p>
        {pair.map(candidate => <p key={candidate.id}><strong>Candidate {result.candidates.indexOf(candidate) + 1}:</strong> {candidate.state.stock && '100 shares / '}{candidate.state.legs.map(leg => `${leg.side} ${leg.contracts} × ${leg.strike} ${leg.type} · ${leg.expiry.slice(0, 10)}`).join(' / ')}{candidate.lossBound && ` — ${candidate.lossBound.basis}`}</p>)}
        {renderComparison(pair.map(candidate => candidate.state))}
      </section>}
  </>
}

export function CandidateSearch({ state, snapshot, disabled, onSearch, onInspect, renderComparison, initialTarget, expanded = false }: { state: StrategyState; snapshot: MarketSnapshot; disabled: boolean; onSearch: () => void; onInspect: (search: CandidateSearchResult, snapshot: MarketSnapshot, id: string) => void; renderComparison: (states: StrategyState[]) => ReactNode; initialTarget?: { targetSpot: number; targetDate: string }; expanded?: boolean }) {
  const [target, setTarget] = useState(String(initialTarget?.targetSpot ?? state.scenarioSpot)), [date, setDate] = useState(initialTarget ? initialTarget.targetDate.slice(0, -1) : new Date(Math.ceil(Date.parse(state.scenarioDate) / 1000) * 1000).toISOString().slice(0, 19))
  const [loss, setLoss] = useState('1000'), [fee, setFee] = useState(String(state.feeAllowance ?? 0))
  const [families, setFamilies] = useState<Domain['families']>(['options']), [outlay, setOutlay] = useState('10000')
  const [grouped, setGrouped] = useState(true)
  const [basis, setBasis] = useState<Search['basis']>(state.pricing?.basis ?? 'mid'), [objective, setObjective] = useState<Search['objective']>('target-pnl')
  const [result, setResult] = useState<CandidateSearchResult | null>(null), [pending, setPending] = useState(false), [error, setError] = useState('')
  const request = useRef<AbortController | null>(null)
  useEffect(() => { setResult(null); setPending(false); return () => request.current?.abort() }, [state, snapshot])
  useEffect(() => { if (disabled) { request.current?.abort(); setPending(false) } }, [disabled])
  const invalidate = () => { request.current?.abort(); setPending(false); setResult(null); setError('') }
  const validDate = Number.isFinite(Date.parse(`${date}Z`)) && Date.parse(`${date}Z`) >= Date.parse(snapshot.retrievedAt)
  const hasMixed = families.some(mixedFamily), supported = families.every(family => supportedFamily(family, state))
  const availableFamilies = (Object.keys(familyLabels) as Domain['families']).filter(family => state.underlyingKind !== 'cash-index' || !['covered-call', 'protective-put', 'collar'].includes(family))
  const familyControl = (family: Domain['families'][number]) => <label key={family}><input type="checkbox" aria-label={`Optimizer ${familyLabels[family].toLowerCase()}`} disabled={!supportedFamily(family, state)} checked={families.includes(family)} onChange={event => { invalidate(); setFamilies(event.target.checked ? [...families.filter(value => family === 'options' ? !specificOptionFamily(value) : !specificOptionFamily(family) || value !== 'options'), family] : families.filter(value => value !== family)) }} />{familyLabels[family]}</label>
  const valid = !!target.trim() && Number(target) > 0 && Number(target) <= 1000000 && !!loss.trim() && Number.isFinite(Number(loss)) && Number(loss) > 0 && !!fee.trim() && Number.isFinite(Number(fee)) && Number(fee) >= 0 && validDate && families.length > 0 && !!outlay.trim() && Number.isFinite(Number(outlay)) && Number(outlay) >= 0 && supported && (!hasMixed || objective !== 'expiry-probability')
  const search = async () => {
    if (!valid || pending || disabled) return
    invalidate(); onSearch()
    const controller = new AbortController(); request.current = controller; setPending(true)
    const input: Search = { targetSpot: Number(target), targetDate: new Date(`${date}Z`).toISOString(), maxLoss: Number(loss), feeAllowance: Number(fee), basis, objective }
    const domain: Domain = { families, maxEntryOutlay: Number(outlay), ...(grouped ? { resultMode: 'best-per-family' as const } : {}) }
    try {
      const response = await fetch('/api/candidates', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-ARGUS-Request': '1' }, body: JSON.stringify({ state, search: input, domain }), signal: controller.signal })
      const body = await response.json() as { search?: unknown; error?: { code?: string } }
      if (controller.signal.aborted) return
      if (!response.ok) throw new Error(response.status === 409 ? 'Refresh prices before searching: the quoted snapshot is missing or stale.' : body?.error?.code === 'candidate_search_limit' ? 'This search exceeds 300,000 structures. Narrow the quoted strike or expiry window.' : 'Strategy search unavailable. Your position is unchanged.')
      const checked = await checkSearch(body?.search, state, snapshot, input, domain, controller.signal)
      if (!controller.signal.aborted) setResult(checked)
    } catch (cause) { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Strategy search unavailable.') }
    finally { if (!controller.signal.aborted) setPending(false) }
  }
  return <section className="verified-risk" aria-label="Strategy optimizer"><details open={expanded || undefined}><summary>Find a strategy · deterministic optimizer</summary>
    <p>Search this quoted window for a new position. No AI call, order or holding change. Snapshot {snapshot.id} · workspace v{state.version} · {snapshot.contracts.length} quotes.</p>
    <form onSubmit={event => { event.preventDefault(); void search() }}><fieldset className="chain-window" disabled={disabled}>
      <fieldset><legend>Search families</legend>{familyControl('options')}<p>Options only searches all supported same-expiry option strategies. Choose specific strategies below to narrow the search before ranking.</p><details><summary>Choose specific option strategies{families.some(specificOptionFamily) ? ` · ${families.filter(specificOptionFamily).length} selected` : ''}</summary>{availableFamilies.filter(specificOptionFamily).map(familyControl)}</details>{availableFamilies.filter(family => family !== 'options' && !specificOptionFamily(family)).map(familyControl)}</fieldset>
      <label>Maximum net entry outlay · USD<input aria-label="Optimizer maximum entry outlay" type="number" min="0" step="any" required value={outlay} onChange={event => { invalidate(); setOutlay(event.target.value) }} /></label>
      <p>Outlay is net option debit plus {state.underlyingKind !== 'cash-index' && 'share purchase cost and '}fee allowance, floored at zero. It is not margin, buying power or total capital at risk.{state.underlyingKind !== 'cash-index' && ' Stock-backed families buy 100 shares at the dated underlying spot mark, not a bid/ask or natural fill; quote basis applies only to options.'}</p>
      <label>Target price<input aria-label="Optimizer target price" type="number" min="0.001" max="1000000" step="any" required value={target} onChange={event => { invalidate(); setTarget(event.target.value) }} /></label>
      <label>Target date · UTC<input aria-label="Optimizer target date UTC" type="datetime-local" step={initialTarget ? '0.001' : '1'} required min={snapshot.retrievedAt.slice(0, 19)} value={date} onChange={event => { invalidate(); setDate(event.target.value) }} /></label>
      <p>Calendars and diagonals require a target no later than the short expiry. The selected valuation model is retained. European put families are supported at any yield; European call families require zero or negative continuous yield, because positive yield leaves unbounded first-expiry loss as spot rises. Their loss budget uses a conservative intact first-expiry bound, not exact maximum loss. It does not cap losses before first expiry or lifetime losses; assignment, funding and slippage are excluded. Target P/L divided by this bound is a scenario ratio, not a return forecast. No mixed-expiry profit probability is calculated.</p>
      {hasMixed && (!supported || objective === 'expiry-probability') && <p role="alert">Use a supported family and target P/L or return-on-risk ranking. European call calendars and diagonals require zero or negative continuous yield. No model is switched automatically.</p>}
      <label>Maximum loss budget · USD<input aria-label="Optimizer maximum loss" type="number" min="0.01" step="any" required value={loss} onChange={event => { invalidate(); setLoss(event.target.value) }} /></label>
      <label>Total fee allowance · USD<input aria-label="Optimizer fee allowance" type="number" min="0" step="any" required value={fee} onChange={event => { invalidate(); setFee(event.target.value) }} /></label>
      <label>Quote basis<select aria-label="Optimizer quote basis" value={basis} onChange={event => { invalidate(); setBasis(event.target.value as Search['basis']) }}><option value="mid">Midpoint estimate</option><option value="natural">Natural estimate</option></select></label>
      <label>Rank by<select aria-label="Optimizer objective" value={objective} onChange={event => { invalidate(); setObjective(event.target.value as Search['objective']) }}><option value="target-pnl">Target P/L</option><option value="return-on-risk">Target P/L / loss bound</option><option value="expiry-probability" disabled={hasMixed}>Modeled expiry profit probability</option></select></label>
      <button type="submit" disabled={!valid || pending}>Find strategies</button>
      <label>Show results<select aria-label="Optimizer result grouping" value={grouped ? 'family' : 'global'} onChange={event => { invalidate(); setGrouped(event.target.value === 'family') }}><option value="family">Best per strategy family</option><option value="global">Top five overall</option></select></label>
    </fieldset></form>
    {pending && <p role="status">Searching quoted strategies…</p>}{error && <p role="alert">{error}</p>}
    {result && <section aria-label="Deterministic quoted candidates"><p>{result.coverage}</p><p>{result.assumptions}</p>
      <p>{result.domain?.resultMode === 'best-per-family' ? 'One highest-ranked eligible structure per strategy family, using the selected objective. Missing families did not meet the search constraints.' : 'Five highest-ranked eligible structures overall; several may belong to the same family.'}</p>
      <p>{result.evaluated} evaluated · {result.eligible} within constraints · {result.excludedRisk} without bounded positive risk · {result.excludedBudget} above loss budget · {result.excludedCost} above entry outlay · {result.excludedBeforeTarget} contracts before target · showing {result.candidates.length}. Ranked only within this search, not globally optimal.</p>
      <details><summary>Probability assumptions</summary><p>{result.probabilityBasis}</p></details>
      {!result.candidates.length && <p>No quoted strategies satisfy these constraints.</p>}
      <CandidateComparison result={result} snapshot={snapshot} disabled={disabled || pending} onInspect={onInspect} renderComparison={renderComparison} />
      <div className="quoted-candidate-grid">{result.candidates.map((candidate, index) => <article className="quoted-candidate-card" key={candidate.id}>
        <header><small>#{index + 1} · DATED QUOTES</small><h3>{familyLabels[candidateStrategyFamily(candidate.state) ?? 'options']}</h3><p>{candidate.state.stock && `100 shares @ ${money(candidate.state.stock.entryPrice)} / `}{candidate.state.legs.map(leg => `${leg.side === 'long' ? 'Buy' : 'Sell'} ${leg.contracts} × ${leg.strike}${leg.type === 'call' ? 'C' : 'P'} · ${leg.expiry.slice(0, 10)}`).join(' / ')}</p></header>
        <dl className="quoted-candidate-metrics"><div><dt>Target P/L</dt><dd>{money(candidate.metrics.scenarioPnl)}</dd></div><div><dt>{candidate.lossBound ? 'First-expiry loss bound' : 'Expiry max loss'}</dt><dd>{money(candidate.lossBound?.amount ?? candidate.metrics.maxLoss)}</dd></div><div><dt>Net entry outlay</dt><dd>{money(entryOutlay(candidate.state))}</dd></div><div><dt>Modeled expiry chance</dt><dd>{candidate.probability.probability === null ? 'Unavailable' : `${(candidate.probability.probability * 100).toFixed(1)}%`}</dd></div></dl>
        {!candidate.lossBound ? <><ExpiryPlot state={candidate.state} referenceSpot={snapshot.spot} breakevens={candidate.metrics.breakevens} /><small>Expiration payoff · {candidate.state.legs[0].expiry.slice(0, 10)} · not target-date P/L</small></> : <p>{candidate.lossBound.basis} Mixed expiries: no single terminal payoff chart. Inspect to compare modeled curves.</p>}
        <p>Max profit {candidate.lossBound ? 'Not exact' : money(candidate.metrics.maxProfit)} · rank score {candidate.score.toFixed(3)}. Chance is a model estimate, not a forecast. Outlay is not collateral.</p>
        <button disabled={disabled || pending} onClick={() => onInspect(result, snapshot, candidate.id)}>Inspect strategy</button>
        <CandidateStress key={`${snapshot.id}:${candidate.id}:${JSON.stringify(result.request)}`} state={candidate.state} snapshot={snapshot} />
      </article>)}</div>
    </section>}
  </details></section>
}
