import type { Metadata } from 'next'

export const metadata: Metadata = {
  alternates: {
    canonical: '/hdb-valuation-jurong-west',
  },
}

export default function HdbValuationJurongWestLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return children
}
