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

const jsonLd = {
  '@context': 'https://schema.org',
  '@type': 'WebPage',
  name: 'Free Property Valuation Singapore',
  url: 'https://homevalue.nexdoor.sg/free-property-valuation-singapore',
  description:
    'Get a free instant property valuation in Singapore using recent HDB and URA transaction data. Estimate your HDB, condo, EC or landed property value before you sell.',
  publisher: {
    '@type': 'Organization',
    name: 'NexDoor',
    url: 'https://www.nexdoor.sg',
  },
}

export default function FreePropertyValuationSingaporeLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      {children}
      <section className="bg-[#fbf5ee] px-6 pb-16 md:px-10">
        <div className="mx-auto max-w-[1440px] rounded-[28px] border border-[#f0dfcf] bg-white/90 p-6 shadow-[0_20px_60px_rgba(54,69,79,0.06)] sm:p-8">
          <div className="max-w-4xl">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#bf6d34]">
              Free property valuation Singapore
            </p>
            <h2 className="mt-3 text-2xl font-semibold tracking-tight text-[#2d3135] sm:text-3xl">
              Estimate your HDB, condo, EC or landed property value before you sell
            </h2>
            <p className="mt-4 text-sm leading-7 text-[#5f666d] sm:text-base">
              HomeValue by NexDoor helps Singapore homeowners get an indicative property value
              using recent HDB and URA transaction data. The estimate gives you a starting point
              before deciding on your asking price, marketing strategy or next property move.
            </p>
            <p className="mt-4 text-sm leading-7 text-[#5f666d] sm:text-base">
              This online estimate is not a formal bank or HDB valuation. It is designed to help
              you understand where your property may sit in today’s market based on comparable
              transaction data, property type, floor area, floor level, tenure and location.
            </p>
            <div className="mt-6 flex flex-wrap gap-3 text-sm">
              <a className="underline text-[#8b6b52]" href="/hdb-valuation-singapore">
                HDB valuation Singapore
              </a>
              <a className="underline text-[#8b6b52]" href="/condo-valuation-singapore">
                Condo valuation Singapore
              </a>
              <a className="underline text-[#8b6b52]" href="/landed-valuation-singapore">
                Landed valuation Singapore
              </a>
              <a className="underline text-[#8b6b52]" href="/how-property-valuation-works-singapore">
                How property valuation works
              </a>
            </div>
          </div>
        </div>
      </section>
    </>
  )
}
