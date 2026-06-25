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
}

type MatchResult = {
  name: string
  medianPrice: number
  medianPsf: number
  txCount: number
  lastTxDate: string | null
  district: string
}

// Singapore postal sector (first 2 digits of postal code) -> postal district.
// Source: standard URA/SingPost postal district map.
const SECTOR_TO_DISTRICT: Record<string, string> = {}
const DISTRICT_SECTORS: Record<string, string[]> = {
  D01: ['01', '02', '03', '04', '05', '06'],
  D02: ['07', '08'],
  D03: ['14', '15', '16'],
  D04: ['09', '10'],
  D05: ['11', '12', '13'],
  D06: ['17'],
  D07: ['18', '19'],
  D08: ['20', '21'],
  D09: ['22', '23'],
  D10: ['24', '25', '26', '27'],
  D11: ['28', '29', '30'],
  D12: ['31', '32', '33'],
  D13: ['34', '35', '36', '37'],
  D14: ['38', '39', '40', '41'],
  D15: ['42', '43', '44', '45'],
  D16: ['46', '47', '48'],
  D17: ['49', '50', '81'],
  D18: ['51', '52'],
  D19: ['53', '54', '55', '82'],
  D20: ['56', '57'],
  D21: ['58', '59'],
  D22: ['60', '61', '62', '63', '64'],
  D23: ['65', '66', '67', '68'],
  D24: ['69', '70', '71'],
  D25: ['72', '73'],
  D26: ['77', '78'],
  D27: ['75', '76'],
  D28: ['79', '80'],
}
for (const [district, sectors] of Object.entries(DISTRICT_SECTORS)) {
  for (const sector of sectors) SECTOR_TO_DISTRICT[sector] = district
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

// Fetch all matching rows in pages (Supabase caps a single response at ~1000 rows).
async function fetchTransactions(
  category: PropertyCategory,
  sinceDate: string,
  priceFloor: number,
  priceCeil: number,
): Promise<TxRow[]> {
  const PAGE = 1000
  const MAX_ROWS = 10000
  const rows: TxRow[] = []

  for (let from = 0; from < MAX_ROWS; from += PAGE) {
    let query = supabase
      .from('property_transactions_v2')
      .select('street_name, project_name, transaction_price, price_psf, transaction_date, postal_code')
      .gte('transaction_date', sinceDate)
      .gte('transaction_price', priceFloor)
      .lte('transaction_price', priceCeil)
      .not('transaction_price', 'is', null)
      .order('transaction_date', { ascending: false })
      .range(from, from + PAGE - 1)

    if (category === 'hdb') {
      query = query.eq('property_group', 'hdb')
    } else if (category === 'condo') {
      query = query.eq('property_subtype', 'condo')
    } else if (category === 'ec') {
      // EC rows aren't tagged property_subtype = 'ec' in this dataset; they're
      // identified by unit_type, matching how the valuation pipeline treats them.
      query = query.eq('unit_type', 'Executive Condominium')
    } else {
      query = query.in('property_subtype', ['landed_strata', 'landed_non_strata'])
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

    // Last 24 months.
    const since = new Date()
    since.setMonth(since.getMonth() - 24)
    const sinceDate = since.toISOString().slice(0, 10)

    // Bound the fetch to a generous price band around the budget so medians stay
    // representative while keeping row volume manageable.
    const priceFloor = Math.max(0, Math.round(budgetMin * 0.6))
    const priceCeil = Math.round(budget * 1.4)

    const rows = await fetchTransactions(category, sinceDate, priceFloor, priceCeil)

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
        group = { name, prices: [], psfs: [], lastTxDate: null, districtCounts: {} }
        groups.set(name, group)
      }
      group.prices.push(price)
      const psf = Number(row.price_psf)
      if (Number.isFinite(psf) && psf > 0) group.psfs.push(psf)
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

      results.push({
        name: group.name,
        medianPrice: Math.round(medianPrice),
        medianPsf: Math.round(median(group.psfs)),
        txCount: group.prices.length,
        lastTxDate: group.lastTxDate,
        district,
      })
    }

    results.sort((a, b) => b.txCount - a.txCount)
    const topResults = results.slice(0, 8)

    return json({ results: topResults, category, budget, budgetMin })
  } catch (error) {
    console.error('project-matcher error:', error)
    return json({ error: 'Unable to match projects.' }, { status: 500 })
  }
}
