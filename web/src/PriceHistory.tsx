import { useEffect, useMemo, useRef, useState } from 'react'
import { HistoryCharts } from './HistoryCharts'
import { buildPriceHistory, historyPriceScale, historyToday, readPriceHistory, type HistoricalMark } from './price-history'
import { buildIntradayHistory, readIntradayHistory, buildIvHistory, readIvHistory, buildIvDiscussionFacts } from './intraday-history'
import type { StrategyState } from './options'
import type { ConversationMessage, LotDiscussionReply } from './sparring'

const dateOffset = (date: string, days: number) => new Date(Date.parse(date) + days * 86400000).toISOString().slice(0, 10)
const dollars = (value: number) => value.toLocaleString('en-US', { style: 'currency', currency: 'USD' })

function HistoryDiscussion(props: { state: StrategyState } & ({ iv?: false; intraday?: false; range: { start: string; end: string }; history: ReturnType<typeof buildPriceHistory>; selectedDate: string } | { iv?: false; intraday: true; range: { start: number; end: number }; history: ReturnType<typeof buildIntradayHistory>; selectedTime: number } | { iv: true; intraday: true; range: { start: number; end: number }; history: ReturnType<typeof buildIvHistory>; selectedTime: number; contractId: string })) {
  const { state, range, history } = props
  const selection = props.iv ? { selectedTime: props.selectedTime, contractId: props.contractId } : props.intraday ? { selectedTime: props.selectedTime } : { selectedDate: props.selectedDate }
  const selectedLabel = props.intraday ? new Date(props.selectedTime).toISOString() : props.selectedDate
  const rangeLabel = props.intraday ? `${new Date(props.range.start).toISOString()} through ${new Date(props.range.end).toISOString()} (end exclusive)` : `${props.range.start} through ${props.range.end}`
  const [question, setQuestion] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false)
  const [turns, setTurns] = useState<{ question: string; reply: LotDiscussionReply }[]>([])
  const [conversation, setConversation] = useState<ConversationMessage[]>([])
  const pending = useRef<AbortController | null>(null), generation = useRef(0)
  useEffect(() => () => { generation.current++; pending.current?.abort() }, [])
  async function discuss() {
    if (busy) return
    const content = question.trim(), messages: ConversationMessage[] = [...conversation, { role: 'user', content }]
    if (!content || messages.length > 12 || messages.reduce((total, message) => total + message.content.length, 0) > 12000) { setError('Enter a question within the 12-message / 12,000-character limit. Start a new discussion if full; your question has not been sent.'); return }
    const sequence = ++generation.current, controller = new AbortController(), requestId = crypto.randomUUID()
    pending.current = controller
    const timer = setTimeout(() => controller.abort(), 90000)
    setBusy(true); setError('')
    try {
      const response = await fetch(props.iv ? '/api/intraday-history/iv-discuss' : props.intraday ? '/api/intraday-history/discuss' : '/api/price-history/discuss', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-ARGUS-Request': '1' }, signal: controller.signal, body: JSON.stringify({ state, range, ...selection, request_id: requestId, conversation: messages }) })
      const body = await response.json() as { request_id?: string; selectedDate?: string; selectedTime?: number; contractId?: string; reply?: LotDiscussionReply; error?: { code?: string }; history?: unknown; range?: unknown; snapshotId?: unknown; positionVersion?: unknown }
      if (sequence !== generation.current) return
      if (controller.signal.aborted) throw new Error('Discussion timed out.')
      if (!response.ok) throw new Error(body.error?.code === 'snapshot_expired' ? 'The pricing snapshot expired. Close history and refresh workspace quotes before discussing again.' : body.error?.code === 'rate_limited' ? 'Request limit reached. Try again later.' : 'History discussion unavailable. Your question and position have not changed.')
      try {
        const loaded = props.iv ? readIvHistory({ history: body.history, range: body.range, snapshotId: body.snapshotId, positionVersion: body.positionVersion }, state, props.range) : props.intraday ? readIntradayHistory({ history: body.history, range: body.range, snapshotId: body.snapshotId, positionVersion: body.positionVersion }, state, props.range) : readPriceHistory(body, state, props.range)
        if (body.request_id !== requestId || (props.iv && body.contractId !== props.contractId) || (props.intraday ? body.selectedTime !== props.selectedTime : body.selectedDate !== props.selectedDate) || JSON.stringify(loaded) !== JSON.stringify(history)) throw new Error('Historical observations changed')
      } catch { throw new Error(`Historical ${props.iv ? 'IV observations' : 'prices'} or discussion identity changed. Reply discarded; reload history before discussing again.`) }
      const reply = body.reply
      if (!reply || Object.keys(reply).sort().join() !== 'assumptions,objections,suggested_prompts,text' || typeof reply.text !== 'string' || !reply.text.trim() || !(['assumptions', 'objections', 'suggested_prompts'] as const).every(key => Array.isArray(reply[key]) && reply[key].every(item => typeof item === 'string'))) throw new Error('Invalid read-only discussion reply. Your question has been kept.')
      setTurns(previous => [...previous, { question: content, reply }]); setQuestion('')
      setConversation([...messages, { role: 'assistant', content: [reply.text, ...reply.assumptions, ...reply.objections, ...reply.suggested_prompts].join('\n') }])
    } catch (cause) {
      if (sequence === generation.current) setError(controller.signal.aborted ? 'Discussion timed out. Your question has been kept; try again later.' : cause instanceof Error ? cause.message : 'Discussion unavailable.')
    } finally { clearTimeout(timer); if (sequence === generation.current) setBusy(false) }
  }
  return <section aria-label="Read-only history discussion"><h3>{props.iv ? 'Discuss this contract’s IV' : 'Discuss this history'}</h3><p className="history-basis">{props.iv && <>{props.contractId} · </>}Selected {selectedLabel} · {rangeLabel}. {props.iv ? 'The server reloads option trade-candle IV before answering. Bucket timestamps are not exact observation times. Missing values stay missing; changes are percentage points, not IV rank or forecasts.' : <>The server reloads {props.intraday ? 'option midpoint and underlying last-trade candle closes' : 'the dated quotes'} before answering. These are current-inventory values, not past holdings or P/L.</>} AI interpretation may contain errors. Changing the inspected {props.iv ? 'contract or interval' : props.intraday ? 'interval' : 'date'} or reloading starts a new discussion; no positions or orders are changed.</p>
    {turns.map((turn, index) => <article key={index}><h4>{turn.question}</h4><p style={{ whiteSpace: 'pre-wrap' }}>{turn.reply.text}</p>{(['assumptions', 'objections'] as const).map(key => turn.reply[key].length > 0 && <div key={key}><h4>{key === 'assumptions' ? 'Assumptions' : 'Objections'}</h4><ul>{turn.reply[key].map((text, index) => <li key={index}>{text}</li>)}</ul></div>)}{turn.reply.suggested_prompts.map((prompt, index) => <button type="button" key={index} disabled={busy} onClick={() => setQuestion(prompt)}>{prompt}</button>)}</article>)}
    <form className="history-range" onSubmit={event => { event.preventDefault(); void discuss() }}><label>Question<input aria-label="History question" value={question} maxLength={12000} disabled={busy} onChange={event => setQuestion(event.target.value)} /></label><button type="submit" disabled={busy || !question.trim()}>Discuss history</button><button type="button" disabled={busy || !turns.length} onClick={() => { setTurns([]); setConversation([]); setError('') }}>Start new discussion</button></form>
    {busy && <p role="status">Reloading historical {props.iv ? 'IV and reviewing the selected contract and interval' : props.intraday ? 'candle closes and reviewing the selected interval' : 'quotes and reviewing the selected date'}…</p>}{error && <p role="alert">{error}</p>}
  </section>
}

export function PriceHistory({ state, onClose }: { state: StrategyState; onClose: () => void }) {
  const [captured] = useState(() => structuredClone(state))
  const [lastDate] = useState(() => [dateOffset(historyToday(), -1), ...captured.legs.map(leg => leg.expiry.slice(0, 10))].sort()[0])
  const [range, setRange] = useState({ start: dateOffset(lastDate, -6), end: lastDate })
  const [history, setHistory] = useState<ReturnType<typeof buildPriceHistory> | null>(null)
  const [resolution, setResolution] = useState('daily'), [day, setDay] = useState(lastDate)
  const intraday = resolution !== 'daily', iv = resolution === 'iv'
  const [ivHistory, setIvHistory] = useState<ReturnType<typeof buildIvHistory> | null>(null)
  const [ivLeg, setIvLeg] = useState(0)
  const [span, setSpan] = useState(1)
  const [intradayHistory, setIntradayHistory] = useState<ReturnType<typeof buildIntradayHistory> | null>(null)
  const [intradayRange, setIntradayRange] = useState({ start: 0, end: 0 })
  const [selected, setSelected] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const dialog = useRef<HTMLDialogElement>(null)
  const generation = useRef(0), active = useRef<AbortController | null>(null)
  const stale = JSON.stringify(state) !== JSON.stringify(captured)
  const dismiss = () => { dialog.current?.close(); onClose() }
  useEffect(() => {
    const node = dialog.current
    node?.showModal()
    const sequence = generation.current
    queueMicrotask(() => { if (generation.current === sequence) void load() })
    return () => { generation.current++; active.current?.abort(); node?.close() }
  }, [])
  useEffect(() => {
    if (stale) { generation.current++; active.current?.abort(); setHistory(null); setIntradayHistory(null); setIvHistory(null); setBusy(false) }
  }, [stale])
  function resetHistory() {
    generation.current++; active.current?.abort(); setHistory(null); setIntradayHistory(null); setIvHistory(null); setBusy(false); setSelected(0); setError('')
  }
  function changeRange(key: 'start' | 'end', value: string) {
    resetHistory()
    setRange(previous => ({ ...previous, [key]: value }))
  }
  async function load(requestedRange = range) {
    if (busy || stale) return
    let bucketRange = { start: 0, end: 0 }
    try {
      if (intraday) {
        const last = Date.parse(`${day}T00:00:00Z`)
        if (!Number.isFinite(last) || new Date(last).toISOString().slice(0, 10) !== day) throw new Error()
        bucketRange = { start: last - (span - 1) * 86400000, end: Math.min(last + 86400000, Math.floor(Date.now() / 300000) * 300000, ...captured.legs.map(leg => Date.parse(leg.expiry))) }
        buildIntradayHistory(captured, bucketRange)
      } else buildPriceHistory(captured, captured.legs.map(() => ({ response: [] })), { response: [] }, requestedRange)
    }
    catch { setHistory(null); setIntradayHistory(null); setIvHistory(null); setError(intraday ? 'Choose a UTC day with completed five-minute intervals, no later than first expiry.' : 'Choose 1–31 complete calendar dates, ending no later than the first expiry.'); return }
    const sequence = ++generation.current, controller = new AbortController()
    active.current?.abort(); active.current = controller
    const timer = setTimeout(() => controller.abort(), intraday ? 50000 : 40000)
    setBusy(true); setError(''); setHistory(null); setIntradayHistory(null); setIvHistory(null)
    if (!intraday) setRange(requestedRange)
    try {
      const response = await fetch(iv ? '/api/intraday-history/iv' : intraday ? '/api/intraday-history' : '/api/price-history', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-ARGUS-Request': '1' }, body: JSON.stringify({ state: captured, range: intraday ? bucketRange : requestedRange }), signal: controller.signal })
      const body = await response.json() as { error?: { code?: string } }
      if (sequence !== generation.current) return
      if (controller.signal.aborted) throw new Error('History request timed out.')
      if (!response.ok) throw new Error(body.error?.code === 'snapshot_expired' ? 'The pricing snapshot expired. Close history and refresh workspace quotes, then try again.' : body.error?.code === 'history_local_only' ? 'History is currently local-only; the hosted relay is not configured.' : body.error?.code === 'rate_limited' ? 'Request limit reached. Try again later.' : 'History unavailable or the terminal is busy. Try again; no prices have been substituted.')
      if (iv) {
        const result = readIvHistory(body, captured, bucketRange)
        setIvHistory(result); setIntradayRange(bucketRange)
        setSelected(result.rows.reduce((last, row, index) => row.legs.some(leg => leg.iv !== null) ? index : last, 0))
      } else if (intraday) {
        const result = readIntradayHistory(body, captured, bucketRange)
        setIntradayHistory(result)
        setIntradayRange(bucketRange)
        setSelected(result.rows.reduce((last, row, index) => row.value !== null ? index : last, 0))
      } else {
        const result = readPriceHistory(body, captured, requestedRange)
        setHistory(result)
        setSelected(result.rows.reduce((last, row, index) => row.value || row.underlying ? index : last, 0))
      }
    } catch (cause) {
      if (sequence === generation.current) setError(controller.signal.aborted ? 'History request timed out. Try again later.' : cause instanceof Error ? cause.message : 'History unavailable.')
    } finally { clearTimeout(timer); if (sequence === generation.current) setBusy(false) }
  }
  const current = !stale ? history?.rows[selected] : undefined
  const bucket = !stale ? intradayHistory?.rows[selected] : undefined
  const ivFacts = useMemo(() => !stale && ivHistory ? buildIvDiscussionFacts(captured, intradayRange, ivHistory, captured.legs[ivLeg].contractId, ivHistory.rows[selected].time) : null, [stale, ivHistory, captured, intradayRange, ivLeg, selected])
  const ivObservation = (row: { time: string; iv: number | null } | null) => row && row.iv !== null ? `${(row.iv * 100).toFixed(2)}% · ${row.time.slice(0, 16).replace('T', ' ')} UTC` : 'Unavailable'
  const ivChange = (value: number | null) => value === null ? 'Unavailable' : `${value > 0 ? '+' : ''}${value.toFixed(2)} percentage points`
  const timeLabel = (time: number) => `${new Date(time).toISOString().slice(0, 16).replace('T', ' ')} UTC`
  const quoteRow = (label: string, mark: HistoricalMark | null) => <tr key={label}><th scope="row">{label}</th><td>{mark ? `${dollars(mark.bid)} / ${dollars(mark.ask)}` : 'Not available'}</td><td>{mark?.created ?? '—'}</td><td>{mark?.lastTrade ?? '—'}</td></tr>
  return <dialog ref={dialog} className="lifecycle-dialog history-dialog" aria-label="Historical pricing" onCancel={event => { event.preventDefault(); dismiss() }}>
    <header><div><h2>Historical pricing</h2><small>{captured.underlying} · {captured.name} · current quantities</small></div><button type="button" autoFocus onClick={dismiss}>Close history</button></header>
    {!intraday && <div className="segmented" role="group" aria-label="Load daily history range">{[7, 14, 31].map(days => {
      const start = dateOffset(lastDate, 1 - days), active = range.start === start && range.end === lastDate
      return <button key={days} type="button" className={active ? 'active' : ''} aria-pressed={active} disabled={busy || stale} onClick={() => void load({ start, end: lastDate })}>{days} days</button>
    })}</div>}
    <form className="history-range" onSubmit={event => { event.preventDefault(); void load() }}>
      <label>View<select aria-label="History resolution" value={resolution} disabled={stale} onChange={event => { resetHistory(); setResolution(event.target.value) }}><option value="daily">Daily EOD</option><option value="intraday">Intraday · 5 minutes</option><option value="iv">Historical IV · 5 minutes</option></select></label>
      {intraday ? <><label>Span<select aria-label="Intraday span" value={span} disabled={stale} onChange={event => { resetHistory(); setSpan(Number(event.target.value)) }}><option value={1}>1 day</option><option value={7}>7 days</option></select></label><label>Through · UTC<input type="date" aria-label="Intraday date UTC" value={day} max={[new Date().toISOString().slice(0, 10), ...captured.legs.map(leg => leg.expiry.slice(0, 10))].sort()[0]} disabled={stale} onChange={event => { resetHistory(); setDay(event.target.value) }} /></label></> : <>
      <label>From<input type="date" aria-label="History start date" value={range.start} max={range.end || lastDate} onChange={event => changeRange('start', event.target.value)} disabled={stale} /></label>
      <label>Through<input type="date" aria-label="History end date" value={range.end} min={range.start} max={lastDate} onChange={event => changeRange('end', event.target.value)} disabled={stale} /></label>
      </>}
      <button disabled={busy || stale}>{busy ? 'Loading history…' : 'Load history'}</button>
    </form>
    <p className="history-basis">{iv ? 'Tastytrade DXLink · historical IV for each listed option, from trade candles—not midpoint candles or aggregate underlying IV. Completed five-minute buckets, UTC. No portfolio-average IV, IV rank or forecast is implied.' : intraday ? `Tastytrade DXLink · five-minute option midpoint closes${captured.stock ? ' + stock last-trade closes' : '; underlying last trade is reference only'}. UTC calendar span, completed intervals only. Reload to include newly completed intervals. Not synchronized or executable prices.` : 'Theta EOD · daily midpoint estimates for the current inventory, not past holdings or P/L. Quote-side intervals are not executable package prices.'} No model substitution or forward filling.</p>
    {stale && <p role="alert">Position changed. Close and reopen history to inspect the new inventory.</p>}
    {error && <p role="alert">{error}</p>}
    {busy && <p role="status">{intraday ? 'Loading completed intervals from the shared market feed…' : 'Loading paced requests from the local terminal…'}</p>}
    {!history && !intradayHistory && !ivHistory && !busy && !error && !stale && <p>{iv ? 'Choose a span and its last UTC day, then load IV observations. Missing intervals remain gaps.' : intraday ? 'Choose a span and its last UTC day. Both charts share one inspector; missing intervals remain gaps. Older or larger source snapshots may be unavailable.' : 'Choose a period and load historical prices. Up to 31 calendar dates; missing dates remain gaps, including non-trading days.'}</p>}
    {ivHistory && !stale && <>
      <label className="history-inspector">Option contract<select aria-label="Historical IV contract" value={ivLeg} onChange={event => setIvLeg(Number(event.target.value))}>{captured.legs.map((leg, i) => <option key={leg.contractId} value={i}>{leg.expiry.slice(0, 10)} · {leg.strike} {leg.type} · {leg.side}</option>)}</select></label>
      <HistoryCharts key={`iv-${ivLeg}`} rows={ivHistory.rows.map(row => ({ label: timeLabel(row.time), value: row.legs[ivLeg].iv, underlying: null }))} intraday ivLabel={captured.legs[ivLeg].contractId} selected={selected} onInspect={setSelected} />
      <p className="history-basis">{ivHistory.rows.filter(row => row.legs[ivLeg].iv !== null).length} reported IV intervals / {ivHistory.rows.length} requested · {timeLabel(intradayRange.start)} through {timeLabel(intradayRange.end)} (end exclusive). Changing contract resets chart zoom, not the selected interval.</p>
      {ivFacts && <details className="history-quotes"><summary>IV history facts · calculated, not AI estimates</summary>
        <p className="history-basis">Whole requested range, including observations after the selected interval. Changes use unrounded observations; displayed values are rounded. Equal extrema use their earliest reported bucket. Descriptive changes are not IV rank, causal explanations or forecasts.</p>
        <dl aria-label="Calculated historical IV facts">
          <dt>First reported</dt><dd>{ivObservation(ivFacts.summary.first)}</dd>
          <dt>Last reported</dt><dd>{ivObservation(ivFacts.summary.last)}</dd>
          <dt>Lowest reported</dt><dd>{ivObservation(ivFacts.summary.minimum)}</dd>
          <dt>Highest reported</dt><dd>{ivObservation(ivFacts.summary.maximum)}</dd>
          <dt>First-to-last change · whole range</dt><dd>{ivChange(ivFacts.summary.changePercentagePoints)}</dd>
          <dt>Previous reported · before selected interval</dt><dd>{ivObservation(ivFacts.previousReported)}</dd>
          <dt>Selected change from previous reported</dt><dd>{ivChange(ivFacts.selectedChangePercentagePoints)}</dd>
        </dl>
      </details>}
      <HistoryDiscussion key={JSON.stringify([ivLeg, selected, ivHistory])} iv intraday state={captured} range={intradayRange} history={ivHistory} contractId={captured.legs[ivLeg].contractId!} selectedTime={ivHistory.rows[selected].time} />
    </>}
    {history && !stale && <>
      <HistoryCharts rows={history.rows.map(row => ({ label: row.date, value: row.value?.mid ?? null, underlying: row.underlying?.mid ?? null, ...(row.value ? { envelope: { low: row.value.bidSide, high: row.value.askSide } } : {}) }))} selected={selected} onInspect={setSelected} priceScale={historyPriceScale(captured)} />
      <p className="history-basis">{history.rows.filter(row => row.value !== null).length} complete strategy dates / {history.rows.length} requested calendar dates. Report timestamps are timezone-less provider strings, not synchronized quote times; last trades may be older.</p>
      {current && <details className="history-quotes"><summary>Quotes and report times · {current.date}</summary><div className="leg-risk-scroll" role="region" aria-label="Historical quote details" tabIndex={0}><table><thead><tr><th scope="col">Constituent</th><th scope="col">Bid / ask per share</th><th scope="col">Report created · provider time</th><th scope="col">Last trade · provider time</th></tr></thead><tbody>{current.legs.map((leg, i) => quoteRow(`${captured.legs[i].side} ${captured.legs[i].contracts} × ${leg.contractId}`, leg.mark))}{quoteRow(`${captured.underlying}${captured.stock ? ` · ${captured.stock.shares} shares` : ' · reference only'}`, current.underlying)}</tbody></table></div></details>}
      {current && <HistoryDiscussion key={JSON.stringify([current.date, history])} state={captured} range={range} history={history} selectedDate={current.date} />}
    </>}
    {intradayHistory && !stale && <>
      <HistoryCharts rows={intradayHistory.rows.map(row => ({ label: timeLabel(row.time), value: row.value, underlying: row.underlying }))} intraday stockTrades={!!captured.stock} selected={selected} onInspect={setSelected} priceScale={historyPriceScale(captured)} />
      <p className="history-basis">{intradayHistory.rows.filter(row => row.value !== null).length} complete strategy intervals / {intradayHistory.rows.length} requested · {timeLabel(intradayRange.start)} through {timeLabel(intradayRange.end)} (end exclusive). Constituent closes may occur at different instants within a bucket. Current inventory, not past holdings or P/L.</p>
      {bucket && <HistoryDiscussion key={JSON.stringify([bucket.time, intradayHistory])} intraday state={captured} range={intradayRange} history={intradayHistory} selectedTime={bucket.time} />}
      {bucket && <details className="history-quotes"><summary>Constituent closes · {timeLabel(bucket.time)}–{timeLabel(bucket.time + 300000)}</summary><div className="leg-risk-scroll" role="region" aria-label="Intraday constituent details" tabIndex={0}><table><thead><tr><th scope="col">Constituent</th><th scope="col">Price basis</th><th scope="col">Close per share</th></tr></thead><tbody>{bucket.legs.map((leg, i) => <tr key={leg.contractId}><th scope="row">{captured.legs[i].side} {captured.legs[i].contracts} × {leg.contractId}</th><td>Option midpoint</td><td>{leg.close === null ? 'Not available' : dollars(leg.close)}</td></tr>)}<tr><th scope="row">{captured.underlying} · {captured.stock ? `${captured.stock.shares} shares` : 'reference only'}</th><td>Last trade</td><td>{bucket.underlying === null ? 'Not available' : dollars(bucket.underlying)}</td></tr></tbody></table></div></details>}
    </>}
  </dialog>
}
