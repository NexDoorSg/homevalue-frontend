import type { Metadata } from 'next'

export const metadata: Metadata = {
  alternates: {
    canonical: '/hdb-valuation-yishun',
  },
}

export default function HdbValuationYishunLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return children
}
