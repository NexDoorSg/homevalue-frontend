import type { Metadata } from 'next'

export const metadata: Metadata = {
  alternates: {
    canonical: '/hdb-valuation-tampines',
  },
}

export default function HdbValuationTampinesLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return children
}
