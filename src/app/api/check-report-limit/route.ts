import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl) {
  throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL')
}

if (!serviceRoleKey) {
  throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY')
}

const supabase = createClient(supabaseUrl, serviceRoleKey)

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const email = String(body.email || '').trim().toLowerCase()

    if (!email) {
      return NextResponse.json(
        { ok: false, error: 'Email is required' },
        { status: 400 }
      )
    }

    const thirtyDaysAgo = new Date()
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)

    const { data, error } = await supabase
      .from('leads')
      .select('id, email, plan, created_at')
      .eq('email', email)
      .eq('plan', 'full_report')
      .gte('created_at', thirtyDaysAgo.toISOString())

    console.log('CHECK LIMIT ROUTE EMAIL:', email)
    console.log('CHECK LIMIT ROUTE SINCE:', thirtyDaysAgo.toISOString())
    console.log('CHECK LIMIT ROUTE DATA:', data)
    console.log('CHECK LIMIT ROUTE ERROR:', error)

    if (error) {
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: 500 }
      )
    }

    const count = data?.length || 0

    return NextResponse.json({
      ok: true,
      reachedLimit: count >= 3,
      count,
    })
  } catch (error) {
    console.error('check-report-limit route crash:', error)

    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : 'Unexpected server error',
      },
      { status: 500 }
    )
  }
}
