import { createClient } from '@supabase/supabase-js'
import type { RPC } from './homevalueOutbox'
export function outboxRPC(): RPC {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Outbox unavailable')
  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
  return async (name, args) => {
    const { data, error } = await db.rpc(name, args).abortSignal(AbortSignal.timeout(10000))
    return { data, error: error ? { code: error.code } : null }
  }
}
