import { useEffect, useRef, useState } from 'react'
import { PositionPerformance } from './PositionPerformance'
import type { StrategyState } from './options'
import { assertRemainingLotInventory } from './lot-scenarios'
import type { SavedStrategy } from './saved-strategies'
import type { LotAsset, LotTransaction, LotAmendment, projectPositionLots, valuePositionLots } from './position-lots'
import type { valuePosition } from './position-lifecycle'
import { requestLotScenarioComparison, type LotScenario, type LotScenarioComparison, type LotScenarioInput } from './workspace-valuation-client'
import type { ConversationMessage, LotDiscussionFacts, LotDiscussionReply } from './sparring'

type Projection = ReturnType<typeof projectPositionLots>
type Loaded = { record: SavedStrategy; projection: Projection }
type Selection = { checked: boolean; quantity: string; price: string }
type Valuation = ReturnType<typeof valuePosition> & { lotMarks?: ReturnType<typeof valuePositionLots>['lotMarks']; analysisUnavailable?: ReturnType<typeof valuePositionLots>['analysisUnavailable'] }
type Comparison = LotScenarioInput & { revision: number; transactionId: string; snapshotId: string; basis: 'mid' | 'natural' }
const money = (value: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value)
const label = (asset: LotAsset) => asset.kind === 'stock' ? `${asset.symbol} shares` : `${asset.type} ${asset.strike} · ${asset.expiry} · ${asset.contractId}`
const sameTransaction = (a: LotTransaction, b: LotTransaction) => JSON.stringify(a, ['id', 'at', 'recordedAt', 'closes', 'opens', 'lotId', 'quantity', 'price', 'asset', 'side', 'entryPrice', 'kind', 'symbol', 'contractId', 'type', 'strike', 'expiry', 'multiplier']) === JSON.stringify(b, ['id', 'at', 'recordedAt', 'closes', 'opens', 'lotId', 'quantity', 'price', 'asset', 'side', 'entryPrice', 'kind', 'symbol', 'contractId', 'type', 'strike', 'expiry', 'multiplier'])

function LotDiscussion({ savedId, comparison, transaction, scenario, onPlot, plotting }: { savedId: string; comparison: Comparison; transaction: LotTransaction; scenario?: LotScenario; onPlot: (result: NonNullable<LotDiscussionFacts['scenario']>) => void; plotting: boolean }) {
  const spotLabel = (value: number) => comparison.before.projection.initial.underlyingKind === 'cash-index' ? `${value} index points` : money(value)
  const [question, setQuestion] = useState('')
  const [turns, setTurns] = useState<{ question: string; reply: LotDiscussionReply; facts: LotDiscussionFacts; requestedScenarios: NonNullable<LotDiscussionFacts['scenario']>[] }[]>([])
  const [conversation, setConversation] = useState<ConversationMessage[]>([])
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  const pending = useRef<AbortController | null>(null)
  useEffect(() => () => pending.current?.abort(), [])
  const discuss = async () => {
    if (busy) return
    const content = question.trim(), messages: ConversationMessage[] = [...conversation, { role: 'user', content }]
    if (!content || messages.length > 12 || messages.reduce((sum, message) => sum + message.content.length, 0) > 12000) { setError('Enter a question within the 12-message / 12,000-character limit. Start a new discussion if this conversation is full; your question has not been sent.'); return }
    const controller = new AbortController(); pending.current = controller
    const requestId = crypto.randomUUID()
    setBusy(true); setError('')
    try {
      const response = await fetch(`/api/strategies/${encodeURIComponent(savedId)}/lot-discussion`, { method: 'POST', signal: controller.signal, headers: { 'Content-Type': 'application/json', 'X-ARGUS-Request': '1' }, body: JSON.stringify({ request_id: requestId, revision: comparison.revision, transaction, snapshotId: comparison.snapshotId, basis: comparison.basis, conversation: messages, ...(scenario ? { scenario } : {}) }) })
      const body = await response.json() as { request_id: string; facts: LotDiscussionFacts; reply: LotDiscussionReply; requestedScenarios: NonNullable<LotDiscussionFacts['scenario']>[]; error?: { message?: string } }
      if (controller.signal.aborted) return
      if (!response.ok) throw new Error(body.error?.message ?? 'Discussion unavailable. The saved position and builder have not changed.')
      const facts = body.facts, reply = body.reply
      if (body.request_id !== requestId || facts?.savedId !== savedId || facts.revision !== comparison.revision || facts.snapshotId !== comparison.snapshotId || facts.basis !== comparison.basis || !sameTransaction(facts.transaction, transaction)) throw new Error('Discussion identity changed. This reply was discarded; compare the dated position again.')
      const modeled = facts.scenario
      if (scenario ? !modeled || modeled.scenario.spot !== scenario.spot || modeled.scenario.date !== scenario.date || modeled.scenario.ivShift !== scenario.ivShift || modeled.model !== (comparison.before.projection.initial.valuationModel ?? 'european-bsm-v1') || ![modeled.before, modeled.after].every(side => side && [side.combinedPnl, side.grossRealizedPnl, side.unrealizedPnl, side.allowance].every(Number.isFinite)) : modeled !== undefined) throw new Error('Discussion scenario changed. This reply was discarded.')
      if (!reply || Object.keys(reply).sort().join() !== 'assumptions,objections,suggested_prompts,text' || typeof reply.text !== 'string' || !['assumptions', 'objections', 'suggested_prompts'].every(key => Array.isArray(reply[key as keyof LotDiscussionReply]) && (reply[key as keyof LotDiscussionReply] as unknown[]).every(item => typeof item === 'string'))) throw new Error('Invalid read-only discussion reply.')
      if (!Array.isArray(body.requestedScenarios) || body.requestedScenarios.length > 4 || body.requestedScenarios.some(result => !result || result.model !== (comparison.before.projection.initial.valuationModel ?? 'european-bsm-v1') || !result.scenario || !Number.isFinite(result.scenario.spot) || result.scenario.spot <= 0 || !Number.isFinite(result.scenario.ivShift) || !Number.isFinite(Date.parse(result.scenario.date)) || ![result.before, result.after].every(side => side && [side.combinedPnl, side.grossRealizedPnl, side.unrealizedPnl, side.allowance].every(Number.isFinite)))) throw new Error('Invalid calculated discussion scenarios.')
      setTurns(previous => [...previous, { question: content, reply, facts, requestedScenarios: body.requestedScenarios }]); setQuestion('')
      setConversation([...messages, { role: 'assistant', content: [reply.text, ...reply.assumptions, ...reply.objections, ...reply.suggested_prompts].join('\n') }])
    } catch (cause) { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Discussion unavailable.') }
    finally { if (!controller.signal.aborted) setBusy(false) }
  }
  return <section aria-label="Read-only lot discussion"><h3>Discuss {scenario ? 'this scenario' : 'the dated comparison'}</h3><p>The after side is hypothetical. Ask a price, date or volatility what-if; up to four scenarios can be calculated per question. {scenario ? `Selected baseline: ${spotLabel(scenario.spot)}, ${scenario.date}, IV shift ${scenario.ivShift * 100} pp.` : 'The dated comparison is the starting context.'} Browser P/L is not sent. Changing scenario inputs starts a new discussion. No Apply action, orders or recording.</p>
    {turns.map((turn, index) => turn.requestedScenarios.length > 0 && <section key={`requested-${index}`} aria-label="Conversation scenario calculations"><h4>Calculated for: {turn.question}</h4>{turn.requestedScenarios.map((result, index) => <div key={index}><p>{result.model} · {result.scenario.date} · spot {spotLabel(result.scenario.spot)} · IV shift {result.scenario.ivShift * 100} pp</p><p>Held {money(result.before.combinedPnl)} · proposed {money(result.after.combinedPnl)} · difference {money(result.after.combinedPnl - result.before.combinedPnl)}</p><button disabled={busy || plotting} onClick={() => onPlot(result)}>Show scenario on chart</button></div>)}<p>Conditional combined P/L with allowance once per side; not a forecast or recorded transaction. Workspace controls are unchanged.</p></section>)}
    {turns.map((turn, index) => turn.facts.scenario && <p key={`scenario-${index}`}>Server model {turn.facts.scenario.model} · {turn.facts.scenario.scenario.date} · spot {spotLabel(turn.facts.scenario.scenario.spot)} · IV shift {turn.facts.scenario.scenario.ivShift * 100} pp · held {money(turn.facts.scenario.before.combinedPnl)} · proposed {money(turn.facts.scenario.after.combinedPnl)}. Conditional model P/L, not quoted P/L or a forecast.</p>)}
    {turns.map((turn, index) => <article key={index}><h4>{turn.question}</h4><small>AI interpretation, assumptions and objections may contain errors. Calculated results are shown separately.</small><p style={{ whiteSpace: 'pre-wrap' }}>{turn.reply.text}</p>{(['assumptions', 'objections'] as const).map(key => turn.reply[key].length > 0 && <div key={key}><h4>{key === 'assumptions' ? 'Assumptions' : 'Objections'}</h4><ul>{turn.reply[key].map((text, index) => <li key={index}>{text}</li>)}</ul></div>)}<p>Saved {turn.facts.savedId} · revision {turn.facts.revision} · snapshot {turn.facts.snapshotId} · {turn.facts.basis === 'mid' ? 'Midpoint' : 'Natural liquidation'} basis. Hypothetical after inventory.</p>{[turn.facts.before, turn.facts.after].map((side, index) => <p key={index}>{index ? 'Hypothetical after' : 'Held before'}: {side.valuation ? `${side.valuation.historical ? 'Historical' : 'Dated'} quotes retrieved ${side.valuation.retrievedAt}.` : 'Closed inventory; no remaining quote valuation.'}</p>)}{turn.reply.suggested_prompts.map((prompt, index) => <button key={index} disabled={busy} onClick={() => setQuestion(prompt)}>{prompt}</button>)}</article>)}
    <form onSubmit={event => { event.preventDefault(); void discuss() }}><label>Question<input aria-label="Comparison question" value={question} disabled={busy} onChange={event => setQuestion(event.target.value)} /></label><button type="submit" disabled={busy}>Discuss this comparison</button><button type="button" disabled={busy || !turns.length} onClick={() => { setTurns([]); setConversation([]); setError('') }}>Start new discussion</button></form>{busy && <p role="status">Reviewing the read-only comparison…</p>}{error && <p role="alert">{error}</p>}
  </section>
}

function LotScenarios({ comparison, savedId, transaction }: { comparison: Comparison; savedId: string; transaction: LotTransaction }) {
  const spotLabel = (value: number) => comparison.before.projection.initial.underlyingKind === 'cash-index' ? `${value} index points` : money(value)
  const sides = [comparison.before, comparison.after]
  const start = new Date(Math.ceil(Math.max(...sides.map(side => Date.parse(side.valuation?.retrievedAt ?? side.projection.asOf))) / 1000) * 1000).toISOString()
  const expiries = sides.flatMap(side => side.projection.lots.flatMap(lot => lot.asset.kind === 'option' ? [Date.parse(lot.asset.expiry)] : []))
  const end = expiries.length ? new Date(Math.min(...expiries)).toISOString() : undefined
  const [spot, setSpot] = useState(String(sides.find(side => side.valuation?.remainingState)?.valuation?.remainingState?.spot ?? sides.find(side => side.valuation?.lotMarks.length)?.valuation?.lotMarks[0]?.mark ?? comparison.before.projection.initial.spot))
  const [date, setDate] = useState(start.slice(0, 19))
  const [shift, setShift] = useState(String(comparison.before.projection.initial.ivShift * 100))
  const [result, setResult] = useState<{ key: string; value: LotScenarioComparison } | null>(null)
  const [plotted, setPlotted] = useState<{ key: string; value: LotScenarioComparison } | null>(null)
  const chart = useRef<HTMLElement>(null)
  const [error, setError] = useState(''), [busy, setBusy] = useState(false)
  const pending = useRef<AbortController | null>(null)
  const key = JSON.stringify([spot, date, shift])
  const latest = useRef(key); latest.current = key
  useEffect(() => { pending.current?.abort(); setResult(null); setPlotted(null); setError(''); setBusy(false); return () => pending.current?.abort() }, [key])
  const model = async () => {
    pending.current?.abort()
    const controller = new AbortController(); pending.current = controller
    setBusy(true); setError(''); setResult(null); setPlotted(null)
    try {
      if (!spot.trim() || !shift.trim() || !date) throw new Error('Enter a scenario spot, UTC datetime and IV shift.')
      const value = await requestLotScenarioComparison(comparison, { spot: Number(spot), date: new Date(`${date}Z`).toISOString(), ivShift: Number(shift) / 100 }, controller.signal)
      if (!controller.signal.aborted && latest.current === key) setResult({ key, value })
    } catch (cause) { if (!controller.signal.aborted && latest.current === key) setError(cause instanceof Error ? cause.message : 'Scenario unavailable.') }
    finally { if (!controller.signal.aborted && latest.current === key) setBusy(false) }
  }
  const plot = async (requested: NonNullable<LotDiscussionFacts['scenario']>) => {
    pending.current?.abort()
    const controller = new AbortController(); pending.current = controller
    setBusy(true); setError(''); setPlotted(null)
    try {
      const value = await requestLotScenarioComparison(comparison, requested.scenario, controller.signal)
      if (value.model !== requested.model || Math.abs(value.before.target - requested.before.combinedPnl) > 1e-7 || Math.abs(value.after.target - requested.after.combinedPnl) > 1e-7) throw new Error('Chart calculation does not match the discussion result. Compare the dated position again.')
      if (!controller.signal.aborted && latest.current === key) setPlotted({ key, value })
    } catch (cause) { if (!controller.signal.aborted && latest.current === key) setError(cause instanceof Error ? cause.message : 'Scenario unavailable.') }
    finally { if (!controller.signal.aborted && latest.current === key) setBusy(false) }
  }
  const selected = result?.key === key ? result.value : null
  const preview = plotted?.key === key ? plotted.value : null
  const value = preview ?? selected
  const [inspection, setInspection] = useState<{ source: LotScenarioComparison; index: number } | null>(null)
  useEffect(() => setInspection(null), [value])
  const afterPoints = new Map(value?.after.points.map(point => [point.spot, point.value]))
  const samples = value?.before.points.flatMap(point => afterPoints.has(point.spot) ? [{ spot: point.spot, held: point.value, proposed: afterPoints.get(point.spot)! }] : []) ?? []
  const inspectedIndex = inspection?.source === value ? inspection.index : Math.max(0, samples.findIndex(point => point.spot === value?.scenario.spot))
  const inspected = samples[inspectedIndex]
  useEffect(() => { if (preview) chart.current?.scrollIntoView({ block: 'nearest' }) }, [preview])
  const values = value ? [...value.before.points, ...value.after.points].map(point => point.value) : [0]
  const low = Math.min(0, ...values), high = Math.max(0, ...values), span = high - low || 1
  const x = (spot: number) => 74 + (spot - value!.min) / (value!.max - value!.min) * 510
  const y = (pnl: number) => 20 + (high - pnl) / span * 190
  return <section aria-label="Roll price and time scenarios"><h3>Price and time scenarios</h3>
    <p>Realized P/L stays fixed. Only remaining holdings are modelled; no orders, assignment or settlement. Date is limited to the first expiry on either side.</p>
    {!!comparison.before.projection.initial.expiryIvShifts?.length && <p>Additional IV by expiry held fixed for remaining contracts: {comparison.before.projection.initial.expiryIvShifts.map(shift => `${shift.expiry.slice(0, 10)}: ${(shift.ivShift * 100).toFixed(2)} pts`).join(' · ')}.</p>}
    <form onSubmit={event => { event.preventDefault(); void model() }}><fieldset><legend>Shared assumptions</legend>
      <label>{comparison.before.projection.initial.underlyingKind === 'cash-index' ? 'Index level · points' : 'Underlying price'}<input aria-label="Comparison scenario spot" type="number" min="0.000001" step="any" required value={spot} onChange={event => setSpot(event.target.value)} /></label>
      <label>UTC datetime<input aria-label="Comparison scenario UTC datetime" type="datetime-local" step="1" required min={start.slice(0, 19)} max={end?.slice(0, 19)} value={date} onChange={event => setDate(event.target.value)} /></label>
      <label>IV shift · percentage points<input aria-label="Comparison scenario IV shift" type="number" step="any" required value={shift} onChange={event => setShift(event.target.value)} /></label>
      <button disabled={busy} type="submit">Model both positions</button>
    </fieldset></form>
    {busy && <p role="status">Calculating both positions…</p>}{error && <p role="alert">{error}</p>}
    {value && <section ref={chart} tabIndex={-1} aria-label="Modeled roll comparison">{preview && <p>Conversation chart preview · selected controls and saved position are unchanged. <button onClick={() => setPlotted(null)}>Return to selected scenario</button></p>}<p>{value.model} · {value.scenario.date} · IV shift {(value.scenario.ivShift * 100).toFixed(2)} pp</p>
      <dl className="lifecycle-totals"><div><dt>Held at {spotLabel(value.scenario.spot)}</dt><dd>{money(value.before.target)}</dd></div><div><dt>Proposed at {spotLabel(value.scenario.spot)}</dt><dd>{money(value.after.target)}</dd></div><div><dt>Proposed difference</dt><dd>{money(value.after.target - value.before.target)}</dd></div></dl>
      <svg viewBox="0 0 620 250" role="img" aria-label="Held and proposed modeled P/L curves" style={{ width: '100%', display: 'block' }} onPointerMove={event => {
        const bounds = event.currentTarget.getBoundingClientRect()
        const target = value.min + Math.max(0, Math.min(1, (620 * (event.clientX - bounds.left) / bounds.width - 74) / 510)) * (value.max - value.min)
        const index = samples.reduce((best, point, index) => Math.abs(point.spot - target) < Math.abs(samples[best].spot - target) ? index : best, 0)
        if (samples.length) setInspection({ source: value, index })
      }}>
        <line x1="74" x2="584" y1={y(0)} y2={y(0)} stroke="var(--line-strong)" />
        {[value.before, value.after].map((side, index) => <polyline key={index} points={side.points.map(point => `${x(point.spot)},${y(point.value)}`).join(' ')} fill="none" stroke={index ? 'var(--jade)' : 'var(--cobalt)'} strokeWidth="2" strokeDasharray={index ? undefined : '6 3'} />)}
        {inspected && <g aria-hidden="true"><line x1={x(inspected.spot)} x2={x(inspected.spot)} y1="20" y2="210" stroke="var(--muted)" strokeDasharray="3 3" /><circle cx={x(inspected.spot)} cy={y(inspected.held)} r="4" fill="var(--cobalt)" /><circle cx={x(inspected.spot)} cy={y(inspected.proposed)} r="4" fill="var(--jade)" /></g>}
        <g fill="var(--muted)" fontSize="11"><text x="70" y="17" textAnchor="end">{money(high)}</text><text x="70" y="214" textAnchor="end">{money(low)}</text><text x="74" y="238">{spotLabel(value.min)}</text><text x="584" y="238" textAnchor="end">{spotLabel(value.max)}</text></g>
      </svg>{inspected && <><label>Inspect comparison price<input type="range" aria-label="Inspect comparison price" min="0" max={samples.length - 1} step="1" value={inspectedIndex} aria-valuetext={`${spotLabel(inspected.spot)}; held ${money(inspected.held)}; proposed ${money(inspected.proposed)}`} onChange={event => setInspection({ source: value, index: Number(event.target.value) })} /></label><output role="status" aria-label="Comparison price inspection" aria-live="polite">Sampled price {spotLabel(inspected.spot)} · held {money(inspected.held)} · proposed {money(inspected.proposed)} · difference {money(inspected.proposed - inspected.held)}</output></>}<p>Dashed blue: held. Solid green: proposed. Hover or use the price slider and arrow keys to inspect shared calculated samples. Combined P/L includes the allowance once per side. Curves show this scenario date, not guaranteed returns.</p>
    </section>}
    <LotDiscussion key={`${key}:${selected ? 'modeled' : 'dated'}`} savedId={savedId} comparison={comparison} transaction={transaction} scenario={selected?.scenario} onPlot={result => void plot(result)} plotting={busy} />
  </section>
}

export function LotManagement({ savedId, source, snapshotId, onClose, onRecorded, onAnalyze }: { savedId: string; source: StrategyState; snapshotId?: string; onClose: () => void; onRecorded: () => Promise<void>; onAnalyze: (state: StrategyState, snapshotId: string) => boolean }) {
  const [captured] = useState(() => structuredClone(source))
  const dialog = useRef<HTMLDialogElement>(null)
  const [current, setCurrent] = useState<Loaded | null>(null)
  const index = current?.record.state.underlyingKind === 'cash-index'
  const priceUnit = index ? 'premium points' : 'per share'
  const priceLabel = (value: number | undefined) => index ? `${value} premium points` : '$' + value + ' per share'
  const [closes, setCloses] = useState<Record<string, Selection>>({})
  const [opens, setOpens] = useState<Record<string, Selection>>({})
  const [at, setAt] = useState('')
  const [review, setReview] = useState<{ revision: number; transaction: LotTransaction; before: Projection; projection: Projection } | null>(null)
  const [action, setAction] = useState<'transaction' | 'correction' | 'opening-correction' | 'void'>('transaction')
  const [closeId, setCloseId] = useState(''), [correctedPrice, setCorrectedPrice] = useState(''), [reason, setReason] = useState('')
  const [amendmentReview, setAmendmentReview] = useState<{ revision: number; amendment: LotAmendment; before: Projection; projection: Projection } | null>(null)
  const reviewing = !!review || !!amendmentReview
  const [busy, setBusy] = useState(false)
  const [uncertain, setUncertain] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [basis, setBasis] = useState<'mid' | 'natural'>('mid')
  const [valued, setValued] = useState<{ key: string; valuation: Valuation } | null>(null)
  const [compared, setCompared] = useState<{ key: string; value: Comparison } | null>(null)
  const valuationGeneration = useRef(0)
  const mounted = useRef(true)
  const valuationKey = JSON.stringify([savedId, current?.record.revision, snapshotId, basis, review?.transaction.id, amendmentReview?.amendment.id])
  const latestValuationKey = useRef(valuationKey)
  latestValuationKey.current = valuationKey
  const invalidateValuation = () => { valuationGeneration.current++; setValued(null); setCompared(null) }
  useEffect(() => { invalidateValuation() }, [savedId, current?.record.revision, snapshotId, basis, review?.transaction.id, amendmentReview?.amendment.id])
  const valuation = valued?.key === valuationKey && !reviewing && !uncertain ? valued.valuation : null
  const comparison = compared?.key === valuationKey && review && !uncertain ? compared.value : null
  const endpoint = `/api/strategies/${encodeURIComponent(savedId)}`
  const headers = { 'Content-Type': 'application/json', 'X-ARGUS-Request': '1' }
  const dismiss = () => { dialog.current?.close(); onClose() }
  const matched = (record: SavedStrategy, transaction: LotTransaction) => record.lifecycle?.schemaVersion === 2 && record.lifecycle.transactions.some(item => sameTransaction(item, transaction))
  const matchedAmendment = (record: SavedStrategy, amendment: LotAmendment) => record.lifecycle?.schemaVersion === 2 && record.lifecycle.amendments?.some(item => item.kind === amendment.kind && item.id === amendment.id && item.recordedAt === amendment.recordedAt && item.reason === amendment.reason && (item.kind === 'opening-price-correction' ? amendment.kind === 'opening-price-correction' && item.lotId === amendment.lotId && item.price === amendment.price : amendment.kind !== 'opening-price-correction' && item.closeId === amendment.closeId && (item.kind !== 'price-correction' || amendment.kind === 'price-correction' && item.price === amendment.price)))
  const clear = () => { setReview(null); setAmendmentReview(null); setUncertain(false); setCloses({}); setOpens({}); setAt(''); setCloseId(''); setCorrectedPrice(''); setReason('') }
  const refreshList = async () => { try { await onRecorded() } catch { setNotice('Transaction recorded. Reload the saved-position list before another saved-workspace action.') } }
  const load = async (signal?: AbortSignal) => {
    invalidateValuation()
    setBusy(true); setError('')
    try {
      const response = await fetch(`${endpoint}/lots`, { signal })
      const body = await response.json() as Loaded & { error?: { message?: string } }
      if (!response.ok) throw new Error(body.error?.message ?? 'Lot inventory unavailable. Keep held entry costs and save first.')
      setCurrent(body)
      if (uncertain && amendmentReview) {
        if (matchedAmendment(body.record, amendmentReview.amendment)) { clear(); setNotice('The identical amendment is recorded. The builder has not changed.'); await refreshList() }
        else setNotice('This reload does not confirm the amendment. It may still be processing. Retry the identical request; edits remain locked.')
      } else if (uncertain && review) {
        if (matched(body.record, review.transaction)) { clear(); setNotice('The identical transaction is recorded. The builder has not changed.'); await refreshList() }
        else setNotice('This reload does not confirm the transaction. It may still be processing. Retry the identical request; edits remain locked.')
      } else { setReview(null); setAmendmentReview(null) }
    } catch (cause) { if (!signal?.aborted) setError(cause instanceof Error ? cause.message : 'Lot inventory unavailable.') }
    finally { if (!signal?.aborted) setBusy(false) }
  }
  useEffect(() => {
    mounted.current = true
    dialog.current?.showModal()
    const controller = new AbortController()
    void load(controller.signal)
    return () => { controller.abort(); mounted.current = false; valuationGeneration.current++ }
  }, [])
  const candidates: { id: string; asset: LotAsset; side: 'long' | 'short'; quantity: number }[] = [
    ...captured.legs.map(leg => ({ id: leg.id, asset: { kind: 'option' as const, contractId: leg.contractId, type: leg.type, strike: leg.strike, expiry: new Date(leg.expiry).toISOString(), multiplier: leg.multiplier }, side: leg.side, quantity: leg.contracts })),
    ...(captured.stock && !index ? [{ id: 'stock', asset: { kind: 'stock' as const, symbol: captured.underlying }, side: captured.stock.shares > 0 ? 'long' as const : 'short' as const, quantity: Math.abs(captured.stock.shares) }] : []),
  ]
  const sameUnderlying = current?.record.state.underlying === captured.underlying && current.record.state.underlyingKind === captured.underlyingKind
  const selection = (items: Record<string, Selection>, id: string, quantity: number) => items[id] ?? { checked: false, quantity: String(quantity), price: '' }
  const preview = async () => {
    if (!current || busy || uncertain || reviewing) return
    invalidateValuation()
    setBusy(true); setError(''); setNotice('')
    try {
      const date = new Date(`${at}Z`)
      if (!at || !Number.isFinite(date.getTime())) throw new Error('Enter a valid transaction UTC date and time.')
      const values = (item: Selection) => {
        const quantity = Number(item.quantity), price = Number(item.price)
        if (!item.quantity.trim() || !Number.isSafeInteger(quantity) || quantity <= 0 || !item.price.trim() || !Number.isFinite(price) || price < 0) throw new Error('Every selected asset needs a positive whole quantity and an explicit nonnegative execution price.')
        return { quantity, price }
      }
      const transaction: LotTransaction = { id: crypto.randomUUID(), at: date.toISOString(), recordedAt: new Date().toISOString(),
        closes: current.projection.lots.filter(lot => closes[lot.id]?.checked).map(lot => ({ id: crypto.randomUUID(), lotId: lot.id, ...values(closes[lot.id]) })),
        opens: sameUnderlying ? candidates.filter(item => opens[item.id]?.checked).map(item => { const value = values(opens[item.id]); return { id: crypto.randomUUID(), asset: item.asset, side: item.side, quantity: value.quantity, entryPrice: value.price } }) : [],
      }
      if (!transaction.closes.length && !transaction.opens.length) throw new Error('Select at least one lot to close or asset to open.')
      const response = await fetch(`${endpoint}/transactions/preview`, { method: 'POST', headers, body: JSON.stringify({ revision: current.record.revision, transaction }) })
      const body = await response.json() as { revision: number; projection: Projection; error?: { message?: string } }
      if (!response.ok) throw new Error(body.error?.message ?? 'Transaction preview rejected. Reload if the saved revision changed.')
      if (body.revision !== current.record.revision) throw new Error('Saved revision changed. Reload before previewing again.')
      setReview({ revision: body.revision, transaction, before: current.projection, projection: body.projection })
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Transaction preview unavailable.') }
    finally { setBusy(false) }
  }
  const confirm = async () => {
    if ((!review && !amendmentReview) || busy) return
    invalidateValuation()
    setBusy(true); setError(''); setNotice('')
    try {
      const amendment = amendmentReview?.amendment
      const { kind, ...request } = amendment ?? { kind: '' }
      const response = await fetch(`${endpoint}/${amendment ? kind === 'opening-price-correction' ? 'lot-opening-price-corrections' : kind === 'price-correction' ? 'lot-price-corrections' : 'lot-close-voids' : 'transactions'}`, { method: 'POST', headers, body: JSON.stringify(amendment ? { revision: amendmentReview!.revision, [kind === 'close-void' ? 'void' : 'correction']: request } : { revision: review!.revision, transaction: review!.transaction }) })
      const body = await response.json() as Loaded & { error?: { message?: string } }
      if (!response.ok && response.status >= 400 && response.status < 500 && !uncertain) { setError(body.error?.message ?? 'Transaction rejected. Edit or reload before another preview.'); return }
      if (!response.ok) throw new Error(body.error?.message ?? 'Recording was not confirmed.')
      if (!(amendment ? matchedAmendment(body.record, amendment) : matched(body.record, review!.transaction)) || body.record.revision <= (amendmentReview?.revision ?? review!.revision)) throw new Error('The response did not confirm this exact recorded event.')
      setCurrent(body); clear(); setNotice(`${amendment ? 'Amendment' : 'Transaction'} recorded. The strategy builder has not changed.`); await refreshList()
    } catch (cause) { setUncertain(true); setError(`${cause instanceof Error ? cause.message : 'Recording was not confirmed.'} Retry this identical request or reload to resolve it. Do not enter another transaction.`) }
    finally { setBusy(false) }
  }
  const valueRemaining = async () => {
    if (!current || !snapshotId || busy || uncertain || reviewing || current.projection.status === 'closed') return
    invalidateValuation()
    const generation = valuationGeneration.current, key = valuationKey, revision = current.record.revision
    const isCurrent = () => mounted.current && generation === valuationGeneration.current && key === latestValuationKey.current
    setBusy(true); setError(''); setNotice('')
    try {
      const response = await fetch(`${endpoint}/valuation`, { method: 'POST', headers, body: JSON.stringify({ revision, snapshotId, basis }) })
      const body = await response.json() as { revision: number; valuation: Valuation; error?: { message?: string } }
      if (!isCurrent()) return
      if (!response.ok) throw new Error(body.error?.message ?? 'Dated lot valuation unavailable. Capture matching quotes and reload the saved record.')
      if (body.revision !== revision || body.valuation.snapshotId !== snapshotId || body.valuation.basis !== basis) throw new Error('Valuation source changed. Reload and value again.')
      setValued({ key, valuation: body.valuation })
    } catch (cause) { if (isCurrent()) setError(cause instanceof Error ? cause.message : 'Dated lot valuation unavailable.') }
    finally { if (mounted.current) setBusy(false) }
  }
  const analyze = () => {
    const state = valuation?.remainingState
    if (!state || !current || busy || uncertain || reviewing) return
    try { assertRemainingLotInventory(current.projection.lots, state) }
    catch { setError('Remaining inventory does not match the recorded position.'); return }
    if (onAnalyze(state, valuation.snapshotId)) dismiss()
    else setError('Remaining holdings could not be opened. Reload matching workspace quotes and value again.')
  }
  const inventory = (projection: Projection) => projection.lots.length ? <ul className="lot-inventory">{projection.lots.map(lot => <li key={lot.id}><strong>{lot.side} {label(lot.asset)}</strong><br />Lot {lot.id} · {lot.quantity} {lot.asset.kind === 'stock' ? 'shares' : 'contracts'} · held entry {priceLabel(lot.entryPrice)}<br /><small>Opened {lot.at}</small></li>)}</ul> : <p>No remaining lots. Position fully closed.</p>
  const compare = async () => {
    if (!review || !snapshotId || busy || uncertain) return
    invalidateValuation()
    const generation = valuationGeneration.current, key = valuationKey
    const isCurrent = () => mounted.current && generation === valuationGeneration.current && key === latestValuationKey.current
    setBusy(true); setError(''); setNotice('')
    try {
      const response = await fetch(`${endpoint}/transaction-comparison`, { method: 'POST', headers, body: JSON.stringify({ revision: review.revision, transaction: review.transaction, snapshotId, basis }) })
      const body = await response.json() as Comparison & { error?: { message?: string } }
      if (!isCurrent()) return
      if (!response.ok) throw new Error(body.error?.message ?? 'Comparison unavailable. Quotes must cover both inventories and follow the entered executions.')
      if (body.revision !== review.revision || body.transactionId !== review.transaction.id || body.snapshotId !== snapshotId || body.basis !== basis || [body.before, body.after].some(side => side.valuation ? side.valuation.snapshotId !== snapshotId || side.valuation.basis !== basis : side.projection.status !== 'closed')) throw new Error('Comparison source changed. Reload and preview again.')
      setCompared({ key, value: body })
    } catch (cause) { if (isCurrent()) setError(cause instanceof Error ? cause.message : 'Comparison unavailable.') }
    finally { if (mounted.current) setBusy(false) }
  }
  const totals = (projection: Projection, projected = false) => <dl className="lifecycle-totals"><div><dt>{projected ? 'Projected gross realized P/L' : 'Gross realized P/L'}</dt><dd>{money(projection.grossRealizedPnl)}</dd></div><div><dt>Position allowance · not allocated</dt><dd>{money(projection.allowance)}</dd></div>{projection.netClosedPnl !== null && <div><dt>{projected ? 'Projected fully closed net P/L' : 'Fully closed net P/L'}</dt><dd>{money(projection.netClosedPnl)}</dd></div>}</dl>
  const controls = (kind: 'Close' | 'Open', id: string, quantity: number, description: string) => {
    const items = kind === 'Close' ? closes : opens, update = kind === 'Close' ? setCloses : setOpens, value = selection(items, id, quantity)
    const change = (patch: Partial<Selection>) => update(previous => ({ ...previous, [id]: { ...value, ...patch } }))
    return <fieldset key={id}><legend>{description}</legend><label className="lot-check"><input type="checkbox" aria-label={`${kind} ${kind === 'Close' ? 'lot' : 'leg'} ${id}`} checked={value.checked} onChange={event => change({ checked: event.target.checked })} />{kind} {id}</label><label>Quantity<input type="number" min="1" step="1" aria-label={`${kind} quantity ${id}`} disabled={!value.checked} required={value.checked} value={value.quantity} onChange={event => change({ quantity: event.target.value })} /></label><label>Execution price · {priceUnit}<input type="number" min="0" step="any" aria-label={`${kind} price ${id}`} disabled={!value.checked} required={value.checked} value={value.price} onChange={event => change({ price: event.target.value })} /></label></fieldset>
  }
  const ledger = current?.record.lifecycle
  const legacy = ledger?.schemaVersion === 2 ? ledger.legacy : ledger
  const voided = new Set([...(legacy?.closeVoids?.map(item => item.closeId) ?? []), ...(ledger?.schemaVersion === 2 ? ledger.amendments?.filter(item => item.kind === 'close-void').map(item => item.closeId) ?? [] : [])])
  const recordedCloses = [...(legacy?.closes.map(item => ({ id: item.id, price: item.price, description: `${item.assetId} · ${item.quantity} · ${item.at}` })) ?? []), ...(ledger?.schemaVersion === 2 ? ledger.transactions.flatMap(transaction => transaction.closes.map(item => ({ id: item.id, price: item.price, description: `Lot ${item.lotId} · ${item.quantity} · ${transaction.at}` }))) : [])]
  const effectivePrice = (id: string, original: number) => {
    const amended = ledger?.schemaVersion === 2 ? ledger.amendments?.filter(item => item.kind === 'price-correction' && item.closeId === id).at(-1) : undefined
    return amended?.kind === 'price-correction' ? amended.price : legacy?.priceCorrections?.filter(item => item.closeId === id).at(-1)?.price ?? original
  }
  const activeCloses = recordedCloses.filter(item => !voided.has(item.id))
  const chosenAction = reviewing ? action : (action === 'correction' || action === 'void') && (ledger?.schemaVersion !== 2 || !activeCloses.length) ? 'transaction' : action
  const previewAmendment = async () => {
    if (!current || (chosenAction !== 'opening-correction' && ledger?.schemaVersion !== 2) || busy || uncertain || reviewing || chosenAction === 'transaction') return
    invalidateValuation(); setBusy(true); setError(''); setNotice('')
    try {
      if (!(chosenAction === 'opening-correction' ? current.projection.openings : activeCloses).some(item => item.id === closeId) || !reason.trim()) throw new Error(`Select a recorded ${chosenAction === 'opening-correction' ? 'opening lot' : 'close'} and enter a reason.`)
      if (chosenAction !== 'void' && (!correctedPrice.trim() || !Number.isFinite(Number(correctedPrice)) || Number(correctedPrice) < 0)) throw new Error('Enter an explicit nonnegative corrected price.')
      const base = { id: crypto.randomUUID(), reason: reason.trim(), recordedAt: new Date().toISOString() }
      const amendment: LotAmendment = chosenAction === 'opening-correction' ? { kind: 'opening-price-correction', ...base, lotId: closeId, price: Number(correctedPrice) } : chosenAction === 'correction' ? { kind: 'price-correction', ...base, closeId, price: Number(correctedPrice) } : { kind: 'close-void', ...base, closeId }
      const { kind, ...request } = amendment
      const response = await fetch(`${endpoint}/${kind === 'opening-price-correction' ? 'lot-opening-price-corrections' : kind === 'price-correction' ? 'lot-price-corrections' : 'lot-close-voids'}/preview`, { method: 'POST', headers, body: JSON.stringify({ revision: current.record.revision, [kind === 'close-void' ? 'void' : 'correction']: request }) })
      const body = await response.json() as { revision: number; projection: Projection; error?: { message?: string } }
      if (!response.ok) throw new Error(body.error?.message ?? 'Amendment preview rejected.')
      if (body.revision !== current.record.revision) throw new Error('Saved revision changed. Reload before previewing again.')
      setAmendmentReview({ revision: body.revision, amendment, before: current.projection, projection: body.projection })
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Amendment preview unavailable.') }
    finally { setBusy(false) }
  }
  return <dialog ref={dialog} className="lifecycle-dialog lot-management" aria-label="Manage lots and rolls" onCancel={event => { event.preventDefault(); if (!busy && !uncertain) dismiss() }}>
    <header><div><h2>{current?.record.title ?? 'Manage lots and rolls'}</h2><span>{current ? `Revision ${current.record.revision} · ${current.projection.status}` : 'Loading saved position'}</span></div><button aria-label="Close lot-management panel" disabled={busy || uncertain} onClick={dismiss}>Close</button></header>
    <p>User-recorded transactions, not broker-verified fills or orders. Recording does not change the builder. Exercise, assignment and settlement are not simulated.</p>
    {index && <p>European cash-settled index options · execution premiums in points · $100 per premium point per contract. P/L and allowance are USD. Index shares cannot be opened.</p>}
    {busy && <p role="status">Updating lot records…</p>}{error && <p role="alert" className="workspace-error">{error}</p>}{notice && <p role="status">{notice}</p>}
    <button disabled={busy} onClick={() => void load()}>Reload saved record</button>
    {current && <><h3>Remaining lot inventory</h3>{inventory(current.projection)}{totals(current.projection)}
      {!busy && !uncertain && !reviewing && <PositionPerformance key={`${savedId}:${current.record.revision}`} record={current.record} />}
      {valuation?.remainingState && <section><button disabled={busy || uncertain || reviewing} onClick={analyze}>Analyze remaining holdings</button><p>Opens a separate unsaved analysis with effective weighted lot costs. Excludes recorded realized P/L and the original allowance. Undo restores the previous strategy; saved history is unchanged.</p></section>}
      {valuation && !valuation.remainingState && <p>Builder analysis unavailable: {valuation.analysisUnavailable ?? 'This remaining inventory cannot be represented in the strategy builder.'}</p>}
      <div inert={!!amendmentReview}>
      <section aria-label="Remaining lot valuation"><h3>Dated remaining-lot estimate</h3><p>Explicitly value the saved inventory using a captured workspace snapshot. No automatic quote fetch, builder import or before/after scenario comparison.</p>{!snapshotId && <p>Capture or load matching workspace quotes before valuing remaining lots.</p>}<label>Liquidation quote basis<select aria-label="Lot valuation basis" value={basis} disabled={busy || uncertain || reviewing || current.projection.status === 'closed'} onChange={event => setBasis(event.target.value as 'mid' | 'natural')}><option value="mid">Midpoint · estimate</option><option value="natural">Natural liquidation · estimate</option></select></label><button disabled={!snapshotId || busy || uncertain || reviewing || current.projection.status === 'closed'} onClick={() => void valueRemaining()}>Value remaining lots</button>
        {valuation && <section aria-label="Dated lot combined P/L"><h3>Dated combined P/L · {money(valuation.combinedPnl)}</h3><p>Recorded realized {money(valuation.grossRealizedPnl)} + remaining unrealized {money(valuation.unrealizedPnl)} − allowance {money(valuation.allowance)} = {money(valuation.combinedPnl)}</p><p>{valuation.basis === 'mid' ? 'Midpoint' : 'Natural liquidation'} quotes · {valuation.historical ? 'Historical snapshot' : 'Dated snapshot'} · {valuation.snapshotId}</p><p>Retrieved {valuation.retrievedAt}<br />Source quotes {valuation.oldestQuoteAt} to {valuation.newestQuoteAt}</p><p>{valuation.disclosure}</p>{valuation.lotMarks && <><h3>Dated lot marks</h3><ul>{valuation.lotMarks.map(mark => <li key={mark.lotId}>Lot {mark.lotId} · {mark.quantity} units · held entry {priceLabel(mark.entryPrice)} · mark {priceLabel(mark.mark)} · unrealized {money(mark.unrealizedPnl)}</li>)}</ul></>}</section>}
      </section>
      </div>
      <label>Lot action<select aria-label="Lot action" value={chosenAction} disabled={busy || uncertain || reviewing} onChange={event => { setAction(event.target.value as typeof action); setError(''); setCloseId(''); setCorrectedPrice(''); setReason(''); invalidateValuation() }}><option value="transaction">Record transaction</option><option value="opening-correction">Correct recorded opening price</option>{ledger?.schemaVersion === 2 && activeCloses.length > 0 && <><option value="correction">Correct recorded close price</option><option value="void">Void erroneous close</option></>}</select></label>
      {ledger?.schemaVersion !== 2 && <p>For close-price corrections or erroneous-close voids on this original record, use Manage closes. Confirming an opening-price correction preserves the original record inside the lot ledger; preview alone does not upgrade it.</p>}
      {chosenAction !== 'transaction' && !reviewing && <form onSubmit={event => { event.preventDefault(); void previewAmendment() }}><fieldset disabled={busy || uncertain}><legend>{chosenAction === 'opening-correction' ? 'Correct a recorded opening price' : chosenAction === 'correction' ? 'Correct a recorded close price' : 'Void an erroneous close'}</legend><p>{chosenAction === 'void' ? 'Only void a close that did not occur. This restores recorded inventory; it does not reverse an actual trade or send an order.' : chosenAction === 'opening-correction' ? 'Correct the opening transcription price only. This recalculates the lot’s realized P/L and remaining entry basis, including fully closed lots. Quantity, contract, execution time and original records are unchanged. This does not void an opening or undo a roll.' : 'Correct the transcription price only. Quantity and execution time are unchanged; the original record is retained.'}</p>
        {chosenAction === 'opening-correction' ? <label>Recorded opening lot<select aria-label="Recorded opening lot" required value={closeId} onChange={event => setCloseId(event.target.value)}><option value="">Select an opening lot</option>{current.projection.openings.map(lot => <option key={lot.id} value={lot.id}>{lot.id} · {lot.side} {label(lot.asset)} · opened {lot.quantity} · original {priceLabel(lot.originalEntryPrice)} · effective {priceLabel(lot.entryPrice)}{current.projection.lots.some(item => item.id === lot.id) ? '' : ' · fully closed'}</option>)}</select></label> : <label>Recorded close<select aria-label="Recorded lot close" required value={closeId} onChange={event => setCloseId(event.target.value)}><option value="">Select a close</option>{activeCloses.map(item => <option key={item.id} value={item.id}>{item.description} · original {priceLabel(item.price)} · effective {priceLabel(effectivePrice(item.id, item.price))}</option>)}</select></label>}
        {chosenAction !== 'void' && <label>Corrected price · {priceUnit}<input aria-label={chosenAction === 'opening-correction' ? 'Corrected lot opening price' : 'Corrected lot close price'} type="number" min="0" step="any" required value={correctedPrice} onChange={event => setCorrectedPrice(event.target.value)} /></label>}<label>Reason<input aria-label="Lot amendment reason" required maxLength={500} value={reason} onChange={event => setReason(event.target.value)} /></label><button type="submit">Preview lot amendment</button></fieldset></form>}
      {amendmentReview && <section aria-label="Lot amendment preview"><h3>Preview amendment recording</h3><p>{amendmentReview.amendment.kind === 'opening-price-correction' ? `Opening lot ${amendmentReview.amendment.lotId}` : `Close ${amendmentReview.amendment.closeId}`}{amendmentReview.amendment.kind !== 'close-void' ? ` · corrected price ${priceLabel(amendmentReview.amendment.price)}` : ' · void erroneous close; not a reversal of an actual trade or an order'}<br />{amendmentReview.amendment.reason}<br />Requested recording timestamp {amendmentReview.amendment.recordedAt}</p>
        {amendmentReview.amendment.kind === 'opening-price-correction' && <p>Opening basis: {priceLabel(amendmentReview.before.openings.find(lot => amendmentReview.amendment.kind === 'opening-price-correction' && lot.id === amendmentReview.amendment.lotId)?.entryPrice)} → {priceLabel(amendmentReview.amendment.price)}. Applies to closed and remaining units of this lot; no quantity, identity or execution-time change.</p>}
        <h3>Inventory before</h3>{inventory(amendmentReview.before)}<h3>Projected inventory after confirmation</h3>{inventory(amendmentReview.projection)}<p>Projected gross realized change {money(amendmentReview.projection.grossRealizedPnl - amendmentReview.before.grossRealizedPnl)}. Original history is retained. The builder does not change.</p><p>{uncertain ? 'Recording status is uncertain; this amendment may already be saved. Retry the identical request or reload to confirm.' : 'These are projected recorded totals after confirmation, not confirmation that the amendment is saved.'}</p>{totals(amendmentReview.projection, true)}<button disabled={busy} onClick={() => void confirm()}>{uncertain ? 'Retry identical amendment' : amendmentReview.amendment.kind !== 'close-void' ? 'Confirm price correction' : 'Void erroneous lot close'}</button><button disabled={busy || uncertain} onClick={() => { setAmendmentReview(null); setError('') }}>Edit amendment</button></section>}
      <div hidden={chosenAction !== 'transaction' || !!amendmentReview}>
      {review && <section aria-label="Roll comparison">
        <h3>Compare held and proposed inventory</h3>
        <p>One captured snapshot and {basis === 'mid' ? 'midpoint' : 'natural liquidation'} basis. The proposed side uses your entered executions; this does not confirm or record them.</p>
        <button disabled={!snapshotId || busy || uncertain} onClick={() => void compare()}>Compare dated P/L</button>
        {!snapshotId && <p>Load matching quotes for both inventories before comparing.</p>}
        {comparison && <section aria-label="Before and after dated P/L">
          <table><caption>Dated position P/L · {comparison.snapshotId}</caption><thead><tr><th scope="col">USD</th><th scope="col">Held</th><th scope="col">Proposed</th></tr></thead>
            <tbody>{(['Realized', 'Unrealized', 'Allowance', 'Combined'] as const).map(metric => <tr key={metric}><th scope="row">{metric}</th>{[comparison.before, comparison.after].map((side, index) => <td key={index}>{money(metric === 'Realized' ? side.valuation?.grossRealizedPnl ?? side.projection.grossRealizedPnl : metric === 'Unrealized' ? side.valuation?.unrealizedPnl ?? 0 : metric === 'Allowance' ? side.valuation?.allowance ?? side.projection.allowance : side.valuation?.combinedPnl ?? side.projection.netClosedPnl!)}</td>)}</tr>)}</tbody>
          </table>
          <p>Proposed change {money((comparison.after.valuation?.combinedPnl ?? comparison.after.projection.netClosedPnl!) - (comparison.before.valuation?.combinedPnl ?? comparison.before.projection.netClosedPnl!))}. Allowance deducted once on each side, not again from the difference.</p>
          {[comparison.before, comparison.after].map((side, index) => <p key={index}>{index === 0 ? 'Held' : 'Proposed'}: {side.valuation ? <>{side.valuation.historical ? 'Historical' : 'Dated'} snapshot retrieved {side.valuation.retrievedAt}; source quotes {side.valuation.oldestQuoteAt} to {side.valuation.newestQuoteAt}.</> : 'Fully closed; realized total, no remaining quote estimate.'}</p>)}
          <p>Dated accounting comparison, not a forecast or verified fill.</p>
          <LotScenarios key={`${savedId}:${comparison.revision}:${comparison.transactionId}:${comparison.snapshotId}:${comparison.basis}`} comparison={comparison} savedId={savedId} transaction={review.transaction} />
        </section>}
      </section>}
      {!review && <form onSubmit={event => { event.preventDefault(); void preview() }}><fieldset disabled={busy || uncertain} className="lot-transaction"><legend>Record a transaction</legend><p>Close specific held lots and optionally open new lots together. Execution prices must be entered; they are not quotes.</p><div><h3>Close held lots</h3>{current.projection.lots.map(lot => controls('Close', lot.id, lot.quantity, `${lot.side} ${label(lot.asset)}`))}</div><div><h3>Open from captured workspace</h3><p>{captured.name} · {captured.underlying} · version {captured.version}. These are descriptive source legs, not current quotes or recorded fills.</p>{sameUnderlying ? candidates.map(item => controls('Open', item.id, item.quantity, `${item.side} ${label(item.asset)}`)) : <p>The captured workspace has a different underlying or instrument kind. Only closing held lots is available.</p>}</div><label>Transaction UTC datetime<input type="datetime-local" step="1" aria-label="Transaction UTC datetime" required value={at} onChange={event => setAt(event.target.value)} /></label><button type="submit">Preview transaction</button></fieldset></form>}
      {review && <section aria-label="Transaction preview"><h3>Preview transaction recording</h3><p>Execution {review.transaction.at}<br />Requested recording timestamp {review.transaction.recordedAt}</p><ul>{review.transaction.closes.map(close => <li key={close.id}>Close lot {close.lotId}: {close.quantity} at {priceLabel(close.price)}</li>)}{review.transaction.opens.map(open => <li key={open.id}>Open {open.side} {label(open.asset)}: {open.quantity} at {priceLabel(open.entryPrice)}</li>)}</ul><h3>Inventory before</h3>{inventory(review.before)}<h3>Projected inventory after confirmation</h3>{inventory(review.projection)}<p>Projected gross realized change {money(review.projection.grossRealizedPnl - review.before.grossRealizedPnl)}. This previews execution accounting after confirmation, not a quote or modeled price scenario.</p><p>{uncertain ? 'Recording status is uncertain; this transaction may already be saved. Retry the identical request or reload to confirm.' : 'These are projected recorded totals after confirmation, not confirmation that the transaction is saved.'}</p>{totals(review.projection, true)}<button disabled={busy} onClick={() => void confirm()}>{uncertain ? 'Retry identical transaction' : 'Confirm recorded transaction'}</button><button disabled={busy || uncertain} onClick={() => { setReview(null); setError('') }}>Edit transaction</button></section>}
      </div>
<details><summary>Recorded lot activity</summary><h3>Effective recorded closes</h3><ul>{recordedCloses.map(item => <li key={item.id}>{item.id} · {item.description} · original {priceLabel(item.price)} · effective {priceLabel(effectivePrice(item.id, item.price))}{voided.has(item.id) ? ' · Voided; excluded from realized P/L' : ''}</li>)}</ul><h3>Original held position</h3><p>{current.record.state.name} · {current.record.state.valuationTimestamp}</p><ul>{current.record.state.legs.map(leg => <li key={leg.id}>{leg.id} · {leg.side} {leg.contractId} · {leg.contracts} contracts at {priceLabel(leg.entryPrice)}</li>)}{current.record.state.stock && <li>{current.record.state.stock.shares} shares at {priceLabel(current.record.state.stock.entryPrice)}</li>}</ul><h3>Original close history</h3><ul>{legacy?.closes.map(close => <li key={close.id}>{close.id} · {close.assetId} · {close.quantity} at {priceLabel(close.price)} · {close.at}</li>)}{legacy?.priceCorrections?.map(event => <li key={event.id}>Price correction {event.closeId} to {priceLabel(event.price)} · {event.reason} · {event.recordedAt}</li>)}{legacy?.closeVoids?.map(event => <li key={event.id}>Voided close {event.closeId} · {event.reason} · {event.recordedAt}</li>)}</ul>{ledger?.schemaVersion === 2 && <><h3>Dated transactions</h3>{ledger.transactions.map(transaction => <div key={transaction.id}><p>{transaction.id} · execution {transaction.at} · recorded {transaction.recordedAt}</p><ul>{transaction.closes.map(close => <li key={close.id}>Close {close.id} · lot {close.lotId} · {close.quantity} at {priceLabel(close.price)}</li>)}{transaction.opens.map(open => <li key={open.id}>Open lot {open.id} · {open.side} {label(open.asset)} · {open.quantity} at {priceLabel(open.entryPrice)}</li>)}</ul></div>)}<h3>Appended amendments</h3><ul>{ledger.amendments?.map(event => <li key={event.id}>{event.kind} · {event.kind === 'opening-price-correction' ? `opening lot ${event.lotId}` : `close ${event.closeId}`}{event.kind !== 'close-void' && ` · ${priceLabel(event.price)}`} · {event.reason} · {event.recordedAt}</li>)}</ul></>}</details>
    </>}
  </dialog>
}
