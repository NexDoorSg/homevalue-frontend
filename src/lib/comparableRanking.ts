function normalizeText(value: string | null | undefined) {
  return (value || '').toUpperCase().trim()
}

function extractHdbBlock(address: string | null | undefined) {
  const text = normalizeText(address)
  if (!text) return ''

  const match = text.match(/^(\d+[A-Z]?)\b/)
  return match ? match[1] : ''
}

function normalizeStreetName(streetName: string | null | undefined) {
  return normalizeText(streetName)
}

function isSameHdbBlock(
  subjectAddress: string | null | undefined,
  subjectStreetName: string | null | undefined,
  rowAddress: string | null | undefined,
  rowStreetName: string | null | undefined
) {
  const subjectBlock = extractHdbBlock(subjectAddress)
  const rowBlock = extractHdbBlock(rowAddress)

  const subjectStreet = normalizeStreetName(subjectStreetName)
  const rowStreet = normalizeStreetName(rowStreetName)

  return (
    !!subjectBlock &&
    !!rowBlock &&
    !!subjectStreet &&
    !!rowStreet &&
    subjectBlock === rowBlock &&
    subjectStreet === rowStreet
  )
}

function isSameProject(
  subjectProjectName: string | null | undefined,
  rowProjectName: string | null | undefined
) {
  const subject = normalizeText(subjectProjectName)
  const row = normalizeText(rowProjectName)

  return !!subject && !!row && subject === row
}

function getSizeBand(subjectSqm: number, rowSqm: number) {
  if (!subjectSqm || !rowSqm) return 'different'

  const diffRatio = Math.abs(rowSqm - subjectSqm) / subjectSqm

  if (diffRatio <= 0.05) return 'same'
  if (diffRatio <= 0.15) return 'similar'
  return 'different'
}

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
    psf: number
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
      else continue
    }

    if (subject.propertyCategory === 'condo') {
      const sameProject = isSameProject(subject.project_name, row.project_name)

      if (sameProject && sizeBand === 'same') bucket = 1
      else if (sameProject && sizeBand === 'similar') bucket = 2
      else if (sameProject && sizeBand === 'different') bucket = 3
      else if (!sameProject && sizeBand === 'same') bucket = 4
      else if (!sameProject && sizeBand === 'similar') bucket = 5
      else if (!sameProject && sizeBand === 'different') bucket = 6
    }

    if (subject.propertyCategory === 'landed') {
      const sameStreet = normalizeStreetName(subject.street_name) === normalizeStreetName(row.street_name)

      if (sameStreet && sizeBand === 'same') bucket = 1
      else if (sameStreet && sizeBand === 'similar') bucket = 2
      else if (!sameStreet && sizeBand === 'same') bucket = 3
      else if (!sameStreet && sizeBand === 'similar') bucket = 4
      else continue
    }

    buckets[bucket].push(row)
  }

  const sortedRows = Object.entries(buckets)
    .sort((a, b) => Number(a[0]) - Number(b[0]))
    .flatMap(([, bucketRows]) =>
      bucketRows.sort((a, b) => {
        const dateA = a.transaction_date ? new Date(a.transaction_date).getTime() : 0
        const dateB = b.transaction_date ? new Date(b.transaction_date).getTime() : 0

        if (dateB !== dateA) return dateB - dateA
        return a.distance_m - b.distance_m
      })
    )

  return sortedRows
}
