'use client'

import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../../../lib/supabase'

type AgentUser = {
  email: string
}

type Lead = {
  id: number
  created_at: string | null
  name: string | null
  phone: string | null
  email: string | null
  address: string | null
  unit_number: string | null
  unit_type: string | null
  floor_area_sqm: number | string | null
  floor_level?: string | null
  tenure: string | null
  completion_year: number | null
  subject_lat: number | string | null
  subject_lon: number | string | null
  estimated_price: number | string | null
  estimated_low: number | string | null
  estimated_high: number | string | null
  radius_used_m: number | null
  num_of_comps: number | null
  status: string | null
  plan: string | null
}

type CompetingListing = {
  title: string
  listing_url: string
  asking_price: string
  size_sqft: string
  psf: string
  condition: string
  source: string
  notes: string
}

type RecentTransaction = {
  id: number | string
  transaction_date: string
  display_name: string
  project_name: string
  address: string
  unit_type: string
  floor_area_sqft: number
  floor_level: string
  transaction_price: number
  price_psf: number
  distance_m: number
}

type ReportForm = {
  id: number | null
  lead_id: number | null
  source_type: 'homevalue_lead' | 'manual'
  client_name: string
  client_phone: string
  client_email: string
  agent_name: string
  property_address: string
  unit_number: string
  property_type: string
  floor_area_sqm: string
  floor_level: string
  tenure: string
  completion_year: string
  subject_lat: string
  subject_lon: string
  homevalue_estimated_price: string
  homevalue_estimated_low: string
  homevalue_estimated_high: string
  radius_used_m: string
  num_of_comps: string
  original_low: string
  original_high: string
  renovated_low: string
  renovated_high: string
  well_renovated_low: string
  well_renovated_high: string
  recent_transactions: RecentTransaction[]
  competing_listings: CompetingListing[]
  suggested_asking_price: string
  consultant_notes: string
  status: 'draft' | 'ready' | 'archived'
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

const EMPTY_LISTING: CompetingListing = {
  title: '',
  listing_url: '',
  asking_price: '',
  size_sqft: '',
  psf: '',
  condition: '',
  source: 'PropertyGuru',
  notes: '',
}

function toNumber(value: number | string | null | undefined) {
  if (value === null || value === undefined) return null
  if (typeof value === 'string' && value.trim() === '') return null

  const numberValue = Number(value)
  return Number.isFinite(numberValue) ? numberValue : null
}

function toCoordinateInput(value: number | string | null | undefined) {
  const numberValue = toNumber(value)
  if (!numberValue || !Number.isFinite(numberValue)) return ''
  return String(numberValue)
}

function isValidSingaporeCoordinate(lat: number | null, lon: number | null) {
  if (!lat || !lon || !Number.isFinite(lat) || !Number.isFinite(lon)) return false
  return lat >= 1.1 && lat <= 1.55 && lon >= 103.55 && lon <= 104.1
}

function toInputValue(value: number | string | null | undefined) {
  if (value === null || value === undefined) return ''
  return String(value)
}

function sqmToSqftInput(value: number | string | null | undefined) {
  const sqm = Number(value)
  if (!Number.isFinite(sqm) || sqm <= 0) return ''
  return String(Math.round(sqm * 10.7639))
}

function sqftToSqm(value: number | string | null | undefined) {
  const sqft = Number(value)
  if (!Number.isFinite(sqft) || sqft <= 0) return null
  return sqft / 10.7639
}

function normaliseText(value: string | null | undefined) {
  return (value || '').toUpperCase().trim()
}

function inferTenureFromPropertyType(propertyType: string | null | undefined) {
  const normalised = normaliseText(propertyType)

  if (
    normalised.includes('ROOM') ||
    normalised.includes('EXECUTIVE') ||
    normalised.includes('EC')
  ) {
    return '99-year leasehold'
  }

  return ''
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

function getEstimatedRemainingLease(
  tenure: string | null | undefined,
  completionYear: string | number | null | undefined,
  propertyType?: string | null
) {
  const inferredTenure = tenure || inferTenureFromPropertyType(propertyType)
  const normalisedTenure = normaliseText(inferredTenure)
  const year = Number(completionYear)

  if (normalisedTenure.includes('FREEHOLD')) return 'Not applicable for freehold'

  let leaseTerm: number | null = null
  if (normalisedTenure.includes('999')) leaseTerm = 999
  else if (normalisedTenure.includes('99')) leaseTerm = 99

  if (!leaseTerm) return '—'
  if (!Number.isFinite(year) || year <= 0) return 'Enter lease start / completion year'

  const currentYear = new Date().getFullYear()
  const remainingYears = Math.max(0, Math.round(year + leaseTerm - currentYear))
  return `${remainingYears} years remaining`
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

function formatDate(value: string | null | undefined) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString('en-SG', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}

function getTransactionTimestamp(value: string | null | undefined) {
  if (!value) return 0
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? 0 : date.getTime()
}

function formatDistance(value: number | string | null | undefined) {
  const distance = Number(value)
  if (!Number.isFinite(distance) || distance < 0) return '—'
  if (distance >= 1000) return `${(distance / 1000).toFixed(1)}km`
  return `${Math.round(distance)}m`
}

function distanceInMeters(lat1: number, lon1: number, lat2: number, lon2: number) {
  const earthRadius = 6371000
  const toRadians = (degree: number) => (degree * Math.PI) / 180
  const dLat = toRadians(lat2 - lat1)
  const dLon = toRadians(lon2 - lon1)
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(lat1)) *
      Math.cos(toRadians(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2)
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return earthRadius * c
}

function getBoundingBox(lat: number, lon: number, radiusM: number) {
  const latDelta = radiusM / 111000
  const cosLat = Math.cos((lat * Math.PI) / 180)
  const safeCosLat = Math.max(Math.abs(cosLat), 0.2)
  const lonDelta = radiusM / (111000 * safeCosLat)

  return {
    minLat: lat - latDelta,
    maxLat: lat + latDelta,
    minLon: lon - lonDelta,
    maxLon: lon + lonDelta,
  }
}

function normaliseComparableText(value: string | null | undefined) {
  return normaliseText(value).replace(/[-_/]/g, ' ').replace(/\s+/g, ' ').trim()
}

function extractBlockNumber(address: string | null | undefined) {
  const text = normaliseComparableText(address)
  if (!text) return ''
  const match = text.match(/^(\d+[A-Z]?)/)
  return match ? match[1] : ''
}

function getBedroomCount(value: string | null | undefined) {
  const text = normaliseComparableText(value)
  const match = text.match(/\b([1-6])\s*(BEDROOM|BED|BR)\b/)
  return match ? Number(match[1]) : null
}

function getReportPropertyCategory(propertyType: string | null | undefined): 'hdb' | 'condo' | 'ec' | 'landed' {
  const text = normaliseComparableText(propertyType)

  if (/\b[2345]\s*ROOM\b/.test(text) || text === 'EXECUTIVE') return 'hdb'
  if (text.includes('TERRACE') || text.includes('SEMI') || text.includes('DETACHED') || text.includes('BUNGALOW') || text.includes('GCB')) return 'landed'
  if (text.includes(' EC') || text.endsWith(' EC') || text.includes('EXECUTIVE CONDOMINIUM')) return 'ec'

  return 'condo'
}

function getLandedGroup(value: string | null | undefined) {
  const text = normaliseComparableText(value)
  if (text.includes('TERRACE')) return 'terrace'
  if (text.includes('SEMI')) return 'semi'
  if (text.includes('DETACHED') || text.includes('BUNGALOW') || text.includes('GCB')) return 'detached'
  return 'other'
}

function isSameProject(form: ReportForm, projectName: string | null | undefined) {
  const project = normaliseComparableText(projectName)
  const address = normaliseComparableText(form.property_address)
  if (!project || !address) return false
  return address.includes(project) || project.includes(address)
}

function similarityScore(subject: number | null, comparable: number | null) {
  if (!subject || !comparable || subject <= 0 || comparable <= 0) return 0
  const ratioDiff = Math.abs(comparable - subject) / subject
  return Math.max(0, 1 - Math.min(ratioDiff, 1))
}

function getRecentTransactionRadius(propertyCategory: 'hdb' | 'condo' | 'ec' | 'landed') {
  if (propertyCategory === 'hdb') return 1200
  if (propertyCategory === 'landed') return 5000
  return 2000
}

function removeSingaporePostal(value: string | null | undefined) {
  return normaliseComparableText(value)
    .replace(/\bSINGAPORE\b/g, ' ')
    .replace(/\b\d{6}\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function getStreetLikeSearchTerm(address: string | null | undefined) {
  const cleaned = removeSingaporePostal(address)
  if (!cleaned) return ''

  return cleaned
    .replace(/^\d+[A-Z]?\s+/, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function getProjectLikeSearchTerm(address: string | null | undefined) {
  const cleaned = removeSingaporePostal(address)
  if (!cleaned) return ''

  const withoutLeadingNumber = cleaned.replace(/^\d+[A-Z]?\s+/, '').trim()
  const words = withoutLeadingNumber.split(' ').filter((word) => word.length >= 4 && !/^\d+$/.test(word))

  if (words.length >= 2) {
    const tail = words.slice(-2).join(' ')
    if (tail.length >= 6) return tail
  }

  return words[0] || withoutLeadingNumber
}

function getTextSearchTerm(form: ReportForm, propertyCategory: 'hdb' | 'condo' | 'ec' | 'landed') {
  if (propertyCategory === 'hdb' || propertyCategory === 'landed') {
    return getStreetLikeSearchTerm(form.property_address)
  }

  return getProjectLikeSearchTerm(form.property_address)
}

function buildTextSearchOrFilter(searchTerm: string) {
  const safeTerm = searchTerm.replace(/[(),]/g, ' ').replace(/\s+/g, ' ').trim()
  if (!safeTerm) return ''

  const primary = safeTerm.length > 28 ? safeTerm.slice(0, 28).trim() : safeTerm
  const firstWord = primary.split(' ').find((word) => word.length >= 4) || primary

  if (!firstWord) return ''

  return `address.ilike.%${firstWord}%,project_name.ilike.%${firstWord}%`
}

async function resolveReferenceCoordinates(form: ReportForm, propertyCategory: 'hdb' | 'condo' | 'ec' | 'landed') {
  const lat = toNumber(form.subject_lat)
  const lon = toNumber(form.subject_lon)

  if (isValidSingaporeCoordinate(lat, lon)) {
    return { lat: lat as number, lon: lon as number, source: 'saved' as const }
  }

  const searchTerm = getTextSearchTerm(form, propertyCategory)
  const textFilter = buildTextSearchOrFilter(searchTerm)

  if (!textFilter) return null

  let query = supabase
    .from('property_transactions_v2')
    .select('latitude, longitude, address, project_name, unit_type, property_group, property_subtype, transaction_date')
    .not('latitude', 'is', null)
    .not('longitude', 'is', null)
    .order('transaction_date', { ascending: false })
    .limit(20)

  if (propertyCategory === 'hdb') {
    query = query.eq('property_group', 'hdb')
  } else if (propertyCategory === 'condo') {
    query = query.eq('property_subtype', 'condo')
  } else if (propertyCategory === 'ec') {
    query = query.eq('property_subtype', 'ec')
  } else {
    query = query.in('property_subtype', ['landed_strata', 'landed_non_strata'])
  }

  query = query.or(textFilter)

  const { data, error } = await query

  if (error || !data || data.length === 0) return null

  const validRows = data
    .map((row: any) => ({ lat: toNumber(row.latitude), lon: toNumber(row.longitude) }))
    .filter((row) => isValidSingaporeCoordinate(row.lat, row.lon)) as { lat: number; lon: number }[]

  if (validRows.length === 0) return null

  const averageLat = validRows.reduce((sum, row) => sum + row.lat, 0) / validRows.length
  const averageLon = validRows.reduce((sum, row) => sum + row.lon, 0) / validRows.length

  return { lat: averageLat, lon: averageLon, source: 'derived' as const }
}

function getTransactionScore(form: ReportForm, row: any, distanceM: number) {
  const propertyCategory = getReportPropertyCategory(form.property_type)
  const subjectAreaSqm = sqftToSqm(form.floor_area_sqm)
  const rowAreaSqm = toNumber(row.floor_area_sqm)
  const sizeScore = similarityScore(subjectAreaSqm, rowAreaSqm)
  const distanceScore = 1 / Math.max(distanceM, 80)
  const rowDate = row.transaction_date ? new Date(row.transaction_date).getTime() : 0
  const recencyScore = rowDate > 0 ? rowDate / 10000000000000 : 0

  if (propertyCategory === 'hdb') {
    const sameBlock = extractBlockNumber(form.property_address) && extractBlockNumber(form.property_address) === extractBlockNumber(row.address)
    return (sameBlock ? 500 : 0) + sizeScore * 120 + distanceScore * 10000 + recencyScore
  }

  if (propertyCategory === 'condo' || propertyCategory === 'ec') {
    const sameProject = isSameProject(form, row.project_name)
    const sameBedroom = getBedroomCount(form.property_type) && getBedroomCount(form.property_type) === getBedroomCount(row.unit_type)
    const sameUnitType = normaliseComparableText(form.property_type) === normaliseComparableText(row.unit_type)
    return (sameProject ? 600 : 0) + (sameUnitType || sameBedroom ? 220 : 0) + sizeScore * 140 + distanceScore * 10000 + recencyScore
  }

  const subjectGroup = getLandedGroup(form.property_type)
  const rowGroup = getLandedGroup(row.unit_type)
  const sameLandedGroup = subjectGroup !== 'other' && subjectGroup === rowGroup
  const subjectTenure = normaliseComparableText(form.tenure).replace(' YEAR LEASEHOLD', '')
  const sameTenure = Boolean(subjectTenure && normaliseComparableText(row.tenure).includes(subjectTenure))

  if (subjectGroup === 'detached') {
    return sizeScore * 260 + (sameLandedGroup ? 180 : 0) + (sameTenure ? 50 : 0) + distanceScore * 8000 + recencyScore
  }

  return (sameLandedGroup ? 260 : 0) + sizeScore * 180 + (sameTenure ? 50 : 0) + distanceScore * 8000 + recencyScore
}

function normaliseRecentTransactions(value: unknown): RecentTransaction[] {
  if (!Array.isArray(value)) return []

  return value.map((item, index) => {
    const row = item as Partial<RecentTransaction>
    return {
      id: row.id ?? index,
      transaction_date: row.transaction_date || '',
      display_name: row.display_name || '',
      project_name: row.project_name || '',
      address: row.address || '',
      unit_type: row.unit_type || '',
      floor_area_sqft: Number(row.floor_area_sqft) || 0,
      floor_level: row.floor_level || '',
      transaction_price: Number(row.transaction_price) || 0,
      price_psf: Number(row.price_psf) || 0,
      distance_m: Number(row.distance_m) || 0,
    }
  })
}

function roundToNearest(value: number, nearest = 5000) {
  return Math.round(value / nearest) * nearest
}

function buildTightRenovatedRange(estimated: number | null, low: number | null, high: number | null) {
  const midpoint = estimated && estimated > 0 ? estimated : low && high ? (low + high) / 2 : null

  if (!midpoint || !Number.isFinite(midpoint)) {
    return {
      renovatedLow: null,
      renovatedHigh: null,
    }
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
      original_low: '',
      original_high: '',
      renovated_low: '',
      renovated_high: '',
      well_renovated_low: '',
      well_renovated_high: '',
    }
  }

  return {
    original_low: String(roundToNearest(renovatedLow * 0.92, 5000)),
    original_high: String(roundToNearest(renovatedHigh * 0.92, 5000)),
    renovated_low: String(renovatedLow),
    renovated_high: String(renovatedHigh),
    well_renovated_low: String(roundToNearest(renovatedLow * 1.08, 5000)),
    well_renovated_high: String(roundToNearest(renovatedHigh * 1.08, 5000)),
  }
}

function normaliseListings(value: unknown): CompetingListing[] {
  if (!Array.isArray(value)) {
    return [{ ...EMPTY_LISTING }, { ...EMPTY_LISTING }, { ...EMPTY_LISTING }]
  }

  const rows = value.slice(0, 3).map((item) => {
    const row = item as Partial<CompetingListing>
    return {
      title: row.title || '',
      listing_url: row.listing_url || '',
      asking_price: row.asking_price ? String(row.asking_price) : '',
      size_sqft: row.size_sqft ? String(row.size_sqft) : '',
      psf: row.psf ? String(row.psf) : '',
      condition: row.condition || '',
      source: row.source || 'PropertyGuru',
      notes: row.notes || '',
    }
  })

  while (rows.length < 3) rows.push({ ...EMPTY_LISTING })
  return rows
}

function getAgentName(email: string | null | undefined) {
  if (!email) return ''
  return AGENT_NAME_BY_EMAIL[email.toLowerCase()] || ''
}

function buildFormFromLead(lead: Lead, userEmail: string): ReportForm {
  const estimated = toNumber(lead.estimated_price)
  const low = toNumber(lead.estimated_low)
  const high = toNumber(lead.estimated_high)
  const ranges = calculateConditionRanges(estimated, low, high)

  return {
    id: null,
    lead_id: lead.id,
    source_type: 'homevalue_lead',
    client_name: lead.name || '',
    client_phone: lead.phone || '',
    client_email: lead.email || '',
    agent_name: getAgentName(userEmail),
    property_address: lead.address || '',
    unit_number: lead.unit_number || '',
    property_type: lead.unit_type || '',
    floor_area_sqm: sqmToSqftInput(lead.floor_area_sqm),
    floor_level: lead.floor_level || getFloorCategoryFromUnitNumber(lead.unit_number),
    tenure: lead.tenure || inferTenureFromPropertyType(lead.unit_type),
    completion_year: toInputValue(lead.completion_year),
    subject_lat: toCoordinateInput(lead.subject_lat),
    subject_lon: toCoordinateInput(lead.subject_lon),
    homevalue_estimated_price: toInputValue(lead.estimated_price),
    homevalue_estimated_low: toInputValue(lead.estimated_low),
    homevalue_estimated_high: toInputValue(lead.estimated_high),
    radius_used_m: toInputValue(lead.radius_used_m),
    num_of_comps: toInputValue(lead.num_of_comps),
    ...ranges,
    recent_transactions: [],
    competing_listings: [{ ...EMPTY_LISTING }, { ...EMPTY_LISTING }, { ...EMPTY_LISTING }],
    suggested_asking_price: '',
    consultant_notes: '',
    status: 'draft',
  }
}

function buildFormFromReport(report: any): ReportForm {
  return {
    id: report.id || null,
    lead_id: report.lead_id || null,
    source_type: report.source_type || 'homevalue_lead',
    client_name: report.client_name || '',
    client_phone: report.client_phone || '',
    client_email: report.client_email || '',
    agent_name: report.agent_name || '',
    property_address: report.property_address || '',
    unit_number: report.unit_number || '',
    property_type: report.property_type || '',
    floor_area_sqm: sqmToSqftInput(report.floor_area_sqm),
    floor_level: report.floor_level || getFloorCategoryFromUnitNumber(report.unit_number),
    tenure: report.tenure || inferTenureFromPropertyType(report.property_type),
    completion_year: toInputValue(report.completion_year),
    subject_lat: toCoordinateInput(report.subject_lat),
    subject_lon: toCoordinateInput(report.subject_lon),
    homevalue_estimated_price: toInputValue(report.homevalue_estimated_price),
    homevalue_estimated_low: toInputValue(report.homevalue_estimated_low),
    homevalue_estimated_high: toInputValue(report.homevalue_estimated_high),
    radius_used_m: toInputValue(report.radius_used_m),
    num_of_comps: toInputValue(report.num_of_comps),
    original_low: toInputValue(report.original_low),
    original_high: toInputValue(report.original_high),
    renovated_low: toInputValue(report.renovated_low),
    renovated_high: toInputValue(report.renovated_high),
    well_renovated_low: toInputValue(report.well_renovated_low),
    well_renovated_high: toInputValue(report.well_renovated_high),
    recent_transactions: normaliseRecentTransactions(report.recent_transactions),
    competing_listings: normaliseListings(report.competing_listings),
    suggested_asking_price: toInputValue(report.suggested_asking_price),
    consultant_notes: report.consultant_notes || '',
    status: report.status || 'draft',
  }
}

function buildPayload(form: ReportForm) {
  return {
    source_type: form.source_type,
    lead_id: form.lead_id,
    client_name: form.client_name || null,
    client_phone: form.client_phone || null,
    client_email: form.client_email || null,
    agent_name: form.agent_name || null,
    property_address: form.property_address || null,
    unit_number: form.unit_number || null,
    property_type: form.property_type || null,
    floor_area_sqm: sqftToSqm(form.floor_area_sqm),
    floor_level: form.floor_level || null,
    tenure: form.tenure || null,
    completion_year: toNumber(form.completion_year),
    subject_lat: toNumber(form.subject_lat),
    subject_lon: toNumber(form.subject_lon),
    homevalue_estimated_price: toNumber(form.homevalue_estimated_price),
    homevalue_estimated_low: toNumber(form.homevalue_estimated_low),
    homevalue_estimated_high: toNumber(form.homevalue_estimated_high),
    radius_used_m: toNumber(form.radius_used_m),
    num_of_comps: toNumber(form.num_of_comps),
    original_low: toNumber(form.original_low),
    original_high: toNumber(form.original_high),
    renovated_low: toNumber(form.renovated_low),
    renovated_high: toNumber(form.renovated_high),
    well_renovated_low: toNumber(form.well_renovated_low),
    well_renovated_high: toNumber(form.well_renovated_high),
    recent_transactions: form.recent_transactions,
    competing_listings: form.competing_listings,
    suggested_asking_price: toNumber(form.suggested_asking_price),
    consultant_notes: form.consultant_notes || null,
    status: form.status,
  }
}

function Field({
  label,
  value,
  onChange,
  type = 'text',
  placeholder,
  helperText,
  readOnly = false,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  type?: string
  placeholder?: string
  helperText?: string
  readOnly?: boolean
}) {
  return (
    <label className="block">
      <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.12em] text-[#7B6757]">
        {label}
      </span>
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        readOnly={readOnly}
        onChange={(event) => onChange(event.target.value)}
        className={`w-full rounded-2xl border border-[#E4D7C6] px-4 py-3 text-sm outline-none transition focus:border-[#B55A1E] ${
          readOnly ? 'bg-[#F7F1E8] text-[#6F5C4E]' : 'bg-white'
        }`}
      />
      {helperText && <span className="mt-2 block text-xs leading-5 text-[#7B6757]">{helperText}</span>}
    </label>
  )
}

export default function AgentReportDetailPage() {
  const params = useParams<{ leadId: string }>()
  const router = useRouter()
  const leadId = Number(params.leadId)

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [user, setUser] = useState<AgentUser | null>(null)
  const [form, setForm] = useState<ReportForm | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [transactionsLoading, setTransactionsLoading] = useState(false)
  const [transactionsError, setTransactionsError] = useState<string | null>(null)

  const isAuthorised = useMemo(() => {
    if (!user?.email) return false
    return AUTHORISED_EMAILS.includes(user.email.toLowerCase())
  }, [user])

  function updateForm<K extends keyof ReportForm>(key: K, value: ReportForm[K]) {
    setForm((current) => (current ? { ...current, [key]: value } : current))
  }

  function updateUnitNumber(value: string) {
    setForm((current) => {
      if (!current) return current
      const detectedFloorCategory = getFloorCategoryFromUnitNumber(value)
      return {
        ...current,
        unit_number: value,
        floor_level: detectedFloorCategory || current.floor_level,
      }
    })
  }

  function updateListing(index: number, key: keyof CompetingListing, value: string) {
    setForm((current) => {
      if (!current) return current
      const nextListings = current.competing_listings.map((listing, listingIndex) => {
        if (listingIndex !== index) return listing
        const updated = { ...listing, [key]: value }

        if (key === 'asking_price' || key === 'size_sqft') {
          const price = Number(key === 'asking_price' ? value : updated.asking_price)
          const size = Number(key === 'size_sqft' ? value : updated.size_sqft)
          if (Number.isFinite(price) && price > 0 && Number.isFinite(size) && size > 0) {
            updated.psf = String(Math.round(price / size))
          } else {
            updated.psf = ''
          }
        }

        return updated
      })

      return { ...current, competing_listings: nextListings }
    })
  }

  async function createOrLoadReport(sessionEmail: string) {
    if (!Number.isFinite(leadId) || leadId <= 0) {
      setError('Invalid lead ID.')
      setLoading(false)
      return
    }

    setError(null)

    const { data: existingReport, error: reportError } = await supabase
      .from('agent_valuation_reports')
      .select('*')
      .eq('lead_id', leadId)
      .maybeSingle()

    if (reportError) {
      setError(reportError.message)
      setLoading(false)
      return
    }

    if (existingReport) {
      setForm(buildFormFromReport(existingReport))
      setLoading(false)
      return
    }

    const { data: lead, error: leadError } = await supabase
      .from('leads')
      .select(
        'id, created_at, name, phone, email, address, unit_number, unit_type, floor_area_sqm, tenure, completion_year, subject_lat, subject_lon, estimated_price, estimated_low, estimated_high, radius_used_m, num_of_comps, status, plan'
      )
      .eq('id', leadId)
      .maybeSingle()

    if (leadError) {
      setError(leadError.message)
      setLoading(false)
      return
    }

    if (!lead) {
      setError('Lead not found.')
      setLoading(false)
      return
    }

    const initialForm = buildFormFromLead(lead as Lead, sessionEmail)
    const { data: createdReport, error: createError } = await supabase
      .from('agent_valuation_reports')
      .insert(buildPayload(initialForm))
      .select('*')
      .single()

    if (createError) {
      const { data: duplicateReport } = await supabase
        .from('agent_valuation_reports')
        .select('*')
        .eq('lead_id', leadId)
        .maybeSingle()

      if (duplicateReport) {
        setForm(buildFormFromReport(duplicateReport))
        setLoading(false)
        return
      }

      setError(createError.message)
      setLoading(false)
      return
    }

    setForm(buildFormFromReport(createdReport))
    setLoading(false)
  }

  useEffect(() => {
    let mounted = true

    async function initialise() {
      const { data } = await supabase.auth.getSession()
      const email = data.session?.user?.email || null

      if (!mounted) return

      setUser(email ? { email } : null)

      if (!email) {
        setLoading(false)
        return
      }

      if (!AUTHORISED_EMAILS.includes(email.toLowerCase())) {
        setLoading(false)
        return
      }

      await createOrLoadReport(email)
    }

    initialise()

    return () => {
      mounted = false
    }
  }, [leadId])

  useEffect(() => {
    if (!form || form.recent_transactions.length > 0) return
    fetchRecentTransactions(form)
  }, [form?.id])

  async function signInWithGoogle() {
    setError(null)
    const redirectTo = `${window.location.origin}/agent/reports/${leadId}`
    const { error: signInError } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo },
    })
    if (signInError) setError(signInError.message)
  }

  async function signOut() {
    await supabase.auth.signOut()
    router.push('/agent/reports')
  }

  async function fetchRecentTransactions(currentForm: ReportForm) {
    const propertyCategory = getReportPropertyCategory(currentForm.property_type)

    setTransactionsLoading(true)
    setTransactionsError(null)

    const twelveMonthsAgo = new Date()
    twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 12)
    const dateFilter = twelveMonthsAgo.toISOString().slice(0, 10)

    if (propertyCategory === 'condo' || propertyCategory === 'ec') {
      const projectSearchTerm = getProjectLikeSearchTerm(currentForm.property_address)

      if (!projectSearchTerm) {
        setTransactionsError('Unable to identify the project name from this property address. Please check the address format.')
        setForm((current) => (current ? { ...current, recent_transactions: [] } : current))
        setTransactionsLoading(false)
        return
      }

      let projectQuery = supabase
        .from('property_transactions_v2')
        .select('id, property_type, property_subtype, project_name, address, latitude, longitude, transaction_price, transaction_date, floor_area_sqm, price_psf, unit_type, tenure, completion_year, floor_level, property_group, is_strata')
        .gte('transaction_date', dateFilter)
        .not('transaction_price', 'is', null)
        .not('floor_area_sqm', 'is', null)
        .not('project_name', 'is', null)
        .not('transaction_date', 'is', null)
        .order('transaction_date', { ascending: false })
        .limit(1500)

      projectQuery = propertyCategory === 'ec'
        ? projectQuery.eq('property_subtype', 'ec')
        : projectQuery.eq('property_subtype', 'condo')

      projectQuery = projectQuery.ilike('project_name', `%${projectSearchTerm}%`)

      const { data, error: transactionError } = await projectQuery

      if (transactionError) {
        setTransactionsError(transactionError.message)
        setTransactionsLoading(false)
        return
      }

      const projectRows = (data || [])
        .map((row: any) => {
          const floorAreaSqm = Number(row.floor_area_sqm)
          const transactionPrice = Number(row.transaction_price)

          if (
            !Number.isFinite(floorAreaSqm) ||
            !Number.isFinite(transactionPrice) ||
            floorAreaSqm <= 0 ||
            transactionPrice <= 0 ||
            !isSameProject(currentForm, row.project_name)
          ) {
            return null
          }

          const floorAreaSqft = Math.round(floorAreaSqm * 10.7639)
          const explicitPsf = Number(row.price_psf)
          const pricePsf = Number.isFinite(explicitPsf) && explicitPsf > 0
            ? explicitPsf
            : Math.round(transactionPrice / floorAreaSqft)

          const transaction: RecentTransaction = {
            id: row.id,
            transaction_date: row.transaction_date || '',
            display_name: row.project_name || currentForm.property_address || 'Project transaction',
            project_name: row.project_name || '',
            address: row.address || '',
            unit_type: row.unit_type || '',
            floor_area_sqft: floorAreaSqft,
            floor_level: row.floor_level || '',
            transaction_price: transactionPrice,
            price_psf: Math.round(pricePsf),
            distance_m: -1,
          }

          return transaction
        })
        .filter((row): row is RecentTransaction => Boolean(row))
        .sort((a, b) => getTransactionTimestamp(b.transaction_date) - getTransactionTimestamp(a.transaction_date))
        .slice(0, 15)

      setForm((current) => (current ? { ...current, recent_transactions: projectRows } : current))
      setTransactionsLoading(false)
      return
    }

    const resolvedCoordinates = await resolveReferenceCoordinates(currentForm, propertyCategory)

    if (!resolvedCoordinates) {
      setTransactionsError('Unable to find usable coordinates for this property. Check the address or enter this report again after coordinates are saved.')
      setTransactionsLoading(false)
      return
    }

    const lat = resolvedCoordinates.lat
    const lon = resolvedCoordinates.lon
    const radius = getRecentTransactionRadius(propertyCategory)
    const box = getBoundingBox(lat, lon, radius)
    const textSearchTerm = getTextSearchTerm(currentForm, propertyCategory)
    const textFilter = buildTextSearchOrFilter(textSearchTerm)

    let query = supabase
      .from('property_transactions_v2')
      .select('id, property_type, property_subtype, project_name, address, latitude, longitude, transaction_price, transaction_date, floor_area_sqm, price_psf, unit_type, tenure, completion_year, floor_level, property_group, is_strata')
      .gte('transaction_date', dateFilter)
      .not('transaction_price', 'is', null)
      .not('floor_area_sqm', 'is', null)
      .not('latitude', 'is', null)
      .not('longitude', 'is', null)
      .order('transaction_date', { ascending: false })
      .limit(1500)

    if (propertyCategory === 'hdb') {
      query = query.eq('property_group', 'hdb')
    } else {
      query = query.in('property_subtype', ['landed_strata', 'landed_non_strata'])
    }

    if (resolvedCoordinates.source === 'saved') {
      query = query
        .gte('latitude', box.minLat)
        .lte('latitude', box.maxLat)
        .gte('longitude', box.minLon)
        .lte('longitude', box.maxLon)
    } else if (textFilter) {
      query = query.or(textFilter)
    }

    const { data, error: transactionError } = await query

    if (transactionError) {
      setTransactionsError(transactionError.message)
      setTransactionsLoading(false)
      return
    }

    const subjectHdbType = normaliseComparableText(currentForm.property_type)

    const scoredRows = (data || [])
      .map((row: any) => {
        const rowLat = Number(row.latitude)
        const rowLon = Number(row.longitude)
        const floorAreaSqm = Number(row.floor_area_sqm)
        const transactionPrice = Number(row.transaction_price)

        if (
          !Number.isFinite(rowLat) ||
          !Number.isFinite(rowLon) ||
          !Number.isFinite(floorAreaSqm) ||
          !Number.isFinite(transactionPrice) ||
          floorAreaSqm <= 0 ||
          transactionPrice <= 0
        ) {
          return null
        }

        if (propertyCategory === 'hdb' && normaliseComparableText(row.unit_type) !== subjectHdbType) {
          return null
        }

        const distanceM = distanceInMeters(lat, lon, rowLat, rowLon)
        if (distanceM > radius) return null

        const floorAreaSqft = Math.round(floorAreaSqm * 10.7639)
        const explicitPsf = Number(row.price_psf)
        const pricePsf = Number.isFinite(explicitPsf) && explicitPsf > 0
          ? explicitPsf
          : Math.round(transactionPrice / floorAreaSqft)

        const transaction: RecentTransaction = {
          id: row.id,
          transaction_date: row.transaction_date || '',
          display_name: row.project_name || row.address || 'Nearby transaction',
          project_name: row.project_name || '',
          address: row.address || '',
          unit_type: row.unit_type || '',
          floor_area_sqft: floorAreaSqft,
          floor_level: row.floor_level || '',
          transaction_price: transactionPrice,
          price_psf: Math.round(pricePsf),
          distance_m: Math.round(distanceM),
        }

        return {
          transaction,
          score: getTransactionScore(currentForm, row, distanceM),
        }
      })
      .filter((row): row is { transaction: RecentTransaction; score: number } => Boolean(row))

    const rows = scoredRows
      .sort((a, b) => b.score - a.score)
      .slice(0, 15)
      .sort((a, b) => getTransactionTimestamp(b.transaction.transaction_date) - getTransactionTimestamp(a.transaction.transaction_date))
      .map((row) => row.transaction)

    setForm((current) => {
      if (!current) return current
      return {
        ...current,
        subject_lat: String(lat),
        subject_lon: String(lon),
        recent_transactions: rows,
      }
    })

    if (rows.length === 0 && resolvedCoordinates.source === 'derived') {
      setTransactionsError('Coordinates were derived from the transaction table, but no matching nearby transactions were found within the selected radius and last 12 months.')
    }

    setTransactionsLoading(false)
  }

  async function saveReport() {
    if (!form) return

    setSaving(true)
    setError(null)
    setSuccess(null)

    const payload = buildPayload(form)
    const query = form.id
      ? supabase.from('agent_valuation_reports').update(payload).eq('id', form.id).select('*').single()
      : supabase.from('agent_valuation_reports').insert(payload).select('*').single()

    const { data, error: saveError } = await query

    if (saveError) {
      setError(saveError.message)
    } else {
      setForm(buildFormFromReport(data))
      setSuccess('Draft saved.')
    }

    setSaving(false)
  }

  if (loading) {
    return (
      <main className="min-h-screen bg-[#F7F1E8] px-6 py-10 text-[#231A14]">
        <div className="mx-auto max-w-5xl rounded-3xl border border-[#E4D7C6] bg-white p-8 shadow-sm">
          <p className="text-sm text-[#7B6757]">Loading report...</p>
        </div>
      </main>
    )
  }

  if (!user) {
    return (
      <main className="min-h-screen bg-[#F7F1E8] px-6 py-10 text-[#231A14]">
        <section className="mx-auto flex min-h-[70vh] max-w-3xl items-center justify-center">
          <div className="w-full rounded-3xl border border-[#E4D7C6] bg-white p-8 shadow-sm md:p-10">
            <p className="mb-3 text-xs font-semibold uppercase tracking-[0.24em] text-[#B55A1E]">
              NexDoor Internal
            </p>
            <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">
              Agent Valuation Report
            </h1>
            <p className="mt-4 text-sm leading-6 text-[#6F5C4E]">
              Sign in with your authorised NexDoor Google account to open this report.
            </p>
            <button
              type="button"
              onClick={signInWithGoogle}
              className="mt-8 rounded-2xl bg-[#231A14] px-5 py-4 text-sm font-semibold text-white transition hover:bg-[#3A2B22]"
            >
              Continue with Google
            </button>
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
            <h1 className="text-3xl font-semibold tracking-tight">This report is only for authorised NexDoor agents.</h1>
            <p className="mt-4 text-sm text-[#6F5C4E]">You are signed in as <span className="font-semibold text-[#231A14]">{user.email}</span>.</p>
            <button type="button" onClick={signOut} className="mt-8 rounded-2xl border border-[#D7C6B5] px-5 py-3 text-sm font-semibold text-[#231A14] transition hover:bg-[#F7F1E8]">Sign out</button>
          </div>
        </section>
      </main>
    )
  }

  if (!form) {
    return (
      <main className="min-h-screen bg-[#F7F1E8] px-6 py-10 text-[#231A14]">
        <div className="mx-auto max-w-5xl rounded-3xl border border-[#E4D7C6] bg-white p-8 shadow-sm">
          <p className="text-sm text-red-700">{error || 'Unable to load report.'}</p>
          <Link href="/agent/reports" className="mt-5 inline-flex rounded-2xl border border-[#D7C6B5] px-5 py-3 text-sm font-semibold">Back to Reports</Link>
        </div>
      </main>
    )
  }

  const estimatedRemainingLease = getEstimatedRemainingLease(
    form.tenure,
    form.completion_year,
    form.property_type
  )

  return (
    <main className="min-h-screen bg-[#F7F1E8] px-4 py-6 text-[#231A14] md:px-8 md:py-10">
      <div className="mx-auto max-w-6xl space-y-6">
        <header className="rounded-3xl border border-[#E4D7C6] bg-white p-6 shadow-sm md:p-8">
          <div className="flex flex-col gap-5 md:flex-row md:items-start md:justify-between">
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-[0.24em] text-[#B55A1E]">
                NexDoor HomeValue Report
              </p>
              <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">
                Pre-consultation Valuation Report
              </h1>
              <p className="mt-3 text-sm text-[#6F5C4E]">
                Prepared for <span className="font-semibold text-[#231A14]">{form.client_name || 'Unnamed client'}</span> · Status: <span className="font-semibold text-[#231A14]">{form.status}</span>
              </p>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row">
              <Link href="/agent/reports" className="rounded-2xl border border-[#D7C6B5] px-5 py-3 text-center text-sm font-semibold text-[#231A14] transition hover:bg-[#F7F1E8]">
                Back to Reports
              </Link>
              <button type="button" onClick={saveReport} disabled={saving} className="rounded-2xl bg-[#231A14] px-5 py-3 text-sm font-semibold text-white transition hover:bg-[#3A2B22] disabled:opacity-60">
                {saving ? 'Saving...' : 'Save Draft'}
              </button>
            </div>
          </div>

          {error && <p className="mt-5 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
          {success && <p className="mt-5 rounded-2xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">{success}</p>}
        </header>

        <section className="rounded-3xl border border-[#E4D7C6] bg-white p-6 shadow-sm md:p-8">
          <h2 className="text-xl font-semibold">1. Property Summary</h2>
          <p className="mt-1 text-sm text-[#6F5C4E]">Edit anything that the client keyed wrongly before saving the report.</p>

          <div className="mt-6 grid gap-5 md:grid-cols-2">
            <Field label="Client name" value={form.client_name} onChange={(value) => updateForm('client_name', value)} />
            <Field label="Prepared by" value={form.agent_name} onChange={(value) => updateForm('agent_name', value)} />
            <Field label="Client phone" value={form.client_phone} onChange={(value) => updateForm('client_phone', value)} />
            <Field label="Client email" value={form.client_email} onChange={(value) => updateForm('client_email', value)} />
            <div className="md:col-span-2">
              <Field label="Property address" value={form.property_address} onChange={(value) => updateForm('property_address', value)} />
            </div>
            <Field
              label="Unit number"
              value={form.unit_number}
              onChange={updateUnitNumber}
              helperText="Floor category will auto-detect from the unit number where possible."
            />
            <Field label="Property type" value={form.property_type} onChange={(value) => updateForm('property_type', value)} />
            <Field label="Floor area sqft" value={form.floor_area_sqm} onChange={(value) => updateForm('floor_area_sqm', value)} type="number" />
            <Field
              label="Floor category"
              value={form.floor_level}
              onChange={(value) => updateForm('floor_level', value)}
              placeholder="Example: High floor"
              helperText="Auto rule: Level 1–5 = Low floor, 6–11 = Mid floor, 12+ = High floor. Editable if needed."
            />
            <Field
              label="Tenure / lease"
              value={form.tenure}
              onChange={(value) => updateForm('tenure', value)}
              placeholder="Example: 99-year leasehold / 999-year leasehold / Freehold"
            />
            <Field
              label="Lease start / completion year"
              value={form.completion_year}
              onChange={(value) => updateForm('completion_year', value)}
              type="number"
              helperText="Editable. For HDB, use lease start year where available; for private, use TOP/completion year where appropriate."
            />
            <Field
              label="Estimated remaining lease"
              value={estimatedRemainingLease}
              onChange={() => undefined}
              readOnly
              helperText="Auto-calculated from tenure and lease start / completion year."
            />
          </div>
        </section>

        <section className="rounded-3xl border border-[#E4D7C6] bg-white p-6 shadow-sm md:p-8">
          <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <div>
              <h2 className="text-xl font-semibold">2. Recent Nearby Transactions</h2>
              <p className="mt-1 text-sm text-[#6F5C4E]">
                Last 12 months · Showing up to 15 most relevant transactions.
              </p>
            </div>
            <button
              type="button"
              onClick={() => fetchRecentTransactions(form)}
              disabled={transactionsLoading}
              className="rounded-2xl border border-[#D7C6B5] px-4 py-3 text-sm font-semibold text-[#231A14] transition hover:bg-[#F7F1E8] disabled:opacity-60"
            >
              {transactionsLoading ? 'Refreshing...' : 'Refresh transactions'}
            </button>
          </div>

          {transactionsError && (
            <p className="mt-5 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {transactionsError}
            </p>
          )}

          {transactionsLoading && form.recent_transactions.length === 0 ? (
            <div className="mt-4 rounded-2xl border border-dashed border-[#D7C6B5] bg-[#FBF7F1] p-5 text-sm leading-6 text-[#6F5C4E]">
              Loading recent transactions...
            </div>
          ) : form.recent_transactions.length === 0 ? (
            <div className="mt-4 rounded-2xl border border-dashed border-[#D7C6B5] bg-[#FBF7F1] p-5 text-sm leading-6 text-[#6F5C4E]">
              No relevant transactions found in the last 12 months using the current property details.
            </div>
          ) : (
            <div className="mt-5 overflow-x-auto rounded-2xl border border-[#EFE3D4]">
              <table className="min-w-full divide-y divide-[#EFE3D4] text-left text-sm">
                <thead className="bg-[#FBF7F1] text-xs uppercase tracking-[0.12em] text-[#7B6757]">
                  <tr>
                    <th className="px-4 py-3 font-semibold">Date</th>
                    <th className="px-4 py-3 font-semibold">Address / Project</th>
                    <th className="px-4 py-3 font-semibold">Unit Type</th>
                    <th className="px-4 py-3 font-semibold">Size</th>
                    <th className="px-4 py-3 font-semibold">Floor</th>
                    <th className="px-4 py-3 font-semibold">Price</th>
                    <th className="px-4 py-3 font-semibold">PSF</th>
                    <th className="px-4 py-3 font-semibold">Distance</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#EFE3D4] bg-white">
                  {form.recent_transactions.map((transaction) => (
                    <tr key={transaction.id} className="align-top">
                      <td className="whitespace-nowrap px-4 py-3 text-[#6F5C4E]">{formatDate(transaction.transaction_date)}</td>
                      <td className="px-4 py-3">
                        <div className="font-semibold text-[#231A14]">{transaction.display_name || transaction.address || '—'}</div>
                        {transaction.project_name && transaction.address && transaction.project_name !== transaction.address && (
                          <div className="mt-1 text-xs text-[#7B6757]">{transaction.address}</div>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-[#6F5C4E]">{transaction.unit_type || '—'}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-[#6F5C4E]">{transaction.floor_area_sqft ? `${transaction.floor_area_sqft.toLocaleString()} sqft` : '—'}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-[#6F5C4E]">{transaction.floor_level || '—'}</td>
                      <td className="whitespace-nowrap px-4 py-3 font-semibold">{formatCurrency(transaction.transaction_price)}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-[#6F5C4E]">{transaction.price_psf ? `$${transaction.price_psf.toLocaleString()} psf` : '—'}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-[#6F5C4E]">{formatDistance(transaction.distance_m)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="rounded-3xl border border-[#E4D7C6] bg-white p-6 shadow-sm md:p-8">
          <h2 className="text-xl font-semibold">3. Current Competing Listings</h2>
          <p className="mt-1 text-sm text-[#6F5C4E]">Manually enter around 3 active listings. Paste the listing link for quick reference, then key in the asking price and size.</p>

          <div className="mt-6 space-y-5">
            {form.competing_listings.map((listing, index) => (
              <div key={index} className="rounded-3xl border border-[#EFE3D4] bg-[#FBF7F1] p-5">
                <p className="mb-4 text-sm font-semibold">Listing {index + 1}</p>
                <div className="grid gap-4 md:grid-cols-3">
                  <div className="md:col-span-3">
                    <Field label="Listing title / block / project" value={listing.title} onChange={(value) => updateListing(index, 'title', value)} />
                  </div>
                  <div className="md:col-span-3">
                    <Field label="Listing URL / link" value={listing.listing_url} onChange={(value) => updateListing(index, 'listing_url', value)} placeholder="Paste PropertyGuru / 99.co / SRX link here" />
                  </div>
                  <Field label="Asking price" value={listing.asking_price} onChange={(value) => updateListing(index, 'asking_price', value)} type="number" />
                  <Field label="Size sqft" value={listing.size_sqft} onChange={(value) => updateListing(index, 'size_sqft', value)} type="number" />
                  <Field
                    label="PSF (auto)"
                    value={listing.psf}
                    onChange={() => undefined}
                    type="number"
                    readOnly
                    helperText="Auto-calculated from asking price ÷ size sqft."
                  />
                  <Field label="Condition" value={listing.condition} onChange={(value) => updateListing(index, 'condition', value)} placeholder="Original / Renovated / Well-renovated" />
                  <Field label="Source" value={listing.source} onChange={(value) => updateListing(index, 'source', value)} />
                  <Field label="Notes" value={listing.notes} onChange={(value) => updateListing(index, 'notes', value)} />
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-3xl border border-[#E4D7C6] bg-white p-6 shadow-sm md:p-8">
          <h2 className="text-xl font-semibold">4. Estimated Market Range</h2>
          <p className="mt-1 text-sm text-[#6F5C4E]">
            Renovated is based on the HomeValue estimate with a tightened range. Original is 8% below. Well-renovated is 8% above.
          </p>

          <div className="mt-6 grid gap-5 md:grid-cols-3">
            <div className="rounded-3xl border border-[#EFE3D4] bg-[#FBF7F1] p-5">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#7B6757]">Original</p>
              <p className="mt-3 text-2xl font-semibold">{formatCurrency(form.original_low)} – {formatCurrency(form.original_high)}</p>
            </div>
            <div className="rounded-3xl border border-[#B55A1E]/30 bg-[#FFF8EF] p-5">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#B55A1E]">Renovated</p>
              <p className="mt-3 text-2xl font-semibold">{formatCurrency(form.renovated_low)} – {formatCurrency(form.renovated_high)}</p>
            </div>
            <div className="rounded-3xl border border-[#EFE3D4] bg-[#FBF7F1] p-5">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#7B6757]">Well-renovated</p>
              <p className="mt-3 text-2xl font-semibold">{formatCurrency(form.well_renovated_low)} – {formatCurrency(form.well_renovated_high)}</p>
            </div>
          </div>

          <div className="mt-6 grid gap-5 md:grid-cols-3">
            <Field label="Original low" value={form.original_low} onChange={(value) => updateForm('original_low', value)} type="number" />
            <Field label="Renovated low" value={form.renovated_low} onChange={(value) => updateForm('renovated_low', value)} type="number" />
            <Field label="Well-renovated low" value={form.well_renovated_low} onChange={(value) => updateForm('well_renovated_low', value)} type="number" />
            <Field label="Original high" value={form.original_high} onChange={(value) => updateForm('original_high', value)} type="number" />
            <Field label="Renovated high" value={form.renovated_high} onChange={(value) => updateForm('renovated_high', value)} type="number" />
            <Field label="Well-renovated high" value={form.well_renovated_high} onChange={(value) => updateForm('well_renovated_high', value)} type="number" />
          </div>

          <div className="mt-5 text-sm text-[#6F5C4E]">
            HomeValue original estimate: <span className="font-semibold text-[#231A14]">{formatCurrency(form.homevalue_estimated_price)}</span> · {form.num_of_comps || '—'} comps · {form.radius_used_m || '—'}m radius
          </div>
        </section>

        <section className="rounded-3xl border border-[#E4D7C6] bg-white p-6 shadow-sm md:p-8">
          <h2 className="text-xl font-semibold">5. NexDoor Consultant Notes</h2>
          <div className="mt-6 grid gap-5">
            <Field label="Suggested asking price" value={form.suggested_asking_price} onChange={(value) => updateForm('suggested_asking_price', value)} type="number" />
            <label className="block">
              <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.12em] text-[#7B6757]">Consultant notes</span>
              <textarea
                value={form.consultant_notes}
                onChange={(event) => updateForm('consultant_notes', event.target.value)}
                rows={6}
                placeholder="Example: Suggested launch strategy, buyer demand notes, pricing angle, viewing preparation..."
                className="w-full rounded-2xl border border-[#E4D7C6] bg-white px-4 py-3 text-sm outline-none transition focus:border-[#B55A1E]"
              />
            </label>
          </div>
        </section>

        <div className="flex flex-col gap-3 rounded-3xl border border-[#E4D7C6] bg-white p-5 shadow-sm sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-[#6F5C4E]">PDF export will be added after this editable draft page is stable.</p>
          <div className="flex flex-col gap-3 sm:flex-row">
            <Link href="/agent/reports" className="rounded-2xl border border-[#D7C6B5] px-5 py-3 text-center text-sm font-semibold text-[#231A14] transition hover:bg-[#F7F1E8]">
              Back to Reports
            </Link>
            <button type="button" onClick={saveReport} disabled={saving} className="rounded-2xl bg-[#231A14] px-5 py-3 text-sm font-semibold text-white transition hover:bg-[#3A2B22] disabled:opacity-60">
              {saving ? 'Saving...' : 'Save Draft'}
            </button>
          </div>
        </div>
      </div>
    </main>
  )
}
