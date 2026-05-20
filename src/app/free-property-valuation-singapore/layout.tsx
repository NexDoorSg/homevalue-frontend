import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Free Property Valuation Singapore | Check Your Home Value | NexDoor',
  description:
    'Check what your property could be worth before your next move. Get a free estimate for HDB, condo, EC and landed homes using recent HDB and URA transactions.',
  alternates: {
    canonical: '/free-property-valuation-singapore',
  },
  openGraph: {
    title: 'Free Property Valuation Singapore | Check Your Home Value | NexDoor',
    description:
      'Check what your property could be worth before your next move. Get a free estimate for HDB, condo, EC and landed homes using recent HDB and URA transactions.',
    url: 'https://homevalue.nexdoor.sg/free-property-valuation-singapore',
    siteName: 'HomeValue by NexDoor',
    locale: 'en_SG',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Free Property Valuation Singapore | Check Your Home Value | NexDoor',
    description:
      'Check what your property could be worth before your next move. Get a free estimate for HDB, condo, EC and landed homes using recent HDB and URA transactions.',
  },
}

const jsonLd = {
  '@context': 'https://schema.org',
  '@type': 'WebPage',
  name: 'Free Property Valuation Singapore',
  url: 'https://homevalue.nexdoor.sg/free-property-valuation-singapore',
  description:
    'Check what your property could be worth before your next move using recent HDB and URA transaction data.',
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
    <div className="free-property-valuation-page">
      <script type="application/ld+json">{JSON.stringify(jsonLd)}</script>
      {children}
      <section className="bg-[#f8f1e7] px-6 pb-16 md:px-10">
        <div className="mx-auto max-w-[1440px] rounded-[28px] border border-[#ead7c6] bg-[#fffaf5] p-6 shadow-[0_20px_60px_rgba(23,36,58,0.06)] sm:p-8">
          <div className="max-w-4xl">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#B88746]">
              Free property valuation Singapore
            </p>
            <h2 className="mt-3 text-2xl font-semibold tracking-tight text-[#17243a] sm:text-3xl">
              Know what your property could be worth before your next move
            </h2>
            <p className="mt-4 text-sm leading-7 text-[#4b5563] sm:text-base">
              HomeValue by NexDoor helps Singapore homeowners get an indicative property value
              using recent HDB and URA transaction data. It is useful before selling, buying,
              upgrading, refinancing or simply checking where your home stands today.
            </p>
            <p className="mt-4 text-sm leading-7 text-[#4b5563] sm:text-base">
              This online estimate is not a formal bank or HDB valuation. It is designed to give
              you a practical starting point based on comparable transaction data, property type,
              floor area, floor level, tenure and location.
            </p>
            <div className="mt-6 flex flex-wrap gap-3 text-sm">
              <a className="underline text-[#7a5a2d]" href="/hdb-valuation-singapore">
                HDB valuation Singapore
              </a>
              <a className="underline text-[#7a5a2d]" href="/condo-valuation-singapore">
                Condo valuation Singapore
              </a>
              <a className="underline text-[#7a5a2d]" href="/landed-valuation-singapore">
                Landed valuation Singapore
              </a>
              <a className="underline text-[#7a5a2d]" href="/how-property-valuation-works-singapore">
                How property valuation works
              </a>
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}
