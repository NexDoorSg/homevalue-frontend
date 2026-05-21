import type { Metadata } from 'next'

export const metadata: Metadata = {
  alternates: {
    canonical: '/how-much-is-my-property-worth-singapore',
  },
}

export default function HowMuchIsMyPropertyWorthSingaporeLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return children
}
