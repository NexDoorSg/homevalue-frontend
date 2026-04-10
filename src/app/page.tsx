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
  transaction_date: string | null
  transaction_price: number | string | null
  floor_area_sqm: number | string | null
  latitude: number | string | null
  longitude: number | string | null
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

function getPropertyCategoryFromType(
  propertyType: string
): 'hdb' | 'condo' | 'landed' {
  const normalized = propertyType.toUpperCase().trim()

  if (!normalized) return 'condo'

  const hdbTypes = ['2 ROOM', '3 ROOM', '4 ROOM', '5 ROOM', 'EXECUTIVE']
  const landedTypes = [
    'TERRACE HOUSE',
    'SEMI-DETACHED HOUSE',
    'DETACHED HOUSE',
  ]

  if (hdbTypes.includes(normalized)) return 'hdb'
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
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}

function getDistanceMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
) {
  return Math.sqrt(Math.pow(lat2 - lat1, 2) + Math.pow(lon2 - lon1, 2)) * 111000
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
      floor_area_sqm: number
      transaction_price: number
      psf: number
      distance_m: number
    }>
  >([])

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
    setHasTeaserResult(false)
    setHasUnlockedReport(false)
    setUnlockMessage('')
  }

  const handleAddressChange = (value: string) => {
    setAddress(value)
    setSelectedLat(null)
    setSelectedLon(null)
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

    setSelectedLat(lat)
    setSelectedLon(lon)
    setLookupCandidates(buildLookupCandidates(chosen))
    setAddress(chosen.ADDRESS)

    return { lat, lon }
  } catch (error) {
    console.error('Failed to resolve address for generation:', error)
    return null
  }
}

  const handleGenerateReport = async () => {
    setFormMessage('')
    setUnlockMessage('')
    setHasUnlockedReport(false)
    setRecentComparables([])

    if (!address.trim()) {
      setFormMessage('Please enter an address first.')
      return
    }

    if (!propertyType) {
      setFormMessage('Please choose a property type first.')
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

    setIsGenerating(true)

    try {
      const resolved = await resolveAddressForGeneration()

      if (!resolved) {
        setFormMessage('Could not match this address. Please choose an address from the dropdown.')
        return
      }

      const result = await getValuation({
        lat: resolved.lat,
        lon: resolved.lon,
        floorAreaSqm: propertyCategory === 'landed' ? Number(builtUpSqm) : Number(floorAreaSqm),
        landSizeSqm: propertyCategory === 'landed' ? Number(landSizeSqm) : undefined,
        builtUpSqm: propertyCategory === 'landed' ? Number(builtUpSqm) : undefined,
        tenure: propertyCategory === 'landed' ? tenure : undefined,
        propertyType,
        propertyCategory,
      })

      if (!result) {
        setEstimatedPrice(null)
        setEstimatedLow(null)
        setEstimatedHigh(null)
        setNumOfComps(null)
        setRadiusUsedM(null)
        setHasTeaserResult(false)
        setFormMessage('Not enough comparable transactions found for this property yet.')
        return
      }

      setEstimatedPrice(result.estimated)
      setEstimatedLow(result.low)
      setEstimatedHigh(result.high)
      setNumOfComps(result.comparables)
      setRadiusUsedM(result.radius)
      setHasTeaserResult(true)
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
        selectedLon ||
        hasTeaserResult
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
            ? Number(builtUpSqm || 0) || null
            : Number(floorAreaSqm || 0) || null
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

    if (!consultEmail.trim()) {
      setConsultationMessage('Please enter your email.')
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

  const fetchRecentComparables = async (
    lat: number,
    lon: number,
    source: string,
    targetPropertyType: string
  ) => {
    const { data, error } = await supabase
      .from('property_transactions_v2')
      .select(
        'address, transaction_date, transaction_price, floor_area_sqm, latitude, longitude'
      )
      .eq('source', source)
      .eq('unit_type', targetPropertyType)
      .not('transaction_price', 'is', null)
      .not('floor_area_sqm', 'is', null)
      .not('latitude', 'is', null)
      .not('longitude', 'is', null)
      .limit(5000)

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
          transaction_date: row.transaction_date,
          transaction_price: transactionPrice,
          floor_area_sqm: floorArea,
          latitude: rowLat,
          longitude: rowLon,
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

    const searchRadius = [200, 400, 600, 800]
    for (const radius of searchRadius) {
      const withinRadius = cleaned
        .filter((row) => row.distance_m <= radius)
        .sort((a, b) => {
          const dateA = a.transaction_date ? new Date(a.transaction_date).getTime() : 0
          const dateB = b.transaction_date ? new Date(b.transaction_date).getTime() : 0
          return dateB - dateA
        })

      if (withinRadius.length >= 5) {
        return withinRadius.slice(0, 10)
      }
    }

    return cleaned
      .sort((a, b) => {
        const dateA = a.transaction_date ? new Date(a.transaction_date).getTime() : 0
        const dateB = b.transaction_date ? new Date(b.transaction_date).getTime() : 0
        return dateB - dateA
      })
      .slice(0, 10)
  }

  const handleUnlockReport = async () => {
    setUnlockMessage('')

    if (!unlockName.trim()) {
      setUnlockMessage('Please enter your name.')
      return
    }

    if (!unlockPhone.trim()) {
      setUnlockMessage('Please enter your phone number.')
      return
    }

    if (!unlockEmail.trim()) {
      setUnlockMessage('Please enter your email.')
      return
    }

    if (!selectedLat || !selectedLon || !estimatedPrice) {
      setUnlockMessage('Please generate a teaser valuation first.')
      return
    }

    setIsLoadingFullReport(true)

    try {
      const normalizedUnlockEmail = unlockEmail.trim().toLowerCase()

      const leadPayload = buildLeadPayload(
        unlockName,
        unlockPhone,
        normalizedUnlockEmail,
        { plan: 'full_report' }
      )

      const response = await fetch('/api/unlock-full-report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(leadPayload),
      })

      const result = await response.json()

      if (!response.ok || !result.ok) {
        throw new Error(result?.error || 'Failed to unlock full report')
      }

      if (result.reachedLimit) {
        setUnlockMessage(
          result.message ||
            'You’ve reached the free full-report limit for the past 30 days. Please contact us directly and we’ll be happy to help.'
        )
        return
      }

      const emailResult = await sendLeadEmail({
        ...leadPayload,
        source: 'full_report',
      })

      let source = 'data_gov_hdb'
      if (propertyCategory !== 'hdb') {
        source = 'ura_private'
      }

      const comparables = await fetchRecentComparables(
        selectedLat,
        selectedLon,
        source,
        propertyType
      )

      setRecentComparables(comparables)
      setHasUnlockedReport(true)

      if (!emailResult.ok) {
        setUnlockMessage('Full report unlocked. Email notification failed; check Vercel logs.')
      } else {
        setUnlockMessage('Full report unlocked successfully.')
      }

      setUnlockName('')
      setUnlockPhone('')
      setUnlockEmail('')
    } catch (error) {
      console.error('Full report unlock failed:', error)
      setUnlockMessage('Could not unlock the report right now. Please try again.')
    } finally {
      setIsLoadingFullReport(false)
    }
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
          <div className="order-2 pt-4 lg:order-1">
            <div className="inline-flex rounded-full border border-[#dcc8b5] bg-white px-4 py-2 text-sm font-medium text-[#8b6b52] shadow-sm">
              HomeValue by NexDoor
            </div>

            <h1 className="mt-4 max-w-4xl text-4xl font-semibold leading-tight tracking-tight text-[#2d3135] md:text-6xl">
              What’s Your Home Really Worth?
            </h1>

            <p className="mt-5 max-w-2xl text-base leading-7 text-[#616971] md:text-lg">
              Get an instant estimate based on nearby 2026 transaction data.
            </p>

            <div className="mt-8 grid gap-4 sm:grid-cols-3">
              <div className="rounded-2xl border border-[#e8ddd2] bg-white p-5 shadow-[0_10px_30px_rgba(0,0,0,0.04)]">
                <p className="text-sm text-[#8b6b52]">Nearby sales</p>
                <p className="mt-2 text-lg font-semibold text-[#2d3135]">Matched to your area</p>
              </div>

              <div className="rounded-2xl border border-[#e8ddd2] bg-white p-5 shadow-[0_10px_30px_rgba(0,0,0,0.04)]">
                <p className="text-sm text-[#8b6b52]">Clear valuation</p>
                <p className="mt-2 text-lg font-semibold text-[#2d3135]">
                  Built on real market evidence
                </p>
              </div>

              <div className="rounded-2xl border border-[#e8ddd2] bg-white p-5 shadow-[0_10px_30px_rgba(0,0,0,0.04)]">
                <p className="text-sm text-[#8b6b52]">Useful insights</p>
                <p className="mt-2 text-lg font-semibold text-[#2d3135]">
                  Designed for homeowners
                </p>
              </div>
            </div>

            <div className="mt-8 rounded-3xl border border-[#e8ddd2] bg-white p-6 shadow-sm">
              <p className="text-sm font-medium uppercase tracking-[0.18em] text-[#8b6b52]">
                Why people use this
              </p>
              <div className="mt-4 grid gap-4 sm:grid-cols-3">
                <div>
                  <p className="text-2xl font-semibold text-[#2d3135]">30 sec</p>
                  <p className="mt-1 text-sm text-[#66707a]">Fast first-pass valuation</p>
                </div>
                <div>
                  <p className="text-2xl font-semibold text-[#2d3135]">2026</p>
                  <p className="mt-1 text-sm text-[#66707a]">Current transaction dataset</p>
                </div>
                <div>
                  <p className="text-2xl font-semibold text-[#2d3135]">Real comps</p>
                  <p className="mt-1 text-sm text-[#66707a]">Backed by nearby transactions</p>
                </div>
              </div>
            </div>
          </div>

          <div className="order-1 relative lg:order-2">
            <div className="rounded-[28px] border border-[#e3d6c8] bg-white p-6 shadow-[0_20px_60px_rgba(37,42,46,0.08)] md:p-8">
              <div className="mb-6">
                <h2 className="text-2xl font-semibold text-[#2d3135]">Get your valuation</h2>
                <p className="mt-2 text-sm leading-6 text-[#67707a]">
                  Fill in your property details below. Takes less than 30 seconds.
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

                {propertyCategory === 'landed' ? (
                  <>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="mb-2 block text-sm font-medium text-[#4d555d]">
                          Land size (sqm)
                        </label>
                        <input
                          type="number"
                          placeholder="e.g. 420"
                          value={landSizeSqm}
                          onChange={(e) => setLandSizeSqm(e.target.value)}
                          className="w-full rounded-2xl border border-[#d7dde3] bg-[#fcfcfb] px-4 py-3 text-[#2d3135] outline-none transition focus:border-[#8b6b52] focus:bg-white"
                        />
                      </div>

                      <div>
                        <label className="mb-2 block text-sm font-medium text-[#4d555d]">
                          Built-up size (sqm)
                        </label>
                        <input
                          type="number"
                          placeholder="e.g. 650"
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
                      Floor area (sqm)
                    </label>
                    <input
                      type="number"
                      placeholder="e.g. 177"
                      value={floorAreaSqm}
                      onChange={(e) => setFloorAreaSqm(e.target.value)}
                      className="w-full rounded-2xl border border-[#d7dde3] bg-[#fcfcfb] px-4 py-3 text-[#2d3135] outline-none transition focus:border-[#8b6b52] focus:bg-white"
                    />
                  </div>
                )}

                <button
                  type="button"
                  onClick={handleGenerateReport}
                  disabled={isGenerating}
                  className="mt-2 rounded-2xl bg-[#2f3438] px-5 py-3.5 text-sm font-semibold text-white shadow-[0_12px_24px_rgba(47,52,56,0.18)] transition hover:bg-[#24292d] disabled:cursor-not-allowed disabled:opacity-70"
                >
                  {isGenerating ? 'Generating...' : 'Get My Valuation'}
                </button>

                <div className="space-y-1">
                  <p className="text-sm text-[#67707a]">
                    No obligation. Takes less than 30 seconds.
                  </p>
                </div>

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

            <div className="mt-6 grid gap-4 sm:grid-cols-2">
              <div className="rounded-2xl border border-[#e5dbcf] bg-white p-5 shadow-sm">
                <p className="text-sm text-[#8b6b52]">Estimated Value</p>
                <p className="mt-2 text-3xl font-semibold text-[#2d3135]">
                  {hasTeaserResult ? formatTeaserMoney(estimatedPrice) : '$4XX,XXX'}
                </p>
                <p className="mt-2 text-sm text-[#6a727a]">
                  Unlock the full report to see the exact valuation
                </p>
              </div>

              <div className="rounded-2xl border border-[#e5dbcf] bg-white p-5 shadow-sm">
                <p className="text-sm text-[#8b6b52]">Comparable Evidence</p>
                <p className="mt-2 text-lg font-semibold text-[#2d3135]">
                  {hasTeaserResult
                    ? `${numOfComps || 0} nearby transactions found`
                    : 'Generate a teaser valuation first'}
                </p>
                <p className="mt-1 text-sm text-[#6a727a]">
                  {hasTeaserResult
                    ? 'Submit your details to unlock the full report'
                    : 'We’ll show a teaser first'}
                </p>
              </div>
            </div>

            {hasTeaserResult && !hasUnlockedReport && (
              <div className="mt-4 rounded-2xl border border-[#e5dbcf] bg-white p-5 shadow-sm">
                <p className="text-sm font-medium uppercase tracking-[0.18em] text-[#8b6b52]">
                  Unlock full report
                </p>
                <h3 className="mt-2 text-xl font-semibold text-[#2d3135]">
                  Enter your details to view the full valuation report
                </h3>
                <p className="mt-2 text-sm text-[#67707a]">
                  You’ll unlock the exact valuation, indicative range, and recent nearby transactions.
                </p>

                <div className="mt-5 grid gap-4">
                  <div>
                    <label className="mb-2 block text-sm font-medium text-[#4d555d]">
                      Name
                    </label>
                    <input
                      type="text"
                      value={unlockName}
                      onChange={(e) => setUnlockName(e.target.value)}
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
                      value={unlockPhone}
                      onChange={(e) => setUnlockPhone(e.target.value)}
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
                      value={unlockEmail}
                      onChange={(e) => setUnlockEmail(e.target.value)}
                      placeholder="Your email"
                      className="w-full rounded-2xl border border-[#d7dde3] bg-[#fcfcfb] px-4 py-3 text-[#2d3135] outline-none transition focus:border-[#8b6b52] focus:bg-white"
                    />
                  </div>

                  <button
                    type="button"
                    onClick={handleUnlockReport}
                    disabled={isLoadingFullReport}
                    className="rounded-2xl bg-[#2f3438] px-5 py-3.5 text-sm font-semibold text-white transition hover:bg-[#24292d] disabled:cursor-not-allowed disabled:opacity-70"
                  >
                    {isLoadingFullReport ? 'Unlocking...' : 'Unlock Full Report'}
                  </button>

                  {unlockMessage && (
                    <p className="text-sm text-[#8b6b52]">{unlockMessage}</p>
                  )}
                </div>
              </div>
            )}

            {hasUnlockedReport && (
              <>
                <div className="mt-4 rounded-2xl border border-[#e5dbcf] bg-white p-5 shadow-sm">
                  <p className="text-sm text-[#8b6b52]">Full Estimated Value</p>
                  <p className="mt-2 text-3xl font-semibold text-[#2d3135]">
                    {formatMoney(estimatedPrice)}
                  </p>
                  <p className="mt-2 text-sm text-[#6a727a]">
                    Based on nearby transaction evidence
                  </p>
                </div>

                {(estimatedLow || estimatedHigh) && (
                  <div className="mt-4 rounded-2xl border border-[#e5dbcf] bg-white p-5 shadow-sm">
                    <p className="text-sm text-[#8b6b52]">Indicative Range</p>
                    <p className="mt-2 text-lg font-semibold text-[#2d3135]">
                      {formatMoney(estimatedLow)} - {formatMoney(estimatedHigh)}
                    </p>
                    <p className="mt-2 text-sm text-[#6a727a]">
                      Based on {numOfComps || 0} nearby transactions within {radiusUsedM || 0}m
                    </p>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </section>

      {hasUnlockedReport && (
        <section className="border-t border-[#e8ddd2] bg-white">
          <div className="mx-auto max-w-7xl px-6 py-14 md:px-10">
            <div className="max-w-3xl">
              <p className="text-sm font-medium uppercase tracking-[0.2em] text-[#8b6b52]">
                Full report
              </p>
              <h3 className="mt-3 text-3xl font-semibold text-[#2d3135]">
                Recent nearby transactions
              </h3>
              <p className="mt-4 text-base leading-7 text-[#646c74]">
                These are the most recent comparable transactions near your selected property.
              </p>
            </div>

            <div className="mt-8 overflow-hidden rounded-3xl border border-[#e5dbcf] bg-white shadow-sm">
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-[#efe7dd]">
                  <thead className="bg-[#faf8f4]">
                    <tr>
                      <th className="px-5 py-4 text-left text-sm font-semibold text-[#8b6b52]">
                        Date
                      </th>
                      <th className="px-5 py-4 text-left text-sm font-semibold text-[#8b6b52]">
                        Address
                      </th>
                      <th className="px-5 py-4 text-left text-sm font-semibold text-[#8b6b52]">
                        Size (sqm)
                      </th>
                      <th className="px-5 py-4 text-left text-sm font-semibold text-[#8b6b52]">
                        Price
                      </th>
                      <th className="px-5 py-4 text-left text-sm font-semibold text-[#8b6b52]">
                        PSF
                      </th>
                      <th className="px-5 py-4 text-left text-sm font-semibold text-[#8b6b52]">
                        Distance
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#f3ede5]">
                    {recentComparables.length > 0 ? (
                      recentComparables.map((row, index) => (
                        <tr key={`${row.address}-${row.transaction_date}-${index}`}>
                          <td className="px-5 py-4 text-sm text-[#2d3135]">
                            {formatDate(row.transaction_date)}
                          </td>
                          <td className="px-5 py-4 text-sm text-[#2d3135]">
                            {row.address || '-'}
                          </td>
                          <td className="px-5 py-4 text-sm text-[#2d3135]">
                            {row.floor_area_sqm.toLocaleString()}
                          </td>
                          <td className="px-5 py-4 text-sm text-[#2d3135]">
                            ${Math.round(row.transaction_price).toLocaleString()}
                          </td>
                          <td className="px-5 py-4 text-sm text-[#2d3135]">
                            ${Math.round(row.psf).toLocaleString()}
                          </td>
                          <td className="px-5 py-4 text-sm text-[#2d3135]">
                            {Math.round(row.distance_m)}m
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td
                          colSpan={6}
                          className="px-5 py-8 text-center text-sm text-[#67707a]"
                        >
                          No recent comparables available yet.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </section>
      )}

      <section className="border-t border-[#e8ddd2] bg-white">
        <div className="mx-auto max-w-7xl px-6 py-14 md:px-10">
          <div className="max-w-2xl">
            <p className="text-sm font-medium uppercase tracking-[0.2em] text-[#8b6b52]">
              Why use HomeValue
            </p>
            <h3 className="mt-3 text-3xl font-semibold text-[#2d3135]">
              A clearer way to understand your property’s value
            </h3>
            <p className="mt-4 text-base leading-7 text-[#646c74]">
              Designed to help homeowners and buyers get a more informed view of the market using
              recent nearby sales and structured transaction data.
            </p>
          </div>

          <div className="mt-10 grid gap-6 md:grid-cols-3">
            <div className="rounded-3xl border border-[#e8ddd2] bg-[#faf8f4] p-6">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#2f3438] text-lg text-white">
                1
              </div>
              <h4 className="mt-5 text-xl font-semibold text-[#2d3135]">Market-based estimate</h4>
              <p className="mt-3 text-sm leading-6 text-[#67707a]">
                Valuations are anchored to actual nearby transactions rather than guesswork.
              </p>
            </div>

            <div className="rounded-3xl border border-[#e8ddd2] bg-[#faf8f4] p-6">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#8b6b52] text-lg text-white">
                2
              </div>
              <h4 className="mt-5 text-xl font-semibold text-[#2d3135]">Comparable evidence</h4>
              <p className="mt-3 text-sm leading-6 text-[#67707a]">
                Recent nearby sales help explain how the estimate is formed.
              </p>
            </div>

            <div className="rounded-3xl border border-[#e8ddd2] bg-[#faf8f4] p-6">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#c8a287] text-lg text-white">
                3
              </div>
              <h4 className="mt-5 text-xl font-semibold text-[#2d3135]">Useful starting point</h4>
              <p className="mt-3 text-sm leading-6 text-[#67707a]">
                Use it to benchmark price expectations before your next move.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="bg-[#f7f4ef]">
        <div className="mx-auto max-w-7xl px-6 py-14 md:px-10">
          <div className="max-w-2xl">
            <p className="text-sm font-medium uppercase tracking-[0.2em] text-[#8b6b52]">
              What you’ll see
            </p>
            <h3 className="mt-3 text-3xl font-semibold text-[#2d3135]">
              Your report brings together the numbers that matter
            </h3>
          </div>

          <div className="mt-10 grid gap-6 lg:grid-cols-3">
            <div className="rounded-3xl border border-[#e5dbcf] bg-white p-7 shadow-sm">
              <h4 className="text-2xl font-semibold text-[#2d3135]">Estimated value</h4>
              <p className="mt-3 text-sm leading-6 text-[#67707a]">
                A clear estimate based on nearby comparable transactions and property details.
              </p>
            </div>

            <div className="rounded-3xl border border-[#e5dbcf] bg-white p-7 shadow-sm">
              <h4 className="text-2xl font-semibold text-[#2d3135]">Indicative range</h4>
              <p className="mt-3 text-sm leading-6 text-[#67707a]">
                A practical range to help you better understand possible pricing expectations.
              </p>
            </div>

            <div className="rounded-3xl border border-[#e5dbcf] bg-white p-7 shadow-sm">
              <h4 className="text-2xl font-semibold text-[#2d3135]">Nearby supporting data</h4>
              <p className="mt-3 text-sm leading-6 text-[#67707a]">
                Comparable transactions around your home so you can see what the market has been doing.
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
                  Leave your details and we’ll contact you shortly.
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
                  What’s your plan?
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
