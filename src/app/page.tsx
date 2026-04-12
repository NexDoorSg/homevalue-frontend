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
  category: 'hdb' | 'condo' | 'landed'
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
}

const PROPERTY_TYPE_OPTIONS: PropertyTypeOption[] = [
  { label: 'HDB 2 Room', value: '2 ROOM', category: 'hdb' },
  { label: 'HDB 3 Room', value: '3 ROOM', category: 'hdb' },
  { label: 'HDB 4 Room', value: '4 ROOM', category: 'hdb' },
  { label: 'HDB 5 Room', value: '5 ROOM', category: 'hdb' },
  { label: 'HDB Executive', value: 'EXECUTIVE', category: 'hdb' },
  { label: '1 Bedroom', value: '1 BEDROOM', category: 'condo' },
  { label: '2 Bedroom', value: '2 BEDROOM', category: 'condo' },
  { label: '3 Bedroom', value: '3 BEDROOM', category: 'condo' },
  { label: '4 Bedroom', value: '4 BEDROOM', category: 'condo' },
  { label: '5 Bedroom', value: '5 BEDROOM', category: 'condo' },
  { label: 'Penthouse', value: 'PENTHOUSE', category: 'condo' },
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

function getPropertyCategoryFromType(propertyType: string): 'hdb' | 'condo' | 'landed' {
  const normalized = propertyType.toUpperCase().trim()
  if (!normalized) return 'condo'
  const hdbTypes = ['2 ROOM', '3 ROOM', '4 ROOM', '5 ROOM', 'EXECUTIVE']
  const landedTypes = ['TERRACE HOUSE', 'SEMI-DETACHED HOUSE', 'DETACHED HOUSE']
  if (hdbTypes.includes(normalized)) return 'hdb'
  if (landedTypes.includes(normalized)) return 'landed'
  return 'condo'
}

function cleanAddress(value: string) {
  return value.toUpperCase().replace(/\bSINGAPORE\s+\d{6}\b/g, '').replace(/\s+/g, ' ').trim()
}

function abbreviateRoadWords(value: string) {
  return value
    .replace(/\bAVENUE\b/g, 'AVE').replace(/\bSTREET\b/g, 'ST').replace(/\bROAD\b/g, 'RD')
    .replace(/\bDRIVE\b/g, 'DR').replace(/\bCRESCENT\b/g, 'CRES').replace(/\bPLACE\b/g, 'PL')
    .replace(/\bCLOSE\b/g, 'CL').replace(/\bLANE\b/g, 'LN').replace(/\bTERRACE\b/g, 'TER')
    .replace(/\bBOULEVARD\b/g, 'BLVD').replace(/\bCENTRAL\b/g, 'CTRL').replace(/\bHEIGHTS\b/g, 'HTS')
    .replace(/\bNORTH\b/g, 'NTH').replace(/\bSOUTH\b/g, 'STH').replace(/\bGARDENS\b/g, 'GDNS')
    .replace(/\bINDUSTRIAL PARK\b/g, 'IND PK').replace(/\s+/g, ' ').trim()
}

function buildLookupCandidates(item: OneMapResult) {
  const candidates = new Set<string>()
  const rawAddress = cleanAddress(item.ADDRESS || '')
  if (rawAddress) { candidates.add(rawAddress); candidates.add(abbreviateRoadWords(rawAddress)) }
  const blockRoad = cleanAddress(`${item.BLK_NO || ''} ${item.ROAD_NAME || ''}`.trim())
  if (blockRoad) { candidates.add(blockRoad); candidates.add(abbreviateRoadWords(blockRoad)) }
  const building = cleanAddress(item.BUILDING || '')
  if (building && building !== 'NIL') candidates.add(building)
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
  if (!value) return '$X,XXX,XXX'
  const rounded = Math.round(value).toLocaleString()
  let seenFirstDigit = false
  const masked = rounded.split('').map((char) => {
    if (!/\d/.test(char)) return char
    if (!seenFirstDigit) { seenFirstDigit = true; return char }
    return 'X'
  }).join('')
  return `$${masked}`
}

function formatDate(value: string | null) {
  if (!value) return '-'
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return value
  return parsed.toLocaleDateString('en-SG', { month: 'short', year: 'numeric' })
}

function formatTenure(value: string | null | undefined) {
  if (!value) return '-'
  const v = value.trim()
  const match = v.match(/^(\d+)\s*yrs?\s*lease\s*commencing\s*from\s*(\d{4})/i)
  if (match) {
    const yrs = Number(match[1])
    const from = match[2]
    if (yrs >= 900) return `999-yr (from ${from})`
    return `${yrs}-yr (from ${from})`
  }
  if (/freehold/i.test(v)) return 'Freehold'
  if (/9999/i.test(v)) return 'Freehold'
  if (/999\s*years/i.test(v)) return '999-yr'
  if (/99\s*years/i.test(v)) return '99-yr'
  return 'Leasehold'
}

function getDistanceMeters(lat1: number, lon1: number, lat2: number, lon2: number) {
  const toRad = (deg: number) => (deg * Math.PI) / 180
  const R = 6371000
  const dLat = toRad(lat2 - lat1)
  const dLon = toRad(lon2 - lon1)
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2)
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

type EmailResult = { ok: boolean; error?: string }

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
  const [recentComparables, setRecentComparables] = useState<Array<{
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
  }>>([])
  const [isGenerating, setIsGenerating] = useState(false)
  const [formMessage, setFormMessage] = useState('')
  const [hasTeaserResult, setHasTeaserResult] = useState(false)
  const [hasUnlockedReport, setHasUnlockedReport] = useState(false)
  const [isLoadingFullReport, setIsLoadingFullReport] = useState(false)
  const [showConsultationModal, setShowConsultationModal] = useState(false)
  const [consultName, setConsultName] = useState('')
  const [consultPhone, setConsultPhone] = useState('')
  const [consultEmail, setConsultEmail] = useState('')
  const [consultPlan, setConsultPlan] = useState('')
  const [consultationMessage, setConsultationMessage] = useState('')
  const [unlockName, setUnlockName] = useState('')
  const [unlockPhone, setUnlockPhone] = useState('')
  const [unlockEmail, setUnlockEmail] = useState('')
  const [unlockMessage, setUnlockMessage] = useState('')

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const propertyCategory = getPropertyCategoryFromType(propertyType)
  const showFloorRangeColumn = propertyCategory === 'hdb' && recentComparables.some(row => row.floor_level && row.floor_level.trim() !== '')

  const searchAddress = async (value: string) => {
    if (value.trim().length < 3) { setSuggestions([]); setShowSuggestions(false); return }
    try {
      const res = await fetch(`https://www.onemap.gov.sg/api/common/elastic/search?searchVal=${encodeURIComponent(value)}&returnGeom=Y&getAddrDetails=Y&pageNum=1`)
      const data = await res.json()
      const results = (data?.results || []) as OneMapResult[]
      setSuggestions(results.slice(0, 8)); setShowSuggestions(true)
    } catch { setSuggestions([]); setShowSuggestions(false) }
  }

  const resetResults = () => {
    setFormMessage(''); setEstimatedPrice(null); setEstimatedLow(null); setEstimatedHigh(null)
    setNumOfComps(null); setRadiusUsedM(null); setRecentComparables([])
    setHasTeaserResult(false); setHasUnlockedReport(false); setUnlockMessage('')
  }

  const handleAddressChange = (value: string) => {
    setAddress(value); setSelectedLat(null); setSelectedLon(null)
    setSelectedStreetName(null); setSelectedProjectName(null); setLookupCandidates([])
    resetResults()
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => searchAddress(value), 300)
  }

  const handleSelectAddress = (item: OneMapResult) => {
    setAddress(item.ADDRESS)
    setSelectedLat(Number(item.LATITUDE)); setSelectedLon(Number(item.LONGITUDE))
    setSelectedStreetName(item.ROAD_NAME ? item.ROAD_NAME.toUpperCase().trim() : null)
    setSelectedProjectName(item.BUILDING && item.BUILDING !== 'NIL' ? item.BUILDING.toUpperCase().trim() : null)
    setLookupCandidates(buildLookupCandidates(item))
    resetResults(); setSuggestions([]); setShowSuggestions(false)
  }

  const resolveAddressForGeneration = async () => {
    if (selectedLat && selectedLon) return { lat: selectedLat, lon: selectedLon }
    if (!address.trim()) return null
    try {
      const res = await fetch(`https://www.onemap.gov.sg/api/common/elastic/search?searchVal=${encodeURIComponent(address)}&returnGeom=Y&getAddrDetails=Y&pageNum=1`)
      const data = await res.json()
      const results = (data?.results || []) as OneMapResult[]
      if (!results.length) return null
      const exactMatch = results.find(item => cleanAddress(item.ADDRESS || '') === cleanAddress(address))
      const chosen = exactMatch || results[0]
      const lat = Number(chosen.LATITUDE); const lon = Number(chosen.LONGITUDE)
      setSelectedLat(lat); setSelectedLon(lon)
      setSelectedStreetName(chosen.ROAD_NAME ? chosen.ROAD_NAME.toUpperCase().trim() : null)
      setSelectedProjectName(chosen.BUILDING && chosen.BUILDING !== 'NIL' ? chosen.BUILDING.toUpperCase().trim() : null)
      setLookupCandidates(buildLookupCandidates(chosen)); setAddress(chosen.ADDRESS)
      return { lat, lon }
    } catch { return null }
  }

  const handleGenerateReport = async () => {
    setFormMessage(''); setUnlockMessage(''); setHasUnlockedReport(false); setRecentComparables([])
    if (!address.trim()) { setFormMessage('Please enter an address first.'); return }
    if (!propertyType) { setFormMessage('Please choose a property type first.'); return }
    if (propertyCategory === 'landed') {
      if (!landSizeSqm || Number(landSizeSqm) <= 0) { setFormMessage('Please enter a valid land size first.'); return }
      if (!builtUpSqm || Number(builtUpSqm) <= 0) { setFormMessage('Please enter a valid built-up size first.'); return }
      if (!tenure) { setFormMessage('Please choose the tenure first.'); return }
    } else {
      if (!floorAreaSqm || Number(floorAreaSqm) <= 0) { setFormMessage('Please enter a valid floor area first.'); return }
    }
    setIsGenerating(true)
    try {
      const resolved = await resolveAddressForGeneration()
      if (!resolved) { setFormMessage('Could not match this address. Please choose from the dropdown.'); return }
      const result = await getValuation({
        lat: resolved.lat, lon: resolved.lon,
        floorAreaSqm: propertyCategory === 'landed' ? Number(sqftToSqm(builtUpSqm)) : Number(sqftToSqm(floorAreaSqm)),
        landSizeSqm: propertyCategory === 'landed' ? Number(sqftToSqm(landSizeSqm)) : undefined,
        builtUpSqm: propertyCategory === 'landed' ? Number(sqftToSqm(builtUpSqm)) : undefined,
        tenure: propertyCategory === 'landed' ? tenure : undefined,
        floorLevel: Number(floorLevel) || undefined,
        propertyType, propertyCategory,
      })
      if (!result) { setHasTeaserResult(false); setFormMessage('Not enough comparable transactions found for this property yet.'); return }
      setEstimatedPrice(result.estimated); setEstimatedLow(result.low); setEstimatedHigh(result.high)
      setNumOfComps(result.comparables); setRadiusUsedM(result.radius); setHasTeaserResult(true)
    } catch { setFormMessage('Error generating valuation.') } finally { setIsGenerating(false) }
  }

  const hasPropertyContext = () => Boolean(address.trim() || floorLevel.trim() || stackNumber.trim() || floorAreaSqm.trim() || landSizeSqm.trim() || builtUpSqm.trim() || selectedLat || selectedLon || hasTeaserResult)

  const buildLeadPayload = (name: string, phone: string, email: string, extra?: { plan?: string | null }) => {
    const fullUnitNumber = floorLevel.trim() && stackNumber.trim() ? `#${floorLevel.trim()}-${stackNumber.trim()}` : null
    const propertyContextExists = hasPropertyContext()
    return {
      name: name.trim(), phone: phone.trim(), email: email.trim().toLowerCase(),
      address: propertyContextExists ? address.trim() || null : null,
      unit_number: propertyContextExists ? fullUnitNumber : null,
      unit_type: propertyContextExists ? propertyType || null : null,
      floor_area_sqm: propertyContextExists ? (propertyCategory === 'landed' ? Number(sqftToSqm(builtUpSqm)) || null : Number(sqftToSqm(floorAreaSqm)) || null) : null,
      tenure: propertyContextExists && propertyCategory === 'landed' ? tenure : null,
      plan: extra?.plan ?? null,
    }
  }

  const sendLeadEmail = async (payload: Record<string, unknown>): Promise<EmailResult> => {
    try {
      const response = await fetch('/api/send-lead', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      const result = await response.json().catch(() => null)
      if (!response.ok) return { ok: false, error: result?.error || 'Email API failed' }
      return { ok: true }
    } catch { return { ok: false, error: 'Could not reach email API' } }
  }

  const handleConsultationSubmit = async () => {
    setConsultationMessage('')
    if (!consultName.trim()) { setConsultationMessage('Please enter your name.'); return }
    if (!consultPhone.trim()) { setConsultationMessage('Please enter your phone number.'); return }
    if (!consultEmail.trim()) { setConsultationMessage('Please enter your email.'); return }
    if (!consultPlan.trim()) { setConsultationMessage('Please tell us your plan.'); return }
    const leadPayload = buildLeadPayload(consultName, consultPhone, consultEmail, { plan: consultPlan.trim() })
    const { error } = await supabase.from('leads').insert([leadPayload])
    if (error) { setConsultationMessage('Could not save your details right now. Please try again.'); return }
    const emailResult = await sendLeadEmail({ ...leadPayload, source: 'consultation' })
    setConsultationMessage(emailResult.ok ? 'Thanks — we will contact you shortly.' : 'Lead saved, but email notification failed.')
    setConsultName(''); setConsultPhone(''); setConsultEmail(''); setConsultPlan('')
  }

  const fetchRecentComparables = async (lat: number, lon: number, source: string, targetPropertyType: string, category: 'hdb' | 'condo' | 'landed', preferredRadius?: number) => {
    function normalizeText(value: string | null | undefined) { return (value || '').toUpperCase().replace(/\s+/g, ' ').trim() }
    function normalizeStreet(value: string | null | undefined) {
      return normalizeText(value)
        .replace(/\bBUKIT\b/g, 'BT').replace(/\bMOUNT\b/g, 'MT').replace(/\bSAINT\b/g, 'ST')
        .replace(/\bAVENUE\b/g, 'AVE').replace(/\bSTREET\b/g, 'ST').replace(/\bROAD\b/g, 'RD').replace(/\bDRIVE\b/g, 'DR')
        .replace(/\bCRESCENT\b/g, 'CRES').replace(/\bPLACE\b/g, 'PL').replace(/\bCLOSE\b/g, 'CL').replace(/\bLANE\b/g, 'LN')
        .replace(/\bTERRACE\b/g, 'TER').replace(/\bBOULEVARD\b/g, 'BLVD').replace(/\bCENTRAL\b/g, 'CTRL').replace(/\bHEIGHTS\b/g, 'HTS')
        .replace(/\bGARDENS\b/g, 'GDNS').replace(/\bNORTH\b/g, 'NTH').replace(/\bSOUTH\b/g, 'STH').replace(/\bEAST\b/g, 'EAST').replace(/\bWEST\b/g, 'WEST').replace(/\s+/g, ' ').trim()
    }
    function normalizeProject(value: string | null | undefined) {
      return normalizeText(value).replace(/[^\w\s]/g, ' ').replace(/\bEXECUTIVE CONDOMINIUM\b/g, 'EC').replace(/\bCONDOMINIUM\b/g, 'CONDO').replace(/\bAPARTMENTS\b/g, 'APT').replace(/\bAPARTMENT\b/g, 'APT').replace(/\s+/g, ' ').trim()
    }
    function extractBlock(value: string | null | undefined) { const text = normalizeText(value); const match = text.match(/^(\d+[A-Z]?)\b/); return match ? match[1] : '' }
    function extractStreetFromAddress(value: string | null | undefined) { const text = normalizeText(value); if (!text) return ''; return text.replace(/\bSINGAPORE\s+\d{6}\b/g, '').replace(/^(\d+[A-Z]?)\s+/, '').trim() }
    function getEffectiveStreet(streetName: string | null | undefined, addressValue: string | null | undefined) { const direct = normalizeStreet(streetName); if (direct) return direct; return normalizeStreet(extractStreetFromAddress(addressValue)) }
    function getEffectiveProject(projectName: string | null | undefined, addressValue: string | null | undefined) { const direct = normalizeProject(projectName); if (direct) return direct; return normalizeProject(addressValue) }
    function getLandedCluster(streetName: string | null | undefined, addressValue: string | null | undefined) {
      const street = getEffectiveStreet(streetName, addressValue); if (!street) return ''
      const SUFFIXES = new Set(['AVE', 'ST', 'RD', 'DR', 'CRES', 'PL', 'CL', 'LN', 'TER', 'BLVD', 'CTRL', 'HTS', 'GDNS', 'NTH', 'STH', 'EAST', 'WEST', 'RISE', 'VIEW', 'WALK', 'GROVE', 'PARK', 'HILL', 'VALE', 'GREEN', 'GARDEN', 'LINK', 'WAY', 'LOOP', 'RING', 'TURN', 'MOUNT', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12', '13', '14', '15', '16', '17', '18', '19', '20'])
      const parts = street.split(' '); let endIndex = parts.length
      while (endIndex > 1 && SUFFIXES.has(parts[endIndex - 1])) endIndex--
      const cluster = parts.slice(0, endIndex).join(' ')
      return cluster.length >= 3 ? cluster : ''
    }
    function getSizeBand(subjectSqm: number, rowSqm: number) {
      if (!subjectSqm || !rowSqm) return 'different'
      const diffRatio = Math.abs(rowSqm - subjectSqm) / subjectSqm
      if (diffRatio <= 0.05) return 'same'; if (diffRatio <= 0.15) return 'similar'; return 'different'
    }

    const subjectFloorAreaSqm = category === 'landed' ? Number(sqftToSqm(landSizeSqm || builtUpSqm)) : Number(sqftToSqm(floorAreaSqm))
    const subjectStreet = getEffectiveStreet(selectedStreetName, address)
    const subjectProject = getEffectiveProject(selectedProjectName, address)
    const subjectBlock = extractBlock(address)
    const subjectCluster = getLandedCluster(selectedStreetName, address)

    let query = supabase.from('property_transactions_v2')
      .select('address, street_name, project_name, transaction_date, transaction_price, floor_area_sqm, latitude, longitude, unit_type, floor_level, tenure')
      .eq('source', source).not('transaction_price', 'is', null).not('floor_area_sqm', 'is', null).not('latitude', 'is', null).not('longitude', 'is', null)

    if (category === 'hdb') query = query.eq('unit_type', targetPropertyType).limit(5000)
    if (category === 'condo') {
      const LAT_DELTA = 0.014; const LON_DELTA = 0.014
      query = query.gte('latitude', lat - LAT_DELTA).lte('latitude', lat + LAT_DELTA).gte('longitude', lon - LON_DELTA).lte('longitude', lon + LON_DELTA).limit(3000)
    }
    if (category === 'landed') {
      query = query.or(['unit_type.ilike.%TERRACE%', 'unit_type.ilike.%SEMI%', 'unit_type.ilike.%DETACHED%', 'unit_type.ilike.%BUNGALOW%'].join(',')).limit(8000)
    }

    const { data, error } = await query
    if (error) { console.error('Comparable fetch error:', error); return [] }

    const cleaned = ((data || []) as ComparableRow[]).map(row => {
      const transactionPrice = Number(row.transaction_price); const floorArea = Number(row.floor_area_sqm)
      const rowLat = Number(row.latitude); const rowLon = Number(row.longitude); const floorAreaSqft = floorArea * 10.7639
      return {
        address: row.address, street_name: row.street_name || null, project_name: row.project_name || null,
        transaction_date: row.transaction_date, transaction_price: transactionPrice, floor_area_sqm: floorArea,
        latitude: rowLat, longitude: rowLon, unit_type: row.unit_type || null, floor_level: row.floor_level || null,
        tenure: (row as ComparableRow & { tenure?: string | null }).tenure || null,
        distance_m: getDistanceMeters(lat, lon, rowLat, rowLon),
        psf: floorAreaSqft > 0 ? transactionPrice / floorAreaSqft : 0,
      }
    }).filter(row => Number.isFinite(row.transaction_price) && row.transaction_price > 0 && Number.isFinite(row.floor_area_sqm) && row.floor_area_sqm > 0 && Number.isFinite(row.latitude) && Number.isFinite(row.longitude))

    const withNormalized = cleaned.map(row => ({
      ...row,
      _normStreet: getEffectiveStreet(row.street_name, row.address),
      _normProject: getEffectiveProject(row.project_name, row.address),
      _block: extractBlock(row.address),
      _cluster: getLandedCluster(row.street_name, row.address),
      _sizeBand: getSizeBand(subjectFloorAreaSqm, row.floor_area_sqm),
    }))

    if (category === 'hdb') {
      const hdbCandidates = withNormalized.filter(row => row._sizeBand !== 'different').map(row => {
        const sameStreet = !!row._normStreet && row._normStreet === subjectStreet
        const sameBlock = sameStreet && !!row._block && !!subjectBlock && row._block === subjectBlock
        let priority = 999
        if (sameBlock && row._sizeBand === 'same') priority = 1
        else if (sameBlock && row._sizeBand === 'similar') priority = 2
        else if (sameStreet && row._sizeBand === 'same') priority = 3
        else if (sameStreet && row._sizeBand === 'similar') priority = 4
        else if (row.distance_m <= 500 && row._sizeBand === 'same') priority = 5
        else if (row.distance_m <= 500 && row._sizeBand === 'similar') priority = 6
        else if (row.distance_m <= 1200 && row._sizeBand === 'same') priority = 7
        else if (row.distance_m <= 1200 && row._sizeBand === 'similar') priority = 8
        else if (row.distance_m <= 2000 && row._sizeBand === 'same') priority = 9
        else if (row.distance_m <= 2000 && row._sizeBand === 'similar') priority = 10
        return { ...row, _priority: priority }
      }).filter(row => row._priority < 999)
      return [...hdbCandidates].sort((a, b) => {
        const dateA = a.transaction_date ? new Date(a.transaction_date).getTime() : 0
        const dateB = b.transaction_date ? new Date(b.transaction_date).getTime() : 0
        if (dateB !== dateA) return dateB - dateA
        if (a.distance_m !== b.distance_m) return a.distance_m - b.distance_m
        return a._priority - b._priority
      }).slice(0, 10)
    }

    if (category === 'condo') {
      const subjectCondoSqm = Number(sqftToSqm(floorAreaSqm)) || 0
      function condoFilter(distanceM: number, lowerRatio: number, upperRatio: number) {
        return withNormalized.filter(row => {
          if (row.distance_m > distanceM) return false
          if (subjectCondoSqm > 0 && row.floor_area_sqm > 0) {
            if (row.floor_area_sqm < subjectCondoSqm * lowerRatio) return false
            if (row.floor_area_sqm > subjectCondoSqm * upperRatio) return false
          }
          return true
        })
      }
      const countAfterCap = (rows: typeof withNormalized) => {
        const counts: Record<string, number> = {}; let total = 0
        for (const row of rows) { const proj = (row._normProject || '').toUpperCase(); const c = counts[proj] || 0; if (c < 2) { counts[proj] = c + 1; total++ }; if (total >= 10) break }
        return total
      }
      let pool = condoFilter(1500, 0.5, 1.5)
      if (countAfterCap(pool) < 8) pool = condoFilter(1500, 0.25, 2.0)
      if (countAfterCap(pool) < 8) pool = condoFilter(2500, 0.25, 2.0)
      const seen = new Set<string>()
      const deduped = pool.filter(row => { const key = `${row.address}|${row.transaction_date}|${row.transaction_price}`; if (seen.has(key)) return false; seen.add(key); return true })
      deduped.sort((a, b) => { const dateA = a.transaction_date ? new Date(a.transaction_date).getTime() : 0; const dateB = b.transaction_date ? new Date(b.transaction_date).getTime() : 0; if (dateB !== dateA) return dateB - dateA; return a.distance_m - b.distance_m })
      const projectCounts: Record<string, number> = {}; const result = []
      for (const row of deduped) { const proj = (row._normProject || '').toUpperCase(); const count = projectCounts[proj] || 0; if (count < 2) { result.push(row); projectCounts[proj] = count + 1 }; if (result.length >= 10) break }
      return result
    }

    if (category === 'landed') {
      const landedOnly = withNormalized.filter(row => { const unitType = normalizeText(row.unit_type); return unitType.includes('TERRACE') || unitType.includes('SEMI') || unitType.includes('DETACHED') || unitType.includes('BUNGALOW') })
      const seen = new Set<string>()
      const deduped = landedOnly.filter(row => { const key = `${row.address}|${row.transaction_date}|${row.transaction_price}`; if (seen.has(key)) return false; seen.add(key); return true })
      const subjectLandSqm = Number(sqftToSqm(landSizeSqm)) || 0
      function applyFilter(distanceM: number, lowerRatio: number) {
        return deduped.filter(row => { if (row.distance_m > distanceM) return false; if (subjectLandSqm > 0 && row.floor_area_sqm > 0 && row.floor_area_sqm < subjectLandSqm * lowerRatio) return false; return true })
      }
      let withinRange = applyFilter(1500, 0.5)
      if (withinRange.length < 8) withinRange = applyFilter(1500, 0.25)
      if (withinRange.length < 8) withinRange = applyFilter(2500, 0.25)
      const subjectFirstWord = (subjectStreet || '').split(' ')[0] || ''
      const scored = withinRange.map(row => {
        const sameStreet = !!row._normStreet && !!subjectStreet && row._normStreet === subjectStreet
        const clusterMatch = !sameStreet && !!row._cluster && !!subjectCluster && row._cluster.length >= 3 && subjectCluster.length >= 3 && row._cluster === subjectCluster
        const rowFirstWord = (row._normStreet || '').split(' ')[0] || ''
        const firstWordMatch = !sameStreet && !clusterMatch && rowFirstWord.length >= 4 && subjectFirstWord.length >= 4 && rowFirstWord === subjectFirstWord
        const sameCluster = clusterMatch || firstWordMatch
        let tierScore: number
        if (sameStreet) tierScore = 0; else if (sameCluster) tierScore = 100; else tierScore = 200
        const distanceScore = Math.min(Math.round((row.distance_m / 1000) * 10), 50)
        const sizeScore = row._sizeBand === 'same' ? 0 : row._sizeBand === 'similar' ? 3 : 6
        const txTime = row.transaction_date ? new Date(row.transaction_date).getTime() : 0
        const monthsAgo = txTime > 0 ? (Date.now() - txTime) / (1000 * 60 * 60 * 24 * 30) : 50
        const recencyScore = Math.min(Math.round(monthsAgo * 0.3), 15)
        return { ...row, _totalScore: tierScore + distanceScore + sizeScore + recencyScore, _tierScore: tierScore }
      })
      scored.sort((a, b) => { const dateA = a.transaction_date ? new Date(a.transaction_date).getTime() : 0; const dateB = b.transaction_date ? new Date(b.transaction_date).getTime() : 0; if (dateB !== dateA) return dateB - dateA; return a.distance_m - b.distance_m })
      return scored.slice(0, 15)
    }
    return []
  }

  const handleUnlockReport = async () => {
    setUnlockMessage('')
    if (!unlockName.trim()) { setUnlockMessage('Please enter your name.'); return }
    if (!unlockPhone.trim()) { setUnlockMessage('Please enter your phone number.'); return }
    if (!unlockEmail.trim()) { setUnlockMessage('Please enter your email.'); return }
    if (!selectedLat || !selectedLon || !estimatedPrice) { setUnlockMessage('Please generate your estimate first.'); return }
    setIsLoadingFullReport(true)
    try {
      const normalizedUnlockEmail = unlockEmail.trim().toLowerCase()
      const leadPayload = buildLeadPayload(unlockName, unlockPhone, normalizedUnlockEmail, { plan: 'full_report' })
      const response = await fetch('/api/unlock-full-report', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(leadPayload) })
      const result = await response.json()
      if (!response.ok || !result.ok) throw new Error(result?.error || 'Failed to unlock full report')
      if (result.reachedLimit) { setUnlockMessage(result.message || "You've reached the free full-report limit. Please contact us directly."); return }
      await sendLeadEmail({ ...leadPayload, source: 'full_report' })
      const source = propertyCategory !== 'hdb' ? 'ura_private' : 'data_gov_hdb'
      const comparables = await fetchRecentComparables(selectedLat, selectedLon, source, propertyType, propertyCategory, radiusUsedM || undefined)
      setRecentComparables(comparables); setHasUnlockedReport(true)
      setUnlockMessage('Full report unlocked successfully.')
      setUnlockName(''); setUnlockPhone(''); setUnlockEmail('')
    } catch { setUnlockMessage('Could not unlock the report right now. Please try again.') } finally { setIsLoadingFullReport(false) }
  }

  const inputStyle: React.CSSProperties = {
    width: '100%', border: '1px solid #d7dde3', borderRadius: '10px', padding: '12px 14px',
    fontSize: '14px', backgroundColor: '#fafaf8', outline: 'none', boxSizing: 'border-box',
    fontFamily: 'system-ui, sans-serif', color: '#2f3438',
  }
  const labelStyle: React.CSSProperties = {
    display: 'block', fontSize: '11px', fontWeight: 600, letterSpacing: '0.1em',
    textTransform: 'uppercase', color: '#8b6b52', marginBottom: '8px', fontFamily: 'system-ui, sans-serif',
  }

  return (
    <main style={{ minHeight: '100vh', backgroundColor: '#f7f4ef', fontFamily: 'Georgia, "Times New Roman", serif', color: '#2f3438' }}>

      {/* HEADER */}
      <header style={{ borderBottom: '1px solid #e8ddd2', backgroundColor: 'rgba(255,255,255,0.95)', backdropFilter: 'blur(8px)', position: 'sticky', top: 0, zIndex: 50 }}>
        <div style={{ maxWidth: '1280px', margin: '0 auto', padding: '0 32px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: '60px' }}>
          <a href="https://www.nexdoor.sg" style={{ textDecoration: 'none' }}>
            <span style={{ fontSize: '26px', letterSpacing: '-0.02em', color: '#1a1f24' }}>NexDoor.</span>
          </a>
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            <span style={{ fontSize: '11px', color: '#8b9199', letterSpacing: '0.1em', textTransform: 'uppercase', fontFamily: 'system-ui, sans-serif' }}>HomeValue</span>
            <button type="button" onClick={() => setShowConsultationModal(true)}
              style={{ backgroundColor: '#2f3438', color: '#fff', border: 'none', borderRadius: '100px', padding: '9px 20px', fontSize: '13px', fontWeight: 600, cursor: 'pointer', fontFamily: 'system-ui, sans-serif' }}>
              Free Consultation
            </button>
          </div>
        </div>
      </header>

      {/* MAIN TWO-COLUMN LAYOUT */}
      <div style={{ maxWidth: '1280px', margin: '0 auto', display: 'grid', gridTemplateColumns: '480px 1fr', minHeight: 'calc(100vh - 60px)', alignItems: 'start' }} className="hv-grid">

        {/* LEFT: STICKY FORM */}
        <div style={{ position: 'sticky', top: '60px', height: 'calc(100vh - 60px)', overflowY: 'auto', padding: '40px 40px 40px 32px', borderRight: '1px solid #e8ddd2', backgroundColor: '#fff' }} className="hv-form">
          
          <div style={{ marginBottom: '28px' }}>
            <p style={{ fontSize: '11px', letterSpacing: '0.15em', textTransform: 'uppercase', color: '#8b6b52', margin: '0 0 10px 0', fontFamily: 'system-ui, sans-serif' }}>Property Valuation</p>
            <h1 style={{ fontSize: '36px', fontWeight: 400, lineHeight: 1.15, letterSpacing: '-0.02em', margin: '0 0 10px 0', color: '#1a1f24' }}>
              What is your<br />home worth?
            </h1>
            <p style={{ fontSize: '14px', color: '#8b9199', lineHeight: 1.6, margin: 0, fontFamily: 'system-ui, sans-serif' }}>
              Instant estimate using real HDB &amp; URA transaction data.
            </p>
          </div>

          {/* Address field */}
          <div style={{ position: 'relative', marginBottom: '14px' }}>
            <label style={labelStyle}>Full address</label>
            <input type="text" placeholder="e.g. 419 Woodlands Street 41" value={address} onChange={e => handleAddressChange(e.target.value)} style={inputStyle} />
            {showSuggestions && suggestions.length > 0 && (
              <div style={{ position: 'absolute', zIndex: 30, top: '100%', left: 0, right: 0, marginTop: '6px', backgroundColor: '#fff', border: '1px solid #e8ddd2', borderRadius: '12px', boxShadow: '0 8px 32px rgba(37,42,46,0.12)', maxHeight: '260px', overflowY: 'auto' }}>
                {suggestions.map((item, index) => (
                  <button key={`${item.ADDRESS}-${index}`} type="button" onClick={() => handleSelectAddress(item)}
                    style={{ display: 'block', width: '100%', textAlign: 'left', padding: '11px 16px', border: 'none', borderBottom: '1px solid #f5f0ea', backgroundColor: 'transparent', cursor: 'pointer', fontFamily: 'system-ui, sans-serif' }}>
                    <div style={{ fontSize: '13px', fontWeight: 500, color: '#2f3438' }}>{item.ADDRESS}</div>
                    {item.POSTAL && <div style={{ fontSize: '11px', color: '#8b9199', marginTop: '2px' }}>Singapore {item.POSTAL}</div>}
                  </button>
                ))}
              </div>
            )}
          </div>

          {selectedLat && selectedLon && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '14px' }}>
              <div style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: '#22c55e', flexShrink: 0 }} />
              <span style={{ fontSize: '12px', color: '#22c55e', fontFamily: 'system-ui, sans-serif', fontWeight: 500 }}>Address matched successfully</span>
            </div>
          )}

          {/* Floor + Stack */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '14px' }}>
            <div>
              <label style={labelStyle}>Floor level</label>
              <input type="text" placeholder="e.g. 11" value={floorLevel} onChange={e => setFloorLevel(e.target.value)} style={inputStyle} />
            </div>
            <div>
              <label style={labelStyle}>Stack number</label>
              <input type="text" placeholder="e.g. 389" value={stackNumber} onChange={e => setStackNumber(e.target.value)} style={inputStyle} />
            </div>
          </div>

          {/* Property type */}
          <div style={{ marginBottom: '14px' }}>
            <label style={labelStyle}>Property type</label>
            <select value={propertyType} onChange={e => setPropertyType(e.target.value)} style={{ ...inputStyle, appearance: 'none' }}>
              <option value="" disabled>Select property type</option>
              {PROPERTY_TYPE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>

          {/* Landed fields */}
          {propertyCategory === 'landed' ? (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '14px' }}>
                <div>
                  <label style={labelStyle}>Land size (sqft)</label>
                  <input type="number" placeholder="e.g. 3200" value={landSizeSqm} onChange={e => setLandSizeSqm(e.target.value)} style={inputStyle} />
                </div>
                <div>
                  <label style={labelStyle}>Built-up (sqft)</label>
                  <input type="number" placeholder="e.g. 4500" value={builtUpSqm} onChange={e => setBuiltUpSqm(e.target.value)} style={inputStyle} />
                </div>
              </div>
              <div style={{ marginBottom: '14px' }}>
                <label style={labelStyle}>Tenure</label>
                <select value={tenure} onChange={e => setTenure(e.target.value)} style={{ ...inputStyle, appearance: 'none' }}>
                  {TENURE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
            </>
          ) : (
            <div style={{ marginBottom: '14px' }}>
              <label style={labelStyle}>Floor area (sqft)</label>
              <input type="number" placeholder="e.g. 990" value={floorAreaSqm} onChange={e => setFloorAreaSqm(e.target.value)} style={inputStyle} />
            </div>
          )}

          <button type="button" onClick={handleGenerateReport} disabled={isGenerating}
            style={{ width: '100%', backgroundColor: '#2f3438', color: '#fff', border: 'none', borderRadius: '10px', padding: '14px', fontSize: '14px', fontWeight: 600, cursor: isGenerating ? 'not-allowed' : 'pointer', opacity: isGenerating ? 0.7 : 1, fontFamily: 'system-ui, sans-serif', letterSpacing: '0.01em', marginBottom: '12px' }}>
            {isGenerating ? 'Calculating...' : 'See My Home Value →'}
          </button>

          {formMessage && <p style={{ fontSize: '13px', color: '#c0572a', margin: '0 0 12px 0', fontFamily: 'system-ui, sans-serif' }}>{formMessage}</p>}

          {/* Trust bar */}
          <div style={{ paddingTop: '20px', borderTop: '1px solid #f0ebe4', display: 'flex', gap: '24px' }}>
            {[{ n: '30s', l: 'Instant estimate' }, { n: '2026', l: 'Latest data' }, { n: '168K+', l: 'Transactions' }].map(s => (
              <div key={s.n}>
                <div style={{ fontSize: '17px', fontWeight: 600, color: '#1a1f24' }}>{s.n}</div>
                <div style={{ fontSize: '11px', color: '#8b9199', marginTop: '2px', fontFamily: 'system-ui, sans-serif' }}>{s.l}</div>
              </div>
            ))}
          </div>
        </div>

        {/* RIGHT: RESULTS PANEL */}
        <div style={{ padding: '40px 32px 60px 40px', minHeight: 'calc(100vh - 60px)' }} className="hv-results">

          {!hasTeaserResult && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '60vh', textAlign: 'center' }}>
              <div style={{ width: '80px', height: '80px', borderRadius: '50%', backgroundColor: '#f0ebe4', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '24px', fontSize: '36px' }}>🏠</div>
              <h2 style={{ fontSize: '24px', fontWeight: 400, color: '#1a1f24', margin: '0 0 12px 0' }}>Your estimate will appear here</h2>
              <p style={{ fontSize: '14px', color: '#8b9199', maxWidth: '300px', lineHeight: 1.7, margin: '0 0 32px 0', fontFamily: 'system-ui, sans-serif' }}>Enter your property details on the left and click the button to get started.</p>
              <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', justifyContent: 'center' }}>
                {['Based on real transactions', 'HDB & URA data', 'Instant results'].map(tag => (
                  <span key={tag} style={{ backgroundColor: '#f0ebe4', borderRadius: '100px', padding: '6px 14px', fontSize: '12px', color: '#8b6b52', fontFamily: 'system-ui, sans-serif' }}>{tag}</span>
                ))}
              </div>
            </div>
          )}

          {hasTeaserResult && (
            <div>
              {/* Estimate hero card */}
              <div style={{ background: 'linear-gradient(135deg, #2f3438 0%, #1a1f24 100%)', borderRadius: '24px', padding: '40px', marginBottom: '24px', position: 'relative', overflow: 'hidden' }}>
                <div style={{ position: 'absolute', top: '-60px', right: '-60px', width: '240px', height: '240px', borderRadius: '50%', backgroundColor: 'rgba(200,180,154,0.06)' }} />
                <div style={{ position: 'absolute', bottom: '-80px', left: '-40px', width: '300px', height: '300px', borderRadius: '50%', backgroundColor: 'rgba(200,180,154,0.04)' }} />
                <div style={{ position: 'relative' }}>
                  <p style={{ fontSize: '11px', letterSpacing: '0.18em', textTransform: 'uppercase', color: '#c8b49a', margin: '0 0 16px 0', fontFamily: 'system-ui, sans-serif' }}>Estimated Value</p>
                  <div style={{ fontSize: '56px', fontWeight: 400, color: '#fff', letterSpacing: '-0.02em', lineHeight: 1, marginBottom: '20px' }}>
                    {formatTeaserMoney(estimatedPrice)}
                  </div>
                  <div style={{ height: '2px', backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: '2px', marginBottom: '16px' }}>
                    <div style={{ height: '100%', width: '65%', background: 'linear-gradient(90deg, #c8b49a, #8b6b52)', borderRadius: '2px' }} />
                  </div>
                  <div style={{ display: 'flex', gap: '32px' }}>
                    <div>
                      <p style={{ fontSize: '10px', color: 'rgba(255,255,255,0.4)', margin: '0 0 4px 0', fontFamily: 'system-ui, sans-serif', letterSpacing: '0.08em', textTransform: 'uppercase' }}>Comparables</p>
                      <p style={{ fontSize: '16px', color: '#fff', margin: 0, fontWeight: 500 }}>{numOfComps || 0} nearby</p>
                    </div>
                    <div>
                      <p style={{ fontSize: '10px', color: 'rgba(255,255,255,0.4)', margin: '0 0 4px 0', fontFamily: 'system-ui, sans-serif', letterSpacing: '0.08em', textTransform: 'uppercase' }}>Radius</p>
                      <p style={{ fontSize: '16px', color: '#fff', margin: 0, fontWeight: 500 }}>{radiusUsedM || 0}m</p>
                    </div>
                  </div>
                </div>
              </div>

              {!hasUnlockedReport ? (
                /* UNLOCK FORM */
                <div style={{ backgroundColor: '#fff', borderRadius: '20px', border: '1px solid #e8ddd2', padding: '36px' }}>
                  <p style={{ fontSize: '11px', letterSpacing: '0.15em', textTransform: 'uppercase', color: '#8b6b52', margin: '0 0 8px 0', fontFamily: 'system-ui, sans-serif' }}>Unlock Full Report</p>
                  <h3 style={{ fontSize: '24px', fontWeight: 400, color: '#1a1f24', margin: '0 0 6px 0' }}>See your exact valuation &amp; nearby comparables</h3>
                  <p style={{ fontSize: '13px', color: '#8b9199', margin: '0 0 28px 0', fontFamily: 'system-ui, sans-serif', lineHeight: 1.6 }}>
                    Unlock your full valuation range and the most recent comparable transactions near your property.
                  </p>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', marginBottom: '14px' }}>
                    <div>
                      <label style={labelStyle}>Name</label>
                      <input type="text" value={unlockName} onChange={e => setUnlockName(e.target.value)} placeholder="Your name" style={inputStyle} />
                    </div>
                    <div>
                      <label style={labelStyle}>Phone</label>
                      <input type="text" value={unlockPhone} onChange={e => setUnlockPhone(e.target.value)} placeholder="Your phone number" style={inputStyle} />
                    </div>
                  </div>
                  <div style={{ marginBottom: '20px' }}>
                    <label style={labelStyle}>Email</label>
                    <input type="email" value={unlockEmail} onChange={e => setUnlockEmail(e.target.value)} placeholder="Your email address" style={inputStyle} />
                  </div>
                  <button type="button" onClick={handleUnlockReport} disabled={isLoadingFullReport}
                    style={{ width: '100%', backgroundColor: '#8b6b52', color: '#fff', border: 'none', borderRadius: '10px', padding: '14px', fontSize: '14px', fontWeight: 600, cursor: isLoadingFullReport ? 'not-allowed' : 'pointer', opacity: isLoadingFullReport ? 0.7 : 1, fontFamily: 'system-ui, sans-serif', marginBottom: '12px' }}>
                    {isLoadingFullReport ? 'Unlocking...' : 'See Full Valuation Report →'}
                  </button>
                  <p style={{ fontSize: '11px', color: '#aab0b6', textAlign: 'center', margin: 0, fontFamily: 'system-ui, sans-serif' }}>Limited free reports available each month</p>
                  {unlockMessage && <p style={{ fontSize: '13px', color: '#8b6b52', margin: '12px 0 0', fontFamily: 'system-ui, sans-serif' }}>{unlockMessage}</p>}
                </div>
              ) : (
                <>
                  {/* Full report cards */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '24px' }}>
                    <div style={{ backgroundColor: '#fff', borderRadius: '16px', border: '1px solid #e8ddd2', padding: '28px' }}>
                      <p style={{ fontSize: '10px', letterSpacing: '0.15em', textTransform: 'uppercase', color: '#8b6b52', margin: '0 0 10px 0', fontFamily: 'system-ui, sans-serif' }}>Full Estimate</p>
                      <p style={{ fontSize: '30px', fontWeight: 400, color: '#1a1f24', margin: 0, letterSpacing: '-0.01em' }}>{formatMoney(estimatedPrice)}</p>
                      <p style={{ fontSize: '12px', color: '#8b9199', margin: '6px 0 0', fontFamily: 'system-ui, sans-serif' }}>Based on nearby evidence</p>
                    </div>
                    <div style={{ backgroundColor: '#fff', borderRadius: '16px', border: '1px solid #e8ddd2', padding: '28px' }}>
                      <p style={{ fontSize: '10px', letterSpacing: '0.15em', textTransform: 'uppercase', color: '#8b6b52', margin: '0 0 10px 0', fontFamily: 'system-ui, sans-serif' }}>Indicative Range</p>
                      <p style={{ fontSize: '16px', fontWeight: 500, color: '#1a1f24', margin: 0, lineHeight: 1.5 }}>
                        {formatMoney(estimatedLow)}<br />
                        <span style={{ color: '#8b9199', fontSize: '12px', fontWeight: 400 }}>to</span><br />
                        {formatMoney(estimatedHigh)}
                      </p>
                    </div>
                  </div>

                  {/* Comparables table */}
                  {recentComparables.length > 0 && (
                    <div style={{ backgroundColor: '#fff', borderRadius: '20px', border: '1px solid #e8ddd2', overflow: 'hidden', marginBottom: '24px' }}>
                      <div style={{ padding: '24px 24px 16px', borderBottom: '1px solid #f0ebe4' }}>
                        <p style={{ fontSize: '10px', letterSpacing: '0.15em', textTransform: 'uppercase', color: '#8b6b52', margin: '0 0 4px 0', fontFamily: 'system-ui, sans-serif' }}>Full Report</p>
                        <h3 style={{ fontSize: '20px', fontWeight: 400, color: '#1a1f24', margin: 0 }}>Recent nearby transactions</h3>
                      </div>
                      <div style={{ overflowX: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px', fontFamily: 'system-ui, sans-serif' }}>
                          <thead>
                            <tr style={{ backgroundColor: '#faf8f4' }}>
                              {['Date', 'Address', ...(showFloorRangeColumn ? ['Floor'] : []), 'Size', 'Price', 'PSF', ...(propertyCategory !== 'hdb' ? ['Tenure'] : []), 'Dist'].map(h => (
                                <th key={h} style={{ padding: '10px 14px', textAlign: 'left', fontSize: '10px', fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#8b6b52', whiteSpace: 'nowrap', borderBottom: '1px solid #f0ebe4' }}>{h}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {recentComparables.map((row, index) => {
                              const isSameProject = propertyCategory === 'condo'
                                ? !!(row.project_name || '').toUpperCase().trim() && (row.project_name || '').toUpperCase().trim() === (selectedProjectName || '').toUpperCase().trim()
                                : !!(row.street_name || '').toUpperCase().trim() && (row.street_name || '').toUpperCase().trim() === (selectedStreetName || '').toUpperCase().trim()
                              const displayName = propertyCategory === 'condo'
                                ? (row.project_name || row.address || '-')
                                : (row.address || '-')
                              return (
                                <tr key={`${row.address}-${row.transaction_date}-${index}`} style={{ borderTop: index === 0 ? 'none' : '1px solid #f5f0ea', backgroundColor: index % 2 === 0 ? '#fff' : '#fdfcfb' }}>
                                  <td style={{ padding: '10px 14px', color: '#6a737c', whiteSpace: 'nowrap' }}>{formatDate(row.transaction_date)}</td>
                                  <td style={{ padding: '10px 14px', color: isSameProject ? '#1a1f24' : '#4a5260', fontWeight: isSameProject ? 600 : 400, maxWidth: '180px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{displayName}</td>
                                  {showFloorRangeColumn && <td style={{ padding: '10px 14px', color: '#6a737c' }}>{row.floor_level || '-'}</td>}
                                  <td style={{ padding: '10px 14px', color: '#6a737c', whiteSpace: 'nowrap' }}>{sqmToSqft(row.floor_area_sqm)}</td>
                                  <td style={{ padding: '10px 14px', color: '#1a1f24', fontWeight: 500, whiteSpace: 'nowrap' }}>${Math.round(row.transaction_price).toLocaleString()}</td>
                                  <td style={{ padding: '10px 14px', color: '#6a737c', whiteSpace: 'nowrap' }}>${Math.round(row.psf).toLocaleString()}</td>
                                  {propertyCategory !== 'hdb' && <td style={{ padding: '10px 14px', color: '#6a737c', whiteSpace: 'nowrap' }}>{formatTenure(row.tenure)}</td>}
                                  <td style={{ padding: '10px 14px', color: '#6a737c', whiteSpace: 'nowrap' }}>{Math.round(row.distance_m)}m</td>
                                </tr>
                              )
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {/* Consultation CTA */}
                  <div style={{ background: 'linear-gradient(135deg, #f0ebe4 0%, #e8ddd2 100%)', borderRadius: '20px', padding: '28px 32px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '20px', flexWrap: 'wrap' }}>
                    <div>
                      <p style={{ fontSize: '16px', fontWeight: 500, color: '#1a1f24', margin: '0 0 4px 0' }}>Want a more accurate valuation?</p>
                      <p style={{ fontSize: '13px', color: '#8b6b52', margin: 0, fontFamily: 'system-ui, sans-serif' }}>Our agents provide a detailed market appraisal — free of charge.</p>
                    </div>
                    <button type="button" onClick={() => setShowConsultationModal(true)}
                      style={{ backgroundColor: '#2f3438', color: '#fff', border: 'none', borderRadius: '10px', padding: '12px 24px', fontSize: '13px', fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap', fontFamily: 'system-ui, sans-serif', flexShrink: 0 }}>
                      Book Free Consultation →
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {/* CONSULTATION MODAL */}
      {showConsultationModal && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(26,31,36,0.5)', padding: '24px', backdropFilter: 'blur(4px)' }}>
          <div style={{ backgroundColor: '#fff', borderRadius: '24px', padding: '40px', maxWidth: '480px', width: '100%', boxShadow: '0 32px 80px rgba(0,0,0,0.2)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '28px' }}>
              <div>
                <h2 style={{ fontSize: '28px', fontWeight: 400, color: '#1a1f24', margin: '0 0 6px 0' }}>Free Consultation</h2>
                <p style={{ fontSize: '13px', color: '#8b9199', margin: 0, fontFamily: 'system-ui, sans-serif' }}>Leave your details and we&apos;ll contact you shortly.</p>
              </div>
              <button type="button" onClick={() => setShowConsultationModal(false)}
                style={{ background: 'none', border: '1px solid #e5dbcf', borderRadius: '8px', padding: '6px 12px', cursor: 'pointer', fontSize: '13px', color: '#666', fontFamily: 'system-ui, sans-serif' }}>✕</button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              {[{ label: 'Name', val: consultName, set: setConsultName, ph: 'Your name', type: 'text' }, { label: 'Phone', val: consultPhone, set: setConsultPhone, ph: 'Your phone number', type: 'text' }, { label: 'Email', val: consultEmail, set: setConsultEmail, ph: 'Your email', type: 'email' }].map(f => (
                <div key={f.label}>
                  <label style={labelStyle}>{f.label}</label>
                  <input type={f.type} value={f.val} onChange={e => f.set(e.target.value)} placeholder={f.ph} style={inputStyle} />
                </div>
              ))}
              <div>
                <label style={labelStyle}>What&apos;s your plan?</label>
                <textarea value={consultPlan} onChange={e => setConsultPlan(e.target.value)} placeholder="e.g. Thinking of selling in the next 3 months" rows={3}
                  style={{ ...inputStyle, resize: 'vertical' }} />
              </div>
              <button type="button" onClick={handleConsultationSubmit}
                style={{ backgroundColor: '#2f3438', color: '#fff', border: 'none', borderRadius: '10px', padding: '14px', fontSize: '14px', fontWeight: 600, cursor: 'pointer', fontFamily: 'system-ui, sans-serif' }}>
                Submit →
              </button>
              {consultationMessage && <p style={{ fontSize: '13px', color: '#8b6b52', margin: 0, fontFamily: 'system-ui, sans-serif' }}>{consultationMessage}</p>}
            </div>
          </div>
        </div>
      )}

      {/* RESPONSIVE CSS */}
      <style>{`
        @media (max-width: 900px) {
          .hv-grid {
            grid-template-columns: 1fr !important;
          }
          .hv-form {
            position: static !important;
            height: auto !important;
            overflow-y: visible !important;
            padding: 28px 24px !important;
            border-right: none !important;
            border-bottom: 1px solid #e8ddd2;
          }
          .hv-results {
            padding: 28px 24px 48px !important;
            min-height: unset !important;
          }
        }
        * { box-sizing: border-box; }
        input:focus, select:focus, textarea:focus {
          border-color: #8b6b52 !important;
          background-color: #fff !important;
        }
        button:hover { opacity: 0.9; }
        ::-webkit-scrollbar { width: 6px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: #d7dde3; border-radius: 3px; }
      `}</style>
    </main>
  )
}
