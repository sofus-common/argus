import { useEffect, useRef, useState } from 'react'
import type { SourceEvidence } from './market-context'

type Context = { symbol: string; retrievedAt: string; sources: SourceEvidence[] }
const timestamp = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2}))?$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value.slice(0, 10)).toISOString().slice(0, 10) === value.slice(0, 10)
function link(value: string | null) {
  try { const url = new URL(value!); return url.protocol === 'https:' && !url.username && !url.password ? url.href : null } catch { return null }
}

export function WorkspaceContext({ symbol, sample }: { symbol: string; sample: boolean }) {
  const [data, setData] = useState<Context | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const generation = useRef(0), controller = useRef<AbortController | null>(null)
  useEffect(() => {
    generation.current++; controller.current?.abort(); setData(null); setBusy(false); setError('')
    return () => { generation.current++; controller.current?.abort() }
  }, [symbol])

  async function load() {
    controller.current?.abort()
    const request = new AbortController(), version = ++generation.current
    controller.current = request
    setBusy(true); setData(null); setError('')
    const timeout = setTimeout(() => request.abort(), 15000)
    try {
      const response = await fetch(`/api/context?symbol=${encodeURIComponent(symbol)}`, { signal: request.signal })
      if (!response.ok) throw new Error('Context unavailable')
      const body = await response.json() as Context
      const text = (value: unknown, max: number) => typeof value === 'string' && value.length <= max
      if (!body || body.symbol !== symbol || !timestamp(body.retrievedAt) || !Array.isArray(body.sources) || body.sources.length > 32 || new Set(body.sources.map(source => source?.id)).size !== body.sources.length || body.sources.some(source => !source || !text(source.id, 80) || !source.id || !text(source.provider, 120) || !text(source.label, 300) || !text(source.summary, 5000) || !['available', 'unavailable'].includes(source.status) || source.asOf !== null && !timestamp(source.asOf) || source.url !== null && !text(source.url, 2048) || source.reason !== undefined && !text(source.reason, 2000))) throw new Error('Invalid context')
      if (generation.current === version && !request.signal.aborted) setData(body)
    } catch {
      if (generation.current === version) setError('Context could not be loaded. Retry to fetch dated sources; your position is unchanged.')
    } finally {
      clearTimeout(timeout)
      if (generation.current === version) setBusy(false)
    }
  }

  const visible = data?.symbol === symbol ? data : null
  const gaps = visible?.sources.filter(source => source.status === 'unavailable').length ?? 0
  const priority = (source: SourceEvidence) => /earnings|dividend/.test(source.id) ? 0 : /tastytrade-(iv|liquidity)-/.test(source.id) ? 1 : 2
  return <details className="workspace-context" aria-label="Events and market context">
    <summary>Events &amp; market context</summary>
    <div className="workspace-context-body">
      <p>{symbol} dated provider context. {sample ? 'Your sample/manual position still uses its own pricing inputs.' : 'Separate from the position’s quote snapshot.'} Loading this panel does not run AI or change prices.</p>
      <p>Sources may be cached for up to 60 seconds. AI requests fetch their own dated context.</p>
      <button type="button" onClick={() => void load()} disabled={busy}>{busy ? 'Loading context…' : visible ? 'Refresh context' : 'Load context'}</button>
      {error && <p role="alert">{error}</p>}
      <div aria-live="polite" aria-busy={busy}>
        {visible && <>
          <p className="workspace-context-dated">Retrieved <time dateTime={visible.retrievedAt}>{visible.retrievedAt}</time><br />{visible.sources.filter(source => source.status === 'available').length} available; {gaps} {gaps === 1 ? 'gap' : 'gaps'}. Missing events do not mean an event-free calendar.</p>
          <div className="workspace-context-sources" tabIndex={0} aria-label={`${symbol} dated context sources`}>
            {[...visible.sources].sort((a, b) => priority(a) - priority(b)).map(source => {
              const url = link(source.url)
              return <details key={source.id}>
                <summary><span>{source.label}</span><small>{source.provider}: {source.status === 'available' ? 'Available' : 'Unavailable'}</small></summary>
                <p>Evidence timestamp: {source.asOf ? <time dateTime={source.asOf}>{source.asOf}</time> : 'not established'}</p>
                {source.summary && <p>{source.summary}</p>}
                {source.reason && <p>{source.reason}</p>}
                {url && <a href={url} target="_blank" rel="noopener noreferrer">Source details</a>}
              </details>
            })}
          </div>
        </>}
      </div>
    </div>
  </details>
}
