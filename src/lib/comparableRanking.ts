function normalizeText(value: string | null | undefined) {
  return (value || '').toUpperCase().replace(/\s+/g, ' ').trim()
}

function normalizeStreetName(streetName: string | null | undefined) {
  return normalizeText(streetName)
    .replace(/\bBUKIT\b/g, 'BT')
    .replace(/\bMOUNT\b/g, 'MT')
    .replace(/\bSAINT\b/g, 'ST')
    .replace(/\bAVENUE\b/g, 'AVE')
    .replace(/\bSTREET\b/g, 'ST')
    .replace(/\bROAD\b/g, 'RD')
    .replace(/\bDRIVE\b/g, 'DR')
    .replace(/\bCRESCENT\b/g, 'CRES')
    .replace(/\bPLACE\b/g, 'PL')
    .replace(/\bCLOSE\b/g, 'CL')
    .replace(/\bLANE\b/g, 'LN')
    .replace(/\bTERRACE\b/g, 'TER')
    .replace(/\bBOULEVARD\b/g, 'BLVD')
    .replace(/\bCENTRAL\b/g, 'CTRL')
    .replace(/\bHEIGHTS\b/g, 'HTS')
    .replace(/\bGARDENS\b/g, 'GDNS')
    .replace(/\bNORTH\b/g, 'NTH')
    .replace(/\bSOUTH\b/g, 'STH')
    .replace(/\bEAST\b/g, 'EST')
    .replace(/\bWEST\b/g, 'WEST')
    .replace(/\s+/g, ' ')
    .trim()
}

function normalizeProjectName(projectName: string | null | undefined) {
  return normalizeText(projectName)
    .replace(/[^\w\s]/g, ' ')
    .replace(/\bEXECUTIVE CONDOMINIUM\b/g, 'EC')
    .replace(/\bCONDOMINIUM\b/g, 'CONDO')
    .replace(/\bAPARTMENTS\b/g, 'APT')
    .replace(/\bAPARTMENT\b/g, 'APT')
    .replace(/\s+/g, ' ')
    .trim()
}

function extractHdbBlock(address: string | null | undefined) {
  const text = normalizeText(address)
  if (!text) return ''

  const match = text.match(/^(\d+[A-Z]?)\b/)
  return match ? match[1] : ''
}

function extractStreetFromAddress(address: string | null | undefined) {
  const text = normalizeText(address)
  if (!text) return ''

  return text.replace(/^(\d+[A-Z]?)\s+/, '').trim()
}

function getEffectiveStreet(
  streetName: string | null | undefined,
  address: string | null | undefined
) {
  const direct = normalizeStreetName(streetName)
  if (direct) return direct

  const fromAddress = extractStreetFromAddress(address)
  return normalizeStreetName(fromAddress)
}

function getEffectiveProject(
  projectName: string | null | undefined,
  address: string | null | undefined
) {
  const direct = normalizeProjectName(projectName)
  if (direct) return direct

  return normalizeProjectName(address)
}

function isSameHdbBlock(
  subjectAddress: string | null | undefined,
  subjectStreetName: string | null | undefined,
  rowAddress: string | null | undefined,
  rowStreetName: string | null | undefined
) {
  const subjectBlock = extractHdbBlock(subjectAddress)
  const rowBlock = extractHdbBlock(rowAddress)

  const subjectStreet = getEffectiveStreet(subjectStreetName, subjectAddress)
  const rowStreet = getEffectiveStreet(rowStreetName, rowAddress)

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
  subjectAddress: string | null | undefined,
  rowProjectName: string | null | undefined,
  rowAddress: string | null | undefined
) {
  const subject = getEffectiveProject(subjectProjectName, subjectAddress)
  const row = getEffectiveProject(rowProjectName, rowAddress)

  return !!subject && !!row && subject === row
}

function isSameLandedStreet(
  subjectStreetName: string | null | undefined,
  subjectAddress: string | null | undefined,
  rowStreetName: string | null | undefined,
  rowAddress: string | null | undefined
) {
  const subjectStreet = getEffectiveStreet(subjectStreetName, subjectAddress)
  const rowStreet = getEffectiveStreet(rowStreetName, rowAddress)

  return !!subjectStreet && !!rowStreet && subjectStreet === rowStreet
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
      const sameProject = isSameProject(
        subject.project_name,
        subject.address,
        row.project_name,
        row.address
      )

      if (sameProject && sizeBand === 'same') bucket = 1
      else if (sameProject && sizeBand === 'similar') bucket = 2
      else if (sameProject && sizeBand === 'different') bucket = 3
      else if (!sameProject && sizeBand === 'same') bucket = 4
      else if (!sameProject && sizeBand === 'similar') bucket = 5
      else if (!sameProject && sizeBand === 'different') bucket = 6
    }

    if (subject.propertyCategory === 'landed') {
      const sameStreet = isSameLandedStreet(
        subject.street_name,
        subject.address,
        row.street_name,
        row.address
      )

      if (sameStreet && sizeBand === 'same') bucket = 1
      else if (sameStreet && sizeBand === 'similar') bucket = 2
      else if (!sameStreet && sizeBand === 'same') bucket = 3
      else if (!sameStreet && sizeBand === 'similar') bucket = 4
      else continue
    }

    buckets[bucket].push(row)
  }

  return Object.entries(buckets)
    .sort((a, b) => Number(a[0]) - Number(b[0]))
    .flatMap(([, bucketRows]) =>
      bucketRows.sort((a, b) => {
        if (a.distance_m !== b.distance_m) return a.distance_m - b.distance_m

        const dateA = a.transaction_date ? new Date(a.transaction_date).getTime() : 0
        const dateB = b.transaction_date ? new Date(b.transaction_date).getTime() : 0

        return dateB - dateA
      })
    )
}
