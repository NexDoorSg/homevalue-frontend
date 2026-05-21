import type { Metadata } from 'next'

export const metadata: Metadata = {
  alternates: {
    canonical: '/hdb-valuation-singapore',
  },
}

export default function HdbValuationSingaporeLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return children
}
