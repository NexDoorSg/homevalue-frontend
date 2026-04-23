import { supabase } from './supabase'

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

  if (daysOld <= 90) return 1.2
  if (daysOld <= 180) return 1.1
  if (daysOld <= 365) return 1
  if (daysOld <= 730) return 0.94
  return 0.88
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

function buildHdbCandidate(
  allRows: CleanedRow[],
  radius: number,
  floorAreaSqm: number,
  subjectFloorLevel: number | undefined,
  subjectBlockNo: string,
  subjectCompletionYear: number | null
): CandidateResult | null {
  if (allRows.length === 0) return null

  const sameBlockRows = subjectBlockNo
    ? allRows.filter((row) => extractBlockNumber(row.address) === subjectBlockNo)
    : []

  const mostRecentSameBlock = getMostRecentDate(sameBlockRows)
  const now = Date.now()
  const daysSinceSameBlock = mostRecentSameBlock
    ? (now - mostRecentSameBlock.getTime()) / (1000 * 60 * 60 * 24)
    : Infinity

  const nearbyWithSimilarAge = subjectCompletionYear
    ? allRows.filter((row) => {
        if (extractBlockNumber(row.address) === subjectBlockNo) return false
        if (!row.completion_year) return false
        return Math.abs(row.completion_year - subjectCompletionYear) <= 5
      })
    : []

  let valuationPool: CleanedRow[]
  let method: string

  if (sameBlockRows.length >= 1 && daysSinceSameBlock <= 180) {
    valuationPool = sameBlockRows
    method = 'hdb_same_block_fresh'

  } else if (sameBlockRows.length >= 1 && daysSinceSameBlock <= 365) {
    if (nearbyWithSimilarAge.length >= 3) {
      const sixMonthsAgo = now - 180 * 24 * 60 * 60 * 1000
      const recentNearby = nearbyWithSimilarAge.filter(
        (r) => r.transaction_date && new Date(r.transaction_date).getTime() >= sixMonthsAgo
      )
      const olderNearby = nearbyWithSimilarAge.filter(
        (r) => r.transaction_date && new Date(r.transaction_date).getTime() < sixMonthsAgo
      )

      const avgRecent = recentNearby.length >= 2
        ? recentNearby.reduce((s, r) => s + r.pricePerSqm, 0) / recentNearby.length
        : null
      const avgOlder = olderNearby.length >= 2
        ? olderNearby.reduce((s, r) => s + r.pricePerSqm, 0) / olderNearby.length
        : null

      const driftMultiplier =
        avgRecent && avgOlder && avgOlder > 0
          ? avgRecent / avgOlder
          : 1.0

      const clampedDrift = Math.max(0.90, Math.min(1.10, driftMultiplier))

      const sameBlockAvgPsm =
        sameBlockRows.reduce((s, r) => s + r.pricePerSqm, 0) / sameBlockRows.length
      const adjustedPsm = sameBlockAvgPsm * clampedDrift
      const estimated = adjustedPsm * floorAreaSqm
      const biasedEstimate = estimated * 1.01

      const psfValues = sameBlockRows.map((r) => r.pricePerSqm).sort((a, b) => a - b)
      const stdDev = Math.sqrt(
        psfValues.reduce((s, v) => s + Math.pow(v - sameBlockAvgPsm, 2), 0) / psfValues.length
      )
      const stdDevPct = stdDev / sameBlockAvgPsm
      const halfSpread = Math.min(stdDevPct, 0.05)
      
      const floorAdjusted = applyFloorAdjustment(biasedEstimate, subjectFloorLevel, 'hdb')
      return {
        estimated: floorAdjusted,
        low: floorAdjusted * (1 - halfSpread),
        high: floorAdjusted * (1 + halfSpread),
        comparables: sameBlockRows.length,
        radius,
        method: 'hdb_same_block_drift_adjusted',
      }
    }

    valuationPool = sameBlockRows
    method = 'hdb_same_block_stale'

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
  const weights = trimmed.map((row) => {
    const distanceWeight = 1 / Math.max(row.distanceM, 50)
    const sizeDiff = Math.abs(row.floor_area_sqm - floorAreaSqm)
    const sizeWeight = 1 / Math.max(sizeDiff, 5)
    const recencyWeight = getRecencyWeight(row.transaction_date, 'hdb')
    const floorWeight = getFloorWeight(subjectFloorLevel, row.parsedFloorLevel)
    const blockWeight = extractBlockNumber(row.address) === subjectBlockNo ? 3.0 : 1.0
    return distanceWeight * sizeWeight * recencyWeight * floorWeight * blockWeight
  })

  const avgPsm = weightedAverage(values, weights)
  if (!avgPsm || !Number.isFinite(avgPsm)) return null

  const estimated = avgPsm * floorAreaSqm
  const biasedEstimate = estimated * 1.01

  const psfValues = trimmed.map((row) => row.pricePerSqm)
  const mean = psfValues.reduce((a, b) => a + b, 0) / psfValues.length
  const stdDev = Math.sqrt(
    psfValues.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / psfValues.length
  )
  const stdDevPct = stdDev / mean
  const halfSpread = Math.min(stdDevPct, 0.05)

  const floorAdjusted = applyFloorAdjustment(biasedEstimate, subjectFloorLevel, 'hdb')
  return {
    estimated: floorAdjusted,
    low: floorAdjusted * (1 - halfSpread),
    high: floorAdjusted * (1 + halfSpread),
    comparables: trimmed.length,
    radius,
    method,
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
    query = query.eq('property_subtype', 'condo').limit(2000)
  } else if (propertyCategory === 'ec') {
    query = query.eq('property_subtype', 'ec').limit(2000)
  } else {
    query = query.in('property_subtype', ['landed_strata', 'landed_non_strata']).limit(3000)
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

function trimRowsByMetric(
  rows: CleanedRow[],
  metricGetter: (row: CleanedRow) => number
) {
  if (rows.length < 5) return rows

  const metricValues = rows
    .map(metricGetter)
    .filter((value) => Number.isFinite(value) && value > 0)
    .sort((a, b) => a - b)

  if (metricValues.length < 5) return rows

  const p10 = percentile(metricValues, 0.1)
  const p90 = percentile(metricValues, 0.9)

  if (p10 === null || p90 === null) return rows

  const trimmed = rows.filter((row) => {
    const value = metricGetter(row)
    return value >= p10 && value <= p90
  })

  return trimmed.length >= 3 ? trimmed : rows
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
  if (rows.length < 5) return rows

  const psmValues = rows
    .map((row) => row.pricePerSqm)
    .filter((value) => Number.isFinite(value) && value > 0)
    .sort((a, b) => a - b)

  if (psmValues.length < 5) return rows

  const p15 = percentile(psmValues, 0.15)
  const p85 = percentile(psmValues, 0.85)

  if (p15 === null || p85 === null) return rows

  const trimmed = rows.filter((row) => {
    return row.pricePerSqm >= p15 && row.pricePerSqm <= p85
  })

  return trimmed.length >= 3 ? trimmed : rows
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

    if (daysOld === null || daysOld <= 180) {
      fresh.push(row)
    } else if (daysOld <= 365) {
      moderate.push(row)
    } else {
      stale.push(row)
    }
  }

  return { fresh, moderate, stale }
}

function selectCondoEcComparablePool(
  rows: CleanedRow[],
  floorAreaSqm: number,
  subjectProjectName?: string | null,
  subjectCompletionYear?: number | null,
  subjectTenureBucket?: string
) {
  const normalizedSubjectProject = normalizeText(subjectProjectName)
  const areaBands = getCondoEcAreaBands(floorAreaSqm)

  const sameProjectRows = normalizedSubjectProject
    ? rows.filter(
        (row) => normalizeText(row.project_name) === normalizedSubjectProject
      )
    : []

  let preferredSameProjectRows: CleanedRow[] = []

  if (sameProjectRows.length >= 2) {
    const sameProjectStrict = filterByAreaRatio(
      sameProjectRows,
      floorAreaSqm,
      areaBands.strict.min,
      areaBands.strict.max
    )
    const sameProjectMedium = filterByAreaRatio(
      sameProjectRows,
      floorAreaSqm,
      areaBands.medium.min,
      areaBands.medium.max
    )
    const sameProjectWide = filterByAreaRatio(
      sameProjectRows,
      floorAreaSqm,
      areaBands.wide.min,
      areaBands.wide.max
    )

    const sameProjectCandidates =
      sameProjectStrict.length >= 2
        ? sameProjectStrict
        : sameProjectMedium.length >= 2
        ? sameProjectMedium
        : sameProjectWide.length >= 2
        ? sameProjectWide
        : []

    if (sameProjectCandidates.length >= 2) {
      const { fresh, moderate } = splitRowsByRecency(sameProjectCandidates)

      if (fresh.length >= 2) return fresh
      if (fresh.length + moderate.length >= 2) {
        preferredSameProjectRows = [...fresh, ...moderate]
      }
    }
  }

  let pool = [...rows]

  if (subjectCompletionYear) {
    const ageFiltered = pool.filter((row) => {
      if (!row.completion_year) return false
      return Math.abs(row.completion_year - subjectCompletionYear) <= 10
    })

    if (ageFiltered.length >= 3) {
      pool = ageFiltered
    } else {
      const broaderAgeFiltered = pool.filter((row) => {
        if (!row.completion_year) return false
        return Math.abs(row.completion_year - subjectCompletionYear) <= 15
      })

      if (broaderAgeFiltered.length >= 3) {
        pool = broaderAgeFiltered
      } else {
        const antiNewLaunch = pool.filter((row) => {
          if (!subjectCompletionYear) return true
          if (!row.completion_year) return true
          return row.completion_year <= subjectCompletionYear + 8
        })

        if (antiNewLaunch.length >= 3) {
          pool = antiNewLaunch
        }
      }
    }
  }

  if (subjectTenureBucket && subjectTenureBucket !== 'UNKNOWN') {
    const sameTenureRows = pool.filter(
      (row) => normalizeTenureBucket(row.tenure) === subjectTenureBucket
    )

    if (sameTenureRows.length >= 3) {
      pool = sameTenureRows
    }
  }

  const tight = filterByAreaRatio(
    pool,
    floorAreaSqm,
    areaBands.strict.min,
    areaBands.strict.max
  )
  if (tight.length >= 3) {
    pool = tight
  } else {
    const medium = filterByAreaRatio(
      pool,
      floorAreaSqm,
      areaBands.medium.min,
      areaBands.medium.max
    )
    if (medium.length >= 3) {
      pool = medium
    } else {
      const broad = filterByAreaRatio(
        pool,
        floorAreaSqm,
        areaBands.wide.min,
        areaBands.wide.max
      )
      if (broad.length >= 3) {
        pool = broad
      }
    }
  }

  if (preferredSameProjectRows.length > 0) {
    const preferredKeys = new Set(
      preferredSameProjectRows.map(
        (row) =>
          `${row.address}|${row.transaction_date}|${row.transaction_price}`
      )
    )

    const others = pool.filter((row) => {
      const key = `${row.address}|${row.transaction_date}|${row.transaction_price}`
      return !preferredKeys.has(key)
    })

    return [...preferredSameProjectRows, ...others]
  }

  return pool
}

function buildCondoEcCandidate(
  rows: CleanedRow[],
  radius: number,
  floorAreaSqm: number,
  propertyCategory: PropertyCategory,
  subjectFloorLevel?: number,
  subjectProjectName?: string | null,
  subjectCompletionYear?: number | null,
  subjectTenureBucket?: string
): CandidateResult | null {
  if (rows.length === 0) return null

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

    const projectWeight = getCondoEcProjectWeight(row, subjectProjectName)
    const ageWeight = getCondoEcAgeWeight(row, subjectCompletionYear)
    const tenureWeight = getCondoEcTenureWeight(row, subjectTenureBucket)
    const recencyWeight = getRecencyWeight(row.transaction_date, propertyCategory)
    const floorWeight = getFloorWeight(subjectFloorLevel, row.parsedFloorLevel)

    return (
      distanceWeight *
      sizeWeight *
      projectWeight *
      ageWeight *
      tenureWeight *
      recencyWeight *
      floorWeight
    )
  })

  const avgPsm = weightedAverage(values, weights)
  if (!avgPsm || !Number.isFinite(avgPsm)) return null

  const estimated = avgPsm * floorAreaSqm
  const biasedEstimate = estimated * 1.01

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
      : biasedEstimate * (1 - fallbackSpread)
  const high =
    highPsm && Number.isFinite(highPsm)
      ? highPsm * floorAreaSqm
      : biasedEstimate * (1 + fallbackSpread)

  const floorAdjusted = applyFloorAdjustment(biasedEstimate, subjectFloorLevel, propertyCategory)
  return {
    estimated: floorAdjusted,
    low: floorAdjusted * (low / biasedEstimate),
    high: floorAdjusted * (high / biasedEstimate),
    comparables: usable.length,
    radius,
    method: 'condo_ec_hybrid',
  }
}

function buildCondoEcFallback(
  rows: CleanedRow[],
  floorAreaSqm: number,
  propertyCategory: PropertyCategory,
  subjectFloorLevel?: number,
  subjectProjectName?: string | null,
  subjectCompletionYear?: number | null,
  subjectTenureBucket?: string
): CandidateResult | null {
  if (rows.length === 0) return null

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

    const projectWeight = getCondoEcProjectWeight(row, subjectProjectName)
    const ageWeight = getCondoEcAgeWeight(row, subjectCompletionYear)
    const tenureWeight = getCondoEcTenureWeight(row, subjectTenureBucket)
    const recencyWeight = getRecencyWeight(row.transaction_date, propertyCategory)
    const floorWeight = getFloorWeight(subjectFloorLevel, row.parsedFloorLevel)

    return (
      distanceWeight *
      sizeWeight *
      projectWeight *
      ageWeight *
      tenureWeight *
      recencyWeight *
      floorWeight
    )
  })

  const avgPsm = weightedAverage(values, weights)
  if (!avgPsm || !Number.isFinite(avgPsm)) return null

  const estimated = avgPsm * floorAreaSqm
  const biasedEstimate = estimated * 1.01

  const floorAdjusted = applyFloorAdjustment(biasedEstimate, subjectFloorLevel, propertyCategory)
  return {
    estimated: floorAdjusted,
    low: floorAdjusted * 0.93,
    high: floorAdjusted * 1.07,
    comparables: usable.length,
    radius: Math.round(usable[usable.length - 1].distanceM),
    method: 'condo_ec_fallback',
  }
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

      const candidate = buildHdbCandidate(
        cleanedRows,
        radius,
        floorAreaSqm,
        floorLevel,
        blockNo,
        completionYear
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

    const fallbackResult = buildHdbCandidate(fallbackRows, 2000, floorAreaSqm, floorLevel, blockNo, completionYear)
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

    const sameTypeRows = cleanedRows.filter((row) =>
      isMatchingNonLandedType(row.unit_type, propertyType)
    )
    if (sameTypeRows.length >= 2) {
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
      subjectTenureBucket
    )

    if (!candidate) continue

    if (!bestCandidate) {
      bestCandidate = candidate
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

  const sameTypeRows = fallbackRows.filter((row) =>
    isMatchingNonLandedType(row.unit_type, propertyType)
  )
  if (sameTypeRows.length >= 2) {
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
    subjectTenureBucket
  )
  if (fallbackResult && cacheKey) await writeCache(cacheKey, fallbackResult)
  return fallbackResult
}
