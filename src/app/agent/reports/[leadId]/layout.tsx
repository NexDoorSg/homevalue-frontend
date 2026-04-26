import Link from 'next/link'
import type { ReactNode } from 'react'

type LeadReportLayoutProps = {
  children: ReactNode
  params: Promise<{ leadId: string }>
}

export default async function LeadReportLayout({ children, params }: LeadReportLayoutProps) {
  const { leadId } = await params

  return (
    <>
      {children}
      <Link
        href={`/agent/reports/${leadId}/print`}
        className="no-print fixed bottom-6 right-6 z-50 rounded-2xl bg-[#231A14] px-5 py-3 text-sm font-semibold text-white shadow-lg transition hover:bg-[#3A2B22]"
      >
        Preview PDF
      </Link>
    </>
  )
}
