import { timingSafeEqual } from 'node:crypto'
import { deliverDue } from '@/lib/homevalueOutbox'
import { outboxRPC } from '@/lib/homevalueOutboxServer'
export const maxDuration = 60
export const dynamic = 'force-dynamic'
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET
  const received = Buffer.from(req.headers.get('authorization') || '')
  const expected = Buffer.from(`Bearer ${secret || ''}`)
  if (!secret || secret.length < 32 || received.length !== expected.length || !timingSafeEqual(received, expected)) return Response.json({ ok: false }, { status: 401 })
  if (process.env.HOMEVALUE_DURABLE_INTAKE_ENABLED !== 'true') return Response.json({ ok: false }, { status: 503 })
  try {
    const result = await deliverDue(outboxRPC(), { officeUrl: process.env.NEXDOOR_OFFICE_URL, token: process.env.HOMEVALUE_OFFICE_SYNC_TOKEN })
    return Response.json({ ok: !result.unavailable, processed: result.processed }, { status: result.unavailable ? 503 : 200, headers: { 'Cache-Control': 'no-store' } })
  } catch { return Response.json({ ok: false }, { status: 503 }) }
}
