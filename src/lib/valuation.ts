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
  pricePerSqm: number
  pricePerSqft: number
  distanceM: number
}

type CandidateResult = {
  estimated: number
  low: number
  high: number
  comparables: number
  radius: number
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
    return [300, 600, 900, 1200, 1500]
  }

  return [200, 400, 600, 800, 1200]
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

  if (targetGroup === 'terrace') {
    return row.includes('TERRACE')
  }

  if (targetGroup === 'semi') {
    return row.includes('SEMI')
  }

  if (targetGroup === 'detached') {
    return (
      row.includes('DETACHED') ||
      row.includes('BUNGALOW') ||
      row.includes('GOOD CLASS BUNGALOW')
    )
  }

  return false
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

  if (tenure === 'FREEHOLD' || tenure === '999-YEAR') {
    return 'FH_999'
  }

  if (tenure === '99-YEAR') {
    return 'L99'
  }

  return 'OTHER'
}

function getTypicalBuiltUpRatio(propertyType: string) {
  const group = getLandedGroup(propertyType)

  if (group === 'terrace') return 2.3
  if (group === 'semi') return 1.9
  if (group === 'detached') return 1.5

  return 1.8
}

async function fetchBaseRows(
  propertyType: string,
  propertyCategory: PropertyCategory
) {
  const source = propertyCategory === 'hdb' ? 'data_gov_hdb' : 'ura_private'

  if (propertyCategory === 'landed') {
    const { data, error } = await supabase
      .from('property_transactions_v2')
      .select(
        'transaction_price, floor_area_sqm, latitude, longitude, unit_type, tenure, price_psf, project_name, transaction_date'
      )
      .eq('source', source)
      .not('transaction_price', 'is', null)
      .not('floor_area_sqm', 'is', null)
      .not('latitude', 'is', null)
      .not('longitude', 'is', null)
      .limit(20000)

    return { data, error }
  }

  const normalized = normalizeText(propertyType)

  const { data, error } = await supabase
    .from('property_transactions_v2')
    .select(
      'transaction_price, floor_area_sqm, latitude, longitude, unit_type, tenure, price_psf, project_name, transaction_date'
    )
    .eq('source', source)
    .eq('unit_type', normalized)
    .not('transaction_price', 'is', null)
    .not('floor_area_sqm', 'is', null)
    .not('latitude', 'is', null)
    .not('longitude', 'is', null)
    .limit(5000)

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
        pricePerSqm: transactionPrice / areaSqm,
        pricePerSqft,
        distanceM: distanceInMeters(rowLat, rowLon, lat, lon),
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
  if (rows.length < 5) {
    return rows
  }

  function pickPreferredNonLandedRows(
    rows: CleanedRow[],
    floorAreaSqm: number
  ) {
    const sizeFiltered = rows.filter((row) => {
      const sizeDiffRatio = Math.abs(row.floor_area_sqm - floorAreaSqm) / floorAreaSqm
      return sizeDiffRatio <= 0.2
    })

    const candidateRows = sizeFiltered.length >= 3 ? sizeFiltered : rows

    const projectCounts = new Map<string, number>()

    for (const row of candidateRows) {
      const project = normalizeText(row.project_name)
      if (!project) continue
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

    if (bestProject && bestCount >= 3) {
      const sameProjectRows = candidateRows.filter(
        (row) => normalizeText(row.project_name) === bestProject
      )

      if (sameProjectRows.length >= 3) {
        return sameProjectRows
      }
    }

    return candidateRows
  }

  const metricValues = rows
    .map(metricGetter)
    .filter((value) => Number.isFinite(value) && value > 0)
    .sort((a, b) => a - b)

  if (metricValues.length < 5) {
    return rows
  }

  const p10 = percentile(metricValues, 0.1)
  const p90 = percentile(metricValues, 0.9)

  if (p10 === null || p90 === null) {
    return rows
  }

  const trimmed = rows.filter((row) => {
    const value = metricGetter(row)
    return value >= p10 && value <= p90
  })

  return trimmed.length >= 3 ? trimmed : rows
}

function buildNonLandedCandidate(
  rows: CleanedRow[],
  radius: number,
  floorAreaSqm: number
): CandidateResult | null {
  if (rows.length === 0) return null

  const preferredRows = pickPreferredNonLandedRows(rows, floorAreaSqm)
  const usable = trimRowsByMetric(preferredRows, (row) => row.pricePerSqm)

  const values = usable.map((row) => row.pricePerSqm)
  const weights = usable.map((row) => {
    const distanceWeight = 1 / Math.max(row.distanceM, 50)

    const sizeDiff = Math.abs(row.floor_area_sqm - floorAreaSqm)
    const sizeWeight = 1 / Math.max(sizeDiff, 5)

    let recencyWeight = 1
    if (row.transaction_date) {
      const txnTime = new Date(row.transaction_date).getTime()
      const now = Date.now()
      const daysOld = (now - txnTime) / (1000 * 60 * 60 * 24)

      if (daysOld <= 90) recencyWeight = 1.2
      else if (daysOld <= 180) recencyWeight = 1.1
      else if (daysOld <= 365) recencyWeight = 1
      else recencyWeight = 0.9
    }

    return distanceWeight * sizeWeight * recencyWeight
  })

  const avgPsm = weightedAverage(values, weights)
  if (!avgPsm || !Number.isFinite(avgPsm)) return null

  const estimated = avgPsm * floorAreaSqm

  return {
    estimated,
    low: estimated * 0.95,
    high: estimated * 1.05,
    comparables: usable.length,
    radius,
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

  const usable = trimRowsByMetric(rows, (row) => row.pricePerSqft)

  const landSizeSqft = landSizeSqm * 10.7639
  const values = usable.map((row) => row.pricePerSqft)

  const weights = usable.map((row) => {
    const distanceWeight = 1 / Math.max(row.distanceM, 100)

    const landSizeDiff = Math.abs(row.floor_area_sqm - landSizeSqm)
    const sizeWeight = 1 / Math.max(landSizeDiff, 20)

    const rowTenureBucket = normalizeTenureBucket(row.tenure)
    const tenureWeight = rowTenureBucket === subjectTenureBucket ? 1.2 : 0.9

    return distanceWeight * sizeWeight * tenureWeight
  })

  const avgLandPsf = weightedAverage(values, weights)
  if (!avgLandPsf || !Number.isFinite(avgLandPsf)) {
    return null
  }

  let estimated = avgLandPsf * landSizeSqft

  const typicalRatio = getTypicalBuiltUpRatio(propertyType)
  const subjectRatio =
    builtUpSqm > 0 && landSizeSqm > 0 ? builtUpSqm / landSizeSqm : typicalRatio
  const ratioDelta = (subjectRatio - typicalRatio) / typicalRatio
  const cappedAdjustment = Math.max(-0.05, Math.min(0.05, ratioDelta * 0.2))

  estimated = estimated * (1 + cappedAdjustment)

  const spread =
    usable.length >= 5 ? 0.08 : usable.length >= 3 ? 0.1 : 0.12

  return {
    estimated,
    low: estimated * (1 - spread),
    high: estimated * (1 + spread),
    comparables: usable.length,
    radius,
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
}: ValuationParams) {
  const searchRadius = getSearchRadius(propertyCategory)
  const { data, error } = await fetchBaseRows(propertyType, propertyCategory)

  if (error) {
    console.error('SUPABASE VALUATION ERROR:', error)
    return null
  }

  if (!data || data.length === 0) {
    console.log('No transactions found at fetch stage.')
    return null
  }

  let cleanedRows = cleanRows(data as TransactionRow[], lat, lon)

  if (cleanedRows.length === 0) {
    console.log('No usable cleaned rows after filtering.')
    return null
  }

  if (propertyCategory === 'landed') {
    if (!landSizeSqm || !builtUpSqm) {
      console.log('Missing landed land size or built-up size.')
      return null
    }

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

    if (sameTenureRows.length >= 3) {
      cleanedRows = sameTenureRows
    }

    let bestCandidate: CandidateResult | null = null

    for (const radius of searchRadius) {
      const nearby = cleanedRows.filter((row) => row.distanceM <= radius)
      if (nearby.length < 2) continue

      const candidate = buildLandedCandidate(
        nearby,
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

    if (!bestCandidate) {
      const nearestFew = [...cleanedRows]
        .sort((a, b) => a.distanceM - b.distanceM)
        .slice(0, 3)

      if (nearestFew.length > 0) {
        bestCandidate = buildLandedCandidate(
          nearestFew,
          Math.round(nearestFew[nearestFew.length - 1].distanceM),
          landSizeSqm,
          builtUpSqm,
          propertyType,
          getSubjectTenureBucket(tenure)
        )
      }
    }

    if (!bestCandidate) {
      return null
    }

    return bestCandidate
  }

  let bestCandidate: CandidateResult | null = null

  for (const radius of searchRadius) {
    const nearby = cleanedRows.filter((row) => row.distanceM <= radius)
    if (nearby.length < 2) continue

    const candidate = buildNonLandedCandidate(nearby, radius, floorAreaSqm)

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

  if (!bestCandidate) {
    return null
  }

  return bestCandidate
}
