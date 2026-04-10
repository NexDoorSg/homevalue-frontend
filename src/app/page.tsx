'use client'

import Image from 'next/image'
import { useRef, useState } from 'react'
import { getValuation } from '@/lib/valuation'

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

const PROPERTY_TYPE_OPTIONS: PropertyTypeOption[] = [
  { label: 'HDB 2 Room', value: '2 ROOM', category: 'hdb' },
  { label: 'HDB 3 Room', value: '3 ROOM', category: 'hdb' },
  { label: 'HDB 4 Room', value: '4 ROOM', category: 'hdb' },
  { label: 'HDB 5 Room', value: '5 ROOM', category: 'hdb' },
  { label: 'HDB Executive', value: 'EXECUTIVE', category: 'hdb' },
  { label: 'Condominium', value: 'CONDOMINIUM', category: 'condo' },
  { label: 'Terrace', value: 'TERRACE HOUSE', category: 'landed' },
  { label: 'Semi-D', value: 'SEMI-DETACHED HOUSE', category: 'landed' },
  { label: 'Detached', value: 'DETACHED HOUSE', category: 'landed' },
]

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

function inferPropertyCategory(item: OneMapResult): 'hdb' | 'condo' | 'landed' {
  const text = `${item.ADDRESS || ''} ${item.BUILDING || ''}`.toUpperCase()

  if (item.BLK_NO && item.ROAD_NAME) {
    return 'hdb'
  }

  if (
    text.includes('TERRACE') ||
    text.includes('SEMI-DETACHED') ||
    text.includes('SEMI DETACHED') ||
    text.includes('DETACHED') ||
    text.includes('BUNGALOW')
  ) {
    return 'landed'
  }

  return 'condo'
}

function formatMoney(value: number | null) {
  if (!value) return '$5XX,XXX'
  return `$${Math.round(value).toLocaleString()}`
}

export default function Home() {
  const [address, setAddress] = useState('')
  const [floorLevel, setFloorLevel] = useState('')
  const [stackNumber, setStackNumber] = useState('')
  const [propertyType, setPropertyType] = useState('3 ROOM')
  const [floorAreaSqm, setFloorAreaSqm] = useState('')

  const [suggestions, setSuggestions] = useState<OneMapResult[]>([])
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [selectedLat, setSelectedLat] = useState<number | null>(null)
  const [selectedLon, setSelectedLon] = useState<number | null>(null)
  const [lookupCandidates, setLookupCandidates] = useState<string[]>([])
  const [propertyCategory, setPropertyCategory] = useState<'hdb' | 'condo' | 'landed'>('hdb')

  const [estimatedPrice, setEstimatedPrice] = useState<number | null>(null)
  const [estimatedLow, setEstimatedLow] = useState<number | null>(null)
  const [estimatedHigh, setEstimatedHigh] = useState<number | null>(null)
  const [numOfComps, setNumOfComps] = useState<number | null>(null)
  const [radiusUsedM, setRadiusUsedM] = useState<number | null>(null)

  const [isGenerating, setIsGenerating] = useState(false)
  const [formMessage, setFormMessage] = useState('')

  const debounceRef = useRef<NodeJS.Timeout | null>(null)

  const filteredPropertyOptions = PROPERTY_TYPE_OPTIONS.filter(
    (option) => option.category === propertyCategory
  )

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

  const handleAddressChange = (value: string) => {
    setAddress(value)
    setSelectedLat(null)
    setSelectedLon(null)
    setLookupCandidates([])
    setFormMessage('')
    setEstimatedPrice(null)
    setEstimatedLow(null)
    setEstimatedHigh(null)
    setNumOfComps(null)
    setRadiusUsedM(null)

    if (debounceRef.current) {
      clearTimeout(debounceRef.current)
    }

    debounceRef.current = setTimeout(() => {
      searchAddress(value)
    }, 300)
  }

  const handleSelectAddress = (item: OneMapResult) => {
    const category = inferPropertyCategory(item)

    setAddress(item.ADDRESS)
    setSelectedLat(Number(item.LATITUDE))
    setSelectedLon(Number(item.LONGITUDE))
    setLookupCandidates(buildLookupCandidates(item))
    setPropertyCategory(category)

    const firstOption = PROPERTY_TYPE_OPTIONS.find(
      (option) => option.category === category
    )
    if (firstOption) {
      setPropertyType(firstOption.value)
    }

    setSuggestions([])
    setShowSuggestions(false)
    setFormMessage('')
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

      if (!results.length) {
        return null
      }

      const exactMatch = results.find(
        (item) => cleanAddress(item.ADDRESS || '') === cleanAddress(address)
      )

      const chosen = exactMatch || results[0]
      const lat = Number(chosen.LATITUDE)
      const lon = Number(chosen.LONGITUDE)
      const category = inferPropertyCategory(chosen)

      setSelectedLat(lat)
      setSelectedLon(lon)
      setLookupCandidates(buildLookupCandidates(chosen))
      setPropertyCategory(category)
      setAddress(chosen.ADDRESS)

      return { lat, lon, category }
    } catch (error) {
      console.error('Failed to resolve address for generation:', error)
      return null
    }
  }

  const handleGenerateReport = async () => {
    setFormMessage('')

    if (!address.trim()) {
      setFormMessage('Please enter an address first.')
      return
    }

    if (!propertyType) {
      setFormMessage('Please choose a property type first.')
      return
    }

    if (!floorAreaSqm || Number(floorAreaSqm) <= 0) {
      setFormMessage('Please enter a valid floor area first.')
      return
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
        floorAreaSqm: Number(floorAreaSqm),
        propertyType,
        propertyCategory,
      })

      if (!result) {
        setEstimatedPrice(null)
        setEstimatedLow(null)
        setEstimatedHigh(null)
        setNumOfComps(null)
        setRadiusUsedM(null)
        setFormMessage('Not enough comparable transactions found for this property yet.')
        return
      }

      setEstimatedPrice(result.estimated)
      setEstimatedLow(result.low)
      setEstimatedHigh(result.high)
      setNumOfComps(result.comparables)
      setRadiusUsedM(result.radius)
      setFormMessage('Valuation generated successfully.')
    } catch (err) {
      console.error(err)
      setFormMessage('Error generating valuation.')
    } finally {
      setIsGenerating(false)
    }
  }

  return (
    <main className="min-h-screen bg-[#f7f4ef] text-[#2f3438]">
      <header className="border-b border-[#e8ddd2] bg-white/90 backdrop-blur">
  <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-2 md:px-10">
    <div className="flex items-center gap-3">
      <Image
        src="/nexdoor-logo.png"
        alt="NexDoor"
        width={320}
        height={84}
        className="h-30 w-auto md:h-32 object-contain"
        priority
      />
    </div>

    <button
      type="button"
      className="rounded-full bg-[#2f3438] px-5 py-3 text-sm font-semibold text-white shadow-[0_12px_24px_rgba(47,52,56,0.18)] transition hover:bg-[#24292d]"
    >
      Free Consultation
    </button>
  </div>
</header>

      <section className="relative overflow-hidden">
        <div className="absolute left-[-120px] top-[-80px] h-72 w-72 rounded-full bg-[#d8c0a8]/20 blur-3xl" />
        <div className="absolute right-[-80px] top-[60px] h-80 w-80 rounded-full bg-[#36454f]/10 blur-3xl" />

        <div className="mx-auto grid max-w-7xl gap-14 px-6 py-12 md:px-10 lg:grid-cols-[1.05fr_0.95fr] lg:items-start lg:py-20">
          <div className="pt-4">
            <div className="inline-flex rounded-full border border-[#dcc8b5] bg-white px-4 py-2 text-sm font-medium text-[#8b6b52] shadow-sm">
              HomeValue by NexDoor
            </div>

            <p className="mt-6 text-sm font-semibold uppercase tracking-[0.22em] text-[#8b6b52]">
              Trusted by 80+ homeowners across Singapore
            </p>

            <h1 className="mt-4 max-w-4xl text-4xl font-semibold leading-tight tracking-tight text-[#2d3135] md:text-6xl">
              Get Your Real Home Value —
              <span className="block text-[#8b6b52]">Not Just an Estimate</span>
            </h1>

            <p className="mt-5 max-w-2xl text-base leading-7 text-[#616971] md:text-lg">
              See what buyers are actually paying near you, based on real transaction
              data in 2026. No guesswork. No obligation.
            </p>

            <div className="mt-8 grid gap-4 sm:grid-cols-3">
              <div className="rounded-2xl border border-[#e8ddd2] bg-white p-5 shadow-[0_10px_30px_rgba(0,0,0,0.04)]">
                <p className="text-sm text-[#8b6b52]">Nearby sales</p>
                <p className="mt-2 text-lg font-semibold text-[#2d3135]">Matched to your area</p>
              </div>

              <div className="rounded-2xl border border-[#e8ddd2] bg-white p-5 shadow-[0_10px_30px_rgba(0,0,0,0.04)]">
                <p className="text-sm text-[#8b6b52]">Clear valuation</p>
                <p className="mt-2 text-lg font-semibold text-[#2d3135]">Built on real market evidence</p>
              </div>

              <div className="rounded-2xl border border-[#e8ddd2] bg-white p-5 shadow-[0_10px_30px_rgba(0,0,0,0.04)]">
                <p className="text-sm text-[#8b6b52]">Useful insights</p>
                <p className="mt-2 text-lg font-semibold text-[#2d3135]">Designed for homeowners</p>
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

          <div className="relative">
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
                    {filteredPropertyOptions.map((option) => (
                      <option key={option.label} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>

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
                  <p className="text-sm text-[#8b6b52]">
                    Prefer a human breakdown? WhatsApp us at 8988 2212
                  </p>
                </div>

                {formMessage && (
                  <p
                    className={`text-sm ${
                      formMessage.toLowerCase().includes('success')
                        ? 'text-green-600'
                        : 'text-[#8b6b52]'
                    }`}
                  >
                    {formMessage}
                  </p>
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
                  {formatMoney(estimatedPrice)}
                </p>
                <p className="mt-2 text-sm text-[#6a727a]">
                  Based on nearby transaction evidence
                </p>
              </div>

              <div className="rounded-2xl border border-[#e5dbcf] bg-white p-5 shadow-sm">
                <p className="text-sm text-[#8b6b52]">Comparable Evidence</p>
                <p className="mt-2 text-lg font-semibold text-[#2d3135]">
                  {numOfComps ? `${numOfComps} nearby transactions` : 'Waiting for valuation'}
                </p>
                <p className="mt-1 text-sm text-[#6a727a]">
                  {radiusUsedM
                    ? `Search radius used: ${radiusUsedM}m`
                    : 'Generate a report to view supporting data'}
                </p>
              </div>
            </div>

            {(estimatedLow || estimatedHigh) && (
              <div className="mt-4 rounded-2xl border border-[#e5dbcf] bg-white p-5 shadow-sm">
                <p className="text-sm text-[#8b6b52]">Indicative Range</p>
                <p className="mt-2 text-lg font-semibold text-[#2d3135]">
                  {formatMoney(estimatedLow)} - {formatMoney(estimatedHigh)}
                </p>
              </div>
            )}
          </div>
        </div>
      </section>

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
    </main>
  )
}
