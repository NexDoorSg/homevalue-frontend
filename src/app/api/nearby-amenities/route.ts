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

// OneMap elastic-search terms per amenity type. The search API is public and
// needs no Bearer token, so there's no auth/token step here.
const SEARCH_VAL: Record<AmenityType, string> = {
  mrt: 'MRT Station',
  school: 'Primary School',
  hawker: 'Hawker Centre',
}

const RADIUS_M = 1000
const MAX_RESULTS = 10
// Safety cap on pagination (MRT is ~78 pages; this leaves headroom).
const MAX_PAGES = 120
// OneMap rate-limits bursts, so cap concurrent page fetches and retry on 429.
const PAGE_CONCURRENCY = 4
const MAX_RETRIES = 4

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

type SearchRow = {
  SEARCHVAL?: string
  BUILDING?: string
  ADDRESS?: string
  LATITUDE?: string
  LONGITUDE?: string
  [key: string]: unknown
}

type SearchResponse = {
  found?: number
  totalNumPages?: number
  pageNum?: number
  results?: SearchRow[]
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

function searchUrl(searchVal: string, pageNum: number): string {
  const q = encodeURIComponent(searchVal)
  return `https://www.onemap.gov.sg/api/common/elastic/search?searchVal=${q}&returnGeom=Y&getAddrDetails=Y&pageNum=${pageNum}`
}

async function fetchSearchPage(searchVal: string, pageNum: number): Promise<SearchResponse> {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    let res: Response
    try {
      res = await fetch(searchUrl(searchVal, pageNum))
    } catch (err) {
      if (attempt < MAX_RETRIES) {
        await sleep(250 * 2 ** attempt)
        continue
      }
      console.error(`OneMap search network error (page ${pageNum}):`, err)
      throw new Error(`OneMap search request failed: ${err instanceof Error ? err.message : String(err)}`)
    }

    // Back off and retry on rate-limit / transient server errors.
    if ((res.status === 429 || res.status >= 500) && attempt < MAX_RETRIES) {
      await sleep(250 * 2 ** attempt)
      continue
    }
    if (!res.ok) {
      const body = await res.text().catch(() => '<unreadable body>')
      console.error(`OneMap search failed (page ${pageNum}): HTTP ${res.status} ${res.statusText} — ${body}`)
      throw new Error(`OneMap search failed (HTTP ${res.status}): ${body}`)
    }
    return (await res.json()) as SearchResponse
  }
  // Unreachable: the loop either returns or throws.
  throw new Error('OneMap search exhausted retries.')
}

// Fetch every page of search results for the term (results are relevance-ranked,
// not proximity-ranked, so we need them all before filtering by distance).
// Pages are fetched with bounded concurrency to respect OneMap's rate limits.
async function fetchAllSearchResults(searchVal: string): Promise<SearchRow[]> {
  const first = await fetchSearchPage(searchVal, 1)
  const rows: SearchRow[] = [...(first.results || [])]

  const totalPages = Math.min(first.totalNumPages || 1, MAX_PAGES)
  if (totalPages <= 1) return rows

  const pages = Array.from({ length: totalPages - 1 }, (_, i) => i + 2)
  let cursor = 0
  async function worker() {
    while (cursor < pages.length) {
      const pageNum = pages[cursor++]
      const page = await fetchSearchPage(searchVal, pageNum)
      rows.push(...(page.results || []))
    }
  }
  await Promise.all(Array.from({ length: Math.min(PAGE_CONCURRENCY, pages.length) }, worker))
  return rows
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

    const rows = await fetchAllSearchResults(SEARCH_VAL[type])

    // Parse coords, keep within radius, and dedupe by name (a station/centre can
    // appear multiple times for different exits/addresses — keep the nearest).
    const nearest = new Map<string, { name: string; lat: number; lon: number; distance_m: number }>()
    for (const row of rows) {
      const rlat = Number(row.LATITUDE)
      const rlon = Number(row.LONGITUDE)
      if (!Number.isFinite(rlat) || !Number.isFinite(rlon)) continue
      const distance_m = Math.round(distanceM(lat, lon, rlat, rlon))
      if (distance_m > RADIUS_M) continue
      const name = row.SEARCHVAL || row.BUILDING || row.ADDRESS || 'Unknown'
      const existing = nearest.get(name)
      if (!existing || distance_m < existing.distance_m) {
        nearest.set(name, { name, lat: rlat, lon: rlon, distance_m })
      }
    }

    const results = [...nearest.values()]
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
