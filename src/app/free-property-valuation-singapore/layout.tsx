import type { Metadata } from 'next'

const pageTitle = 'Check Your Property Value in Singapore | Free HomeValue Estimate by NexDoor'
const pageDescription =
  'Use HomeValue by NexDoor to get an indicative property value estimate for your HDB, condo, EC or landed home before deciding your next move.'

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
  name: 'Check Your Property Value in Singapore',
  url: 'https://homevalue.nexdoor.sg/free-property-valuation-singapore',
  description: pageDescription,
  isPartOf: {
    '@type': 'WebSite',
    name: 'HomeValue by NexDoor',
    url: 'https://homevalue.nexdoor.sg',
  },
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
              For the main HomeValue experience, visit the homepage to check your property value
              and understand the recent transactions around your home.
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
