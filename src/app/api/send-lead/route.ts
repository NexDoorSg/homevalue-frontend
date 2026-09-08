import { capture, deliverDue, parseCapture } from '@/lib/homevalueOutbox'
import { outboxRPC } from '@/lib/homevalueOutboxServer'
export const maxDuration = 60
const reply = (status: number, body: object) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } })
export async function POST(req: Request) {
  if (process.env.HOMEVALUE_DURABLE_INTAKE_ENABLED !== 'true') return reply(503, { success: false })
  if (req.headers.get('origin') !== new URL(req.url).origin || req.headers.get('sec-fetch-site') === 'cross-site') return reply(403, { success: false })
  if (!req.headers.get('content-type')?.startsWith('application/json')) return reply(400, { success: false })
  let input
  try {
    const reader = req.body?.getReader(); if (!reader) throw new Error()
    let bytes = 0; const chunks: Uint8Array[] = []
    const timer = setTimeout(() => { void reader.cancel().catch(() => {}) }, 5000)
    try {
      while (true) {
        const { value, done } = await reader.read(); if (done) break
        bytes += value.length; if (bytes > 32000) { await reader.cancel(); throw new Error() }
        chunks.push(value)
      }
      input = parseCapture(JSON.parse(Buffer.concat(chunks).toString('utf8')))
    } finally { clearTimeout(timer); reader.releaseLock() }
  } catch { return reply(400, { success: false }) }
  try {
    const rpc = outboxRPC()
    const result = await capture(rpc, input)
    if (!result.ok) return reply(result.review ? 409 : 503, { success: false })
    // Capture success means durable receipt, not necessarily Office delivery.
    // It remains recoverable after the browser closes or this process terminates.
    if (result.state === 'pending') {
      try { await deliverDue(rpc, { officeUrl: process.env.NEXDOOR_OFFICE_URL, token: process.env.HOMEVALUE_OFFICE_SYNC_TOKEN }, input.id) }
      catch { /* Durable pending row/lease is recovered by the runner. */ }
    }
    return reply(200, { success: true, captured: true })
  } catch { return reply(503, { success: false }) }
}
