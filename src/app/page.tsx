'use client'

import { useRef, useState } from 'react'
import Head from 'next/head'
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


// ─── FAQ data ─────────────────────────────────────────────────────────────────
const FAQ_ITEMS = [
  {
    q: "How does NexDoor HomeValue estimate my property's value?",
    a: 'We analyse recent transaction data from HDB and URA to find comparable properties near your address. Our engine looks at factors like location, floor area, floor level, and property type to produce a market-based estimate.',
  },
  {
    q: 'How recent is the transaction data used?',
    a: 'Our database is updated regularly and includes transactions up to 2026. We prioritise the most recent transactions when calculating your estimate.',
  },
  {
    q: 'Why does my estimate look different from other tools?',
    a: "Different tools use different methodologies, data sources, and update frequencies. Our estimates are based purely on recent transacted prices in the open market — not asking prices or agent opinions.",
  },
  {
    q: 'How accurate is this estimate?',
    a: 'This is an indicative estimate based on comparable market transactions. It is not a formal valuation and should be treated as a starting reference point. Accuracy depends on how many recent comparable transactions exist near your property.',
  },
  {
    q: 'Does this replace a formal valuation from a bank or licensed appraiser?',
    a: 'No. This tool does not replace a formal valuation. Banks, HDB, and legal proceedings require a valuation conducted by a licensed appraiser. This estimate is for general reference only.',
  },
  {
    q: 'Does the tool account for renovations or unique features of my unit?',
    a: 'No. The estimate is based on transacted prices of comparable properties and does not factor in renovation quality, interior condition, orientation, facing, or any unique features of your specific unit.',
  },
  {
    q: "Can property values in Singapore change significantly over a short period?",
    a: "Yes. Singapore's property market can be sensitive to policy changes, interest rate movements, and broader economic conditions. We recommend checking your estimate periodically rather than relying on a single point-in-time figure.",
  },
  {
    q: "What factors affect my home's value the most?",
    a: 'For HDB, key factors include remaining lease, floor level, block location, and proximity to amenities. For private properties, factors include project reputation, tenure, unit facing, floor level, and recent transactions within the development.',
  },
  {
    q: 'Is there a difference between HDB and private property valuations?',
    a: 'Yes. HDB resale valuations are influenced by HDB policies, remaining lease, and ethnic quota restrictions. Private property valuations are driven purely by market forces and are generally more volatile.',
  },
  {
    q: "Can I use this to estimate a property I don't own?",
    a: 'Yes. You can enter any Singapore residential address to get an indicative estimate. This can be useful when researching a property you are considering buying.',
  },
  {
    q: "How often should I check my home's value?",
    a: 'We recommend checking every 3 to 6 months, or after any significant market event such as a policy announcement or interest rate change.',
  },
]

// ─── Stat cards ───────────────────────────────────────────────────────────────
// ─── FAQ accordion ────────────────────────────────────────────────────────────

function AboutHomeValueSection() {
  return (
    <section className="bg-[#f8f1e7]">
      <div className="mx-auto max-w-7xl 2xl:max-w-screen-2xl px-6 pb-6 md:px-10">
        <div className="rounded-[32px] border border-[#ead7c6] bg-[#fffaf5] p-6 shadow-[0_20px_60px_rgba(73,47,28,0.08)] sm:p-8">
          <div className="max-w-4xl">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#b76633]">About HomeValue</p>
            <h2 className="mt-3 text-2xl font-semibold tracking-tight text-[#2d3135] sm:text-3xl">
              A faster way to understand your home’s estimated value
            </h2>
            <p className="mt-4 text-sm leading-7 text-[#5f666d] sm:text-base">
              HomeValue by NexDoor is a free property valuation tool for homeowners in Singapore.
              It uses recent HDB and URA transaction data to estimate values for HDB flats,
              condos, ECs and landed homes.
            </p>
            <p className="mt-4 text-sm leading-7 text-[#5f666d] sm:text-base">
              Use it as a starting point before deciding whether to sell, refinance or simply
              understand where your property may sit in today’s market.
            </p>
          </div>
        </div>
      </div>
    </section>
  )
}

function FaqSection() {
  const [openIndex, setOpenIndex] = useState<number | null>(null)

  return (
    <section className="bg-[#f8f1e7]">
      <div className="mx-auto max-w-7xl 2xl:max-w-screen-2xl px-6 pb-16 md:px-10">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#b76633] mb-3">FAQ</p>
        <h2 className="text-2xl font-semibold text-[#1e2226] mb-8 md:text-3xl">Questions homeowners often ask</h2>
        <div className="rounded-2xl border border-[#ead7c6] bg-white px-6 md:px-8">
          {FAQ_ITEMS.map((item, i) => (
            <div key={i} className="border-b border-[#ead7c6] last:border-b-0">
              <button
                type="button"
                onClick={() => setOpenIndex(openIndex === i ? null : i)}
                className="flex w-full items-center justify-between gap-4 py-5 text-left"
              >
                <span className="text-sm font-semibold text-[#1e2226] leading-snug md:text-base">{item.q}</span>
                <span className={`flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full border-[1.5px] text-sm transition-colors ${openIndex === i ? 'border-[#b76633] bg-[#b76633] text-white' : 'border-[#b09880] text-[#b76633]'}`}>
                  {openIndex === i ? '−' : '+'}
                </span>
              </button>
              {openIndex === i && (
                <div className="border-t border-[#f0ebe4] pb-6 pt-4 text-sm leading-7 text-[#3d4550] md:text-base md:leading-8">
                  {item.a}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

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
    .replace(/\bBUKIT\b/g, 'BT')
    .replace(/\bMOUNT\b/g, 'MT')
    .replace(/\bJALAN\b/g, 'JLN')
    .replace(/\bKAMPONG\b/g, 'KG')
    .replace(/\bLORONG\b/g, 'LOR')
    .replace(/\bUPPER\b/g, 'UPP')
    .replace(/\bTANJONG\b/g, 'TG')
    .replace(/\bCOMMONWEALTH\b/g, "C'WEALTH")
    .replace(/\bAVENUE\b/g, 'AVE')
    .replace(/\bSTREET\b/g, 'ST')
    .replace(/\bROAD\b/g, 'RD')
    .replace(/\bDRIVE\b/g, 'DR')
    .replace(/\bCRESCENT\b/g, 'CRES')
    .replace(/\bPLACE\b/g, 'PL')
    .replace(/\bCLOSE\b/g, 'CL')
    .replace(/\bTERRACE\b/g, 'TER')
    .replace(/\bBOULEVARD\b/g, 'BLVD')
    .replace(/\bCENTRAL\b/g, 'CTRL')
    .replace(/\bHEIGHTS\b/g, 'HTS')
    .replace(/\bNORTH\b/g, 'NTH')
    .replace(/\bSOUTH\b/g, 'STH')
    .replace(/\bGARDENS\b/g, 'GDNS')
    .replace(/\bPARK\b/g, 'PK')
    .replace(/\bMARKET\b/g, 'MKT')
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
  let digitsShown = 0

  const masked = rounded
    .split('')
    .map((char) => {
      if (!/\d/.test(char)) return char
      if (digitsShown < 1) {
        digitsShown += 1
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

function isValidPhone(value: string) {
  const trimmed = value.trim()
  if (trimmed.startsWith('+') || trimmed.startsWith('00')) {
    const digits = trimmed.replace(/\D/g, '')
    return digits.length >= 10 && digits.length <= 15
  }
  const digits = trimmed.replace(/\D/g, '')
  return digits.length === 8
}

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())
}

function getDistanceMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
) {
  const toRad = (deg: number) => (deg * Math.PI) / 180
  const R = 6371000
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

// ─── Loading skeleton component ───────────────────────────────────────────────
function LoadingSkeleton({ category }: { category: 'hdb' | 'condo' | 'ec' | 'landed' }) {
  return (
    <section className="bg-[#f8f1e7]">
      <style>{`
        @keyframes shimmer {
          0% { background-position: -600px 0; }
          100% { background-position: 600px 0; }
        }
        @keyframes loadbar {
          0%   { width: 0%; }
          20%  { width: 25%; }
          50%  { width: 55%; }
          75%  { width: 75%; }
          90%  { width: 88%; }
          100% { width: 95%; }
        }
        @keyframes barshine {
          0%   { background-position: -400px 0; }
          100% { background-position: 400px 0; }
        }
        .sk {
          background: linear-gradient(90deg, #f0ece6 25%, #e8e2da 50%, #f0ece6 75%);
          background-size: 600px 100%;
          animation: shimmer 1.4s infinite;
          border-radius: 8px;
        }
        .load-bar-fill {
          height: 100%;
          border-radius: 99px;
          background: linear-gradient(90deg, #b76633, #b08060, #b76633);
          background-size: 400px 100%;
          animation: loadbar 4s ease-out forwards, barshine 1.2s linear infinite;
          width: 0%;
        }
      `}</style>
      <div className="mx-auto max-w-7xl 2xl:max-w-screen-2xl px-6 pt-6 pb-12 md:px-10">
        {/* Loading bar */}
        <div className="flex flex-col items-center mb-8">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#b76633] mb-3">
            Analysing transactions
          </p>
          <div className="w-full max-w-sm h-1.5 bg-[#ead7c6] rounded-full overflow-hidden">
            <div className="load-bar-fill" />
          </div>
          <LoadingStatusMessage />
        </div>

        {/* Skeleton summary card */}
        <div className="rounded-2xl border border-[#ead7c6] bg-white p-6 shadow-sm md:p-8 mb-10">
          <div className="sk w-36 h-3 mb-5" />
          <div className="sk w-64 h-12 rounded-xl mb-3" />
          <div className="sk w-48 h-3.5 mb-8" />
          <div className="flex gap-8 border-t border-[#ead7c6] pt-6">
            <div className="border-l border-[#ead7c6] pl-6">
              <div className="sk w-16 h-2.5 mb-2" />
              <div className="sk w-24 h-7 rounded-md" />
            </div>
            <div className="border-l border-[#ead7c6] pl-6">
              <div className="sk w-28 h-2.5 mb-2" />
              <div className="sk w-14 h-7 rounded-md" />
              <div className="sk w-20 h-2 mt-2" />
            </div>
          </div>
        </div>

        {/* Skeleton section heading + tabs */}
        <div className="sk w-72 h-6 rounded-md mb-5" />
        {category !== 'landed' && (
          <div className="flex gap-2 mb-6">
            <div className="sk w-28 h-9 rounded-full" />
            <div className="sk w-20 h-9 rounded-full" />
          </div>
        )}

        {/* Skeleton table */}
        <div className="rounded-2xl border border-[#ead7c6] bg-white overflow-hidden">
          <div className="grid grid-cols-4 gap-0 px-5 py-3 border-b border-[#ead7c6]">
            {[36, 60, 32, 40].map((w, i) => (
              <div key={i} className="sk h-3" style={{ width: w }} />
            ))}
          </div>
          {[0,1,2,3,4,5].map((i) => (
            <div key={i} className="grid grid-cols-4 gap-0 px-5 py-4 border-t border-[#f0ebe4]">
              {[48, 160, 56, 72].map((w, j) => (
                <div key={j} className="sk h-3.5" style={{ width: w }} />
              ))}
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

function LoadingStatusMessage() {
  const [msgIndex, setMsgIndex] = useState(0)
  const messages = [
    'Looking up nearby transactions...',
    'Finding comparable properties...',
    'Calculating your home value...',
    'Almost there...',
  ]

  // cycle through messages
  useState(() => {
    const timers = [
      setTimeout(() => setMsgIndex(1), 1200),
      setTimeout(() => setMsgIndex(2), 2400),
      setTimeout(() => setMsgIndex(3), 3400),
    ]
    return () => timers.forEach(clearTimeout)
  })

  return (
    <p className="text-xs text-[#9aa0a6] mt-3 text-center min-h-[18px]">
      {messages[msgIndex]}
    </p>
  )
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
  const [selectedPostal, setSelectedPostal] = useState<string | null>(null)
  const [lookupCandidates, setLookupCandidates] = useState<string[]>([])

  const [estimatedPrice, setEstimatedPrice] = useState<number | null>(null)
  const [estimatedLow, setEstimatedLow] = useState<number | null>(null)
  const [estimatedHigh, setEstimatedHigh] = useState<number | null>(null)
  const [numOfComps, setNumOfComps] = useState<number | null>(null)
  const [radiusUsedM, setRadiusUsedM] = useState<number | null>(null)
  const [subjectCompletionYearState, setSubjectCompletionYearState] = useState<number | null>(null)
  const [subjectIsStrataState, setSubjectIsStrataState] = useState<boolean | null>(null)
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
      completion_year?: number | null
      psf: number
      distance_m: number
    }>
  >([])

  const [isGenerating, setIsGenerating] = useState(false)
  const [formMessage, setFormMessage] = useState('')

  const [activeTab, setActiveTab] = useState<'same' | 'nearby'>('same')

  const [leadFormMessage, setLeadFormMessage] = useState('')
  const [hasTeaser, setHasTeaser] = useState(false)
  const [hasReport, setHasReport] = useState(false)
  const [showUnlockModal, setShowUnlockModal] = useState(false)
  const [isUnlockingReport, setIsUnlockingReport] = useState(false)

  const [leadName, setLeadName] = useState('')
  const [leadPhone, setLeadPhone] = useState('')
  const [leadEmail, setLeadEmail] = useState('')
  const [leadId, setLeadId] = useState<number | null>(null)
  const [partialLeadSaved, setPartialLeadSaved] = useState(false)
  const [showPlanPopup, setShowPlanPopup] = useState(false)
  const [planPopupStep, setPlanPopupStep] = useState<'question' | 'confirm'>('question')
  const [planPopupInteracted, setPlanPopupInteracted] = useState(false)
  const [planPopupDismissed, setPlanPopupDismissed] = useState(false)
  const [showConsultationModal, setShowConsultationModal] = useState(false)
  const [showMismatchModal, setShowMismatchModal] = useState(false)
  const [mismatchMessage, setMismatchMessage] = useState('')
  const [consultName, setConsultName] = useState('')
  const [consultPhone, setConsultPhone] = useState('')
  const [consultEmail, setConsultEmail] = useState('')
  const [consultPlan, setConsultPlan] = useState('')
  const [consultationMessage, setConsultationMessage] = useState('')

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const resultRef = useRef<HTMLDivElement | null>(null)
  const propertyCategory = getPropertyCategoryFromType(propertyType)

  const estimatedPsf = (() => {
    if (!estimatedPrice) return null
    const sqftVal = propertyCategory === 'landed'
      ? Number(builtUpSqm)
      : Number(floorAreaSqm)
    if (!sqftVal || sqftVal <= 0) return null
    return Math.round(estimatedPrice / sqftVal)
  })()
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
    setLeadFormMessage('')
    setEstimatedPrice(null)
    setEstimatedLow(null)
    setEstimatedHigh(null)
    setNumOfComps(null)
    setRadiusUsedM(null)
    setSubjectCompletionYearState(null)
    setSubjectIsStrataState(null)
    setRecentComparables([])
    setHasTeaser(false)
    setHasReport(false)
    setShowUnlockModal(false)
    setLeadId(null)
    setPartialLeadSaved(false)
    setShowPlanPopup(false)
    setPlanPopupDismissed(false)
    setPlanPopupInteracted(false)
    setPlanPopupStep('question')
  }

  const handleAddressChange = (value: string) => {
    setAddress(value)
    setSelectedLat(null)
    setSelectedLon(null)
    setSelectedStreetName(null)
    setSelectedProjectName(null)
    setSelectedPostal(null)
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
    setSelectedPostal(item.POSTAL || null)
    
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

  const handleGenerateReport = async (bypassMismatch = false) => {
    setFormMessage('')
    setLeadFormMessage('')
    setShowUnlockModal(false)
    setHasTeaser(false)
    setHasReport(false)
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
  
    try {
      const resolved = await resolveAddressForGeneration()
    
      if (!resolved) {
        setFormMessage('Could not match this address. Please choose an address from the dropdown.')
        return
      }
    
      setIsGenerating(true)
    
      // Scroll to skeleton immediately
      setTimeout(() => {
        resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }, 100)
  
      let resolvedProjectName = resolved.projectName || null
      let subjectCompletionYear: number | null = null
      let subjectIsStrata: boolean | null = null
      
      // ─── Detect property type from address ───────────────────────────────────────
      const addressLooksLikeHdb = await (async () => {
        const { data } = await supabase
          .from('property_transactions_v2')
          .select('property_group')
          .eq('property_group', 'hdb')
          .gte('latitude', resolved.lat - 0.0003)
          .lte('latitude', resolved.lat + 0.0003)
          .gte('longitude', resolved.lon - 0.0003)
          .lte('longitude', resolved.lon + 0.0003)
          .limit(1)
        return !!(data && data.length > 0)
      })()
      
      if (!bypassMismatch && addressLooksLikeHdb && propertyCategory !== 'hdb') {
        setMismatchMessage(
          'This looks like an HDB address, but you selected a private property type. Please double-check your property type for an accurate estimate.'
        )
        setShowMismatchModal(true)
        setIsGenerating(false)
        return
      }
      
      if (!bypassMismatch && !addressLooksLikeHdb && propertyCategory === 'hdb') {
        setMismatchMessage(
          'This looks like a private property address, but you selected an HDB type. Please double-check your property type for an accurate estimate.'
        )
        setShowMismatchModal(true)
        setIsGenerating(false)
        return
      }
      
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
      
        // ─── Detect condo vs EC mismatch ─────────────────────────────────────────
        if (canonical.canonicalProjectName) {
          const { data: subtypeCheck } = await supabase
            .from('property_transactions_v2')
            .select('property_subtype')
            .ilike('project_name', canonical.canonicalProjectName)
            .not('property_subtype', 'is', null)
            .limit(1)
      
          const detectedSubtype = subtypeCheck?.[0]?.property_subtype
      
          if (!bypassMismatch && detectedSubtype === 'ec' && propertyCategory === 'condo') {
            setMismatchMessage(
              'This looks like an EC development, but you selected a Condominium type. Please select from the "EC / Privatised EC" section for an accurate estimate.'
            )
            setShowMismatchModal(true)
            setIsGenerating(false)
            return
          }
      
          if (!bypassMismatch && detectedSubtype === 'condo' && propertyCategory === 'ec') {
            setMismatchMessage(
              'This looks like a Condominium, but you selected an EC type. Please select from the "Condominium" section for an accurate estimate.'
            )
            setShowMismatchModal(true)
            setIsGenerating(false)
            return
          }
        }
      }

      // For HDB: look up completion year from the block's own transactions
      if (propertyCategory === 'hdb') {
        const subjectBlockNo = (resolved.address || '').toUpperCase().trim().match(/^(\d+[A-Z]?)\s/)?.[1] || ''
        if (subjectBlockNo) {
          const { data: hdbMeta } = await supabase
            .from('property_transactions_v2')
            .select('completion_year')
            .eq('property_group', 'hdb')
            .ilike('address', `${subjectBlockNo} %`)
            .not('completion_year', 'is', null)
            .limit(1)
          if (hdbMeta && hdbMeta[0]?.completion_year) {
            subjectCompletionYear = Number(hdbMeta[0].completion_year)
          }
        }
      }

      const unitNumber = (floorLevel.trim() && stackNumber.trim())
        ? `${floorLevel.trim()}-${stackNumber.trim()}`
        : ''
      const cacheKey = selectedPostal
        ? `${selectedPostal}|${unitNumber}|${propertyCategory}`.toLowerCase()
        : null
  
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
        subjectAddress: propertyCategory === 'hdb' ? resolved.address : undefined,
        subjectBlockNo: propertyCategory === 'hdb'
          ? (resolved.address || '').toUpperCase().trim().match(/^(\d+[A-Z]?)\s/)?.[1] || ''
          : undefined,
        subjectCompletionYearHdb: propertyCategory === 'hdb' ? subjectCompletionYear : undefined,
        cacheKey: cacheKey ?? undefined,
      })
  
      if (!result) {
        setEstimatedPrice(null)
        setEstimatedLow(null)
        setEstimatedHigh(null)
        setNumOfComps(null)
        setRadiusUsedM(null)
        setFormMessage('Not enough comparable transactions found for this property yet.')
        setHasTeaser(false)
        setHasReport(false)
        return
      }
  
      setEstimatedPrice(result.estimated)
      setEstimatedLow(result.low)
      setEstimatedHigh(result.high)
      setNumOfComps(result.comparables)
      setRadiusUsedM(result.radius)
      setSubjectCompletionYearState(subjectCompletionYear)
      setSubjectIsStrataState(subjectIsStrata)
      setHasTeaser(true)
      setHasReport(false)
      setLeadFormMessage('')
      setShowUnlockModal(false)

      void savePartialLead({
        estimated_price: result.estimated,
        estimated_low: result.low,
        estimated_high: result.high,
        num_of_comps: result.comparables,
        radius_used_m: result.radius,
      })
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
      email: normalizedEmail || null,
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


  const buildPartialLeadPayload = (values: {
    estimated_price: number
    estimated_low: number
    estimated_high: number
    num_of_comps: number
    radius_used_m: number
  }) => {
    const fullUnitNumber =
      floorLevel.trim() && stackNumber.trim()
        ? `#${floorLevel.trim()}-${stackNumber.trim()}`
        : null

    return {
      source_page: '/',
      address: address.trim() || null,
      unit_number: fullUnitNumber,
      unit_type: propertyType || null,
      floor_area_sqm:
        propertyCategory === 'landed'
          ? Number(sqftToSqm(builtUpSqm)) || null
          : Number(sqftToSqm(floorAreaSqm)) || null,
      tenure: propertyCategory === 'landed' ? tenure : null,
      estimated_price: values.estimated_price,
      estimated_low: values.estimated_low,
      estimated_high: values.estimated_high,
      num_of_comps: values.num_of_comps,
      radius_used_m: values.radius_used_m,
      status: 'partial',
    }
  }

  const savePartialLead = async (values: {
    estimated_price: number
    estimated_low: number
    estimated_high: number
    num_of_comps: number
    radius_used_m: number
  }) => {
    if (partialLeadSaved) return

    try {
      const partialLeadPayload = buildPartialLeadPayload(values)

      const { error } = await supabase.from('partial_leads').insert([partialLeadPayload])

      if (error) {
        console.error('Partial lead save error:', error)
        return
      }

      setPartialLeadSaved(true)
    } catch (error) {
      console.error('Partial lead save error:', error)
    }
  }

  const handleUnlockFullReport = async () => {
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

    if (leadEmail.trim() && !isValidEmail(leadEmail)) {
      setLeadFormMessage('Please enter a valid email address.')
      return
    }

    if (!estimatedPrice || !estimatedLow || !estimatedHigh || !radiusUsedM) {
      setLeadFormMessage('Could not unlock the full report. Please try again.')
      return
    }

    const lat = selectedLat
    const lon = selectedLon

    if (lat === null || lon === null) {
      setLeadFormMessage('Could not match this address. Please try selecting the address again.')
      return
    }

    try {
      setIsUnlockingReport(true)

      const leadPayload = {
        ...buildLeadPayload(leadName, leadPhone, leadEmail),
        estimated_price: estimatedPrice,
        estimated_low: estimatedLow,
        estimated_high: estimatedHigh,
        num_of_comps: numOfComps,
        radius_used_m: radiusUsedM,
      }

      const { data: insertedLeads, error: leadInsertError } = await supabase
        .from('leads')
        .insert([leadPayload])
        .select('id')

      if (leadInsertError) {
        console.error('Valuation lead save error:', leadInsertError)
        setLeadFormMessage(`Lead save failed: ${leadInsertError.message}`)
        return
      }

      if (insertedLeads && insertedLeads[0]?.id) setLeadId(insertedLeads[0].id)

      const emailResult = await sendLeadEmail(leadPayload)
      if (!emailResult.ok) {
        console.error('Lead saved but email notification failed:', emailResult.error)
      }

      const comparables = await fetchRecentComparables(
        lat,
        lon,
        propertyType,
        propertyCategory,
        radiusUsedM,
        subjectIsStrataState
      )

      setRecentComparables(comparables)
      setHasReport(true)
      setShowUnlockModal(false)

      setTimeout(() => {
        resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }, 100)

      setTimeout(() => {
        setPlanPopupStep('question')
        setPlanPopupDismissed(false)
        setShowPlanPopup(true)
      }, 4000)
    } catch (error) {
      console.error(error)
      setLeadFormMessage('Could not unlock your full report right now. Please try again.')
    } finally {
      setIsUnlockingReport(false)
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

    if (leadEmail.trim() && !isValidEmail(leadEmail)) {
      setLeadFormMessage('Please enter a valid email address.')
      return
    }

    const leadPayload = {
      ...buildLeadPayload(leadName, leadPhone, leadEmail),
      estimated_price: estimatedPrice,
      estimated_low: estimatedLow,
      estimated_high: estimatedHigh,
      num_of_comps: numOfComps,
      radius_used_m: radiusUsedM,
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

  const handlePlanSelect = async (plan: string) => {
    setPlanPopupStep('confirm')

    const updatePayload: Record<string, unknown> = { plan }

    if (leadId) {
      await supabase.from('leads').update(updatePayload).eq('id', leadId)
    }

    const emailPayload = {
      name: leadName,
      phone: leadPhone,
      email: leadEmail,
      address: address,
      plan,
      estimated_price: estimatedPrice,
      source: 'plan_popup',
    }
    await sendLeadEmail(emailPayload)

    setTimeout(() => {
      setPlanPopupDismissed(true)
      setShowPlanPopup(false)
    }, 2500)
  }

  const handlePopupDismiss = () => {
    setPlanPopupDismissed(true)
    setPlanPopupInteracted(true)
    setShowPlanPopup(false)
  }

  const fetchRecentComparables = async (
    lat: number,
    lon: number,
    targetPropertyType: string,
    category: 'hdb' | 'condo' | 'ec' | 'landed',
    preferredRadius?: number,
    subjectIsStrata?: boolean | null
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
        .replace(/\bSINGAPORE\s+\d{6}\b/g, '')
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

    function getLandedCluster(
      streetName: string | null | undefined,
      addressValue: string | null | undefined
    ) {
      const street = getEffectiveStreet(streetName, addressValue)
      if (!street) return ''

      const SUFFIXES = new Set([
        'AVE', 'ST', 'RD', 'DR', 'CRES', 'PL', 'CL', 'LN', 'TER', 'BLVD',
        'CTRL', 'HTS', 'GDNS', 'NTH', 'STH', 'EAST', 'WEST',
        'RISE', 'VIEW', 'WALK', 'GROVE', 'PARK', 'HILL', 'VALE', 'GREEN',
        'GARDEN', 'LINK', 'WAY', 'LOOP', 'RING', 'TURN', 'MOUNT',
        '1', '2', '3', '4', '5', '6', '7', '8', '9', '10',
        '11', '12', '13', '14', '15', '16', '17', '18', '19', '20',
      ])

      const parts = street.split(' ')

      let endIndex = parts.length
      while (endIndex > 1 && SUFFIXES.has(parts[endIndex - 1])) {
        endIndex--
      }

      const cluster = parts.slice(0, endIndex).join(' ')

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
      const LAT_DELTA = 0.018
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
      const LAT_DELTA = 0.014
      const LON_DELTA = 0.014
      query = query
        .gte('latitude', lat - LAT_DELTA)
        .lte('latitude', lat + LAT_DELTA)
        .gte('longitude', lon - LON_DELTA)
        .lte('longitude', lon + LON_DELTA)
        .order('transaction_date', { ascending: false })
        .limit(3000)
    }
  
    if (category === 'landed') {
      const LAT_DELTA = 0.045
      const LON_DELTA = 0.045
      query = query
        .or(
          [
            'unit_type.ilike.%TERRACE%',
            'unit_type.ilike.%SEMI%',
            'unit_type.ilike.%DETACHED%',
            'unit_type.ilike.%BUNGALOW%',
          ].join(',')
        )
        .gte('latitude', lat - LAT_DELTA)
        .lte('latitude', lat + LAT_DELTA)
        .gte('longitude', lon - LON_DELTA)
        .lte('longitude', lon + LON_DELTA)
        .order('transaction_date', { ascending: false })
        .limit(3000)
    
      if (subjectIsStrata === true) {
        query = query.eq('is_strata', true)
      } else {
        query = query.eq('is_strata', false)
      }
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
      const subjStreetForQuery = abbreviateRoadWords((selectedStreetName || '').toUpperCase().trim())
      const subjBlockForQuery = (address || '').toUpperCase().trim().match(/^(\d+[A-Z]?)\b/)?.[1] || ''
    
      // ─── Same Block query (dedicated) ────────────────────────────────────────
      let sameBlockQuery = supabase
        .from('property_transactions_v2')
        .select('address, street_name, project_name, transaction_date, transaction_price, floor_area_sqm, latitude, longitude, unit_type, floor_level, tenure, completion_year')
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
    
      const sameBlockRows = ((sameBlockData || []) as (ComparableRow & { completion_year?: number | null })[])
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
            tenure: row.tenure || null,
            completion_year: row.completion_year ?? null,
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
    
      // ─── Nearby tab: adaptive radius query ───────────────────────────────────
      // Start at 500m, expand to 1km, then 1.5km until 5+ rows found
      const radii = [
        { delta: 500 / 111000, label: '500m' },
        { delta: 1000 / 111000, label: '1km' },
        { delta: 1500 / 111000, label: '1.5km' },
      ]
    
      let nearbyRows: Array<{
        address: string | null
        street_name: string | null
        project_name: string | null
        transaction_date: string | null
        transaction_price: number
        floor_area_sqm: number
        latitude: number
        longitude: number
        unit_type: string | null
        floor_level: string | null
        tenure: string | null
        completion_year: number | null
        distance_m: number
        psf: number
      }> = []
    
      for (const { delta } of radii) {
        const { data: nearbyData } = await supabase
          .from('property_transactions_v2')
          .select('address, street_name, project_name, transaction_date, transaction_price, floor_area_sqm, latitude, longitude, unit_type, floor_level, tenure, completion_year')
          .eq('property_group', 'hdb')
          .eq('unit_type', targetPropertyType)
          .not('transaction_price', 'is', null)
          .not('floor_area_sqm', 'is', null)
          .not('latitude', 'is', null)
          .not('longitude', 'is', null)
          .gte('latitude', lat - delta)
          .lte('latitude', lat + delta)
          .gte('longitude', lon - delta)
          .lte('longitude', lon + delta)
          .order('transaction_date', { ascending: false })
          .limit(200)
    
        const candidates = ((nearbyData || []) as (ComparableRow & { completion_year?: number | null })[])
          .map((row) => {
            const transactionPrice = Number(row.transaction_price)
            const floorArea = Number(row.floor_area_sqm)
            const rowLat = Number(row.latitude)
            const rowLon = Number(row.longitude)
            const floorAreaSqft = floorArea * 10.7639
            const distM = getDistanceMeters(lat, lon, rowLat, rowLon)
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
              tenure: row.tenure || null,
              completion_year: row.completion_year ?? null,
              distance_m: distM,
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
          // Exclude same block rows
          .filter((row) => {
            const rowBlock = (row.address || '').toUpperCase().trim().match(/^(\d+[A-Z]?)\b/)?.[1] || ''
            const rowStreet = abbreviateRoadWords((row.street_name || '').toUpperCase().trim())
            return !(rowBlock === subjBlockForQuery && rowStreet === subjStreetForQuery)
          })
          // Sort by date descending, distance as tiebreaker
          .sort((a, b) => {
            const dateA = a.transaction_date ? new Date(a.transaction_date).getTime() : 0
            const dateB = b.transaction_date ? new Date(b.transaction_date).getTime() : 0
            if (dateB !== dateA) return dateB - dateA
            return a.distance_m - b.distance_m
          })
          .slice(0, 10)
    
        if (candidates.length >= 5) {
          nearbyRows = candidates
          break
        }
    
        // Keep the best we have so far if last radius
        nearbyRows = candidates
      }
    
      return [...sameBlockRows, ...nearbyRows]
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

    if (category === 'landed') {
      const landedOnly = withNormalized.filter((row) => {
        const unitType = normalizeText(row.unit_type)
        return (
          unitType.includes('TERRACE') ||
          unitType.includes('SEMI') ||
          unitType.includes('DETACHED') ||
          unitType.includes('BUNGALOW')
        )
      })

      const seen = new Set<string>()
      const deduped = landedOnly.filter((row) => {
        const key = `${row.address}|${row.transaction_date}|${row.transaction_price}`
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })

      const subjectLandSqm = Number(sqftToSqm(landSizeSqm)) || 0
      const sameStreetRows = deduped.filter(
        (row) => row._normStreet && subjectStreet && row._normStreet === subjectStreet
      )

      function applyFilter(distanceM: number) {
        return deduped.filter((row) => {
          if (row.distance_m > distanceM) return false
          return true
        })
      }

      let withinRange = applyFilter(1500)

      if (withinRange.length < 8) {
        withinRange = applyFilter(2500)
      }
      
      const withinRangeKeys = new Set(withinRange.map(r => `${r.address}|${r.transaction_date}|${r.transaction_price}`))
      for (const row of sameStreetRows) {
        const key = `${row.address}|${row.transaction_date}|${row.transaction_price}`
        if (!withinRangeKeys.has(key)) {
          withinRange.push(row)
          withinRangeKeys.add(key)
        }
      }

      const now = Date.now()

      const subjectFirstWord = (subjectStreet || '').split(' ')[0] || ''

      const scored = withinRange.map((row) => {
        const sameStreet =
          !!row._normStreet &&
          !!subjectStreet &&
          row._normStreet === subjectStreet

        const clusterMatch =
          !sameStreet &&
          !!row._cluster &&
          !!subjectCluster &&
          row._cluster.length >= 3 &&
          subjectCluster.length >= 3 &&
          row._cluster === subjectCluster

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

        const distanceScore = Math.min(
          Math.round((row.distance_m / 1000) * 10),
          50
        )

        const sizeScore =
          row._sizeBand === 'same' ? 0 : row._sizeBand === 'similar' ? 3 : 6

        const txTime = row.transaction_date
          ? new Date(row.transaction_date).getTime()
          : 0
        const monthsAgo =
          txTime > 0 ? (now - txTime) / (1000 * 60 * 60 * 24 * 30) : 50
        const recencyScore = Math.min(Math.round(monthsAgo * 0.3), 15)

        const totalScore = tierScore + distanceScore + sizeScore + recencyScore

        return { ...row, _totalScore: totalScore, _tierScore: tierScore }
      })

      scored.sort((a, b) => {
        const dateA = a.transaction_date ? new Date(a.transaction_date).getTime() : 0
        const dateB = b.transaction_date ? new Date(b.transaction_date).getTime() : 0
        if (dateB !== dateA) return dateB - dateA
        return a.distance_m - b.distance_m
      })

      return scored.slice(0, 15)
    }
  
    return []
  }

  // ─── Mobile card row renderer ─────────────────────────────────────────────
  const renderMobileCard = (
    row: typeof recentComparables[number],
    i: number
  ) => (
    <div
      key={i}
      className="border-b border-[#f0ebe4] px-4 py-4 last:border-b-0"
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <span className="text-sm font-medium text-[#2d3135] leading-snug">
          {propertyCategory === 'landed' ? row.address : row.project_name || row.address}
        </span>
        <span className="text-xs text-[#9aa0a6] whitespace-nowrap flex-shrink-0">
          {formatDate(row.transaction_date)}
        </span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        <span className="text-xs font-medium text-[#2d3135] bg-[#f0ece6] rounded-md px-2 py-1">
          <span className="text-[#b76633] font-semibold">Price: </span>{formatMoney(row.transaction_price)}
        </span>
        <span className="text-xs text-[#67707a] bg-[#f8f1e7] rounded-md px-2 py-1">
          <span className="text-[#b76633] font-semibold">PSF: </span>${Math.round(row.psf).toLocaleString()}
        </span>
        <span className="text-xs text-[#67707a] bg-[#f8f1e7] rounded-md px-2 py-1">
          <span className="text-[#b76633] font-semibold">Size: </span>{sqmToSqft(row.floor_area_sqm)} sqft
        </span>
        {(propertyCategory === 'condo' || propertyCategory === 'ec' || propertyCategory === 'landed') && (
          <span className="text-xs text-[#67707a] bg-[#f8f1e7] rounded-md px-2 py-1">
            <span className="text-[#b76633] font-semibold">Tenure: </span>{formatTenure(row.tenure)}
          </span>
        )}
        <span className="text-xs text-[#67707a] bg-[#f8f1e7] rounded-md px-2 py-1">
          <span className="text-[#b76633] font-semibold">Dist: </span>{Math.round(row.distance_m)}m
        </span>
      </div>
    </div>
  )

  return (
    <>
      <Head>
        <title>Free Property Valuation Singapore | HDB, Condo, EC & Landed | HomeValue by NexDoor</title>
        <meta
          name="description"
          content="Get a fast, data-driven property valuation in Singapore using recent HDB and URA transaction data. Check estimated values for HDB, condo, EC and landed homes."
        />
      </Head>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            '@context': 'https://schema.org',
            '@type': 'FAQPage',
            mainEntity: [
              {
                '@type': 'Question',
                name: 'How is property valuation calculated in Singapore?',
                acceptedAnswer: {
                  '@type': 'Answer',
                  text: 'Property valuation is estimated using recent transaction data, comparable sales, property type, size and location. This tool uses HDB and URA data to provide an indicative value.',
                },
              },
              {
                '@type': 'Question',
                name: 'How accurate is an online property valuation?',
                acceptedAnswer: {
                  '@type': 'Answer',
                  text: 'Online property valuations provide an estimated range based on recent market transactions. They are useful as a starting point but may differ from formal bank or HDB valuations.',
                },
              },
              {
                '@type': 'Question',
                name: 'Can I sell my property above valuation in Singapore?',
                acceptedAnswer: {
                  '@type': 'Answer',
                  text: 'Yes, properties in Singapore can be sold above valuation depending on market demand, location and buyer interest. This is commonly known as Cash Over Valuation (COV).',
                },
              },
              {
                '@type': 'Question',
                name: 'Does this work for HDB, condo and landed property?',
                acceptedAnswer: {
                  '@type': 'Answer',
                  text: 'Yes, this valuation tool covers HDB flats, private condominiums, executive condominiums and landed properties across Singapore.',
                },
              },
            ],
          }),
        }}
      />

      <main className="min-h-screen bg-[#f8f1e7] text-[#2f3438]">
      <header className="border-b border-[#ead7c6] bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-7xl 2xl:max-w-screen-2xl items-center justify-between px-6 py-3 md:px-10">
          <a
            href="https://www.nexdoor.sg"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-block text-3xl tracking-tight text-black transition hover:opacity-80 md:text-4xl"
            style={{ fontFamily: '"Frank Ruehl BT", Georgia, "Times New Roman", serif' }}
          >
            NexDoor.
          </a>

          <button
            type="button"
            onClick={() => setShowConsultationModal(true)}
            className="rounded-full bg-[#b76633] px-6 py-3 text-sm font-semibold text-white shadow-[0_12px_24px_rgba(183,102,51,0.22)] transition hover:bg-[#9f5629]"
          >
            Free Consultation
          </button>
        </div>
      </header>

      <section className="relative overflow-hidden">
        <div className="absolute left-[-120px] top-[-80px] h-72 w-72 rounded-full bg-[#e7b48b]/20 blur-3xl" />
        <div className="absolute right-[-80px] top-[60px] h-80 w-80 rounded-full bg-[#36454f]/10 blur-3xl" />

        <div className="mx-auto grid max-w-7xl 2xl:max-w-screen-2xl grid-cols-1 gap-10 px-6 py-8 md:px-10 lg:grid-cols-[1fr_1fr] lg:items-center lg:py-12">
          
          {/* Hero copy — hidden on mobile, shown on desktop */}
          <div className="hidden lg:block lg:order-1 pt-4">
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[#b76633]">
              HomeValue by NexDoor
            </p>
            <h1 className="mt-5 text-5xl font-semibold leading-[1.15] tracking-tight text-[#2d3135] xl:text-6xl">
              Free Property Valuation in Singapore
              <br />
              for HDB, Condo, EC &amp; Landed Homes
            </h1>
            <p className="mt-5 text-base leading-7 text-[#7a8289]">
              Get a fast estimate based on recent HDB & URA transactions in Singapore.
            </p>
            <div className="mt-10 border-t border-[#ead7c6] pt-8 flex flex-col gap-4">
              <div className="flex items-center gap-3">
                <div className="h-1.5 w-1.5 rounded-full bg-[#b76633] flex-shrink-0" />
                <p className="text-sm text-[#67707a]">Powered by recent HDB &amp; URA data</p>
              </div>
              <div className="flex items-center gap-3">
                <div className="h-1.5 w-1.5 rounded-full bg-[#b76633] flex-shrink-0" />
                <p className="text-sm text-[#67707a]">Covers HDB, condo, EC &amp; landed</p>
              </div>
              <div className="flex items-center gap-3">
                <div className="h-1.5 w-1.5 rounded-full bg-[#b76633] flex-shrink-0" />
                <p className="text-sm text-[#67707a]">Indicative estimate in minutes</p>
              </div>
            </div>
          </div>

          {/* Form card */}
          <div className="order-1 lg:order-2 relative">
            <div className="rounded-[28px] border border-[#ead7c6] bg-white/95 p-6 shadow-[0_24px_70px_rgba(37,42,46,0.10)] backdrop-blur md:p-8">

              {/* Mobile-only compact header above form */}
              <div className="mb-6 lg:hidden">
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#b76633]">HomeValue by NexDoor</p>
                <h2 className="mt-2 text-xl font-semibold text-[#2d3135]">
                  Free Property Valuation in Singapore
                </h2>
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
                    className="w-full rounded-2xl border border-[#d7dde3] bg-[#fcfcfb] px-4 py-3 text-[#2d3135] outline-none transition focus:border-[#b76633] focus:bg-white"
                  />

                  {showSuggestions && suggestions.length > 0 && (
                    <div className="absolute z-30 mt-2 max-h-72 w-full overflow-y-auto rounded-2xl border border-[#ead7c6] bg-white shadow-[0_14px_40px_rgba(37,42,46,0.12)]">
                      {suggestions.map((item, index) => (
                        <button
                          key={`${item.ADDRESS}-${index}`}
                          type="button"
                          onClick={() => handleSelectAddress(item)}
                          className="block w-full border-b border-[#f6ede4] px-4 py-3 text-left text-sm text-[#2d3135] hover:bg-[#fff6ec] last:border-b-0"
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
                    className="w-full rounded-2xl border border-[#d7dde3] bg-[#fcfcfb] px-4 py-3 text-[#2d3135] outline-none transition focus:border-[#b76633] focus:bg-white"
                  >
                    <option value="" disabled>Select a property type</option>
                    <optgroup label="HDB">
                      <option value="2 ROOM">2 Room</option>
                      <option value="3 ROOM">3 Room</option>
                      <option value="4 ROOM">4 Room</option>
                      <option value="5 ROOM">5 Room</option>
                      <option value="EXECUTIVE">Executive</option>
                    </optgroup>
                    <optgroup label="Condominium">
                      <option value="1 BEDROOM">Condo 1 Bed</option>
                      <option value="2 BEDROOM">Condo 2 Bed</option>
                      <option value="3 BEDROOM">Condo 3 Bed</option>
                      <option value="4 BEDROOM">Condo 4 Bed</option>
                      <option value="5 BEDROOM">Condo 5 Bed+</option>
                      <option value="PENTHOUSE">Penthouse</option>
                    </optgroup>
                    <optgroup label="EC / Privatised EC">
                      <option value="2 BEDROOM EC">EC 2 Bed</option>
                      <option value="3 BEDROOM EC">EC 3 Bed</option>
                      <option value="4 BEDROOM EC">EC 4 Bed</option>
                      <option value="5 BEDROOM EC">EC 5 Bed+</option>
                    </optgroup>
                    <optgroup label="Landed">
                      <option value="TERRACE HOUSE">Terrace</option>
                      <option value="SEMI-DETACHED HOUSE">Semi-D</option>
                      <option value="DETACHED HOUSE">Detached</option>
                    </optgroup>
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
                        className="w-full rounded-2xl border border-[#d7dde3] bg-[#fcfcfb] px-4 py-3 text-[#2d3135] outline-none transition focus:border-[#b76633] focus:bg-white"
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
                        className="w-full rounded-2xl border border-[#d7dde3] bg-[#fcfcfb] px-4 py-3 text-[#2d3135] outline-none transition focus:border-[#b76633] focus:bg-white"
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
                          className="w-full rounded-2xl border border-[#d7dde3] bg-[#fcfcfb] px-4 py-3 text-[#2d3135] outline-none transition focus:border-[#b76633] focus:bg-white"
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
                          className="w-full rounded-2xl border border-[#d7dde3] bg-[#fcfcfb] px-4 py-3 text-[#2d3135] outline-none transition focus:border-[#b76633] focus:bg-white"
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
                        className="w-full rounded-2xl border border-[#d7dde3] bg-[#fcfcfb] px-4 py-3 text-[#2d3135] outline-none transition focus:border-[#b76633] focus:bg-white"
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
                      className="w-full rounded-2xl border border-[#d7dde3] bg-[#fcfcfb] px-4 py-3 text-[#2d3135] outline-none transition focus:border-[#b76633] focus:bg-white"
                    />
                  </div>
                )}
                
                <button
                  type="button"
                  onClick={() => handleGenerateReport()}
                  disabled={isGenerating}
                  className="mt-2 rounded-2xl bg-[#2f3438] px-5 py-3.5 text-sm font-semibold text-white shadow-[0_12px_24px_rgba(47,52,56,0.18)] transition hover:bg-[#24292d] disabled:cursor-not-allowed disabled:opacity-70"
                >
                  {isGenerating ? 'Generating...' : 'See My Home Value'}
                </button>

                {formMessage && (
                  <p className="text-sm text-[#b76633]">{formMessage}</p>
                )}
              </div>

            </div>
          </div>
        </div>
      </section>

      {/* CHANGE 1: Show skeleton while generating */}
      {isGenerating && (
        <div ref={resultRef}>
          <LoadingSkeleton category={propertyCategory} />
        </div>
      )}

      {/* CHANGE 4: Removed top padding (py-12 → pt-2 pb-12) to close the gap */}

      {!isGenerating && hasTeaser && !hasReport && (
        <section className="bg-[#f8f1e7]">
          <div
            ref={resultRef}
            className="mx-auto max-w-7xl 2xl:max-w-screen-2xl px-6 pt-2 pb-12 md:px-10"
          >
            <div className="rounded-2xl border border-[#ead7c6] bg-white p-6 shadow-sm md:p-8">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#b76633]">
                Estimated Home Value
              </p>
              <p className="mt-4 text-4xl font-semibold text-[#2d3135] md:text-5xl">
                {formatTeaserMoney(estimatedPrice)}
              </p>
              <p className="mt-3 text-sm leading-7 text-[#6a727a]">
                This is a preview based on your property details. Unlock your full result to see the exact estimated value, valuation range and comparable transactions.
              </p>
              <button
                type="button"
                onClick={() => {
                  setLeadFormMessage('')
                  setShowUnlockModal(true)
                }}
                className="mt-6 rounded-2xl bg-[#2f3438] px-5 py-3.5 text-sm font-semibold text-white shadow-[0_12px_24px_rgba(47,52,56,0.18)] transition hover:bg-[#24292d]"
              >
                Unlock Full Home Value
              </button>
            </div>
          </div>
        </section>
      )}

      {!isGenerating && hasReport && (
        <section className="bg-[#f8f1e7]">
          <div
            ref={resultRef}
            className="mx-auto max-w-7xl 2xl:max-w-screen-2xl px-6 pt-2 pb-12 md:px-10"
          >
            {/* Valuation Summary */}
            <div className="rounded-2xl border border-[#ead7c6] bg-white p-6 shadow-sm md:p-8">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#b76633]">
                Valuation Summary
              </p>
            
              <p className="mt-4 text-4xl font-semibold text-[#2d3135] md:text-5xl">
                {formatMoney(estimatedPrice)}
              </p>
              {(estimatedLow || estimatedHigh) && (
                <p className="mt-2 text-sm text-[#6a727a]">
                  Range: {formatMoney(estimatedLow)} — {formatMoney(estimatedHigh)}
                </p>
              )}
            
              <div className="mt-6 pt-6 border-t border-[#ead7c6] grid grid-cols-2 md:grid-cols-3 gap-0">
                {estimatedPsf && (
                  <div className="pr-6 border-r border-[#ead7c6]">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[#b76633]">Est. PSF</p>
                    <p className="mt-1 text-2xl font-semibold text-[#2d3135]">${estimatedPsf.toLocaleString()}</p>
                  </div>
                )}
                <div className={`${estimatedPsf ? 'px-6' : 'pr-6'} ${(propertyCategory === 'hdb' || propertyCategory === 'condo' || propertyCategory === 'ec') && subjectCompletionYearState ? 'border-r border-[#ead7c6]' : ''}`}>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[#b76633]">Transactions Used</p>
                  <p className="mt-1 text-2xl font-semibold text-[#2d3135]">{numOfComps || 0}</p>
                  {radiusUsedM && (
                    <p className="text-xs text-[#9aa0a6]">within {radiusUsedM}m</p>
                  )}
                </div>
                {subjectCompletionYearState && (propertyCategory === 'hdb' || propertyCategory === 'condo' || propertyCategory === 'ec') && (
                  <div className="pl-6 col-span-2 mt-4 md:col-span-1 md:mt-0">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[#b76633]">
                      {propertyCategory === 'hdb' ? 'Est. Built' : 'TOP Year'}
                    </p>
                    <p className="mt-1 text-2xl font-semibold text-[#2d3135]">{subjectCompletionYearState}</p>
                  </div>
                )}
              </div>
            </div>
      
            {/* Tabs + Comparables */}
            <div className="mt-10">
              <h3 className="text-2xl font-semibold text-[#2d3135]">
                Real Nearby Transactions Around Your Unit
              </h3>
      
              {propertyCategory !== 'landed' && (
                <div className="mt-4 flex gap-2">
                  <button
                    onClick={() => setActiveTab('same')}
                    className={`px-4 py-2 rounded-full text-sm ${
                      activeTab === 'same'
                        ? 'bg-[#2f3438] text-white'
                        : 'bg-white border border-[#ddd]'
                    }`}
                  >
                    {propertyCategory === 'hdb' ? 'Same Block' : 'Same Project'}
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
              )}
      
              {propertyCategory === 'landed' && (
                <p className="mt-4 text-sm text-[#6a727a] italic">
                  Landed property values vary significantly based on layout, condition, and land shape. The estimate above is a starting point — for a more accurate assessment, speak with one of our agents directly.
                </p>
              )}

              {/* CHANGE 2: Mobile = cards, desktop = table */}
              <div className="mt-6 rounded-2xl border border-[#ead7c6] bg-white overflow-hidden">
                {(() => {
                  const tableRows = propertyCategory === 'landed'
                    ? recentComparables
                    : activeTab === 'same'
                    ? propertyCategory === 'condo' || propertyCategory === 'ec'
                      ? sameProjectComparables.length > 0 ? sameProjectComparables : []
                      : sameBlockComparables.length > 0 ? sameBlockComparables : []
                    : propertyCategory === 'condo' || propertyCategory === 'ec'
                    ? nearbyCondoComparables
                    : nearbyHdbComparables

                  return (
                    <>
                      {/* Mobile cards — hidden on md+ */}
                      <div className="md:hidden">
                        {tableRows.map((row, i) => renderMobileCard(row, i))}
                      </div>

                      {/* Desktop table — hidden on mobile */}
                      <div className="hidden md:block overflow-x-auto">
                        <table className="min-w-full text-sm">
                          <thead>
                            <tr className="text-left text-[#6a727a]">
                              <th className="px-4 py-3">Date</th>
                              <th className="px-4 py-3">Address</th>
                              <th className="px-4 py-3">Size</th>
                              <th className="px-4 py-3">Price</th>
                              <th className="px-4 py-3">PSF</th>
                              {(propertyCategory === 'condo' || propertyCategory === 'ec' || propertyCategory === 'landed') && (
                                <th className="px-4 py-3">Tenure</th>
                              )}
                              {propertyCategory === 'hdb' && activeTab === 'nearby' && (
                                <th className="px-4 py-3">Completion</th>
                              )}
                              <th className="px-4 py-3">Distance</th>
                            </tr>
                          </thead>
                          <tbody>
                            {tableRows.map((row, i) => (
                              <tr key={i} className="border-t hover:bg-[#faf8f4] transition">
                                <td className="px-5 py-4">{formatDate(row.transaction_date)}</td>
                                <td className="px-5 py-4">
                                  {propertyCategory === 'landed' ? row.address : row.project_name || row.address}
                                </td>
                                <td className="px-5 py-4">{sqmToSqft(row.floor_area_sqm)} sqft</td>
                                <td className="px-5 py-4">{formatMoney(row.transaction_price)}</td>
                                <td className="px-5 py-4">${Math.round(row.psf).toLocaleString()}</td>
                                {(propertyCategory === 'condo' || propertyCategory === 'ec' || propertyCategory === 'landed') && (
                                  <td className="px-5 py-4">{formatTenure(row.tenure)}</td>
                                )}
                                {propertyCategory === 'hdb' && activeTab === 'nearby' && (
                                  <td className="px-5 py-4">{row.completion_year || '-'}</td>
                                )}
                                <td className="px-5 py-4">{Math.round(row.distance_m)}m</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </>
                  )
                })()}
              </div>
            </div>
          </div>
        </section>
      )}

      {/* CHANGE: FAQ section — always shown */}
      {!isGenerating && <AboutHomeValueSection />}
      {!isGenerating && <FaqSection />}

      {showUnlockModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-lg rounded-[28px] border border-[#ead7c6] bg-white p-6 shadow-[0_20px_60px_rgba(37,42,46,0.18)] md:p-8">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-2xl font-semibold text-[#2d3135]">
                  Your full home value is ready
                </h2>
                <p className="mt-2 text-sm leading-6 text-[#67707a]">
                  Enter your details to reveal the exact estimated value and full valuation range.
                </p>
              </div>

              <button
                type="button"
                onClick={() => setShowUnlockModal(false)}
                className="rounded-full border border-[#ead7c6] px-3 py-1 text-sm text-[#606971] transition hover:bg-[#fff6ec]"
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
                  value={leadName}
                  onChange={(e) => setLeadName(e.target.value)}
                  placeholder="Your name"
                  className="w-full rounded-2xl border border-[#d7dde3] bg-[#fcfcfb] px-4 py-3 text-[#2d3135] outline-none transition focus:border-[#b76633] focus:bg-white"
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
                  className="w-full rounded-2xl border border-[#d7dde3] bg-[#fcfcfb] px-4 py-3 text-[#2d3135] outline-none transition focus:border-[#b76633] focus:bg-white"
                />
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-[#4d555d]">
                  Email (optional)
                </label>
                <input
                  type="email"
                  value={leadEmail}
                  onChange={(e) => setLeadEmail(e.target.value)}
                  placeholder="Your email"
                  className="w-full rounded-2xl border border-[#d7dde3] bg-[#fcfcfb] px-4 py-3 text-[#2d3135] outline-none transition focus:border-[#b76633] focus:bg-white"
                />
              </div>

              <button
                type="button"
                onClick={handleUnlockFullReport}
                disabled={isUnlockingReport}
                className="rounded-2xl bg-[#2f3438] px-5 py-3.5 text-sm font-semibold text-white transition hover:bg-[#24292d] disabled:cursor-not-allowed disabled:opacity-70"
              >
                {isUnlockingReport ? 'Unlocking...' : 'Show My Full Valuation'}
              </button>

              {leadFormMessage && (
                <p className="text-sm text-[#b76633]">{leadFormMessage}</p>
              )}
            </div>
          </div>
        </div>
      )}

      {showMismatchModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-md rounded-[28px] border border-[#ead7c6] bg-white p-8 shadow-[0_20px_60px_rgba(37,42,46,0.18)]">
            <h2 className="text-xl font-semibold text-[#2d3135]">
              Double-check your property type
            </h2>
            <p className="mt-3 text-sm leading-7 text-[#67707a]">
              {mismatchMessage}
            </p>
            <div className="mt-6 flex flex-col gap-3">
              <button
                type="button"
                onClick={() => {
                  setShowMismatchModal(false)
                  setMismatchMessage('')
                  window.scrollTo({ top: 0, behavior: 'smooth' })
                }}
                className="w-full rounded-2xl bg-[#2f3438] px-5 py-3.5 text-sm font-semibold text-white transition hover:bg-[#24292d]"
              >
                Change property type
              </button>
              <button
                type="button"
                onClick={async () => {
                  setShowMismatchModal(false)
                  setMismatchMessage('')
                  await handleGenerateReport(true)
                }}
                className="w-full rounded-2xl border border-[#ead7c6] px-5 py-3.5 text-sm font-semibold text-[#2d3135] transition hover:bg-[#fff6ec]"
              >
                Proceed anyway
              </button>
            </div>
          </div>
        </div>
      )}
      {showConsultationModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-lg rounded-[28px] border border-[#ead7c6] bg-white p-6 shadow-[0_20px_60px_rgba(37,42,46,0.18)] md:p-8">
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
                className="rounded-full border border-[#ead7c6] px-3 py-1 text-sm text-[#606971] transition hover:bg-[#fff6ec]"
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
                  className="w-full rounded-2xl border border-[#d7dde3] bg-[#fcfcfb] px-4 py-3 text-[#2d3135] outline-none transition focus:border-[#b76633] focus:bg-white"
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
                  className="w-full rounded-2xl border border-[#d7dde3] bg-[#fcfcfb] px-4 py-3 text-[#2d3135] outline-none transition focus:border-[#b76633] focus:bg-white"
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
                  className="w-full rounded-2xl border border-[#d7dde3] bg-[#fcfcfb] px-4 py-3 text-[#2d3135] outline-none transition focus:border-[#b76633] focus:bg-white"
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
                  className="w-full rounded-2xl border border-[#d7dde3] bg-[#fcfcfb] px-4 py-3 text-[#2d3135] outline-none transition focus:border-[#b76633] focus:bg-white"
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
                <p className="text-sm text-[#b76633]">{consultationMessage}</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Plan Popup */}
      {showPlanPopup && !planPopupDismissed && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-md rounded-[28px] border border-[#ead7c6] bg-white p-8 shadow-[0_20px_60px_rgba(37,42,46,0.18)] md:max-w-lg md:p-10">
            {planPopupStep === 'question' ? (
              <>
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#b76633]">Quick question</p>
                <h3 className="mt-3 text-xl font-semibold leading-snug text-[#2d3135] md:text-2xl">
                  Now that you know your home&apos;s value, what&apos;s your next move?
                </h3>
                <div className="mt-6 flex flex-col gap-3">
                  {[
                    { label: '🏷️ Thinking of selling', value: 'Thinking of selling' },
                    { label: '🏠 Looking to buy', value: 'Looking to buy' },
                    { label: '📊 Just exploring my options', value: 'Just exploring my options' },
                  ].map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => handlePlanSelect(option.value)}
                      className="w-full rounded-2xl border border-[#ead7c6] bg-[#faf8f4] px-5 py-4 text-left text-sm font-medium text-[#2d3135] transition hover:border-[#b76633] hover:bg-white md:text-base"
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={handlePopupDismiss}
                  className="mt-5 w-full text-center text-xs text-[#9aa0a6] underline underline-offset-2"
                >
                  Maybe later
                </button>
              </>
            ) : (
              /* CHANGE 3: Confirmation card with close button */
              <div className="relative flex flex-col items-center py-4 text-center">
                <button
                  type="button"
                  onClick={handlePopupDismiss}
                  className="absolute top-0 right-0 w-8 h-8 rounded-full border-[1.5px] border-[#2d3135] bg-white text-[#2d3135] text-sm font-medium flex items-center justify-center transition hover:bg-[#2d3135] hover:text-white"
                >
                  ✕
                </button>
                <div className="text-4xl">🎉</div>
                <h3 className="mt-4 text-xl font-semibold text-[#2d3135] md:text-2xl">Thanks {leadName.split(' ')[0]} — one of our agents will be in touch with you shortly.</h3>
                <p className="mt-2 text-sm text-[#6a727a]">We look forward to helping you.</p>
              </div>
            )}
          </div>
        </div>
      )}
      </main>
    </>
  )
}
