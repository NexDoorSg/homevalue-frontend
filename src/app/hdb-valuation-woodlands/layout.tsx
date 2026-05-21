import type { Metadata } from 'next'

export const metadata: Metadata = {
  alternates: {
    canonical: '/hdb-valuation-woodlands',
  },
}

export default function HdbValuationWoodlandsLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return children
}
