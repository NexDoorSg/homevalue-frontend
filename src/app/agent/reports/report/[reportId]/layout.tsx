import Link from 'next/link'
import type { ReactNode } from 'react'

type ReportLayoutProps = {
  children: ReactNode
  params: Promise<{ reportId: string }>
}

export default async function ReportLayout({ children, params }: ReportLayoutProps) {
  const { reportId } = await params

  return (
    <>
      {children}
      <Link
        href={`/agent/reports/report/${reportId}/print`}
        className="no-print fixed bottom-6 right-6 z-50 rounded-2xl bg-[#231A14] px-5 py-3 text-sm font-semibold text-white shadow-lg transition hover:bg-[#3A2B22]"
      >
        Preview PDF
      </Link>
    </>
  )
}
