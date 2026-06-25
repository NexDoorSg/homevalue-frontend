import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

// CORS so the public endpoint can be called from calculator.nexdoor.sg.
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

type PropertyCategory = 'hdb' | 'condo' | 'ec' | 'landed'

type TxRow = {
  street_name: string | null
  project_name: string | null
  transaction_price: number | string | null
  price_psf: number | string | null
  transaction_date: string | null
  postal_code: string | null
  floor_area_sqm: number | string | null
  latitude: number | string | null
  longitude: number | string | null
}

type MatchResult = {
  name: string
  medianPrice: number
  medianPsf: number
  txCount: number
  lastTxDate: string | null
  district: string
  typicalSizeMin: number | null
  typicalSizeMax: number | null
  lat: number | null
  lon: number | null
}

const SQFT_PER_SQM = 10.7639

// Singapore postal sector (first 2 digits of postal code) -> postal district.
// Source: standard URA/SingPost postal district map.
const SECTOR_TO_DISTRICT: Record<string, string> = {}
// Each entry maps an inclusive 2-digit sector range to its postal district.
const DISTRICT_SECTOR_RANGES: Array<[string, number, number]> = [
  ['D01', 1, 6],
  ['D02', 7, 8],
  ['D03', 9, 10],
  ['D04', 11, 11],
  ['D05', 12, 13],
  ['D06', 14, 14],
  ['D07', 15, 15],
  ['D08', 16, 16],
  ['D09', 17, 18],
  ['D10', 19, 21],
  ['D11', 22, 23],
  ['D12', 24, 27],
  ['D13', 28, 30],
  ['D14', 31, 32],
  ['D15', 33, 36],
  ['D16', 37, 40],
  ['D17', 41, 42],
  ['D18', 43, 44],
  ['D19', 45, 48],
  ['D20', 49, 52],
  ['D21', 53, 58],
  ['D22', 59, 62],
  ['D23', 63, 66],
  ['D24', 67, 68],
  ['D25', 69, 71],
  ['D26', 72, 73],
  ['D27', 75, 77],
  ['D28', 78, 82],
]
for (const [district, start, end] of DISTRICT_SECTOR_RANGES) {
  for (let sector = start; sector <= end; sector++) {
    SECTOR_TO_DISTRICT[String(sector).padStart(2, '0')] = district
  }
}

function districtFromPostal(postal: string | null | undefined): string | null {
  if (!postal) return null
  const trimmed = String(postal).trim().padStart(6, '0')
  const sector = trimmed.slice(0, 2)
  return SECTOR_TO_DISTRICT[sector] || null
}

function median(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

// Linear-interpolated percentile (p in [0, 1]) over an already-sorted array.
function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0
  if (sorted.length === 1) return sorted[0]
  const idx = (sorted.length - 1) * p
  const lo = Math.floor(idx)
  const hi = Math.ceil(idx)
  if (lo === hi) return sorted[lo]
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo)
}

// Fetch all matching rows in pages (Supabase caps a single response at ~1000 rows).
async function fetchTransactions(
  category: PropertyCategory,
  sinceDate: string,
  priceFloor: number,
  priceCeil: number,
  sizeMinSqm: number | null,
  sizeMaxSqm: number | null,
): Promise<TxRow[]> {
  const PAGE = 1000
  const MAX_ROWS = 10000
  const rows: TxRow[] = []

  for (let from = 0; from < MAX_ROWS; from += PAGE) {
    let query = supabase
      .from('property_transactions_v2')
      .select('street_name, project_name, transaction_price, price_psf, transaction_date, postal_code, floor_area_sqm, latitude, longitude')
      .gte('transaction_date', sinceDate)
      .gte('transaction_price', priceFloor)
      .lte('transaction_price', priceCeil)
      .not('transaction_price', 'is', null)
      .order('transaction_date', { ascending: false })
      .range(from, from + PAGE - 1)

    if (sizeMinSqm !== null) query = query.gte('floor_area_sqm', sizeMinSqm)
    if (sizeMaxSqm !== null) query = query.lte('floor_area_sqm', sizeMaxSqm)

    // Category filters mirror the valuation engine: combine unit_type with the
    // set of property_subtype tags (raw + transaction-type) seen in the dataset.
    if (category === 'hdb') {
      query = query.eq('property_group', 'hdb')
    } else if (category === 'condo') {
      query = query
        .in('unit_type', ['Condominium', 'Apartment'])
        .in('property_subtype', ['condo', 'Resale', 'New Sale', 'Sub Sale'])
    } else if (category === 'ec') {
      query = query
        .eq('unit_type', 'Executive Condominium')
        .in('property_subtype', ['ec', 'Resale', 'New Sale', 'Sub Sale'])
    } else {
      query = query
        .in('unit_type', ['Detached House', 'Semi-Detached House', 'Terrace House'])
        .in('property_subtype', ['landed_strata', 'landed_non_strata', 'Resale', 'New Sale', 'Sub Sale'])
    }

    const { data, error } = await query
    if (error) {
      console.error('project-matcher query error:', error)
      break
    }
    if (!data || data.length === 0) break
    rows.push(...(data as TxRow[]))
    if (data.length < PAGE) break
  }

  return rows
}

export async function GET(request: NextRequest) {
  try {
    const params = request.nextUrl.searchParams
    const budget = Number(params.get('budget'))
    const category = (params.get('category') || '').toLowerCase() as PropertyCategory

    if (!Number.isFinite(budget) || budget <= 0) {
      return json({ error: 'A valid budget is required.' }, { status: 400 })
    }
    if (!['hdb', 'condo', 'ec', 'landed'].includes(category)) {
      return json({ error: 'category must be one of hdb, condo, ec, landed.' }, { status: 400 })
    }

    const budgetMinParam = params.get('budgetMin')
    const budgetMin =
      budgetMinParam !== null && Number.isFinite(Number(budgetMinParam))
        ? Number(budgetMinParam)
        : Math.round(budget * 0.7)

    // Optional comma-separated district allow-list, e.g. "D09,D10,D11".
    const districtsParam = params.get('districts')
    const districts = districtsParam
      ? new Set(
          districtsParam
            .split(',')
            .map((d) => d.trim().toUpperCase())
            .filter(Boolean),
        )
      : null

    // Optional size band, supplied in sqft, filtered internally in sqm.
    const sizeMinParam = params.get('sizeMin')
    const sizeMaxParam = params.get('sizeMax')
    const sizeMinSqm =
      sizeMinParam !== null && Number.isFinite(Number(sizeMinParam)) && Number(sizeMinParam) > 0
        ? Number(sizeMinParam) / SQFT_PER_SQM
        : null
    const sizeMaxSqm =
      sizeMaxParam !== null && Number.isFinite(Number(sizeMaxParam)) && Number(sizeMaxParam) > 0
        ? Number(sizeMaxParam) / SQFT_PER_SQM
        : null

    // Last 24 months.
    const since = new Date()
    since.setMonth(since.getMonth() - 24)
    const sinceDate = since.toISOString().slice(0, 10)

    // Bound the fetch to a generous price band around the budget so medians stay
    // representative while keeping row volume manageable.
    const priceFloor = Math.max(0, Math.round(budgetMin * 0.6))
    const priceCeil = Math.round(budget * 1.4)

    const rows = await fetchTransactions(category, sinceDate, priceFloor, priceCeil, sizeMinSqm, sizeMaxSqm)

    // Grouping field per category: condo/EC by project, HDB by street/estate.
    // Landed transactions carry the estate name in project_name (street_name is
    // null in this dataset), so fall back to project_name when needed.
    const groupNameOf = (row: TxRow): string => {
      if (category === 'condo' || category === 'ec') return (row.project_name || '').toString().trim()
      if (category === 'landed') return (row.street_name || row.project_name || '').toString().trim()
      return (row.street_name || '').toString().trim()
    }

    type Group = {
      name: string
      prices: number[]
      psfs: number[]
      areasSqft: number[]
      lats: number[]
      lons: number[]
      lastTxDate: string | null
      districtCounts: Record<string, number>
    }
    const groups = new Map<string, Group>()

    for (const row of rows) {
      const name = groupNameOf(row)
      if (!name) continue
      const price = Number(row.transaction_price)
      if (!Number.isFinite(price) || price <= 0) continue

      let group = groups.get(name)
      if (!group) {
        group = { name, prices: [], psfs: [], areasSqft: [], lats: [], lons: [], lastTxDate: null, districtCounts: {} }
        groups.set(name, group)
      }
      group.prices.push(price)
      const psf = Number(row.price_psf)
      if (Number.isFinite(psf) && psf > 0) group.psfs.push(psf)
      const areaSqm = Number(row.floor_area_sqm)
      if (Number.isFinite(areaSqm) && areaSqm > 0) group.areasSqft.push(areaSqm * SQFT_PER_SQM)
      const lat = Number(row.latitude)
      if (Number.isFinite(lat) && lat !== 0) group.lats.push(lat)
      const lon = Number(row.longitude)
      if (Number.isFinite(lon) && lon !== 0) group.lons.push(lon)
      if (row.transaction_date && (!group.lastTxDate || row.transaction_date > group.lastTxDate)) {
        group.lastTxDate = row.transaction_date
      }
      const district = districtFromPostal(row.postal_code)
      if (district) group.districtCounts[district] = (group.districtCounts[district] || 0) + 1
    }

    const results: MatchResult[] = []
    for (const group of groups.values()) {
      const medianPrice = median(group.prices)
      if (medianPrice < budgetMin || medianPrice > budget) continue

      let district = '—'
      let topCount = 0
      for (const [d, count] of Object.entries(group.districtCounts)) {
        if (count > topCount) {
          topCount = count
          district = d
        }
      }

      // Typical size range = 25th–75th percentile floor area (sqft), to nearest 10.
      let typicalSizeMin: number | null = null
      let typicalSizeMax: number | null = null
      if (group.areasSqft.length > 0) {
        const sortedAreas = [...group.areasSqft].sort((a, b) => a - b)
        typicalSizeMin = Math.round(percentile(sortedAreas, 0.25) / 10) * 10
        typicalSizeMax = Math.round(percentile(sortedAreas, 0.75) / 10) * 10
      }

      results.push({
        name: group.name,
        medianPrice: Math.round(medianPrice),
        medianPsf: Math.round(median(group.psfs)),
        txCount: group.prices.length,
        lastTxDate: group.lastTxDate,
        district,
        typicalSizeMin,
        typicalSizeMax,
        lat: group.lats.length > 0 ? median(group.lats) : null,
        lon: group.lons.length > 0 ? median(group.lons) : null,
      })
    }

    // Optional district filter: keep only projects in one of the requested
    // districts (e.g. ?districts=D09,D10,D11). Absent → island-wide.
    const filtered = districts ? results.filter((r) => districts.has(r.district)) : results

    filtered.sort((a, b) => b.txCount - a.txCount)
    const topResults = filtered.slice(0, 8)

    return json({ results: topResults, category, budget, budgetMin })
  } catch (error) {
    console.error('project-matcher error:', error)
    return json({ error: 'Unable to match projects.' }, { status: 500 })
  }
}
