'use client'

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

export default function Home() {
  const [address, setAddress] = useState('')
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
    <main className="min-h-screen bg-black px-10 py-10 text-white">
      <div className="max-w-xl">
        <h1 className="mb-6 text-3xl font-bold">Home Valuation</h1>

        <div className="space-y-4">
          <input
            value={address}
            onChange={(e) => handleAddressChange(e.target.value)}
            placeholder="Enter address"
            className="w-full border border-white bg-black p-3 text-white placeholder:text-white/50"
          />

          {selectedLat && selectedLon && (
            <p className="text-sm text-green-400">Address matched successfully.</p>
          )}

          {showSuggestions && suggestions.length > 0 && (
            <div className="border border-white bg-black">
              {suggestions.map((item, index) => (
                <button
                  key={`${item.ADDRESS}-${index}`}
                  type="button"
                  onClick={() => handleSelectAddress(item)}
                  className="block w-full border-b border-white/20 px-3 py-2 text-left text-white hover:bg-white/10 last:border-b-0"
                >
                  {item.ADDRESS}
                </button>
              ))}
            </div>
          )}

          <select
            value={propertyType}
            onChange={(e) => setPropertyType(e.target.value)}
            className="w-full border border-white bg-black p-3 text-white"
          >
            {filteredPropertyOptions.map((option) => (
              <option key={option.label} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>

          <input
            value={floorAreaSqm}
            onChange={(e) => setFloorAreaSqm(e.target.value)}
            placeholder="Size sqm"
            className="w-full border border-white bg-black p-3 text-white placeholder:text-white/50"
          />

          <button
            onClick={handleGenerateReport}
            disabled={isGenerating}
            className="w-full bg-zinc-900 p-3 text-white disabled:opacity-60"
          >
            {isGenerating ? 'Generating...' : 'Generate'}
          </button>

          {formMessage && (
            <p className="text-sm text-white/80">{formMessage}</p>
          )}

          {estimatedPrice && (
            <div className="mt-6 space-y-2 border border-white p-4">
              <p className="text-xl font-bold">
                ${Math.round(estimatedPrice).toLocaleString()}
              </p>
              <p>
                Range: ${Math.round(estimatedLow || 0).toLocaleString()} - $
                {Math.round(estimatedHigh || 0).toLocaleString()}
              </p>
              <p>
                {numOfComps} comps • {radiusUsedM}m
              </p>
            </div>
          )}
        </div>
      </div>
    </main>
  )
}