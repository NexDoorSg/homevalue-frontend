'use client'

import { useRef, useState } from 'react'
import { getValuation } from '@/lib/valuation'
import { supabase } from '@/lib/supabase'

type OneMapResult = {
  ADDRESS: string
  LATITUDE: string
  LONGITUDE: string
  POSTAL?: string
  BLK_NO?: string
  ROAD_NAME?: string
  BUILDING?: string
}

type PropertyTypeOption = {
  label: string
  value: string
  category: 'hdb' | 'condo' | 'ec' | 'landed'
}

type ComparableRow = {
  address: string | null
  street_name?: string | null
  project_name?: string | null
  transaction_date: string | null
  transaction_price: number | string | null
  floor_area_sqm: number | string | null
  latitude: number | string | null
  longitude: number | string | null
  unit_type?: string | null
  floor_level?: string | null
  tenure?: string | null
  property_group?: string | null
  property_subtype?: string | null
  is_strata?: boolean | null
}

const PROPERTY_TYPE_OPTIONS: PropertyTypeOption[] = [
  { label: 'HDB 2 Room', value: '2 ROOM', category: 'hdb' },
  { label: 'HDB 3 Room', value: '3 ROOM', category: 'hdb' },
  { label: 'HDB 4 Room', value: '4 ROOM', category: 'hdb' },
  { label: 'HDB 5 Room', value: '5 ROOM', category: 'hdb' },
  { label: 'HDB Executive', value: 'EXECUTIVE', category: 'hdb' },

  { label: 'Condo 1 Bedroom', value: '1 BEDROOM', category: 'condo' },
  { label: 'Condo 2 Bedroom', value: '2 BEDROOM', category: 'condo' },
  { label: 'Condo 3 Bedroom', value: '3 BEDROOM', category: 'condo' },
  { label: 'Condo 4 Bedroom', value: '4 BEDROOM', category: 'condo' },
  { label: 'Condo 5 Bedroom', value: '5 BEDROOM', category: 'condo' },
  { label: 'Condo Penthouse', value: 'PENTHOUSE', category: 'condo' },

  { label: 'EC 2 Bedroom', value: '2 BEDROOM EC', category: 'ec' },
  { label: 'EC 3 Bedroom', value: '3 BEDROOM EC', category: 'ec' },
  { label: 'EC 4 Bedroom', value: '4 BEDROOM EC', category: 'ec' },
  { label: 'EC 5 Bedroom', value: '5 BEDROOM EC', category: 'ec' },

  { label: 'Terrace', value: 'TERRACE HOUSE', category: 'landed' },
  { label: 'Semi-D', value: 'SEMI-DETACHED HOUSE', category: 'landed' },
  { label: 'Detached', value: 'DETACHED HOUSE', category: 'landed' },
]

const TENURE_OPTIONS = [
  { label: 'Freehold / 999-year', value: 'FREEHOLD' },
  { label: '99-year leasehold', value: '99-YEAR' },
  { label: '999-year leasehold', value: '999-YEAR' },
  { label: 'Other leasehold', value: 'OTHER' },
]

function getPropertyCategoryFromType(
  propertyType: string
): 'hdb' | 'condo' | 'ec' | 'landed' {
  const normalized = propertyType.toUpperCase().trim()

  if (!normalized) return 'condo'

  const hdbTypes = ['2 ROOM', '3 ROOM', '4 ROOM', '5 ROOM', 'EXECUTIVE']
  const ecTypes = ['2 BEDROOM EC', '3 BEDROOM EC', '4 BEDROOM EC', '5 BEDROOM EC']
  const landedTypes = [
    'TERRACE HOUSE',
    'SEMI-DETACHED HOUSE',
    'DETACHED HOUSE',
  ]

  if (hdbTypes.includes(normalized)) return 'hdb'
  if (ecTypes.includes(normalized)) return 'ec'
  if (landedTypes.includes(normalized)) return 'landed'
  return 'condo'
}

function cleanAddress(value: string) {
  return value
    .toUpperCase()
    .replace(/\bSINGAPORE\s+\d{6}\b/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function abbreviateRoadWords(value: string) {
  return value
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
    .replace(/\bNORTH\b/g, 'NTH')
    .replace(/\bSOUTH\b/g, 'STH')
    .replace(/\bGARDENS\b/g, 'GDNS')
    .replace(/\bINDUSTRIAL PARK\b/g, 'IND PK')
    .replace(/\s+/g, ' ')
    .trim()
}

function buildLookupCandidates(item: OneMapResult) {
  const candidates = new Set<string>()

  const rawAddress = cleanAddress(item.ADDRESS || '')
  if (rawAddress) {
    candidates.add(rawAddress)
    candidates.add(abbreviateRoadWords(rawAddress))
  }

  const blockRoad = cleanAddress(
    `${item.BLK_NO || ''} ${item.ROAD_NAME || ''}`.trim()
  )
  if (blockRoad) {
    candidates.add(blockRoad)
    candidates.add(abbreviateRoadWords(blockRoad))
  }

  const building = cleanAddress(item.BUILDING || '')
  if (building && building !== 'NIL') {
    candidates.add(building)
  }

  return Array.from(candidates).filter(Boolean)
}

function formatMoney(value: number | null) {
  if (!value) return '$5XX,XXX'
  return `$${Math.round(value).toLocaleString()}`
}

function sqftToSqm(value: string) {
  const num = Number(value)
  if (!num || num <= 0) return ''
  return (num / 10.7639).toFixed(2)
}

function sqmToSqft(value: number | string | null) {
  const num = Number(value)
  if (!num || num <= 0) return ''
  return Math.round(num * 10.7639).toString()
}

function formatTeaserMoney(value: number | null) {
  if (!value) return '$4XX,XXX'

  const rounded = Math.round(value).toLocaleString()
  let seenFirstDigit = false

  const masked = rounded
    .split('')
    .map((char) => {
      if (!/\d/.test(char)) return char
      if (!seenFirstDigit) {
        seenFirstDigit = true
        return char
      }
      return 'X'
    })
    .join('')

  return `$${masked}`
}

function formatDate(value: string | null) {
  if (!value) return '-'

  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return value

  return parsed.toLocaleDateString('en-SG', {
    month: 'short',
    year: 'numeric',
  })
}

function formatTenure(value: string | null | undefined) {
  if (!value) return '-'
  const v = value.trim()
  // Extract lease duration and commencement year
  const match = v.match(/^(\d+)\s*yrs?\s*lease\s*commencing\s*from\s*(\d{4})/i)
  if (match) {
    const yrs = Number(match[1])
    const from = match[2]
    if (yrs >= 900) return `999-yr (from ${from})`
    return `${yrs}-yr (from ${from})`
  }
  // No commencement year variants
  if (/freehold/i.test(v)) return 'Freehold'
  if (/9999/i.test(v)) return 'Freehold'
  if (/999\s*years/i.test(v)) return '999-yr'
  if (/99\s*years/i.test(v)) return '99-yr'
  return 'Leasehold'
}

function isValidPhone(value: string) {
  const trimmed = value.trim()
  // International number with country code (starts with + or 00)
  if (trimmed.startsWith('+') || trimmed.startsWith('00')) {
    const digits = trimmed.replace(/\D/g, '')
    return digits.length >= 10 && digits.length <= 15
  }
  // Local number — exactly 8 digits
  const digits = trimmed.replace(/\D/g, '')
  return digits.length === 8
}

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())
}

// ─── Haversine-based distance (accurate for Singapore's latitude) ──────────
function getDistanceMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
) {
  const toRad = (deg: number) => (deg * Math.PI) / 180
  const R = 6371000 // Earth radius in metres
  const dLat = toRad(lat2 - lat1)
  const dLon = toRad(lon2 - lon1)
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2)
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

async function resolveCanonicalProjectName(params: {
  lat: number
  lon: number
  address: string
  streetName?: string | null
  rawProjectName?: string | null
  category: 'condo' | 'ec' | 'landed'
}) {
  const { lat, lon, address, streetName, rawProjectName, category } = params

  const normalize = (value: string | null | undefined) =>
    (value || '').toUpperCase().replace(/\s+/g, ' ').trim()

  const subjectStreet = abbreviateRoadWords(normalize(streetName))
  const subjectBlock =
    normalize(address).match(/^(\d+[A-Z]?)\b/)?.[1] || ''
  const rawProjectKey = normalize(rawProjectName)

  const LAT_DELTA = 0.003
  const LON_DELTA = 0.003

  let query = supabase
    .from('property_transactions_v2')
    .select('project_name, street_name, address, latitude, longitude, completion_year, is_strata')
    .not('project_name', 'is', null)
    .not('latitude', 'is', null)
    .not('longitude', 'is', null)
    .gte('latitude', lat - LAT_DELTA)
    .lte('latitude', lat + LAT_DELTA)
    .gte('longitude', lon - LON_DELTA)
    .lte('longitude', lon + LON_DELTA)
    .limit(200)

  if (category === 'condo') {
    query = query.eq('property_subtype', 'condo')
  } else if (category === 'ec') {
    query = query.eq('property_subtype', 'ec')
  } else {
    query = query.in('property_subtype', ['landed_strata', 'landed_non_strata'])
  }

  const { data, error } = await query

  if (error || !data || data.length === 0) {
    return {
      canonicalProjectName: rawProjectKey || null,
      completionYear: null as number | null,
      isStrata: null as boolean | null,
    }
  }

  const rows = data.map((row) => {
    const rowProject = normalize(row.project_name)
    const rowStreet = abbreviateRoadWords(normalize(row.street_name))
    const rowBlock = normalize(row.address).match(/^(\d+[A-Z]?)\b/)?.[1] || ''

    return {
      project_name: rowProject,
      street_name: rowStreet,
      address: normalize(row.address),
      completion_year: row.completion_year ? Number(row.completion_year) : null,
      is_strata: row.is_strata ?? null,
      sameStreet: !!rowStreet && !!subjectStreet && rowStreet === subjectStreet,
      sameBlock:
        !!rowStreet &&
        !!subjectStreet &&
        rowStreet === subjectStreet &&
        !!rowBlock &&
        !!subjectBlock &&
        rowBlock === subjectBlock,
      exactRawMatch: !!rowProject && !!rawProjectKey && rowProject === rawProjectKey,
      fuzzyRawMatch:
        !!rowProject &&
        !!rawProjectKey &&
        (rowProject.includes(rawProjectKey) || rawProjectKey.includes(rowProject)),
    }
  })

  const countProjects = (
    input: Array<{
      project_name: string
      completion_year: number | null
      is_strata: boolean | null
    }>
  ) => {
    const counts = new Map<
      string,
      { count: number; completionYear: number | null; isStrata: boolean | null }
    >()

    for (const row of input) {
      if (!row.project_name) continue

      const existing = counts.get(row.project_name)
      if (existing) {
        existing.count += 1
      } else {
        counts.set(row.project_name, {
          count: 1,
          completionYear: row.completion_year,
          isStrata: row.is_strata,
        })
      }
    }

    let bestProject: string | null = null
    let bestCount = 0
    let bestCompletionYear: number | null = null
    let bestIsStrata: boolean | null = null

    for (const [project, info] of counts.entries()) {
      if (info.count > bestCount) {
        bestProject = project
        bestCount = info.count
        bestCompletionYear = info.completionYear
        bestIsStrata = info.isStrata
      }
    }

    return {
      canonicalProjectName: bestProject,
      completionYear: bestCompletionYear,
      isStrata: bestIsStrata,
    }
  }

  const sameBlockRows = rows.filter((row) => row.sameBlock)
  if (sameBlockRows.length > 0) {
    return countProjects(sameBlockRows)
  }

  const exactRawRows = rows.filter((row) => row.exactRawMatch)
  if (exactRawRows.length > 0) {
    return countProjects(exactRawRows)
  }

  const fuzzyRawRows = rows.filter((row) => row.fuzzyRawMatch)
  if (fuzzyRawRows.length > 0) {
    return countProjects(fuzzyRawRows)
  }

  const sameStreetRows = rows.filter((row) => row.sameStreet)
  if (sameStreetRows.length > 0) {
    return countProjects(sameStreetRows)
  }

  return {
    canonicalProjectName: rawProjectKey || null,
    completionYear: null as number | null,
    isStrata: null as boolean | null,
  }
}

type EmailResult = {
  ok: boolean
  error?: string
}

export default function Home() {
  const [address, setAddress] = useState('')
  const [floorLevel, setFloorLevel] = useState('')
  const [stackNumber, setStackNumber] = useState('')
  const [propertyType, setPropertyType] = useState('')
  const [floorAreaSqm, setFloorAreaSqm] = useState('')
  const [landSizeSqm, setLandSizeSqm] = useState('')
  const [builtUpSqm, setBuiltUpSqm] = useState('')
  const [tenure, setTenure] = useState('FREEHOLD')

  const [suggestions, setSuggestions] = useState<OneMapResult[]>([])
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [selectedLat, setSelectedLat] = useState<number | null>(null)
  const [selectedLon, setSelectedLon] = useState<number | null>(null)
  const [selectedStreetName, setSelectedStreetName] = useState<string | null>(null)
  const [selectedProjectName, setSelectedProjectName] = useState<string | null>(null)
  const [lookupCandidates, setLookupCandidates] = useState<string[]>([])

  const [estimatedPrice, setEstimatedPrice] = useState<number | null>(null)
  const [estimatedLow, setEstimatedLow] = useState<number | null>(null)
  const [estimatedHigh, setEstimatedHigh] = useState<number | null>(null)
  const [numOfComps, setNumOfComps] = useState<number | null>(null)
  const [radiusUsedM, setRadiusUsedM] = useState<number | null>(null)
  const [recentComparables, setRecentComparables] = useState<
    Array<{
      transaction_date: string | null
      address: string | null
      street_name?: string | null
      project_name?: string | null
      floor_level?: string | null
      floor_area_sqm: number
      transaction_price: number
      unit_type?: string | null
      tenure?: string | null
      psf: number
      distance_m: number
    }>
  >([])

  const [isGenerating, setIsGenerating] = useState(false)
  const [formMessage, setFormMessage] = useState('')

  const [activeTab, setActiveTab] = useState<'same' | 'nearby'>('same')

  const [leadFormMessage, setLeadFormMessage] = useState('')
  const [hasReport, setHasReport] = useState(false)

  const [leadName, setLeadName] = useState('')
  const [leadPhone, setLeadPhone] = useState('')
  const [leadEmail, setLeadEmail] = useState('')
  const [showConsultationModal, setShowConsultationModal] = useState(false)
  const [consultName, setConsultName] = useState('')
  const [consultPhone, setConsultPhone] = useState('')
  const [consultEmail, setConsultEmail] = useState('')
  const [consultPlan, setConsultPlan] = useState('')
  const [consultationMessage, setConsultationMessage] = useState('')

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const resultRef = useRef<HTMLDivElement | null>(null)
  const propertyCategory = getPropertyCategoryFromType(propertyType)
  const showFloorRangeColumn =
    propertyCategory === 'hdb' &&
    recentComparables.some(
      (row) => row.floor_level && row.floor_level.trim() !== ''
    )

  const selectedProjectKey = (selectedProjectName || '').toUpperCase().trim()

  const inferredSameProjectName =
    propertyCategory === 'condo' || propertyCategory === 'ec'
      ? (() => {
          const subjectStreet = abbreviateRoadWords(
            (selectedStreetName || '').toUpperCase().trim()
          )
          const subjectBlock =
            (address || '').toUpperCase().trim().match(/^(\d+[A-Z]?)\b/)?.[1] || ''
  
          const sameBlockRows = recentComparables.filter((row) => {
            const rowProject = (row.project_name || '').toUpperCase().trim()
            const rowStreet = abbreviateRoadWords(
              (row.street_name || '').toUpperCase().trim()
            )
            const rowBlock =
              (row.address || '').toUpperCase().trim().match(/^(\d+[A-Z]?)\b/)?.[1] || ''
  
            return (
              rowProject &&
              rowStreet &&
              subjectStreet &&
              rowStreet === subjectStreet &&
              rowBlock &&
              subjectBlock &&
              rowBlock === subjectBlock
            )
          })
  
          const countProjects = (rows: typeof recentComparables) => {
            const counts = new Map<string, number>()
            for (const row of rows) {
              const project = (row.project_name || '').toUpperCase().trim()
              if (!project) continue
              counts.set(project, (counts.get(project) || 0) + 1)
            }
  
            let bestProject = ''
            let bestCount = 0
            for (const [project, count] of counts.entries()) {
              if (count > bestCount) {
                bestProject = project
                bestCount = count
              }
            }
            return bestProject
          }
  
          const fromSameBlock = countProjects(sameBlockRows)
          if (fromSameBlock) return fromSameBlock
  
          const exactRows = recentComparables.filter((row) => {
            const rowProject = (row.project_name || '').toUpperCase().trim()
            return rowProject && selectedProjectKey && rowProject === selectedProjectKey
          })
          if (exactRows.length > 0) return selectedProjectKey
  
          const fuzzyRows = recentComparables.filter((row) => {
            const rowProject = (row.project_name || '').toUpperCase().trim()
            return (
              rowProject &&
              selectedProjectKey &&
              (rowProject.includes(selectedProjectKey) ||
                selectedProjectKey.includes(rowProject))
            )
          })
  
          const fromFuzzy = countProjects(fuzzyRows)
          if (fromFuzzy) return fromFuzzy
  
          return selectedProjectKey
        })()
      : ''
  
  const sameProjectComparables = recentComparables.filter((row) => {
    const rowProject = (row.project_name || '').toUpperCase().trim()
    return rowProject && inferredSameProjectName && rowProject === inferredSameProjectName
  })
  
  const nearbyCondoComparables = recentComparables.filter((row) => {
    const rowProject = (row.project_name || '').toUpperCase().trim()
    return !(rowProject && inferredSameProjectName && rowProject === inferredSameProjectName)
  })

  const sameBlockComparables = recentComparables.filter((row) => {
    const rowStreet = abbreviateRoadWords((row.street_name || '').toUpperCase().trim())
    const subjStreet = abbreviateRoadWords((selectedStreetName || '').toUpperCase().trim())
    const rowBlock = (row.address || '').toUpperCase().trim().match(/^(\d+[A-Z]?)\b/)?.[1] || ''
    const subjBlock = (address || '').toUpperCase().trim().match(/^(\d+[A-Z]?)\b/)?.[1] || ''
    return rowStreet && subjStreet && rowStreet === subjStreet && rowBlock && subjBlock && rowBlock === subjBlock
  })

  const nearbyHdbComparables = recentComparables.filter((row) => {
    const rowStreet = abbreviateRoadWords((row.street_name || '').toUpperCase().trim())
    const subjStreet = abbreviateRoadWords((selectedStreetName || '').toUpperCase().trim())
    const rowBlock = (row.address || '').toUpperCase().trim().match(/^(\d+[A-Z]?)\b/)?.[1] || ''
    const subjBlock = (address || '').toUpperCase().trim().match(/^(\d+[A-Z]?)\b/)?.[1] || ''
    return !(rowStreet && subjStreet && rowStreet === subjStreet && rowBlock && subjBlock && rowBlock === subjBlock)
  })
  
  const searchAddress = async (value: string) => {
    if (value.trim().length < 3) {
      setSuggestions([])
      setShowSuggestions(false)
      return
    }

    try {
      const res = await fetch(
        `https://www.onemap.gov.sg/api/common/elastic/search?searchVal=${encodeURIComponent(
          value
        )}&returnGeom=Y&getAddrDetails=Y&pageNum=1`
      )

      const data = await res.json()
      const results = (data?.results || []) as OneMapResult[]

      setSuggestions(results.slice(0, 8))
      setShowSuggestions(true)
    } catch (error) {
      console.error('Address search error:', error)
      setSuggestions([])
      setShowSuggestions(false)
    }
  }

  const resetResults = () => {
    setFormMessage('')
    setEstimatedPrice(null)
    setEstimatedLow(null)
    setEstimatedHigh(null)
    setNumOfComps(null)
    setRadiusUsedM(null)
    setRecentComparables([])
  }

  const handleAddressChange = (value: string) => {
    setAddress(value)
    setSelectedLat(null)
    setSelectedLon(null)
    setSelectedStreetName(null)
    setSelectedProjectName(null)
    setLookupCandidates([])
    resetResults()

    if (debounceRef.current) {
      clearTimeout(debounceRef.current)
    }

    debounceRef.current = setTimeout(() => {
      searchAddress(value)
    }, 300)
  }

  const handleSelectAddress = (item: OneMapResult) => {
    setAddress(item.ADDRESS)
    setSelectedLat(Number(item.LATITUDE))
    setSelectedLon(Number(item.LONGITUDE))
    setSelectedStreetName(item.ROAD_NAME ? item.ROAD_NAME.toUpperCase().trim() : null)
    setSelectedProjectName(
      item.BUILDING && item.BUILDING !== 'NIL'
        ? item.BUILDING.toUpperCase().trim()
        : null
    )
    
    setLookupCandidates(buildLookupCandidates(item))
    resetResults()
  
    setSuggestions([])
    setShowSuggestions(false)
  }

  const resolveAddressForGeneration = async () => {
  if (selectedLat && selectedLon) {
    return {
      lat: selectedLat,
      lon: selectedLon,
      address: address,
      streetName: selectedStreetName,
      projectName: selectedProjectName,
      lookupCandidates,
    }
  }

  if (!address.trim()) {
    return null
  }

  try {
    const res = await fetch(
      `https://www.onemap.gov.sg/api/common/elastic/search?searchVal=${encodeURIComponent(
        address
      )}&returnGeom=Y&getAddrDetails=Y&pageNum=1`
    )
    const data = await res.json()
    const results = (data?.results || []) as OneMapResult[]

    if (!results.length) return null

    const exactMatch = results.find(
      (item) => cleanAddress(item.ADDRESS || '') === cleanAddress(address)
    )

    const chosen = exactMatch || results[0]
    const lat = Number(chosen.LATITUDE)
    const lon = Number(chosen.LONGITUDE)

    const resolvedStreetName = chosen.ROAD_NAME ? chosen.ROAD_NAME.toUpperCase().trim() : null
    const resolvedProjectName =
      chosen.BUILDING && chosen.BUILDING !== 'NIL'
        ? chosen.BUILDING.toUpperCase().trim()
        : null
    const resolvedLookupCandidates = buildLookupCandidates(chosen)
    
    setSelectedLat(lat)
    setSelectedLon(lon)
    setSelectedStreetName(resolvedStreetName)
    setSelectedProjectName(resolvedProjectName)
    setLookupCandidates(resolvedLookupCandidates)
    setAddress(chosen.ADDRESS)
    
    return {
      lat,
      lon,
      address: chosen.ADDRESS,
      streetName: resolvedStreetName,
      projectName: resolvedProjectName,
      lookupCandidates: resolvedLookupCandidates,
    }
  } catch (error) {
    console.error('Failed to resolve address for generation:', error)
    return null
  }
}

  const handleGenerateReport = async () => {
    setFormMessage('')
    setRecentComparables([])
  
    if (!address.trim()) {
      setFormMessage('Please enter an address first.')
      return
    }
  
    if (!propertyType) {
      setFormMessage('Please choose a property type first.')
      return
    }
  
    if (propertyCategory !== 'landed' && !stackNumber.trim()) {
      setFormMessage('Please enter your stack number.')
      return
    }
  
    if (propertyCategory === 'landed') {
      if (!landSizeSqm || Number(landSizeSqm) <= 0) {
        setFormMessage('Please enter a valid land size first.')
        return
      }
  
      if (!builtUpSqm || Number(builtUpSqm) <= 0) {
        setFormMessage('Please enter a valid built-up size first.')
        return
      }
  
      if (!tenure) {
        setFormMessage('Please choose the tenure first.')
        return
      }
    } else {
      if (!floorAreaSqm || Number(floorAreaSqm) <= 0) {
        setFormMessage('Please enter a valid floor area first.')
        return
      }
    }
  
    if (!leadName.trim()) {
      setFormMessage('Please enter your name.')
      return
    }
  
    if (!leadPhone.trim()) {
      setFormMessage('Please enter your phone number.')
      return
    }
  
    if (!isValidPhone(leadPhone)) {
      setFormMessage('Please enter a valid phone number.')
      return
    }
  
    if (!leadEmail.trim()) {
      setFormMessage('Please enter your email.')
      return
    }
  
    if (!isValidEmail(leadEmail)) {
      setFormMessage('Please enter a valid email address.')
      return
    }
  
    setIsGenerating(true)
  
    try {
      const resolved = await resolveAddressForGeneration()
  
      if (!resolved) {
        setFormMessage('Could not match this address. Please choose an address from the dropdown.')
        return
      }
  
      let resolvedProjectName = resolved.projectName || null
      let subjectCompletionYear: number | null = null
      let subjectIsStrata: boolean | null = null
  
      if (
        propertyCategory === 'condo' ||
        propertyCategory === 'ec' ||
        propertyCategory === 'landed'
      ) {
        const canonical = await resolveCanonicalProjectName({
          lat: resolved.lat,
          lon: resolved.lon,
          address: resolved.address,
          streetName: resolved.streetName,
          rawProjectName: resolved.projectName,
          category: propertyCategory,
        })
  
        resolvedProjectName = canonical.canonicalProjectName || resolvedProjectName
        subjectCompletionYear = canonical.completionYear
        subjectIsStrata = canonical.isStrata
      }
  
      const result = await getValuation({
        lat: resolved.lat,
        lon: resolved.lon,
        floorAreaSqm:
          propertyCategory === 'landed'
            ? Number(sqftToSqm(builtUpSqm))
            : Number(sqftToSqm(floorAreaSqm)),
        landSizeSqm:
          propertyCategory === 'landed'
            ? Number(sqftToSqm(landSizeSqm))
            : undefined,
        builtUpSqm:
          propertyCategory === 'landed'
            ? Number(sqftToSqm(builtUpSqm))
            : undefined,
        tenure: propertyCategory === 'landed' ? tenure : undefined,
        floorLevel: Number(floorLevel) || undefined,
        propertyType,
        propertyCategory,
        subjectProjectName: resolvedProjectName,
        subjectCompletionYear: subjectCompletionYear,
        subjectIsStrata: subjectIsStrata,
      })
  
      if (!result) {
        setEstimatedPrice(null)
        setEstimatedLow(null)
        setEstimatedHigh(null)
        setNumOfComps(null)
        setRadiusUsedM(null)
        setFormMessage('Not enough comparable transactions found for this property yet.')
        setHasReport(false)
        return
      }
  
      setEstimatedPrice(result.estimated)
      setEstimatedLow(result.low)
      setEstimatedHigh(result.high)
      setNumOfComps(result.comparables)
      setRadiusUsedM(result.radius)
      setHasReport(true)
  
      const comparables = await fetchRecentComparables(
        resolved.lat,
        resolved.lon,
        propertyType,
        propertyCategory,
        result.radius
      )
  
      setRecentComparables(comparables)
  
      setTimeout(() => {
        resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }, 200)
    } catch (err) {
      console.error(err)
      setFormMessage('Error generating valuation.')
    } finally {
      setIsGenerating(false)
    }
  }

  const hasPropertyContext = () => {
    return Boolean(
      address.trim() ||
        floorLevel.trim() ||
        stackNumber.trim() ||
        floorAreaSqm.trim() ||
        landSizeSqm.trim() ||
        builtUpSqm.trim() ||
        selectedLat ||
        selectedLon
    )
  }

  const buildLeadPayload = (
    name: string,
    phone: string,
    email: string,
    extra?: { plan?: string | null }
  ) => {
    const fullUnitNumber =
      floorLevel.trim() && stackNumber.trim()
        ? `#${floorLevel.trim()}-${stackNumber.trim()}`
        : null

    const propertyContextExists = hasPropertyContext()
    const normalizedEmail = email.trim().toLowerCase()

    return {
      name: name.trim(),
      phone: phone.trim(),
      email: normalizedEmail,
      address: propertyContextExists ? address.trim() || null : null,
      unit_number: propertyContextExists ? fullUnitNumber : null,
      unit_type: propertyContextExists ? propertyType || null : null,
      floor_area_sqm:
        propertyContextExists
          ? propertyCategory === 'landed'
            ? Number(sqftToSqm(builtUpSqm)) || null
            : Number(sqftToSqm(floorAreaSqm)) || null
          : null,
      tenure: propertyContextExists && propertyCategory === 'landed' ? tenure : null,
      plan: extra?.plan ?? null,
    }
  }

  const sendLeadEmail = async (
    payload: Record<string, unknown>
  ): Promise<EmailResult> => {
    try {
      const response = await fetch('/api/send-lead', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      const result = await response.json().catch(() => null)

      if (!response.ok) {
        console.error('send-lead API failed:', result)
        return {
          ok: false,
          error: result?.error || 'Email API failed',
        }
      }

      return { ok: true }
    } catch (error) {
      console.error('send-lead fetch failed:', error)
      return {
        ok: false,
        error: 'Could not reach email API',
      }
    }
  }

  const handleConsultationSubmit = async () => {
    setConsultationMessage('')

    if (!consultName.trim()) {
      setConsultationMessage('Please enter your name.')
      return
    }

    if (!consultPhone.trim()) {
      setConsultationMessage('Please enter your phone number.')
      return
    }

    if (!isValidPhone(consultPhone)) {
      setConsultationMessage('Please enter a valid phone number.')
      return
    }

    if (!consultEmail.trim()) {
      setConsultationMessage('Please enter your email.')
      return
    }

    if (!isValidEmail(consultEmail)) {
      setConsultationMessage('Please enter a valid email address.')
      return
    }

    if (!consultPlan.trim()) {
      setConsultationMessage('Please tell us your plan.')
      return
    }

    const leadPayload = buildLeadPayload(consultName, consultPhone, consultEmail, {
      plan: consultPlan.trim(),
    })

    const { error } = await supabase.from('leads').insert([leadPayload])

    if (error) {
      console.error('Consultation lead save error:', error)
      setConsultationMessage('Could not save your details right now. Please try again.')
      return
    }

    const emailResult = await sendLeadEmail({
      ...leadPayload,
      source: 'consultation',
    })

    if (!emailResult.ok) {
      setConsultationMessage(
        'Lead saved, but email notification failed. Check Vercel logs.'
      )
    } else {
      setConsultationMessage('Thanks — we will contact you shortly.')
    }

    setConsultName('')
    setConsultPhone('')
    setConsultEmail('')
    setConsultPlan('')
  }

  const handleLeadSubmit = async () => {
    setLeadFormMessage('')

    if (!leadName.trim()) {
      setLeadFormMessage('Please enter your name.')
      return
    }

    if (!leadPhone.trim()) {
      setLeadFormMessage('Please enter your phone number.')
      return
    }

    if (!isValidPhone(leadPhone)) {
      setLeadFormMessage('Please enter a valid phone number.')
      return
    }

    if (!leadEmail.trim()) {
      setLeadFormMessage('Please enter your email.')
      return
    }

    if (!isValidEmail(leadEmail)) {
      setLeadFormMessage('Please enter a valid email address.')
      return
    }

    const leadPayload = {
      ...buildLeadPayload(leadName, leadPhone, leadEmail),
      estimated_price: estimatedPrice,
      estimated_low: estimatedLow,
      estimated_high: estimatedHigh,
      comparables_count: numOfComps,
      radius_used_m: radiusUsedM,
      source: 'valuation',
    }

    const { error } = await supabase.from('leads').insert([leadPayload])

    if (error) {
      console.error('Valuation lead save error:', error)
      setLeadFormMessage('Could not save your details right now. Please try again.')
      return
    }

    const emailResult = await sendLeadEmail(leadPayload)

    if (!emailResult.ok) {
      setLeadFormMessage('Details saved, but email notification failed. Check Vercel logs.')
      return
    }

    setLeadFormMessage('Thanks — we will contact you shortly.')
    setLeadName('')
    setLeadPhone('')
    setLeadEmail('')
  }

  const fetchRecentComparables = async (
    lat: number,
    lon: number,
    targetPropertyType: string,
    category: 'hdb' | 'condo' | 'ec' | 'landed',
    preferredRadius?: number
  ) => {
    function normalizeText(value: string | null | undefined) {
      return (value || '').toUpperCase().replace(/\s+/g, ' ').trim()
    }
  
    function normalizeStreet(value: string | null | undefined) {
      return normalizeText(value)
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
        .replace(/\bEAST\b/g, 'EAST')
        .replace(/\bWEST\b/g, 'WEST')
        .replace(/\s+/g, ' ')
        .trim()
    }
  
    function normalizeProject(value: string | null | undefined) {
      return normalizeText(value)
        .replace(/[^\w\s]/g, ' ')
        .replace(/\bEXECUTIVE CONDOMINIUM\b/g, 'EC')
        .replace(/\bCONDOMINIUM\b/g, 'CONDO')
        .replace(/\bAPARTMENTS\b/g, 'APT')
        .replace(/\bAPARTMENT\b/g, 'APT')
        .replace(/\s+/g, ' ')
        .trim()
    }
  
    function extractBlock(value: string | null | undefined) {
      const text = normalizeText(value)
      const match = text.match(/^(\d+[A-Z]?)\b/)
      return match ? match[1] : ''
    }
  
    function extractStreetFromAddress(value: string | null | undefined) {
      const text = normalizeText(value)
      if (!text) return ''
      return text
        .replace(/\bSINGAPORE\s+\d{6}\b/g, '')  // strip "SINGAPORE 309073"
        .replace(/^(\d+[A-Z]?)\s+/, '')
        .trim()
    }
  
    function getEffectiveStreet(
      streetName: string | null | undefined,
      addressValue: string | null | undefined
    ) {
      const direct = normalizeStreet(streetName)
      if (direct) return direct
      return normalizeStreet(extractStreetFromAddress(addressValue))
    }
  
    function getEffectiveProject(
      projectName: string | null | undefined,
      addressValue: string | null | undefined
    ) {
      const direct = normalizeProject(projectName)
      if (direct) return direct
      return normalizeProject(addressValue)
    }

    // ─── REDESIGNED getLandedCluster ───────────────────────────────────────────
    // Extracts the geographic "family name" from a street, stripping road-type
    // suffixes (AVE, RD, DR, etc.) and directional words (NTH, STH, etc.).
    // 
    // Examples after normalizeStreet:
    //   "GOLDHILL AVE"    → "GOLDHILL"
    //   "GOLDHILL RISE"   → "GOLDHILL"   (RISE is a suffix)
    //   "GOLDHILL VIEW"   → "GOLDHILL"   (VIEW is a suffix)
    //   "CHANCERY LN"     → "CHANCERY"
    //   "CHANCERY HILL DR"→ "CHANCERY HILL"
    //   "MT SINAI DR"     → "MT SINAI"
    //   "JALAN LIMAU"     → "JALAN LIMAU" (no suffix to strip)
    //
    // This is generic — no hardcoded street names. Works for any landed area.
    function getLandedCluster(
      streetName: string | null | undefined,
      addressValue: string | null | undefined
    ) {
      const street = getEffectiveStreet(streetName, addressValue)
      if (!street) return ''

      // Road-type and directional suffixes to strip (applied AFTER normalizeStreet)
      const SUFFIXES = new Set([
        'AVE', 'ST', 'RD', 'DR', 'CRES', 'PL', 'CL', 'LN', 'TER', 'BLVD',
        'CTRL', 'HTS', 'GDNS', 'NTH', 'STH', 'EAST', 'WEST',
        // Additional common Singapore road suffixes
        'RISE', 'VIEW', 'WALK', 'GROVE', 'PARK', 'HILL', 'VALE', 'GREEN',
        'GARDEN', 'LINK', 'WAY', 'LOOP', 'RING', 'TURN', 'MOUNT',
        // Numbering suffixes (e.g. "LORONG 1" → "LORONG")
        '1', '2', '3', '4', '5', '6', '7', '8', '9', '10',
        '11', '12', '13', '14', '15', '16', '17', '18', '19', '20',
      ])

      const parts = street.split(' ')

      // Strip suffixes from the end, but keep at least the first word
      let endIndex = parts.length
      while (endIndex > 1 && SUFFIXES.has(parts[endIndex - 1])) {
        endIndex--
      }

      const cluster = parts.slice(0, endIndex).join(' ')

      // Only return meaningful clusters (3+ chars avoids "MT", "ST", "BT" alone)
      return cluster.length >= 3 ? cluster : ''
    }
  
    function getSizeBand(subjectSqm: number, rowSqm: number) {
      if (!subjectSqm || !rowSqm) return 'different'
      const diffRatio = Math.abs(rowSqm - subjectSqm) / subjectSqm
      if (diffRatio <= 0.05) return 'same'
      if (diffRatio <= 0.15) return 'similar'
      return 'different'
    }
  
    function escapeForOr(value: string) {
      return value.replace(/,/g, '').trim()
    }
    
    function sortByLatestDateThenDistance<
      T extends { transaction_date: string | null; distance_m: number }
    >(rows: T[]) {
      return [...rows].sort((a, b) => {
        const dateA = a.transaction_date ? new Date(a.transaction_date).getTime() : 0
        const dateB = b.transaction_date ? new Date(b.transaction_date).getTime() : 0
    
        if (dateB !== dateA) return dateB - dateA
        return a.distance_m - b.distance_m
      })
    }
    
    const subjectFloorAreaSqm =
      category === 'landed'
        ? Number(sqftToSqm(landSizeSqm || builtUpSqm))
        : Number(sqftToSqm(floorAreaSqm))
  
    const subjectStreet = getEffectiveStreet(selectedStreetName, address)
    const subjectProject = getEffectiveProject(selectedProjectName, address)
    const subjectBlock = extractBlock(address)
    const subjectCluster = getLandedCluster(selectedStreetName, address)
    const normalizedAddress = normalizeText(address)
  
    let query = supabase
      .from('property_transactions_v2')
      .select(
        'address, street_name, project_name, transaction_date, transaction_price, floor_area_sqm, latitude, longitude, unit_type, floor_level, tenure, property_group, property_subtype, is_strata'
      )
      .not('transaction_price', 'is', null)
      .not('floor_area_sqm', 'is', null)
      .not('latitude', 'is', null)
      .not('longitude', 'is', null)
    
    if (category === 'hdb') {
      query = query.eq('property_group', 'hdb')
    }
    
    if (category === 'condo') {
      query = query.eq('property_subtype', 'condo')
    }
    
    if (category === 'ec') {
      query = query.eq('property_subtype', 'ec')
    }
    
    if (category === 'landed') {
      query = query.in('property_subtype', ['landed_strata', 'landed_non_strata'])
    }
  
    if (category === 'hdb') {
      const LAT_DELTA = 0.018  // ~2km
      const LON_DELTA = 0.018
      query = query
        .eq('unit_type', targetPropertyType)
        .gte('latitude', lat - LAT_DELTA)
        .lte('latitude', lat + LAT_DELTA)
        .gte('longitude', lon - LON_DELTA)
        .lte('longitude', lon + LON_DELTA)
        .order('transaction_date', { ascending: false })
        .limit(5000)
    }
  
    if (category === 'condo' || category === 'ec') {
      const LAT_DELTA = 0.014  // ~1.5km in latitude degrees
      const LON_DELTA = 0.014  // ~1.5km in longitude degrees
      query = query
        .gte('latitude', lat - LAT_DELTA)
        .lte('latitude', lat + LAT_DELTA)
        .gte('longitude', lon - LON_DELTA)
        .lte('longitude', lon + LON_DELTA)
        .order('transaction_date', { ascending: false })
        .limit(3000)
    }
  
    if (category === 'landed') {
      query = query
        .or(
          [
            'unit_type.ilike.%TERRACE%',
            'unit_type.ilike.%SEMI%',
            'unit_type.ilike.%DETACHED%',
            'unit_type.ilike.%BUNGALOW%',
          ].join(',')
        )
        .limit(8000)
    }
  
    const { data, error } = await query
  
    if (error) {
      console.error('Comparable fetch error:', error)
      return []
    }
  
    const cleaned = ((data || []) as ComparableRow[])
      .map((row) => {
        const transactionPrice = Number(row.transaction_price)
        const floorArea = Number(row.floor_area_sqm)
        const rowLat = Number(row.latitude)
        const rowLon = Number(row.longitude)
        const floorAreaSqft = floorArea * 10.7639
  
        return {
          address: row.address,
          street_name: row.street_name || null,
          project_name: row.project_name || null,
          transaction_date: row.transaction_date,
          transaction_price: transactionPrice,
          floor_area_sqm: floorArea,
          latitude: rowLat,
          longitude: rowLon,
          unit_type: row.unit_type || null,
          floor_level: row.floor_level || null,
          tenure: (row as ComparableRow & { tenure?: string | null }).tenure || null,
          distance_m: getDistanceMeters(lat, lon, rowLat, rowLon),
          psf: floorAreaSqft > 0 ? transactionPrice / floorAreaSqft : 0,
        }
      })
      .filter(
        (row) =>
          Number.isFinite(row.transaction_price) &&
          row.transaction_price > 0 &&
          Number.isFinite(row.floor_area_sqm) &&
          row.floor_area_sqm > 0 &&
          Number.isFinite(row.latitude) &&
          Number.isFinite(row.longitude)
      )
  
    const withNormalized = cleaned.map((row) => ({
      ...row,
      _normStreet: getEffectiveStreet(row.street_name, row.address),
      _normProject: getEffectiveProject(row.project_name, row.address),
      _block: extractBlock(row.address),
      _cluster: getLandedCluster(row.street_name, row.address),
      _sizeBand: getSizeBand(subjectFloorAreaSqm, row.floor_area_sqm),
    }))
  
    if (category === 'hdb') {
      // Fetch same-block rows separately with no distance/size filter
      const subjStreetForQuery = abbreviateRoadWords((selectedStreetName || '').toUpperCase().trim())
      const subjBlockForQuery = (address || '').toUpperCase().trim().match(/^(\d+[A-Z]?)\b/)?.[1] || ''

      let sameBlockQuery = supabase
        .from('property_transactions_v2')
        .select('address, street_name, project_name, transaction_date, transaction_price, floor_area_sqm, latitude, longitude, unit_type, floor_level, tenure')
        .eq('property_group', 'hdb')
        .eq('unit_type', targetPropertyType)
        .not('transaction_price', 'is', null)
        .not('floor_area_sqm', 'is', null)
        .not('latitude', 'is', null)
        .not('longitude', 'is', null)
        .order('transaction_date', { ascending: false })
        .limit(20)

      if (subjStreetForQuery && subjBlockForQuery) {
        sameBlockQuery = sameBlockQuery.ilike('address', `${subjBlockForQuery} ${subjStreetForQuery}%`)
      }

      const { data: sameBlockData } = (subjStreetForQuery && subjBlockForQuery)
        ? await sameBlockQuery
        : { data: [] }

      const sameBlockRows = ((sameBlockData || []) as ComparableRow[])
        .map((row) => {
          const transactionPrice = Number(row.transaction_price)
          const floorArea = Number(row.floor_area_sqm)
          const rowLat = Number(row.latitude)
          const rowLon = Number(row.longitude)
          const floorAreaSqft = floorArea * 10.7639
          return {
            address: row.address,
            street_name: row.street_name || null,
            project_name: row.project_name || null,
            transaction_date: row.transaction_date,
            transaction_price: transactionPrice,
            floor_area_sqm: floorArea,
            latitude: rowLat,
            longitude: rowLon,
            unit_type: row.unit_type || null,
            floor_level: row.floor_level || null,
            tenure: (row as ComparableRow & { tenure?: string | null }).tenure || null,
            distance_m: getDistanceMeters(lat, lon, rowLat, rowLon),
            psf: floorAreaSqft > 0 ? transactionPrice / floorAreaSqft : 0,
          }
        })
        .filter(
          (row) =>
            Number.isFinite(row.transaction_price) &&
            row.transaction_price > 0 &&
            Number.isFinite(row.floor_area_sqm) &&
            row.floor_area_sqm > 0
        )
        .slice(0, 10)

      // Nearby: use bounding box pool, exclude same block, sort by priority then date
      const nearbyHdbRows = withNormalized
        .map((row) => {
          const sameStreet = !!row._normStreet && row._normStreet === subjectStreet
          const sameBlock =
            sameStreet &&
            !!row._block &&
            !!subjectBlock &&
            row._block === subjectBlock

          // Exclude same-block rows — they're handled separately
          if (sameBlock) return null

          let priority = 999
          if (sameStreet && row._sizeBand === 'same') priority = 1
          else if (sameStreet && row._sizeBand === 'similar') priority = 2
          else if (sameStreet) priority = 3
          else if (row.distance_m <= 500 && row._sizeBand === 'same') priority = 4
          else if (row.distance_m <= 500 && row._sizeBand === 'similar') priority = 5
          else if (row.distance_m <= 500) priority = 6
          else if (row.distance_m <= 1200 && row._sizeBand === 'same') priority = 7
          else if (row.distance_m <= 1200 && row._sizeBand === 'similar') priority = 8
          else if (row.distance_m <= 1200) priority = 9
          else if (row.distance_m <= 2000 && row._sizeBand === 'same') priority = 10
          else if (row.distance_m <= 2000 && row._sizeBand === 'similar') priority = 11
          else if (row.distance_m <= 2000) priority = 12

          return { ...row, _priority: priority }
        })
        .filter((row): row is NonNullable<typeof row> => row !== null && row._priority < 999)
        .sort((a, b) => {
          if (a._priority !== b._priority) return a._priority - b._priority
          const dateA = a.transaction_date ? new Date(a.transaction_date).getTime() : 0
          const dateB = b.transaction_date ? new Date(b.transaction_date).getTime() : 0
          if (dateB !== dateA) return dateB - dateA
          return a.distance_m - b.distance_m
        })
        .slice(0, 10)

      return [...sameBlockRows, ...nearbyHdbRows]
    }
  
    if (category === 'condo' || category === 'ec') {
      const subjectCondoSqm = Number(sqftToSqm(floorAreaSqm)) || 0
    
      const selectedProjectKey = (selectedProjectName || '').toUpperCase().trim()
    
      const countProjects = (
        rows: Array<
          typeof withNormalized[number]
        >
      ) => {
        const counts = new Map<string, number>()
        for (const row of rows) {
          const project = (row.project_name || '').toUpperCase().trim()
          if (!project) continue
          counts.set(project, (counts.get(project) || 0) + 1)
        }
    
        let bestProject = ''
        let bestCount = 0
        for (const [project, count] of counts.entries()) {
          if (count > bestCount) {
            bestProject = project
            bestCount = count
          }
        }
        return bestProject
      }
    
      const sameBlockRowsForInference = withNormalized.filter((row) => {
        const rowProject = (row.project_name || '').toUpperCase().trim()
        return (
          rowProject &&
          row._normStreet &&
          subjectStreet &&
          row._normStreet === subjectStreet &&
          row._block &&
          subjectBlock &&
          row._block === subjectBlock
        )
      })
    
      const exactMatchRowsForInference = withNormalized.filter((row) => {
        const rowProject = (row.project_name || '').toUpperCase().trim()
        return rowProject && selectedProjectKey && rowProject === selectedProjectKey
      })
    
      const fuzzyMatchRowsForInference = withNormalized.filter((row) => {
        const rowProject = (row.project_name || '').toUpperCase().trim()
        return (
          rowProject &&
          selectedProjectKey &&
          (rowProject.includes(selectedProjectKey) ||
            selectedProjectKey.includes(rowProject))
        )
      })
    
      const sameProjectName =
        countProjects(sameBlockRowsForInference) ||
        (exactMatchRowsForInference.length > 0 ? selectedProjectKey : '') ||
        countProjects(fuzzyMatchRowsForInference) ||
        selectedProjectKey
    
      let sameProjectQuery = supabase
        .from('property_transactions_v2')
        .select('address, street_name, project_name, transaction_date, transaction_price, floor_area_sqm, latitude, longitude, unit_type, floor_level, tenure')
        .eq('property_subtype', category === 'ec' ? 'ec' : 'condo')
        .not('transaction_price', 'is', null)
        .not('floor_area_sqm', 'is', null)
        .not('latitude', 'is', null)
        .not('longitude', 'is', null)
        .order('transaction_date', { ascending: false })
        .limit(20)
    
      if (sameProjectName) {
        sameProjectQuery = sameProjectQuery.ilike('project_name', sameProjectName)
      }
    
      const { data: sameProjectData } = sameProjectName
        ? await sameProjectQuery
        : { data: [] }

      const sameProjectRows = ((sameProjectData || []) as ComparableRow[])
        .map((row) => {
          const transactionPrice = Number(row.transaction_price)
          const floorArea = Number(row.floor_area_sqm)
          const rowLat = Number(row.latitude)
          const rowLon = Number(row.longitude)
          const floorAreaSqft = floorArea * 10.7639
          return {
            address: row.address,
            street_name: row.street_name || null,
            project_name: row.project_name || null,
            transaction_date: row.transaction_date,
            transaction_price: transactionPrice,
            floor_area_sqm: floorArea,
            latitude: rowLat,
            longitude: rowLon,
            unit_type: row.unit_type || null,
            floor_level: row.floor_level || null,
            tenure: (row as ComparableRow & { tenure?: string | null }).tenure || null,
            distance_m: getDistanceMeters(lat, lon, rowLat, rowLon),
            psf: floorAreaSqft > 0 ? transactionPrice / floorAreaSqft : 0,
          }
        })
        .filter(
          (row) =>
            Number.isFinite(row.transaction_price) &&
            row.transaction_price > 0 &&
            Number.isFinite(row.floor_area_sqm) &&
            row.floor_area_sqm > 0
        )
        .slice(0, 10)

      // Nearby: use the bounding-box pool, exclude same project, cap at 2 per project
      function condoFilter(distanceM: number, lowerRatio: number, upperRatio: number) {
        return withNormalized.filter((row) => {
          if (row.distance_m > distanceM) return false
          if (subjectCondoSqm > 0 && row.floor_area_sqm > 0) {
            if (row.floor_area_sqm < subjectCondoSqm * lowerRatio) return false
            if (row.floor_area_sqm > subjectCondoSqm * upperRatio) return false
          }
          return true
        })
      }

      let nearbyPool = condoFilter(1500, 0.5, 1.5)
      if (nearbyPool.length < 10) nearbyPool = condoFilter(1500, 0.25, 2.0)
      if (nearbyPool.length < 10) nearbyPool = condoFilter(2500, 0.25, 2.0)

      const seen = new Set<string>()
      const deduped = nearbyPool.filter((row) => {
        const key = `${row.address}|${row.transaction_date}|${row.transaction_price}`
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })

      deduped.sort((a, b) => {
        const dateA = a.transaction_date ? new Date(a.transaction_date).getTime() : 0
        const dateB = b.transaction_date ? new Date(b.transaction_date).getTime() : 0
        if (dateB !== dateA) return dateB - dateA
        return a.distance_m - b.distance_m
      })

      const projectCounts: Record<string, number> = {}
      const nearbyRows = []
      for (const row of deduped) {
        if (sameProjectName && (row.project_name || '').toUpperCase().trim() === sameProjectName) continue
        const proj = row._normProject || ''
        const count = projectCounts[proj] || 0
        if (count < 2) {
          nearbyRows.push(row)
          projectCounts[proj] = count + 1
        }
        if (nearbyRows.length >= 10) break
      }

      return [...sameProjectRows, ...nearbyRows]
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // LANDED: Redesigned 2-stage scoring system
    // ═══════════════════════════════════════════════════════════════════════════
    //
    // Design principles:
    //   1. Same street is the DOMINANT signal — always appears first
    //   2. Same cluster (e.g. GOLDHILL AVE / GOLDHILL RISE) is the second signal
    //   3. Distance matters but does NOT overpower street/cluster
    //   4. Size is a tiebreaker only — nothing is excluded by size
    //   5. Recency is a tiebreaker — recent is better, but not at the cost of
    //      pulling in a random far-away street over a nearby cluster match
    //   6. Hard cap at 5km — anything further is not a comparable
    //   7. ONE sort produces the final order — no manual array concatenation
    //
    // Score breakdown (lower = more relevant):
    //   Tier (0-300):     same-street=0, same-cluster=100, other=200
    //   Distance (0-50):  continuous, capped at 5km
    //   Size (0-6):       same=0, similar=3, different=6
    //   Recency (0-15):   0.3 per month old, capped at 15
    //
    // The tier gap (100 points) is deliberately large so that a same-street row
    // 3km away (score ~0+30+6+10 = 46) always beats a non-cluster row 200m away
    // (score ~200+2+0+0 = 202). This matches how a real agent thinks.
    // ═══════════════════════════════════════════════════════════════════════════

    if (category === 'landed') {
      // ── Debug: log subject values to verify in browser console ──
      console.log('[LANDED DEBUG] selectedStreetName:', selectedStreetName)
      console.log('[LANDED DEBUG] address:', address)
      console.log('[LANDED DEBUG] subjectStreet:', subjectStreet)
      console.log('[LANDED DEBUG] subjectCluster:', subjectCluster)

      // Stage 1: Filter to landed unit types only
      const landedOnly = withNormalized.filter((row) => {
        const unitType = normalizeText(row.unit_type)
        return (
          unitType.includes('TERRACE') ||
          unitType.includes('SEMI') ||
          unitType.includes('DETACHED') ||
          unitType.includes('BUNGALOW')
        )
      })

      console.log('[LANDED DEBUG] landedOnly count:', landedOnly.length)

      // Deduplicate (same address + date + price = same transaction)
      const seen = new Set<string>()
      const deduped = landedOnly.filter((row) => {
        const key = `${row.address}|${row.transaction_date}|${row.transaction_price}`
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })

      // Adaptive filtering: lower bound on size only (no upper bound),
      // with fallback passes if pool is too small.
      const subjectLandSqm = Number(sqftToSqm(landSizeSqm)) || 0
      console.log('[LANDED DEBUG] subjectLandSqm:', subjectLandSqm, 'from landSizeSqm:', landSizeSqm)

      // Same-street rows always included regardless of size
      const sameStreetRows = deduped.filter(
        (row) => row._normStreet && subjectStreet && row._normStreet === subjectStreet
      )

      function applyFilter(distanceM: number) {
        return deduped.filter((row) => {
          if (row.distance_m > distanceM) return false
          return true
        })
      }

      // Pass 1: 1500m
      let withinRange = applyFilter(1500)

      // Pass 2: 2500m
      if (withinRange.length < 8) {
        withinRange = applyFilter(2500)
      }
      
      // Ensure same-street rows are always in the pool
      const withinRangeKeys = new Set(withinRange.map(r => `${r.address}|${r.transaction_date}|${r.transaction_price}`))
      for (const row of sameStreetRows) {
        const key = `${row.address}|${row.transaction_date}|${row.transaction_price}`
        if (!withinRangeKeys.has(key)) {
          withinRange.push(row)
          withinRangeKeys.add(key)
        }
      }

      console.log('[LANDED DEBUG] withinRange count:', withinRange.length)

      // ── Debug: check for Goldhill rows specifically ──
      const goldhillCheck = withinRange.filter(
        (r) =>
          (r._normStreet || '').includes('GOLDHILL') ||
          (r.address || '').toUpperCase().includes('GOLDHILL')
      )
      console.log('[LANDED DEBUG] Goldhill rows in range:', goldhillCheck.length)
      goldhillCheck.forEach((r) => {
        console.log(
          '[LANDED DEBUG] Goldhill row:',
          r._normStreet,
          '| row cluster:', r._cluster,
          '| subject cluster:', subjectCluster,
          '| cluster match:', r._cluster === subjectCluster,
          '| dist:', Math.round(r.distance_m) + 'm'
        )
      })

      const now = Date.now()

      // Extract subject first word for fallback cluster matching
      // e.g. "GOLDHILL" from "GOLDHILL AVE"
      const subjectFirstWord = (subjectStreet || '').split(' ')[0] || ''

      const scored = withinRange.map((row) => {
        // ── TIER: The primary grouping signal ──
        const sameStreet =
          !!row._normStreet &&
          !!subjectStreet &&
          row._normStreet === subjectStreet

        // Primary cluster match (via getLandedCluster suffix-stripping)
        const clusterMatch =
          !sameStreet &&
          !!row._cluster &&
          !!subjectCluster &&
          row._cluster.length >= 3 &&
          subjectCluster.length >= 3 &&
          row._cluster === subjectCluster

        // Fallback cluster match: compare first word of street name
        // Catches cases where suffix stripping produces different results
        // e.g. "GOLDHILL" from "GOLDHILL AVE" matches "GOLDHILL" from "GOLDHILL VIEW"
        const rowFirstWord = (row._normStreet || '').split(' ')[0] || ''
        const firstWordMatch =
          !sameStreet &&
          !clusterMatch &&
          rowFirstWord.length >= 4 &&
          subjectFirstWord.length >= 4 &&
          rowFirstWord === subjectFirstWord

        const sameCluster = clusterMatch || firstWordMatch

        let tierScore: number
        if (sameStreet) tierScore = 0
        else if (sameCluster) tierScore = 100
        else tierScore = 200

        // ── DISTANCE: 10 points per km, capped at 50 ──
        const distanceScore = Math.min(
          Math.round((row.distance_m / 1000) * 10),
          50
        )

        // ── SIZE: Tiebreaker only (0-6 points) ──
        const sizeScore =
          row._sizeBand === 'same' ? 0 : row._sizeBand === 'similar' ? 3 : 6

        // ── RECENCY: Tiebreaker only (0-15 points) ──
        const txTime = row.transaction_date
          ? new Date(row.transaction_date).getTime()
          : 0
        const monthsAgo =
          txTime > 0 ? (now - txTime) / (1000 * 60 * 60 * 24 * 30) : 50
        const recencyScore = Math.min(Math.round(monthsAgo * 0.3), 15)

        const totalScore = tierScore + distanceScore + sizeScore + recencyScore

        return { ...row, _totalScore: totalScore, _tierScore: tierScore }
      })

      // ── SORT: tier-aware ordering ──
      // Tier 0 (same street) and Tier 100 (same cluster): date desc → distance asc
      //   Contextually relevant rows — recency is the primary signal.
      // Tier 200 (nearby): date desc → distance asc as tiebreaker
      //   Homeowner wants to see what the market is doing RIGHT NOW.
      //   A Mar 2026 transaction at 857m is more useful than Oct 2025 at 248m.
      //   Distance is used only to break ties within the same month.
      scored.sort((a, b) => {
        const dateA = a.transaction_date ? new Date(a.transaction_date).getTime() : 0
        const dateB = b.transaction_date ? new Date(b.transaction_date).getTime() : 0
        if (dateB !== dateA) return dateB - dateA
        return a.distance_m - b.distance_m
      })

      // ── Debug: log final ranked results ──
      scored.slice(0, 15).forEach((r, i) => {
        console.log(
          `[LANDED COMP ${i + 1}]`,
          r.address || r._normStreet,
          '| tier:', r._tierScore,
          '| score:', r._totalScore,
          '| dist:', Math.round(r.distance_m) + 'm',
          '| cluster:', r._cluster,
          '| date:', r.transaction_date
        )
      })

      return scored.slice(0, 15)
    }
  
    return []
  }

  return (
    <main className="min-h-screen bg-[#f7f4ef] text-[#2f3438]">
      <header className="border-b border-[#e8ddd2] bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-3 md:px-10">
          <div
            className="text-3xl tracking-tight text-black md:text-4xl"
            style={{ fontFamily: '"Frank Ruehl BT", Georgia, "Times New Roman", serif' }}
          >
            NexDoor.
          </div>

          <button
            type="button"
            onClick={() => setShowConsultationModal(true)}
            className="rounded-full bg-[#2f3438] px-6 py-3 text-sm font-semibold text-white shadow-[0_12px_24px_rgba(47,52,56,0.18)] transition hover:bg-[#24292d]"
          >
            Free Consultation
          </button>
        </div>
      </header>

      <section className="relative overflow-hidden">
        <div className="absolute left-[-120px] top-[-80px] h-72 w-72 rounded-full bg-[#d8c0a8]/20 blur-3xl" />
        <div className="absolute right-[-80px] top-[60px] h-80 w-80 rounded-full bg-[#36454f]/10 blur-3xl" />

        <div className="mx-auto grid max-w-7xl grid-cols-1 gap-14 px-6 py-12 md:px-10 lg:grid-cols-[1.05fr_0.95fr] lg:items-start lg:py-20">
          <div className="order-1 pt-4 lg:order-1">
            <div className="inline-flex rounded-full border border-[#dcc8b5] bg-white px-4 py-2 text-sm font-medium text-[#8b6b52] shadow-sm">
              HomeValue by NexDoor
            </div>

            <h1 className="mt-4 max-w-4xl text-4xl font-semibold leading-tight tracking-tight text-[#2d3135] md:text-6xl">
              See What Your Home Is Worth Today
            </h1>

            <p className="mt-5 max-w-2xl text-base leading-7 text-[#616971] md:text-lg">
              Instantly estimate your property&apos;s value using real nearby transactions.
            </p>

            <div className="mt-6 flex flex-wrap gap-2">
              <div className="rounded-full border border-[#e8ddd2] bg-white px-4 py-2 text-xs font-medium text-[#2d3135] shadow-sm">
                30 sec estimate
              </div>
              <div className="rounded-full border border-[#e8ddd2] bg-white px-4 py-2 text-xs font-medium text-[#2d3135] shadow-sm">
                2026 transaction data
              </div>
              <div className="rounded-full border border-[#e8ddd2] bg-white px-4 py-2 text-xs font-medium text-[#2d3135] shadow-sm">
                Real nearby comps
              </div>
            </div>
          </div>
          
          <div className="order-2 relative lg:order-2">
            <div className="rounded-[28px] border border-[#e3d6c8] bg-white/95 p-6 shadow-[0_24px_70px_rgba(37,42,46,0.10)] backdrop-blur md:p-8">
              <div className="mb-6">
                <h2 className="text-2xl font-semibold text-[#2d3135]">
                  See Your Estimated Value Instantly
                </h2>
                <p className="mt-2 text-sm leading-6 text-[#67707a]">
                  Enter your property details to get a quick estimate based on nearby 2026 transactions.
                </p>
              </div>

              <div className="grid gap-4">
                <div className="relative">
                  <label className="mb-2 block text-sm font-medium text-[#4d555d]">
                    Full address
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. 419 Woodlands Street 41"
                    value={address}
                    onChange={(e) => handleAddressChange(e.target.value)}
                    className="w-full rounded-2xl border border-[#d7dde3] bg-[#fcfcfb] px-4 py-3 text-[#2d3135] outline-none transition focus:border-[#8b6b52] focus:bg-white"
                  />

                  {showSuggestions && suggestions.length > 0 && (
                    <div className="absolute z-30 mt-2 max-h-72 w-full overflow-y-auto rounded-2xl border border-[#ddd3c7] bg-white shadow-[0_14px_40px_rgba(37,42,46,0.12)]">
                      {suggestions.map((item, index) => (
                        <button
                          key={`${item.ADDRESS}-${index}`}
                          type="button"
                          onClick={() => handleSelectAddress(item)}
                          className="block w-full border-b border-[#f1ebe4] px-4 py-3 text-left text-sm text-[#2d3135] hover:bg-[#f8f4ef] last:border-b-0"
                        >
                          <div className="font-medium">{item.ADDRESS}</div>
                          {item.POSTAL && (
                            <div className="mt-1 text-xs text-[#7a8289]">
                              Singapore {item.POSTAL}
                            </div>
                          )}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {selectedLat && selectedLon && (
                  <p className="text-sm font-medium text-green-600">
                    Address matched successfully.
                  </p>
                )}
                
                <div>
                  <label className="mb-2 block text-sm font-medium text-[#4d555d]">
                    Property type
                  </label>
                  <select
                    value={propertyType}
                    onChange={(e) => setPropertyType(e.target.value)}
                    className="w-full rounded-2xl border border-[#d7dde3] bg-[#fcfcfb] px-4 py-3 text-[#2d3135] outline-none transition focus:border-[#8b6b52] focus:bg-white"
                  >
                    <option value="" disabled>
                      e.g. Select property type
                    </option>
                    {PROPERTY_TYPE_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
                
                {propertyCategory !== 'landed' && (
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="mb-2 block text-sm font-medium text-[#4d555d]">
                        Floor level
                      </label>
                      <input
                        type="text"
                        placeholder="e.g. 11"
                        value={floorLevel}
                        onChange={(e) => setFloorLevel(e.target.value)}
                        className="w-full rounded-2xl border border-[#d7dde3] bg-[#fcfcfb] px-4 py-3 text-[#2d3135] outline-none transition focus:border-[#8b6b52] focus:bg-white"
                      />
                    </div>
                    <div>
                      <label className="mb-2 block text-sm font-medium text-[#4d555d]">
                        Stack number
                      </label>
                      <input
                        type="text"
                        placeholder="e.g. 389"
                        value={stackNumber}
                        onChange={(e) => setStackNumber(e.target.value)}
                        className="w-full rounded-2xl border border-[#d7dde3] bg-[#fcfcfb] px-4 py-3 text-[#2d3135] outline-none transition focus:border-[#8b6b52] focus:bg-white"
                      />
                    </div>
                  </div>
                )}

                {propertyCategory === 'landed' ? (
                  <>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="mb-2 block text-sm font-medium text-[#4d555d]">
                          Land size (sqft)
                        </label>
                        <input
                          type="number"
                          placeholder="e.g. 3200"
                          value={landSizeSqm}
                          onChange={(e) => setLandSizeSqm(e.target.value)}
                          className="w-full rounded-2xl border border-[#d7dde3] bg-[#fcfcfb] px-4 py-3 text-[#2d3135] outline-none transition focus:border-[#8b6b52] focus:bg-white"
                        />
                      </div>
                
                      <div>
                        <label className="mb-2 block text-sm font-medium text-[#4d555d]">
                          Built-up size (sqft)
                        </label>
                        <input
                          type="number"
                          placeholder="e.g. 4500"
                          value={builtUpSqm}
                          onChange={(e) => setBuiltUpSqm(e.target.value)}
                          className="w-full rounded-2xl border border-[#d7dde3] bg-[#fcfcfb] px-4 py-3 text-[#2d3135] outline-none transition focus:border-[#8b6b52] focus:bg-white"
                        />
                      </div>
                    </div>
                
                    <div>
                      <label className="mb-2 block text-sm font-medium text-[#4d555d]">
                        Tenure
                      </label>
                      <select
                        value={tenure}
                        onChange={(e) => setTenure(e.target.value)}
                        className="w-full rounded-2xl border border-[#d7dde3] bg-[#fcfcfb] px-4 py-3 text-[#2d3135] outline-none transition focus:border-[#8b6b52] focus:bg-white"
                      >
                        {TENURE_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  </>
                ) : (
                  <div>
                    <label className="mb-2 block text-sm font-medium text-[#4d555d]">
                      Floor area (sqft)
                    </label>
                    <input
                      type="number"
                      placeholder="e.g. 990"
                      value={floorAreaSqm}
                      onChange={(e) => setFloorAreaSqm(e.target.value)}
                      className="w-full rounded-2xl border border-[#d7dde3] bg-[#fcfcfb] px-4 py-3 text-[#2d3135] outline-none transition focus:border-[#8b6b52] focus:bg-white"
                    />
                  </div>
                )}
                
                <div className="grid gap-4 md:grid-cols-3">
                  <div>
                    <label className="mb-2 block text-sm font-medium text-[#4d555d]">
                      Name
                    </label>
                    <input
                      type="text"
                      value={leadName}
                      onChange={(e) => setLeadName(e.target.value)}
                      placeholder="Your name"
                      className="w-full rounded-2xl border border-[#d7dde3] bg-[#fcfcfb] px-4 py-3 text-[#2d3135] outline-none transition focus:border-[#8b6b52] focus:bg-white"
                    />
                  </div>
                
                  <div>
                    <label className="mb-2 block text-sm font-medium text-[#4d555d]">
                      Phone number
                    </label>
                    <input
                      type="text"
                      value={leadPhone}
                      onChange={(e) => setLeadPhone(e.target.value)}
                      placeholder="Your phone number"
                      className="w-full rounded-2xl border border-[#d7dde3] bg-[#fcfcfb] px-4 py-3 text-[#2d3135] outline-none transition focus:border-[#8b6b52] focus:bg-white"
                    />
                  </div>
                
                  <div>
                    <label className="mb-2 block text-sm font-medium text-[#4d555d]">
                      Email
                    </label>
                    <input
                      type="email"
                      value={leadEmail}
                      onChange={(e) => setLeadEmail(e.target.value)}
                      placeholder="Your email"
                      className="w-full rounded-2xl border border-[#d7dde3] bg-[#fcfcfb] px-4 py-3 text-[#2d3135] outline-none transition focus:border-[#8b6b52] focus:bg-white"
                    />
                  </div>
                </div>
                
                <button
                  type="button"
                  onClick={handleGenerateReport}
                  disabled={isGenerating}
                  className="mt-2 rounded-2xl bg-[#2f3438] px-5 py-3.5 text-sm font-semibold text-white shadow-[0_12px_24px_rgba(47,52,56,0.18)] transition hover:bg-[#24292d] disabled:cursor-not-allowed disabled:opacity-70"
                >
                  {isGenerating ? 'Generating...' : 'See My Home Value'}
                </button>

                <p className="mt-2 text-xs text-[#7a8289]">
                  Powered by real transaction data from HDB & URA
                </p>

                {formMessage && (
                  <p className="text-sm text-[#8b6b52]">{formMessage}</p>
                )}
              </div>

              <div className="mt-6 rounded-2xl bg-[#f8f4ef] p-4">
                <p className="text-xs uppercase tracking-[0.2em] text-[#8b6b52]">
                  Data-backed insight
                </p>
                <p className="mt-2 text-sm leading-6 text-[#606971]">
                  Built around nearby comparable transactions to give you a clearer starting point.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {hasReport && (
        <section className="bg-[#f7f4ef]">
          <div
            ref={resultRef}
            className="mx-auto max-w-7xl px-6 py-12 md:px-10"
          >
            {/* Valuation Summary */}
            <div className="rounded-2xl border border-[#e5dbcf] bg-white p-6 shadow-sm max-w-xl">
              <p className="text-sm font-medium uppercase tracking-[0.18em] text-[#8b6b52]">
                Valuation Summary
              </p>
      
              <p className="mt-3 text-3xl font-semibold text-[#2d3135] md:text-4xl">
                {formatMoney(estimatedPrice)}
              </p>
      
              {(estimatedLow || estimatedHigh) && (
                <p className="mt-2 text-sm text-[#6a727a]">
                  Range: {formatMoney(estimatedLow)} - {formatMoney(estimatedHigh)}
                </p>
              )}
      
              <p className="mt-2 text-sm text-[#6a727a]">
                Based on {numOfComps || 0} nearby transactions
                {radiusUsedM ? ` within ${radiusUsedM}m` : ''}
              </p>
            </div>
      
            {/* Tabs */}
            <div className="mt-10">
              <h3 className="text-2xl font-semibold text-[#2d3135]">
                Real Nearby Transactions Around Your Unit
              </h3>
      
              <div className="mt-4 flex gap-2">
                <button
                  onClick={() => setActiveTab('same')}
                  className={`px-4 py-2 rounded-full text-sm ${
                    activeTab === 'same'
                      ? 'bg-[#2f3438] text-white'
                      : 'bg-white border border-[#ddd]'
                  }`}
                >
                  Same Project
                </button>
      
                <button
                  onClick={() => setActiveTab('nearby')}
                  className={`px-4 py-2 rounded-full text-sm ${
                    activeTab === 'nearby'
                      ? 'bg-[#2f3438] text-white'
                      : 'bg-white border border-[#ddd]'
                  }`}
                >
                  Nearby
                </button>
              </div>
      
              {/* Table */}
              <div className="mt-6 overflow-x-auto rounded-2xl border border-[#e5dbcf] bg-white">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="text-left text-[#6a727a]">
                      <th className="px-4 py-3">Date</th>
                      <th className="px-4 py-3">Address</th>
                      <th className="px-4 py-3">Size</th>
                      <th className="px-4 py-3">Price</th>
                      <th className="px-4 py-3">PSF</th>
                      <th className="px-4 py-3">Distance</th>
                    </tr>
                  </thead>
      
                  <tbody>
                    {(activeTab === 'same'
                      ? propertyCategory === 'condo' || propertyCategory === 'ec'
                        ? sameProjectComparables.length > 0
                          ? sameProjectComparables
                          : []
                        : propertyCategory === 'hdb'
                        ? sameBlockComparables.length > 0
                          ? sameBlockComparables
                          : []
                        : recentComparables
                      : propertyCategory === 'condo' || propertyCategory === 'ec'
                      ? nearbyCondoComparables
                      : propertyCategory === 'hdb'
                      ? nearbyHdbComparables
                      : recentComparables
                    ).map((row, i) => (
                      <tr key={i} className="border-t hover:bg-[#faf8f4] transition">
                        <td className="px-5 py-4">
                          {formatDate(row.transaction_date)}
                        </td>
                        <td className="px-5 py-4">
                          {row.project_name || row.address}
                        </td>
                        <td className="px-5 py-4">
                          {sqmToSqft(row.floor_area_sqm)} sqft
                        </td>
                        <td className="px-5 py-4">
                          {formatMoney(row.transaction_price)}
                        </td>
                        <td className="px-5 py-4">
                          ${Math.round(row.psf).toLocaleString()}
                        </td>
                        <td className="px-5 py-4">
                          {Math.round(row.distance_m)}m
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </section>
      )}

      <section className="border-t border-[#e8ddd2] bg-white">
        <div className="mx-auto max-w-7xl px-6 py-12 md:px-10">
          <div className="max-w-2xl">
            <p className="text-sm font-medium uppercase tracking-[0.2em] text-[#8b6b52]">
              Why HomeValue
            </p>
            <h3 className="mt-3 text-2xl font-semibold text-[#2d3135] md:text-3xl">
              A faster way to get a market-backed starting point
            </h3>
            <p className="mt-4 text-sm leading-7 text-[#646c74] md:text-base">
              Built using real nearby transactions so homeowners can get a clearer sense of value before deciding their next move.
            </p>
          </div>
      
          <div className="mt-8 grid gap-4 md:grid-cols-3">
            <div className="rounded-3xl border border-[#e8ddd2] bg-[#faf8f4] p-5">
              <h4 className="text-lg font-semibold text-[#2d3135]">Market-based estimate</h4>
              <p className="mt-2 text-sm leading-6 text-[#67707a]">
                Anchored to real nearby transactions.
              </p>
            </div>
      
            <div className="rounded-3xl border border-[#e8ddd2] bg-[#faf8f4] p-5">
              <h4 className="text-lg font-semibold text-[#2d3135]">Comparable evidence</h4>
              <p className="mt-2 text-sm leading-6 text-[#67707a]">
                See what similar homes have been selling for.
              </p>
            </div>
      
            <div className="rounded-3xl border border-[#e8ddd2] bg-[#faf8f4] p-5">
              <h4 className="text-lg font-semibold text-[#2d3135]">Useful next step</h4>
              <p className="mt-2 text-sm leading-6 text-[#67707a]">
                A practical benchmark before selling, buying, or planning ahead.
              </p>
            </div>
          </div>
        </div>
      </section>

      {showConsultationModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-lg rounded-[28px] border border-[#e3d6c8] bg-white p-6 shadow-[0_20px_60px_rgba(37,42,46,0.18)] md:p-8">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-2xl font-semibold text-[#2d3135]">
                  Free Consultation
                </h2>
                <p className="mt-2 text-sm leading-6 text-[#67707a]">
                  Leave your details and we&apos;ll contact you shortly.
                </p>
              </div>

              <button
                type="button"
                onClick={() => setShowConsultationModal(false)}
                className="rounded-full border border-[#e5dbcf] px-3 py-1 text-sm text-[#606971] transition hover:bg-[#f8f4ef]"
              >
                Close
              </button>
            </div>

            <div className="mt-6 grid gap-4">
              <div>
                <label className="mb-2 block text-sm font-medium text-[#4d555d]">
                  Name
                </label>
                <input
                  type="text"
                  value={consultName}
                  onChange={(e) => setConsultName(e.target.value)}
                  placeholder="Your name"
                  className="w-full rounded-2xl border border-[#d7dde3] bg-[#fcfcfb] px-4 py-3 text-[#2d3135] outline-none transition focus:border-[#8b6b52] focus:bg-white"
                />
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-[#4d555d]">
                  Phone number
                </label>
                <input
                  type="text"
                  value={consultPhone}
                  onChange={(e) => setConsultPhone(e.target.value)}
                  placeholder="Your phone number"
                  className="w-full rounded-2xl border border-[#d7dde3] bg-[#fcfcfb] px-4 py-3 text-[#2d3135] outline-none transition focus:border-[#8b6b52] focus:bg-white"
                />
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-[#4d555d]">
                  Email
                </label>
                <input
                  type="email"
                  value={consultEmail}
                  onChange={(e) => setConsultEmail(e.target.value)}
                  placeholder="Your email"
                  className="w-full rounded-2xl border border-[#d7dde3] bg-[#fcfcfb] px-4 py-3 text-[#2d3135] outline-none transition focus:border-[#8b6b52] focus:bg-white"
                />
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-[#4d555d]">
                  What&apos;s your plan?
                </label>
                <textarea
                  value={consultPlan}
                  onChange={(e) => setConsultPlan(e.target.value)}
                  placeholder="e.g. Thinking of selling in the next 3 months"
                  rows={4}
                  className="w-full rounded-2xl border border-[#d7dde3] bg-[#fcfcfb] px-4 py-3 text-[#2d3135] outline-none transition focus:border-[#8b6b52] focus:bg-white"
                />
              </div>

              <button
                type="button"
                onClick={handleConsultationSubmit}
                className="rounded-2xl bg-[#2f3438] px-5 py-3.5 text-sm font-semibold text-white transition hover:bg-[#24292d]"
              >
                Submit
              </button>

              {consultationMessage && (
                <p className="text-sm text-[#8b6b52]">{consultationMessage}</p>
              )}
            </div>
          </div>
        </div>
      )}
    </main>
  )
}
