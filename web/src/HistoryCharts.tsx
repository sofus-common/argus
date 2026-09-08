import { useMemo, useState, type PointerEvent } from 'react'
export type HistoryChartRow = { label: string; value: number | null; underlying: number | null; envelope?: { low: number; high: number } }
const currency = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 })
const dollars = (value: number) => currency.format(value)

export function HistoryCharts({ rows, selected, onInspect, intraday = false, stockTrades = false, priceScale, ivLabel }: { rows: HistoryChartRow[]; selected: number; onInspect: (index: number) => void; intraday?: boolean; stockTrades?: boolean; priceScale?: number | null; ivLabel?: string }) {
  const format = (value: number) => ivLabel ? value.toLocaleString('en-US', { style: 'percent', minimumFractionDigits: 2, maximumFractionDigits: 2 }) : dollars(value)
  const [priceMode, setPriceMode] = useState(false)
  const [preview, setPreview] = useState<number | null>(null)
  const [window, setWindow] = useState<{ start: number; count: number } | null>(null)
  const count = Math.min(rows.length, window?.count ?? rows.length)
  const start = Math.min(window?.start ?? 0, Math.max(0, rows.length - count))
  const visible = useMemo(() => rows.slice(start, start + count), [rows, start, count])
  const divisor = !ivLabel && Number.isSafeInteger(priceScale) && priceScale! >= 100 ? priceScale! : null
  const scale = priceMode && divisor ? divisor : 1
  const selection = Math.max(0, Math.min(rows.length - 1, Number.isFinite(selected) ? Math.round(selected) : 0))
  const index = preview === null ? selection : Math.max(0, Math.min(rows.length - 1, preview))
  const previewing = index !== selection
  const current = rows[index]
  const inView = index >= start && index < start + count
  function changeWindow(nextCount: number, center: number) {
    setPreview(null)
    setWindow({ start: Math.max(0, Math.min(rows.length - nextCount, center - Math.floor(nextCount / 2))), count: nextCount })
  }
  function inspect(next: number) {
    setPreview(null)
    if (next < start || next >= start + count) changeWindow(count, next)
    onInspect(next)
  }
  const zoom = (factor: number) => changeWindow(Math.min(rows.length, Math.max(3, Math.ceil(count * factor))), selection >= start && selection < start + count ? selection : start + Math.floor(count / 2))
  const pan = (direction: number) => { setPreview(null); setWindow({ start: Math.max(0, Math.min(rows.length - count, start + direction * Math.floor(count / 2))), count }) }
  const pointerIndex = (event: PointerEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    return count && rect.width > 0 ? start + Math.max(0, Math.min(count - 1, Math.round(((event.clientX - rect.left) / rect.width * 720 - 100) / 600 * (count - 1)))) : null
  }
  const x = (i: number) => count < 2 ? 400 : 100 + i / (count - 1) * 600
  const plots = useMemo(() => (ivLabel ? [false] : [false, true]).map(underlying => {
    const values = visible.map(row => { const value = underlying ? row.underlying : row.value; return value === null ? null : { mid: underlying ? value : value / scale, envelope: ivLabel || underlying || intraday || !row.envelope ? undefined : { low: row.envelope.low / scale, high: row.envelope.high / scale } } })
    const available = values.flatMap(value => value ? [value.mid, ...(value.envelope ? [value.envelope.low, value.envelope.high] : [])] : [])
    const low = available.length ? Math.min(...available) : 0, high = available.length ? Math.max(...available) : 1
    const padding = Math.max((high - low) * .12, Math.abs(high) * .001, ivLabel ? .0001 : .01)
    const minimum = ivLabel ? Math.max(0, low - padding) : low - padding, maximum = high + padding
    const y = (value: number) => 154 - (value - minimum) / (maximum - minimum) * 130
    const segments: number[][] = []
    values.forEach((value, i) => {
      if (value) {
        if (i === 0 || !values[i - 1]) segments.push([])
        segments.at(-1)!.push(i)
      }
    })
    return { values, y, content: <>
        {available.length > 0 && [minimum, (minimum + maximum) / 2, maximum].map((tick, i) => <g key={i}><line className="history-grid" x1="100" x2="700" y1={y(tick)} y2={y(tick)} /><text x="90" y={y(tick) + 4} textAnchor="end">{format(tick)}</text></g>)}
        {available.length > 0 && minimum < 0 && maximum > 0 && <line className="history-zero" x1="100" x2="700" y1={y(0)} y2={y(0)} />}
        {segments.map(segment => <g key={segment[0]} data-history-segment={segment[0]}>
          {segment.every(i => values[i]!.envelope) && <path className="history-envelope" d={segment.map((i, n) => `${n ? 'L' : 'M'}${x(i)},${y(values[i]!.envelope!.high)}`).join(' ') + ' ' + [...segment].reverse().map(i => `L${x(i)},${y(values[i]!.envelope!.low)}`).join(' ') + ' Z'} />}
          <path className="history-line" d={segment.map((i, n) => `${n ? 'L' : 'M'}${x(i)},${y(values[i]!.mid)}`).join(' ')} />
          {segment.map(i => <g key={i}>{values[i]!.envelope && <line className="history-interval" x1={x(i)} x2={x(i)} y1={y(values[i]!.envelope!.low)} y2={y(values[i]!.envelope!.high)} />}<circle className="history-point" cx={x(i)} cy={y(values[i]!.mid)} r={intraday ? 1.5 : 2.5}><title>{`${visible[i].label}: ${format(values[i]!.mid)}`}</title></circle></g>)}
        </g>)}
        {!available.length && <text className="history-empty" x="400" y="90" textAnchor="middle">No reported values</text>}
        {count > 0 && <text x={x(0)} y="178" textAnchor={count === 1 ? 'middle' : 'start'}>{visible[0].label}</text>}
        {count > 1 && <text x={x(count - 1)} y="178" textAnchor="end">{visible.at(-1)!.label}</text>}
      </> }
  }), [visible, scale, intraday, count, ivLabel])
  const chart = (underlying: boolean) => {
    const plot = plots[underlying ? 1 : 0], point = inView ? plot.values[index - start] : null
    return <section className={`history-chart${underlying ? ' history-underlying' : ''}`}>
      <div className="history-chart-heading"><h3>{ivLabel ? 'Option implied volatility' : underlying ? 'Underlying' : scale !== 1 ? 'Strategy price' : 'Current inventory'}</h3><span>{ivLabel ? 'Trade-candle IV · percent' : !underlying && scale !== 1 ? 'Normalized quote units · USD' : intraday ? underlying ? 'Last trade · 5-minute close · USD' : `${stockTrades ? 'Option marks + stock trades' : 'Option midpoint marks'} · USD` : underlying ? 'EOD midpoint · USD' : 'EOD value · USD'}</span></div>
      <svg role="img" aria-label={ivLabel ? 'Historical option implied volatility' : underlying ? 'Historical underlying price' : 'Historical strategy value'} viewBox="0 0 720 184" preserveAspectRatio="none" onPointerDown={event => {
        if (event.button !== 0) return
        const next = pointerIndex(event)
        if (next !== null) inspect(next)
      }} onPointerMove={event => { if (event.pointerType !== 'touch') setPreview(pointerIndex(event)) }} onPointerLeave={() => setPreview(null)} onPointerCancel={() => setPreview(null)}>
        <title>{`${ivLabel ? `${ivLabel} historical candle IV` : underlying ? intraday ? 'Underlying last-trade candle close' : 'Underlying end-of-day midpoint' : scale !== 1 ? 'Normalized strategy price estimate' : intraday ? 'Signed current-inventory candle-close estimate' : 'Signed current-inventory value with quote-side envelope'}. Missing values are not interpolated.`}</title>
        {plot.content}
        {current && inView && <line className="history-guide" x1={x(index - start)} x2={x(index - start)} y1="18" y2="158" />}
        {point && <circle className="history-highlight" cx={x(index - start)} cy={plot.y(point.mid)} r="4" />}
      </svg>
    </section>
  }
  return <div className={`history-charts${intraday ? ' history-charts-intraday' : ''}${ivLabel ? ' history-charts-iv' : ''}`}>
    {divisor && <div className="segmented" role="group" aria-label="History value display"><button type="button" className={!priceMode ? 'active' : ''} aria-pressed={!priceMode} onClick={() => setPriceMode(false)}>Total inventory</button><button type="button" className={priceMode ? 'active' : ''} aria-pressed={priceMode} onClick={() => setPriceMode(true)}>Strategy price</button></div>}
    {rows.length > 3 && <div className="segmented history-navigation" role="group" aria-label="History chart navigation"><button type="button" disabled={start === 0} onClick={() => pan(-1)}>Earlier</button><button type="button" disabled={count <= 3} onClick={() => zoom(.5)}>Zoom in</button><button type="button" disabled={count === rows.length} onClick={() => zoom(2)}>Zoom out</button><button type="button" disabled={start + count === rows.length} onClick={() => pan(1)}>Later</button><button type="button" disabled={count === rows.length} onClick={() => { setPreview(null); setWindow(null) }}>Reset zoom</button></div>}
    {!ivLabel && <div className="history-legend"><span>{intraday ? 'Inventory estimate' : 'Midpoint'}</span><span>{intraday ? 'Underlying last trade' : 'Strategy quote-side envelope'}</span></div>}
    {chart(false)}{!ivLabel && chart(true)}
    <label className="history-inspector">Inspect history {intraday ? 'interval' : 'date'} · full range<input type="range" aria-label={`Inspect history ${intraday ? 'interval' : 'date'}`} aria-valuetext={rows[selection]?.label ?? 'No values'} min="0" max={Math.max(0, rows.length - 1)} step="1" value={selection} disabled={!rows.length} onChange={event => inspect(Number(event.target.value))} /></label>
    {current && !inView && <p className="history-chart-note">Selected point is outside this view. Use the inspector or reset zoom to reveal it.</p>}
    <output className="history-readout" aria-live={previewing ? 'off' : 'polite'}><strong>{previewing ? 'Preview' : 'Selected'} · {current?.label ?? 'No values'}</strong><span>{ivLabel ? `${ivLabel} · IV` : 'Inventory'} <b>{current?.value != null ? format(current.value) : 'Unavailable'}</b></span>{divisor && <span>Strategy price <b>{current?.value != null ? dollars(current.value / divisor) : 'Unavailable'}</b></span>}{!ivLabel && !intraday && <span>Quote sides · total <b>{current?.envelope ? `${dollars(current.envelope.low)} to ${dollars(current.envelope.high)}` : 'Unavailable'}</b></span>}{!ivLabel && <span>Underlying <b>{current?.underlying != null ? dollars(current.underlying) : 'Unavailable'}</b></span>}</output>
    <p className="history-chart-note">Hover to preview. Click a chart or use the inspector to select {ivLabel ? 'an interval.' : 'the point for discussion.'}</p>
    {divisor && <p className="history-chart-note">Strategy price = total inventory ÷ {divisor}. Quantities reduce to the smallest whole-contract/whole-share ratio, then divide by the 100-share contract multiplier. Not an executable package quote. AI discussion retains total USD and this conversion.</p>}
    <p className="history-chart-note">{ivLabel ? 'Provider IV observations on five-minute trade candles. Times identify bucket starts; precise IV observation time and aggregation within each bucket are unspecified.' : <>Fixed current holdings, not historical P/L or fills. {intraday ? 'Bucket-close estimates are not synchronized quotes. No bid/ask envelope is available.' : 'Shading shows quoted bid/ask sides, not a confidence interval.'}</>} Gaps mean no reported value.</p>
  </div>
}
