'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
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
      saveLocal: async entry => {
        if (entry.kind === 'intent') {
          if (entry.updateId) {
            const { error } = await supabase.from('leads').update(entry.local).eq('id', entry.updateId).abortSignal(AbortSignal.timeout(30000))
            if (error) throw new Error('Save not confirmed')
          }
          return entry.updateId ?? null
        }
        const { data, error } = await supabase.from('leads').insert([entry.local]).select('id').abortSignal(AbortSignal.timeout(30000))
        if (error || !data?.[0]?.id) throw new Error('Save not confirmed')
        try { onLocalSaved?.() } catch { /* Existing analytics must not affect receipt recovery. */ }
        return data[0].id
      },
      send: async payload => {
        const response = await fetch('/api/send-lead', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload), signal: AbortSignal.timeout(45000),
        })
        if (response.status === 400 || response.status === 409) return 'review'
        const result = await response.json().catch(() => null)
        return response.ok && result?.success === true
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
      setMessage(result.ok ? 'Your saved request was received. You can continue with your report or enquiry.' : result.error || 'Receipt not confirmed.')
    } finally { setBusy(false) }
  }
  function download(entry: Saved) {
    const url = URL.createObjectURL(new Blob([JSON.stringify(entry, null, 2)], { type: 'application/json' }))
    const a = document.createElement('a'); a.href = url; a.download = 'homevalue-saved-request.json'; a.click()
    URL.revokeObjectURL(url)
  }
  const recoveryPanel = (pending.length > 0 || message) ? (
    <aside role="status" className="fixed bottom-4 left-4 right-4 z-[100] mx-auto max-w-xl rounded-xl border border-[#b76633] bg-white p-4 text-sm text-[#2f3438] shadow-xl">
      <p>{message || 'A previous request is saved in this tab. Retry its original details before starting another enquiry. Saved details expire after 24 hours.'}</p>
      {pending.map(entry => <div key={entry.kind} className="mt-2 flex flex-wrap gap-3">
        <button type="button" disabled={busy || entry.phase === 'saving' || entry.phase === 'review'} onClick={() => retry(entry.kind)} className="underline disabled:opacity-50">Retry saved {entry.kind === 'lead' ? 'report request' : entry.kind}</button>
        <button type="button" onClick={() => download(entry)} className="underline">Download saved details</button>
        {(entry.phase === 'saving' || entry.phase === 'review') && <p>This request needs review. Please contact NexDoor with your saved details.</p>}
      </div>)}
      {pending.length === 0 && <button type="button" className="mt-2 underline" onClick={() => setMessage('')}>Dismiss</button>}
    </aside>
  ) : null
  return { deliver, recoveryPanel, busy }
}
