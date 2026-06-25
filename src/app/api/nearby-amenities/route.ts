import { NextRequest, NextResponse } from 'next/server'

// CORS so the public endpoint can be called from the calculator and elsewhere.
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

function json(body: unknown, init?: { status?: number }) {
  return NextResponse.json(body, { status: init?.status ?? 200, headers: CORS_HEADERS })
}

export function OPTIONS() {
  return new NextResponse(null, { status: 200, headers: CORS_HEADERS })
}

type AmenityType = 'mrt' | 'school' | 'hawker'

const THEME_QUERY: Record<AmenityType, string> = {
  mrt: 'mrt_lrt_station',
  school: 'primaryschool',
  hawker: 'hawkercentre',
}

const RADIUS_M = 1000
const MAX_RESULTS = 10

type ThemeRow = {
  NAME?: string
  DESCRIPTION?: string
  LatLng?: string
  [key: string]: unknown
}

// Haversine distance in metres between two lat/lon points.
function distanceM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLon = toRad(lon2 - lon1)
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(a))
}

async function getOneMapToken(): Promise<string | null> {
  const email = process.env.ONEMAP_EMAIL
  const password = process.env.ONEMAP_PASSWORD
  if (!email || !password) return null

  const res = await fetch('https://www.onemap.gov.sg/api/auth/post/getToken', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  if (!res.ok) {
    console.error('OneMap getToken failed:', res.status)
    return null
  }
  const data = (await res.json()) as { access_token?: string }
  return data.access_token || null
}

export async function GET(request: NextRequest) {
  try {
    const params = request.nextUrl.searchParams
    const lat = Number(params.get('lat'))
    const lon = Number(params.get('lon'))
    const type = (params.get('type') || '').toLowerCase() as AmenityType

    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      return json({ error: 'Valid lat and lon are required.' }, { status: 400 })
    }
    if (!['mrt', 'school', 'hawker'].includes(type)) {
      return json({ error: 'type must be one of mrt, school, hawker.' }, { status: 400 })
    }

    const token = await getOneMapToken()
    if (!token) {
      return json({ error: 'OneMap authentication is not configured.' }, { status: 503 })
    }

    const themeUrl = `https://www.onemap.gov.sg/api/public/themesvc/retrieveTheme?queryName=${THEME_QUERY[type]}`
    const themeRes = await fetch(themeUrl, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!themeRes.ok) {
      console.error('OneMap retrieveTheme failed:', themeRes.status)
      return json({ error: 'Unable to fetch amenities.' }, { status: 502 })
    }
    const themeData = (await themeRes.json()) as { SrchResults?: ThemeRow[] }

    // SrchResults[0] is a summary record; the rest are amenity rows.
    const rows = Array.isArray(themeData.SrchResults) ? themeData.SrchResults.slice(1) : []

    const results = rows
      .map((row) => {
        if (!row.LatLng) return null
        const [rlat, rlon] = String(row.LatLng).split(',').map(Number)
        if (!Number.isFinite(rlat) || !Number.isFinite(rlon)) return null
        return {
          name: row.NAME || row.DESCRIPTION || 'Unknown',
          lat: rlat,
          lon: rlon,
          distance_m: Math.round(distanceM(lat, lon, rlat, rlon)),
        }
      })
      .filter((r): r is { name: string; lat: number; lon: number; distance_m: number } => r !== null)
      .filter((r) => r.distance_m <= RADIUS_M)
      .sort((a, b) => a.distance_m - b.distance_m)
      .slice(0, MAX_RESULTS)

    return json({ results, type, lat, lon })
  } catch (error) {
    console.error('nearby-amenities error:', error)
    return json({ error: 'Unable to fetch amenities.' }, { status: 500 })
  }
}
