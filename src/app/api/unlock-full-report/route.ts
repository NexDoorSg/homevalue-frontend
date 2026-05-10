import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

const whatsappAccessToken = process.env.WHATSAPP_ACCESS_TOKEN
const whatsappPhoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID
const whatsappTemplateName = process.env.WHATSAPP_TEMPLATE_NAME || 'homevalue_intro'
const whatsappTemplateLanguageCode =
  process.env.WHATSAPP_TEMPLATE_LANGUAGE_CODE || 'en'
const whatsappConsultantName =
  process.env.WHATSAPP_CONSULTANT_NAME || 'Bjorn Lim'
const whatsappConsultantPhone =
  process.env.WHATSAPP_CONSULTANT_PHONE || '+65 9139 1363'

if (!supabaseUrl) {
  throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL')
}

if (!serviceRoleKey) {
  throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY')
}

const supabase = createClient(supabaseUrl, serviceRoleKey)

function normaliseWhatsappRecipient(phone: string) {
  const digitsOnly = phone.replace(/\D/g, '')

  if (!digitsOnly) {
    return null
  }

  if (digitsOnly.startsWith('65')) {
    return digitsOnly
  }

  if (digitsOnly.length === 8) {
    return `65${digitsOnly}`
  }

  return digitsOnly
}

async function sendHomeValueWhatsappIntro({
  name,
  phone,
}: {
  name: string
  phone: string
}) {
  if (!whatsappAccessToken || !whatsappPhoneNumberId) {
    console.warn(
      'WhatsApp intro skipped: missing WHATSAPP_ACCESS_TOKEN or WHATSAPP_PHONE_NUMBER_ID'
    )
    return
  }

  const recipient = normaliseWhatsappRecipient(phone)

  if (!recipient) {
    console.warn('WhatsApp intro skipped: invalid phone number')
    return
  }

  const response = await fetch(
    `https://graph.facebook.com/v20.0/${whatsappPhoneNumberId}/messages`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${whatsappAccessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: recipient,
        type: 'template',
        template: {
          name: whatsappTemplateName,
          language: {
            code: whatsappTemplateLanguageCode,
          },
          components: [
            {
              type: 'body',
              parameters: [
                {
                  type: 'text',
                  text: name,
                },
                {
                  type: 'text',
                  text: whatsappConsultantName,
                },
                {
                  type: 'text',
                  text: whatsappConsultantPhone,
                },
              ],
            },
          ],
        },
      }),
    }
  )

  if (!response.ok) {
    const errorText = await response.text()
    console.error('WhatsApp intro send failed:', errorText)
    return
  }

  console.info('WhatsApp intro sent for HomeValue lead')
}

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

    try {
      await sendHomeValueWhatsappIntro({ name, phone })
    } catch (whatsappError) {
      console.error('WhatsApp intro route error:', whatsappError)
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
