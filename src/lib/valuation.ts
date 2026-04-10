import { supabase } from './supabase'

type ValuationParams = {
  lat: number
  lon: number
  floorAreaSqm: number
  propertyType: string
  propertyCategory: 'hdb' | 'condo' | 'landed'
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
  pricePerSqm: number
  distanceM: number
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

  const weightedSum = values.reduce((sum, value, i) => sum + value * weights[i], 0)
  return weightedSum / totalWeight
}

export async function getValuation({
  lat,
  lon,
  floorAreaSqm,
  propertyType,
  propertyCategory,
}: ValuationParams) {
  let source = 'data_gov_hdb'

  if (propertyCategory !== 'hdb') {
    source = 'ura_private'
  }

  const searchRadius = [200, 400, 600, 800, 1200]

  const { data, error } = await supabase
    .from('property_transactions_v2')
    .select('transaction_price, floor_area_sqm, latitude, longitude, unit_type')
    .eq('source', source)
    .eq('unit_type', propertyType)
    .not('transaction_price', 'is', null)
    .not('floor_area_sqm', 'is', null)
    .not('latitude', 'is', null)
    .not('longitude', 'is', null)
    .limit(5000)

  if (error) {
    console.error('SUPABASE VALUATION ERROR:', error)
    return null
  }

  console.log('RAW DATA LENGTH:', data?.length)
  console.log('VALUATION INPUT:', {
    source,
    propertyType,
    propertyCategory,
    floorAreaSqm,
    lat,
    lon,
  })

  if (!data || data.length === 0) {
    console.log('No matching transactions found for source/property type:', {
      source,
      propertyType,
    })
    return null
  }

  const cleanedRows: CleanedRow[] = (data as TransactionRow[])
    .map((row) => {
      const transactionPrice = Number(row.transaction_price)
      const area = Number(row.floor_area_sqm)
      const rowLat = Number(row.latitude)
      const rowLon = Number(row.longitude)
      const pricePerSqm = transactionPrice / area
      const distanceM = distanceInMeters(rowLat, rowLon, lat, lon)

      return {
        transaction_price: transactionPrice,
        floor_area_sqm: area,
        latitude: rowLat,
        longitude: rowLon,
        pricePerSqm,
        distanceM,
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

  let bestCandidate: {
    estimated: number
    low: number
    high: number
    comparables: number
    radius: number
    avgPsm: number
  } | null = null

  for (const radius of searchRadius) {
    const nearby = cleanedRows.filter((row) => row.distanceM <= radius)
    console.log(`COMPS WITHIN ${radius}m:`, nearby.length)

    if (nearby.length < 2) continue

    const sortedPsm = nearby
      .map((row) => row.pricePerSqm)
      .sort((a, b) => a - b)

    const p10 = percentile(sortedPsm, 0.1)
    const p90 = percentile(sortedPsm, 0.9)

    if (p10 === null || p90 === null) continue

    const trimmed = nearby.filter(
      (row) => row.pricePerSqm >= p10 && row.pricePerSqm <= p90
    )

    const usable = trimmed.length >= 2 ? trimmed : nearby

    const values = usable.map((row) => row.pricePerSqm)

    // closer comps get higher weight
    const weights = usable.map((row) => {
      const distanceWeight = 1 / Math.max(row.distanceM, 50)
      const sizeDiff = Math.abs(row.floor_area_sqm - floorAreaSqm)
      const sizeWeight = 1 / Math.max(sizeDiff, 5)
      return distanceWeight * sizeWeight
    })

    const avgPsm = weightedAverage(values, weights)

    if (!avgPsm || !Number.isFinite(avgPsm)) continue

    const estimated = avgPsm * floorAreaSqm

    const candidate = {
      estimated,
      low: estimated * 0.95,
      high: estimated * 1.05,
      comparables: usable.length,
      radius,
      avgPsm,
    }

    // choose the best radius:
    // prefer at least 5 comps, otherwise keep best available so far
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
      // if both are good, prefer smaller radius unless comps are much better
      if (
        candidate.radius < bestCandidate.radius ||
        candidate.comparables >= bestCandidate.comparables + 3
      ) {
        bestCandidate = candidate
      }
      continue
    }

    if (!currentGood && !nextGood) {
      // prefer more comps first, then smaller radius
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
    console.log('Not enough nearby comparables found within 1200m.')
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