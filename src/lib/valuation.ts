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
    return [500, 1000, 1500, 2000, 3000]
  }

  if (propertyCategory === 'condo') {
    return [300, 600, 900, 1200, 1500]
  }

  return [200, 400, 600, 800, 1200]
}

function getUnitTypeCandidates(
  propertyType: string,
  propertyCategory: PropertyCategory
) {
  const normalized = normalizeText(propertyType)

  if (propertyCategory === 'landed') {
    if (normalized === 'TERRACE HOUSE') {
      return ['TERRACE HOUSE', 'TERRACE']
    }

    if (normalized === 'SEMI-DETACHED HOUSE') {
      return ['SEMI-DETACHED HOUSE', 'SEMI-DETACHED', 'SEMI DETACHED']
    }

    if (normalized === 'DETACHED HOUSE') {
      return [
        'DETACHED HOUSE',
        'DETACHED',
        'BUNGALOW',
        'GOOD CLASS BUNGALOW',
      ]
    }

    return [normalized]
  }

  return [normalized]
}

export async function getValuation({
  lat,
  lon,
  floorAreaSqm,
  propertyType,
  propertyCategory,
}: ValuationParams) {
  const source = propertyCategory === 'hdb' ? 'data_gov_hdb' : 'ura_private'
  const searchRadius = getSearchRadius(propertyCategory)
  const unitTypeCandidates = getUnitTypeCandidates(
    propertyType,
    propertyCategory
  )

  let query = supabase
    .from('property_transactions_v2')
    .select(
      'transaction_price, floor_area_sqm, latitude, longitude, unit_type'
    )
    .eq('source', source)
    .not('transaction_price', 'is', null)
    .not('floor_area_sqm', 'is', null)
    .not('latitude', 'is', null)
    .not('longitude', 'is', null)
    .limit(5000)

  if (unitTypeCandidates.length === 1) {
    query = query.eq('unit_type', unitTypeCandidates[0])
  } else {
    query = query.in('unit_type', unitTypeCandidates)
  }

  const { data, error } = await query

  if (error) {
    console.error('SUPABASE VALUATION ERROR:', error)
    return null
  }

  console.log('VALUATION INPUT:', {
    source,
    propertyType,
    propertyCategory,
    unitTypeCandidates,
    floorAreaSqm,
    lat,
    lon,
  })

  console.log('RAW DATA LENGTH:', data?.length || 0)

  if (!data || data.length === 0) {
    console.log('No matching transactions found for source/property type:', {
      source,
      propertyType,
      propertyCategory,
      unitTypeCandidates,
    })
    return null
  }

  const cleanedRows: CleanedRow[] = (data as TransactionRow[])
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
        pricePerSqm: transactionPrice / area,
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

  console.log('CLEANED ROWS LENGTH:', cleanedRows.length)

  if (cleanedRows.length === 0) {
    console.log('No usable cleaned rows after filtering.')
    return null
  }

  let bestCandidate: {
    estimated: number
    low: number
    high: number
    comparables: number
    radius: number
    avgPsm: number
  } | null = null

  const minimumComparables = propertyCategory === 'landed' ? 1 : 2

  for (const radius of searchRadius) {
    const nearby = cleanedRows.filter((row) => row.distanceM <= radius)

    console.log(`COMPS WITHIN ${radius}m:`, nearby.length)

    if (nearby.length < minimumComparables) continue

    let usable = nearby

    if (nearby.length >= 5) {
      const sortedPsm = nearby
        .map((row) => row.pricePerSqm)
        .sort((a, b) => a - b)

      const p10 = percentile(sortedPsm, 0.1)
      const p90 = percentile(sortedPsm, 0.9)

      if (p10 !== null && p90 !== null) {
        const trimmed = nearby.filter(
          (row) => row.pricePerSqm >= p10 && row.pricePerSqm <= p90
        )

        if (trimmed.length >= minimumComparables) {
          usable = trimmed
        }
      }
    }

    const values = usable.map((row) => row.pricePerSqm)

    const weights = usable.map((row) => {
      const distanceWeight = 1 / Math.max(row.distanceM, 50)

      const sizeDiff = Math.abs(row.floor_area_sqm - floorAreaSqm)

      const minSizeFloor =
        propertyCategory === 'landed' ? 20 : 5

      const sizeWeight = 1 / Math.max(sizeDiff, minSizeFloor)

      return distanceWeight * sizeWeight
    })

    const avgPsm = weightedAverage(values, weights)

    if (!avgPsm || !Number.isFinite(avgPsm)) continue

    const estimated = avgPsm * floorAreaSqm

    const spread =
      propertyCategory === 'landed'
        ? usable.length >= 3
          ? 0.08
          : 0.12
        : 0.05

    const candidate = {
      estimated,
      low: estimated * (1 - spread),
      high: estimated * (1 + spread),
      comparables: usable.length,
      radius,
      avgPsm,
    }

    if (!bestCandidate) {
      bestCandidate = candidate
      continue
    }

    const currentGood =
      bestCandidate.comparables >= (propertyCategory === 'landed' ? 3 : 5)
    const nextGood =
      candidate.comparables >= (propertyCategory === 'landed' ? 3 : 5)

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
