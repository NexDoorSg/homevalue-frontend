// Versioned notice shared with HomeValue's authenticated Office sync contract.
export const HOMEVALUE_WHATSAPP_NOTICE_VERSION = 'homevalue-whatsapp-v1'
export const HOMEVALUE_WHATSAPP_NOTICE = 'I agree that NexDoor may contact me on WhatsApp about this enquiry, including an acknowledgement and follow-up from my assigned consultant. I can opt out at any time by replying STOP.'
export type HomeValueWhatsAppConsent = { granted: true; grantedAt: string; noticeVersion: string; evidenceId: string }

// Match the transactional capture boundary's one-minute browser clock tolerance.
export const HOMEVALUE_CAPTURE_CLOCK_SKEW_MS = 60_000

// Missing/declined consent never prevents Lead capture. Malformed affirmative evidence fails closed.
export function parseHomeValueWhatsAppConsent(value: unknown, now = new Date()): HomeValueWhatsAppConsent | null {
  if (value == null) return null
  if (typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid WhatsApp consent evidence')
  const v = value as Record<string, unknown>
  if (v.granted !== true || v.noticeVersion !== HOMEVALUE_WHATSAPP_NOTICE_VERSION
    || typeof v.evidenceId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v.evidenceId)
    || typeof v.grantedAt !== 'string') throw new Error('Invalid WhatsApp consent evidence')
  const at = new Date(v.grantedAt)
  if (!Number.isFinite(at.getTime()) || at.toISOString() !== v.grantedAt || at.getTime() > now.getTime() + HOMEVALUE_CAPTURE_CLOCK_SKEW_MS || at.getUTCFullYear() < 2026)
    throw new Error('Invalid WhatsApp consent evidence')
  return { granted: true, grantedAt: v.grantedAt, noticeVersion: HOMEVALUE_WHATSAPP_NOTICE_VERSION, evidenceId: v.evidenceId }
}
