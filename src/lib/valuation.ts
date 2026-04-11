import { supabase } from './supabase'

type PropertyCategory = 'hdb' | 'condo' | 'landed'

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

  if (propertyCategory === 'condo') {
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

async function fetchRowsForRadius(
  lat: number,
  lon: number,
  radiusM: number,
  propertyType: string,
  propertyCategory: PropertyCategory
) {
  const source = propertyCategory === 'hdb' ? 'data_gov_hdb' : 'ura_private'
  const box = getBoundingBox(lat, lon, radiusM)

  let query = supabase
    .from('property_transactions_v2')
    .select(
      'transaction_price, floor_area_sqm, latitude, longitude, unit_type, tenure, price_psf, project_name, transaction_date, address'
    )
    .eq('source', source)
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
    query = query.eq('unit_type', normalizeText(propertyType)).limit(1000)
  } else if (propertyCategory === 'condo') {
    query = query.limit(2000)
  } else {
    query = query.limit(3000)
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

  const spread =
    usable.length >= 6 ? 0.05 :
    usable.length >= 4 ? 0.07 :
    usable.length >= 2 ? 0.1 :
    0.12

  return {
    estimated,
    low: estimated * (1 - spread),
    high: estimated * (1 + spread),
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

  return {
    estimated,
    low: estimated * 0.88,
    high: estimated * 1.12,
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

  const spread =
    usable.length >= 5 ? 0.08 :
    usable.length >= 3 ? 0.1 :
    usable.length >= 2 ? 0.14 :
    0.18

  return {
    estimated,
    low: estimated * (1 - spread),
    high: estimated * (1 + spread),
    comparables: usable.length,
    radius,
    method: 'landed_nearby'
  }
}

function buildLandedFallback(
  rows: CleanedRow[],
  landSizeSqm: number,
  propertyType: string,
  tenure?: string
): CandidateResult | null {
  if (rows.length === 0) return null

  let fallbackPool = [...rows]

  const exactTypeRows = fallbackPool.filter((row) =>
    isMatchingLandedType(row.unit_type, propertyType)
  )
  if (exactTypeRows.length >= 2) {
    fallbackPool = exactTypeRows
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

  return {
    estimated,
    low: estimated * 0.82,
    high: estimated * 1.18,
    comparables: fallbackRows.length,
    radius: Math.round(fallbackRows[fallbackRows.length - 1].distanceM),
    method: 'landed_fallback'
  }
}

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
}: ValuationParams) {
  const searchRadius = getSearchRadius(propertyCategory)

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

      const subjectTenureBucket = getSubjectTenureBucket(tenure)

      const sameTenureRows = cleanedRows.filter(
        (row) => normalizeTenureBucket(row.tenure) === subjectTenureBucket
      )
      if (sameTenureRows.length >= 2) {
        cleanedRows = sameTenureRows
      }

      const candidate = buildLandedCandidate(
        cleanedRows,
        radius,
        landSizeSqm,
        builtUpSqm,
        propertyType,
        subjectTenureBucket
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

    if (bestCandidate) return bestCandidate

    const { data, error } = await fetchRowsForRadius(
      lat,
      lon,
      8000,
      propertyType,
      propertyCategory
    )

    if (error || !data || data.length === 0) return null

    const fallbackRows = cleanRows(data as TransactionRow[], lat, lon)
    return buildLandedFallback(fallbackRows, landSizeSqm, propertyType, tenure)
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

    if (propertyCategory === 'condo') {
      const sameTypeRows = cleanedRows.filter((row) =>
        isMatchingNonLandedType(row.unit_type, propertyType)
      )
      if (sameTypeRows.length >= 2) {
        valuationPool = sameTypeRows
      }
    }

    const detectedProjectName = (() => {
      const projectCounts = new Map<string, number>()

      for (const row of valuationPool) {
        const project = normalizeText(row.project_name)
        if (!project) continue
        if (row.distanceM > Math.min(radius, 400)) continue
        projectCounts.set(project, (projectCounts.get(project) || 0) + 1)
      }

      let bestProject: string | null = null
      let bestCount = 0

      for (const [project, count] of projectCounts.entries()) {
        if (count > bestCount) {
          bestProject = project
          bestCount = count
        }
      }

      return bestProject
    })()

    const candidate = buildNonLandedCandidate(
      valuationPool,
      radius,
      floorAreaSqm,
      propertyCategory,
      floorLevel,
      detectedProjectName
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

  if (bestCandidate) return bestCandidate

  const fallbackRadius = propertyCategory === 'hdb' ? 2000 : 3000
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

  if (propertyCategory === 'condo') {
    const sameTypeRows = fallbackRows.filter((row) =>
      isMatchingNonLandedType(row.unit_type, propertyType)
    )
    if (sameTypeRows.length >= 2) {
      fallbackRows = sameTypeRows
    }
  }

  const detectedProjectName = (() => {
    const projectCounts = new Map<string, number>()

    for (const row of fallbackRows) {
      const project = normalizeText(row.project_name)
      if (!project) continue
      if (row.distanceM > 400) continue
      projectCounts.set(project, (projectCounts.get(project) || 0) + 1)
    }

    let bestProject: string | null = null
    let bestCount = 0

    for (const [project, count] of projectCounts.entries()) {
      if (count > bestCount) {
        bestProject = project
        bestCount = count
      }
    }

    return bestProject
  })()

  return buildNonLandedFallback(
    fallbackRows,
    floorAreaSqm,
    propertyCategory,
    floorLevel,
    detectedProjectName
  )
}
