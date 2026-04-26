'use client'

import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { supabase } from '../../../../../lib/supabase'

const AUTHORISED_EMAILS = [
  'bjornlim@nexdoor.sg',
  'abigailtang@nexdoor.sg',
  'daveteo@nexdoor.sg',
]

export default function HomeValueLeadPrintRedirectPage() {
  const params = useParams<{ leadId: string }>()
  const router = useRouter()
  const leadId = params?.leadId
  const [error, setError] = useState('')
  const [loadingText, setLoadingText] = useState('Preparing PDF preview…')

  useEffect(() => {
    async function loadSavedReport() {
      if (!leadId) {
        setError('Missing lead ID.')
        return
      }

      setError('')
      setLoadingText('Preparing PDF preview…')

      const { data: userData } = await supabase.auth.getUser()
      const email = userData.user?.email?.toLowerCase() || ''

      if (!email || !AUTHORISED_EMAILS.includes(email)) {
        setError('You are not authorised to view this report.')
        return
      }

      const { data, error: reportError } = await supabase
        .from('agent_valuation_reports')
        .select('id')
        .eq('lead_id', Number(leadId))
        .eq('source_type', 'homevalue_lead')
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (reportError) {
        setError(reportError.message)
        return
      }

      if (!data?.id) {
        setError('No saved report found yet. Please click Save Draft first, then try Preview PDF again.')
        return
      }

      setLoadingText('Opening PDF preview…')
      router.replace(`/agent/reports/report/${data.id}/print`)
    }

    loadSavedReport()
  }, [leadId, router])

  return (
    <main className="min-h-screen bg-[#F7F1E8] px-6 py-10 text-[#231A14]">
      <section className="mx-auto flex min-h-[70vh] max-w-3xl items-center justify-center">
        <div className="w-full rounded-3xl border border-[#E4D7C6] bg-white p-8 shadow-sm md:p-10">
          <p className="mb-3 text-xs font-semibold uppercase tracking-[0.24em] text-[#B55A1E]">
            NexDoor HomeValue Report
          </p>
          <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">
            PDF Preview
          </h1>
          {error ? (
            <>
              <p className="mt-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm leading-6 text-red-700">
                {error}
              </p>
              <Link
                href={`/agent/reports/${leadId}`}
                className="mt-8 inline-flex rounded-2xl bg-[#231A14] px-5 py-3 text-sm font-semibold text-white transition hover:bg-[#3A2B22]"
              >
                Back to report
              </Link>
            </>
          ) : (
            <p className="mt-4 text-sm leading-6 text-[#6F5C4E]">
              {loadingText}
            </p>
          )}
        </div>
      </section>
    </main>
  )
}
