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
  asking_price: string
  size_sqft: string
  psf: string
  condition: string
  source: string
  notes: string
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
  asking_price: '',
  size_sqft: '',
  psf: '',
  condition: '',
  source: 'PropertyGuru',
  notes: '',
}

function toNumber(value: number | string | null | undefined) {
  const numberValue = Number(value)
  return Number.isFinite(numberValue) ? numberValue : null
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
    original_low: String(roundToNearest(renovatedLow * 0.9, 5000)),
    original_high: String(roundToNearest(renovatedHigh * 0.9, 5000)),
    renovated_low: String(renovatedLow),
    renovated_high: String(renovatedHigh),
    well_renovated_low: String(roundToNearest(renovatedLow * 1.1, 5000)),
    well_renovated_high: String(roundToNearest(renovatedHigh * 1.1, 5000)),
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
    subject_lat: toInputValue(lead.subject_lat),
    subject_lon: toInputValue(lead.subject_lon),
    homevalue_estimated_price: toInputValue(lead.estimated_price),
    homevalue_estimated_low: toInputValue(lead.estimated_low),
    homevalue_estimated_high: toInputValue(lead.estimated_high),
    radius_used_m: toInputValue(lead.radius_used_m),
    num_of_comps: toInputValue(lead.num_of_comps),
    ...ranges,
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
    floor_area_sqm: toInputValue(report.floor_area_sqm),
    floor_level: report.floor_level || getFloorCategoryFromUnitNumber(report.unit_number),
    tenure: report.tenure || inferTenureFromPropertyType(report.property_type),
    completion_year: toInputValue(report.completion_year),
    subject_lat: toInputValue(report.subject_lat),
    subject_lon: toInputValue(report.subject_lon),
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
          <h2 className="text-xl font-semibold">2. Recent Nearby Transactions</h2>
          <div className="mt-4 rounded-2xl border border-dashed border-[#D7C6B5] bg-[#FBF7F1] p-5 text-sm leading-6 text-[#6F5C4E]">
            Coming in the next step. This section will pull relevant transactions from the last 12 months using the saved property coordinates.
          </div>
        </section>

        <section className="rounded-3xl border border-[#E4D7C6] bg-white p-6 shadow-sm md:p-8">
          <h2 className="text-xl font-semibold">3. Current Competing Listings</h2>
          <p className="mt-1 text-sm text-[#6F5C4E]">Manually enter around 3 active listings from PropertyGuru or other portals.</p>

          <div className="mt-6 space-y-5">
            {form.competing_listings.map((listing, index) => (
              <div key={index} className="rounded-3xl border border-[#EFE3D4] bg-[#FBF7F1] p-5">
                <p className="mb-4 text-sm font-semibold">Listing {index + 1}</p>
                <div className="grid gap-4 md:grid-cols-3">
                  <div className="md:col-span-3">
                    <Field label="Listing title / block / project" value={listing.title} onChange={(value) => updateListing(index, 'title', value)} />
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
            Renovated is based on the HomeValue estimate with a tightened range. Original is 10% below. Well-renovated is 10% above.
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
