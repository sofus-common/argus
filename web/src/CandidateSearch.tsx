import { useEffect, useRef, useState } from 'react'
import { expirationProbability, firstExpirySpreadLossBound, validateMarketStrategy, type MarketSnapshot, type StrategyState, type searchCandidates } from './options'
import { requestWorkspaceValuation } from './workspace-valuation-client'

export type CandidateSearchResult = ReturnType<typeof searchCandidates>
type Search = CandidateSearchResult['request']
type Domain = NonNullable<Parameters<typeof searchCandidates>[3]>
const familyLabels = { options: 'Options only', 'covered-call': 'Covered call', 'protective-put': 'Protective put', collar: 'Collar', 'call-calendar': 'Call calendar', 'put-calendar': 'Put calendar', 'call-diagonal': 'Call diagonal', 'put-diagonal': 'Put diagonal' } as const
const mixedFamily = (family: string) => family.endsWith('-calendar') || family.endsWith('-diagonal')
const entryOutlay = (state: StrategyState) => Math.max(0, state.legs.reduce((sum, leg) => sum + (leg.side === 'long' ? 1 : -1) * leg.entryPrice * leg.contracts * leg.multiplier, (state.stock?.shares ?? 0) * (state.stock?.entryPrice ?? 0)) + (state.feeAllowance ?? 0))
const money = (value: number | null) => value === null ? 'Unbounded' : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value)

async function checkSearch(raw: unknown, state: StrategyState, snapshot: MarketSnapshot, input: Search, domain: Domain, signal: AbortSignal): Promise<CandidateSearchResult> {
  const result = raw as CandidateSearchResult
  if (!result || !result.domain || Object.keys(result.domain).sort().join() !== 'families,maxEntryOutlay' || JSON.stringify(result.domain.families) !== JSON.stringify(domain.families) || result.domain.maxEntryOutlay !== domain.maxEntryOutlay || result.snapshotId !== snapshot.id || result.baseVersion !== state.version || result.model !== (state.valuationModel ?? 'european-bsm-v1') || !result.request || Object.keys(input).some(key => result.request[key as keyof Search] !== input[key as keyof Search])) throw new Error('Search response does not match this position, snapshot and request.')
  if ([result.planned, result.evaluated, result.eligible, result.excludedRisk, result.excludedBudget, result.excludedBeforeTarget, result.excludedCost].some(count => typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0) || result.planned > 300000 || result.evaluated !== result.planned || result.eligible + result.excludedRisk + result.excludedBudget + result.excludedCost! !== result.evaluated || result.excludedBeforeTarget > snapshot.contracts.length || !Array.isArray(result.candidates) || result.candidates.length !== Math.min(result.eligible, 5) || new Set(result.candidates.map(candidate => candidate?.id)).size !== result.candidates.length || [result.coverage, result.assumptions, result.probabilityBasis].some(text => typeof text !== 'string' || text.length > 4000)) throw new Error('Search coverage is invalid.')
  for (const [index, candidate] of result.candidates.entries()) {
    const next = candidate?.state
    if (!next || validateMarketStrategy(next, snapshot).length || next.id !== 'candidate' || next.version !== state.version || next.name !== 'Quoted candidate' || next.excludedLegIds !== undefined || next.expiryIvShifts !== undefined || next.pricing?.entryMode !== undefined || next.pricing?.basis !== input.basis || next.scenarioSpot !== input.targetSpot || next.scenarioDate !== input.targetDate || next.feeAllowance !== input.feeAllowance || next.rate !== state.rate || next.dividendYield !== state.dividendYield || next.ivShift !== state.ivShift || next.valuationModel !== state.valuationModel || next.legs.length > 4 || next.legs.some(leg => leg.id !== leg.contractId)) throw new Error('Candidate does not match the searched position assumptions.')
    const id = (next.stock ? `stock:100@${snapshot.spot}|` : '') + next.legs.map(leg => `${leg.side}:${leg.contractId}${leg.contracts === 1 ? '' : `*${leg.contracts}`}`).join('|')
    if (candidate.id !== id) throw new Error('Candidate identity is invalid.')
    const mixed = new Set(next.legs.map(leg => leg.expiry)).size > 1
    if (mixed) {
      const [short, long] = next.legs
      const family = `${short.type}-${short.strike === long.strike ? 'calendar' : 'diagonal'}` as Domain['families'][number]
      if (next.legs.length !== 2 || next.stock || short.side !== 'short' || long.side !== 'long' || short.type !== long.type || short.contracts !== 1 || long.contracts !== 1 || Date.parse(short.expiry) >= Date.parse(long.expiry) || Date.parse(input.targetDate) > Date.parse(short.expiry) || next.valuationModel !== 'american-crr-1024-v1' || input.objective === 'expiry-probability' || !domain.families.includes(family)) throw new Error('Mixed-expiry candidate is outside the selected family, date or American model.')
    } else if (next.stock) {
      const put = next.legs.find(leg => leg.type === 'put' && leg.side === 'long'), call = next.legs.find(leg => leg.type === 'call' && leg.side === 'short')
      const family = next.legs.length === 1 && call ? 'covered-call' : next.legs.length === 1 && put ? 'protective-put' : next.legs.length === 2 && put && call && put.strike <= call.strike ? 'collar' : null
      if (next.stock.shares !== 100 || next.stock.entryPrice !== snapshot.spot || next.legs.some(leg => leg.contracts !== 1) || !family || !domain.families.includes(family)) throw new Error('Stock-backed candidate is outside the selected families or captured share price.')
    } else if (!domain.families.includes('options')) throw new Error('Option-only candidate is outside the selected families.')
    const { metrics } = await requestWorkspaceValuation(next, signal)
    const lossBound = mixed ? firstExpirySpreadLossBound(next) : undefined
    const risk = lossBound?.amount ?? metrics.maxLoss
    if (JSON.stringify(lossBound) !== JSON.stringify(candidate.lossBound) || mixed && (metrics.maxLoss !== null || metrics.maxProfit !== null) || JSON.stringify(metrics) !== JSON.stringify(candidate.metrics) || risk === null || risk <= 0 || risk > input.maxLoss || entryOutlay(next) > domain.maxEntryOutlay) throw new Error('Candidate pricing or loss budget could not be reconciled.')
    const reference = snapshot.contracts.filter(contract => contract.expiry === next.legs[0].expiry).sort((a, b) => Math.abs(a.strike - snapshot.spot) - Math.abs(b.strike - snapshot.spot) || a.contractId.localeCompare(b.contractId))[0]
    const probability = expirationProbability({ ...next, scenarioSpot: snapshot.spot, scenarioDate: snapshot.retrievedAt }, undefined, reference)
    const score = input.objective === 'expiry-probability' ? probability.probability : input.objective === 'return-on-risk' ? metrics.scenarioPnl / risk : metrics.scenarioPnl
    const previous = result.candidates[index - 1]
    if (JSON.stringify(probability) !== JSON.stringify(candidate.probability) || score === null || !Number.isFinite(score) || candidate.score !== score || previous && (previous.score < score || previous.score === score && previous.id.localeCompare(candidate.id) > 0)) throw new Error('Candidate ranking or probability could not be reconciled.')
  }
  return result
}

export function CandidateSearch({ state, snapshot, disabled, onSearch, onInspect }: { state: StrategyState; snapshot: MarketSnapshot; disabled: boolean; onSearch: () => void; onInspect: (search: CandidateSearchResult, snapshot: MarketSnapshot, id: string) => void }) {
  const [target, setTarget] = useState(String(state.scenarioSpot)), [date, setDate] = useState(new Date(Math.ceil(Date.parse(state.scenarioDate) / 1000) * 1000).toISOString().slice(0, 19))
  const [loss, setLoss] = useState('1000'), [fee, setFee] = useState(String(state.feeAllowance ?? 0))
  const [families, setFamilies] = useState<Domain['families']>(['options']), [outlay, setOutlay] = useState('10000')
  const [basis, setBasis] = useState<Search['basis']>(state.pricing?.basis ?? 'mid'), [objective, setObjective] = useState<Search['objective']>('target-pnl')
  const [result, setResult] = useState<CandidateSearchResult | null>(null), [pending, setPending] = useState(false), [error, setError] = useState('')
  const request = useRef<AbortController | null>(null)
  useEffect(() => () => request.current?.abort(), [state, snapshot])
  useEffect(() => { if (disabled) { request.current?.abort(); setPending(false) } }, [disabled])
  const invalidate = () => { request.current?.abort(); setPending(false); setResult(null); setError('') }
  const validDate = Number.isFinite(Date.parse(`${date}Z`)) && Date.parse(`${date}Z`) >= Date.parse(snapshot.retrievedAt)
  const hasMixed = families.some(mixedFamily), american = state.valuationModel === 'american-crr-1024-v1'
  const valid = !!target.trim() && Number(target) > 0 && Number(target) <= 1000000 && !!loss.trim() && Number.isFinite(Number(loss)) && Number(loss) > 0 && !!fee.trim() && Number.isFinite(Number(fee)) && Number(fee) >= 0 && validDate && families.length > 0 && !!outlay.trim() && Number.isFinite(Number(outlay)) && Number(outlay) >= 0 && (!hasMixed || american && objective !== 'expiry-probability')
  const search = async () => {
    if (!valid || pending || disabled) return
    invalidate(); onSearch()
    const controller = new AbortController(); request.current = controller; setPending(true)
    const input: Search = { targetSpot: Number(target), targetDate: new Date(`${date}Z`).toISOString(), maxLoss: Number(loss), feeAllowance: Number(fee), basis, objective }
    const domain: Domain = { families, maxEntryOutlay: Number(outlay) }
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
  return <section className="verified-risk" aria-label="Strategy optimizer"><details><summary>Find a strategy · deterministic optimizer</summary>
    <p>Search this quoted window for a new position. No AI call, order or holding change. Snapshot {snapshot.id} · workspace v{state.version} · {snapshot.contracts.length} quotes.</p>
    <form onSubmit={event => { event.preventDefault(); void search() }}><fieldset className="chain-window" disabled={disabled}>
      <fieldset><legend>Search families</legend>{(Object.keys(familyLabels) as Domain['families']).map(family => <label key={family}><input type="checkbox" aria-label={`Optimizer ${familyLabels[family].toLowerCase()}`} disabled={mixedFamily(family) && !american} checked={families.includes(family)} onChange={event => { invalidate(); setFamilies(event.target.checked ? [...families, family] : families.filter(value => value !== family)) }} />{familyLabels[family]}</label>)}</fieldset>
      <label>Maximum net entry outlay · USD<input aria-label="Optimizer maximum entry outlay" type="number" min="0" step="any" required value={outlay} onChange={event => { invalidate(); setOutlay(event.target.value) }} /></label>
      <p>Outlay is net option debit plus share purchase cost and fee allowance, floored at zero. It is not margin, buying power or total capital at risk. Stock-backed families buy 100 shares at the dated underlying spot mark, not a bid/ask or natural fill; quote basis applies only to options.</p>
      <label>Target price<input aria-label="Optimizer target price" type="number" min="0.001" max="1000000" step="any" required value={target} onChange={event => { invalidate(); setTarget(event.target.value) }} /></label>
      <label>Target date · UTC<input aria-label="Optimizer target date UTC" type="datetime-local" step="1" required min={snapshot.retrievedAt.slice(0, 19)} value={date} onChange={event => { invalidate(); setDate(event.target.value) }} /></label>
      <p>Calendars and diagonals require the explicitly selected American model and a target no later than the short expiry. Their loss budget uses a conservative intact first-expiry bound, not exact maximum loss. It does not cap losses before first expiry or lifetime losses; assignment, funding and slippage are excluded. Target P/L divided by this bound is a scenario ratio, not a return forecast. No mixed-expiry profit probability is calculated.</p>
      {hasMixed && (!american || objective === 'expiry-probability') && <p role="alert">Select the American valuation model and target P/L or return-on-risk ranking to search calendars or diagonals. No model is switched automatically.</p>}
      <label>Maximum loss budget · USD<input aria-label="Optimizer maximum loss" type="number" min="0.01" step="any" required value={loss} onChange={event => { invalidate(); setLoss(event.target.value) }} /></label>
      <label>Total fee allowance · USD<input aria-label="Optimizer fee allowance" type="number" min="0" step="any" required value={fee} onChange={event => { invalidate(); setFee(event.target.value) }} /></label>
      <label>Quote basis<select aria-label="Optimizer quote basis" value={basis} onChange={event => { invalidate(); setBasis(event.target.value as Search['basis']) }}><option value="mid">Midpoint estimate</option><option value="natural">Natural estimate</option></select></label>
      <label>Rank by<select aria-label="Optimizer objective" value={objective} onChange={event => { invalidate(); setObjective(event.target.value as Search['objective']) }}><option value="target-pnl">Target P/L</option><option value="return-on-risk">Target P/L / loss bound</option><option value="expiry-probability" disabled={hasMixed}>Modeled expiry profit probability</option></select></label>
      <button type="submit" disabled={!valid || pending}>Find strategies</button>
    </fieldset></form>
    {pending && <p role="status">Searching quoted strategies…</p>}{error && <p role="alert">{error}</p>}
    {result && <section aria-label="Deterministic quoted candidates"><p>{result.coverage}</p><p>{result.assumptions}</p>
      <p>{result.evaluated} evaluated · {result.eligible} within constraints · {result.excludedRisk} without bounded positive risk · {result.excludedBudget} above loss budget · {result.excludedCost} above entry outlay · {result.excludedBeforeTarget} contracts before target · showing {result.candidates.length}. Ranked only within this search, not globally optimal.</p>
      <details><summary>Probability assumptions</summary><p>{result.probabilityBasis}</p></details>
      {!result.candidates.length && <p>No quoted strategies satisfy these constraints.</p>}
      {result.candidates.map((candidate, index) => <article key={candidate.id}><h4>{index + 1}. {candidate.state.stock && `100 shares @ ${money(candidate.state.stock.entryPrice)} dated mark / `}{candidate.state.legs.map(leg => `${leg.side} ${leg.contracts} × ${leg.strike} ${leg.type} · ${leg.expiry.slice(0, 10)}`).join(' / ')}</h4><p>Net entry outlay {money(entryOutlay(candidate.state))} · Target P/L {money(candidate.metrics.scenarioPnl)} · {candidate.lossBound ? `conservative first-expiry loss bound ${money(candidate.lossBound.amount)}` : `exact expiry max loss ${money(candidate.metrics.maxLoss)}`} · max profit {candidate.lossBound ? 'Not exact' : money(candidate.metrics.maxProfit)} · score {candidate.score.toFixed(3)}</p>{candidate.lossBound && <p>{candidate.lossBound.basis} Return-on-risk uses this conservative bound as denominator, not exact maximum loss.</p>}<p>Modeled expiry profit probability {candidate.probability.probability === null ? 'Unavailable' : `${(candidate.probability.probability * 100).toFixed(1)}%`} · not a forecast.</p><button disabled={disabled || pending} onClick={() => onInspect(result, snapshot, candidate.id)}>Inspect strategy</button></article>)}
    </section>}
  </details></section>
}
