import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

// CORS so the directory can be consumed from other NexDoor surfaces too.
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

type TxRow = {
  address: string | null
  transaction_price: number | string | null
  transaction_date: string | null
  price_psf: number | string | null
}

type PriceHistoryPoint = {
  quarter: string
  avg_psf: number
  transaction_count: number
}

// Note on the data model: property_transactions_v2 has no unit_number column.
// The physical unit lives inside `address` (e.g. "38 MOUNT VERNON ROAD #06-25"),
// so the full address is used as the per-unit key for profitability.

// property_transactions_v2 is indexed on (project_name, id), so filtering by
// project and paging in id order is an index scan with no sort step. There is no
// index that also carries transaction_date, so the quarterly bucketing below is
// done in memory. Projects top out around ~3k transactions, a few pages at most.
async function fetchProjectTransactions(projectName: string): Promise<TxRow[]> {
  const PAGE = 1000
  const MAX_ROWS = 20000
  const rows: TxRow[] = []

  for (let from = 0; from < MAX_ROWS; from += PAGE) {
    const { data, error } = await supabase
      .from('property_transactions_v2')
      .select('address, transaction_price, transaction_date, price_psf')
      .eq('project_name', projectName)
      .order('id', { ascending: true })
      .range(from, from + PAGE - 1)

    // A query error is a real failure (timeout, permissions, bad column) and must
    // not be swallowed — returning the rows fetched so far would render as a
    // legitimately empty or half-complete project. A project with genuinely zero
    // transactions comes back as `data: []` with no error and still ends up as a
    // clean empty result below.
    if (error) {
      throw new Error(`project stats transactions query failed: ${error.message}`)
    }
    if (!data || data.length === 0) break
    rows.push(...(data as TxRow[]))
    if (data.length < PAGE) break
  }

  return rows
}

// QUERY A: quarterly average PSF. Quarter is keyed by its first day (matching
// DATE_TRUNC('quarter', ...)) so the series stays chronologically sortable.
function buildPriceHistory(rows: TxRow[]): PriceHistoryPoint[] {
  const buckets = new Map<string, { sum: number; count: number }>()

  for (const row of rows) {
    if (!row.transaction_date) continue
    const psf = Number(row.price_psf)
    if (!Number.isFinite(psf) || psf <= 0) continue

    const date = new Date(row.transaction_date)
    if (Number.isNaN(date.getTime())) continue
    const year = date.getUTCFullYear()
    const quarterStartMonth = Math.floor(date.getUTCMonth() / 3) * 3
    const key = `${year}-${String(quarterStartMonth + 1).padStart(2, '0')}-01`

    const bucket = buckets.get(key)
    if (bucket) {
      bucket.sum += psf
      bucket.count += 1
    } else {
      buckets.set(key, { sum: psf, count: 1 })
    }
  }

  return Array.from(buckets.entries())
    .map(([quarter, { sum, count }]) => ({
      quarter,
      avg_psf: Math.round(sum / count),
      transaction_count: count,
    }))
    .sort((a, b) => a.quarter.localeCompare(b.quarter))
}

// QUERY B: per-unit profitability from the last two transactions of each unit.
// If the most recent price beats the one before it, the unit is profitable.
// Units with a single transaction can't be judged and are excluded.
function buildProfitability(rows: TxRow[]) {
  type UnitTx = { price: number; date: string }
  const units = new Map<string, UnitTx[]>()

  for (const row of rows) {
    const address = (row.address || '').trim()
    if (!address) continue
    const price = Number(row.transaction_price)
    if (!Number.isFinite(price) || price <= 0) continue
    if (!row.transaction_date) continue

    const list = units.get(address)
    if (list) list.push({ price, date: row.transaction_date })
    else units.set(address, [{ price, date: row.transaction_date }])
  }

  let profitable = 0
  let unprofitable = 0

  for (const list of units.values()) {
    if (list.length < 2) continue
    // Most recent first; compare the latest sale against the one before it.
    list.sort((a, b) => b.date.localeCompare(a.date))
    const lastPrice = list[0].price
    const prevPrice = list[1].price
    if (lastPrice > prevPrice) profitable += 1
    else unprofitable += 1
  }

  const total = profitable + unprofitable
  return {
    profitable,
    unprofitable,
    total_with_2_transactions: total,
    profitable_pct: total > 0 ? Math.round((profitable / total) * 100) : 0,
    unprofitable_pct: total > 0 ? Math.round((unprofitable / total) * 100) : 0,
  }
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params
    const projectName = decodeURIComponent(slug || '').trim()
    if (!projectName) {
      return json({ error: 'A project slug is required.' }, { status: 400 })
    }

    // Fetch the master row (case-insensitive exact match on the small table).
    const { data: projectRow, error: projectError } = await supabase
      .from('projects_master')
      .select('*')
      .ilike('project_name', projectName)
      .limit(1)
      .maybeSingle()

    if (projectError) {
      console.error('project stats master query error:', projectError)
      return json({ error: 'Unable to load project.' }, { status: 500 })
    }
    if (!projectRow) {
      return json({ error: 'Project not found.' }, { status: 404 })
    }

    // Use the canonical name from the master row so the transactions query hits
    // the project_name index with an exact (fast) match.
    const canonicalName = (projectRow.project_name as string) || projectName
    const rows = await fetchProjectTransactions(canonicalName)

    const priceHistory = buildPriceHistory(rows)
    const profitability = buildProfitability(rows)

    return json({ project: projectRow, priceHistory, profitability })
  } catch (error) {
    console.error('project stats error:', error)
    return json({ error: 'Unable to load project stats.' }, { status: 500 })
  }
}
