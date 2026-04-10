import { supabase } from './supabase'

type PropertyCategory = 'hdb' | 'condo' | 'landed'

type ValuationParams = {
  lat: number
  lon: number
  floorAreaSqm: number
  propertyType: string
  propertyCategory: PropertyCategory
}

type TransactionRow = {
  transaction_price: number | string | null
  floor_area_sqm: number | string | null
  latitude: number | string | null
  longitude: number | string | null
  unit_type: string | null
  transaction_date?: string | null
}

type CleanedRow = {
  transaction_price: number
  floor_area_sqm: number
  latitude: number
  longitude: number
  unit_type: string | null
  transaction_date: string | null
  pricePerSqm: number
  distanceM: number
  monthsAgo: number
}

type Candidate = {
  estimated: number
  low: number
  high: number
  comparables: number
  radius: number
  avgPsm: number
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

function median(values: number[]) {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)

  if (sorted.length % 2 === 0) {
    return (sorted[middle - 1] + sorted[middle]) / 2
  }

  return sorted[middle]
}

function weightedAverage(values: number[], weights: number[]) {
  const totalWeight = weights.reduce((sum, w) => sum + w, 0)
  if (!totalWeight) return null

  const weightedSum = values.reduce((sum, value, i) => {
    return sum + value * weights[i]
  }, 0)

  return weightedSum / totalWeight
}

function getMonthsAgo(value: string | null | undefined) {
  if (!value) return 24

  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return 24

  const now = new Date()
  const diffMs = now.getTime() - parsed.getTime()
  const months = diffMs / (1000 * 60 * 60 * 24 * 30.4375)

  return Math.max(0, months)
}

function getSearchRadius(propertyCategory: PropertyCategory) {
  if (propertyCategory === 'landed') {
    return [1000, 2000, 3000, 5000, 8000, 12000]
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

function isAnyLandedType(rowUnitType: string | null) {
  const row = normalizeText(rowUnitType)

  return (
    row.includes('TERRACE') ||
    row.includes('SEMI') ||
    row.includes('DETACHED') ||
    row.includes('BUNGALOW') ||
    row.includes('GOOD CLASS BUNGALOW')
  )
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
        'transaction_price, floor_area_sqm, latitude, longitude, unit_type, transaction_date'
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
      'transaction_price, floor_area_sqm, latitude, longitude, unit_type, transaction_date'
    )
    .eq('source', source)
    .eq('unit_type', normalized)
    .not('transaction_price', 'is', null)
    .not('floor_area_sqm', 'is', null)
    .not('latitude', 'is', null)
    .not('longitude', 'is', null)
    .limit(8000)

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
      const area = Number(row.floor_area_sqm)
      const rowLat = Number(row.latitude)
      const rowLon = Number(row.longitude)

      return {
        transaction_price: transactionPrice,
        floor_area_sqm: area,
        latitude: rowLat,
        longitude: rowLon,
        unit_type: row.unit_type,
        transaction_date: row.transaction_date || null,
        pricePerSqm: transactionPrice / area,
        distanceM: distanceInMeters(rowLat, rowLon, lat, lon),
        monthsAgo: getMonthsAgo(row.transaction_date),
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
        Number.isFinite(row.distanceM) &&
        Number.isFinite(row.monthsAgo)
    )
}

function trimOutliers(rows: CleanedRow[]) {
  if (rows.length < 5) return rows

  const sortedPsm = rows.map((row) => row.pricePerSqm).sort((a, b) => a - b)
  const p10 = percentile(sortedPsm, 0.1)
  const p90 = percentile(sortedPsm, 0.9)

  if (p10 === null || p90 === null) return rows

  const trimmed = rows.filter(
    (row) => row.pricePerSqm >= p10 && row.pricePerSqm <= p90
  )

  return trimmed.length >= Math.min(4, rows.length) ? trimmed : rows
}

function buildStandardCandidate(
  rows: CleanedRow[],
  radius: number,
  floorAreaSqm: number,
  propertyCategory: Exclude<PropertyCategory, 'landed'>
): Candidate | null {
  if (rows.length === 0) return null

  const usable = trimOutliers(rows)
  const values = usable.map((row) => row.pricePerSqm)

  const weights = usable.map((row) => {
    const distanceWeight = 1 / Math.max(row.distanceM, 50)
    const sizeDiff = Math.abs(row.floor_area_sqm - floorAreaSqm)
    const sizeWeight = 1 / Math.max(sizeDiff, propertyCategory === 'condo' ? 8 : 5)
    const recencyWeight = 1 / Math.max(row.monthsAgo + 1, 1)

    return distanceWeight * sizeWeight * recencyWeight
  })

  const avgPsm = weightedAverage(values, weights)

  if (!avgPsm || !Number.isFinite(avgPsm)) {
    return null
  }

  const estimated = avgPsm * floorAreaSqm
  const spread = propertyCategory === 'condo' ? 0.06 : 0.05

  return {
    estimated,
    low: estimated * (1 - spread),
    high: estimated * (1 + spread),
    comparables: usable.length,
    radius,
    avgPsm,
  }
}

function buildLandedCandidate(
  rows: CleanedRow[],
  radius: number,
  floorAreaSqm: number
): Candidate | null {
  if (rows.length === 0) return null

  let usable = rows

  const minArea = floorAreaSqm * 0.6
  const maxArea = floorAreaSqm * 1.6

  const sizeFiltered = usable.filter(
    (row) => row.floor_area_sqm >= minArea && row.floor_area_sqm <= maxArea
  )

  if (sizeFiltered.length >= 4) {
    usable = sizeFiltered
  }

  usable = trimOutliers(usable)

  const weightedValues = usable.map((row) => row.pricePerSqm)
  const weightedWeights = usable.map((row) => {
    const distanceWeight = 1 / Math.max(row.distanceM, 150)
    const sizeRatio = Math.abs(row.floor_area_sqm - floorAreaSqm) / floorAreaSqm
    const sizeWeight = 1 / Math.max(sizeRatio, 0.08)
    const recencyWeight = 1 / Math.max(row.monthsAgo + 1, 1)

    return distanceWeight * sizeWeight * recencyWeight
  })

  const weightedPsm = weightedAverage(weightedValues, weightedWeights)
  const medianPsm = median(usable.map((row) => row.pricePerSqm))

  if (!weightedPsm || !medianPsm) {
    return null
  }

  const blendedPsm = medianPsm * 0.65 + weightedPsm * 0.35
  const estimated = blendedPsm * floorAreaSqm

  const spread =
    usable.length >= 8 ? 0.08 : usable.length >= 5 ? 0.1 : 0.12

  return {
    estimated,
    low: estimated * (1 - spread),
    high: estimated * (1 + spread),
    comparables: usable.length,
    radius,
    avgPsm: blendedPsm,
  }
}

export async function getValuation({
  lat,
  lon,
  floorAreaSqm,
  propertyType,
  propertyCategory,
}: ValuationParams) {
  const searchRadius = getSearchRadius(propertyCategory)

  const { data, error } = await fetchBaseRows(propertyType, propertyCategory)

  if (error) {
    console.error('SUPABASE VALUATION ERROR:', error)
    return null
  }

  console.log('VALUATION INPUT:', {
    propertyType,
    propertyCategory,
    floorAreaSqm,
    lat,
    lon,
    rawRows: data?.length || 0,
  })

  if (!data || data.length === 0) {
    console.log('No transactions found at fetch stage.')
    return null
  }

  let cleanedRows = cleanRows(data as TransactionRow[], lat, lon)

  console.log('CLEANED ROWS LENGTH:', cleanedRows.length)

  if (cleanedRows.length === 0) {
    console.log('No usable cleaned rows after filtering.')
    return null
  }

  if (propertyCategory === 'landed') {
    const exactLandedRows = cleanedRows.filter((row) =>
      isMatchingLandedType(row.unit_type, propertyType)
    )

    console.log('LANDED EXACT GROUP ROWS:', exactLandedRows.length)

    if (exactLandedRows.length >= 3) {
      cleanedRows = exactLandedRows
    } else {
      const anyLandedRows = cleanedRows.filter((row) =>
        isAnyLandedType(row.unit_type)
      )

      console.log('LANDED ANY-TYPE ROWS:', anyLandedRows.length)

      if (anyLandedRows.length > 0) {
        cleanedRows = anyLandedRows
      }
    }
  }

  let bestCandidate: Candidate | null = null
  const targetGoodComparables = propertyCategory === 'landed' ? 6 : 5
  const minimumComparables = propertyCategory === 'landed' ? 3 : 2

  for (const radius of searchRadius) {
    const nearby = cleanedRows.filter((row) => row.distanceM <= radius)

    console.log(`COMPS WITHIN ${radius}m:`, nearby.length)

    if (nearby.length < minimumComparables) continue

    const candidate =
      propertyCategory === 'landed'
        ? buildLandedCandidate(nearby, radius, floorAreaSqm)
        : buildStandardCandidate(
            nearby,
            radius,
            floorAreaSqm,
            propertyCategory as 'hdb' | 'condo'
          )

    if (!candidate) continue

    if (!bestCandidate) {
      bestCandidate = candidate
      continue
    }

    const currentGood = bestCandidate.comparables >= targetGoodComparables
    const nextGood = candidate.comparables >= targetGoodComparables

    if (!currentGood && nextGood) {
      bestCandidate = candidate
      continue
    }

    if (currentGood && nextGood) {
      if (
        candidate.radius < bestCandidate.radius ||
        candidate.comparables >= bestCandidate.comparables + 2
      ) {
        bestCandidate = candidate
      }
      continue
    }

    if (!currentGood && !nextGood) {
      if (
        candidate.comparables > bestCandidate.comparables ||
        (candidate.comparables === bestCandidate.comparables &&
          candidate.radius < bestCandidate.radius)
      ) {
        bestCandidate = candidate
      }
    }
  }

  if (!bestCandidate && propertyCategory === 'landed') {
    const nearestFew = [...cleanedRows]
      .sort((a, b) => a.distanceM - b.distanceM)
      .slice(0, 6)

    console.log('LANDED FALLBACK NEAREST FEW:', nearestFew.length)

    if (nearestFew.length >= 3) {
      bestCandidate = buildLandedCandidate(
        nearestFew,
        Math.round(nearestFew[nearestFew.length - 1].distanceM),
        floorAreaSqm
      )
    }
  }

  if (!bestCandidate) {
    console.log(
      `Not enough nearby comparables found within ${
        searchRadius[searchRadius.length - 1]
      }m.`
    )
    return null
  }

  console.log('VALUATION SUCCESS:', bestCandidate)

  return {
    estimated: bestCandidate.estimated,
    low: bestCandidate.low,
    high: bestCandidate.high,
    comparables: bestCandidate.comparables,
    radius: bestCandidate.radius,
  }
}
