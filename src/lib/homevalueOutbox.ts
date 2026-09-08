import { buildLeadSyncPayload } from './propertyIdentity'
import { parseHomeValueWhatsAppConsent } from './whatsappConsent'

export type RPC = (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { code?: string } | null }>
export type Capture = { id: string; at: string; kind: string; payload: Record<string, unknown>; parent: string | null }
const uuid = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(v)
const textFields = ['name','phone','email','address','unit_number','unit_type','tenure','plan','project_name','postal_code','source']
const numberFields = ['floor_area_sqm','estimated_price','estimated_low','estimated_high','num_of_comps','radius_used_m']
export function parseCapture(value: unknown, now = Date.now()): Capture {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('input')
  const b = value as Record<string, unknown>
  if (Object.keys(b).some(k => !['version','kind','submission','parentSubmissionId'].includes(k)) || b.version !== 1
    || !['lead','consultation','intent'].includes(String(b.kind)) || !b.submission || typeof b.submission !== 'object' || Array.isArray(b.submission)) throw new Error('input')
  const s = b.submission as Record<string, unknown>
  if (Object.keys(s).some(k => ![...textFields,...numberFields,'submissionId','submittedAt','whatsappConsent'].includes(k)) || !uuid(s.submissionId)
    || typeof s.submittedAt !== 'string' || !Number.isFinite(Date.parse(s.submittedAt))
    || new Date(s.submittedAt).toISOString() !== s.submittedAt || Date.parse(s.submittedAt) > now || Date.parse(s.submittedAt) < Date.parse('2026-01-01')) throw new Error('input')
  for (const key of textFields) if (s[key] != null && (typeof s[key] !== 'string' || (s[key] as string).length > (key === 'address' ? 1000 : 200))) throw new Error('input')
  for (const key of numberFields) if (s[key] != null && (typeof s[key] !== 'number' || !Number.isFinite(s[key]) || s[key] < 0 || s[key] > 1e12)) throw new Error('input')
  for (const key of ['num_of_comps','radius_used_m']) if (s[key] != null && !Number.isInteger(s[key])) throw new Error('input')
  if (typeof s.name !== 'string' || !s.name.trim() || typeof s.phone !== 'string' || !/^\+?[0-9 ()-]{8,25}$/.test(s.phone)) throw new Error('input')
  const parent = b.parentSubmissionId ?? null
  if ((b.kind === 'intent' && (!uuid(parent) || typeof s.plan !== 'string' || !s.plan.trim())) || (b.kind !== 'intent' && parent !== null)) throw new Error('input')
  const consent = parseHomeValueWhatsAppConsent(s.whatsappConsent, new Date(now))
  if (consent && Date.parse(consent.grantedAt) > Date.parse(s.submittedAt)) throw new Error('input')
  // Payload is normalized once before durable capture, never rebuilt by a worker.
  const payload = buildLeadSyncPayload({ ...s, source: 'HomeValue', pageSource: 'HomeValue', whatsappConsent: consent }, {
    canonicalProjectName: s.project_name, postalCode: s.postal_code, address: s.address, unitNumber: s.unit_number,
  })
  return { id: s.submissionId, at: s.submittedAt, kind: String(b.kind), payload, parent: parent as string | null }
}
export async function capture(rpc: RPC, input: Capture) {
  const result = await rpc('homevalue_capture_handoff', { p_id: input.id, p_at: input.at, p_kind: input.kind, p_payload: input.payload, p_parent: input.parent })
  if (result.error) return { ok: false, review: result.error.code === '22023' }
  const state = (result.data as { state?: string })?.state
  return { ok: ['pending','review','delivered'].includes(state || ''), review: state === 'review', state }
}
export async function deliverDue(rpc: RPC, config: { officeUrl?: string; token?: string }, id: string | null = null, send = fetch) {
  // Configuration failures leave records durably pending; do not spend leases.
  let endpoint: URL
  try {
    endpoint = new URL('/api/leads', config.officeUrl)
    if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || !config.token) throw new Error()
  } catch { return { processed: 0, unavailable: true } }
  const claimed = await rpc('homevalue_claim_handoffs', { p_id: id, p_limit: 10 })
  if (claimed.error || !Array.isArray(claimed.data)) return { processed: 0, unavailable: true }
  const rows = claimed.data as { submission_id: string; lease_id: string; office_payload: Record<string, unknown> }[]
  const outcomes = await Promise.all(rows.map(async row => {
    let state = 'pending', code: string | null = 'transport', status: number | null = null
    try {
      const response = await send(endpoint.toString(), {
        method: 'POST', redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(30000),
        headers: { 'Content-Type': 'application/json', 'x-nexdoor-source': 'HomeValue', 'x-nexdoor-sync-token': config.token! },
        body: JSON.stringify(row.office_payload),
      })
      status = response.status; code = response.ok ? null : 'office_response'
      state = response.ok ? 'delivered' : [400,409,422].includes(status) ? 'review' : 'pending'
      // Office response contains CRM data. Do not parse, return or log it.
      await response.body?.cancel()
    } catch { /* Uncertain outcome: only the identical canonical intake is retried. */ }
    try {
      const saved = await rpc('homevalue_finish_handoff', { p_id: row.submission_id, p_lease: row.lease_id, p_state: state, p_code: code, p_status: status })
      return !saved.error && saved.data === true
    } catch { return false } // Lease expiry safely recovers a crash after Office commit.
  }))
  return { processed: rows.length, unavailable: outcomes.some(ok => !ok) }
}
