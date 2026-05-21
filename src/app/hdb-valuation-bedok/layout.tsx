import type { Metadata } from 'next'

export const metadata: Metadata = {
  alternates: {
    canonical: '/hdb-valuation-bedok',
  },
}

export default function HdbValuationBedokLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return children
}
