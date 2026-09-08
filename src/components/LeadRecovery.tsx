'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { createLeadRecovery, type Draft, type Kind, type Saved } from '@/lib/leadRecovery'

export function useLeadRecovery(onLocalSaved?: () => void) {
  const manager = useRef<ReturnType<typeof createLeadRecovery> | null>(null)
  const [pending, setPending] = useState<Saved[]>([])
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const getManager = useCallback(() => {
    if (!manager.current) manager.current = createLeadRecovery({
      storage: {
        getItem: key => sessionStorage.getItem(key),
        setItem: (key, value) => sessionStorage.setItem(key, value),
        removeItem: key => sessionStorage.removeItem(key),
      },
      send: async entry => {
        const response = await fetch('/api/send-lead', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ version: 1, kind: entry.kind, submission: entry.office, parentSubmissionId: entry.parentSubmissionId }), signal: AbortSignal.timeout(55000),
        })
        if (response.status === 400 || response.status === 409) return 'review'
        const result = await response.json().catch(() => null)
        const accepted = response.ok && result?.success === true && result?.captured === true
        if (accepted && entry.kind !== 'intent') { try { onLocalSaved?.() } catch { /* Analytics cannot affect capture. */ } }
        return accepted
      },
    })
    return manager.current
  }, [onLocalSaved])
  useEffect(() => { setPending(getManager().pending()) }, [getManager])
  async function deliver(draft: Draft) {
    setBusy(true)
    try {
      const result = await getManager().submit(draft)
      setPending(getManager().pending())
      setMessage(result.ok ? '' : result.error || 'Receipt not confirmed.')
      return result
    } finally { setBusy(false) }
  }
  async function retry(kind: Kind) {
    setBusy(true)
    try {
      const result = await getManager().retry(kind)
      setPending(getManager().pending())
      setMessage(result.ok ? 'Your request is securely received. NexDoor will finish processing it even if you close this tab.' : result.error || 'Receipt not confirmed.')
    } finally { setBusy(false) }
  }
  function download(entry: Saved) {
    const url = URL.createObjectURL(new Blob([JSON.stringify(entry, null, 2)], { type: 'application/json' }))
    const a = document.createElement('a'); a.href = url; a.download = 'homevalue-saved-request.json'; a.click()
    URL.revokeObjectURL(url)
  }
  const recoveryPanel = (pending.length > 0 || message) ? (
    <aside role="status" className="fixed bottom-4 left-4 right-4 z-[100] mx-auto max-w-xl rounded-xl border border-[#b76633] bg-white p-4 text-sm text-[#2f3438] shadow-xl">
      <p>{message || 'A previous request is saved in this tab. Retry its original details before starting another enquiry. Once received, NexDoor retains your request even if you close this tab.'}</p>
      {pending.map(entry => <div key={entry.kind} className="mt-2 flex flex-wrap gap-3">
        <button type="button" disabled={busy || entry.phase === 'review'} onClick={() => retry(entry.kind)} className="underline disabled:opacity-50">Retry saved {entry.kind === 'lead' ? 'report request' : entry.kind}</button>
        <button type="button" onClick={() => download(entry)} className="underline">Download saved details</button>
        {entry.phase === 'review' && <p>This request needs review. Please contact NexDoor with your saved details.</p>}
      </div>)}
      {pending.length === 0 && <button type="button" className="mt-2 underline" onClick={() => setMessage('')}>Dismiss</button>}
    </aside>
  ) : null
  return { deliver, recoveryPanel, busy }
}
