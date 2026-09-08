// Browser convenience for uncertain capture responses. The server outbox owns
// recovery after atomic capture, independently of this tab.
export type Kind = 'lead' | 'consultation' | 'intent'
export type Draft = { kind: Kind; local: Record<string, unknown>; office: Record<string, unknown>; updateId?: number | null }
export type Saved = Draft & { version: 2; expires: number; phase: 'prepared' | 'review' | 'done'; localId?: number | null; fingerprint: string; parentSubmissionId?: string }
export type Result = { ok: boolean; error?: string; localId?: number | null }
export const RECOVERY_KEY = 'homevalue-lead-recovery-v2'
export const RECOVERY_MESSAGE = 'Receipt is not confirmed. Your original details are saved in this tab. Retry the saved request below.'
const kinds: Kind[] = ['lead', 'consultation', 'intent']
export function createLeadRecovery(deps: {
  storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
  send: (entry: Saved) => Promise<boolean | 'review'>;
  now?: () => number; uuid?: () => string;
}) {
  const now = deps.now || Date.now
  const uuid = deps.uuid || (() => crypto.randomUUID())
  let entries: Partial<Record<Kind, Saved>> = {}
  let locked = false
  const persist = () => deps.storage.setItem(RECOVERY_KEY, JSON.stringify(entries))
  try {
    const raw = deps.storage.getItem(RECOVERY_KEY)
    if (raw && raw.length <= 200000) {
      const parsed = JSON.parse(raw)
      for (const kind of kinds) {
        const e = parsed?.[kind]
        if (e?.version === 2 && e.kind === kind && (e.phase !== 'done' || e.expires > now())
          && ['prepared', 'review', 'done'].includes(e.phase) && typeof e.fingerprint === 'string'
          && e.office && e.local && typeof e.office.submissionId === 'string' && typeof e.office.submittedAt === 'string') entries[kind] = e
      }
    }
    persist() // Expire completed conveniences only; never replace an uncertain submission UUID.
  } catch { entries = {} }
  const pending = () => Object.values(entries).filter(e => e.phase !== 'done')
  async function execute(e: Saved): Promise<Result> {
    if (locked) return { ok: false, error: 'Please wait for the current request.' }
    locked = true
    try {
      if (e.phase === 'done') return { ok: true, localId: e.localId }
      if (e.phase === 'review') return { ok: false, error: 'Your saved request needs review. Download its details and contact NexDoor.' }
      persist() // Require recovery storage before any network side effect.
      const sent = await deps.send(e)
      if (sent === 'review') { e.phase = 'review'; persist(); return { ok: false, error: 'Your saved request needs review. Download its details and contact NexDoor.' } }
      if (!sent) return { ok: false, error: RECOVERY_MESSAGE }
      e.phase = 'done'; persist()
      return { ok: true, localId: e.localId }
    } catch { return { ok: false, error: RECOVERY_MESSAGE } }
    finally { locked = false }
  }
  return {
    pending,
    async submit(draft: Draft): Promise<Result> {
      if (locked) return { ok: false, error: 'Please wait for the current request.' }
      // Freeze before the first attempt. Edits never replace a pending identity.
      const fingerprint = JSON.stringify(draft)
      let entry = entries[draft.kind]
      if (entry && entry.phase !== 'done' && entry.fingerprint !== fingerprint) return { ok: false, error: RECOVERY_MESSAGE }
      if (!entry || (entry.phase === 'done' && entry.fingerprint !== fingerprint)) {
        entry = JSON.parse(JSON.stringify({ ...draft, version: 2, fingerprint, expires: now() + 86400000, phase: 'prepared',
          office: { ...draft.office, submissionId: uuid(), submittedAt: new Date(now()).toISOString() },
          ...(draft.kind === 'intent' ? { parentSubmissionId: entries.lead?.office.submissionId } : {}) })) as Saved
        entries[draft.kind] = entry
      }
      return execute(entry)
    },
    async retry(kind: Kind): Promise<Result> {
      const entry = entries[kind]
      return entry ? execute(entry) : { ok: false, error: 'No saved request.' }
    },
  }
}
