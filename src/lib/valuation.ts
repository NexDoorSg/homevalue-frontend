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
  floor_area_sc: number | string | null
  floor_area_sqm?: number | string | null
  latitude: number | string | null
  longitude: number | string | null
  unit_type: string | null
  price_psf?: number | string | null
}

type CleanedRow = {
  transaction_price: number
  floor_area_sqm: number
  latitude: number
  longitude: number
  unit_type: string | null
  pricePerSqm: number
  distanceM: number
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

  const weightedSum = values.reduce(
    (sum, value, i) => sum + value * weights[i],
    0
  )

  return weightedSum / totalWeight
}

function getSearchRadius(propertyCategory: PropertyCategory) {
  if (propertyCategory === 'landed') {
    return [300, 600, 1000, 1500, 2000]
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

async function fetchBaseRows(
  propertyType: string,
  propertyCategory: PropertyCategory
) {
  const source = propertyCategory === 'hdb' ? 'data_gov_hdb' : 'ura_private'

  if (propertyCategory === 'landed') {
    const { data, error } = await supabase
      .from('property_transactions_v2')
      .select(
        'transaction_price, floor_area_sc, floor_area_sqm, latitude, longitude, unit_type, price_psf'
      )
      .eq('source', source)
      .not('transaction_price', 'is', null)
      .not('latitude', 'is', null)
      .not('longitude', 'is', null)
      .limit(10000)

    return { data, error }
  }

  const normalized = normalizeText(propertyType)

  const { data, error } = await supabase
    .from('property_transactions_v2')
    .select(
      'transaction_price, floor_area_sc, floor_area_sqm, latitude, longitude, unit_type, price_psf'
    )
    .eq('source', source)
    .eq('unit_type', normalized)
    .not('transaction_price', 'is', null)
    .not('latitude', 'is', null)
    .not('longitude', 'is', null)
    .limit(5000)

  return { data, error }
}

function resolveAreaSqm(row: TransactionRow) {
  const areaSc = Number(row.floor_area_sc)
  const areaSqm = Number(row.floor_area_sqm)

  if (Number.isFinite(areaSc) && areaSc > 0) return areaSc
  if (Number.isFinite(areaSqm) && areaSqm > 0) return areaSqm

  return NaN
}

function cleanRows(
  rows: TransactionRow[],
  lat: number,
  lon: number
): CleanedRow[] {
  return rows
    .map((row) => {
      const transactionPrice = Number(row.transaction_price)
      const areaSqm = resolveAreaSqm(row)
      const rowLat = Number(row.latitude)
      const rowLon = Number(row.longitude)
      const pricePsf = Number(row.price_psf)

      let pricePerSqm = NaN

      if (Number.isFinite(pricePsf) && pricePsf > 0) {
        pricePerSqm = pricePsf * 10.7639
      } else if (
        Number.isFinite(transactionPrice) &&
        transactionPrice > 0 &&
        Number.isFinite(areaSqm) &&
        areaSqm > 0
      ) {
        pricePerSqm = transactionPrice / areaSqm
      }

      return {
        transaction_price: transactionPrice,
        floor_area_sqm: areaSqm,
        latitude: rowLat,
        longitude: rowLon,
        unit_type: row.unit_type,
        pricePerSqm,
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
        Number.isFinite(row.distanceM)
    )
}

function buildCandidate(
  rows: CleanedRow[],
  radius: number,
  floorAreaSqm: number,
  propertyCategory: PropertyCategory
) {
  if (rows.length === 0) return null

  let usable = rows

  if (rows.length >= 5) {
    const sortedPsm = rows
      .map((row) => row.pricePerSqm)
      .sort((a, b) => a - b)

    const p10 = percentile(sortedPsm, 0.1)
    const p90 = percentile(sortedPsm, 0.9)

    if (p10 !== null && p90 !== null) {
      const trimmed = rows.filter(
        (row) => row.pricePerSqm >= p10 && row.pricePerSqm <= p90
      )

      if (trimmed.length >= Math.min(3, rows.length)) {
        usable = trimmed
      }
    }
  }

  const values = usable.map((row) => row.pricePerSqm)

  const weights = usable.map((row) => {
    if (propertyCategory === 'landed') {
      const distanceWeight = 1 / Math.max(row.distanceM, 25) ** 1.8
      const sizeDiffRatio =
        Math.abs(row.floor_area_sqm - floorAreaSqm) / Math.max(floorAreaSqm, 1)
      const sizeWeight = 1 / Math.max(sizeDiffRatio, 0.08)
      return distanceWeight * sizeWeight
    }

    const distanceWeight = 1 / Math.max(row.distanceM, 50)
    const sizeDiff = Math.abs(row.floor_area_sqm - floorAreaSqm)
    const minSizeFloor = propertyCategory === 'condo' ? 8 : 5
    const sizeWeight = 1 / Math.max(sizeDiff, minSizeFloor)

    return distanceWeight * sizeWeight
  })

  const avgPsm = weightedAverage(values, weights)

  if (!avgPsm || !Number.isFinite(avgPsm)) {
    return null
  }

  const estimated = avgPsm * floorAreaSqm

  const spread =
    propertyCategory === 'landed'
      ? usable.length >= 5
        ? 0.08
        : usable.length >= 3
          ? 0.1
          : 0.12
      : 0.05

  return {
    estimated,
    low: estimated * (1 - spread),
    high: estimated * (1 + spread),
    comparables: usable.length,
    radius,
    avgPsm,
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
    cleanedRows = cleanedRows.filter((row) =>
      isMatchingLandedType(row.unit_type, propertyType)
    )

    console.log('LANDED EXACT GROUP ROWS:', cleanedRows.length)

    if (cleanedRows.length === 0) {
      console.log('No exact landed type matches found.')
      return null
    }
  }

  let bestCandidate: {
    estimated: number
    low: number
    high: number
    comparables: number
    radius: number
    avgPsm: number
  } | null = null

  const targetGoodComparables = propertyCategory === 'landed' ? 3 : 5
  const minimumComparables = propertyCategory === 'landed' ? 2 : 2

  for (const radius of searchRadius) {
    let nearby = cleanedRows.filter((row) => row.distanceM <= radius)

    console.log(`COMPS WITHIN ${radius}m:`, nearby.length)

    if (propertyCategory === 'landed' && nearby.length > 8) {
      nearby = nearby.sort((a, b) => a.distanceM - b.distanceM).slice(0, 8)
    }

    if (nearby.length < minimumComparables) continue

    const candidate = buildCandidate(
      nearby,
      radius,
      floorAreaSqm,
      propertyCategory
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

  if (!bestCandidate) {
    console.log('Not enough nearby comparables found.')
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
