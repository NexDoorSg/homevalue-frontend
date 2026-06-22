import { NextRequest, NextResponse } from 'next/server'
import { getValuation } from '@/lib/valuation'
import { supabase } from '@/lib/supabase'

type PropertyCategory = 'hdb' | 'condo' | 'ec' | 'landed'

type Payload = {
  lat: number
  lon: number
  floorAreaSqm: number
  propertyType: string
  propertyCategory: PropertyCategory
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

type ComparableRow = {
  transaction_date: string | null
  address: string | null
  street_name: string | null
  project_name: string | null
  unit_type: string | null
  tenure: string | null
  transaction_price: number | string | null
  floor_area_sqm: number | string | null
  price_psf: number | string | null
  latitude: number | string | null
  longitude: number | string | null
  completion_year: number | string | null
  property_subtype: string | null
  property_group: string | null
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

function normalizeText(value: string | null | undefined) {
  return (value || '').toUpperCase().replace(/\s+/g, ' ').trim()
}

function distanceInMeters(lat1: number, lon1: number, lat2: number, lon2: number) {
  const dx = lat1 - lat2
  const dy = lon1 - lon2
  return Math.sqrt(dx * dx + dy * dy) * 111000
}

function getBoundingBox(lat: number, lon: number, radiusM: number) {
  const latDelta = radiusM / 111000
  const cosLat = Math.cos((lat * Math.PI) / 180)
  const safeCosLat = Math.max(Math.abs(cosLat), 0.2)
  const lonDelta = radiusM / (111000 * safeCosLat)
  return { minLat: lat - latDelta, maxLat: lat + latDelta, minLon: lon - lonDelta, maxLon: lon + lonDelta }
}

function extractBlockNumber(address: string | null | undefined) {
  const text = normalizeText(address)
  if (!text) return ''
  const match = text.match(/^(\d+[A-Z]?)\s/)
  return match ? match[1] : ''
}

function cleanComparableRows(rows: ComparableRow[], lat: number, lon: number) {
  return rows
    .map((row) => {
      const transactionPrice = Number(row.transaction_price)
      const areaSqm = Number(row.floor_area_sqm)
      const rowLat = Number(row.latitude)
      const rowLon = Number(row.longitude)
      const pricePsf = Number(row.price_psf)
      const calculatedPsf = transactionPrice / (areaSqm * 10.7639)
      return {
        transactionDate: row.transaction_date,
        address: row.address,
        streetName: row.street_name,
        projectName: row.project_name,
        unitType: row.unit_type,
        tenure: row.tenure,
        price: transactionPrice,
        sizeSqft: Math.round(areaSqm * 10.7639),
        psf: Number.isFinite(pricePsf) && pricePsf > 0 ? Math.round(pricePsf) : Math.round(calculatedPsf),
        distanceM: Math.round(distanceInMeters(lat, lon, rowLat, rowLon)),
        completionYear: row.completion_year ? Number(row.completion_year) : null,
        propertySubtype: row.property_subtype,
        propertyGroup: row.property_group,
      }
    })
    .filter((row) => Number.isFinite(row.price) && row.price > 0 && Number.isFinite(row.sizeSqft) && row.sizeSqft > 0 && Number.isFinite(row.distanceM))
}

async function getComparableTransactions(body: Payload) {
  const lat = Number(body.lat)
  const lon = Number(body.lon)
  const category = body.propertyCategory
  const box = getBoundingBox(lat, lon, category === 'landed' ? 5000 : 1500)

  let query = supabase
    .from('property_transactions_v2')
    .select('transaction_date, address, street_name, project_name, unit_type, tenure, transaction_price, floor_area_sqm, price_psf, latitude, longitude, completion_year, property_subtype, property_group')
    .gte('latitude', box.minLat)
    .lte('latitude', box.maxLat)
    .gte('longitude', box.minLon)
    .lte('longitude', box.maxLon)
    .not('transaction_price', 'is', null)
    .not('floor_area_sqm', 'is', null)
    .not('latitude', 'is', null)
    .not('longitude', 'is', null)
    .order('transaction_date', { ascending: false })
    .limit(category === 'landed' ? 300 : 500)

  if (category === 'hdb') {
    query = query.eq('property_group', 'hdb').eq('unit_type', normalizeText(body.propertyType))
  } else if (category === 'condo') {
    query = query
      .in('unit_type', ['Condominium', 'Apartment'])
      .in('property_subtype', ['condo', 'Resale', 'New Sale', 'Sub Sale'])
  } else if (category === 'ec') {
    query = query
      .in('unit_type', ['Executive Condominium'])
      .in('property_subtype', ['ec', 'Resale', 'New Sale', 'Sub Sale'])
  } else {
    query = query
      .in('unit_type', ['Detached House', 'Semi-Detached House', 'Terrace House'])
      .in('property_subtype', ['landed_strata', 'landed_non_strata', 'Resale', 'New Sale', 'Sub Sale'])
  }

  const { data, error } = await query
  if (error || !data) {
    console.error('Comparable transaction query error:', error)
    return { primary: [], nearby: [] }
  }

  const cleaned = cleanComparableRows(data as ComparableRow[], lat, lon)
    .sort((a, b) => {
      const dateA = a.transactionDate ? new Date(a.transactionDate).getTime() : 0
      const dateB = b.transactionDate ? new Date(b.transactionDate).getTime() : 0
      return dateB - dateA
    })

  if (category === 'hdb') {
    const subjectBlock = normalizeText(body.subjectBlockNo) || extractBlockNumber(body.subjectAddress)
    const primary = cleaned.filter((row) => extractBlockNumber(row.address) === subjectBlock).slice(0, 12)
    const nearby = cleaned.filter((row) => extractBlockNumber(row.address) !== subjectBlock).slice(0, 12)
    return { primary, nearby }
  }

  if (category === 'condo' || category === 'ec') {
    const subjectProject = normalizeText(body.subjectProjectName)
    const primary = subjectProject ? cleaned.filter((row) => normalizeText(row.projectName) === subjectProject).slice(0, 12) : []
    const nearby = cleaned.filter((row) => !subjectProject || normalizeText(row.projectName) !== subjectProject).slice(0, 12)
    return { primary, nearby }
  }

  return { primary: [], nearby: cleaned.slice(0, 15) }
}

export async function POST(request: NextRequest) {
  const expectedKey = process.env.NEXDOOR_OFFICE_INTERNAL_API_KEY
  if (!expectedKey) return NextResponse.json({ error: 'Internal valuation access is not configured.' }, { status: 503 })
  if (readKey(request) !== expectedKey) return NextResponse.json({ error: 'Access denied.' }, { status: 401 })

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

    const comparables = await getComparableTransactions(body)
    return NextResponse.json({ result, comparables })
  } catch (error) {
    console.error('Internal valuation error:', error)
    return NextResponse.json({ error: 'Unable to generate valuation.' }, { status: 500 })
  }
}
