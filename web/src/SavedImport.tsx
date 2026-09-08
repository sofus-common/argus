import { useEffect, useRef, useState } from 'react'

export function SavedImport({ disabled, onImported }: { disabled: boolean; onImported: () => Promise<void> }) {
  const [candidate, setCandidate] = useState<{ raw: string; name: string; title: string; revision: number; exportedAt: string; history: string }>()
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const generation = useRef(0), request = useRef<AbortController | null>(null)
  useEffect(() => () => { generation.current++; request.current?.abort(); request.current = null }, [])

  async function select(file?: File) {
    if (request.current || disabled) return
    const sequence = ++generation.current
    setCandidate(undefined); setError(''); setNotice('')
    if (!file) return
    try {
      if (file.size > 2 * 1024 * 1024) throw new Error('File exceeds the 2 MiB import limit.')
      const raw = await file.text()
      if (sequence !== generation.current) return
      const body = JSON.parse(raw), record = body?.record, ledger = record?.lifecycle
      if (body?.format !== 'argus-saved-position' || body.formatVersion !== 1 || typeof record?.title !== 'string' || !record.title.trim() || record.title.length > 120 || !Number.isSafeInteger(record.revision) || record.revision < 1 || typeof body.exportedAt !== 'string' || !Number.isFinite(Date.parse(body.exportedAt))) throw new Error('Not a supported ARGUS saved-position export.')
      const legacy = ledger?.schemaVersion === 2 ? ledger.legacy : ledger
      const count = (items: unknown, optional = false) => { if (items === undefined && optional) return 0; if (!Array.isArray(items)) throw new Error('Malformed recorded-history preview.'); return items.length }
      if (ledger !== null && ![1, 2].includes(ledger?.schemaVersion)) throw new Error('Unsupported recorded-history format.')
      const history = ledger === null ? 'No recorded close or lot history' : `${count(legacy?.closes)} closes · ${count(legacy?.priceCorrections, true)} corrections · ${count(legacy?.closeVoids, true)} voids${ledger.schemaVersion === 2 ? ` · ${count(ledger.transactions)} lot transactions · ${count(ledger.amendments, true)} lot amendments` : ''}`
      setCandidate({ raw, name: file.name, title: record.title, revision: record.revision, exportedAt: body.exportedAt, history })
    } catch (cause) { if (sequence === generation.current) setError(cause instanceof Error ? cause.message : 'File could not be read.') }
  }

  async function upload() {
    if (!candidate || disabled || request.current) return
    const controller = new AbortController(), selected = candidate
    request.current = controller; setBusy(true); setCandidate(undefined); setError(''); setNotice('')
    const timer = setTimeout(() => controller.abort(), 15000)
    let confirmed = false
    try {
      const response = await fetch('/api/strategies/import', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-ARGUS-Request': '1' }, body: selected.raw, signal: controller.signal })
      if (request.current !== controller) return
      if ([400, 401, 403, 413, 429].includes(response.status)) { setError('Import rejected. Check the file, sign-in and size limits before selecting it again. No saved position was created by this request.'); return }
      const body = await response.json() as { record?: { id?: unknown; revision?: unknown } }
      if (request.current !== controller) return
      if (response.status !== 201 || typeof body?.record?.id !== 'string' || !body.record.id || body.record.revision !== 1) throw new Error('Unconfirmed import')
      confirmed = true
      setNotice(`Imported “${selected.title}” as a new saved position. The open strategy is unchanged. Use Load for a position without recorded activity, or Manage closes / Manage lots & rolls for its history.`)
      await onImported()
    } catch {
      if (request.current === controller) setError(confirmed ? 'Import succeeded, but the saved list could not refresh. Refresh the list before importing again.' : 'Import outcome is unknown; the server may have saved it. Refresh and inspect saved positions before selecting this file again. Nothing was retried.')
    } finally {
      clearTimeout(timer)
      if (request.current === controller) { request.current = null; setBusy(false) }
    }
  }

  async function refresh() {
    const sequence = ++generation.current
    try { await onImported(); if (sequence === generation.current) setNotice('Saved list refreshed. Inspect it before importing another copy.') }
    catch { if (sequence === generation.current) setError('Saved list could not refresh. Do not repeat an uncertain import.') }
  }

  return <details className="saved-import"><summary>Import saved JSON</summary>
    <p>Creates a new saved record, including recorded history. Does not load it or change the open strategy. File contents are unverified; imported quotes stay historical. Maximum 2 MiB file, with a 128 KiB position/quote sublimit.</p>
    <label>Choose an ARGUS export<input type="file" aria-label="Saved JSON file" accept=".json,application/json" disabled={disabled || busy} onChange={event => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ''; void select(file) }} /></label>
    {candidate && <div className="import-preview"><strong>{candidate.title}</strong><p>{candidate.name} · saved revision {candidate.revision} · exported {candidate.exportedAt}</p><p>{candidate.history}</p><p>Unverified file preview. Full validation runs on import; invalid records are rejected without a save.</p><button disabled={disabled || busy} onClick={() => void upload()}>Import as new saved position</button></div>}
    {busy && <p role="status">Importing once…</p>}
    {notice && <p role="status">{notice}</p>}
    {error && <p role="alert">{error}</p>}
    {(notice || error) && <button disabled={disabled || busy} onClick={() => void refresh()}>Refresh saved list</button>}
  </details>
}
