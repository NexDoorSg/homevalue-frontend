import type { Metadata } from 'next'

export const metadata: Metadata = {
  alternates: {
    canonical: '/hdb-valuation-sengkang',
  },
}

export default function HdbValuationSengkangLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return children
}
