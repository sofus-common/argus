import { useEffect, useRef, useState } from 'react'
import type { SavedStrategy } from './saved-strategies'
import { validateStrategy, type StrategyState } from './options'
import type { CloseRequest, CloseVoid, PriceCorrection, PositionRecord, projectPosition, valuePosition } from './position-lifecycle'

type Projection = ReturnType<typeof projectPosition>
type Lifecycle = { record: SavedStrategy<PositionRecord>; projection: Projection }
const money = (value: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value)
const exactPrice = (value: number) => `$${value}`

export function PositionLifecycle({ savedId, snapshotId, onClose, onRecorded, onAnalyze }: { savedId: string; snapshotId?: string; onClose: () => void; onRecorded: () => Promise<void>; onAnalyze: (state: StrategyState, snapshotId: string) => boolean }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [current, setCurrent] = useState<Lifecycle | null>(null)
  const [assetId, setAssetId] = useState('')
  const [quantity, setQuantity] = useState('')
  const [price, setPrice] = useState('')
  const [at, setAt] = useState('')
  const [review, setReview] = useState<{ revision: number; close: CloseRequest; projection: Projection } | null>(null)
  const [correctionReview, setCorrectionReview] = useState<{ revision: number; correction: PriceCorrection; projection: Projection } | null>(null)
  const [closeId, setCloseId] = useState('')
  const [correctedPrice, setCorrectedPrice] = useState('')
  const [reason, setReason] = useState('')
  const [voidReview, setVoidReview] = useState<{ revision: number; void: CloseVoid; projection: Projection } | null>(null)
  const [voidCloseId, setVoidCloseId] = useState('')
  const [voidReason, setVoidReason] = useState('')
  const [positionAction, setPositionAction] = useState<'close' | 'correction' | 'void'>('close')
  const reviewing = !!review || !!correctionReview || !!voidReview
  const [busy, setBusy] = useState(false)
  const [uncertain, setUncertain] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [basis, setBasis] = useState<'mid' | 'natural'>('mid')
  const [valued, setValued] = useState<{ revision: number; valuation: ReturnType<typeof valuePosition> } | null>(null)
  const valuationRequest = useRef(0)
  const valuationSource = useRef({ savedId, snapshotId, basis, revision: current?.record.revision })
  valuationSource.current = { savedId, snapshotId, basis, revision: current?.record.revision }
  const invalidateValuation = () => { valuationRequest.current++; setValued(null) }
  useEffect(() => { invalidateValuation() }, [snapshotId, basis])
  const endpoint = `/api/strategies/${encodeURIComponent(savedId)}`
  const dismiss = () => { dialog.current?.close(); onClose() }
  const headers = { 'Content-Type': 'application/json', 'X-ARGUS-Request': '1' }
  const load = async (signal?: AbortSignal) => {
    invalidateValuation()
    setBusy(true); setError('')
    try {
      const response = await fetch(`${endpoint}/lifecycle`, { signal })
      const body = await response.json() as Lifecycle & { error?: { message?: string } }
      if (!response.ok) throw new Error(body.error?.message ?? 'Lifecycle unavailable. For estimated market entries, keep held entry costs and save first.')
      setCurrent(body as Lifecycle)
      if (voidReview && uncertain) {
        const request = voidReview.void
        const matched = body.record.lifecycle?.closeVoids?.some(event => event.id === request.id && event.closeId === request.closeId && event.reason === request.reason && event.recordedAt === request.recordedAt)
        if (matched) { setNotice('The close void was recorded. Inventory and audit history are reloaded.'); setVoidReview(null); setUncertain(false) }
        else setNotice('The close void is not confirmed in this reload. It may still be processing. Retry the identical void; new edits remain locked.')
      } else if (correctionReview && uncertain) {
        const request = correctionReview.correction
        const matched = body.record.lifecycle?.priceCorrections?.some(event => event.id === request.id && event.closeId === request.closeId && event.price === request.price && event.reason === request.reason && event.recordedAt === request.recordedAt)
        if (matched) { setNotice('The price correction was recorded. Totals and audit history are reloaded.'); setCorrectionReview(null); setUncertain(false) }
        else setNotice('The price correction is not confirmed in this reload. It may still be processing. Retry the identical correction; new edits remain locked.')
      } else if (review && uncertain) {
        const matched = body.record.lifecycle?.closes.some((close: CloseRequest) => close.id === review.close.id && close.assetId === review.close.assetId && close.quantity === review.close.quantity && close.price === review.close.price && close.at === review.close.at)
        if (matched) { setNotice('The close was recorded. Inventory below is reloaded.'); setReview(null); setUncertain(false) }
        else setNotice('The close is not confirmed in this reload. It may still be processing. Retry the identical close; new edits remain locked.')
      } else { setReview(null); setCorrectionReview(null); setVoidReview(null) }
    } catch (cause) {
      if (!signal?.aborted) setError(cause instanceof Error ? cause.message : 'Saved lifecycle unavailable.')
    } finally { if (!signal?.aborted) setBusy(false) }
  }
  useEffect(() => {
    dialog.current?.showModal()
    const controller = new AbortController()
    void load(controller.signal)
    return () => { controller.abort(); valuationRequest.current++ }
  }, [])
  const assets = [
    ...(current?.projection.active?.legs ?? []).map(leg => ({ id: `option:${leg.id}`, label: `${leg.side} ${leg.type} ${leg.strike} · ${leg.expiry.slice(0, 10)}`, quantity: leg.contracts, unit: 'contracts', entry: leg.entryPrice })),
    ...(current?.projection.stock ? [{ id: 'stock', label: `${current.projection.stock.shares > 0 ? 'Long' : 'Short'} ${current.record.state.underlying} shares`, quantity: Math.abs(current.projection.stock.shares), unit: 'shares', entry: current.projection.stock.entryPrice }] : []),
  ]
  const selected = assets.find(asset => asset.id === assetId)
  const preview = async () => {
    if (!current) return
    invalidateValuation()
    setBusy(true); setError(''); setNotice(''); setReview(null)
    try {
      const date = new Date(at.endsWith('Z') ? at : `${at}Z`)
      if (!at || !Number.isFinite(date.getTime())) throw new Error('Enter a valid UTC close date and time.')
      const close: CloseRequest = { id: crypto.randomUUID(), assetId, quantity: Number(quantity), price: Number(price), at: date.toISOString() }
      const response = await fetch(`${endpoint}/closes/preview`, { method: 'POST', headers, body: JSON.stringify({ revision: current.record.revision, close }) })
      const body = await response.json() as { revision: number; projection: Projection; error?: { message?: string } }
      if (!response.ok) throw new Error(body.error?.message ?? 'Close preview unavailable. Reload if the saved revision changed.')
      if (body.revision !== current.record.revision) throw new Error('Saved revision changed. Reload before recording a close.')
      setReview({ revision: body.revision, close, projection: body.projection })
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Close preview unavailable.') }
    finally { setBusy(false) }
  }
  const confirm = async () => {
    if (!review && !correctionReview && !voidReview) return
    invalidateValuation()
    setBusy(true); setError(''); setNotice('')
    try {
      const response = await fetch(`${endpoint}/${voidReview ? 'close-voids' : correctionReview ? 'price-corrections' : 'closes'}`, { method: 'POST', headers, body: JSON.stringify(voidReview ? { revision: voidReview.revision, void: voidReview.void } : correctionReview ? { revision: correctionReview.revision, correction: correctionReview.correction } : { revision: review!.revision, close: review!.close }) })
      const body = await response.json() as Lifecycle & { error?: { message?: string } }
      if (!response.ok && response.status >= 400 && response.status < 500 && !uncertain) {
        setUncertain(false); setError(body.error?.message ?? 'Close rejected. Edit the request or reload the saved record before another preview.'); return
      }
      if (!response.ok) throw new Error(body.error?.message ?? 'Recording was not confirmed.')
      setCurrent(body as Lifecycle); setReview(null); setCorrectionReview(null); setVoidReview(null); setUncertain(false); setQuantity(''); setPrice(''); setAt(''); setCorrectedPrice(''); setReason(''); setVoidCloseId(''); setVoidReason('')
      setNotice(`${voidReview ? 'Close void' : correctionReview ? 'Price correction' : 'Close'} recorded. The strategy builder has not changed.`)
      try { await onRecorded() } catch { setNotice('Close recorded. Saved-position list could not refresh; reload the list before another saved-workspace action.') }
    } catch (cause) {
      setUncertain(true)
      setError(`${cause instanceof Error ? cause.message : 'Recording was not confirmed.'} Do not enter another event. Retry this identical request or reload the saved record to resolve it.`)
    } finally { setBusy(false) }
  }
  const previewCorrection = async () => {
    if (!current || reviewing || uncertain || busy) return
    invalidateValuation(); setBusy(true); setError(''); setNotice('')
    try {
      const correction: PriceCorrection = { id: crypto.randomUUID(), closeId, price: Number(correctedPrice), reason: reason.trim(), recordedAt: new Date().toISOString() }
      const response = await fetch(`${endpoint}/price-corrections/preview`, { method: 'POST', headers, body: JSON.stringify({ revision: current.record.revision, correction }) })
      const body = await response.json() as { revision: number; projection: Projection; error?: { message?: string } }
      if (!response.ok) throw new Error(body.error?.message ?? 'Correction preview unavailable. Reload the saved record before trying again.')
      if (body.revision !== current.record.revision) throw new Error('Saved revision changed. Reload before recording a correction.')
      setCorrectionReview({ revision: body.revision, correction, projection: body.projection })
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Correction preview unavailable.') }
    finally { setBusy(false) }
  }
  const previewVoid = async () => {
    if (!current || reviewing || uncertain || busy) return
    invalidateValuation(); setBusy(true); setError(''); setNotice('')
    try {
      const request: CloseVoid = { id: crypto.randomUUID(), closeId: voidCloseId, reason: voidReason.trim(), recordedAt: new Date().toISOString() }
      const response = await fetch(`${endpoint}/close-voids/preview`, { method: 'POST', headers, body: JSON.stringify({ revision: current.record.revision, void: request }) })
      const body = await response.json() as { revision: number; projection: Projection; error?: { message?: string } }
      if (!response.ok) throw new Error(body.error?.message ?? 'Void preview unavailable. Reload the saved record before trying again.')
      if (body.revision !== current.record.revision) throw new Error('Saved revision changed. Reload before voiding a close.')
      setVoidReview({ revision: body.revision, void: request, projection: body.projection })
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Void preview unavailable.') }
    finally { setBusy(false) }
  }
  const valueRemaining = async () => {
    if (!current || !snapshotId || uncertain || reviewing || current.projection.status === 'closed') return
    invalidateValuation()
    const sequence = valuationRequest.current, source = { ...valuationSource.current }
    setBusy(true); setError(''); setNotice('')
    try {
      const response = await fetch(`${endpoint}/valuation`, { method: 'POST', headers, body: JSON.stringify({ revision: source.revision, snapshotId: source.snapshotId, basis: source.basis }) })
      const body = await response.json() as { revision: number; valuation: ReturnType<typeof valuePosition>; error?: { message?: string } }
      const latest = valuationSource.current
      if (sequence !== valuationRequest.current || latest.savedId !== source.savedId || latest.snapshotId !== source.snapshotId || latest.basis !== source.basis || latest.revision !== source.revision) return
      if (!response.ok) throw new Error(body.error?.message ?? 'Remaining holdings cannot be valued from these quotes. Capture or load matching dated quotes after the recorded closes.')
      if (body.revision !== source.revision || body.valuation?.snapshotId !== source.snapshotId || body.valuation.basis !== source.basis) throw new Error('Valuation response does not match the requested saved revision and snapshot.')
      setValued(body)
    } catch (cause) { if (sequence === valuationRequest.current) setError(cause instanceof Error ? cause.message : 'Remaining valuation unavailable.') }
    finally { setBusy(false) }
  }
  const valuation = valued?.revision === current?.record.revision && valued?.valuation.snapshotId === snapshotId && valued?.valuation.basis === basis ? valued.valuation : null
  const correctionTarget = current?.record.lifecycle?.closes.find(close => close.id === correctionReview?.correction.closeId)
  const activeCloses = current?.record.lifecycle?.closes.filter(close => !current.record.lifecycle?.closeVoids?.some(event => event.closeId === close.id)) ?? []
  const voidTarget = current?.record.lifecycle?.closes.find(close => close.id === voidReview?.void.closeId)
  const action = review ? 'close' : correctionReview ? 'correction' : voidReview ? 'void'
    : (positionAction === 'close' && assets.length || positionAction !== 'close' && activeCloses.length) ? positionAction
      : assets.length ? 'close' : activeCloses.length ? 'correction' : null
  const analyze = () => {
    const state = valuation?.remainingState, inventory = current?.projection.active
    const fields = ['id', 'contractId', 'type', 'strike', 'expiry', 'multiplier', 'side', 'contracts', 'entryPrice'] as const
    if (!state || !inventory || busy || uncertain || reviewing) return
    if (validateStrategy(state).length || state.feeAllowance !== 0 || state.pricing?.entryMode !== 'fixed' || state.legs.length !== inventory.legs.length || state.legs.some((leg, index) => fields.some(field => leg[field] !== inventory.legs[index][field])) || JSON.stringify(state.stock ?? null) !== JSON.stringify(inventory.stock ?? null)) { setError('Remaining inventory does not match the recorded position.'); return }
    if (onAnalyze(state, valuation.snapshotId)) dismiss()
    else setError('Remaining holdings could not be opened. Reload matching workspace quotes and value again.')
  }
  const totals = (projection: Projection) => <dl className="lifecycle-totals"><div><dt>Gross realized P/L</dt><dd>{money(projection.grossRealizedPnl)}</dd></div><div><dt>Position allowance · not allocated</dt><dd>{money(projection.allowance)}</dd></div>{projection.netClosedPnl !== null && <div><dt>Fully closed net P/L</dt><dd>{money(projection.netClosedPnl)}</dd></div>}</dl>
  return <dialog ref={dialog} aria-label="Manage recorded closes" className="lifecycle-dialog" onCancel={event => { event.preventDefault(); if (!busy && !uncertain) dismiss() }}>
    <header><div><small>SAVED POSITION · RECORDED CLOSES</small><h2>{current?.record.title ?? 'Manage closes'}</h2><span>{current ? `Revision ${current.record.revision} · ${current.projection.status}` : 'Loading saved position'}</span></div><button disabled={busy || uncertain} onClick={dismiss} aria-label="Close close-management panel">Close</button></header>
    <p>User-recorded closes, not broker-verified fills. Recording closes does not change the strategy builder. Exercise, assignment and settlement are not simulated.</p>
    {busy && <p role="status">Updating close records…</p>}{error && <p className="workspace-error" role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
    <button disabled={busy} onClick={() => void load()}>Reload saved record</button>
    {!current && <p>For estimated market entry costs, choose Keep entry costs in the builder and save before managing closes.</p>}
    {current && <><h3>Remaining inventory</h3>{assets.length ? <table><thead><tr><th>Asset</th><th>Remaining</th><th>Held entry / share</th></tr></thead><tbody>{assets.map(asset => <tr key={asset.id}><td>{asset.label}</td><td>{asset.quantity} {asset.unit}</td><td>{exactPrice(asset.entry)}</td></tr>)}</tbody></table> : <p>No remaining assets. Position fully closed.</p>}{totals(current.projection)}
      {current.projection.status !== 'closed' && <section aria-label="Remaining holdings valuation"><h3>Dated remaining-holdings estimate</h3><p>Use the workspace's captured quotes explicitly. No automatic quote fetch or builder change.</p>{!snapshotId && <p>Capture or load matching workspace quotes before valuing remaining holdings.</p>}<label>Liquidation quote basis<select aria-label="Remaining valuation basis" value={basis} disabled={busy || uncertain || reviewing} onChange={event => setBasis(event.target.value as 'mid' | 'natural')}><option value="mid">Midpoint · estimate</option><option value="natural">Natural liquidation · estimate</option></select></label><button disabled={busy || uncertain || reviewing || !snapshotId} onClick={() => void valueRemaining()}>Value remaining holdings</button>{valuation && <section aria-label="Dated combined P/L"><h3>Dated combined P/L · {money(valuation.combinedPnl)}</h3><p>Recorded realized {money(valuation.grossRealizedPnl)} + remaining unrealized {money(valuation.unrealizedPnl)} − allowance {money(valuation.allowance)} = {money(valuation.combinedPnl)}</p><p>{valuation.basis === 'mid' ? 'Midpoint' : 'Natural liquidation'} quotes · {valuation.historical ? 'Historical snapshot' : 'Dated snapshot'} · {valuation.snapshotId}</p><p>Retrieved {valuation.retrievedAt}<br />Source quotes {valuation.oldestQuoteAt} to {valuation.newestQuoteAt}</p><p>{valuation.disclosure}</p></section>}</section>}
    {valuation?.remainingState && <section><button disabled={busy || uncertain || reviewing} onClick={analyze}>Analyze remaining holdings</button><p>Opens a separate unsaved analysis in the builder. Excludes recorded realized P/L and the original allowance. Undo restores the previous strategy; saved history is unchanged.</p></section>}
      {action && <div className="lifecycle-action"><label>Position action<select aria-label="Position action" value={action} disabled={busy || uncertain || reviewing} onChange={event => setPositionAction(event.target.value as typeof positionAction)}>{(assets.length > 0 || review) && <option value="close">Record a close</option>}{(activeCloses.length > 0 || correctionReview) && <option value="correction">Correct a close price</option>}{(activeCloses.length > 0 || voidReview) && <option value="void">Void an erroneous close</option>}</select></label></div>}
      {action === 'close' && !!assets.length && <form onSubmit={event => { event.preventDefault(); void preview() }}><fieldset disabled={busy || uncertain || reviewing}><legend>Record a close</legend><label>Asset<select aria-label="Close asset" required value={assetId} onChange={event => setAssetId(event.target.value)}><option value="">Choose remaining asset</option>{assets.map(asset => <option key={asset.id} value={asset.id}>{asset.label}</option>)}</select></label><label>Quantity · {selected?.unit ?? 'contracts or shares'}<input aria-label="Close quantity" type="number" min="1" max={selected?.quantity} step="1" required value={quantity} onChange={event => setQuantity(event.target.value)} /></label><label>Recorded price / share<input aria-label="Close price" type="number" min="0" step="any" required value={price} onChange={event => setPrice(event.target.value)} /></label><label>Close date and time · UTC<input aria-label="Close UTC datetime" type="datetime-local" step="1" required value={at} onChange={event => setAt(event.target.value)} /></label><button type="submit">Preview close</button></fieldset></form>}
      {review && <section className="lifecycle-review" aria-label="Close preview"><h3>Review before recording</h3><p>{review.close.quantity} {selected?.unit ?? (review.close.assetId === 'stock' ? 'shares' : 'contracts')} · {selected?.label ?? review.close.assetId} · {exactPrice(review.close.price)} / share · {review.close.at}</p><p>Saved revision {review.revision}. Resulting status: {review.projection.status}.</p>{totals(review.projection)}<button disabled={busy} onClick={() => void confirm()}>{uncertain ? 'Retry identical close' : 'Confirm recorded close'}</button><button disabled={busy || uncertain} onClick={() => setReview(null)}>Edit close</button></section>}
    {action === 'correction' && !!activeCloses.length && <form onSubmit={event => { event.preventDefault(); void previewCorrection() }}><fieldset disabled={busy || uncertain || reviewing}><legend>Correct a recorded close price</legend><p>Appends an audit record. Original quantity, close time and price remain preserved; only the effective close price changes.</p><label>Original close<select aria-label="Correction original close" required value={closeId} onChange={event => setCloseId(event.target.value)}><option value="">Choose recorded close</option>{activeCloses.map(close => <option key={close.id} value={close.id}>{close.assetId} · {close.quantity} · original {exactPrice(close.price)} · {close.at}</option>)}</select></label><label>Corrected price / share<input aria-label="Corrected close price" type="number" min="0" step="any" required value={correctedPrice} onChange={event => setCorrectedPrice(event.target.value)} /></label><label>Reason<input aria-label="Price correction reason" required maxLength={500} value={reason} onChange={event => setReason(event.target.value)} /></label><button type="submit">Preview price correction</button></fieldset></form>}
    {correctionReview && <section className="lifecycle-review" aria-label="Price correction preview"><h3>Review price correction</h3><p>{correctionTarget ? `${correctionTarget.quantity} × ${correctionTarget.contractId} · original ${exactPrice(correctionTarget.price)} / share · ${correctionTarget.at}` : `Original close ${correctionReview.correction.closeId}`}</p><p>New effective price {exactPrice(correctionReview.correction.price)} / share</p><p>{correctionReview.correction.reason} · recorded {correctionReview.correction.recordedAt}</p><p>Saved revision {correctionReview.revision}. Quantity and original close timestamp will not change.</p>{totals(correctionReview.projection)}<button disabled={busy} onClick={() => void confirm()}>{uncertain ? 'Retry identical price correction' : 'Confirm price correction'}</button><button disabled={busy || uncertain} onClick={() => setCorrectionReview(null)}>Edit price correction</button></section>}
    {action === 'void' && !!activeCloses.length && <form onSubmit={event => { event.preventDefault(); void previewVoid() }}><fieldset disabled={busy || uncertain || reviewing}><legend>Void an erroneous close record</legend><p>Corrects a recording mistake only. This does not reverse an actual trade or place an order. Original history is retained.</p><label>Close record<select aria-label="Void original close" required value={voidCloseId} onChange={event => setVoidCloseId(event.target.value)}><option value="">Choose unvoided close</option>{activeCloses.map(close => <option key={close.id} value={close.id}>{close.assetId} · {close.quantity} · {close.at}</option>)}</select></label><label>Reason<input aria-label="Close void reason" required maxLength={500} value={voidReason} onChange={event => setVoidReason(event.target.value)} /></label><button type="submit">Preview close void</button></fieldset></form>}
    {voidReview && <section className="lifecycle-review" aria-label="Close void preview"><h3>Review erroneous close void</h3><p>{voidTarget ? `${voidTarget.quantity} × ${voidTarget.contractId} · original ${exactPrice(voidTarget.price)} / share · ${voidTarget.at}` : `Close ${voidReview.void.closeId}`}</p><p>{voidReview.void.reason} · recorded {voidReview.void.recordedAt}</p><p>Restores recorded inventory only, not a real trade reversal. No order will be placed. Saved revision {voidReview.revision}.</p><ul>{voidReview.projection.active?.legs.map(leg => <li key={leg.id}>{leg.contracts} contracts · {leg.side} {leg.contractId}</li>)}{voidReview.projection.stock && <li>{voidReview.projection.stock.shares} signed shares</li>}</ul>{totals(voidReview.projection)}<button disabled={busy} onClick={() => void confirm()}>{uncertain ? 'Retry identical close void' : 'Void erroneous close'}</button><button disabled={busy || uncertain} onClick={() => setVoidReview(null)}>Edit close void</button></section>}
    </>}
    {current && <details><summary>Recorded closes · {current.record.lifecycle?.closes.length ?? 0}</summary>{current.record.lifecycle?.closes.length ? <ul>{current.record.lifecycle.closes.map(close => {
      const corrections = current.record.lifecycle?.priceCorrections?.filter(event => event.closeId === close.id) ?? []
      return <li key={close.id}>{close.assetId} · {close.contractId} · {close.quantity} {close.assetId === 'stock' ? 'shares' : 'contracts'} · original {exactPrice(close.price)} / share · {close.at}{corrections.length > 0 && <><p>Latest corrected price: {exactPrice(corrections.at(-1)!.price)} / share</p><ul>{corrections.map(event => <li key={event.id}>{exactPrice(event.price)} / share · {event.reason} · recorded {event.recordedAt}</li>)}</ul></>}{current.record.lifecycle?.closeVoids?.filter(event => event.closeId === close.id).map(event => <p key={event.id}>VOIDED · {event.reason} · recorded {event.recordedAt}. This close and its effective price no longer contribute to realized P/L; original and correction history remain preserved.</p>)}</li>
    })}</ul> : <p>No recorded closes.</p>}</details>}
  </dialog>
}
