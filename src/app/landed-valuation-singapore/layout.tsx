import type { Metadata } from 'next'

export const metadata: Metadata = {
  alternates: {
    canonical: '/landed-valuation-singapore',
  },
}

export default function LandedValuationSingaporeLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return children
}
