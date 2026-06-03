import type { Metadata } from 'next'

const pageTitle = 'Free Property Valuation Singapore | HDB, Condo, EC & Landed | NexDoor'
const pageDescription =
  'Get a free property valuation estimate in Singapore for HDB, condo, EC and landed homes using recent HDB and URA transaction data. Use HomeValue by NexDoor before selling, buying, upgrading or refinancing.'

export const metadata: Metadata = {
  title: pageTitle,
  description: pageDescription,
  alternates: {
    canonical: '/free-property-valuation-singapore',
  },
  openGraph: {
    title: pageTitle,
    description: pageDescription,
    url: 'https://homevalue.nexdoor.sg/free-property-valuation-singapore',
    siteName: 'HomeValue by NexDoor',
    locale: 'en_SG',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: pageTitle,
    description: pageDescription,
  },
}

const jsonLd = {
  '@context': 'https://schema.org',
  '@type': 'WebPage',
  '@id': 'https://homevalue.nexdoor.sg/free-property-valuation-singapore#webpage',
  name: pageTitle,
  url: 'https://homevalue.nexdoor.sg/free-property-valuation-singapore',
  description: pageDescription,
  inLanguage: 'en-SG',
  isPartOf: {
    '@id': 'https://homevalue.nexdoor.sg/#website',
  },
  publisher: {
    '@id': 'https://www.nexdoor.sg/#organization',
  },
  about: [
    'Free property valuation Singapore',
    'HDB valuation Singapore',
    'Condo valuation Singapore',
    'Executive condominium valuation Singapore',
    'Landed property valuation Singapore',
    'Singapore residential property value estimate',
  ],
  mainEntity: {
    '@type': 'WebApplication',
    '@id': 'https://homevalue.nexdoor.sg/#webapplication',
    name: 'HomeValue by NexDoor',
    applicationCategory: 'BusinessApplication',
    operatingSystem: 'All',
    isAccessibleForFree: true,
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
      <section className="bg-[#fbf7ef] px-6 pb-16 md:px-10">
        <div className="mx-auto max-w-[1440px] rounded-[28px] border border-[#d8c7ad] bg-[#f8f1e6] p-6 shadow-[0_20px_60px_rgba(23,36,58,0.06)] sm:p-8">
          <div className="max-w-4xl">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#a9894f]">
              HomeValue by NexDoor
            </p>
            <h2 className="mt-3 text-2xl font-semibold tracking-tight text-[#17243a] sm:text-3xl">
              A free starting point before you decide your next move
            </h2>
            <p className="mt-4 text-sm leading-7 text-[#71695d] sm:text-base">
              HomeValue by NexDoor helps Singapore homeowners get an indicative property value
              using recent HDB and URA transaction data. It is useful before selling, buying,
              upgrading, refinancing or simply checking where your home stands today.
            </p>
            <p className="mt-4 text-sm leading-7 text-[#71695d] sm:text-base">
              This online estimate is not a formal bank or HDB valuation. It is designed to give
              you a practical starting point based on comparable transaction data, property type,
              floor area, floor level, tenure and location.
            </p>
            <p className="mt-4 text-sm leading-7 text-[#71695d] sm:text-base">
              HomeValue is created by NexDoor, a Singapore property agency operated by NEXDOOR
              PTE. LTD. and licensed under CEA Estate Agent Licence L3011052H.
            </p>
            <div className="mt-6 flex flex-wrap gap-3 text-sm">
              <a className="underline text-[#87692d]" href="/">
                Go to HomeValue homepage
              </a>
              <a className="underline text-[#87692d]" href="https://www.nexdoor.sg/contact">
                Speak with NexDoor
              </a>
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}
