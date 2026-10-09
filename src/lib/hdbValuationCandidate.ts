import { subjectHdbStreetKey } from './hdbStreetAbbrev'

// Research model: opt-in only. All dates and diagnostics belong to this result;
// the legacy model, shared valuation cache and live defaults are untouched.
export type HdbTransaction = {
  id?: number | string
  address: string | null
  unit_type: string | null
  transaction_price: number | string | null
  floor_area_sqm: number | string | null
  transaction_date?: string | null
  latitude: number | string | null
  longitude: number | string | null
  completion_year?: number | string | null
  floor_level?: string | null
}

export type HdbCandidateParams = {
  lat: number
  lon: number
  floorAreaSqm: number
  propertyType: string
  floorLevel?: number
  subjectBlockNo?: string | null
  subjectStreetName?: string | null
  subjectAddress?: string | null
  subjectCompletionYearHdb?: number | null
  subjectCompletionYear?: number | null
  valuationDate?: string
}

export type HdbEvidence = {
  id: string
  address: string
  transactionDate: string
  ageDays: number
  areaSqm: number
  floorMidpoint: number | null
  distanceM: number
  completionYear: number | null
  price: number
  adjustedPrice: number
  floorAdjustmentPct: number
  weightPct: number
  role: 'recent_same_block' | 'recent_nearby' | 'older_same_block'
}

export type HdbCandidateResult = {
  estimated: number
  low: number
  high: number
  comparables: number
  radius: number
  method: string
  modelVersion: 'hdb_candidate_v2'
  valuationDate: string
  completionYear: number | null
  ageBasis: 'block_completion_year'
  effectiveComparables: number
  maxComparableWeightPct: number
  newestSameBlockAgeDays: number | null
  recentNearbyUsed: boolean
  confidence: 'High' | 'Moderate' | 'Low'
  rangeHalfWidthPct: number
  thinDataWarning: boolean
  warnings: string[]
  selectionStage: string
  evidence: HdbEvidence[]
  historicalReferenceCount: number
  historicalReferences: { address: string; transactionDate: string; price: number }[]
}

const DAY = 86400000
const norm = (s: string | null | undefined) => (s || '').toUpperCase().replace(/\s+/g, ' ').trim()
const block = (s: string | null | undefined) => norm(s).match(/^(\d+[A-Z]?)\s/)?.[1] || ''
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n))

export function hdbAsOf(date?: string): Date {
  const value = date ?? new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Singapore' })
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('Valuation date must be YYYY-MM-DD.')
  const parsed = new Date(`${value}T00:00:00.000Z`)
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new Error('Invalid valuation date.')
  }
  return parsed
}

function monthsBefore(date: Date, months: number): number {
  const d = new Date(date)
  const day = d.getUTCDate()
  d.setUTCDate(1)
  d.setUTCMonth(d.getUTCMonth() - months)
  const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate()
  d.setUTCDate(Math.min(day, lastDay))
  return d.getTime()
}

export function hdbDistanceM(lat: number, lon: number, rowLat: number, rowLon: number): number {
  const rad = Math.PI / 180
  const a = Math.sin((rowLat - lat) * rad / 2) ** 2 +
    Math.cos(lat * rad) * Math.cos(rowLat * rad) * Math.sin((rowLon - lon) * rad / 2) ** 2
  return 6371000 * 2 * Math.atan2(Math.sqrt(clamp(a, 0, 1)), Math.sqrt(1 - clamp(a, 0, 1)))
}

export function hdbStoreyMid(value: string | null | undefined): number | null {
  const range = norm(value).match(/^(\d+)\s+TO\s+(\d+)$/)
  const lo = range ? Number(range[1]) : Number(value)
  const hi = range ? Number(range[2]) : lo
  return lo > 0 && hi >= lo && Number.isFinite(hi) ? (lo + hi) / 2 : null
}

export function hdbDifferenceFloorMultiplier(subject?: number, comparable?: number | null, rate = 0.005): number {
  if (!subject || subject <= 0 || !Number.isFinite(subject) || !comparable || comparable <= 0) return 1
  return 1 + clamp((subject - comparable) * rate, -0.05, 0.05)
}

export function hdbWeightDiagnostics(weights: number[]) {
  const total = weights.reduce((s, w) => s + w, 0)
  if (!(total > 0)) return { effectiveComparables: 0, maxComparableWeightPct: 0 }
  const shares = weights.map(w => w / total)
  return {
    effectiveComparables: 1 / shares.reduce((s, w) => s + w * w, 0),
    maxComparableWeightPct: Math.max(...shares) * 100,
  }
}

type Comp = HdbEvidence & { sameBlock: boolean; time: number; rawWeight: number }

function robust(rows: Comp[]): Comp[] {
  if (rows.length < 4) return rows
  const median = (v: number[]) => {
    const s = [...v].sort((a, b) => a - b)
    return (s[Math.floor((s.length - 1) / 2)] + s[Math.ceil((s.length - 1) / 2)]) / 2
  }
  const med = median(rows.map(r => r.adjustedPrice))
  const mad = median(rows.map(r => Math.abs(r.adjustedPrice - med)))
  if (!mad) return rows
  const kept = rows.filter(r => Math.abs(r.adjustedPrice - med) <= 3 * mad)
  return kept.length >= 3 ? kept : rows
}

const healthy = (rows: Comp[]) => {
  const d = hdbWeightDiagnostics(rows.map(r => r.rawWeight))
  return rows.length >= 3 && d.effectiveComparables >= 2 && d.maxComparableWeightPct <= 70
}

function preferredFloors(rows: Comp[], floor?: number): Comp[] {
  if (!floor || floor <= 0) return rows
  const band = Math.floor((floor - 1) / 3)
  const gap = (r: Comp) => r.floorMidpoint == null ? Infinity : Math.abs(Math.floor((r.floorMidpoint - 1) / 3) - band)
  const same = rows.filter(r => gap(r) === 0)
  if (healthy(robust(same))) return same
  const adjacent = rows.filter(r => gap(r) <= 1)
  return healthy(robust(adjacent)) ? adjacent : rows
}

// floorRate is exposed only for the offline floor-curve comparison, not API input.
export function buildHdbCandidateV2(input: HdbTransaction[], params: HdbCandidateParams, floorRate = 0.005): HdbCandidateResult | null {
  const asOf = hdbAsOf(params.valuationDate)
  if (![params.lat, params.lon, params.floorAreaSqm].every(Number.isFinite) || params.floorAreaSqm <= 0 ||
    Math.abs(params.lat) > 90 || Math.abs(params.lon) > 180 || !norm(params.propertyType)) return null
  const subjectBlock = norm(params.subjectBlockNo) || block(params.subjectAddress)
  const street = subjectHdbStreetKey(params.subjectStreetName, params.subjectAddress)
  // No block-only or 50m proxy matching: uncertain identity must stay nearby.
  const isSame = (r: HdbTransaction) => !!subjectBlock && !!street && block(r.address) === subjectBlock &&
    subjectHdbStreetKey(null, r.address) === street
  const recentBoundary = monthsBefore(asOf, 12)
  const olderBoundary = monthsBefore(asOf, 24)
  const seen = new Set<string>()
  const rows: Comp[] = []
  for (const r of input) {
    if (norm(r.unit_type) !== norm(params.propertyType)) continue
    const price = Number(r.transaction_price), area = Number(r.floor_area_sqm)
    if (r.latitude == null || r.longitude == null || !r.transaction_date) continue
    const lat = Number(r.latitude), lon = Number(r.longitude)
    let date: Date
    try { date = hdbAsOf(r.transaction_date) } catch { continue }
    if (![price, area, lat, lon].every(Number.isFinite) || price <= 0 || area <= 0 ||
      Math.abs(lat) > 90 || Math.abs(lon) > 180 || date > asOf) continue
    const id = r.id == null ? [norm(r.address), r.transaction_date, area, r.floor_level, price].join('|') : String(r.id)
    if (seen.has(id)) continue
    seen.add(id)
    const distance = hdbDistanceM(params.lat, params.lon, lat, lon)
    if (distance > 2000) continue
    const floor = hdbStoreyMid(r.floor_level)
    const floorMult = hdbDifferenceFloorMultiplier(params.floorLevel, floor, floorRate)
    const year = Number(r.completion_year)
    const completionYear = year > 1950 && year <= asOf.getUTCFullYear() ? year : null
    const ageDays = (asOf.getTime() - date.getTime()) / DAY
    const sizeDiff = Math.abs(area / params.floorAreaSqm - 1)
    const floorWeight = !params.floorLevel || floor == null ? 1 : 1 / (1 + Math.abs(params.floorLevel - floor) / 6)
    rows.push({
      id, address: r.address || '', transactionDate: r.transaction_date, time: date.getTime(),
      ageDays, areaSqm: area, floorMidpoint: floor, distanceM: distance, completionYear,
      price, adjustedPrice: price / area * params.floorAreaSqm * floorMult,
      floorAdjustmentPct: (floorMult - 1) * 100, weightPct: 0,
      sameBlock: isSame(r), role: isSame(r) ? (date.getTime() >= recentBoundary ? 'recent_same_block' : 'older_same_block') : 'recent_nearby',
      rawWeight: Math.pow(0.5, ageDays / 180) / (1 + sizeDiff * 10) / (1 + distance / 300) * floorWeight,
    })
  }
  rows.sort((a, b) => b.time - a.time || a.id.localeCompare(b.id))
  const blockRows = rows.filter(r => r.sameBlock)
  const suppliedYear = params.subjectCompletionYearHdb ?? params.subjectCompletionYear
  const years = blockRows.map(r => r.completionYear).filter((y): y is number => y != null)
  const counts = new Map<number, number>()
  for (const y of years) counts.set(y, (counts.get(y) || 0) + 1)
  const inferredYear = [...counts].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0] ?? null
  const completionYear = suppliedYear != null && Number.isFinite(suppliedYear) && suppliedYear > 1950 && suppliedYear <= asOf.getUTCFullYear()
    ? suppliedYear : inferredYear
  for (const r of rows) {
    const ageGap = completionYear == null || r.completionYear == null ? null : Math.abs(completionYear - r.completionYear)
    const ageWeight = ageGap == null ? 1 : ageGap <= 3 ? 1.5 : ageGap <= 8 ? 1.2 : ageGap <= 15 ? 0.9 : ageGap <= 25 ? 0.7 : 0.5
    r.rawWeight *= ageWeight
  }
  const sizeMatches = (r: Comp, tolerance: number) => Math.abs(r.areaSqm / params.floorAreaSqm - 1) <= tolerance + 1e-10
  const freshBlock = robust(preferredFloors(blockRows.filter(r => r.time >= recentBoundary && sizeMatches(r, 0.1)), params.floorLevel))
  const newestSameBlockAgeDays = blockRows[0]?.ageDays ?? null
  const historical = blockRows.filter(r => r.time < olderBoundary)
  const warnings: string[] = []
  let selectionStage = 'same_block_12m_area10'
  let radius = 0
  let nearby: Comp[] = []
  const stages = [
    { label: 'nearby_12m_area10_age5', area: 0.1, yearGap: 5, radii: [300, 500, 800] },
    { label: 'nearby_12m_area10_age15', area: 0.1, yearGap: 15, radii: [300, 500, 800] },
    { label: 'nearby_12m_area10_soft_age', area: 0.1, yearGap: Infinity, radii: [300, 500, 800] },
    { label: 'broad_12m_area20_soft_age', area: 0.2, yearGap: Infinity, radii: [800, 1500, 2000] },
  ]
  if (!healthy(freshBlock)) {
    for (const stage of stages) {
      for (const searchRadius of stage.radii) {
        const eligible = rows.filter(r => !r.sameBlock && r.time >= recentBoundary && r.distanceM <= searchRadius && sizeMatches(r, stage.area) &&
          (stage.yearGap === Infinity || (completionYear != null && r.completionYear != null && Math.abs(r.completionYear - completionYear) <= stage.yearGap)))
        const pool = robust(preferredFloors(eligible, params.floorLevel))
        if (pool.length > nearby.length) { nearby = pool; radius = searchRadius; selectionStage = stage.label }
        if (healthy(pool)) { nearby = pool; radius = searchRadius; selectionStage = stage.label; break }
      }
      if (healthy(nearby)) break
    }
    if (!nearby.length) return null // A lone block sale cannot become the sole price signal.
    if (selectionStage !== stages[0].label) warnings.push('Nearby matching was relaxed because strict matches were insufficient.')
    if (freshBlock.length) warnings.push('Recent same-block evidence is limited; recent nearby sales were incorporated.')
  }
  const weighted: Comp[] = []
  const addPool = (pool: Comp[], share: number) => {
    const total = pool.reduce((s, r) => s + r.rawWeight, 0)
    if (total <= 0 || share <= 0) return
    weighted.push(...pool.map(r => ({ ...r, weightPct: r.rawWeight / total * share * 100 })))
  }
  let method: string
  if (healthy(freshBlock)) {
    addPool(freshBlock, 1)
    method = 'hdb_v2_recent_same_block'
    radius = Math.ceil(Math.max(...freshBlock.map(r => r.distanceM)))
  } else if (freshBlock.length) {
    const blockShare = Math.min(0.5, freshBlock.length / (freshBlock.length + 3))
    addPool(freshBlock, blockShare)
    addPool(nearby, 1 - blockShare)
    method = 'hdb_v2_recent_block_nearby_blend'
  } else {
    const older = robust(preferredFloors(blockRows.filter(r => r.time < recentBoundary && r.time >= olderBoundary && sizeMatches(r, 0.1)), params.floorLevel))
    // 25% is a ceiling for the entire stale pool, tapered down when evidence is thin.
    const olderN = hdbWeightDiagnostics(older.map(r => r.rawWeight)).effectiveComparables
    const olderShare = older.length ? 0.25 * Math.min(1, olderN / 3) : 0
    addPool(nearby, 1 - olderShare)
    addPool(older, olderShare)
    method = olderShare ? 'hdb_v2_recent_nearby_older_block_support' : 'hdb_v2_recent_nearby'
  }
  const diagnostics = hdbWeightDiagnostics(weighted.map(r => r.weightPct))
  const thin = diagnostics.effectiveComparables < 2 || diagnostics.maxComparableWeightPct > 70
  // Recent nearby evidence has been incorporated/expanded. If it still cannot
  // support the estimate, report unavailable rather than a misleading point value.
  if (thin) return null
  const missingFloors = weighted.some(r => r.floorMidpoint == null) || !params.floorLevel
  const missingAge = completionYear == null || weighted.some(r => r.completionYear == null)
  const broad = selectionStage.startsWith('broad_')
  const relaxed = selectionStage.includes('age15') || selectionStage.includes('soft_age')
  const high = method === 'hdb_v2_recent_same_block' && diagnostics.effectiveComparables >= 3 && !missingFloors && !missingAge
  const confidence = high ? 'High' : broad || relaxed || missingFloors || missingAge ? 'Low' : 'Moderate'
  const estimated = weighted.reduce((s, r) => s + r.adjustedPrice * r.weightPct / 100, 0)
  const cv = Math.sqrt(weighted.reduce((s, r) => s + r.weightPct / 100 * (r.adjustedPrice - estimated) ** 2, 0)) / estimated
  const rangeMin = high ? 0.03 : method === 'hdb_v2_recent_same_block' ? 0.07 : confidence === 'Low' ? 0.10 : 0.07
  const rangeMax = high ? 0.05 : method === 'hdb_v2_recent_same_block' ? 0.10 : confidence === 'Low' ? 0.12 : 0.10
  const halfSpread = clamp(cv, rangeMin, rangeMax)
  if (missingFloors) warnings.push('Some floor information is missing; those prices receive no floor adjustment.')
  if (missingAge) warnings.push('Completion-year information is incomplete.')
  if (historical.length) warnings.push('Same-block sales older than 24 months are historical references only.')
  // Evidence is the actual calculation pool, not a separately fetched display list.
  const evidence: HdbEvidence[] = weighted.map(r => ({
    id: r.id, address: r.address, transactionDate: r.transactionDate, ageDays: r.ageDays,
    areaSqm: r.areaSqm, floorMidpoint: r.floorMidpoint, distanceM: r.distanceM,
    completionYear: r.completionYear, price: r.price, adjustedPrice: r.adjustedPrice,
    floorAdjustmentPct: r.floorAdjustmentPct, weightPct: r.weightPct, role: r.role,
  }))
  return {
    estimated, low: estimated * (1 - halfSpread), high: estimated * (1 + halfSpread),
    comparables: evidence.length, radius, method, modelVersion: 'hdb_candidate_v2',
    valuationDate: asOf.toISOString().slice(0, 10), completionYear, ageBasis: 'block_completion_year', ...diagnostics,
    newestSameBlockAgeDays, recentNearbyUsed: evidence.some(r => r.role === 'recent_nearby'),
    confidence, rangeHalfWidthPct: halfSpread * 100, thinDataWarning: freshBlock.length > 0 && !healthy(freshBlock),
    warnings, selectionStage, evidence, historicalReferenceCount: historical.length,
    historicalReferences: historical.slice(0, 12).map(r => ({ address: r.address, transactionDate: r.transactionDate, price: r.price })),
  }
}
