import { useEffect, useMemo, useRef, useState } from 'react'
import { HistoryCharts } from './HistoryCharts'
import { historyToday } from './price-history'
import { readPositionPerformance, validatePerformanceRange, type PositionPerformance as Performance } from './position-performance'
import { savedPosition, type SavedStrategy } from './saved-strategies'
import { projectPositionLots, upgradePositionLots, type PositionLots } from './position-lots'
import type { ConversationMessage, LotDiscussionReply } from './sparring'

const money = (value: number | null) => value === null ? 'Unavailable' : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value)
const priorDate = (date: string, days: number) => new Date(Date.parse(date) - days * 86400000).toISOString().slice(0, 10)

function PerformanceDiscussion({ record, position, range, selectedDate, onRefresh }: { record: SavedStrategy; position: PositionLots; range: Performance['range']; selectedDate: string; onRefresh: (performance: Performance) => void }) {
  const [question, setQuestion] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false)
  const [turns, setTurns] = useState<{ question: string; reply: LotDiscussionReply }[]>([]), [conversation, setConversation] = useState<ConversationMessage[]>([])
  const pending = useRef<AbortController | null>(null), mounted = useRef(false)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; pending.current?.abort() } }, [])
  async function discuss() {
    if (busy) return
    const content = question.trim(), messages: ConversationMessage[] = [...conversation, { role: 'user', content }]
    if (!content || messages.length > 12 || messages.reduce((sum, message) => sum + message.content.length, 0) > 12000) { setError('Enter a question within the 12-message / 12,000-character limit, or start a new discussion. Nothing was sent.'); return }
    const controller = new AbortController(), requestId = crypto.randomUUID()
    pending.current = controller; setBusy(true); setError('')
    const timer = setTimeout(() => { controller.abort(); if (mounted.current) { setBusy(false); setError('Discussion timed out. Your question has been kept; try again later.') } }, 90000)
    try {
      const response = await fetch(`/api/strategies/${encodeURIComponent(record.id)}/performance/discuss`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-ARGUS-Request': '1' }, signal: controller.signal, body: JSON.stringify({ revision: record.revision, range, selectedDate, request_id: requestId, conversation: messages }) })
      const body = await response.json() as { savedId?: unknown; revision?: unknown; source?: unknown; range?: { start?: unknown; end?: unknown }; selectedDate?: unknown; request_id?: unknown; performance?: unknown; reply?: LotDiscussionReply } | null
      if (controller.signal.aborted) return
      if (!response.ok) throw new Error(response.status === 409 ? 'Saved revision changed. Reload the saved record before discussing performance.' : 'Performance discussion unavailable. Your question and recorded holdings are unchanged.')
      if (!body || body.savedId !== record.id || body.revision !== record.revision || body.source !== 'Theta EOD' || body.range?.start !== range.start || body.range?.end !== range.end || body.selectedDate !== selectedDate || body.request_id !== requestId) throw new Error('Discussion identity or dates do not match. Reply discarded.')
      const checked = readPositionPerformance(body.performance, position, range), reply = body.reply
      if (!checked.rows.some(row => row.date === selectedDate)) throw new Error('Selected performance date is unavailable.')
      if (!reply || Object.keys(reply).sort().join() !== 'assumptions,objections,suggested_prompts,text' || typeof reply.text !== 'string' || !reply.text.trim() || !(['assumptions', 'objections', 'suggested_prompts'] as const).every(key => Array.isArray(reply[key]) && reply[key].every(item => typeof item === 'string')) || new TextEncoder().encode(JSON.stringify(reply)).byteLength > 64 * 1024) throw new Error('Invalid read-only performance reply. Your question has been kept.')
      onRefresh(checked)
      setTurns(previous => [...previous, { question: content, reply }]); setQuestion('')
      setConversation([...messages, { role: 'assistant', content: [reply.text, ...reply.assumptions, ...reply.objections, ...reply.suggested_prompts].join('\n') }])
    } catch (cause) { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Performance discussion unavailable.') }
    finally { clearTimeout(timer); if (!controller.signal.aborted) setBusy(false) }
  }
  return <section aria-label="Read-only performance discussion"><h3>Discuss this position’s performance</h3><p>Selected {selectedDate} · {range.start} through {range.end}. Each question reloads dated history for saved revision {record.revision}; validated accounting may update. Previous assistant replies are not authoritative facts. AI interpretation may contain errors. Changing the date, range, record or reloading starts a new discussion. No holdings, orders or transactions change.</p>
    {turns.map((turn, index) => <article key={index}><h4>{turn.question}</h4><p style={{ whiteSpace: 'pre-wrap' }}>{turn.reply.text}</p>{(['assumptions', 'objections'] as const).map(key => turn.reply[key].length > 0 && <div key={key}><h4>{key === 'assumptions' ? 'Assumptions' : 'Objections'}</h4><ul>{turn.reply[key].map((text, item) => <li key={item}>{text}</li>)}</ul></div>)}{turn.reply.suggested_prompts.map((text, item) => <button key={item} type="button" disabled={busy} onClick={() => setQuestion(text)}>{text}</button>)}</article>)}
    <form className="history-range" onSubmit={event => { event.preventDefault(); void discuss() }}><label>Question<input aria-label="Performance question" value={question} maxLength={12000} disabled={busy} onChange={event => setQuestion(event.target.value)} /></label><button type="submit" disabled={busy || !question.trim()}>Discuss performance</button><button type="button" disabled={busy} onClick={() => { setTurns([]); setConversation([]); setError('') }}>Start new performance discussion</button></form>
    {busy && <p role="status">Reloading dated performance and reviewing the selected date…</p>}{error && <p role="alert">{error}</p>}
  </section>
}

export function PositionPerformance({ record }: { record: SavedStrategy }) {
  const latest = priorDate(historyToday(), 1)
  const [range, setRange] = useState(() => ({ start: priorDate(latest, 6), end: latest }))
  const [result, setResult] = useState<Performance | null>(null)
  const [selected, setSelected] = useState(0)
  const [pending, setPending] = useState(false), [error, setError] = useState('')
  const request = useRef<AbortController | null>(null)
  useEffect(() => { setResult(null); setError(''); setPending(false); return () => request.current?.abort() }, [record])
  const position = useMemo(() => {
    try { const saved = savedPosition(record), lots = saved.schemaVersion === 2 ? saved : upgradePositionLots(saved); if (projectPositionLots(lots).initial.pricing?.mode !== 'market') return null; return lots }
    catch { return null }
  }, [record])
  let valid = !!position
  try { validatePerformanceRange(range) } catch { valid = false }
  const change = (key: 'start' | 'end', value: string) => {
    request.current?.abort(); setPending(false); setResult(null); setError('')
    setRange(current => ({ ...current, [key]: value }))
  }
  const load = async () => {
    if (!valid || !position || pending) return
    request.current?.abort()
    const controller = new AbortController(); request.current = controller
    const captured = { ...range }
    setPending(true); setResult(null); setError('')
    try {
      const response = await fetch(`/api/strategies/${encodeURIComponent(record.id)}/performance`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-ARGUS-Request': '1' }, body: JSON.stringify({ revision: record.revision, range: captured }), signal: controller.signal })
      const body = await response.json() as { savedId?: unknown; revision?: unknown; source?: unknown; range?: { start?: unknown; end?: unknown }; performance?: unknown } | null
      if (controller.signal.aborted) return
      if (!response.ok) throw new Error(response.status === 409 ? 'Saved revision changed. Reload the saved record before requesting performance.' : 'Performance unavailable. Recorded holdings are unchanged.')
      if (!body || body.savedId !== record.id || body.revision !== record.revision || body.source !== 'Theta EOD' || body.range?.start !== captured.start || body.range?.end !== captured.end) throw new Error('Performance response does not match the requested saved revision and dates.')
      const checked = readPositionPerformance(body.performance, position, captured)
      setResult(checked); setSelected(checked.rows.length - 1)
    } catch (cause) { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Performance unavailable.') }
    finally { if (!controller.signal.aborted) setPending(false) }
  }
  const row = result?.rows[selected]
  return <section aria-label="Saved position performance"><details><summary>Historical position P/L</summary>
    <p>Saved revision {record.revision} · dated executions, closes and rolls, restated using this revision’s corrections. This is position P/L, not fixed-current-inventory price history.</p>
    <form onSubmit={event => { event.preventDefault(); void load() }}>
      <label>From date<input aria-label="Performance start date" type="date" required max={range.end || latest} value={range.start} onChange={event => change('start', event.target.value)} /></label>
      <label>Through date<input aria-label="Performance end date" type="date" required min={range.start} max={latest} value={range.end} onChange={event => change('end', event.target.value)} /></label>
      <button type="submit" disabled={!valid || pending}>Load position performance</button>
    </form>
    <p>Choose 1–31 complete New York calendar dates and at most 64 held identities across the range. No percentage return is calculated: a capital denominator has not been defined.</p>
    {!position && <p role="status">Performance requires valid saved listed holdings and recorded entry costs. Sample or unsupported records are unavailable.</p>}
    {pending && <p role="status">Loading recorded-position history…</p>}{error && <p role="alert">{error}</p>}
    {result && <>
      <p>{result.basis}</p>
      <p>Observed daily net high: {result.high ? `${money(result.high.value)} on ${result.high.date}` : 'Unavailable'} · low: {result.low ? `${money(result.low.value)} on ${result.low.date}` : 'Unavailable'}. These are not intraday highs/lows.</p>
      <HistoryCharts key={`${result.range.start}:${result.range.end}`} performanceLabel="Net position P/L" rows={result.rows.map(item => ({ label: item.date, value: item.combinedPnl, underlying: null }))} selected={selected} onInspect={setSelected} />
      {row && <section aria-label="Selected performance accounting"><h3>{row.date} · {row.status}</h3>
        <p>Accounting cutoff {row.cutoff} (17:15 America/New_York). This is not a quote timestamp or the 16:00 market close.</p>
        <dl><dt>Gross realized P/L</dt><dd>{money(row.grossRealizedPnl)}</dd><dt>Remaining unrealized P/L</dt><dd>{money(row.unrealizedPnl)}</dd><dt>Position allowance · deducted once</dt><dd>{row.status === 'not-started' ? 'Not yet applicable' : money(row.allowance)}</dd><dt>Net position P/L</dt><dd>{money(row.combinedPnl)}</dd><dt>Daily change · USD</dt><dd>{money(row.changeUsd)}</dd></dl>
        <p>Daily change requires adjacent complete calendar observations; gaps and the first date have no daily change. Closed positions need no remaining marks. Unrecorded expiry settlement is never inferred.</p>
        <details><summary>Recorded lots and raw report times</summary><p>Report creation and last-trade fields are preserved as supplied, without treating them as UTC or bid/ask timestamps. Quote age is unknown; marks are unsynchronized and may precede same-day executions.</p>
          {!row.lots.length && <p>{row.status === 'closed' ? 'No remaining holdings to mark.' : 'No holdings at this cutoff.'}</p>}
          <ul>{row.lots.map(lot => <li key={lot.id}><strong>{lot.id} · {lot.asset.kind === 'stock' ? `${lot.asset.symbol} shares` : lot.asset.contractId}</strong><p>{lot.side} · {lot.quantity} units · entry {money(lot.entryPrice)} · unrealized {money(lot.unrealizedPnl)}</p>{lot.mark ? <p>Bid {money(lot.mark.bid)} · ask {money(lot.mark.ask)} · midpoint {money(lot.mark.mid)}<br />Report created (raw): {lot.mark.created}<br />Last trade (raw): {lot.mark.lastTrade}</p> : <p>{lot.asset.kind === 'option' && Date.parse(lot.asset.expiry) <= Date.parse(row.cutoff) ? 'Expired holding without recorded settlement; valuation unavailable.' : 'No admissible dated mark; valuation unavailable.'}</p>}</li>)}</ul>
        </details>
      </section>}
      {row && position && <PerformanceDiscussion key={`${record.id}:${record.revision}:${range.start}:${range.end}:${row.date}`} record={record} position={position} range={range} selectedDate={row.date} onRefresh={setResult} />}
    </>}
  </details></section>
}
