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

// Result cap. Ranking alone would let busy districts crowd out a quieter one
// entirely — a caller asking for D11,D12,D13 could get back nothing from D11
// just because its matches sit lower down the shared ranking. So each requested
// district is guaranteed a small quota before the rest of the slots are filled
// by overall rank, and the cap grows if the quotas need more room.
const MAX_RESULTS = 12
const PER_DISTRICT_MIN = 2

// `project_name` placeholder used by the upstream dataset for transactions with
// no named development. It is not a real project, so it must never be grouped
// or reported as one.
const PLACEHOLDER_PROJECT_NAME = 'N.A.'

function normalizeName(value: string | null | undefined): string {
  return (value || '').toString().trim().toUpperCase()
}

function isPlaceholderName(value: string | null | undefined): boolean {
  return normalizeName(value) === PLACEHOLDER_PROJECT_NAME
}

// Official Singapore postal sector (first 2 digits) -> postal district, per the
// URA/SingPost map. This is a FALLBACK only: projects_master.district is the
// authoritative source and wins wherever a project matches (see districtOfRow).
// It exists because projects_master covers condos/ECs but not landed estates,
// which are grouped by street and resolve via postal code instead.
//
// Verified against projects_master: deriving each sector's district by majority
// vote over every transaction joined to projects_master agrees with this table
// on all 70 sectors present in the data, at ~100% confidence per sector.
const SECTOR_TO_DISTRICT: Record<string, string> = {}
const DISTRICT_SECTORS: Array<[string, number[]]> = [
  ['D01', [1, 2, 3, 4, 5, 6]],
  ['D02', [7, 8]],
  ['D03', [14, 15, 16]],
  ['D04', [9, 10]],
  ['D05', [11, 12, 13]],
  ['D06', [17]],
  ['D07', [18, 19]],
  ['D08', [20, 21]],
  ['D09', [22, 23]],
  ['D10', [24, 25, 26, 27]],
  ['D11', [28, 29, 30]],
  ['D12', [31, 32, 33]],
  ['D13', [34, 35, 36, 37]],
  ['D14', [38, 39, 40, 41]],
  ['D15', [42, 43, 44, 45]],
  ['D16', [46, 47, 48]],
  ['D17', [49, 50, 81]],
  ['D18', [51, 52]],
  ['D19', [53, 54, 55, 82]],
  ['D20', [56, 57]],
  ['D21', [58, 59]],
  ['D22', [60, 61, 62, 63, 64]],
  ['D23', [65, 66, 67, 68]],
  ['D24', [69, 70, 71]],
  ['D25', [72, 73]],
  ['D26', [77, 78]],
  ['D27', [75, 76]],
  ['D28', [79, 80]],
]
for (const [district, sectors] of DISTRICT_SECTORS) {
  for (const sector of sectors) {
    SECTOR_TO_DISTRICT[String(sector).padStart(2, '0')] = district
  }
}

function districtFromPostal(postal: string | null | undefined): string | null {
  if (!postal) return null
  const trimmed = String(postal).trim()
  if (!/^\d{5,6}$/.test(trimmed)) return null
  const sector = trimmed.padStart(6, '0').slice(0, 2)
  return SECTOR_TO_DISTRICT[sector] || null
}

// Authoritative project_name -> district ("D09") map from projects_master.
// Cached per server instance: the table is ~3k rows and changes rarely, so
// re-fetching it on every request would be pure overhead.
const PROJECT_DISTRICT_TTL_MS = 60 * 60 * 1000
let projectDistrictCache: { fetchedAt: number; map: Map<string, string> } | null = null

async function fetchProjectDistricts(): Promise<Map<string, string>> {
  const cached = projectDistrictCache
  if (cached && Date.now() - cached.fetchedAt < PROJECT_DISTRICT_TTL_MS) return cached.map

  const map = new Map<string, string>()
  const PAGE = 1000
  const MAX_ROWS = 20000
  for (let from = 0; from < MAX_ROWS; from += PAGE) {
    const { data, error } = await supabase
      .from('projects_master')
      .select('project_name, district')
      .range(from, from + PAGE - 1)
    if (error) {
      console.error('project-matcher projects_master query error:', error)
      // Fall back to postal-derived districts rather than serving no districts.
      break
    }
    if (!data || data.length === 0) break
    for (const row of data as Array<{ project_name: string | null; district: string | null }>) {
      const name = normalizeName(row.project_name)
      const district = (row.district || '').toString().trim()
      if (!name || isPlaceholderName(name) || !district) continue
      map.set(name, `D${district.padStart(2, '0')}`)
    }
    if (data.length < PAGE) break
  }

  projectDistrictCache = { fetchedAt: Date.now(), map }
  return map
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

// Apply the same category predicate used by fetchTransactions, so a project's
// typical size is measured over comparable stock.
function applyCategoryFilter<T extends { in: (c: string, v: string[]) => T; eq: (c: string, v: string) => T }>(
  query: T,
  category: PropertyCategory,
): T {
  if (category === 'hdb') return query.eq('property_group', 'hdb')
  if (category === 'condo') {
    return query
      .in('unit_type', ['Condominium', 'Apartment'])
      .in('property_subtype', ['condo', 'Resale', 'New Sale', 'Sub Sale'])
  }
  if (category === 'ec') {
    return query
      .eq('unit_type', 'Executive Condominium')
      .in('property_subtype', ['ec', 'Resale', 'New Sale', 'Sub Sale'])
  }
  return query
    .in('unit_type', ['Detached House', 'Semi-Detached House', 'Terrace House'])
    .in('property_subtype', ['landed_strata', 'landed_non_strata', 'Resale', 'New Sale', 'Sub Sale'])
}

// Typical unit size per group, measured across ALL of the group's transactions
// in the window — deliberately NOT the price/size-filtered subset, which would
// only ever echo back the caller's own size band.
// Only called for the handful of groups actually returned, so it stays cheap.
async function fetchTypicalSizes(
  category: PropertyCategory,
  sinceDate: string,
  names: string[],
  groupNameOf: (row: { street_name: string | null; project_name: string | null }) => string,
): Promise<Map<string, { min: number; max: number }>> {
  const out = new Map<string, { min: number; max: number }>()
  if (names.length === 0) return out

  // Which column(s) the group name can come from, mirroring groupNameOf.
  const columns =
    category === 'hdb' ? ['street_name'] : category === 'landed' ? ['street_name', 'project_name'] : ['project_name']

  const byId = new Map<number, { street_name: string | null; project_name: string | null; floor_area_sqm: number | string | null }>()
  for (const column of columns) {
    let query = supabase
      .from('property_transactions_v2')
      .select('id, street_name, project_name, floor_area_sqm')
      .gte('transaction_date', sinceDate)
      .not('floor_area_sqm', 'is', null)
      .in(column, names)
      .limit(10000)
    query = applyCategoryFilter(query as never, category) as never

    const { data, error } = await query
    if (error) {
      console.error('project-matcher typical-size query error:', error)
      return out // Degrade to null typical sizes rather than failing the request.
    }
    for (const row of (data || []) as Array<{ id: number; street_name: string | null; project_name: string | null; floor_area_sqm: number | string | null }>) {
      byId.set(row.id, row)
    }
  }

  const areasByGroup = new Map<string, number[]>()
  for (const row of byId.values()) {
    const name = groupNameOf(row)
    if (!name) continue
    const areaSqm = Number(row.floor_area_sqm)
    if (!Number.isFinite(areaSqm) || areaSqm <= 0) continue
    const list = areasByGroup.get(name)
    if (list) list.push(areaSqm * SQFT_PER_SQM)
    else areasByGroup.set(name, [areaSqm * SQFT_PER_SQM])
  }

  for (const [name, areas] of areasByGroup) {
    const sorted = areas.sort((a, b) => a - b)
    out.set(name, {
      min: Math.round(percentile(sorted, 0.25) / 10) * 10,
      max: Math.round(percentile(sorted, 0.75) / 10) * 10,
    })
  }
  return out
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

    // Filter transactions to the budget range directly in the query so we fetch
    // only relevant rows — this keeps volume well under the page cap rather than
    // pulling everything and filtering in memory.
    const priceFloor = Math.max(0, budgetMin)
    const priceCeil = budget

    const [rows, projectDistricts] = await Promise.all([
      fetchTransactions(category, sinceDate, priceFloor, priceCeil, sizeMinSqm, sizeMaxSqm),
      fetchProjectDistricts(),
    ])

    // Grouping field per category: condo/EC by project, HDB by street/estate.
    // Landed transactions carry the estate name in project_name (street_name is
    // null in this dataset), so fall back to project_name when needed.
    // 'N.A.' is an upstream placeholder, never a real project name.
    const groupNameOf = (row: { street_name: string | null; project_name: string | null }): string => {
      const projectName = isPlaceholderName(row.project_name) ? '' : (row.project_name || '').toString().trim()
      if (category === 'condo' || category === 'ec') return projectName
      if (category === 'landed') return (row.street_name || '').toString().trim() || projectName
      return (row.street_name || '').toString().trim()
    }

    // District resolution: projects_master.district is authoritative. Postal
    // sector is only a fallback for rows whose project isn't listed there
    // (chiefly landed estates, which projects_master doesn't enumerate).
    const districtOfRow = (row: TxRow): string | null => {
      const name = normalizeName(row.project_name)
      if (name && !isPlaceholderName(name)) {
        const district = projectDistricts.get(name)
        if (district) return district
      }
      return districtFromPostal(row.postal_code)
    }

    type Group = {
      name: string
      prices: number[]
      psfs: number[]
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
        group = { name, prices: [], psfs: [], lats: [], lons: [], lastTxDate: null, districtCounts: {} }
        groups.set(name, group)
      }
      group.prices.push(price)
      const psf = Number(row.price_psf)
      if (Number.isFinite(psf) && psf > 0) group.psfs.push(psf)
      const lat = Number(row.latitude)
      if (Number.isFinite(lat) && lat !== 0) group.lats.push(lat)
      const lon = Number(row.longitude)
      if (Number.isFinite(lon) && lon !== 0) group.lons.push(lon)
      if (row.transaction_date && (!group.lastTxDate || row.transaction_date > group.lastTxDate)) {
        group.lastTxDate = row.transaction_date
      }
      const district = districtOfRow(row)
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

      results.push({
        name: group.name,
        medianPrice: Math.round(medianPrice),
        medianPsf: Math.round(median(group.psfs)),
        txCount: group.prices.length,
        lastTxDate: group.lastTxDate,
        district,
        // Filled in below, from the project's full transaction history.
        typicalSizeMin: null,
        typicalSizeMax: null,
        lat: group.lats.length > 0 ? median(group.lats) : null,
        lon: group.lons.length > 0 ? median(group.lons) : null,
      })
    }

    // Optional district filter: keep only projects in one of the requested
    // districts (e.g. ?districts=D09,D10,D11). Absent → island-wide.
    const filtered = districts ? results.filter((r) => districts.has(r.district)) : results

    filtered.sort((a, b) => b.txCount - a.txCount)

    // Let the cap stretch when a caller asks for enough districts that the
    // per-district quotas alone would exceed it.
    const cap = districts ? Math.max(MAX_RESULTS, districts.size * PER_DISTRICT_MIN) : MAX_RESULTS

    let topResults: MatchResult[]
    if (districts) {
      // Pass 1: reserve up to PER_DISTRICT_MIN for each district present, taking
      // each district's best-ranked matches (filtered is already in rank order).
      const picked = new Set<MatchResult>()
      const quotaUsed = new Map<string, number>()
      for (const result of filtered) {
        if (picked.size >= cap) break
        const used = quotaUsed.get(result.district) || 0
        if (used >= PER_DISTRICT_MIN) continue
        picked.add(result)
        quotaUsed.set(result.district, used + 1)
      }
      // Pass 2: fill any remaining slots by overall rank, regardless of district.
      for (const result of filtered) {
        if (picked.size >= cap) break
        picked.add(result)
      }
      // Emit in overall rank order rather than quota order.
      topResults = filtered.filter((result) => picked.has(result))
    } else {
      topResults = filtered.slice(0, cap)
    }

    // Typical sizes come from each project's full history, so they describe the
    // project rather than restating the requested size band.
    const typicalSizes = await fetchTypicalSizes(
      category,
      sinceDate,
      topResults.map((r) => r.name),
      groupNameOf,
    )
    for (const result of topResults) {
      const size = typicalSizes.get(result.name)
      if (size) {
        result.typicalSizeMin = size.min
        result.typicalSizeMax = size.max
      }
    }

    return json({ results: topResults, category, budget, budgetMin })
  } catch (error) {
    console.error('project-matcher error:', error)
    return json({ error: 'Unable to match projects.' }, { status: 500 })
  }
}
