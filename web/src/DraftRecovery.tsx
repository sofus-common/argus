import { useEffect, useRef, useState } from 'react'
import { readWorkspaceDraft, recoverWorkspaceDraft, type WorkspaceDraft } from './workspace-draft'

export function DraftRecovery({ ownerKey, data, changed, disabled, onRestore }: { ownerKey: string; data: Omit<WorkspaceDraft, 'schemaVersion' | 'savedAt'>; changed: boolean; disabled: boolean; onRestore: (draft: WorkspaceDraft) => void }) {
  const key = `argus.tab-draft.v1.${ownerKey}`
  const [candidate, setCandidate] = useState<WorkspaceDraft | null>(null)
  const [blocked, setBlocked] = useState(true), [error, setError] = useState(''), [busy, setBusy] = useState(false)
  const current = useRef({ data: JSON.stringify(data), disabled })
  current.current = { data: JSON.stringify(data), disabled }
  const request = useRef<AbortController | null>(null)
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(key)
      if (raw) setCandidate(readWorkspaceDraft(raw))
      else setBlocked(false)
    } catch { setError('The tab draft cannot be read. Discard it to enable new tab recovery; current edits are unchanged.') }
    return () => request.current?.abort()
  }, [key])
  useEffect(() => {
    if (blocked) return
    try {
      if (changed) sessionStorage.setItem(key, JSON.stringify(readWorkspaceDraft(JSON.stringify({ ...data, schemaVersion: 1, savedAt: new Date().toISOString() }))))
      else sessionStorage.removeItem(key)
      setError('')
    } catch { setError('Tab recovery could not be updated. Keep this tab open or explicitly save your position.') }
  }, [key, data, changed, blocked])
  function discard() {
    try { sessionStorage.removeItem(key); setCandidate(null); setBlocked(false); setError('') }
    catch { setError('Tab storage is unavailable. The existing recovery copy was not discarded.') }
  }
  async function restore() {
    if (!candidate || disabled || busy) return
    const before = current.current.data, controller = new AbortController()
    request.current = controller; setBusy(true); setError('')
    const timer = setTimeout(() => controller.abort(), 12000)
    try {
      const response = await fetch('/api/bootstrap', { signal: controller.signal })
      const body = await response.json() as { session?: { recoveryKey?: string } }
      if (controller.signal.aborted) return
      if (!response.ok || body.session?.recoveryKey !== ownerKey) throw new Error('Private session changed. Reload and sign in before restoring a tab draft.')
      if (current.current.disabled || current.current.data !== before) throw new Error('Workspace changed while checking your session. Restore was not applied; try again.')
      onRestore(recoverWorkspaceDraft(candidate))
      setCandidate(null); setBlocked(false)
    } catch (cause) { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Draft could not be restored.') }
    finally { clearTimeout(timer); if (request.current === controller) { request.current = null; setBusy(false); if (controller.signal.aborted) setError('Session check interrupted. Your draft was kept.') } }
  }
  return <section aria-label="Tab draft recovery">
    {candidate ? <><p>Recover {candidate.title || candidate.state.name} · {candidate.savedAt}. This opens a separate unsaved position; saved trades are unchanged.</p><button type="button" disabled={disabled || busy} onClick={() => void restore()}>Restore tab draft</button></> : <small>Tab recovery keeps unsaved position, thesis and question text in this browser tab. Not a durable backup or saved trade.</small>}
    {blocked && <button type="button" disabled={busy} onClick={discard}>Discard tab draft</button>}
    {busy && <p role="status">Checking private session before recovery…</p>}
    {error && <p role="alert">{error}</p>}
  </section>
}
