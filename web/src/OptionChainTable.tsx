import { useState } from 'react'
import { MAX_CHAIN_CONTRACTS, MAX_OPTION_LEGS, type MarketContract, type MarketSnapshot, type StrategyState } from './options'

const price = (value: number) => value.toFixed(2)
const count = (value?: number) => value === undefined ? '—' : value.toLocaleString('en-US')
const widthPercent = (contract: MarketContract) => (contract.ask - contract.bid) / ((contract.ask + contract.bid) / 2) * 100

function StrikeActivity({ snapshot, onDiscuss, disabled }: { snapshot: MarketSnapshot; onDiscuss: (question: string) => void; disabled: boolean }) {
  const [metric, setMetric] = useState<'volume' | 'openInterest' | 'iv'>('volume')
  const [expiry, setExpiry] = useState('')
  const [inspection, setInspection] = useState<{ window: string; strike: number } | null>(null)
  const contracts = snapshot.contracts.slice(0, MAX_CHAIN_CONTRACTS)
  const expiries = [...new Set(contracts.map(contract => contract.expiry))].sort()
  const selectedExpiry = expiries.includes(expiry) ? expiry : expiries[0]
  const quoted = contracts.filter(contract => contract.expiry === selectedExpiry)
  const strikes = [...new Set(quoted.map(contract => contract.strike))].sort((a, b) => a - b)
  const window = `${snapshot.id}:${selectedExpiry}`
  const nearest = strikes.reduce((best, strike) => Math.abs(strike - snapshot.spot) < Math.abs(best - snapshot.spot) ? strike : best, strikes[0])
  const selectedStrike = inspection?.window === window && strikes.includes(inspection.strike) ? inspection.strike : nearest
  const selectedIndex = strikes.indexOf(selectedStrike)
  const selected = quoted.filter(contract => contract.strike === selectedStrike)
  const metricLabel = metric === 'iv' ? 'IV' : metric === 'volume' ? 'Volume' : 'Open interest'
  const formatValue = (value: number) => metric === 'iv' ? `${(value * 100).toFixed(2)}%` : count(value)
  const valueLabel = (type: 'call' | 'put') => {
    const contract = selected.find(item => item.type === type)
    return !contract ? 'not quoted' : contract[metric] === undefined ? 'unavailable (not reported)' : formatValue(contract[metric])
  }
  const maximum = Math.max(metric === 'iv' ? .01 : 1, ...quoted.flatMap(contract => contract[metric] === undefined ? [] : [contract[metric]!]))
  const x = (strike: number) => strikes.length === 1 ? 350 : 70 + (strike - strikes[0]) / (strikes[strikes.length - 1] - strikes[0]) * 560
  const barWidth = Math.min(16, ...strikes.slice(1).map((strike, index) => (x(strike) - x(strikes[index])) / 3))
  const missing = quoted.filter(contract => contract[metric] === undefined).length
  return <section className="strike-activity" aria-label="Strike activity">
    <header><div><h3>{metric === 'iv' ? 'Implied volatility by strike' : 'Strike activity'}</h3><small>Quoted window · one expiry · {metric === 'iv' ? 'dated IV observations' : 'contract counts'}</small></div><div className="activity-controls">
      <label>Metric<select aria-label="Strike activity metric" value={metric} onChange={event => setMetric(event.target.value as typeof metric)}><option value="volume">Volume</option><option value="openInterest">Open interest</option><option value="iv">Implied volatility</option></select></label>
      <label>Expiry<select aria-label="Strike activity expiry" value={selectedExpiry ?? ''} onChange={event => setExpiry(event.target.value)}>{expiries.map(date => <option key={date} value={date}>{date.slice(0, 10)}</option>)}</select></label>
    </div></header>
    <div className="activity-key"><span className="activity-call">Calls</span><span className="activity-put">Puts</span><span>× {metric === 'iv' ? 'IV' : 'Count'} not reported</span></div>
    {strikes.length ? <>
      <svg role="img" aria-label={metric === 'iv' ? 'Quoted implied volatility by strike' : 'Quoted strike activity'} viewBox="0 0 700 230" onPointerDown={event => {
        const point = (event.clientX - event.currentTarget.getBoundingClientRect().left) / event.currentTarget.getBoundingClientRect().width * 700
        const strike = strikes.reduce((best, item) => Math.abs(x(item) - point) < Math.abs(x(best) - point) ? item : best, strikes[0])
        setInspection({ window, strike })
      }}>
        <title>{snapshot.underlying} {metricLabel} by strike · {selectedExpiry.slice(0, 10)} · quoted contracts only</title>
        {[0, .5, 1].map(fraction => <g key={fraction}><line className="activity-grid" x1="50" x2="650" y1={190 - fraction * 150} y2={190 - fraction * 150} /><text x="43" y={194 - fraction * 150} textAnchor="end">{metric === 'iv' ? `${(maximum * fraction * 100).toFixed(1)}%` : new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(maximum * fraction)}</text></g>)}
        <line className="activity-inspected" x1={x(selectedStrike)} x2={x(selectedStrike)} y1="30" y2="196" />
        {snapshot.spot >= strikes[0] && snapshot.spot <= strikes[strikes.length - 1] && <g><line className="spot-line" x1={x(snapshot.spot)} x2={x(snapshot.spot)} y1="22" y2="190" /><text x={x(snapshot.spot)} y="14" textAnchor="middle">Spot {price(snapshot.spot)}</text></g>}
        {quoted.map(contract => {
          const value = contract[metric]
          const left = x(contract.strike) + (contract.type === 'call' ? -barWidth - 1 : 1)
          if (metric === 'iv' && value !== undefined) return <circle key={contract.contractId} className={`activity-${contract.type}`} cx={x(contract.strike) + (contract.type === 'call' ? -3 : 3)} cy={190 - value / maximum * 150} r="3"><title>{contract.strike} {contract.type}: {formatValue(value)} IV</title></circle>
          return value === undefined ? <text key={contract.contractId} x={left + barWidth / 2} y="187" textAnchor="middle" className={`activity-${contract.type}`}>×</text> : <rect key={contract.contractId} data-strike={contract.strike} data-type={contract.type} className={`activity-${contract.type}`} x={left} y={190 - value / maximum * 150} width={barWidth} height={value / maximum * 150}><title>{contract.strike} {contract.type}: {count(value)} {metricLabel.toLowerCase()}</title></rect>
        })}
        {[...new Set([strikes[0], selectedStrike, strikes[strikes.length - 1]])].map(strike => <text key={strike} x={x(strike)} y="216" textAnchor="middle">{strike}</text>)}
      </svg>
      <label className="activity-inspector">Inspect strike<input aria-label="Inspect activity strike" type="range" min="0" max={strikes.length - 1} step="1" value={selectedIndex} aria-valuetext={`Strike ${selectedStrike}`} onChange={event => setInspection({ window, strike: strikes[Number(event.target.value)] })} /></label>
      <output aria-label="Strike activity inspection" aria-live="polite"><strong>Strike {selectedStrike}</strong><span className="activity-call">Call {metricLabel.toLowerCase()}: <b>{valueLabel('call')}</b></span><span className="activity-put">Put {metricLabel.toLowerCase()}: <b>{valueLabel('put')}</b></span></output>
    </> : <p>No quoted contracts available for activity inspection.</p>}
    <p>{quoted.length} quoted contracts · {missing} missing reported {metric === 'iv' ? 'IVs' : 'counts'} · {strikes.length * 2 - quoted.length} call/put contracts not quoted at displayed strikes. Missing is not zero. Retrieval {snapshot.retrievedAt}; {metric === 'iv' ? 'IV source times are available only when recorded separately in the snapshot. These are individual dated contract IVs, not a fitted surface, historical IV chart, IV rank or forecast. Scenario IV shifts do not alter these observations.' : 'count timestamps are not supplied separately. Counts alone do not establish directional flow, liquidity or execution quality.'} This is not the complete chain.</p>
    <button type="button" disabled={disabled || !strikes.length} onClick={() => onDiscuss(`Discuss strike ${metric === 'iv' ? 'IV profile' : 'activity'} for ${snapshot.underlying}, expiry ${selectedExpiry}, ${metricLabel.toLowerCase()}, selected strike ${selectedStrike}, snapshotId ${snapshot.id}. Use option_snapshot raw ${metric === 'iv' ? 'contract IVs; distinguish calls and puts, recorded source times and unsynchronized observations. This is not historical IV, IV rank, a fitted surface or a forecast. Scenario shifts are not observed IV changes' : 'counts for this quoted window; explain missing data and count timestamp limitations'}. Do not change holdings or infer directional flow or liquidity from these ${metric === 'iv' ? 'IV observations' : 'counts'}.`)}>{metric === 'iv' ? 'Discuss IV profile' : 'Discuss strike activity'}</button>
  </section>
}

export function OptionChainTable({ state, snapshot, onSelect, onAdd, onCompare, onDiscussActivity, comparisonPending, recoveryHint = 'Undo restores the prior workspace.' }: { recoveryHint?: string; state: StrategyState; snapshot: MarketSnapshot; onSelect: (legId: string, contract: MarketContract) => void; onAdd: (contractId: string, side: 'long' | 'short') => void; onCompare: (legId: string, contract: MarketContract) => void; onDiscussActivity: (question: string) => void; comparisonPending: boolean }) {
  const [legId, setLegId] = useState('')
  const [expiry, setExpiry] = useState('all')
  const [type, setType] = useState('all')
  const [sort, setSort] = useState('strike')
  const adding = legId === 'add-long' ? 'long' : legId === 'add-short' ? 'short' : null
  const target = adding ? undefined : state.legs.find(leg => leg.id === legId) ?? state.legs[0]
  const expiries = [...new Set(snapshot.contracts.map(contract => contract.expiry))].sort()
  const selectedExpiry = expiries.includes(expiry) ? expiry : 'all'
  const filtered = snapshot.contracts.filter(contract => (selectedExpiry === 'all' || contract.expiry === selectedExpiry) && (type === 'all' || contract.type === type))
  filtered.sort((a, b) => {
    if (sort === 'spread') return widthPercent(a) - widthPercent(b) || a.strike - b.strike
    if (sort === 'volume' || sort === 'openInterest') return (b[sort] ?? -1) - (a[sort] ?? -1) || a.strike - b.strike
    return a.strike - b.strike || a.expiry.localeCompare(b.expiry) || a.type.localeCompare(b.type)
  })
  return <details className="option-chain-table"><summary>Explore quoted contracts <span>{snapshot.contracts.length} in this window</span></summary>
    <div className="chain-table-body">
      <p>Dated {snapshot.source} window · retrieved {snapshot.retrievedAt}. Quotes are not fills; this is not the entire chain.</p>
      <StrikeActivity snapshot={snapshot} onDiscuss={onDiscussActivity} disabled={comparisonPending} />
      <div className="chain-table-controls">
        <label>Position action<select aria-label="Target leg" value={adding ? legId : target?.id ?? ''} onChange={event => setLegId(event.target.value)}><option value="add-long">Add long leg · 1 contract</option><option value="add-short">Add short leg · 1 contract</option>{state.legs.map(leg => <option key={leg.id} value={leg.id}>Replace {leg.side} {leg.contracts} × {leg.strike} {leg.type} · {leg.id}</option>)}</select></label>
        <label>Expiry<select aria-label="Contract table expiry" value={selectedExpiry} onChange={event => setExpiry(event.target.value)}><option value="all">All quoted expiries</option>{expiries.map(date => <option key={date} value={date}>{date.slice(0, 10)}</option>)}</select></label>
        <label>Type<select aria-label="Contract table type" value={type} onChange={event => setType(event.target.value)}><option value="all">Calls & puts</option><option value="call">Calls</option><option value="put">Puts</option></select></label>
        <label>Sort contracts<select aria-label="Sort contracts" value={sort} onChange={event => setSort(event.target.value)}><option value="strike">Strike ↑</option><option value="spread">Width % ↑</option><option value="volume">Volume ↓</option><option value="openInterest">Open interest ↓</option></select></label>
      </div>
      <div className="chain-table-scroll" tabIndex={0} role="region" aria-label="Quoted option contracts">
        <table><caption>{Math.min(filtered.length, MAX_CHAIN_CONTRACTS)} of {filtered.length} matching quotes · prices and widths in USD per share</caption>
          <thead><tr>{['Contract', 'Bid', 'Ask', 'Mid', 'Width $', 'Width %', 'IV %', 'Volume', 'OI', 'Quote timestamp', 'Selection'].map(label => <th key={label} scope="col">{label}</th>)}</tr></thead>
          <tbody>{filtered.slice(0, MAX_CHAIN_CONTRACTS).map(contract => {
            const held = state.legs.find(leg => leg.contractId === contract.contractId)
            const selected = target?.contractId === contract.contractId
            const expired = Date.parse(contract.expiry) < Date.parse(state.scenarioDate)
            const full = !!adding && state.legs.length >= MAX_OPTION_LEGS
            const disabled = (!adding && !target) || !!held || expired || full || snapshot.underlying !== state.underlying
            const reason = selected ? 'Selected' : held ? `Used by ${held.id}` : expired ? 'Before scenario' : full ? `${MAX_OPTION_LEGS}-leg limit` : adding ? `Add ${adding}` : 'Use contract'
            return <tr key={contract.contractId} className={selected ? 'chain-contract-selected' : undefined}>
              <th scope="row"><strong>{contract.strike} {contract.type}</strong><small>{contract.expiry.slice(0, 10)}</small></th>
              <td>{price(contract.bid)}</td><td>{price(contract.ask)}</td><td>{price((contract.bid + contract.ask) / 2)}</td><td>{price(contract.ask - contract.bid)}</td><td>{widthPercent(contract).toFixed(1)}%</td><td>{price(contract.iv * 100)}%</td><td>{count(contract.volume)}</td><td>{count(contract.openInterest)}</td><td><time dateTime={contract.quoteAsOf}>{contract.quoteAsOf}</time></td>
              <td><button type="button" disabled={disabled} aria-label={adding ? `Add ${contract.contractId} as ${adding} leg` : `Use ${contract.contractId} for ${target?.id ?? 'leg'}`} title={contract.contractId} onClick={() => { if (disabled) return; if (adding) onAdd(contract.contractId, adding); else if (target) onSelect(target.id, contract) }}>{reason}</button>{!adding && <button type="button" disabled={disabled || comparisonPending} aria-label={`Compare ${contract.contractId} for ${target?.id ?? 'leg'} with AI`} onClick={() => { if (target && !disabled && !comparisonPending) onCompare(target.id, contract) }}>Compare with AI</button>}</td>
            </tr>
          })}</tbody>
        </table>
        {!filtered.length && <p>No quoted contracts match these filters.</p>}
      </div>
      <p>Scroll horizontally for more columns and contract selection. Width % = (ask − bid) ÷ midpoint × 100. Missing volume or open interest is shown as — and sorts last; neither guarantees execution. Replacing keeps side and quantity but resets entry to a quote estimate. Adding creates one long or short contract at the selected quote basis, preserving existing holdings and costs. No trade is recorded; {recoveryHint}</p>
    </div>
  </details>
}
