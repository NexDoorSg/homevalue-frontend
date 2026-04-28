import { NextRequest, NextResponse } from 'next/server'
import { getValuation } from '@/lib/valuation'

type Payload = {
  lat: number
  lon: number
  floorAreaSqm: number
  propertyType: string
  propertyCategory: 'hdb' | 'condo' | 'ec' | 'landed'
  landSizeSqm?: number
  builtUpSqm?: number
  tenure?: string
  floorLevel?: number
  subjectProjectName?: string | null
  subjectCompletionYear?: number | null
  subjectIsStrata?: boolean | null
  subjectAddress?: string | null
  subjectStreetName?: string | null
  subjectBlockNo?: string | null
  subjectCompletionYearHdb?: number | null
}

function readKey(request: NextRequest) {
  return request.headers.get('x-nexdoor-office-key') || ''
}

function validate(data: Partial<Payload>) {
  if (!Number.isFinite(Number(data.lat))) return 'Latitude is required.'
  if (!Number.isFinite(Number(data.lon))) return 'Longitude is required.'
  if (!Number.isFinite(Number(data.floorAreaSqm)) || Number(data.floorAreaSqm) <= 0) return 'Floor area is required.'
  if (!data.propertyType) return 'Property type is required.'
  if (!data.propertyCategory || !['hdb', 'condo', 'ec', 'landed'].includes(data.propertyCategory)) return 'Property category is required.'
  return null
}

export async function POST(request: NextRequest) {
  const expectedKey = process.env.NEXDOOR_OFFICE_INTERNAL_API_KEY

  if (!expectedKey) {
    return NextResponse.json({ error: 'Internal valuation access is not configured.' }, { status: 503 })
  }

  if (readKey(request) !== expectedKey) {
    return NextResponse.json({ error: 'Access denied.' }, { status: 401 })
  }

  try {
    const body = await request.json()
    const validationError = validate(body)
    if (validationError) return NextResponse.json({ error: validationError }, { status: 400 })

    const result = await getValuation({
      lat: Number(body.lat),
      lon: Number(body.lon),
      floorAreaSqm: Number(body.floorAreaSqm),
      propertyType: body.propertyType,
      propertyCategory: body.propertyCategory,
      landSizeSqm: body.landSizeSqm ? Number(body.landSizeSqm) : undefined,
      builtUpSqm: body.builtUpSqm ? Number(body.builtUpSqm) : undefined,
      tenure: body.tenure || undefined,
      floorLevel: body.floorLevel ? Number(body.floorLevel) : undefined,
      subjectProjectName: body.subjectProjectName || null,
      subjectCompletionYear: body.subjectCompletionYear ? Number(body.subjectCompletionYear) : null,
      subjectIsStrata: typeof body.subjectIsStrata === 'boolean' ? body.subjectIsStrata : null,
      subjectAddress: body.subjectAddress || null,
      subjectStreetName: body.subjectStreetName || null,
      subjectBlockNo: body.subjectBlockNo || null,
      subjectCompletionYearHdb: body.subjectCompletionYearHdb ? Number(body.subjectCompletionYearHdb) : null,
    })

    return NextResponse.json({ result })
  } catch (error) {
    console.error('Internal valuation error:', error)
    return NextResponse.json({ error: 'Unable to generate valuation.' }, { status: 500 })
  }
}
