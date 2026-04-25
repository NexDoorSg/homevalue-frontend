'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useRef, useState } from 'react'
import { getValuation } from '@/lib/valuation'
import { supabase } from '../../../../lib/supabase'

type AgentUser = { email: string }
type PropertyCategory = 'hdb' | 'condo' | 'ec' | 'landed'

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
  category: PropertyCategory
}

const AUTHORISED_EMAILS = [
  'bjornlim@nexdoor.sg',
  'abigailtang@nexdoor.sg',
  'daveteo@nexdoor.sg',
]

const AGENT_NAME_BY_EMAIL: Record<string, string> = {
  'bjornlim@nexdoor.sg': 'Bjorn Lim',
  'abigailtang@nexdoor.sg': 'Abigail Tang',
  'daveteo@nexdoor.sg': 'Dave Teo',
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
  { label: 'EC Penthouse', value: 'PENTHOUSE EC', category: 'ec' },

  { label: 'Terrace House', value: 'TERRACE HOUSE', category: 'landed' },
  { label: 'Semi-Detached House', value: 'SEMI-DETACHED HOUSE', category: 'landed' },
  { label: 'Detached House', value: 'DETACHED HOUSE', category: 'landed' },
]

const TENURE_OPTIONS = [
  { label: '99-year leasehold', value: '99-year leasehold' },
  { label: '999-year leasehold', value: '999-year leasehold' },
  { label: 'Freehold', value: 'FREEHOLD' },
]

function normaliseText(value: string | null | undefined) {
  return (value || '').toUpperCase().replace(/[-_/]/g, ' ').replace(/\s+/g, ' ').trim()
}

function sqftToSqm(value: string | number | null | undefined) {
  const sqft = Number(value)
  if (!Number.isFinite(sqft) || sqft <= 0) return null
  return sqft / 10.7639
}

function toNumber(value: string | number | null | undefined) {
  if (value === null || value === undefined) return null
  if (typeof value === 'string' && value.trim() === '') return null
  const numberValue = Number(value)
  return Number.isFinite(numberValue) ? numberValue : null
}

function roundToNearest(value: number, nearest = 5000) {
  return Math.round(value / nearest) * nearest
}

function buildTightRenovatedRange(estimated: number | null, low: number | null, high: number | null) {
  const midpoint = estimated && estimated > 0 ? estimated : low && high ? (low + high) / 2 : null

  if (!midpoint || !Number.isFinite(midpoint)) {
    return { renovatedLow: null, renovatedHigh: null }
  }

  const halfSpread = 15000
  return {
    renovatedLow: roundToNearest(midpoint - halfSpread, 5000),
    renovatedHigh: roundToNearest(midpoint + halfSpread, 5000),
  }
}

function calculateConditionRanges(estimated: number | null, low: number | null, high: number | null) {
  const { renovatedLow, renovatedHigh } = buildTightRenovatedRange(estimated, low, high)

  if (!renovatedLow || !renovatedHigh) {
    return {
      original_low: null,
      original_high: null,
      renovated_low: null,
      renovated_high: null,
      well_renovated_low: null,
      well_renovated_high: null,
    }
  }

  return {
    original_low: roundToNearest(renovatedLow * 0.92, 5000),
    original_high: roundToNearest(renovatedHigh * 0.92, 5000),
    renovated_low: renovatedLow,
    renovated_high: renovatedHigh,
    well_renovated_low: roundToNearest(renovatedLow * 1.08, 5000),
    well_renovated_high: roundToNearest(renovatedHigh * 1.08, 5000),
  }
}

function extractBlockNumber(address: string | null | undefined) {
  const match = normaliseText(address).match(/^(\d+[A-Z]?)/)
  return match ? match[1] : ''
}

function extractFloorNumberFromUnit(unitNumber: string | null | undefined) {
  const text = (unitNumber || '').trim()
  if (!text) return null
  const match = text.match(/#?\s*(\d{1,2})\s*[-/]/)
  if (!match) return null
  const level = Number(match[1])
  return Number.isFinite(level) && level > 0 ? level : null
}

function getFloorCategoryFromUnitNumber(unitNumber: string | null | undefined) {
  const level = extractFloorNumberFromUnit(unitNumber)
  if (!level) return ''
  if (level <= 5) return 'Low floor'
  if (level <= 11) return 'Mid floor'
  return 'High floor'
}

function getAgentName(email: string | null | undefined) {
  if (!email) return ''
  return AGENT_NAME_BY_EMAIL[email.toLowerCase()] || ''
}

function inferDefaultTenure(category: PropertyCategory) {
  if (category === 'hdb' || category === 'ec') return '99-year leasehold'
  return ''
}

function formatCurrency(value: number | string | null | undefined) {
  const numberValue = Number(value)
  if (!Number.isFinite(numberValue) || numberValue <= 0) return '—'
  return new Intl.NumberFormat('en-SG', {
    style: 'currency',
    currency: 'SGD',
    maximumFractionDigits: 0,
  }).format(numberValue)
}

async function resolveCanonicalProjectName(params: {
  lat: number
  lon: number
  address: string
  rawProjectName?: string | null
  category: 'condo' | 'ec' | 'landed'
}) {
  const { lat, lon, address, rawProjectName, category } = params
  const rawProjectKey = normaliseText(rawProjectName)
  const addressKey = normaliseText(address)

  let query = supabase
    .from('property_transactions_v2')
    .select('project_name, completion_year, is_strata, latitude, longitude')
    .not('latitude', 'is', null)
    .not('longitude', 'is', null)
    .gte('latitude', lat - 0.004)
    .lte('latitude', lat + 0.004)
    .gte('longitude', lon - 0.004)
    .lte('longitude', lon + 0.004)
    .limit(300)

  if (category === 'condo') query = query.eq('property_subtype', 'condo')
  else if (category === 'ec') query = query.eq('property_subtype', 'ec')
  else query = query.in('property_subtype', ['landed_strata', 'landed_non_strata'])

  const { data } = await query

  if (!data || data.length === 0) {
    return {
      canonicalProjectName: rawProjectKey || null,
      completionYear: null as number | null,
      isStrata: null as boolean | null,
    }
  }

  const candidates = data
    .filter((row: any) => row.project_name)
    .map((row: any) => ({
      projectName: normaliseText(row.project_name),
      completionYear: toNumber(row.completion_year),
      isStrata: typeof row.is_strata === 'boolean' ? row.is_strata : null,
    }))

  const exact = candidates.find((row) => rawProjectKey && row.projectName === rawProjectKey)
  const contained = candidates.find((row) => row.projectName && addressKey.includes(row.projectName))
  const chosen = exact || contained || candidates[0]

  return {
    canonicalProjectName: chosen?.projectName || rawProjectKey || null,
    completionYear: chosen?.completionYear || null,
    isStrata: chosen?.isStrata ?? null,
  }
}

async function getHdbCompletionYear(address: string) {
  const blockNo = extractBlockNumber(address)
  if (!blockNo) return null

  const { data } = await supabase
    .from('property_transactions_v2')
    .select('completion_year')
    .eq('property_group', 'hdb')
    .ilike('address', `${blockNo} %`)
    .not('completion_year', 'is', null)
    .limit(1)

  return data?.[0]?.completion_year ? Number(data[0].completion_year) : null
}

function buildCacheKey(params: {
  postal?: string | null
  unitNumber: string
  category: PropertyCategory
  propertyType: string
  floorAreaSqm: number | null
  landSizeSqm: number | null
  builtUpSqm: number | null
  tenure: string
  floorLevelNumber: number | null
  projectName: string | null
  completionYear: number | null
  isStrata: boolean | null
  blockNo: string
}) {
  if (!params.postal) return undefined

  return [
    params.postal,
    params.unitNumber,
    params.category,
    params.propertyType,
    params.floorAreaSqm ? params.floorAreaSqm.toFixed(2) : '',
    params.landSizeSqm ? params.landSizeSqm.toFixed(2) : '',
    params.builtUpSqm ? params.builtUpSqm.toFixed(2) : '',
    params.category === 'landed' ? params.tenure : '',
    params.floorLevelNumber ?? '',
    params.projectName || '',
    params.completionYear ?? '',
    params.isStrata === null || params.isStrata === undefined ? '' : String(params.isStrata),
    params.blockNo,
  ]
    .join('|')
    .toLowerCase()
}

function Field({
  label,
  value,
  onChange,
  type = 'text',
  placeholder,
  helperText,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  type?: string
  placeholder?: string
  helperText?: string
}) {
  return (
    <label className="block">
      <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.12em] text-[#7B6757]">{label}</span>
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-2xl border border-[#E4D7C6] bg-white px-4 py-3 text-sm outline-none transition focus:border-[#B55A1E]"
      />
      {helperText && <span className="mt-2 block text-xs leading-5 text-[#7B6757]">{helperText}</span>}
    </label>
  )
}

export default function NewManualReportPage() {
  const router = useRouter()
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [user, setUser] = useState<AgentUser | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const [clientName, setClientName] = useState('')
  const [clientPhone, setClientPhone] = useState('')
  const [clientEmail, setClientEmail] = useState('')
  const [address, setAddress] = useState('')
  const [selectedAddress, setSelectedAddress] = useState<OneMapResult | null>(null)
  const [suggestions, setSuggestions] = useState<OneMapResult[]>([])
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [propertyOptionLabel, setPropertyOptionLabel] = useState('')
  const [unitNumber, setUnitNumber] = useState('')
  const [floorAreaSqft, setFloorAreaSqft] = useState('')
  const [landSizeSqft, setLandSizeSqft] = useState('')
  const [builtUpSqft, setBuiltUpSqft] = useState('')
  const [tenure, setTenure] = useState('')
  const [completionYear, setCompletionYear] = useState('')

  const selectedOption = PROPERTY_TYPE_OPTIONS.find((option) => option.label === propertyOptionLabel) || null
  const propertyCategory = selectedOption?.category || null
  const agentName = getAgentName(user?.email)
  const floorCategory = getFloorCategoryFromUnitNumber(unitNumber)

  const isAuthorised = useMemo(() => {
    if (!user?.email) return false
    return AUTHORISED_EMAILS.includes(user.email.toLowerCase())
  }, [user])

  useEffect(() => {
    let mounted = true

    async function initialise() {
      const { data } = await supabase.auth.getSession()
      const email = data.session?.user?.email || null
      if (!mounted) return
      setUser(email ? { email } : null)
      setLoading(false)
    }

    initialise()

    return () => {
      mounted = false
    }
  }, [])

  async function signInWithGoogle() {
    setError(null)
    const redirectTo = `${window.location.origin}/agent/reports/new`
    const { error: signInError } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo },
    })
    if (signInError) setError(signInError.message)
  }

  async function searchAddress(value: string) {
    if (value.trim().length < 3) {
      setSuggestions([])
      setShowSuggestions(false)
      return
    }

    try {
      const res = await fetch(
        `https://www.onemap.gov.sg/api/common/elastic/search?searchVal=${encodeURIComponent(value)}&returnGeom=Y&getAddrDetails=Y&pageNum=1`
      )
      const data = await res.json()
      const results = (data?.results || []) as OneMapResult[]
      setSuggestions(results.slice(0, 8))
      setShowSuggestions(true)
    } catch (addressError) {
      console.error('Address search error:', addressError)
      setSuggestions([])
      setShowSuggestions(false)
    }
  }

  function handleAddressChange(value: string) {
    setAddress(value)
    setSelectedAddress(null)
    setError(null)

    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => searchAddress(value), 300)
  }

  function handleSelectAddress(item: OneMapResult) {
    setSelectedAddress(item)
    setAddress(item.ADDRESS)
    setSuggestions([])
    setShowSuggestions(false)
  }

  function handlePropertyOptionChange(label: string) {
    setPropertyOptionLabel(label)
    const option = PROPERTY_TYPE_OPTIONS.find((item) => item.label === label)
    if (option && !tenure) setTenure(inferDefaultTenure(option.category))
  }

  async function createReport() {
    setError(null)
    setSuccess(null)

    if (!user?.email || !isAuthorised) {
      setError('Please sign in with an authorised NexDoor account first.')
      return
    }

    if (!selectedAddress) {
      setError('Please select an address from the dropdown before generating the report.')
      return
    }

    if (!selectedOption || !propertyCategory) {
      setError('Please select a property type.')
      return
    }

    const lat = Number(selectedAddress.LATITUDE)
    const lon = Number(selectedAddress.LONGITUDE)
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      setError('The selected address does not have usable coordinates. Please select another address result.')
      return
    }

    const floorLevelNumber = extractFloorNumberFromUnit(unitNumber)
    const blockNo = extractBlockNumber(selectedAddress.ADDRESS)
    const floorAreaSqm = propertyCategory === 'landed' ? sqftToSqm(builtUpSqft) : sqftToSqm(floorAreaSqft)
    const landSizeSqm = propertyCategory === 'landed' ? sqftToSqm(landSizeSqft) : null
    const builtUpSqm = propertyCategory === 'landed' ? sqftToSqm(builtUpSqft) : null

    if (!floorAreaSqm || floorAreaSqm <= 0) {
      setError(propertyCategory === 'landed' ? 'Please enter the built-up size in sqft.' : 'Please enter the floor area in sqft.')
      return
    }

    if (propertyCategory === 'landed' && (!landSizeSqm || landSizeSqm <= 0)) {
      setError('Please enter the land size in sqft for landed reports.')
      return
    }

    if (propertyCategory === 'landed' && !tenure) {
      setError('Please select the tenure for landed reports.')
      return
    }

    setCreating(true)

    try {
      let subjectProjectName: string | null = selectedAddress.BUILDING && selectedAddress.BUILDING !== 'NIL'
        ? normaliseText(selectedAddress.BUILDING)
        : null
      let subjectCompletionYear: number | null = toNumber(completionYear)
      let subjectIsStrata: boolean | null = null

      if (propertyCategory === 'hdb') {
        const hdbCompletionYear = subjectCompletionYear || await getHdbCompletionYear(selectedAddress.ADDRESS)
        subjectCompletionYear = hdbCompletionYear
      }

      if (propertyCategory === 'condo' || propertyCategory === 'ec' || propertyCategory === 'landed') {
        const canonical = await resolveCanonicalProjectName({
          lat,
          lon,
          address: selectedAddress.ADDRESS,
          rawProjectName: subjectProjectName,
          category: propertyCategory,
        })
        subjectProjectName = canonical.canonicalProjectName || subjectProjectName
        subjectCompletionYear = subjectCompletionYear || canonical.completionYear
        subjectIsStrata = canonical.isStrata
      }

      const cacheKey = buildCacheKey({
        postal: selectedAddress.POSTAL,
        unitNumber,
        category: propertyCategory,
        propertyType: selectedOption.value,
        floorAreaSqm,
        landSizeSqm,
        builtUpSqm,
        tenure,
        floorLevelNumber,
        projectName: subjectProjectName,
        completionYear: subjectCompletionYear,
        isStrata: subjectIsStrata,
        blockNo: propertyCategory === 'hdb' ? blockNo : '',
      })

      const valuation = await getValuation({
        lat,
        lon,
        floorAreaSqm,
        landSizeSqm: propertyCategory === 'landed' ? landSizeSqm || undefined : undefined,
        builtUpSqm: propertyCategory === 'landed' ? builtUpSqm || undefined : undefined,
        tenure: propertyCategory === 'landed' ? tenure : undefined,
        floorLevel: floorLevelNumber || undefined,
        propertyType: selectedOption.value,
        propertyCategory,
        subjectProjectName,
        subjectCompletionYear,
        subjectIsStrata,
        subjectAddress: propertyCategory === 'hdb' ? selectedAddress.ADDRESS : undefined,
        subjectBlockNo: propertyCategory === 'hdb' ? blockNo : undefined,
        subjectCompletionYearHdb: propertyCategory === 'hdb' ? subjectCompletionYear : undefined,
        cacheKey,
      })

      if (!valuation) {
        setError('Not enough comparable transactions found to generate a HomeValue estimate for this property yet.')
        setCreating(false)
        return
      }

      const ranges = calculateConditionRanges(valuation.estimated, valuation.low, valuation.high)

      const { data: createdReport, error: insertError } = await supabase
        .from('agent_valuation_reports')
        .insert({
          source_type: 'manual',
          lead_id: null,
          client_name: clientName || null,
          client_phone: clientPhone || null,
          client_email: clientEmail || null,
          agent_name: agentName || null,
          property_address: selectedAddress.ADDRESS,
          unit_number: unitNumber || null,
          property_type: selectedOption.value,
          property_category: propertyCategory,
          floor_area_sqm: floorAreaSqm,
          floor_level: floorCategory || null,
          tenure: tenure || null,
          completion_year: subjectCompletionYear,
          subject_lat: lat,
          subject_lon: lon,
          subject_project_name: subjectProjectName,
          land_size_sqm: landSizeSqm,
          built_up_sqm: builtUpSqm,
          subject_is_strata: subjectIsStrata,
          homevalue_estimated_price: valuation.estimated,
          homevalue_estimated_low: valuation.low,
          homevalue_estimated_high: valuation.high,
          radius_used_m: valuation.radius,
          num_of_comps: valuation.comparables,
          valuation_method: valuation.method || null,
          original_low: ranges.original_low,
          original_high: ranges.original_high,
          renovated_low: ranges.renovated_low,
          renovated_high: ranges.renovated_high,
          well_renovated_low: ranges.well_renovated_low,
          well_renovated_high: ranges.well_renovated_high,
          recent_transactions: [],
          competing_listings: [],
          status: 'draft',
        })
        .select('id')
        .single()

      if (insertError) {
        setError(insertError.message)
        setCreating(false)
        return
      }

      setSuccess('Manual report created. Redirecting...')
      router.push(`/agent/reports/report/${createdReport.id}`)
    } catch (createError) {
      console.error(createError)
      setError(createError instanceof Error ? createError.message : 'Unable to create manual report.')
      setCreating(false)
    }
  }

  if (loading) {
    return (
      <main className="min-h-screen bg-[#F7F1E8] px-6 py-10 text-[#231A14]">
        <div className="mx-auto max-w-5xl rounded-3xl border border-[#E4D7C6] bg-white p-8 shadow-sm">
          <p className="text-sm text-[#7B6757]">Loading agent access...</p>
        </div>
      </main>
    )
  }

  if (!user) {
    return (
      <main className="min-h-screen bg-[#F7F1E8] px-6 py-10 text-[#231A14]">
        <section className="mx-auto flex min-h-[70vh] max-w-3xl items-center justify-center">
          <div className="w-full rounded-3xl border border-[#E4D7C6] bg-white p-8 shadow-sm md:p-10">
            <p className="mb-3 text-xs font-semibold uppercase tracking-[0.24em] text-[#B55A1E]">NexDoor Internal</p>
            <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">Create Manual Valuation Report</h1>
            <p className="mt-4 text-sm leading-6 text-[#6F5C4E]">Sign in with your authorised NexDoor Google account to create manual reports.</p>
            <button type="button" onClick={signInWithGoogle} className="mt-8 rounded-2xl bg-[#231A14] px-5 py-4 text-sm font-semibold text-white transition hover:bg-[#3A2B22]">Continue with Google</button>
            {error && <p className="mt-5 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
          </div>
        </section>
      </main>
    )
  }

  if (!isAuthorised) {
    return (
      <main className="min-h-screen bg-[#F7F1E8] px-6 py-10 text-[#231A14]">
        <section className="mx-auto flex min-h-[70vh] max-w-3xl items-center justify-center">
          <div className="w-full rounded-3xl border border-[#E4D7C6] bg-white p-8 shadow-sm md:p-10">
            <p className="mb-3 text-xs font-semibold uppercase tracking-[0.24em] text-[#B55A1E]">Access denied</p>
            <h1 className="text-3xl font-semibold tracking-tight">This page is only for authorised NexDoor agents.</h1>
            <p className="mt-4 text-sm text-[#6F5C4E]">You are signed in as <span className="font-semibold text-[#231A14]">{user.email}</span>.</p>
          </div>
        </section>
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-[#F7F1E8] px-4 py-6 text-[#231A14] md:px-8 md:py-10">
      <div className="mx-auto max-w-5xl space-y-6">
        <header className="rounded-3xl border border-[#E4D7C6] bg-white p-6 shadow-sm md:p-8">
          <div className="flex flex-col gap-5 md:flex-row md:items-start md:justify-between">
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-[0.24em] text-[#B55A1E]">NexDoor HomeValue Report</p>
              <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">Create Manual Valuation Report</h1>
              <p className="mt-3 text-sm text-[#6F5C4E]">This runs the same HomeValue valuation calculation and creates an editable report draft.</p>
            </div>
            <Link href="/agent/reports" className="rounded-2xl border border-[#D7C6B5] px-5 py-3 text-center text-sm font-semibold text-[#231A14] transition hover:bg-[#F7F1E8]">Back to Reports</Link>
          </div>
          {error && <p className="mt-5 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
          {success && <p className="mt-5 rounded-2xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">{success}</p>}
        </header>

        <section className="rounded-3xl border border-[#E4D7C6] bg-white p-6 shadow-sm md:p-8">
          <h2 className="text-xl font-semibold">1. Client Details</h2>
          <div className="mt-6 grid gap-5 md:grid-cols-2">
            <Field label="Client name" value={clientName} onChange={setClientName} />
            <Field label="Prepared by" value={agentName} onChange={() => undefined} helperText="Auto-filled from the signed-in agent account." />
            <Field label="Client phone" value={clientPhone} onChange={setClientPhone} />
            <Field label="Client email" value={clientEmail} onChange={setClientEmail} />
          </div>
        </section>

        <section className="rounded-3xl border border-[#E4D7C6] bg-white p-6 shadow-sm md:p-8">
          <h2 className="text-xl font-semibold">2. Property Details</h2>
          <p className="mt-1 text-sm text-[#6F5C4E]">Select the address from the dropdown so coordinates are saved correctly for valuation and transactions.</p>

          <div className="mt-6 space-y-5">
            <div className="relative">
              <Field label="Property address" value={address} onChange={handleAddressChange} placeholder="Start typing the property address" />
              {showSuggestions && suggestions.length > 0 && (
                <div className="absolute z-20 mt-2 max-h-72 w-full overflow-y-auto rounded-2xl border border-[#E4D7C6] bg-white shadow-lg">
                  {suggestions.map((item, index) => (
                    <button
                      key={`${item.ADDRESS}-${index}`}
                      type="button"
                      onClick={() => handleSelectAddress(item)}
                      className="block w-full border-b border-[#F0E6DA] px-4 py-3 text-left text-sm last:border-b-0 hover:bg-[#FBF7F1]"
                    >
                      <span className="font-semibold text-[#231A14]">{item.BUILDING && item.BUILDING !== 'NIL' ? item.BUILDING : item.ADDRESS}</span>
                      <span className="mt-1 block text-xs text-[#7B6757]">{item.ADDRESS}</span>
                    </button>
                  ))}
                </div>
              )}
              {selectedAddress && <p className="mt-2 text-xs text-green-700">Selected: {selectedAddress.ADDRESS}</p>}
            </div>

            <div className="grid gap-5 md:grid-cols-2">
              <label className="block">
                <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.12em] text-[#7B6757]">Property type</span>
                <select
                  value={propertyOptionLabel}
                  onChange={(event) => handlePropertyOptionChange(event.target.value)}
                  className="w-full rounded-2xl border border-[#E4D7C6] bg-white px-4 py-3 text-sm outline-none transition focus:border-[#B55A1E]"
                >
                  <option value="">Select property type</option>
                  {PROPERTY_TYPE_OPTIONS.map((option) => <option key={option.label} value={option.label}>{option.label}</option>)}
                </select>
              </label>

              {propertyCategory !== 'landed' && (
                <Field label="Unit number" value={unitNumber} onChange={setUnitNumber} placeholder="Example: #12-08" helperText="Floor category will be auto-detected where possible." />
              )}

              {propertyCategory === 'landed' ? (
                <>
                  <Field label="Land size sqft" value={landSizeSqft} onChange={setLandSizeSqft} type="number" />
                  <Field label="Built-up size sqft" value={builtUpSqft} onChange={setBuiltUpSqft} type="number" />
                </>
              ) : (
                <Field label="Floor area sqft" value={floorAreaSqft} onChange={setFloorAreaSqft} type="number" />
              )}

              <label className="block">
                <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.12em] text-[#7B6757]">Tenure / lease</span>
                <select
                  value={tenure}
                  onChange={(event) => setTenure(event.target.value)}
                  className="w-full rounded-2xl border border-[#E4D7C6] bg-white px-4 py-3 text-sm outline-none transition focus:border-[#B55A1E]"
                >
                  <option value="">Select tenure</option>
                  {TENURE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
              </label>

              <Field label="Lease start / completion year" value={completionYear} onChange={setCompletionYear} type="number" helperText="Optional. For HDB, system will try to detect lease start/completion from transaction data." />
            </div>
          </div>
        </section>

        <section className="rounded-3xl border border-[#E4D7C6] bg-white p-6 shadow-sm md:p-8">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 className="text-xl font-semibold">3. Generate HomeValue Report</h2>
              <p className="mt-1 text-sm text-[#6F5C4E]">The estimate, condition ranges and report draft will be created automatically.</p>
            </div>
            <button
              type="button"
              onClick={createReport}
              disabled={creating}
              className="rounded-2xl bg-[#231A14] px-5 py-4 text-sm font-semibold text-white transition hover:bg-[#3A2B22] disabled:opacity-60"
            >
              {creating ? 'Generating...' : 'Generate Valuation Report'}
            </button>
          </div>
        </section>
      </div>
    </main>
  )
}
