export function rankComparables(
  rows: Array<{
    address: string | null
    street_name?: string | null
    project_name?: string | null
    transaction_date: string | null
    transaction_price: number
    floor_area_sqm: number
    latitude: number
    longitude: number
    unit_type?: string | null
    distance_m: number
  }>,
  subject: {
    address: string
    street_name?: string | null
    project_name?: string | null
    floor_area_sqm: number
    propertyCategory: 'hdb' | 'condo' | 'landed'
  }
) {
  const buckets: Record<number, typeof rows> = {
    1: [],
    2: [],
    3: [],
    4: [],
    5: [],
    6: [],
  }

  for (const row of rows) {
    const sizeBand = getSizeBand(subject.floor_area_sqm, row.floor_area_sqm)

    let bucket = 6

    // ===== HDB LOGIC =====
    if (subject.propertyCategory === 'hdb') {
      const sameBlock = isSameHdbBlock(
        subject.address,
        subject.street_name,
        row.address,
        row.street_name
      )

      if (sameBlock && sizeBand === 'same') bucket = 1
      else if (sameBlock && sizeBand === 'similar') bucket = 2
      else if (!sameBlock && sizeBand === 'same') bucket = 3
      else if (!sameBlock && sizeBand === 'similar') bucket = 4
      else continue // ignore bad matches
    }

    // ===== CONDO / EC LOGIC =====
    if (subject.propertyCategory === 'condo') {
      const sameProject = isSameProject(subject.project_name, row.project_name)

      if (sameProject && sizeBand === 'same') bucket = 1
      else if (sameProject && sizeBand === 'similar') bucket = 2
      else if (sameProject && sizeBand === 'different') bucket = 3
      else if (!sameProject && sizeBand === 'same') bucket = 4
      else if (!sameProject && sizeBand === 'similar') bucket = 5
      else bucket = 6
    }

    // landed will be added later

    buckets[bucket].push(row)
  }

  // sort inside each bucket
  const sortFn = (a: typeof rows[number], b: typeof rows[number]) => {
    const dateA = a.transaction_date ? new Date(a.transaction_date).getTime() : 0
    const dateB = b.transaction_date ? new Date(b.transaction_date).getTime() : 0

    if (a.distance_m !== b.distance_m) {
      return a.distance_m - b.distance_m
    }

    return dateB - dateA
  }

  const result: typeof rows = []

  for (let i = 1; i <= 6; i++) {
    const sorted = buckets[i].sort(sortFn)
    result.push(...sorted)
  }

  return result.slice(0, 10)
}
