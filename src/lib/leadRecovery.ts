// Browser-only recovery, not a CRM queue. At most one request per form kind,
// retained in this tab for 24 hours. Office retains canonical receipt ownership.
export type Kind = 'lead' | 'consultation' | 'intent'
export type Draft = { kind: Kind; local: Record<string, unknown>; office: Record<string, unknown>; updateId?: number | null }
export type Saved = Draft & { version: 1; expires: number; phase: 'prepared' | 'saving' | 'saved' | 'review' | 'done'; localId?: number | null; fingerprint: string }
export type Result = { ok: boolean; error?: string; localId?: number | null }
export const RECOVERY_KEY = 'homevalue-lead-recovery-v1'
export const RECOVERY_MESSAGE = 'Receipt is not confirmed. Your original details are saved in this tab. Retry the saved request below.'
const kinds: Kind[] = ['lead', 'consultation', 'intent']
export function createLeadRecovery(deps: {
  storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
  saveLocal: (entry: Saved) => Promise<number | null>;
  send: (payload: Record<string, unknown>) => Promise<boolean | 'review'>;
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
        if (e?.version === 1 && e.kind === kind && e.expires > now() && e.expires <= now() + 86400000
          && ['prepared', 'saving', 'saved', 'review', 'done'].includes(e.phase) && typeof e.fingerprint === 'string'
          && e.office && e.local && typeof e.office.submissionId === 'string' && typeof e.office.submittedAt === 'string') entries[kind] = e
      }
    }
    persist() // Remove expired entries; blocked storage prevents any new writes.
  } catch { entries = {} }
  const pending = () => Object.values(entries).filter(e => e.phase !== 'done')
  async function execute(e: Saved): Promise<Result> {
    if (locked) return { ok: false, error: 'Please wait for the current request.' }
    locked = true
    try {
      if (e.expires <= now()) return { ok: false, error: 'This saved request has expired. Download it and contact NexDoor for review.' }
      if (e.phase === 'done') return { ok: true, localId: e.localId }
      if (e.phase === 'review') return { ok: false, error: 'Your saved request needs review. Download its details and contact NexDoor.' }
      if (e.phase === 'saving') return { ok: false, error: 'The initial save could not be confirmed. Download your details and contact NexDoor before submitting again.' }
      persist() // Require recovery storage before any network side effect.
      if (e.phase === 'prepared') {
        e.phase = 'saving'; persist()
        e.localId = await deps.saveLocal(e)
        e.phase = 'saved'; persist()
      }
      const sent = await deps.send(e.office)
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
        entry = JSON.parse(JSON.stringify({ ...draft, version: 1, fingerprint, expires: now() + 86400000, phase: 'prepared',
          office: { ...draft.office, submissionId: uuid(), submittedAt: new Date(now()).toISOString() } })) as Saved
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
