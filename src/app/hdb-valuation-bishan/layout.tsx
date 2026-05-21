import type { Metadata } from 'next'

export const metadata: Metadata = {
  alternates: {
    canonical: '/hdb-valuation-bishan',
  },
}

export default function HdbValuationBishanLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return children
}
