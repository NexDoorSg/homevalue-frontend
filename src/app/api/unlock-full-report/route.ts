// No current form calls this legacy URL. Keep it on the same validated atomic
// capture boundary so it cannot create a local Lead without a durable handoff.
// Legacy payloads without an immutable submission identity fail before writing.
export { POST } from '../send-lead/route'
export const maxDuration = 60
