import { useEffect, useRef, useState } from 'react'

export function SymbolSearch({ underlying, onSelect }: { underlying: string; onSelect: (symbol: string) => void }) {
  const [query, setQuery] = useState('')
  const [items, setItems] = useState<{ symbol: string; name: string }[]>([])
  const [status, setStatus] = useState('')
  const [pending, setPending] = useState(false)
  const generation = useRef(0)
  const panel = useRef<HTMLDetailsElement>(null)
  useEffect(() => {
    generation.current++; setItems([]); setStatus(''); setPending(false)
    if (panel.current) panel.current.open = false
  }, [underlying])
  async function search() {
    if (pending || query.trim().length < 2) return
    const requested = query.trim(), sequence = ++generation.current
    setPending(true); setItems([]); setStatus('Searching…')
    try {
      const response = await fetch(`/api/symbols?${new URLSearchParams({ q: requested })}`, { signal: AbortSignal.timeout(12000) })
      const body = await response.json() as { query?: unknown; items?: unknown; truncated?: unknown } | null
      if (sequence !== generation.current) return
      if (!response.ok || !body || body.query !== requested || !Array.isArray(body.items) || body.items.length > 10 || body.items.some((item: { symbol?: unknown; name?: unknown }) => typeof item?.symbol !== 'string' || !/^[A-Z]{1,6}$/.test(item.symbol) || typeof item.name !== 'string' || !item.name || item.name.length > 200)) throw new Error('Search unavailable. You can still enter a ticker directly.')
      setItems(body.items)
      setStatus(body.items.length ? `${body.items.length} Tastytrade matches${body.truncated ? ' · refine your search for more' : ''}. Selecting a result only fills the ticker.` : 'No supported equity or ETF matches. Try a ticker or another name.')
    } catch {
      if (sequence === generation.current) setStatus('Search unavailable. You can still enter a ticker directly.')
    } finally {
      if (sequence === generation.current) setPending(false)
    }
  }
  return <details ref={panel} className="symbol-search"><summary>Find a company or ETF</summary>
    <form className="symbol-control" onSubmit={event => { event.preventDefault(); void search() }}>
      <label>Company or ticker<input aria-label="Company or ticker" maxLength={80} value={query} onChange={event => { generation.current++; setQuery(event.target.value); setItems([]); setStatus(''); setPending(false) }} /></label>
      <button disabled={pending || query.trim().length < 2}>Search symbols</button>
    </form>
    <p role="status">{status}</p>
    <ul>{items.map(item => <li key={item.symbol}><button onClick={() => { onSelect(item.symbol); setStatus(`${item.symbol} selected. Use Load symbol to replace the template; Undo restores your position.`) }}><b>{item.symbol}</b><span>{item.name}</span></button></li>)}</ul>
    <small>Instrument discovery only. Option-chain availability is checked when you load.</small>
  </details>
}
