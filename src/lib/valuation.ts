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

// ------------------ HELPERS ------------------

function normalizeText(value: string | null | undefined) {
  return (value || '').toUpperCase().trim()
}

function distanceInMeters(lat1: number, lon1: number, lat2: number, lon2: number) {
  const dx = lat1 - lat2
  const dy = lon1 - lon2
  return Math.sqrt(dx * dx + dy * dy) * 111000
}

function weightedAverage(values: number[], weights: number[]) {
  const totalWeight = weights.reduce((sum, w) => sum + w, 0)
  if (!totalWeight) return null

  return values.reduce((sum, v, i) => sum + v * weights[i], 0) / totalWeight
}

function getSearchRadius(propertyCategory: PropertyCategory) {
  if (propertyCategory === 'landed') return [1000, 2000, 3000, 5000]
  if (propertyCategory === 'condo') return [300, 600, 900, 1200]
  return [200, 400, 600, 800]
}

// ------------------ DATA FETCH ------------------

async function fetchRows(propertyType: string, category: PropertyCategory) {
  const source = category === 'hdb' ? 'data_gov_hdb' : 'ura_private'

  const query = supabase
    .from('property_transactions_v2')
    .select(
      'transaction_price, floor_area_sqm, latitude, longitude, unit_type, tenure, price_psf, project_name, transaction_date'
    )
    .eq('source', source)
    .not('transaction_price', 'is', null)
    .not('floor_area_sqm', 'is', null)
    .not('latitude', 'is', null)
    .not('longitude', 'is', null)

  if (category !== 'landed') {
    query.eq('unit_type', normalizeText(propertyType))
  }

  const { data, error } = await query.limit(10000)
  return { data, error }
}

// ------------------ CLEAN ------------------

function cleanRows(rows: TransactionRow[], lat: number, lon: number): CleanedRow[] {
  return rows
    .map((r) => {
      const price = Number(r.transaction_price)
      const sqm = Number(r.floor_area_sqm)
      const lat2 = Number(r.latitude)
      const lon2 = Number(r.longitude)
      const sqft = sqm * 10.7639

      let psf = price / sqft
      if (Number(r.price_psf) > 0) psf = Number(r.price_psf)

      return {
        transaction_price: price,
        floor_area_sqm: sqm,
        latitude: lat2,
        longitude: lon2,
        unit_type: r.unit_type,
        tenure: r.tenure || null,
        project_name: r.project_name || null,
        transaction_date: r.transaction_date || null,
        pricePerSqm: price / sqm,
        pricePerSqft: psf,
        distanceM: distanceInMeters(lat, lon, lat2, lon2),
      }
    })
    .filter(
      (r) =>
        r.transaction_price > 0 &&
        r.floor_area_sqm > 0 &&
        r.pricePerSqm > 0 &&
        r.pricePerSqft > 0
    )
}

// ------------------ CONDO LOGIC ------------------

function pickPreferredRows(rows: CleanedRow[], targetSize: number) {
  const sizeFiltered = rows.filter((r) => {
    const ratio = r.floor_area_sqm / targetSize
    return ratio >= 0.8 && ratio <= 1.2
  })

  const usable = sizeFiltered.length >= 3 ? sizeFiltered : rows

  const projectCounts = new Map<string, number>()
  usable.forEach((r) => {
    const p = normalizeText(r.project_name)
    if (!p) return
    projectCounts.set(p, (projectCounts.get(p) || 0) + 1)
  })

  let bestProject: string | null = null
  let max = 0

  projectCounts.forEach((count, p) => {
    if (count > max) {
      bestProject = p
      max = count
    }
  })

  if (bestProject && max >= 3) {
    return usable.filter((r) => normalizeText(r.project_name) === bestProject)
  }

  return usable
}

function buildCondo(rows: CleanedRow[], size: number, radius: number): CandidateResult | null {
  if (!rows.length) return null

  const filtered = pickPreferredRows(rows, size)

  const values = filtered.map((r) => r.pricePerSqm)

  const weights = filtered.map((r) => {
    const distanceW = 1 / Math.max(r.distanceM, 50)
    const sizeW = 1 / Math.max(Math.abs(r.floor_area_sqm - size), 5)

    let recency = 1
    if (r.transaction_date) {
      const days = (Date.now() - new Date(r.transaction_date).getTime()) / 86400000
      if (days <= 90) recency = 1.2
      else if (days <= 180) recency = 1.1
      else if (days > 365) recency = 0.9
    }

    return distanceW * sizeW * recency
  })

  const avg = weightedAverage(values, weights)
  if (!avg) return null

  const est = avg * size

  const spread =
    filtered.length >= 5 ? 0.06 :
    filtered.length >= 3 ? 0.1 :
    0.15

  return {
    estimated: est,
    low: est * (1 - spread),
    high: est * (1 + spread),
    comparables: filtered.length,
    radius,
  }
}

// ------------------ LANDED LOGIC ------------------

function buildLanded(
  rows: CleanedRow[],
  landSize: number,
  radius: number
): CandidateResult | null {
  if (!rows.length) return null

  const filtered = rows.filter((r) => {
    const ratio = r.floor_area_sqm / landSize
    return ratio >= 0.5 && ratio <= 1.5
  })

  const usable = filtered.length >= 3 ? filtered : rows

  const values = usable.map((r) => r.pricePerSqft)

  const weights = usable.map((r) => {
    const distanceW = 1 / Math.max(r.distanceM, 100)

    const ratio = r.floor_area_sqm / landSize
    const sizeW =
      ratio >= 0.7 && ratio <= 1.3 ? 1.2 :
      ratio >= 0.5 && ratio <= 1.5 ? 1 :
      0.6

    let recency = 1
    if (r.transaction_date) {
      const days = (Date.now() - new Date(r.transaction_date).getTime()) / 86400000
      if (days <= 90) recency = 1.15
      else if (days <= 180) recency = 1.08
      else if (days > 365) recency = 0.9
    }

    return distanceW * sizeW * recency
  })

  const avg = weightedAverage(values, weights)
  if (!avg) return null

  const sqft = landSize * 10.7639
  const est = avg * sqft

  const spread =
    usable.length >= 5 ? 0.08 :
    usable.length >= 3 ? 0.12 :
    0.2

  return {
    estimated: est,
    low: est * (1 - spread),
    high: est * (1 + spread),
    comparables: usable.length,
    radius,
  }
}

// ------------------ MAIN ------------------

export async function getValuation(params: ValuationParams) {
  const { lat, lon, propertyCategory, floorAreaSqm, landSizeSqm } = params

  const { data, error } = await fetchRows(params.propertyType, propertyCategory)

  if (error || !data) return null

  const cleaned = cleanRows(data as TransactionRow[], lat, lon)
  if (!cleaned.length) return null

  const radii = getSearchRadius(propertyCategory)

  let best: CandidateResult | null = null

  for (const r of radii) {
    const nearby = cleaned.filter((row) => row.distanceM <= r)

    let candidate: CandidateResult | null = null

    if (propertyCategory === 'landed') {
      if (!landSizeSqm) continue
      candidate = buildLanded(nearby, landSizeSqm, r)
    } else {
      candidate = buildCondo(nearby, floorAreaSqm, r)
    }

    if (!candidate) continue

    if (!best || candidate.comparables > best.comparables) {
      best = candidate
    }
  }

  return best
}