import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

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

const SQFT_PER_SQM = 10.764
const SSD_CUTOFF = '2025-07-04'

type RawRow = {
  address: string | null
  transaction_price: number | string | null
  transaction_date: string | null
  price_psf: number | string | null
  floor_area_sqm: number | string | null
  property_subtype: string | null
}

type Tx = {
  price: number
  date: string
  psf: number
  sqm: number
  sqft: number
  type: string | null
}

// Fetch every unit-level transaction for a project (address carries the #floor-stack).
async function fetchUnitTransactions(projectName: string): Promise<RawRow[]> {
  const PAGE = 1000
  const MAX_ROWS = 20000
  const rows: RawRow[] = []

  for (let from = 0; from < MAX_ROWS; from += PAGE) {
    const { data, error } = await supabase
      .from('property_transactions_v2')
      .select('address, transaction_price, transaction_date, price_psf, floor_area_sqm, property_subtype')
      .eq('project_name', projectName)
      .like('address', '%#%')
      .order('id', { ascending: true })
      .range(from, from + PAGE - 1)

    if (error) {
      console.error('tower transactions query error:', error)
      break
    }
    if (!data || data.length === 0) break
    rows.push(...(data as RawRow[]))
    if (data.length < PAGE) break
  }

  return rows
}

// "45 NORMANTON PARK #06-05" -> { block: "45", floor: 6, stack: 5, unit: "06-05" }
function parseAddress(address: string): { block: string; floor: number; stack: number; unit: string } | null {
  if (!address.includes('#')) return null
  const [before, after] = address.split('#')
  const block = (before || '').trim().split(/\s+/)[0]
  const unit = (after || '').trim()
  const parts = unit.split('-')
  if (parts.length < 2) return null
  const floor = parseInt(parts[0], 10)
  const stack = parseInt(parts[1], 10)
  if (!block || !Number.isFinite(floor) || !Number.isFinite(stack)) return null
  return { block, floor, stack, unit }
}

function yearsBetween(fromDate: Date, toDate: Date): number {
  return (toDate.getTime() - fromDate.getTime()) / (365.25 * 24 * 60 * 60 * 1000)
}

function addYears(dateStr: string, years: number): string {
  const d = new Date(dateStr)
  d.setFullYear(d.getFullYear() + years)
  return d.toISOString().slice(0, 10)
}

function computeUnit(unit: string, txsAsc: Tx[]) {
  const transactionCount = txsAsc.length
  const latestTx = transactionCount > 0 ? txsAsc[transactionCount - 1] : null
  const previousTx = transactionCount >= 2 ? txsAsc[transactionCount - 2] : null
  const firstTx = transactionCount > 0 ? txsAsc[0] : null

  // Profitability — latest vs the one before it.
  const profitable = previousTx ? latestTx!.price > previousTx.price : null
  const profitAmount = previousTx ? latestTx!.price - previousTx.price : null
  const profitPct = previousTx ? ((latestTx!.price - previousTx.price) / previousTx.price) * 100 : null

  // SSD — regime depends on when the latest purchase happened.
  let ssdStatus: 'cleared' | 'in_period' | 'no_data' = 'no_data'
  let ssdRate = 0
  let ssdAmount = 0
  let ssdClearsDate: string | null = null

  if (latestTx) {
    const purchaseDate = latestTx.date
    const afterCutoff = purchaseDate >= SSD_CUTOFF
    const ssdYears = afterCutoff ? 4 : 3
    const ssdRates = afterCutoff ? [0.16, 0.12, 0.08, 0.04] : [0.12, 0.08, 0.04]
    const yearsHeld = yearsBetween(new Date(purchaseDate), new Date())

    if (yearsHeld >= ssdYears) {
      ssdStatus = 'cleared'
    } else {
      ssdStatus = 'in_period'
      const yearIndex = Math.min(Math.max(Math.floor(yearsHeld), 0), ssdRates.length - 1)
      ssdRate = ssdRates[yearIndex]
      ssdAmount = Math.round(latestTx.price * ssdRate)
      ssdClearsDate = addYears(purchaseDate, ssdYears)
    }
  }

  // Colour status.
  let status: string
  if (transactionCount === 0) status = 'no_data'
  else if (transactionCount === 1 || profitable === null) status = 'single_tx'
  else if (profitable && ssdStatus === 'cleared') status = 'profitable_clear'
  else if (profitable && ssdStatus === 'in_period') status = 'profitable_ssd'
  else status = 'unprofitable'

  return {
    unit,
    transactionCount,
    status,
    latestTx,
    previousTx,
    firstTx,
    profitable,
    profitAmount,
    profitPct,
    ssdStatus,
    ssdRate,
    ssdAmount,
    ssdClearsDate,
    allTransactions: txsAsc,
  }
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params
    const decoded = decodeURIComponent(slug || '').trim()
    if (!decoded) return json({ error: 'A project slug is required.' }, { status: 400 })

    // Master row gives the canonical name + header details (district/tenure/units).
    const { data: master } = await supabase
      .from('projects_master')
      .select('project_name, district, tenure, total_units')
      .ilike('project_name', decoded)
      .limit(1)
      .maybeSingle()

    const canonicalName = (master?.project_name as string) || decoded
    const rows = await fetchUnitTransactions(canonicalName)

    // Deduplicate transactions — URA data can carry duplicate rows (e.g. an
    // option + exercise pair) with identical address, date and price. Keep one.
    const seen = new Set<string>()
    const deduped = rows.filter((tx) => {
      const key = `${tx.address}|${tx.transaction_date}|${tx.transaction_price}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    console.log(
      `tower dedup [${canonicalName}]: ${rows.length} rows → ${deduped.length} after dedup (${rows.length - deduped.length} duplicates removed)`,
    )

    // Group by block -> floor -> stack -> transactions.
    const blocks = new Map<string, Map<number, Map<number, Tx[]>>>()
    for (const row of deduped) {
      const address = (row.address || '').trim()
      if (!address) continue
      const parsed = parseAddress(address)
      if (!parsed) continue
      const price = Number(row.transaction_price)
      if (!Number.isFinite(price) || price <= 0 || !row.transaction_date) continue

      const sqm = Number(row.floor_area_sqm)
      const psf = Number(row.price_psf)
      const tx: Tx = {
        price,
        date: row.transaction_date,
        psf: Number.isFinite(psf) ? psf : 0,
        sqm: Number.isFinite(sqm) ? sqm : 0,
        sqft: Number.isFinite(sqm) ? Math.round(sqm * SQFT_PER_SQM) : 0,
        type: row.property_subtype,
      }

      if (!blocks.has(parsed.block)) blocks.set(parsed.block, new Map())
      const floorsMap = blocks.get(parsed.block)!
      if (!floorsMap.has(parsed.floor)) floorsMap.set(parsed.floor, new Map())
      const stacksMap = floorsMap.get(parsed.floor)!
      if (!stacksMap.has(parsed.stack)) stacksMap.set(parsed.stack, [])
      stacksMap.get(parsed.stack)!.push(tx)
    }

    // Block list, numeric-aware sort.
    const blockList = Array.from(blocks.keys()).sort((a, b) => {
      const na = parseInt(a, 10)
      const nb = parseInt(b, 10)
      if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) return na - nb
      return a.localeCompare(b)
    })

    if (blockList.length === 0) {
      return json({
        projectName: canonicalName,
        district: master?.district ?? null,
        tenure: master?.tenure ?? null,
        totalUnits: master?.total_units ?? null,
        blocks: [],
        selectedBlock: '',
        floors: {},
        maxFloor: 0,
        minFloor: 0,
        stacks: [],
      })
    }

    const requestedBlock = (request.nextUrl.searchParams.get('block') || '').trim()
    const selectedBlock = blockList.includes(requestedBlock) ? requestedBlock : blockList[0]

    // Build the floors payload for the selected block.
    const floorsMap = blocks.get(selectedBlock)!
    const floors: Record<number, Record<number, ReturnType<typeof computeUnit>>> = {}
    const stackSet = new Set<number>()
    let maxFloor = -Infinity
    let minFloor = Infinity

    for (const [floor, stacksMap] of floorsMap.entries()) {
      maxFloor = Math.max(maxFloor, floor)
      minFloor = Math.min(minFloor, floor)
      floors[floor] = {}
      for (const [stack, txs] of stacksMap.entries()) {
        stackSet.add(stack)
        const txsAsc = [...txs].sort((a, b) => a.date.localeCompare(b.date))
        const unitLabel = `${String(floor).padStart(2, '0')}-${String(stack).padStart(2, '0')}`
        floors[floor][stack] = computeUnit(unitLabel, txsAsc)
      }
    }

    return json({
      projectName: canonicalName,
      district: master?.district ?? null,
      tenure: master?.tenure ?? null,
      totalUnits: master?.total_units ?? null,
      blocks: blockList,
      selectedBlock,
      floors,
      maxFloor: Number.isFinite(maxFloor) ? maxFloor : 0,
      minFloor: Number.isFinite(minFloor) ? minFloor : 0,
      stacks: Array.from(stackSet).sort((a, b) => a - b),
    })
  } catch (error) {
    console.error('tower error:', error)
    return json({ error: 'Unable to load tower data.' }, { status: 500 })
  }
}
