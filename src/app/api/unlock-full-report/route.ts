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

    const name = String(body.name || '').trim()
    const phone = String(body.phone || '').trim()
    const email = String(body.email || '').trim().toLowerCase()
    const address = body.address ? String(body.address).trim() : null
    const unit_number = body.unit_number ? String(body.unit_number).trim() : null
    const unit_type = body.unit_type ? String(body.unit_type).trim() : null
    const floor_area_sqm =
      body.floor_area_sqm !== null && body.floor_area_sqm !== undefined
        ? Number(body.floor_area_sqm)
        : null

    if (!name || !phone || !email) {
      return NextResponse.json(
        { ok: false, error: 'Missing required fields' },
        { status: 400 }
      )
    }

    const thirtyDaysAgo = new Date()
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)

    const { data: existingRows, error: countError } = await supabase
      .from('leads')
      .select('id, created_at')
      .eq('email', email)
      .eq('plan', 'full_report')
      .gte('created_at', thirtyDaysAgo.toISOString())

    if (countError) {
      console.error('unlock-full-report count error:', countError)
      return NextResponse.json(
        { ok: false, error: countError.message },
        { status: 500 }
      )
    }

    const count = existingRows?.length || 0

    if (count >= 3) {
      return NextResponse.json({
        ok: true,
        reachedLimit: true,
        message:
          'You’ve reached the free full-report limit for the past 30 days. Please contact us directly and we’ll be happy to help.',
      })
    }

    const leadPayload = {
      name,
      phone,
      email,
      address,
      unit_number,
      unit_type,
      floor_area_sqm,
      plan: 'full_report',
    }

    const { error: insertError } = await supabase.from('leads').insert([leadPayload])

    if (insertError) {
      console.error('unlock-full-report insert error:', insertError)
      return NextResponse.json(
        { ok: false, error: insertError.message },
        { status: 500 }
      )
    }

    return NextResponse.json({
      ok: true,
      reachedLimit: false,
      inserted: true,
      leadPayload,
    })
  } catch (error) {
    console.error('unlock-full-report route crash:', error)
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : 'Unexpected server error',
      },
      { status: 500 }
    )
  }
}
