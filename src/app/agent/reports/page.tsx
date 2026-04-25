'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../../lib/supabase'

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
  tenure: string | null
  completion_year: number | null
  estimated_price: number | string | null
  estimated_low: number | string | null
  estimated_high: number | string | null
  radius_used_m: number | null
  num_of_comps: number | null
  status: string | null
  plan: string | null
}

type ManualReport = {
  id: number
  created_at: string | null
  client_name: string | null
  client_phone: string | null
  client_email: string | null
  property_address: string | null
  unit_number: string | null
  property_type: string | null
  floor_area_sqm: number | string | null
  tenure: string | null
  completion_year: number | null
  homevalue_estimated_price: number | string | null
  homevalue_estimated_low: number | string | null
  homevalue_estimated_high: number | string | null
  radius_used_m: number | null
  num_of_comps: number | null
  status: string | null
}

type CombinedReport =
  | { kind: 'lead'; created_at: string | null; lead: Lead }
  | { kind: 'manual'; created_at: string | null; report: ManualReport }

type AgentUser = {
  email: string
}

const AUTHORISED_EMAILS = [
  'bjornlim@nexdoor.sg',
  'abigailtang@nexdoor.sg',
  'daveteo@nexdoor.sg',
]

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
  if (Number.isNaN(date.getTime())) return '—'

  return new Intl.DateTimeFormat('en-SG', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

function formatAreaSqft(areaSqm: number | string | null | undefined) {
  const numberValue = Number(areaSqm)
  if (!Number.isFinite(numberValue) || numberValue <= 0) return '—'

  const sqft = Math.round(numberValue * 10.7639)
  return `${sqft.toLocaleString('en-SG')} sqft`
}

function getCreatedTimestamp(value: string | null | undefined) {
  if (!value) return 0
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? 0 : date.getTime()
}

export default function AgentReportsPage() {
  const [loading, setLoading] = useState(true)
  const [leadLoading, setLeadLoading] = useState(false)
  const [user, setUser] = useState<AgentUser | null>(null)
  const [leads, setLeads] = useState<Lead[]>([])
  const [manualReports, setManualReports] = useState<ManualReport[]>([])
  const [archivingReportId, setArchivingReportId] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  const isAuthorised = useMemo(() => {
    if (!user?.email) return false
    return AUTHORISED_EMAILS.includes(user.email.toLowerCase())
  }, [user])

  const combinedReports = useMemo<CombinedReport[]>(() => {
    const leadRows: CombinedReport[] = leads.map((lead) => ({ kind: 'lead', created_at: lead.created_at, lead }))
    const manualRows: CombinedReport[] = manualReports.map((report) => ({ kind: 'manual', created_at: report.created_at, report }))

    return [...leadRows, ...manualRows].sort(
      (a, b) => getCreatedTimestamp(b.created_at) - getCreatedTimestamp(a.created_at)
    )
  }, [leads, manualReports])

  async function loadReports() {
    setLeadLoading(true)
    setError(null)

    const [leadsResult, manualReportsResult] = await Promise.all([
      supabase
        .from('leads')
        .select(
          'id, created_at, name, phone, email, address, unit_number, unit_type, floor_area_sqm, tenure, completion_year, estimated_price, estimated_low, estimated_high, radius_used_m, num_of_comps, status, plan'
        )
        .order('created_at', { ascending: false })
        .limit(50),
      supabase
        .from('agent_valuation_reports')
        .select(
          'id, created_at, client_name, client_phone, client_email, property_address, unit_number, property_type, floor_area_sqm, tenure, completion_year, homevalue_estimated_price, homevalue_estimated_low, homevalue_estimated_high, radius_used_m, num_of_comps, status'
        )
        .eq('source_type', 'manual')
        .or('status.is.null,status.neq.archived')
        .order('created_at', { ascending: false })
        .limit(50),
    ])

    if (leadsResult.error) {
      setError(leadsResult.error.message)
      setLeads([])
    } else {
      setLeads((leadsResult.data || []) as Lead[])
    }

    if (manualReportsResult.error) {
      setError((current) => current || manualReportsResult.error?.message || null)
      setManualReports([])
    } else {
      setManualReports((manualReportsResult.data || []) as ManualReport[])
    }

    setLeadLoading(false)
  }

  useEffect(() => {
    let mounted = true

    async function initialiseAuth() {
      const { data } = await supabase.auth.getSession()
      const email = data.session?.user?.email || null

      if (!mounted) return

      setUser(email ? { email } : null)
      setLoading(false)
    }

    initialiseAuth()

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      const email = session?.user?.email || null
      setUser(email ? { email } : null)
      setLoading(false)
    })

    return () => {
      mounted = false
      listener.subscription.unsubscribe()
    }
  }, [])

  useEffect(() => {
    if (isAuthorised) {
      loadReports()
    }
  }, [isAuthorised])

  async function signInWithGoogle() {
    setError(null)

    const redirectTo = `${window.location.origin}/agent/reports`

    const { error: signInError } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo,
      },
    })

    if (signInError) {
      setError(signInError.message)
    }
  }

  async function signOut() {
    await supabase.auth.signOut()
    setUser(null)
    setLeads([])
    setManualReports([])
  }

  async function archiveManualReport(report: ManualReport) {
    const confirmed = window.confirm('Archive this manual report?')
    if (!confirmed) return

    setArchivingReportId(report.id)
    setError(null)

    const { error: archiveError } = await supabase
      .from('agent_valuation_reports')
      .update({ status: 'archived' })
      .eq('id', report.id)
      .eq('source_type', 'manual')

    if (archiveError) {
      setError(archiveError.message)
      setArchivingReportId(null)
      return
    }

    setManualReports((current) => current.filter((item) => item.id !== report.id))
    setArchivingReportId(null)
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
            <p className="mb-3 text-xs font-semibold uppercase tracking-[0.24em] text-[#B55A1E]">
              NexDoor Internal
            </p>
            <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">
              Agent Valuation Reports
            </h1>
            <p className="mt-4 max-w-2xl text-sm leading-6 text-[#6F5C4E]">
              Sign in with your authorised NexDoor Google account to access lead-based valuation reports.
            </p>

            <button
              type="button"
              onClick={signInWithGoogle}
              className="mt-8 w-full rounded-2xl bg-[#231A14] px-5 py-4 text-sm font-semibold text-white transition hover:bg-[#3A2B22] md:w-auto"
            >
              Continue with Google
            </button>

            {error && (
              <p className="mt-5 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                {error}
              </p>
            )}
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
            <p className="mb-3 text-xs font-semibold uppercase tracking-[0.24em] text-[#B55A1E]">
              Access denied
            </p>
            <h1 className="text-3xl font-semibold tracking-tight">
              This page is only for authorised NexDoor agents.
            </h1>
            <p className="mt-4 text-sm leading-6 text-[#6F5C4E]">
              You are signed in as <span className="font-semibold text-[#231A14]">{user.email}</span>, but this email is not on the approved access list.
            </p>

            <button
              type="button"
              onClick={signOut}
              className="mt-8 rounded-2xl border border-[#D7C6B5] px-5 py-3 text-sm font-semibold text-[#231A14] transition hover:bg-[#F7F1E8]"
            >
              Sign out
            </button>
          </div>
        </section>
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-[#F7F1E8] px-4 py-6 text-[#231A14] md:px-8 md:py-10">
      <div className="mx-auto max-w-7xl">
        <header className="mb-8 flex flex-col gap-5 rounded-3xl border border-[#E4D7C6] bg-white p-6 shadow-sm md:flex-row md:items-center md:justify-between md:p-8">
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-[0.24em] text-[#B55A1E]">
              HomeValue by NexDoor
            </p>
            <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">
              Agent Reports
            </h1>
            <p className="mt-3 text-sm text-[#6F5C4E]">
              Signed in as <span className="font-semibold text-[#231A14]">{user.email}</span>
            </p>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row">
            <Link
              href="/agent/reports/new"
              className="rounded-2xl bg-[#B55A1E] px-5 py-3 text-center text-sm font-semibold text-white transition hover:bg-[#924818]"
            >
              Create Manual Report
            </Link>
            <button
              type="button"
              onClick={loadReports}
              className="rounded-2xl border border-[#D7C6B5] px-5 py-3 text-sm font-semibold text-[#231A14] transition hover:bg-[#F7F1E8]"
            >
              Refresh reports
            </button>
            <button
              type="button"
              onClick={signOut}
              className="rounded-2xl bg-[#231A14] px-5 py-3 text-sm font-semibold text-white transition hover:bg-[#3A2B22]"
            >
              Sign out
            </button>
          </div>
        </header>

        <section className="rounded-3xl border border-[#E4D7C6] bg-white shadow-sm">
          <div className="border-b border-[#EFE3D4] p-5 md:p-6">
            <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
              <div>
                <h2 className="text-xl font-semibold">Recent Reports</h2>
                <p className="mt-1 text-sm text-[#6F5C4E]">
                  Showing HomeValue leads and manual reports together, sorted from newest to oldest.
                </p>
              </div>
              <p className="text-sm text-[#6F5C4E]">
                {leadLoading ? 'Loading...' : `${combinedReports.length} reports loaded`}
              </p>
            </div>
          </div>

          {error && (
            <div className="m-5 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 md:m-6">
              {error}
            </div>
          )}

          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-[#FBF7F1] text-xs uppercase tracking-[0.12em] text-[#7B6757]">
                <tr>
                  <th className="px-5 py-4 font-semibold">Lead</th>
                  <th className="px-5 py-4 font-semibold">Property</th>
                  <th className="px-5 py-4 font-semibold">Details</th>
                  <th className="px-5 py-4 font-semibold">Estimated Range</th>
                  <th className="px-5 py-4 font-semibold">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#EFE3D4]">
                {combinedReports.map((item) => {
                  if (item.kind === 'lead') {
                    const lead = item.lead

                    return (
                      <tr key={`lead-${lead.id}`} className="align-top">
                        <td className="px-5 py-5">
                          <p className="font-semibold text-[#231A14]">{lead.name || 'Unnamed lead'}</p>
                          <p className="mt-1 inline-flex rounded-full bg-[#FBF7F1] px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-[#7B6757]">HomeValue Lead</p>
                          <p className="mt-1 text-[#6F5C4E]">{lead.phone || 'No phone'}</p>
                          <p className="mt-1 text-[#6F5C4E]">{lead.email || 'No email'}</p>
                          <p className="mt-2 text-xs text-[#8B7868]">{formatDate(lead.created_at)}</p>
                        </td>
                        <td className="max-w-sm px-5 py-5">
                          <p className="font-semibold text-[#231A14]">{lead.address || 'No address'}</p>
                          <p className="mt-1 text-[#6F5C4E]">Unit: {lead.unit_number || '—'}</p>
                        </td>
                        <td className="px-5 py-5">
                          <p>{lead.unit_type || '—'}</p>
                          <p className="mt-1 text-[#6F5C4E]">{formatAreaSqft(lead.floor_area_sqm)}</p>
                          <p className="mt-1 text-[#6F5C4E]">Tenure: {lead.tenure || '—'}</p>
                          <p className="mt-1 text-[#6F5C4E]">Completion: {lead.completion_year || '—'}</p>
                        </td>
                        <td className="px-5 py-5">
                          <p className="font-semibold text-[#231A14]">
                            {formatCurrency(lead.estimated_price)}
                          </p>
                          <p className="mt-1 text-[#6F5C4E]">
                            {formatCurrency(lead.estimated_low)} – {formatCurrency(lead.estimated_high)}
                          </p>
                          <p className="mt-2 text-xs text-[#8B7868]">
                            {lead.num_of_comps || 0} comps · {lead.radius_used_m || '—'}m radius
                          </p>
                        </td>
                        <td className="px-5 py-5">
                          <Link
                            href={`/agent/reports/${lead.id}`}
                            className="inline-flex rounded-2xl bg-[#231A14] px-4 py-3 text-xs font-semibold text-white transition hover:bg-[#3A2B22]"
                          >
                            Open report
                          </Link>
                        </td>
                      </tr>
                    )
                  }

                  const report = item.report

                  return (
                    <tr key={`manual-${report.id}`} className="align-top">
                      <td className="px-5 py-5">
                        <p className="font-semibold text-[#231A14]">{report.client_name || 'Unnamed client'}</p>
                        <p className="mt-1 inline-flex rounded-full bg-[#FFF8EF] px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-[#B55A1E]">Manual Report</p>
                        <p className="mt-2 text-[#6F5C4E]">{report.client_phone || 'No phone'}</p>
                        <p className="mt-1 text-[#6F5C4E]">{report.client_email || 'No email'}</p>
                        <p className="mt-2 text-xs text-[#8B7868]">{formatDate(report.created_at)}</p>
                      </td>
                      <td className="max-w-sm px-5 py-5">
                        <p className="font-semibold text-[#231A14]">{report.property_address || 'No address'}</p>
                        <p className="mt-1 text-[#6F5C4E]">Unit: {report.unit_number || '—'}</p>
                      </td>
                      <td className="px-5 py-5">
                        <p>{report.property_type || '—'}</p>
                        <p className="mt-1 text-[#6F5C4E]">{formatAreaSqft(report.floor_area_sqm)}</p>
                        <p className="mt-1 text-[#6F5C4E]">Tenure: {report.tenure || '—'}</p>
                        <p className="mt-1 text-[#6F5C4E]">Completion: {report.completion_year || '—'}</p>
                      </td>
                      <td className="px-5 py-5">
                        <p className="font-semibold text-[#231A14]">{formatCurrency(report.homevalue_estimated_price)}</p>
                        <p className="mt-1 text-[#6F5C4E]">{formatCurrency(report.homevalue_estimated_low)} – {formatCurrency(report.homevalue_estimated_high)}</p>
                        <p className="mt-2 text-xs text-[#8B7868]">{report.num_of_comps || 0} comps · {report.radius_used_m || '—'}m radius</p>
                      </td>
                      <td className="px-5 py-5">
                        <div className="flex flex-col gap-2">
                          <Link
                            href={`/agent/reports/report/${report.id}`}
                            className="inline-flex rounded-2xl bg-[#231A14] px-4 py-3 text-xs font-semibold text-white transition hover:bg-[#3A2B22]"
                          >
                            Open report
                          </Link>
                          <button
                            type="button"
                            onClick={() => archiveManualReport(report)}
                            disabled={archivingReportId === report.id}
                            className="inline-flex rounded-2xl border border-[#D7C6B5] px-4 py-3 text-xs font-semibold text-[#7B3F1A] transition hover:bg-[#FFF8EF] disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            {archivingReportId === report.id ? 'Archiving...' : 'Archive'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}

                {!leadLoading && combinedReports.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-5 py-10 text-center text-[#6F5C4E]">
                      No reports found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </main>
  )
}
