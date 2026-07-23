import { supabase } from './supabase'
import condoEcFloorTierBetaCache from './condoEcFloorTierBeta.json'

type PropertyCategory = 'hdb' | 'condo' | 'ec' | 'landed'

type ValuationParams = {
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
  cacheKey?: string
}

type TransactionRow = {
  transaction_price: number | string | null
  floor_area_sqm: number | string | null
  latitude: number | string | null
  longitude: number | string | null
  unit_type: string | null
  tenure?: string | null
  price_psf?: number | string | null
  project_name?: string | null
  transaction_date?: string | null
  address?: string | null
  completion_year?: number | string | null
  is_strata?: boolean | null
}

type CleanedRow = {
  transaction_price: number
  floor_area_sqm: number
  latitude: number
  longitude: number
  unit_type: string | null
  tenure: string | null
  project_name: string | null
  transaction_date: string | null
  address: string | null
  pricePerSqm: number
  pricePerSqft: number
  distanceM: number
  parsedFloorLevel: number | null
  completion_year: number | null
  is_strata: boolean | null
}

type CandidateResult = {
  estimated: number
  low: number
  high: number
  comparables: number
  radius: number
  method?: string
  // Stage 2: set when the repeat-sale blend runs on a thin pool AND excluding the
  // subject unit swung the comparable by more than REPEAT_SWING_THRESHOLD — a
  // signal that the estimate leans heavily on one prior transaction. The UI can
  // surface a "limited comparable data" caveat.
  thinDataWarning?: boolean
  // Stage 3b (momentum thresholds): the market-movement signal the same-project
  // condo/EC path measured for this valuation, as a clean percentage (e.g. +6.2
  // means the nearby similar-age/tenure market rose ~6.2% between when the
  // same-project anchor comps transacted and the last 12 months). This is a
  // NEARBY-project drift signal, and it is ONLY measured when the same-project
  // anchor is stale (>365d old) and enough nearby support exists — it is
  // `undefined` otherwise (fresh anchor, or thin support). It is NOT a
  // same-project momentum, and it is NOT the size curve's Stage 3 recency fix
  // (that removed a bias, it does not compute a momentum). Exposed for reuse by
  // the upcoming Suggested Listing Price; see valuation-redesign-plan.md Stage 3b.
  marketMovementPct?: number
  // Stage 3c: Suggested Listing Price — a seller-facing STRATEGIC figure, kept
  // strictly separate from Market Value (estimated/low/high), never blended in.
  // suggestedListingPrice = estimated × (1 + listingMarkupPct/100); the markup is
  // a floored/capped fraction of a dedicated momentum reading (momentumPct, with
  // momentumBasis exposing whether it came from same-project sales, a nearby
  // fallback, or none). Present only on condo/EC same-project results.
  suggestedListingPrice?: number
  listingMarkupPct?: number
  momentumPct?: number | null
  momentumBasis?: MomentumBasis
}

function normalizeText(value: string | null | undefined) {
  return (value || '').toUpperCase().trim()
}

function distanceInMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
) {
  const dx = lat1 - lat2
  const dy = lon1 - lon2
  return Math.sqrt(dx * dx + dy * dy) * 111000
}

function percentile(sorted: number[], p: number) {
  if (sorted.length === 0) return null

  const index = (sorted.length - 1) * p
  const lower = Math.floor(index)
  const upper = Math.ceil(index)

  if (lower === upper) return sorted[lower]

  const weight = index - lower
  return sorted[lower] * (1 - weight) + sorted[upper] * weight
}

function weightedAverage(values: number[], weights: number[]) {
  const totalWeight = weights.reduce((sum, w) => sum + w, 0)
  if (!totalWeight) return null

  const weightedSum = values.reduce((sum, value, i) => {
    return sum + value * weights[i]
  }, 0)

  return weightedSum / totalWeight
}

function getSearchRadius(propertyCategory: PropertyCategory) {
  if (propertyCategory === 'landed') {
    return [1000, 2000, 3000, 5000, 8000]
  }

  if (propertyCategory === 'condo' || propertyCategory === 'ec') {
    return [300, 600, 900, 1200, 1500, 2000, 3000]
  }

  return [300, 600, 900, 1200, 1500]
}

function getBoundingBox(lat: number, lon: number, radiusM: number) {
  const latDelta = radiusM / 111000
  const cosLat = Math.cos((lat * Math.PI) / 180)
  const safeCosLat = Math.max(Math.abs(cosLat), 0.2)
  const lonDelta = radiusM / (111000 * safeCosLat)

  return {
    minLat: lat - latDelta,
    maxLat: lat + latDelta,
    minLon: lon - lonDelta,
    maxLon: lon + lonDelta,
  }
}

function getLandedGroup(propertyType: string) {
  const normalized = normalizeText(propertyType)

  if (normalized.includes('TERRACE')) return 'terrace'
  if (normalized.includes('SEMI')) return 'semi'
  if (normalized.includes('DETACHED') || normalized.includes('BUNGALOW')) {
    return 'detached'
  }

  return 'other'
}

function isMatchingLandedType(
  rowUnitType: string | null,
  requestedPropertyType: string
) {
  const row = normalizeText(rowUnitType)
  const targetGroup = getLandedGroup(requestedPropertyType)

  if (!row) return false

  if (targetGroup === 'terrace') return row.includes('TERRACE')
  if (targetGroup === 'semi') return row.includes('SEMI')

  if (targetGroup === 'detached') {
    return (
      row.includes('DETACHED') ||
      row.includes('BUNGALOW') ||
      row.includes('GOOD CLASS BUNGALOW')
    )
  }

  return false
}

function isMatchingNonLandedType(
  rowUnitType: string | null,
  requestedPropertyType: string
) {
  const row = normalizeText(rowUnitType)
  const target = normalizeText(requestedPropertyType)

  if (!row || !target) return false

  if (target === 'PENTHOUSE') {
    return row.includes('PENTHOUSE')
  }

  if (target.includes('BEDROOM')) {
    const targetNumber = target.split(' ')[0]
    return row.includes(targetNumber) && (row.includes('BED') || row.includes('BR'))
  }

  return row === target
}

function normalizeTenureBucket(value: string | null | undefined) {
  const tenure = normalizeText(value)

  if (!tenure) return 'UNKNOWN'

  if (
    tenure.includes('FREEHOLD') ||
    tenure.includes('999') ||
    tenure.includes('999-YEAR')
  ) {
    return 'FH_999'
  }

  if (tenure.includes('99')) {
    return 'L99'
  }

  return 'OTHER'
}

function getSubjectTenureBucket(value: string | undefined) {
  const tenure = normalizeText(value)

  if (!tenure) return 'UNKNOWN'
  if (tenure === 'FREEHOLD' || tenure === '999-YEAR') return 'FH_999'
  if (tenure === '99-YEAR') return 'L99'
  return 'OTHER'
}

function getTypicalBuiltUpRatio(propertyType: string) {
  const group = getLandedGroup(propertyType)

  if (group === 'terrace') return 2.3
  if (group === 'semi') return 1.9
  if (group === 'detached') return 1.5

  return 1.8
}

function getDaysOld(transactionDate: string | null) {
  if (!transactionDate) return null

  const txnTime = new Date(transactionDate).getTime()
  if (!Number.isFinite(txnTime)) return null

  return (Date.now() - txnTime) / (1000 * 60 * 60 * 24)
}

function getRecencyWeight(
  transactionDate: string | null,
  propertyCategory: PropertyCategory
) {
  const daysOld = getDaysOld(transactionDate)
  if (daysOld === null) return 1

  if (propertyCategory === 'landed') {
    if (daysOld <= 90) return 1.15
    if (daysOld <= 180) return 1.08
    if (daysOld <= 365) return 1
    if (daysOld <= 730) return 0.94
    return 0.88
  }

  if (propertyCategory === 'hdb') {
    if (daysOld <= 90) return 3.0
    if (daysOld <= 180) return 2.5
    if (daysOld <= 365) return 2.0
    if (daysOld <= 730) return 1.2
    if (daysOld <= 1095) return 0.8
    return 0.5
  }

  if (daysOld <= 90) return 1.2
  if (daysOld <= 180) return 1.1
  if (daysOld <= 365) return 1
  if (daysOld <= 730) return 0.94
  return 0.88
}

function getHdbAgeWeight(
  rowCompletionYear: number | null,
  subjectCompletionYear: number | null
) {
  if (rowCompletionYear === null || subjectCompletionYear === null) return 1.0

  const diff = Math.abs(rowCompletionYear - subjectCompletionYear)

  if (diff <= 3) return 1.5
  if (diff <= 8) return 1.2
  if (diff <= 15) return 0.9
  if (diff <= 25) return 0.7
  return 0.5
}

function parseFloorLevelFromAddress(address: string | null | undefined) {
  const text = normalizeText(address)
  if (!text) return null

  const match = text.match(/#(\d{1,2})-\d+/)
  if (!match) return null

  const level = Number(match[1])
  return Number.isFinite(level) ? level : null
}

function getFloorWeight(subjectFloor?: number, comparableFloor?: number | null) {
  if (!subjectFloor || !comparableFloor) return 1

  const diff = Math.abs(subjectFloor - comparableFloor)

  if (diff <= 2) return 1.05
  if (diff <= 5) return 1.02
  if (diff <= 10) return 1
  if (diff <= 15) return 0.98
  return 0.95
}

function applyFloorAdjustment(
  estimate: number,
  floorLevel: number | undefined,
  propertyCategory: PropertyCategory
): number {
  if (!floorLevel || propertyCategory === 'landed') return estimate

  const floorsAboveBase = Math.max(0, floorLevel - 1)

  if (propertyCategory === 'hdb') {
    const adjustment = floorsAboveBase * 0.005
    const capped = Math.min(0.15, adjustment)
    return estimate * (1 + capped)
  }

  if (propertyCategory === 'ec') {
    const adjustment = floorsAboveBase * 0.002
    const capped = Math.min(0.035, adjustment)
    return estimate * (1 + capped)
  }

  // condo
  const adjustment = floorsAboveBase * 0.0025
  const capped = Math.min(0.04, adjustment)
  return estimate * (1 + capped)
}

function extractBlockNumber(address: string | null | undefined): string {
  const text = normalizeText(address)
  if (!text) return ''
  const match = text.match(/^(\d+[A-Z]?)\s/)
  return match ? match[1] : ''
}

function getMostRecentDate(rows: CleanedRow[]): Date | null {
  let latest: Date | null = null
  for (const row of rows) {
    if (!row.transaction_date) continue
    const d = new Date(row.transaction_date)
    if (!latest || d > latest) latest = d
  }
  return latest
}

// Most common completion year among rows (null if none). HDB blocks are built as
// a unit, so every unit in a block shares one completion year — the mode of the
// block's own transactions IS the block's completion year.
function mostCommonCompletionYear(rows: CleanedRow[]): number | null {
  const counts = new Map<number, number>()
  for (const row of rows) {
    const y = row.completion_year
    if (y === null || y === undefined || !Number.isFinite(y)) continue
    counts.set(y, (counts.get(y) ?? 0) + 1)
  }
  let best: number | null = null
  let bestCount = 0
  for (const [year, count] of counts) {
    if (count > bestCount) {
      bestCount = count
      best = year
    }
  }
  return best
}

// Fix 2 (variant b, backtested): same-block psm for the (365,730]d HDB tier.
// Exponential recency (half-life HDB_RECENCY_HALFLIFE_DAYS) so a genuine recent
// sale leads the estimate instead of being diluted by a simple average or trimmed
// away, plus a LENIENT MAD guard (HDB_SAMEBLOCK_MAD_K) that always keeps the
// most-recent sale and drops only egregious data-error prices. Weighted by
// recency × size; block / age / distance are uniform within a single block so
// they'd cancel. Returns null when no usable rows.
const HDB_RECENCY_HALFLIFE_DAYS = 120
const HDB_SAMEBLOCK_MAD_K = 5
function hdbSameBlockRecencyPsm(rows: CleanedRow[], floorAreaSqm: number): number | null {
  const usable = rows.filter(
    (r) => Number.isFinite(r.pricePerSqm) && r.pricePerSqm > 0 && r.transaction_date
  )
  if (usable.length === 0) return null

  let recentIdx = 0
  for (let i = 1; i < usable.length; i++) {
    if (usable[i].transaction_date! > usable[recentIdx].transaction_date!) recentIdx = i
  }

  // Lenient MAD guard: drop only prices more than k MADs from the median, and
  // never the most-recent sale. Engages only with >= 3 rows and non-zero MAD.
  let keep = usable.map(() => true)
  if (usable.length >= 3) {
    const sorted = usable.map((r) => r.pricePerSqm).sort((a, b) => a - b)
    const med = percentile(sorted, 0.5)
    if (med !== null) {
      const devs = usable.map((r) => Math.abs(r.pricePerSqm - med)).sort((a, b) => a - b)
      const mad = percentile(devs, 0.5)
      if (mad !== null && mad > 0) {
        const threshold = HDB_SAMEBLOCK_MAD_K * mad
        keep = usable.map((r, i) => i === recentIdx || Math.abs(r.pricePerSqm - med) <= threshold)
      }
    }
  }

  const now = Date.now()
  let num = 0
  let den = 0
  usable.forEach((r, i) => {
    if (!keep[i]) return
    const daysOld = Math.max(0, (now - new Date(r.transaction_date!).getTime()) / 86400000)
    const recencyWeight = Math.pow(0.5, daysOld / HDB_RECENCY_HALFLIFE_DAYS)
    const sizeWeight = 1 / Math.max(Math.abs(r.floor_area_sqm - floorAreaSqm), 5)
    const w = recencyWeight * sizeWeight
    num += r.pricePerSqm * w
    den += w
  })
  return den > 0 ? num / den : null
}

async function buildHdbCandidate(
  allRows: CleanedRow[],
  radius: number,
  floorAreaSqm: number,
  subjectFloorLevel: number | undefined,
  subjectBlockNo: string,
  subjectCompletionYear: number | null,
  subjectLat: number,
  subjectLon: number
): Promise<CandidateResult | null> {
  if (allRows.length === 0) return null

  // The subject block number can arrive null/empty (e.g. from the internal
  // checker). Fall back to the most common block number among rows that are
  // essentially at the subject location (within 50m) so same-block filtering
  // still works instead of always falling through to hdb_nearby_all.
  let effectiveBlockNo = subjectBlockNo
  if (!effectiveBlockNo) {
    const blockCounts = new Map<string, number>()
    for (const row of allRows) {
      if (row.distanceM > 50) continue
      const block = extractBlockNumber(row.address)
      if (!block) continue
      blockCounts.set(block, (blockCounts.get(block) ?? 0) + 1)
    }
    let bestCount = 0
    for (const [block, count] of blockCounts) {
      if (count > bestCount) {
        bestCount = count
        effectiveBlockNo = block
      }
    }
  }

  let sameBlockRows = effectiveBlockNo
    ? allRows.filter((row) => extractBlockNumber(row.address) === effectiveBlockNo)
    : []

  // Second fallback: if we still couldn't identify same-block rows, treat rows
  // within 50m (essentially the same location) as a same-block proxy.
  if (sameBlockRows.length === 0) {
    sameBlockRows = allRows.filter((row) => row.distanceM <= 50)
  }

  // Block-level PSF anchor: when same-type transactions in the block are sparse
  // (< 3), run a SEPARATE query for all HDB transactions in the same block
  // regardless of unit type (the main pool is restricted to the subject's unit
  // type upstream) to derive a stable block-level price-per-sqm reference. This
  // gives a sensible anchor even when same-type comparables are too few.
  let blockAnchorPsm: number | null = null
  if (sameBlockRows.length < 3 && effectiveBlockNo) {
    const box = getBoundingBox(subjectLat, subjectLon, 250)
    const { data: blockData, error: blockError } = await supabase
      .from('property_transactions_v2')
      .select(
        'transaction_price, floor_area_sqm, latitude, longitude, unit_type, tenure, price_psf, project_name, transaction_date, address, completion_year, is_strata'
      )
      .eq('property_group', 'hdb')
      .gte('latitude', box.minLat)
      .lte('latitude', box.maxLat)
      .gte('longitude', box.minLon)
      .lte('longitude', box.maxLon)
      .not('transaction_price', 'is', null)
      .not('floor_area_sqm', 'is', null)
      .not('latitude', 'is', null)
      .not('longitude', 'is', null)
      .limit(500)

    if (blockError) {
      console.error('[buildHdbCandidate] block anchor query error:', blockError)
    } else if (blockData && blockData.length > 0) {
      const sameBlockAnyTypeRows = cleanRows(
        blockData as TransactionRow[],
        subjectLat,
        subjectLon
      ).filter((row) => extractBlockNumber(row.address) === effectiveBlockNo)

      const sorted = sameBlockAnyTypeRows
        .map((r) => r.pricePerSqm)
        .filter((v) => Number.isFinite(v) && v > 0)
        .sort((a, b) => a - b)
      if (sorted.length > 0) {
        const mid = Math.floor(sorted.length / 2)
        blockAnchorPsm =
          sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
      }
    }
  }

  const mostRecentSameBlock = getMostRecentDate(sameBlockRows)
  const now = Date.now()
  const daysSinceSameBlock = mostRecentSameBlock
    ? (now - mostRecentSameBlock.getTime()) / (1000 * 60 * 60 * 24)
    : Infinity

  // Fix 1: when the caller doesn't supply the subject's completion year (the
  // Office valuation checker never does), derive it from the same-block rows in
  // hand — completion_year is 100% populated and every unit in an HDB block
  // shares it. Without this, nearbyWithSimilarAge is forced empty and the
  // drift-adjusted tier silently falls through to hdb_same_block_stale. Only
  // fills a null; a caller-provided value is never overridden.
  const effectiveCompletionYear =
    subjectCompletionYear ?? mostCommonCompletionYear(sameBlockRows)

  const nearbyWithSimilarAge = effectiveCompletionYear
    ? allRows.filter((row) => {
        if (extractBlockNumber(row.address) === effectiveBlockNo) return false
        if (!row.completion_year) return false
        return Math.abs(row.completion_year - effectiveCompletionYear) <= 5
      })
    : []

  let valuationPool: CleanedRow[]
  let method: string

if (sameBlockRows.length >= 1 && daysSinceSameBlock <= 365) {
    const oneYearAgo = Date.now() - 365 * 24 * 60 * 60 * 1000
    const recentSameBlock = sameBlockRows.filter(
      (r) => r.transaction_date && new Date(r.transaction_date).getTime() >= oneYearAgo
    )
    // Use only the last 365 days of same-block transactions for the fresh path.
    // The branch condition guarantees the most recent same-block transaction is
    // within a year, so recentSameBlock always has at least one row — never fall
    // back to the unfiltered sameBlockRows, which would reintroduce stale data.
    valuationPool = recentSameBlock
    method = 'hdb_same_block_fresh'

  } else if (sameBlockRows.length >= 1 && daysSinceSameBlock <= 730) {
    // Fix 2 (variant b): the most recent same-block sale is 1–2 years old. Price
    // off an exponential-recency-weighted same-block psm (half-life 120d) with a
    // lenient k=5 MAD guard that always keeps the most-recent sale, so a genuine
    // recent jump leads the estimate instead of being diluted by a simple average
    // (old drift tier) or discarded by k=3 MAD trimming (old stale tier).
    // Backtested (leave-one-out, 55k HDB resales): recent-jump-segment median APE
    // 16.6%→~6.3%, overall 9.6%→~5.5%, tails improve too.
    //
    // The former nearby-block "drift multiplier" is dropped: backtesting showed it
    // is redundant once the block's own recent sale is recency-weighted — keeping
    // it regressed median APE (jump 6.3%→7.0%, overall 6.1%→6.5%). With it gone the
    // old drift_adjusted and stale tiers computed identically, so they collapse
    // into one method. Scoped to THIS tier only — the fresh (<=365d) and nearby
    // (>730d) tiers are unchanged (not covered by this backtest).
    const sameBlockPsm = hdbSameBlockRecencyPsm(sameBlockRows, floorAreaSqm)
    if (sameBlockPsm && Number.isFinite(sameBlockPsm)) {
      let estimated = sameBlockPsm * floorAreaSqm
      let methodOut = 'hdb_same_block_recency'
      // Block-level PSF anchor supplement when same-type comparables are sparse
      // (blockAnchorPsm is only computed when sameBlockRows.length < 3).
      if (blockAnchorPsm && sameBlockRows.length < 3) {
        estimated = estimated * 0.7 + blockAnchorPsm * floorAreaSqm * 0.3
        methodOut = 'hdb_same_block_recency+block_anchor_30'
      }
      const psfValues = sameBlockRows.map((r) => r.pricePerSqm)
      const meanPsm = psfValues.reduce((a, b) => a + b, 0) / psfValues.length
      const stdDev = Math.sqrt(
        psfValues.reduce((s, v) => s + Math.pow(v - meanPsm, 2), 0) / psfValues.length
      )
      const halfSpread = Math.min(stdDev / meanPsm, 0.05)
      return {
        estimated,
        low: estimated * (1 - halfSpread),
        high: estimated * (1 + halfSpread),
        comparables: sameBlockRows.length,
        radius,
        method: methodOut,
      }
    }
    // Estimator unusable (no valid same-block psm) — fall through to shared weighting.
    valuationPool = sameBlockRows
    method = 'hdb_same_block_recency'

  } else if (nearbyWithSimilarAge.length >= 3) {
    valuationPool = nearbyWithSimilarAge
    method = 'hdb_nearby_same_age'

  } else {
    valuationPool = allRows
    method = 'hdb_nearby_all'
  }

  if (valuationPool.length === 0) return null

  const trimmed = trimRowsByMetric(valuationPool, (row) => row.pricePerSqm)
  if (trimmed.length === 0) return null

  const values = trimmed.map((row) => row.pricePerSqm)
  // On thin pools, cap the recency weight so a single very fresh sale can't
  // dominate the estimate. Full recency weights apply once the pool has >= 3 rows.
  const capRecency = valuationPool.length < 3
  const weights = trimmed.map((row) => {
    const distanceWeight = 1 / Math.max(row.distanceM, 50)
    const sizeDiff = Math.abs(row.floor_area_sqm - floorAreaSqm)
    const sizeWeight = 1 / Math.max(sizeDiff, 5)
    const rawRecencyWeight = getRecencyWeight(row.transaction_date, 'hdb')
    const recencyWeight = capRecency ? Math.min(rawRecencyWeight, 2.0) : rawRecencyWeight
    const floorWeight = getFloorWeight(subjectFloorLevel, row.parsedFloorLevel)
    const blockWeight = effectiveBlockNo && extractBlockNumber(row.address) === effectiveBlockNo ? 3.0 : 1.0
    const ageWeight = getHdbAgeWeight(row.completion_year, effectiveCompletionYear)
    return distanceWeight * sizeWeight * recencyWeight * floorWeight * blockWeight * ageWeight
  })

  const avgPsm = weightedAverage(values, weights)
  if (!avgPsm || !Number.isFinite(avgPsm)) return null

  const estimated = avgPsm * floorAreaSqm

  // Blend in the block-level PSF anchor when same-type comparables are sparse.
  // If we still have some same-type data, the anchor is a 30% supplement; if
  // there is no same-type data, the anchor becomes the primary signal at 70%.
  let blendedEstimate = estimated
  let blendedMethod = method
  if (blockAnchorPsm) {
    const blockAnchorEstimate = blockAnchorPsm * floorAreaSqm
    if (sameBlockRows.length > 0) {
      blendedEstimate = estimated * 0.7 + blockAnchorEstimate * 0.3
      blendedMethod = `${method}+block_anchor_30`
    } else {
      blendedEstimate = blockAnchorEstimate * 0.7 + estimated * 0.3
      blendedMethod = `${method}+block_anchor_70`
    }
  }

  // Stage 1: no flat ×1.01 bias, no floor premium (HDB floor matching is
  // currently dead — getFloorWeight ≡ 1 for HDB). Point estimate is the
  // (block-anchor-blended) weighted psm × subject area.
  const estimated2 = blendedEstimate

  const psfValues = trimmed.map((row) => row.pricePerSqm)
  const mean = psfValues.reduce((a, b) => a + b, 0) / psfValues.length
  const stdDev = Math.sqrt(
    psfValues.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / psfValues.length
  )
  const stdDevPct = stdDev / mean
  const halfSpread = Math.min(stdDevPct, 0.05)

  return {
    estimated: estimated2,
    low: estimated2 * (1 - halfSpread),
    high: estimated2 * (1 + halfSpread),
    comparables: trimmed.length,
    radius,
    method: blendedMethod,
  }
}

async function fetchRowsForRadius(
  lat: number,
  lon: number,
  radiusM: number,
  propertyType: string,
  propertyCategory: PropertyCategory
) {
  const box = getBoundingBox(lat, lon, radiusM)

  let query = supabase
    .from('property_transactions_v2')
    .select(
      'transaction_price, floor_area_sqm, latitude, longitude, unit_type, tenure, price_psf, project_name, transaction_date, address, completion_year, is_strata'
    )
    .gte('latitude', box.minLat)
    .lte('latitude', box.maxLat)
    .gte('longitude', box.minLon)
    .lte('longitude', box.maxLon)
    .not('transaction_price', 'is', null)
    .not('floor_area_sqm', 'is', null)
    .not('latitude', 'is', null)
    .not('longitude', 'is', null)
    .order('transaction_date', { ascending: false })

  if (propertyCategory === 'hdb') {
    query = query
      .eq('property_group', 'hdb')
      .eq('unit_type', normalizeText(propertyType))
      .limit(1000)
  } else if (propertyCategory === 'condo') {
    query = query
      .in('unit_type', ['Condominium', 'Apartment'])
      .in('property_subtype', ['condo', 'Resale', 'New Sale', 'Sub Sale'])
      .limit(2000)
  } else if (propertyCategory === 'ec') {
    query = query
      .in('unit_type', ['Executive Condominium'])
      .in('property_subtype', ['ec', 'Resale', 'New Sale', 'Sub Sale'])
      .limit(2000)
  } else {
    query = query
      .in('unit_type', ['Detached House', 'Semi-Detached House', 'Terrace House'])
      .in('property_subtype', ['landed_strata', 'landed_non_strata', 'Resale', 'New Sale', 'Sub Sale'])
      .limit(3000)
  }
  const { data, error } = await query
  return { data, error }
}

function cleanRows(
  rows: TransactionRow[],
  lat: number,
  lon: number
): CleanedRow[] {
  return rows
    .map((row) => {
      const transactionPrice = Number(row.transaction_price)
      const areaSqm = Number(row.floor_area_sqm)
      const rowLat = Number(row.latitude)
      const rowLon = Number(row.longitude)
      const areaSqft = areaSqm * 10.7639
      const explicitPsf = Number(row.price_psf)

      let pricePerSqft = transactionPrice / areaSqft
      if (Number.isFinite(explicitPsf) && explicitPsf > 0) {
        pricePerSqft = explicitPsf
      }

      return {
        transaction_price: transactionPrice,
        floor_area_sqm: areaSqm,
        latitude: rowLat,
        longitude: rowLon,
        unit_type: row.unit_type,
        tenure: row.tenure || null,
        project_name: row.project_name || null,
        transaction_date: row.transaction_date || null,
        address: row.address || null,
        pricePerSqm: transactionPrice / areaSqm,
        pricePerSqft,
        distanceM: distanceInMeters(lat, lon, rowLat, rowLon),
        parsedFloorLevel: parseFloorLevelFromAddress(row.address),
        completion_year: (() => {
          const yr = Number(row.completion_year)
          return (yr > 1950 && yr <= new Date().getFullYear() + 5) ? yr : null
        })(),
        is_strata: row.is_strata ?? null,
      }
    })
    .filter(
      (row) =>
        Number.isFinite(row.transaction_price) &&
        row.transaction_price > 0 &&
        Number.isFinite(row.floor_area_sqm) &&
        row.floor_area_sqm > 0 &&
        Number.isFinite(row.latitude) &&
        Number.isFinite(row.longitude) &&
        Number.isFinite(row.pricePerSqm) &&
        row.pricePerSqm > 0 &&
        Number.isFinite(row.pricePerSqft) &&
        row.pricePerSqft > 0 &&
        Number.isFinite(row.distanceM)
    )
}

// MAD (median absolute deviation) outlier trim. Robust at small n: works down
// to n=3, unlike the previous p10/p90 (trimRowsByMetric) and p15/p85
// (trimCondoEcOutliers) percentile trims, which silently no-op'd below n=5 —
// exactly the thin pools most exposed to a single bad comp. A row is dropped
// when its metric lies more than MAD_TRIM_K median-absolute-deviations from the
// median. If MAD is 0 (majority of values identical) there is nothing to trim.
// Reverts to the input set if fewer than 3 rows survive (small-sample safety).
const MAD_TRIM_K = 3

function madTrim(
  rows: CleanedRow[],
  metricGetter: (row: CleanedRow) => number
) {
  if (rows.length < 3) return rows

  const values = rows
    .map(metricGetter)
    .filter((value) => Number.isFinite(value) && value > 0)
    .sort((a, b) => a - b)
  if (values.length < 3) return rows

  const med = percentile(values, 0.5)
  if (med === null) return rows

  const absDevs = values.map((v) => Math.abs(v - med)).sort((a, b) => a - b)
  const mad = percentile(absDevs, 0.5)
  if (mad === null || mad === 0) return rows

  const threshold = MAD_TRIM_K * mad
  const trimmed = rows.filter((row) => {
    const value = metricGetter(row)
    return Number.isFinite(value) && value > 0 && Math.abs(value - med) <= threshold
  })

  return trimmed.length >= 3 ? trimmed : rows
}

function trimRowsByMetric(
  rows: CleanedRow[],
  metricGetter: (row: CleanedRow) => number
) {
  return madTrim(rows, metricGetter)
}

function filterByAreaRatio(
  rows: CleanedRow[],
  subjectAreaSqm: number,
  minRatio: number,
  maxRatio: number
) {
  return rows.filter((row) => {
    const ratio = row.floor_area_sqm / subjectAreaSqm
    return ratio >= minRatio && ratio <= maxRatio
  })
}

function getCondoEcAreaBands(subjectAreaSqm: number) {
  if (subjectAreaSqm <= 60) {
    return {
      strict: { min: 0.92, max: 1.08 },
      medium: { min: 0.88, max: 1.12 },
      wide: { min: 0.85, max: 1.15 },
    }
  }

  if (subjectAreaSqm <= 90) {
    return {
      strict: { min: 0.90, max: 1.10 },
      medium: { min: 0.85, max: 1.15 },
      wide: { min: 0.80, max: 1.20 },
    }
  }

  return {
    strict: { min: 0.85, max: 1.15 },
    medium: { min: 0.80, max: 1.20 },
    wide: { min: 0.75, max: 1.25 },
  }
}

function trimCondoEcOutliers(rows: CleanedRow[]) {
  return madTrim(rows, (row) => row.pricePerSqm)
}

function getCondoEcProjectWeight(
  row: CleanedRow,
  subjectProjectName?: string | null
) {
  const subject = normalizeText(subjectProjectName)
  const rowProject = normalizeText(row.project_name)

  if (!subject || !rowProject) return 1
  if (rowProject === subject) return 2.2

  return 1
}

function getCondoEcAgeWeight(
  row: CleanedRow,
  subjectCompletionYear?: number | null
) {
  if (!subjectCompletionYear || !row.completion_year) return 1

  const diff = Math.abs(row.completion_year - subjectCompletionYear)

  if (diff <= 3) return 1.2
  if (diff <= 5) return 1.12
  if (diff <= 10) return 1
  if (diff <= 15) return 0.85
  return 0.65
}

function getCondoEcTenureWeight(
  row: CleanedRow,
  subjectTenureBucket?: string
) {
  if (!subjectTenureBucket || subjectTenureBucket === 'UNKNOWN') return 1

  const rowBucket = normalizeTenureBucket(row.tenure)

  if (rowBucket === subjectTenureBucket) return 1.08
  if (rowBucket === 'UNKNOWN') return 0.96
  return 0.82
}

function splitRowsByRecency(rows: CleanedRow[]) {
  const fresh: CleanedRow[] = []
  const moderate: CleanedRow[] = []
  const stale: CleanedRow[] = []

  for (const row of rows) {
    const daysOld = getDaysOld(row.transaction_date)

    if (daysOld === null || daysOld <= 365) {
      fresh.push(row)
    } else if (daysOld <= 730) {
      moderate.push(row)
    } else {
      stale.push(row)
    }
  }

  return { fresh, moderate, stale }
}

function getMedian(values: number[]) {
  const sorted = values
    .filter((value) => Number.isFinite(value) && value > 0)
    .sort((a, b) => a - b)

  return percentile(sorted, 0.5)
}

function getMedianPsm(rows: CleanedRow[]) {
  return getMedian(rows.map((row) => row.pricePerSqm))
}

function getMostRecentDaysOld(rows: CleanedRow[]) {
  const dayValues = rows
    .map((row) => getDaysOld(row.transaction_date))
    .filter((value): value is number => value !== null && Number.isFinite(value))

  if (dayValues.length === 0) return null
  return Math.min(...dayValues)
}

// Cap on the market-movement adjustment applied to a stale same-project anchor,
// widening with anchor staleness (an older anchor may legitimately need a larger
// drift correction). Note: getCondoEcMarketMovement is only invoked when the
// anchor is > 365d old, so the <= 365 branch (±3%) is effectively unreachable via
// that path (a fresh anchor gets movement = 1, i.e. no adjustment).
function getCondoEcMarketMovementCap(daysOld: number | null) {
  if (daysOld === null || daysOld <= 365) return 0.03
  if (daysOld <= 730) return 0.06 // anchor 1–2y old
  if (daysOld <= 1095) return 0.08 // 2–3y
  return 0.12 // > 3y
}

function getCondoEcAnchorSpread(rows: CleanedRow[], daysOld: number | null) {
  const freshnessSpread =
    daysOld === null || daysOld <= 365
      ? 0.04
      : daysOld <= 730
      ? 0.06
      : daysOld <= 1095
      ? 0.08
      : 0.10

  const psmValues = rows
    .map((row) => row.pricePerSqm)
    .filter((value) => Number.isFinite(value) && value > 0)

  if (psmValues.length < 2) return freshnessSpread

  const mean = psmValues.reduce((sum, value) => sum + value, 0) / psmValues.length
  if (!mean || !Number.isFinite(mean)) return freshnessSpread

  const stdDev = Math.sqrt(
    psmValues.reduce((sum, value) => sum + Math.pow(value - mean, 2), 0) /
      psmValues.length
  )
  const stdDevPct = stdDev / mean

  return Math.max(freshnessSpread, Math.min(stdDevPct, 0.12))
}


// Stage 1 removal: the seller-friendly same-project calibration (+2.5–4% uplift,
// ceilinged at p90) was a one-directional upward bias with no evidence basis and
// has been removed. The same-project anchor psm is now used directly.

function pickSameProjectAnchorRows(
  sameProjectRows: CleanedRow[],
  floorAreaSqm: number
) {
  const areaBands = getCondoEcAreaBands(floorAreaSqm)

  const strict = filterByAreaRatio(
    sameProjectRows,
    floorAreaSqm,
    areaBands.strict.min,
    areaBands.strict.max
  )
  if (strict.length >= 1) return strict

  const medium = filterByAreaRatio(
    sameProjectRows,
    floorAreaSqm,
    areaBands.medium.min,
    areaBands.medium.max
  )
  if (medium.length >= 1) return medium

  const wide = filterByAreaRatio(
    sameProjectRows,
    floorAreaSqm,
    areaBands.wide.min,
    areaBands.wide.max
  )
  if (wide.length >= 1) return wide

  const broad = filterByAreaRatio(sameProjectRows, floorAreaSqm, 0.6, 1.6)
  return broad.length >= 1 ? broad : []
}


function getWeightedPsmForRows(
  rows: CleanedRow[],
  floorAreaSqm: number,
  propertyCategory: PropertyCategory,
  subjectFloorLevel?: number
) {
  if (rows.length === 0) return null

  const values = rows.map((row) => row.pricePerSqm)
  const weights = rows.map((row) => {
    const areaRatio = row.floor_area_sqm / floorAreaSqm
    const sizeCloseness = 1 / (Math.abs(Math.log(Math.max(areaRatio, 0.01))) + 0.08)
    const recencyWeight = getRecencyWeight(row.transaction_date, propertyCategory)
    const floorWeight = getFloorWeight(subjectFloorLevel, row.parsedFloorLevel)

    return sizeCloseness * recencyWeight * floorWeight
  })

  return weightedAverage(values, weights)
}

function getWeightedAreaForRows(rows: CleanedRow[], floorAreaSqm: number) {
  if (rows.length === 0) return null

  const values = rows.map((row) => row.floor_area_sqm)
  const weights = rows.map((row) => {
    const areaRatio = row.floor_area_sqm / floorAreaSqm
    return 1 / (Math.abs(Math.log(Math.max(areaRatio, 0.01))) + 0.08)
  })

  return weightedAverage(values, weights)
}

function getSameProjectSizeCurveRows(
  sameProjectRows: CleanedRow[],
  floorAreaSqm: number
) {
  const oneYearAgo = Date.now() - 365 * 24 * 60 * 60 * 1000
  const recentRows = sameProjectRows.filter(
    (r) => r.transaction_date && new Date(r.transaction_date).getTime() >= oneYearAgo
  )
  const basePool = recentRows.length >= 3 ? recentRows : sameProjectRows

  const usefulRows = filterByAreaRatio(basePool, floorAreaSqm, 0.45, 1.90)
  const baseRows = usefulRows.length >= 2 ? usefulRows : basePool

  const trimmed = trimCondoEcOutliers(baseRows)
  return trimmed.length > 0 ? trimmed : baseRows
}

function getSideAnchorForSizeCurve(
  rows: CleanedRow[],
  floorAreaSqm: number,
  propertyCategory: PropertyCategory,
  subjectFloorLevel: number | undefined,
  side: 'lower' | 'upper'
) {
  const sideRows = rows
    .filter((row) =>
      side === 'lower'
        ? row.floor_area_sqm <= floorAreaSqm
        : row.floor_area_sqm >= floorAreaSqm
    )
    .sort((a, b) =>
      Math.abs(Math.log(a.floor_area_sqm / floorAreaSqm)) -
      Math.abs(Math.log(b.floor_area_sqm / floorAreaSqm))
    )
    .slice(0, 3)

  if (sideRows.length === 0) return null

  const psm = getWeightedPsmForRows(
    sideRows,
    floorAreaSqm,
    propertyCategory,
    subjectFloorLevel
  )
  const area = getWeightedAreaForRows(sideRows, floorAreaSqm)

  if (!psm || !area || !Number.isFinite(psm) || !Number.isFinite(area)) {
    return null
  }

  return { psm, area, rows: sideRows }
}

function getSameProjectSizeAdjustedPsm(
  sameProjectRows: CleanedRow[],
  floorAreaSqm: number,
  propertyCategory: PropertyCategory,
  subjectFloorLevel?: number
) {
  const curveRows = getSameProjectSizeCurveRows(sameProjectRows, floorAreaSqm)
  if (curveRows.length === 0) return null

  const lowerAnchor = getSideAnchorForSizeCurve(
    curveRows,
    floorAreaSqm,
    propertyCategory,
    subjectFloorLevel,
    'lower'
  )
  const upperAnchor = getSideAnchorForSizeCurve(
    curveRows,
    floorAreaSqm,
    propertyCategory,
    subjectFloorLevel,
    'upper'
  )

  let curvePsm: number | null = null
  let curveAnchorRows: CleanedRow[] = []

  if (
    lowerAnchor &&
    upperAnchor &&
    Math.abs(Math.log(upperAnchor.area / lowerAnchor.area)) > 0.02
  ) {
    const lowerAreaLog = Math.log(lowerAnchor.area)
    const upperAreaLog = Math.log(upperAnchor.area)
    const subjectAreaLog = Math.log(floorAreaSqm)
    const t = Math.max(
      0,
      Math.min(1, (subjectAreaLog - lowerAreaLog) / (upperAreaLog - lowerAreaLog))
    )

    // Log interpolation respects the usual condo/EC size effect:
    // smaller units tend to command higher PSF, larger units lower PSF.
    curvePsm = Math.exp(
      Math.log(lowerAnchor.psm) * (1 - t) + Math.log(upperAnchor.psm) * t
    )
    curveAnchorRows = [...lowerAnchor.rows, ...upperAnchor.rows]
  } else {
    const nearestRows = [...curveRows]
      .sort((a, b) =>
        Math.abs(Math.log(a.floor_area_sqm / floorAreaSqm)) -
        Math.abs(Math.log(b.floor_area_sqm / floorAreaSqm))
      )
      .slice(0, Math.min(3, curveRows.length))

    const nearestPsm = getWeightedPsmForRows(
      nearestRows,
      floorAreaSqm,
      propertyCategory,
      subjectFloorLevel
    )
    const nearestArea = getWeightedAreaForRows(nearestRows, floorAreaSqm)

    if (nearestPsm && nearestArea) {
      const sizeGap = Math.abs(Math.log(floorAreaSqm / nearestArea))
      const maxAdjustment = Math.min(0.08, sizeGap * 0.08)
      const extrapolationAdjustment =
        floorAreaSqm > nearestArea ? 1 - maxAdjustment : 1 + maxAdjustment

      curvePsm = nearestPsm * extrapolationAdjustment
      curveAnchorRows = nearestRows
    }
  }

  if (!curvePsm || !Number.isFinite(curvePsm)) return null

  // Stage 3 (backtested): recency-bound the 25% similar-blend path. Left
  // unbounded, pickSameProjectAnchorRows draws similar-size comps from the full
  // ~5-year same-project history, which drags this 25% down in fast-rising
  // projects and produced a momentum-correlated downward lean (median −3.4%, up
  // to −13…−16% for the fastest-rising projects). Prefer same-project sales from
  // the last 12 months; fall back to the full history only when fewer than 3
  // recent sales exist. The side anchors (already recency-gated via
  // getSameProjectSizeCurveRows) and the min/max clamp are intentionally left
  // untouched — the fix is scoped strictly to this 25% path. Backtest: overall
  // median APE halved (~7% → ~3.2%), momentum slope halved, no upward-bias
  // regression on flat/declining projects.
  const recentSameProjectRows = sameProjectRows.filter((row) => {
    const daysOld = getDaysOld(row.transaction_date)
    return daysOld !== null && daysOld <= 365
  })
  const similarPool =
    recentSameProjectRows.length >= 3 ? recentSameProjectRows : sameProjectRows
  const similarRows = trimCondoEcOutliers(
    pickSameProjectAnchorRows(similarPool, floorAreaSqm)
  )
  const similarWeightedPsm = getWeightedPsmForRows(
    similarRows,
    floorAreaSqm,
    propertyCategory,
    subjectFloorLevel
  )

  let finalPsm =
    similarWeightedPsm && Number.isFinite(similarWeightedPsm)
      ? curvePsm * 0.75 + similarWeightedPsm * 0.25
      : curvePsm

  const sameProjectPsmValues = sameProjectRows
    .map((row) => row.pricePerSqm)
    .filter((value) => Number.isFinite(value) && value > 0)
    .sort((a, b) => a - b)

  const minPsm = sameProjectPsmValues[0]
  const maxPsm = sameProjectPsmValues[sameProjectPsmValues.length - 1]

  if (minPsm && maxPsm) {
    // Allow mild extrapolation, but stop one very small or very large unit
    // from dragging the entire project valuation too far.
    finalPsm = Math.max(minPsm * 0.92, Math.min(maxPsm * 1.08, finalPsm))
  }

  const anchorRows = curveAnchorRows.length > 0 ? curveAnchorRows : curveRows

  return {
    psm: finalPsm,
    anchorRows,
  }
}

function getCondoEcNearbySupportRows(
  rows: CleanedRow[],
  floorAreaSqm: number,
  subjectProjectName?: string | null,
  subjectCompletionYear?: number | null,
  subjectTenureBucket?: string
) {
  const normalizedSubjectProject = normalizeText(subjectProjectName)
  const areaBands = getCondoEcAreaBands(floorAreaSqm)

  let supportRows = normalizedSubjectProject
    ? rows.filter((row) => normalizeText(row.project_name) !== normalizedSubjectProject)
    : [...rows]

  if (subjectCompletionYear) {
    const similarAgeRows = supportRows.filter((row) => {
      if (!row.completion_year) return false
      return Math.abs(row.completion_year - subjectCompletionYear) <= 10
    })

    if (similarAgeRows.length >= 3) {
      supportRows = similarAgeRows
    } else {
      const broaderAgeRows = supportRows.filter((row) => {
        if (!row.completion_year) return false
        return Math.abs(row.completion_year - subjectCompletionYear) <= 15
      })

      if (broaderAgeRows.length >= 3) {
        supportRows = broaderAgeRows
      } else {
        const antiNewLaunchRows = supportRows.filter((row) => {
          if (!row.completion_year) return true
          return row.completion_year <= subjectCompletionYear + 8
        })

        if (antiNewLaunchRows.length >= 3) {
          supportRows = antiNewLaunchRows
        }
      }
    }
  }

  if (subjectTenureBucket && subjectTenureBucket !== 'UNKNOWN') {
    const sameTenureRows = supportRows.filter(
      (row) => normalizeTenureBucket(row.tenure) === subjectTenureBucket
    )

    if (sameTenureRows.length >= 3) {
      supportRows = sameTenureRows
    }
  }

  const strictAreaRows = filterByAreaRatio(
    supportRows,
    floorAreaSqm,
    areaBands.strict.min,
    areaBands.strict.max
  )
  if (strictAreaRows.length >= 3) {
    supportRows = strictAreaRows
  } else {
    const mediumAreaRows = filterByAreaRatio(
      supportRows,
      floorAreaSqm,
      areaBands.medium.min,
      areaBands.medium.max
    )

    if (mediumAreaRows.length >= 3) {
      supportRows = mediumAreaRows
    } else {
      const wideAreaRows = filterByAreaRatio(
        supportRows,
        floorAreaSqm,
        areaBands.wide.min,
        areaBands.wide.max
      )

      if (wideAreaRows.length >= 3) {
        supportRows = wideAreaRows
      }
    }
  }

  return trimCondoEcOutliers(supportRows)
    .sort((a, b) => a.distanceM - b.distanceM)
    .slice(0, 30)
}

// ─── Market-movement momentum (condo/EC) ─────────────────────────────────────
// The ONLY momentum/drift signal in the condo/EC engine. Used only by the
// same-project path, and only to correct a STALE same-project anchor (its caller
// invokes it only when the anchor's latest sale is > 365d old).
//
// Signal = median psm of NEARBY support rows in the last 12 months ÷ median psm
// of NEARBY support rows within ±6 months of the same-project anchor's latest
// sale date. I.e. "how much has the comparable NEARBY market moved between when
// the same-project anchor comps transacted and now." Data source is NEARBY
// (other-project) rows of similar age/tenure (see getCondoEcNearbySupportRows) —
// NOT the subject's own project.
//
// Thresholds (all must hold, else returns null = "not measurable"):
//   • supportRows.length >= 6            (enough nearby comps overall)
//   • recentSupportRows.length >= 3      (>= 3 nearby sales in the last 12 months)
//   • anchorPeriodSupportRows.length >= 3 (>= 3 nearby sales in the anchor's ±6mo)
//
// NOTE — mismatch with the density investigation: that framed momentum as
// same-project sales, >= 3 in the last 6mo AND >= 3 in the prior 6–12mo. This
// function differs on both axes: it uses NEARBY (not same-project) rows, and its
// windows are last-12mo vs the anchor's ±6mo period (not 6mo vs 6–12mo). A proper
// same-project momentum along the density design has NOT been built — see the
// Stage 3b section of valuation-redesign-plan.md. Returns the raw (unclamped)
// ratio; the caller clamps it (getCondoEcMarketMovementCap) before applying.
function getCondoEcMarketMovement(
  anchorRows: CleanedRow[],
  supportRows: CleanedRow[]
): number | null {
  const latestAnchorDate = getMostRecentDate(anchorRows)
  if (!latestAnchorDate || supportRows.length < 6) return null

  const dayMs = 24 * 60 * 60 * 1000
  const now = Date.now()
  const anchorTime = latestAnchorDate.getTime()

  const recentSupportRows = supportRows.filter((row) => {
    if (!row.transaction_date) return false
    const time = new Date(row.transaction_date).getTime()
    return Number.isFinite(time) && time >= now - 365 * dayMs
  })

  const anchorPeriodSupportRows = supportRows.filter((row) => {
    if (!row.transaction_date) return false
    const time = new Date(row.transaction_date).getTime()
    return (
      Number.isFinite(time) &&
      time >= anchorTime - 183 * dayMs &&
      time <= anchorTime + 183 * dayMs
    )
  })

  if (recentSupportRows.length < 3 || anchorPeriodSupportRows.length < 3) return null

  const recentMedian = getMedianPsm(recentSupportRows)
  const anchorPeriodMedian = getMedianPsm(anchorPeriodSupportRows)

  if (!recentMedian || !anchorPeriodMedian || anchorPeriodMedian <= 0) return null

  const movement = recentMedian / anchorPeriodMedian
  return Number.isFinite(movement) && movement > 0 ? movement : null
}

// ─── Stage 3c: Suggested Listing Price momentum signal ───────────────────────
// A DEDICATED, always-attempted momentum reading (distinct from the stale-anchor
// getCondoEcMarketMovement above — see valuation-redesign-plan.md Stage 3b/3c).
// Density-validated design: median psf trend, last-6mo vs prior-6-12mo, requiring
// >= 3 sales in BOTH windows. Same-project first; when thin, fall back to nearby
// (getCondoEcNearbySupportRows: other-project, similar age/tenure) with the same
// window rule; else no signal. Live density: same-project ~70% of requests by
// volume, nearby ~23%, none ~7%.
const SLP_MARKUP_SCALE = 0.75
const SLP_MARKUP_CAP_PCT = 8

type MomentumBasis = 'same_project' | 'nearby' | 'none'

// median psf(last 180d) / median psf(180–365d) − 1, as a percent. Null unless both
// windows have >= 3 sales. (psm vs psf is irrelevant — it is a ratio.)
function medianPsmWindowMomentumPct(rows: CleanedRow[]): number | null {
  const last6: number[] = []
  const prior: number[] = []
  for (const row of rows) {
    const daysOld = getDaysOld(row.transaction_date)
    if (daysOld === null) continue
    if (daysOld <= 180) last6.push(row.pricePerSqm)
    else if (daysOld <= 365) prior.push(row.pricePerSqm)
  }
  if (last6.length < 3 || prior.length < 3) return null
  const recent = getMedian(last6)
  const older = getMedian(prior)
  if (!recent || !older || older <= 0) return null
  return (recent / older - 1) * 100
}

function getCondoEcMomentum(
  sameProjectRows: CleanedRow[],
  supportRows: CleanedRow[]
): { momentumPct: number | null; basis: MomentumBasis } {
  const sameProject = medianPsmWindowMomentumPct(sameProjectRows)
  if (sameProject !== null) return { momentumPct: sameProject, basis: 'same_project' }
  const nearby = medianPsmWindowMomentumPct(supportRows)
  if (nearby !== null) return { momentumPct: nearby, basis: 'nearby' }
  return { momentumPct: null, basis: 'none' }
}

// Strategic listing markup from a momentum reading: a fraction of recent upward
// momentum, floored at 0 (never below Market Value) and capped (above which a
// markup is not credible regardless of momentum). CAP justified against the real
// momentum distribution (p95 ≈ +8%); binds only for the hot/noisy tail.
function getSlpMarkupPct(momentumPct: number | null): number {
  if (momentumPct === null || !Number.isFinite(momentumPct)) return 0
  return Math.max(0, Math.min(SLP_MARKUP_CAP_PCT, momentumPct * SLP_MARKUP_SCALE))
}

// ---- Stage 2: repeat-sale conditional fallback (condo/EC) ----
// Blend the subject unit's own prior sale (trended forward by the project's
// appreciation CAGR) into the same-project estimate, but ONLY when the
// same-project similar-size comparable pool is thin. Backtests showed this helps
// only in the thin-comp (illiquid) segment; the well-comped majority is
// unaffected. See valuation-redesign-plan.md, Stage 2.
const CITYWIDE_CAGR = 0.0328 // citywide median same-unit annualized appreciation (187,859 pairs)
const REPEAT_THIN_POOL_MAX = 5 // gate: only blend when similar-size same-project comps <= this
const REPEAT_SIZE_BAND = 0.15 // +-15% area band for the thin-pool gate (mirrors the backtest)
const REPEAT_WINDOW_DAYS = 730 // recency window for the thin-pool gate
const REPEAT_CAGR_MIN_PAIRS = 5
const REPEAT_UNIT_TOKEN_RE = /#\s*\d{1,3}\s*-\s*\d{1,4}/
// Large-swing safety net: when excluding the subject unit moves the same-project
// comparable by more than REPEAT_SWING_THRESHOLD, the thin pool was leaning
// heavily on the subject's own prior sale — genuine uncertainty. Widen the band
// by (looShift capped at REPEAT_SWING_SPREAD_CAP) and flag thinDataWarning so the
// UI can caveat that the estimate relies heavily on one prior transaction.
const REPEAT_SWING_THRESHOLD = 0.075
const REPEAT_SWING_SPREAD_CAP = 0.12

// Decode the few HTML entities that appear in stored addresses, then upper/space
// normalize, so a caller-supplied subject address matches stored rows for the
// SAME physical unit (block + #floor-stack).
function repeatUnitKey(address: string | null | undefined): string {
  const decoded = (address || '')
    .replace(/&#0*39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&#(\d+);/g, (whole, n) => {
      const code = Number(n)
      return Number.isFinite(code) ? String.fromCharCode(code) : whole
    })
  return decoded.toUpperCase().replace(/\s+/g, ' ').trim()
}

// Robust same-unit identity for matching a CALLER-supplied subject address against
// stored transaction addresses. Stored addresses are "BLOCK STREET #FLOOR-STACK";
// callers legitimately vary the surrounding text — appending "Singapore <postal>"
// (the Office valuation checker does this) or spelling the street differently. Block
// number + unit token uniquely identify a unit WITHIN an already same-project pool,
// so we key on just those two and ignore street/postal. Exact full-string matching
// here silently fails on any such variation — which left Stage 2 dormant for every
// real caller. Returns '' when the address carries no unit token (not keyable).
function robustUnitKey(address: string | null | undefined): string {
  const norm = repeatUnitKey(address)
  const unitMatch = norm.match(REPEAT_UNIT_TOKEN_RE)
  if (!unitMatch) return ''
  const unit = unitMatch[0].replace(/\s+/g, '')
  const blockMatch = norm.match(/^(\d+[A-Z]?)\b/)
  return `${blockMatch ? blockMatch[1] : ''}|${unit}`
}

// Project appreciation CAGR from same-unit consecutive resales within the pool:
// median annualized return over pairs held >= 6 months. Falls back to the
// citywide median when the project has < REPEAT_CAGR_MIN_PAIRS pairs. Clamped.
function projectCagrFromRows(sameProjectRows: CleanedRow[]): number {
  const byUnit = new Map<string, CleanedRow[]>()
  for (const row of sameProjectRows) {
    if (!row.transaction_date) continue
    const key = robustUnitKey(row.address)
    if (!key) continue
    const arr = byUnit.get(key)
    if (arr) arr.push(row)
    else byUnit.set(key, [row])
  }
  const returns: number[] = []
  for (const arr of Array.from(byUnit.values())) {
    if (arr.length < 2) continue
    arr.sort((a, b) => (a.transaction_date! < b.transaction_date! ? -1 : 1))
    for (let i = 1; i < arr.length; i++) {
      const buy = arr[i - 1]
      const sell = arr[i]
      const yrs =
        (Date.parse(sell.transaction_date!) - Date.parse(buy.transaction_date!)) /
        (365.25 * 24 * 60 * 60 * 1000)
      if (yrs >= 0.5 && buy.transaction_price > 0) {
        returns.push(Math.pow(sell.transaction_price / buy.transaction_price, 1 / yrs) - 1)
      }
    }
  }
  if (returns.length < REPEAT_CAGR_MIN_PAIRS) return CITYWIDE_CAGR
  returns.sort((a, b) => a - b)
  const mid = Math.floor(returns.length / 2)
  const cagr = returns.length % 2 ? returns[mid] : (returns[mid - 1] + returns[mid]) / 2
  return Math.max(-0.05, Math.min(0.15, cagr))
}

// The subject unit's most recent recorded sale (same project + same unit token),
// used as the repeat-sale anchor. null if the subject address carries no unit
// token or the unit has no sale in the pool.
function findSubjectPriorSale(
  sameProjectRows: CleanedRow[],
  subjectAddress: string | null | undefined
): CleanedRow | null {
  const key = robustUnitKey(subjectAddress)
  if (!key) return null
  let best: CleanedRow | null = null
  for (const row of sameProjectRows) {
    if (!row.transaction_date) continue
    if (robustUnitKey(row.address) !== key) continue
    if (!best || row.transaction_date > best.transaction_date!) best = row
  }
  return best
}

// ─── Stage 3b: condo/EC floor curve (size-controlled log-log elasticity) ──────
// Replaces the additive floor premium removed in Stage 1 with a proper curve:
// psm ∝ floor^β. The base estimate is scaled from the comps' reference floor to
// the subject's floor by (subjectFloor / compAvgFloor)^β, clamped ±10%. β is fit
// live per project when it has enough floor spread (size-controlled 2-var
// regression); thin projects fall back to a height-tier β. Backtested (leave-one-
// out): closes the floor-driven error scatter (corr −0.36 → −0.03), median APE
// 3.20% → 2.93%, no regression on mid-floor units.

// Height-tier fallback elasticities for projects too thin to fit their own β.
// Baked-in static fit (2026-07 Stage 3b backtest) — the fallback of last resort
// and the source of truth for any tier the cache doesn't validly override.
const CONDO_EC_FLOOR_TIER_BETA_STATIC: Record<'low' | 'mid' | 'high' | 'vhigh', number> = {
  low: 0.015, // project max floor <= 12
  mid: 0.031, // 13–24
  high: 0.04, // 25–40
  vhigh: 0.053, // > 40
}

// Floor premia drift with the market, so the tier betas are RECOMPUTED monthly by
// scripts/floor_beta_recompute/recompute_floor_betas.py (mirrors the weekly HDB
// sync Action) and cached in ./condoEcFloorTierBeta.json, which is imported above.
// The cache is merged over the static table per tier, but only for a value that
// passes the same plausibility guard the recompute applies before writing:
// finite and within [0, 0.10]. Anything else (a hand-edited or corrupt cache, a
// missing tier) silently falls back to the static value — the cache can refresh
// the numbers but can never make the engine worse than its shipped baseline.
const CONDO_EC_FLOOR_TIER_BETA: Record<'low' | 'mid' | 'high' | 'vhigh', number> = (() => {
  const cached = (condoEcFloorTierBetaCache as { betas?: Record<string, unknown> }).betas ?? {}
  const merged = { ...CONDO_EC_FLOOR_TIER_BETA_STATIC }
  for (const tier of ['low', 'mid', 'high', 'vhigh'] as const) {
    const v = cached[tier]
    if (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 0.1) merged[tier] = v
  }
  return merged
})()
const CONDO_EC_FLOOR_BETA_MIN_DISTINCT = 8
// A same-project β needs a reasonably large sample to be stable: the pool the
// engine sees is radius-limited (a dense-area new launch can be truncated to ~20
// recent, same-period rows by the 2000-row pull), and a 2-var regression on that
// gives a noise slope (~0.003) instead of the true ~0.05. Live-verified: β is
// stable from ~50 rows; below this threshold we fall back to the height-tier β,
// which the backtest confirmed is a reliable proxy.
const CONDO_EC_FLOOR_BETA_MIN_ROWS = 40
const CONDO_EC_FLOOR_MULT_CLAMP = 0.1

function condoEcHeightTierBeta(sameProjectRows: CleanedRow[]): number {
  let maxFloor = 0
  for (const row of sameProjectRows) {
    const f = row.parsedFloorLevel
    if (f !== null && Number.isFinite(f) && f > maxFloor) maxFloor = f
  }
  const tier = maxFloor <= 12 ? 'low' : maxFloor <= 24 ? 'mid' : maxFloor <= 40 ? 'high' : 'vhigh'
  return CONDO_EC_FLOOR_TIER_BETA[tier]
}

// Live per-project floor elasticity: OLS of ln(psm) on ln(floor) and ln(area)
// over the last 5 years. β is a level-invariant SHAPE, so the wider window is safe
// here — unlike price-level components, old floor spreads can't reintroduce the
// momentum bug. Returns null when the project lacks the floor spread to fit a
// reliable slope (falls back to the height-tier β).
function getCondoEcProjectFloorBeta(sameProjectRows: CleanedRow[]): number | null {
  const rows = sameProjectRows.filter((row) => {
    const f = row.parsedFloorLevel
    const daysOld = getDaysOld(row.transaction_date)
    return (
      f !== null &&
      Number.isFinite(f) &&
      f > 0 &&
      row.floor_area_sqm > 0 &&
      row.pricePerSqm > 0 &&
      daysOld !== null &&
      daysOld <= 365 * 5
    )
  })
  if (rows.length < CONDO_EC_FLOOR_BETA_MIN_ROWS) return null
  if (new Set(rows.map((r) => r.parsedFloorLevel)).size < CONDO_EC_FLOOR_BETA_MIN_DISTINCT) return null

  const lf = rows.map((r) => Math.log(r.parsedFloorLevel as number))
  const la = rows.map((r) => Math.log(r.floor_area_sqm))
  const ly = rows.map((r) => Math.log(r.pricePerSqm))
  const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length
  const mf = mean(lf)
  const ma = mean(la)
  const my = mean(ly)
  // Normal equations for ln(psm) = β·ln(floor) + γ·ln(area) on mean-centred data.
  let s11 = 0
  let s22 = 0
  let s12 = 0
  let s1y = 0
  let s2y = 0
  for (let i = 0; i < rows.length; i++) {
    const x1 = lf[i] - mf
    const x2 = la[i] - ma
    const y = ly[i] - my
    s11 += x1 * x1
    s22 += x2 * x2
    s12 += x1 * x2
    s1y += x1 * y
    s2y += x2 * y
  }
  const det = s11 * s22 - s12 * s12
  if (Math.abs(det) < 1e-9) return null
  const beta = (s22 * s1y - s12 * s2y) / det
  if (!Number.isFinite(beta)) return null
  return Math.max(-0.02, Math.min(0.12, beta)) // sane elasticity clamp
}

// Weighted mean floor of the comps (size-closeness × recency; no floor weight) —
// the reference floor the base anchor reflects. Null when no floor data.
function getWeightedFloorForRows(
  rows: CleanedRow[],
  floorAreaSqm: number,
  propertyCategory: PropertyCategory
): number | null {
  const withFloor = rows.filter(
    (r) => r.parsedFloorLevel !== null && Number.isFinite(r.parsedFloorLevel) && (r.parsedFloorLevel as number) > 0
  )
  if (withFloor.length === 0) return null
  const values = withFloor.map((r) => r.parsedFloorLevel as number)
  const weights = withFloor.map((r) => {
    const areaRatio = r.floor_area_sqm / floorAreaSqm
    const sizeCloseness = 1 / (Math.abs(Math.log(Math.max(areaRatio, 0.01))) + 0.08)
    return sizeCloseness * getRecencyWeight(r.transaction_date, propertyCategory)
  })
  return weightedAverage(values, weights)
}

// Floor multiplier: scale the base estimate from the comps' avg floor to the
// subject's floor along psm ∝ floor^β. Clamped ±10%. Returns 1 (no-op) when the
// subject floor or the reference floor is unavailable.
function getCondoEcFloorMultiplier(
  sameProjectRows: CleanedRow[],
  subjectFloorLevel: number | undefined,
  compAvgFloor: number | null
): number {
  if (!subjectFloorLevel || subjectFloorLevel <= 0 || !compAvgFloor || compAvgFloor <= 0) return 1
  const beta = getCondoEcProjectFloorBeta(sameProjectRows) ?? condoEcHeightTierBeta(sameProjectRows)
  const mult = Math.pow(subjectFloorLevel / compAvgFloor, beta)
  return Math.max(1 - CONDO_EC_FLOOR_MULT_CLAMP, Math.min(1 + CONDO_EC_FLOOR_MULT_CLAMP, mult))
}

function buildSameProjectCondoEcCandidate(
  rows: CleanedRow[],
  radius: number,
  floorAreaSqm: number,
  propertyCategory: PropertyCategory,
  subjectFloorLevel?: number,
  subjectProjectName?: string | null,
  subjectCompletionYear?: number | null,
  subjectTenureBucket?: string,
  subjectAddress?: string | null
): CandidateResult | null {
  const normalizedSubjectProject = normalizeText(subjectProjectName)
  if (!normalizedSubjectProject) return null

  const sameProjectRows = rows.filter(
    (row) => normalizeText(row.project_name) === normalizedSubjectProject
  )

  if (sameProjectRows.length === 0) return null

  const sizeAdjustedAnchor = getSameProjectSizeAdjustedPsm(
    sameProjectRows,
    floorAreaSqm,
    propertyCategory,
    subjectFloorLevel
  )

  if (!sizeAdjustedAnchor) return null

  const anchorRows = sizeAdjustedAnchor.anchorRows
  const anchorPsm = sizeAdjustedAnchor.psm

  if (!anchorPsm || !Number.isFinite(anchorPsm)) return null

  const latestDaysOld = getMostRecentDaysOld(anchorRows)
  const supportRows = getCondoEcNearbySupportRows(
    rows,
    floorAreaSqm,
    subjectProjectName,
    subjectCompletionYear,
    subjectTenureBucket
  )

  // Market-movement drift correction — only when the same-project anchor is stale
  // (> 365d). `measuredMovement` is null when not applicable (fresh anchor) or not
  // measurable (thin nearby support); the estimate then uses 1 (no adjustment).
  const measuredMovement =
    latestDaysOld !== null && latestDaysOld > 365
      ? getCondoEcMarketMovement(anchorRows, supportRows)
      : null
  const rawMovement = measuredMovement ?? 1
  const movementCap = getCondoEcMarketMovementCap(latestDaysOld)
  const marketMovement = Math.max(
    1 - movementCap,
    Math.min(1 + movementCap, rawMovement)
  )
  // Clean, reusable momentum handle for Suggested Listing Price: the RAW measured
  // nearby-market drift as a percent (undefined when not measured). Reflects the
  // market signal, not the valuation-clamped version applied above.
  const marketMovementPct =
    measuredMovement !== null ? (measuredMovement - 1) * 100 : undefined

  // Stage 3b: floor curve. Scale the base estimate from the comps' reference
  // floor to the subject's floor along psm ∝ floor^β (β fit live per project, else
  // a height-tier fallback), clamped ±10%. The reference floor is the weighted
  // mean floor of the size-similar, recency-bounded same-project pool — the floor
  // level the base anchor reflects. Replaces Stage 1's removed additive premium;
  // the soft floor-closeness weight in getWeightedPsmForRows is retained but can't
  // extrapolate beyond the comps' floor range, which is what this closes.
  const floorRefBase = (() => {
    const recent = sameProjectRows.filter((row) => {
      const daysOld = getDaysOld(row.transaction_date)
      return daysOld !== null && daysOld <= 365
    })
    return recent.length >= 3 ? recent : sameProjectRows
  })()
  const compAvgFloor = getWeightedFloorForRows(
    pickSameProjectAnchorRows(floorRefBase, floorAreaSqm),
    floorAreaSqm,
    propertyCategory
  )
  const floorMultiplier = getCondoEcFloorMultiplier(sameProjectRows, subjectFloorLevel, compAvgFloor)

  // Stage 1: no calibration uplift, no flat ×1.01 bias. Point estimate is the
  // (market-movement- and floor-adjusted) same-project anchor psm × subject area.
  const adjustedPsm = anchorPsm * marketMovement
  const estimated = adjustedPsm * floorAreaSqm * floorMultiplier

  const halfSpread = getCondoEcAnchorSpread(anchorRows, latestDaysOld)

  // Stage 3c: Suggested Listing Price. A pure ADD-ON, computed from the same-
  // project / nearby momentum reading and layered on top of the Market Value
  // (`estimated`/`blended`) — it never alters Market Value, its band, or any
  // existing field. suggestedListingPrice = marketValue × (1 + markup/100).
  const momentum = getCondoEcMomentum(sameProjectRows, supportRows)
  const listingMarkupPct = getSlpMarkupPct(momentum.momentumPct)
  const slpFields = (marketValue: number) => ({
    suggestedListingPrice: marketValue * (1 + listingMarkupPct / 100),
    listingMarkupPct,
    momentumPct: momentum.momentumPct,
    momentumBasis: momentum.basis,
  })

  // --- Stage 2: repeat-sale conditional fallback ---
  // Gate on a THIN similar-size same-project pool (<= REPEAT_THIN_POOL_MAX recent
  // rows). Above that, this block is skipped and behaviour is identical to Stage
  // 1. When gated in and the subject unit has a prior sale, blend its
  // CAGR-trended price with the comparable estimate using a slow-decay weight fit
  // to the thin-comp backtest, and widen the band for trend-forward uncertainty.
  const strictPool = sameProjectRows.filter((row) => {
    const ratio = row.floor_area_sqm / floorAreaSqm
    if (ratio < 1 - REPEAT_SIZE_BAND || ratio > 1 + REPEAT_SIZE_BAND) return false
    const daysOld = getDaysOld(row.transaction_date)
    return daysOld !== null && daysOld <= REPEAT_WINDOW_DAYS
  })

  if (strictPool.length <= REPEAT_THIN_POOL_MAX) {
    const priorSale = findSubjectPriorSale(sameProjectRows, subjectAddress)
    const priorDaysOld = priorSale ? getDaysOld(priorSale.transaction_date) : null
    if (priorSale && priorDaysOld !== null && priorSale.transaction_price > 0) {
      // Leave-one-out comparable: recompute the same-project anchor EXCLUDING the
      // subject unit's own sales, so its history counts only once — through the
      // repeat anchor, not also as a comparable. This matches the backtest's
      // leave-one-out method and avoids double-counting in the thin pool. Falls
      // back to the full-pool estimate if exclusion leaves nothing usable. (The
      // non-blend path above is untouched, so well-comped valuations are
      // byte-identical to Stage 1.)
      const subjKey = robustUnitKey(subjectAddress)
      const looRows = sameProjectRows.filter((row) => robustUnitKey(row.address) !== subjKey)
      const looAnchor =
        looRows.length > 0
          ? getSameProjectSizeAdjustedPsm(looRows, floorAreaSqm, propertyCategory, subjectFloorLevel)
          : null
      const comparableEstimate =
        looAnchor && looAnchor.psm && Number.isFinite(looAnchor.psm)
          ? looAnchor.psm * marketMovement * floorAreaSqm * floorMultiplier
          : estimated

      const gapYrs = priorDaysOld / 365.25
      const cagr = projectCagrFromRows(sameProjectRows)
      const trended = priorSale.transaction_price * Math.pow(1 + cagr, gapYrs)
      const w = 0.4 * Math.exp(-gapYrs / 3.5) // thin-comp weight fn, w(1y)=0.30 … w(8y)=0.04
      const blended = w * trended + (1 - w) * comparableEstimate

      // Large-swing detection: how far the leave-one-out comparable moved from the
      // self-included comparable (`estimated`). A big move means the thin pool was
      // dominated by the subject's own prior sale, so the estimate leans heavily on
      // one transaction — widen the band and flag it.
      const looShift = estimated > 0 ? Math.abs(comparableEstimate / estimated - 1) : 0
      const largeSwing = looShift > REPEAT_SWING_THRESHOLD
      const swingSpread = largeSwing ? Math.min(REPEAT_SWING_SPREAD_CAP, looShift) : 0
      const blendSpread = halfSpread + w * Math.min(0.1, gapYrs * 0.02) + swingSpread
      return {
        estimated: blended,
        low: blended * (1 - blendSpread),
        high: blended * (1 + blendSpread),
        comparables: anchorRows.length,
        radius,
        method: 'condo_ec_same_project_repeat_blend',
        ...(largeSwing ? { thinDataWarning: true } : {}),
        ...(marketMovementPct !== undefined ? { marketMovementPct } : {}),
        ...slpFields(blended),
      }
    }
  }

  return {
    estimated,
    low: estimated * (1 - halfSpread),
    high: estimated * (1 + halfSpread),
    comparables: anchorRows.length,
    radius,
    method:
      latestDaysOld !== null && latestDaysOld > 365
        ? 'condo_ec_same_project_size_curve_market_adjusted'
        : 'condo_ec_same_project_size_curve',
    ...(marketMovementPct !== undefined ? { marketMovementPct } : {}),
    ...slpFields(estimated),
  }
}

function selectCondoEcComparablePool(
  rows: CleanedRow[],
  floorAreaSqm: number,
  subjectProjectName?: string | null,
  subjectCompletionYear?: number | null,
  subjectTenureBucket?: string
) {
  const normalizedSubjectProject = normalizeText(subjectProjectName)
  const sameProjectRows = normalizedSubjectProject
    ? rows.filter((row) => normalizeText(row.project_name) === normalizedSubjectProject)
    : []

  if (sameProjectRows.length > 0) {
    const anchorRows = pickSameProjectAnchorRows(sameProjectRows, floorAreaSqm)
    if (anchorRows.length > 0) return anchorRows
  }

  return getCondoEcNearbySupportRows(
    rows,
    floorAreaSqm,
    subjectProjectName,
    subjectCompletionYear,
    subjectTenureBucket
  )
}

function buildCondoEcCandidate(
  rows: CleanedRow[],
  radius: number,
  floorAreaSqm: number,
  propertyCategory: PropertyCategory,
  subjectFloorLevel?: number,
  subjectProjectName?: string | null,
  subjectCompletionYear?: number | null,
  subjectTenureBucket?: string,
  subjectAddress?: string | null
): CandidateResult | null {
  if (rows.length === 0) return null

  const sameProjectCandidate = buildSameProjectCondoEcCandidate(
    rows,
    radius,
    floorAreaSqm,
    propertyCategory,
    subjectFloorLevel,
    subjectProjectName,
    subjectCompletionYear,
    subjectTenureBucket,
    subjectAddress
  )

  if (sameProjectCandidate) return sameProjectCandidate

  const selectedPool = selectCondoEcComparablePool(
    rows,
    floorAreaSqm,
    subjectProjectName,
    subjectCompletionYear,
    subjectTenureBucket
  )

  const usable = trimCondoEcOutliers(selectedPool)
  if (usable.length === 0) return null

  const values = usable.map((row) => row.pricePerSqm)
  const weights = usable.map((row) => {
    const distanceWeight = 1 / Math.max(row.distanceM, 80)

    const areaRatio = row.floor_area_sqm / floorAreaSqm
    const sizeWeight =
      areaRatio >= 0.95 && areaRatio <= 1.05
        ? 1.22
        : areaRatio >= 0.9 && areaRatio <= 1.1
        ? 1.14
        : areaRatio >= 0.85 && areaRatio <= 1.15
        ? 1.06
        : 0.9

    const ageWeight = getCondoEcAgeWeight(row, subjectCompletionYear)
    const tenureWeight = getCondoEcTenureWeight(row, subjectTenureBucket)
    const recencyWeight = getRecencyWeight(row.transaction_date, propertyCategory)
    const floorWeight = getFloorWeight(subjectFloorLevel, row.parsedFloorLevel)

    return (
      distanceWeight *
      sizeWeight *
      ageWeight *
      tenureWeight *
      recencyWeight *
      floorWeight
    )
  })

  const avgPsm = weightedAverage(values, weights)
  if (!avgPsm || !Number.isFinite(avgPsm)) return null

  // Stage 1: no flat ×1.01 bias, no additive floor premium. Point estimate is
  // the weighted-average psm × subject area; band is the p25/p75 psm straddle.
  const estimated = avgPsm * floorAreaSqm

  const sortedPsm = usable
    .map((row) => row.pricePerSqm)
    .filter((v) => Number.isFinite(v) && v > 0)
    .sort((a, b) => a - b)

  const lowPsm = percentile(sortedPsm, 0.25)
  const highPsm = percentile(sortedPsm, 0.75)

  const fallbackSpread = 0.08

  const low =
    lowPsm && Number.isFinite(lowPsm)
      ? lowPsm * floorAreaSqm
      : estimated * (1 - fallbackSpread)
  const high =
    highPsm && Number.isFinite(highPsm)
      ? highPsm * floorAreaSqm
      : estimated * (1 + fallbackSpread)

  return {
    estimated,
    low,
    high,
    comparables: usable.length,
    radius,
    method: 'condo_ec_strict_nearby',
  }
}

function buildCondoEcFallback(
  rows: CleanedRow[],
  floorAreaSqm: number,
  propertyCategory: PropertyCategory,
  subjectFloorLevel?: number,
  subjectProjectName?: string | null,
  subjectCompletionYear?: number | null,
  subjectTenureBucket?: string,
  subjectAddress?: string | null
): CandidateResult | null {
  if (rows.length === 0) return null

  const sameProjectCandidate = buildSameProjectCondoEcCandidate(
    rows,
    3000,
    floorAreaSqm,
    propertyCategory,
    subjectFloorLevel,
    subjectProjectName,
    subjectCompletionYear,
    subjectTenureBucket,
    subjectAddress
  )

  if (sameProjectCandidate) return sameProjectCandidate

  const pool = selectCondoEcComparablePool(
    rows,
    floorAreaSqm,
    subjectProjectName,
    subjectCompletionYear,
    subjectTenureBucket
  )

  const usable = trimCondoEcOutliers(pool)
    .sort((a, b) => a.distanceM - b.distanceM)
    .slice(0, 8)

  if (usable.length === 0) return null

  const values = usable.map((row) => row.pricePerSqm)
  const weights = usable.map((row) => {
    const distanceWeight = 1 / Math.max(row.distanceM, 80)

    const areaRatio = row.floor_area_sqm / floorAreaSqm
    const sizeWeight =
      areaRatio >= 0.9 && areaRatio <= 1.1
        ? 1.16
        : areaRatio >= 0.85 && areaRatio <= 1.15
        ? 1.08
        : areaRatio >= 0.8 && areaRatio <= 1.2
        ? 1
        : 0.88

    const ageWeight = getCondoEcAgeWeight(row, subjectCompletionYear)
    const tenureWeight = getCondoEcTenureWeight(row, subjectTenureBucket)
    const recencyWeight = getRecencyWeight(row.transaction_date, propertyCategory)
    const floorWeight = getFloorWeight(subjectFloorLevel, row.parsedFloorLevel)

    return (
      distanceWeight *
      sizeWeight *
      ageWeight *
      tenureWeight *
      recencyWeight *
      floorWeight
    )
  })

  const avgPsm = weightedAverage(values, weights)
  if (!avgPsm || !Number.isFinite(avgPsm)) return null

  // Stage 1: no flat ×1.01 bias, no additive floor premium.
  const estimated = avgPsm * floorAreaSqm

  return {
    estimated,
    low: estimated * 0.93,
    high: estimated * 1.07,
    comparables: usable.length,
    radius: Math.round(usable[usable.length - 1].distanceM),
    method: 'condo_ec_strict_nearby_fallback',
  }
}


function isSameProjectCondoEcCandidate(candidate: CandidateResult | null) {
  return candidate?.method?.startsWith('condo_ec_same_project') === true
}

function pickPreferredNonLandedRows(
  rows: CleanedRow[],
  floorAreaSqm: number,
  subjectProjectName?: string | null
) {
  const normalizedSubjectProject = normalizeText(subjectProjectName)

  const strictSizeFiltered = rows.filter((row) => {
    const ratio = row.floor_area_sqm / floorAreaSqm
    return ratio >= 0.9 && ratio <= 1.1
  })

  const mediumSizeFiltered = rows.filter((row) => {
    const ratio = row.floor_area_sqm / floorAreaSqm
    return ratio >= 0.8 && ratio <= 1.2
  })

  const broadSizeFiltered = rows.filter((row) => {
    const ratio = row.floor_area_sqm / floorAreaSqm
    return ratio >= 0.7 && ratio <= 1.3
  })

  const baseRows =
    strictSizeFiltered.length >= 3
      ? strictSizeFiltered
      : mediumSizeFiltered.length >= 3
      ? mediumSizeFiltered
      : broadSizeFiltered.length >= 3
      ? broadSizeFiltered
      : rows

  if (normalizedSubjectProject) {
    const sameProjectRows = baseRows.filter(
      (row) => normalizeText(row.project_name) === normalizedSubjectProject
    )

    if (sameProjectRows.length >= 2) {
      return sameProjectRows
    }
  }

  return baseRows
}

function tierComparableRows(
  rows: CleanedRow[],
  subjectProjectName: string | null | undefined,
  subjectCompletionYear: number | null | undefined,
  propertyCategory: PropertyCategory
): CleanedRow[] {
  if (propertyCategory !== 'condo' && propertyCategory !== 'ec') return rows

  const normalizedSubjectProject = normalizeText(subjectProjectName)

  if (normalizedSubjectProject) {
    const tier1 = rows.filter(
      (row) => normalizeText(row.project_name) === normalizedSubjectProject
    )
    if (tier1.length >= 3) return tier1
  }

  if (subjectCompletionYear) {
    const tier2 = rows.filter((row) => {
      if (!row.completion_year) return false
      return Math.abs(row.completion_year - subjectCompletionYear) <= 10
    })
    if (tier2.length >= 3) {
      if (normalizedSubjectProject) {
        const sameProject = rows.filter(
          (row) => normalizeText(row.project_name) === normalizedSubjectProject
        )
        const others = tier2.filter(
          (row) => normalizeText(row.project_name) !== normalizedSubjectProject
        )
        return [...sameProject, ...others]
      }
      return tier2
    }
  }

  if (subjectCompletionYear) {
    const tier3 = rows.filter((row) => {
      if (!row.completion_year) return true
      return row.completion_year <= subjectCompletionYear + 15
    })
    if (tier3.length >= 3) return tier3
  }

  return rows
}

function buildNonLandedCandidate(
  rows: CleanedRow[],
  radius: number,
  floorAreaSqm: number,
  propertyCategory: PropertyCategory,
  subjectFloorLevel?: number,
  subjectProjectName?: string | null
): CandidateResult | null {
  if (rows.length === 0) return null

  const preferredRows = pickPreferredNonLandedRows(
    rows,
    floorAreaSqm,
    subjectProjectName
  )
  const usable = trimRowsByMetric(preferredRows, (row) => row.pricePerSqm)

  if (usable.length === 0) return null

  const normalizedSubjectProject = normalizeText(subjectProjectName)

  const values = usable.map((row) => row.pricePerSqm)
  const weights = usable.map((row) => {
    const distanceWeight = 1 / Math.max(row.distanceM, 50)

    const sizeDiff = Math.abs(row.floor_area_sqm - floorAreaSqm)
    const sizeWeight = 1 / Math.max(sizeDiff, 5)

    const recencyWeight = getRecencyWeight(row.transaction_date, propertyCategory)

    const sameProjectWeight =
      normalizedSubjectProject &&
      normalizeText(row.project_name) === normalizedSubjectProject
        ? 1.2
        : 1

    const floorWeight = getFloorWeight(subjectFloorLevel, row.parsedFloorLevel)

    return distanceWeight * sizeWeight * recencyWeight * sameProjectWeight * floorWeight
  })

  const avgPsm = weightedAverage(values, weights)
  if (!avgPsm || !Number.isFinite(avgPsm)) return null

  const estimated = avgPsm * floorAreaSqm
  const biasedEstimate = estimated * 1.01

  const psfValues = usable.map((row) => row.pricePerSqm)
  const mean = psfValues.reduce((a, b) => a + b, 0) / psfValues.length
  const stdDev = Math.sqrt(psfValues.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / psfValues.length)
  const stdDevPct = stdDev / mean

  const maxSpread = propertyCategory === 'hdb' ? 0.05 : 0.08
  const halfSpread = Math.min(stdDevPct, maxSpread)
  
  return {
    estimated: biasedEstimate,
    low: biasedEstimate * (1 - halfSpread),
    high: biasedEstimate * (1 + halfSpread),
    comparables: usable.length,
    radius,
    method: normalizedSubjectProject ? 'same_project_or_nearby' : 'nearby'
  }
}

function buildNonLandedFallback(
  rows: CleanedRow[],
  floorAreaSqm: number,
  propertyCategory: PropertyCategory,
  subjectFloorLevel?: number,
  subjectProjectName?: string | null
): CandidateResult | null {
  if (rows.length === 0) return null

  const normalizedSubjectProject = normalizeText(subjectProjectName)

  let fallbackPool = [...rows]

  if (normalizedSubjectProject) {
    const sameProjectRows = fallbackPool.filter(
      (row) => normalizeText(row.project_name) === normalizedSubjectProject
    )
    if (sameProjectRows.length >= 1) {
      fallbackPool = sameProjectRows
    }
  }

  const similarSizeRows = fallbackPool.filter((row) => {
    const ratio = row.floor_area_sqm / floorAreaSqm
    return ratio >= 0.75 && ratio <= 1.35
  })

  if (similarSizeRows.length >= 2) {
    fallbackPool = similarSizeRows
  }

  const fallbackRows = fallbackPool
    .sort((a, b) => a.distanceM - b.distanceM)
    .slice(0, 6)

  if (fallbackRows.length === 0) return null

  const values = fallbackRows.map((row) => row.pricePerSqm)
  const weights = fallbackRows.map((row) => {
    const distanceWeight = 1 / Math.max(row.distanceM, 50)
    const sizeDiff = Math.abs(row.floor_area_sqm - floorAreaSqm)
    const sizeWeight = 1 / Math.max(sizeDiff, 10)
    const recencyWeight = getRecencyWeight(row.transaction_date, propertyCategory)

    const sameProjectWeight =
      normalizedSubjectProject &&
      normalizeText(row.project_name) === normalizedSubjectProject
        ? 1.15
        : 1

    const floorWeight = getFloorWeight(subjectFloorLevel, row.parsedFloorLevel)

    return distanceWeight * sizeWeight * recencyWeight * sameProjectWeight * floorWeight
  })

  const avgPsm = weightedAverage(values, weights)
  if (!avgPsm || !Number.isFinite(avgPsm)) return null

  const estimated = avgPsm * floorAreaSqm
  const biasedEstimate = estimated * 1.01

  return {
    estimated: biasedEstimate,
    low: biasedEstimate * 0.93,
    high: biasedEstimate * 1.07,
    comparables: fallbackRows.length,
    radius: Math.round(fallbackRows[fallbackRows.length - 1].distanceM),
    method: normalizedSubjectProject ? 'same_project_fallback' : 'broad_fallback'
  }
}

function buildLandedCandidate(
  rows: CleanedRow[],
  radius: number,
  landSizeSqm: number,
  builtUpSqm: number,
  propertyType: string,
  subjectTenureBucket: string
): CandidateResult | null {
  if (rows.length === 0) return null

  const exactTypeRows = rows.filter((row) =>
    isMatchingLandedType(row.unit_type, propertyType)
  )

  const baseRows = exactTypeRows.length >= 2 ? exactTypeRows : rows

  const similarSizeRows = baseRows.filter((row) => {
    const ratio = row.floor_area_sqm / landSizeSqm
    return ratio >= 0.6 && ratio <= 1.4
  })

  const candidateRows = similarSizeRows.length >= 3 ? similarSizeRows : baseRows
  const usable = trimRowsByMetric(candidateRows, (row) => row.pricePerSqft)

  if (usable.length === 0) return null

  const landSizeSqft = landSizeSqm * 10.7639
  const values = usable.map((row) => row.pricePerSqft)

  const weights = usable.map((row) => {
    const distanceWeight = 1 / Math.max(row.distanceM, 100)

    const landSizeRatio = row.floor_area_sqm / landSizeSqm
    const sizeWeight =
      landSizeRatio >= 0.8 && landSizeRatio <= 1.2
        ? 1.2
        : landSizeRatio >= 0.6 && landSizeRatio <= 1.4
        ? 1
        : 0.65

    const rowTenureBucket = normalizeTenureBucket(row.tenure)
    const tenureWeight = rowTenureBucket === subjectTenureBucket ? 1.15 : 0.92
    const recencyWeight = getRecencyWeight(row.transaction_date, 'landed')

    return distanceWeight * sizeWeight * tenureWeight * recencyWeight
  })

  const avgLandPsf = weightedAverage(values, weights)
  if (!avgLandPsf || !Number.isFinite(avgLandPsf)) return null

  let estimated = avgLandPsf * landSizeSqft

  const typicalRatio = getTypicalBuiltUpRatio(propertyType)
  const subjectRatio =
    builtUpSqm > 0 && landSizeSqm > 0 ? builtUpSqm / landSizeSqm : typicalRatio
  const ratioDelta = (subjectRatio - typicalRatio) / typicalRatio
  const cappedAdjustment = Math.max(-0.04, Math.min(0.04, ratioDelta * 0.15))

  estimated = estimated * (1 + cappedAdjustment)

  const biasedEstimate = estimated * 1.01

  const psfValues = usable.map((row) => row.pricePerSqft)
  const mean = psfValues.reduce((a, b) => a + b, 0) / psfValues.length
  const stdDev = Math.sqrt(psfValues.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / psfValues.length)
  const stdDevPct = stdDev / mean
  const halfSpread = Math.min(stdDevPct, 0.10)

  return {
    estimated: biasedEstimate,
    low: biasedEstimate * (1 - halfSpread),
    high: biasedEstimate * (1 + halfSpread),
    comparables: usable.length,
    radius,
    method: 'landed_nearby'
  }
}

function buildLandedFallback(
  rows: CleanedRow[],
  landSizeSqm: number,
  propertyType: string,
  tenure?: string,
  isStrata?: boolean | null
): CandidateResult | null {
  if (rows.length === 0) return null

  let fallbackPool = [...rows]

  const exactTypeRows = fallbackPool.filter((row) =>
    isMatchingLandedType(row.unit_type, propertyType)
  )
  if (exactTypeRows.length >= 2) {
    fallbackPool = exactTypeRows
  }
  
  if (isStrata !== null && isStrata !== undefined) {
    const sameStrataRows = fallbackPool.filter(
      (row) => row.is_strata === isStrata
    )
    if (sameStrataRows.length >= 2) {
      fallbackPool = sameStrataRows
    }
  }

  const subjectTenureBucket = getSubjectTenureBucket(tenure)
  const sameTenureRows = fallbackPool.filter(
    (row) => normalizeTenureBucket(row.tenure) === subjectTenureBucket
  )
  if (sameTenureRows.length >= 2) {
    fallbackPool = sameTenureRows
  }

  const similarSizeRows = fallbackPool.filter((row) => {
    const ratio = row.floor_area_sqm / landSizeSqm
    return ratio >= 0.6 && ratio <= 1.4
  })
  if (similarSizeRows.length >= 2) {
    fallbackPool = similarSizeRows
  }

  const fallbackRows = fallbackPool
    .sort((a, b) => a.distanceM - b.distanceM)
    .slice(0, 6)

  if (fallbackRows.length === 0) return null

  const landSizeSqft = landSizeSqm * 10.7639
  const values = fallbackRows.map((row) => row.pricePerSqft)

  const weights = fallbackRows.map((row) => {
    const distanceWeight = 1 / Math.max(row.distanceM, 100)

    const ratio = row.floor_area_sqm / landSizeSqm
    const sizeWeight =
      ratio >= 0.8 && ratio <= 1.2
        ? 1.15
        : ratio >= 0.6 && ratio <= 1.4
        ? 1
        : 0.7

    const recencyWeight = getRecencyWeight(row.transaction_date, 'landed')
    return distanceWeight * sizeWeight * recencyWeight
  })

  const avgLandPsf = weightedAverage(values, weights)
  if (!avgLandPsf || !Number.isFinite(avgLandPsf)) return null

  const estimated = avgLandPsf * landSizeSqft
  const biasedEstimate = estimated * 1.01

  return {
    estimated: biasedEstimate,
    low: biasedEstimate * 0.93,
    high: biasedEstimate * 1.07,
    comparables: fallbackRows.length,
    radius: Math.round(fallbackRows[fallbackRows.length - 1].distanceM),
    method: 'landed_fallback'
  }
}

// ─── Cache helpers ────────────────────────────────────────────────────────────

async function readCache(cacheKey: string): Promise<CandidateResult | null> {
  try {
    const { data, error } = await supabase
      .from('valuation_cache')
      .select('estimated, low, high, comparables, radius, method')
      .eq('cache_key', cacheKey)
      .gt('expires_at', new Date().toISOString())
      .maybeSingle()

    if (error || !data) return null

    return {
      estimated: Number(data.estimated),
      low: Number(data.low),
      high: Number(data.high),
      comparables: Number(data.comparables),
      radius: Number(data.radius),
      method: data.method ?? undefined,
    }
  } catch {
    return null
  }
}

async function writeCache(cacheKey: string, result: CandidateResult): Promise<void> {
  try {
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
    await supabase
      .from('valuation_cache')
      .upsert(
        {
          cache_key: cacheKey,
          estimated: result.estimated,
          low: result.low,
          high: result.high,
          comparables: result.comparables,
          radius: result.radius,
          method: result.method ?? null,
          expires_at: expiresAt,
        },
        { onConflict: 'cache_key' }
      )
  } catch {
    // Cache write failure is non-fatal — silently ignore
  }
}

// ─── Main export ──────────────────────────────────────────────────────────────

export async function getValuation({
  lat,
  lon,
  floorAreaSqm,
  propertyType,
  propertyCategory,
  landSizeSqm,
  builtUpSqm,
  tenure,
  floorLevel,
  subjectProjectName,
  subjectCompletionYear,
  subjectIsStrata,
  subjectAddress,
  subjectBlockNo,
  subjectCompletionYearHdb,
  cacheKey,
}: ValuationParams) {

  if (cacheKey) {
    const cached = await readCache(cacheKey)
    if (cached) return cached
  }

  const searchRadius = getSearchRadius(propertyCategory)

  if (propertyCategory === 'hdb') {
    const blockNo = subjectBlockNo || extractBlockNumber(subjectAddress)
    const completionYear = subjectCompletionYearHdb ?? subjectCompletionYear ?? null

    let bestCandidate: CandidateResult | null = null

    for (const radius of searchRadius) {
      const { data, error } = await fetchRowsForRadius(
        lat,
        lon,
        radius,
        propertyType,
        propertyCategory
      )

      if (error) {
        console.error('SUPABASE VALUATION ERROR:', error)
        continue
      }

      if (!data || data.length === 0) continue

      const cleanedRows = cleanRows(data as TransactionRow[], lat, lon)
      if (cleanedRows.length === 0) continue

      const candidate = await buildHdbCandidate(
        cleanedRows,
        radius,
        floorAreaSqm,
        floorLevel,
        blockNo,
        completionYear,
        lat,
        lon
      )

      if (!candidate) continue

      if (!bestCandidate) {
        bestCandidate = candidate
        continue
      }

      const currentGood = bestCandidate.comparables >= 3
      const nextGood = candidate.comparables >= 3

      if (!currentGood && nextGood) {
        bestCandidate = candidate
        continue
      }

      if (currentGood && nextGood) {
        if (
          candidate.radius < bestCandidate.radius ||
          candidate.comparables > bestCandidate.comparables
        ) {
          bestCandidate = candidate
        }
        continue
      }

      if (
        candidate.comparables > bestCandidate.comparables ||
        (candidate.comparables === bestCandidate.comparables &&
          candidate.radius < bestCandidate.radius)
      ) {
        bestCandidate = candidate
      }
    }

    if (bestCandidate) {
      if (cacheKey) await writeCache(cacheKey, bestCandidate)
      return bestCandidate
    }

    const { data, error } = await fetchRowsForRadius(
      lat,
      lon,
      2000,
      propertyType,
      propertyCategory
    )

    if (error || !data || data.length === 0) return null

    const fallbackRows = cleanRows(data as TransactionRow[], lat, lon)
    if (fallbackRows.length === 0) return null

    const fallbackResult = await buildHdbCandidate(fallbackRows, 2000, floorAreaSqm, floorLevel, blockNo, completionYear, lat, lon)
    if (fallbackResult && cacheKey) await writeCache(cacheKey, fallbackResult)
    return fallbackResult
  }

  if (propertyCategory === 'landed') {
    if (!landSizeSqm || !builtUpSqm) {
      console.log('Missing landed land size or built-up size.')
      return null
    }

    let bestCandidate: CandidateResult | null = null

    for (const radius of searchRadius) {
      const { data, error } = await fetchRowsForRadius(
        lat,
        lon,
        radius,
        propertyType,
        propertyCategory
      )

      if (error) {
        console.error('SUPABASE VALUATION ERROR:', error)
        continue
      }

      if (!data || data.length === 0) continue

      let cleanedRows = cleanRows(data as TransactionRow[], lat, lon)
      if (cleanedRows.length === 0) continue
      
      const exactTypeRows = cleanedRows.filter((row) =>
        isMatchingLandedType(row.unit_type, propertyType)
      )
      if (exactTypeRows.length > 0) {
        cleanedRows = exactTypeRows
      }
      
      if (subjectIsStrata !== null) {
        const sameStrataRows = cleanedRows.filter(
          (row) => row.is_strata === subjectIsStrata
        )
        if (sameStrataRows.length >= 2) {
          cleanedRows = sameStrataRows
        }
      }
      
      const subjectTenureBucket = getSubjectTenureBucket(tenure)
      const sameTenureRows = cleanedRows.filter(
        (row) => normalizeTenureBucket(row.tenure) === subjectTenureBucket
      )
      if (sameTenureRows.length >= 3) {
        cleanedRows = sameTenureRows
      } else if (sameTenureRows.length >= 1) {
        const otherRows = cleanedRows.filter(
          (row) => normalizeTenureBucket(row.tenure) !== subjectTenureBucket
        )
        cleanedRows = [...sameTenureRows, ...otherRows]
      }

      const candidate = buildLandedCandidate(
        cleanedRows,
        radius,
        landSizeSqm,
        builtUpSqm,
        propertyType,
        getSubjectTenureBucket(tenure)
      )

      if (!candidate) continue

      if (!bestCandidate) {
        bestCandidate = candidate
        continue
      }

      const currentGood = bestCandidate.comparables >= 3
      const nextGood = candidate.comparables >= 3

      if (!currentGood && nextGood) {
        bestCandidate = candidate
        continue
      }

      if (currentGood && nextGood) {
        if (
          candidate.radius < bestCandidate.radius ||
          candidate.comparables > bestCandidate.comparables
        ) {
          bestCandidate = candidate
        }
        continue
      }

      if (
        candidate.comparables > bestCandidate.comparables ||
        (candidate.comparables === bestCandidate.comparables &&
          candidate.radius < bestCandidate.radius)
      ) {
        bestCandidate = candidate
      }
    }

    if (bestCandidate) {
      if (cacheKey) await writeCache(cacheKey, bestCandidate)
      return bestCandidate
    }

    const { data, error } = await fetchRowsForRadius(
      lat,
      lon,
      8000,
      propertyType,
      propertyCategory
    )

    if (error || !data || data.length === 0) return null

    const fallbackRows = cleanRows(data as TransactionRow[], lat, lon)
    const fallbackResult = buildLandedFallback(fallbackRows, landSizeSqm, propertyType, tenure, subjectIsStrata)
    if (fallbackResult && cacheKey) await writeCache(cacheKey, fallbackResult)
    return fallbackResult
  }

  let bestCandidate: CandidateResult | null = null

  for (const radius of searchRadius) {
    const { data, error } = await fetchRowsForRadius(
      lat,
      lon,
      radius,
      propertyType,
      propertyCategory
    )

    if (error) {
      console.error('SUPABASE VALUATION ERROR:', error)
      continue
    }

    if (!data || data.length === 0) continue

    const cleanedRows = cleanRows(data as TransactionRow[], lat, lon)
    if (cleanedRows.length === 0) continue

    let valuationPool = cleanedRows

    const normalizedSubjectProject = normalizeText(subjectProjectName)
    const sameProjectRowsInRadius = normalizedSubjectProject
      ? cleanedRows.filter(
          (row) => normalizeText(row.project_name) === normalizedSubjectProject
        )
      : []

    const sameTypeRows = cleanedRows.filter((row) =>
      isMatchingNonLandedType(row.unit_type, propertyType)
    )

    // For condo/EC, same-project data should not be lost just because
    // the bedroom/unit_type label is messy. If same-project rows exist,
    // pass the full cleaned pool so the same-project anchor can use floor area first.
    if (sameProjectRowsInRadius.length === 0 && sameTypeRows.length >= 2) {
      valuationPool = sameTypeRows
    }

    const subjectTenureBucket = getSubjectTenureBucket(tenure)

    const candidate = buildCondoEcCandidate(
      valuationPool,
      radius,
      floorAreaSqm,
      propertyCategory,
      floorLevel,
      subjectProjectName,
      subjectCompletionYear,
      subjectTenureBucket,
      subjectAddress
    )

    if (!candidate) continue

    if (!bestCandidate) {
      bestCandidate = candidate
      continue
    }

    const currentSameProject = isSameProjectCondoEcCandidate(bestCandidate)
    const nextSameProject = isSameProjectCondoEcCandidate(candidate)

    if (!currentSameProject && nextSameProject) {
      bestCandidate = candidate
      continue
    }

    if (currentSameProject && !nextSameProject) {
      continue
    }

    const currentGood = bestCandidate.comparables >= 5
    const nextGood = candidate.comparables >= 5

    if (!currentGood && nextGood) {
      bestCandidate = candidate
      continue
    }

    if (currentGood && nextGood) {
      if (
        candidate.radius < bestCandidate.radius ||
        candidate.comparables > bestCandidate.comparables
      ) {
        bestCandidate = candidate
      }
      continue
    }

    if (
      candidate.comparables > bestCandidate.comparables ||
      (candidate.comparables === bestCandidate.comparables &&
        candidate.radius < bestCandidate.radius)
    ) {
      bestCandidate = candidate
    }
  }

  if (bestCandidate) {
    if (cacheKey) await writeCache(cacheKey, bestCandidate)
    return bestCandidate
  }

  const fallbackRadius = 3000
  const { data, error } = await fetchRowsForRadius(
    lat,
    lon,
    fallbackRadius,
    propertyType,
    propertyCategory
  )

  if (error || !data || data.length === 0) return null

  let fallbackRows = cleanRows(data as TransactionRow[], lat, lon)
  if (fallbackRows.length === 0) return null

  const normalizedSubjectProject = normalizeText(subjectProjectName)
  const sameProjectRowsInFallback = normalizedSubjectProject
    ? fallbackRows.filter(
        (row) => normalizeText(row.project_name) === normalizedSubjectProject
      )
    : []

  const sameTypeRows = fallbackRows.filter((row) =>
    isMatchingNonLandedType(row.unit_type, propertyType)
  )
  if (sameProjectRowsInFallback.length === 0 && sameTypeRows.length >= 2) {
    fallbackRows = sameTypeRows
  }

  const subjectTenureBucket = getSubjectTenureBucket(tenure)

  const fallbackResult = buildCondoEcFallback(
    fallbackRows,
    floorAreaSqm,
    propertyCategory,
    floorLevel,
    subjectProjectName,
    subjectCompletionYear,
    subjectTenureBucket,
    subjectAddress
  )
  if (fallbackResult && cacheKey) await writeCache(cacheKey, fallbackResult)
  return fallbackResult
}
