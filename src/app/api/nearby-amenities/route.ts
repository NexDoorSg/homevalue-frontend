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

async function getOneMapToken(): Promise<string> {
  const email = process.env.ONEMAP_EMAIL
  const password = process.env.ONEMAP_PASSWORD
  if (!email || !password) {
    throw new Error('OneMap credentials are not configured (set ONEMAP_EMAIL and ONEMAP_PASSWORD).')
  }

  let res: Response
  try {
    res = await fetch('https://www.onemap.gov.sg/api/auth/post/getToken', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    })
  } catch (err) {
    console.error('OneMap getToken network error:', err)
    throw new Error(`OneMap getToken request failed: ${err instanceof Error ? err.message : String(err)}`)
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '<unreadable body>')
    console.error(`OneMap getToken failed: HTTP ${res.status} ${res.statusText} — ${body}`)
    throw new Error(`OneMap getToken failed (HTTP ${res.status}): ${body}`)
  }

  const data = (await res.json()) as { access_token?: string }
  if (!data.access_token) {
    console.error('OneMap getToken returned no access_token:', JSON.stringify(data))
    throw new Error(`OneMap getToken returned no access_token: ${JSON.stringify(data)}`)
  }
  return data.access_token
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

    const themeUrl = `https://www.onemap.gov.sg/api/public/themesvc/retrieveTheme?queryName=${THEME_QUERY[type]}`
    const themeRes = await fetch(themeUrl, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!themeRes.ok) {
      const body = await themeRes.text().catch(() => '<unreadable body>')
      console.error(`OneMap retrieveTheme failed: HTTP ${themeRes.status} ${themeRes.statusText} — ${body}`)
      throw new Error(`OneMap retrieveTheme failed (HTTP ${themeRes.status}): ${body}`)
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
    // Surface the actual failure so it's visible from the calling frontend.
    const message = error instanceof Error ? error.message : String(error)
    console.error('nearby-amenities error:', error)
    return json({ error: message }, { status: 500 })
  }
}
