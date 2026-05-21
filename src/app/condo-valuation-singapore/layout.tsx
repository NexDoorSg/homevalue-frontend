import type { Metadata } from 'next'

export const metadata: Metadata = {
  alternates: {
    canonical: '/condo-valuation-singapore',
  },
}

export default function CondoValuationSingaporeLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return children
}
