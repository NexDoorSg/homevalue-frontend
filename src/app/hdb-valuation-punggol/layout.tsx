import type { Metadata } from 'next'

export const metadata: Metadata = {
  alternates: {
    canonical: '/hdb-valuation-punggol',
  },
}

export default function HdbValuationPunggolLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return children
}
