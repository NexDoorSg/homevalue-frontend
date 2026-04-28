import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Free Property Valuation Singapore | HDB, Condo, EC & Landed | NexDoor',
  description:
    'Get a free instant property valuation in Singapore using recent HDB and URA transaction data. Estimate your HDB, condo, EC or landed property value before you sell.',
  alternates: {
    canonical: '/free-property-valuation-singapore',
  },
  openGraph: {
    title: 'Free Property Valuation Singapore | HDB, Condo, EC & Landed | NexDoor',
    description:
      'Get a free instant property valuation in Singapore using recent HDB and URA transaction data. Estimate your HDB, condo, EC or landed property value before you sell.',
    url: 'https://homevalue.nexdoor.sg/free-property-valuation-singapore',
    siteName: 'HomeValue by NexDoor',
    locale: 'en_SG',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Free Property Valuation Singapore | HDB, Condo, EC & Landed | NexDoor',
    description:
      'Get a free instant property valuation in Singapore using recent HDB and URA transaction data. Estimate your HDB, condo, EC or landed property value before you sell.',
  },
}

export default function FreePropertyValuationSingaporeLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return children
}
