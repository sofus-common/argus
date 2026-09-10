import { useId, useMemo, useRef, useState, type PointerEvent } from 'react'
import { evaluateScenario, scenarioCurve, type StrategyState } from './options'
import './lab-analysis-chart.css'

const money = (value: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(value)
const dateLabel = (value: string) => new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })

export function LabAnalysisChart({ state, onChange }: { state: StrategyState; onChange: (state: StrategyState) => void }) {
  const [view, setView] = useState<'Curve' | 'Heatmap' | 'Table'>('Curve')
  const [hover, setHover] = useState<number | null>(null)
  const [dragSpot, setDragSpot] = useState<number | null>(null)
  const dragging = useRef(false)
  const id = useId().replace(/:/g, '')
  const data = useMemo(() => {
    const expiry = state.legs.length ? state.legs.map(leg => leg.expiry).sort()[0] : state.scenarioDate
    const min = Math.max(80, Math.min(90, state.scenarioSpot - 3, ...state.legs.map(leg => leg.strike - 3)))
    const max = Math.min(120, Math.max(110, state.scenarioSpot + 3, ...state.legs.map(leg => leg.strike + 3)))
    const expiration = scenarioCurve(state, min, max, 'pnl', Date.parse(expiry)).map(point => ({ spot: point.spot, pnl: point.value }))
    const selected = scenarioCurve(state, min, max, 'pnl', Date.parse(state.scenarioDate)).map(point => ({ spot: point.spot, pnl: point.value }))
    const low = Math.min(0, ...expiration.map(point => point.pnl), ...selected.map(point => point.pnl))
    const high = Math.max(0, ...expiration.map(point => point.pnl), ...selected.map(point => point.pnl))
    const pad = Math.max(20, (high - low) * .12)
    const spots = Array.from({ length: 9 }, (_, index) => min + (max - min) * index / 8)
    const start = Date.parse(state.valuationTimestamp)
    const dates = Array.from({ length: 7 }, (_, index) => new Date(start + (Date.parse(expiry) - start) * index / 6).toISOString())
    return { expiry, min, max, expiration, selected, low: low - pad, high: high + pad, spots, dates }
  }, [state])
  const matrix = useMemo(() => view === 'Heatmap' ? data.dates.map(date => data.spots.map(spot => evaluateScenario({ ...state, scenarioDate: date, scenarioSpot: spot }).pnl)) : [], [view, state, data])
  const table = useMemo(() => view === 'Table' ? data.spots.map(spot => ({ spot, ...evaluateScenario({ ...state, scenarioSpot: spot }), expiryPnl: evaluateScenario({ ...state, scenarioSpot: spot, scenarioDate: data.expiry }).pnl })) : [], [view, state, data])
  const x = (spot: number) => 78 + (spot - data.min) / (data.max - data.min) * 840
  const y = (pnl: number) => 280 - (pnl - data.low) / (data.high - data.low) * 248
  const path = (points: typeof data.selected) => points.map((point, index) => `${index ? 'L' : 'M'}${x(point.spot)},${y(point.pnl)}`).join(' ')
  const target = dragSpot ?? state.scenarioSpot
  const inspected = Math.max(data.min, Math.min(data.max, hover ?? target))
  const inspectedPnl = evaluateScenario({ ...state, scenarioSpot: inspected }).pnl
  const inspectedExpiry = evaluateScenario({ ...state, scenarioSpot: inspected, scenarioDate: data.expiry }).pnl
  function pointerSpot(event: PointerEvent<SVGElement>) {
    const svg = event.currentTarget instanceof SVGSVGElement ? event.currentTarget : event.currentTarget.ownerSVGElement!
    const point = svg.createSVGPoint(); point.x = event.clientX; point.y = event.clientY
    const local = point.matrixTransform(svg.getScreenCTM()!.inverse())
    return Math.round(Math.max(data.min, Math.min(data.max, data.min + (local.x - 78) / 840 * (data.max - data.min))) * 100) / 100
  }
  return <section className="lac" aria-label="Interactive trade analysis">
    <header className="lac-toolbar"><div className="lac-tabs" aria-label="Analysis views">{(['Curve', 'Heatmap', 'Table'] as const).map(name => <button key={name} aria-pressed={view === name} onClick={() => { setView(name); setHover(null) }}>{name}</button>)}</div><span>P/L · USD · entire position</span></header>
    <div className="lac-legend"><span><i />At {state.legs.some(leg => leg.expiry !== data.expiry) ? 'first expiry' : 'expiry'} · {dateLabel(data.expiry)}</span><span><i className="lac-selected-key"/>Selected date · {dateLabel(state.scenarioDate)}</span><small>Synthetic model · costs included</small></div>
    {view === 'Curve' && <>
      <div className="lac-readout" aria-live="off"><span>{hover === null ? 'Selected price' : 'Inspecting'} <strong>${inspected.toFixed(2)}</strong></span><span>Selected-date P/L <strong className={inspectedPnl < 0 ? 'lac-loss' : 'lac-gain'}>{money(inspectedPnl)}</strong></span><span>Expiry P/L <strong className={inspectedExpiry < 0 ? 'lac-loss' : 'lac-gain'}>{money(inspectedExpiry)}</strong></span></div>
      <div className="lac-curve-scroll" role="region" aria-label="Scrollable payoff curves" tabIndex={0}>
      <svg className="lac-curve" viewBox="0 0 960 330" aria-label="Payoff curves with draggable selected price" onPointerMove={event => { const spot = pointerSpot(event); setHover(spot); if (dragging.current) setDragSpot(spot) }} onPointerLeave={() => { if (!dragging.current) setHover(null) }} onPointerUp={event => { if (dragging.current) { dragging.current = false; onChange({ ...state, scenarioSpot: pointerSpot(event) }); setDragSpot(null); setHover(null) } }} onPointerCancel={() => { dragging.current = false; setDragSpot(null); setHover(null) }}>
        <defs><clipPath id={`${id}-gain`}><rect x="78" y="32" width="840" height={y(0) - 32}/></clipPath><clipPath id={`${id}-loss`}><rect x="78" y={y(0)} width="840" height={280 - y(0)}/></clipPath></defs>
        {Array.from({ length: 5 }, (_, index) => data.low + (data.high - data.low) * index / 4).map(value => <g key={value}><line x1="78" x2="918" y1={y(value)} y2={y(value)} className="lac-grid"/><text x="67" y={y(value) + 4} textAnchor="end">{money(value)}</text></g>)}
        {data.spots.map(spot => <g key={spot}><line x1={x(spot)} x2={x(spot)} y1="32" y2="280" className="lac-grid"/><text x={x(spot)} y="302" textAnchor="middle">${spot.toFixed(1)}</text></g>)}
        <line x1="78" x2="918" y1={y(0)} y2={y(0)} className="lac-zero"/>
        <path d={`${path(data.expiration)} L918,${y(0)} L78,${y(0)} Z`} clipPath={`url(#${id}-gain)`} fill="#52dbb4" opacity=".1"/>
        <path d={`${path(data.expiration)} L918,${y(0)} L78,${y(0)} Z`} clipPath={`url(#${id}-loss)`} fill="#ff718b" opacity=".1"/>
        <path d={path(data.expiration)} className="lac-expiry"/><path d={path(data.selected)} className="lac-selected"/>
        {hover !== null && <line x1={x(inspected)} x2={x(inspected)} y1="32" y2="280" className="lac-hover"/>}
        <g className="lac-marker" role="slider" aria-label="Chart selected price" aria-valuemin={data.min} aria-valuemax={data.max} aria-valuenow={target} tabIndex={0} onKeyDown={event => { if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) { event.preventDefault(); onChange({ ...state, scenarioSpot: event.key === 'Home' ? data.min : event.key === 'End' ? data.max : Math.max(data.min, Math.min(data.max, target + (event.key === 'ArrowRight' ? .25 : -.25))) }) } }} onPointerDown={event => { event.preventDefault(); dragging.current = true; setDragSpot(state.scenarioSpot); event.currentTarget.setPointerCapture(event.pointerId) }}>
          <line x1={x(target)} x2={x(target)} y1="32" y2="280" className="lac-marker-hit"/><line x1={x(target)} x2={x(target)} y1="32" y2="280" className="lac-target"/><rect x={x(target) - 18} y="8" width="36" height="22" rx="6"/><text x={x(target)} y="23" textAnchor="middle">↔</text>
        </g>
        <circle cx={x(inspected)} cy={y(inspectedPnl)} r="4" className="lac-dot"/>
        <text x="498" y="326" textAnchor="middle">Underlying price · drag the blue handle to select</text>
      </svg></div>
    </>}
    {view === 'Heatmap' && <div className="lac-scroll" role="region" aria-label="Price and time heatmap" tabIndex={0}><table className="lac-heatmap"><caption>Price × time · select a cell to inspect that price and date. Colors show modeled P/L, not probability.</caption><thead><tr><th scope="col">Date UTC</th>{data.spots.map(spot => <th scope="col" key={spot}>${spot.toFixed(1)}</th>)}</tr></thead><tbody>{data.dates.map((date, row) => <tr key={date}><th scope="row">{dateLabel(date)}<small>{date.slice(11, 16)}</small></th>{data.spots.map((spot, col) => { const pnl = matrix[row][col]; const intensity = .12 + .45 * Math.abs(pnl) / Math.max(1, ...matrix.flat().map(Math.abs)); return <td key={spot}><button style={{ background: `rgb(${pnl < 0 ? '239 93 120' : '42 186 148'} / ${intensity})` }} aria-label={`${dateLabel(date)} ${date.slice(11, 16)} UTC at $${spot.toFixed(2)}: ${money(pnl)} P/L`} onClick={() => onChange({ ...state, scenarioSpot: spot, scenarioDate: date })}>{money(pnl)}</button></td> })}</tr>)}</tbody></table></div>}
    {view === 'Table' && <div className="lac-scroll" role="region" aria-label="Price scenario table" tabIndex={0}><table className="lac-table"><caption>Selected date · {dateLabel(state.scenarioDate)} · select a price to inspect it</caption><thead><tr>{['Underlying', 'Selected-date P/L', 'Expiry P/L', 'Delta', 'Theta / day', 'Vega / IV pt'].map(label => <th scope="col" key={label}>{label}</th>)}</tr></thead><tbody>{table.map(row => <tr key={row.spot}><th scope="row"><button onClick={() => onChange({ ...state, scenarioSpot: row.spot })}>${row.spot.toFixed(2)}</button></th><td className={row.pnl < 0 ? 'lac-loss' : 'lac-gain'}>{money(row.pnl)}</td><td className={row.expiryPnl < 0 ? 'lac-loss' : 'lac-gain'}>{money(row.expiryPnl)}</td><td>{row.delta.toFixed(2)}</td><td>{row.theta.toFixed(2)}</td><td>{row.vega.toFixed(2)}</td></tr>)}</tbody></table></div>}
  </section>
}
