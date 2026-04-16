export const metadata = {
  title: "How Property Valuation Works in Singapore (2026 Guide) | HomeValue",
  description:
    "Learn how HDB, condo, EC and landed property valuation works in Singapore. Understand what affects your home value and how recent transactions influence pricing.",
}

export default function HowPropertyValuationWorksSingaporePage() {
  return (
    <main className="min-h-screen bg-[#f7f4ef] px-6 py-12 md:px-12 lg:px-20">
      <div className="mx-auto max-w-4xl">
        <div className="bg-white rounded-2xl p-8 shadow-sm">

          {/* Title */}
          <h1 className="text-3xl font-semibold tracking-tight text-[#1e2226] md:text-4xl">
            How Property Valuation Works in Singapore (2026 Guide)
          </h1>

          {/* Intro */}
          <p className="mt-4 text-base leading-7 text-[#4a4f55]">
            Wondering how property valuation works in Singapore? Whether you own an HDB flat,
            condo, EC or landed home, your property value is influenced by recent transactions,
            location, size, tenure, condition and current market demand.
          </p>

          {/* CTA */}
          <div className="mt-6">
            <a
              href="/"
              className="inline-block rounded-full bg-[#8b6b52] px-6 py-3 text-sm font-medium text-white transition hover:opacity-90"
            >
              Get Your Free Property Valuation
            </a>
          </div>

          <div className="mt-12 border-t border-[#e5e0da]" />

          {/* What is valuation */}
          <section className="mt-12">
            <h2 className="text-xl font-semibold text-[#1e2226]">
              What Is Property Valuation?
            </h2>
            <p className="mt-4 text-base leading-7 text-[#4a4f55]">
              Property valuation is an estimate of how much your home is worth based on recent
              comparable transactions. In Singapore, pricing is largely driven by what similar
              units nearby have recently sold for, with adjustments made for differences.
            </p>
          </section>

          <div className="mt-12 border-t border-[#e5e0da]" />

          {/* HDB */}
          <section className="mt-12">
            <h2 className="text-xl font-semibold text-[#1e2226]">
              How HDB Valuation Works
            </h2>
            <p className="mt-4 text-base leading-7 text-[#4a4f55]">
              HDB valuation is based on resale transactions within the same block or nearby.
              Factors like flat type, floor area, floor level, remaining lease and renovation
              condition all affect pricing.
            </p>

            <p className="mt-4 text-sm text-[#5f666d]">
              <a href="/hdb-valuation-singapore" className="underline font-medium text-[#1e2226]">
                Check HDB valuation Singapore
              </a>
            </p>
          </section>

          <div className="mt-12 border-t border-[#e5e0da]" />

          {/* Condo */}
          <section className="mt-12">
            <h2 className="text-xl font-semibold text-[#1e2226]">
              How Condo and EC Valuation Works
            </h2>
            <p className="mt-4 text-base leading-7 text-[#4a4f55]">
              Condo valuation is based on URA transactions within the same development or nearby
              projects. Key factors include unit size, floor level, facing, tenure and demand
              within the project.
            </p>

            <p className="mt-4 text-sm text-[#5f666d]">
              <a href="/condo-valuation-singapore" className="underline font-medium text-[#1e2226]">
                Check condo valuation Singapore
              </a>
            </p>
          </section>

          <div className="mt-12 border-t border-[#e5e0da]" />

          {/* Landed */}
          <section className="mt-12">
            <h2 className="text-xl font-semibold text-[#1e2226]">
              How Landed Property Valuation Works
            </h2>
            <p className="mt-4 text-base leading-7 text-[#4a4f55]">
              Landed homes are valued based on land size, built-up area, location, tenure and
              nearby transactions. Because landed homes differ significantly, adjustments tend
              to be larger compared to HDB or condo valuation.
            </p>
          </section>

          <div className="mt-12 border-t border-[#e5e0da]" />

          {/* Factors */}
          <section className="mt-12">
            <h2 className="text-xl font-semibold text-[#1e2226]">
              What Affects Property Value the Most?
            </h2>
            <ul className="mt-4 space-y-3 text-base text-[#4a4f55]">
              <li>• Recent nearby transactions</li>
              <li>• Location and accessibility</li>
              <li>• Property type and tenure</li>
              <li>• Size and layout</li>
              <li>• Floor level and facing</li>
              <li>• Renovation and condition</li>
              <li>• Market demand</li>
            </ul>
          </section>

          <div className="mt-12 border-t border-[#e5e0da]" />

          {/* CTA */}
          <section className="mt-12 text-center">
            <h2 className="text-xl font-semibold text-[#1e2226]">
              Get a Free Property Valuation
            </h2>

            <p className="mt-4 text-base text-[#4a4f55]">
              Use our HomeValue tool to estimate your property value instantly based on real
              transaction data.
            </p>

            <div className="mt-6">
              <a
                href="/"
                className="inline-block rounded-full bg-[#8b6b52] px-6 py-3 text-sm font-medium text-white transition hover:opacity-90"
              >
                Check Your Property Value Now
              </a>
            </div>
          </section>

          <div className="mt-16 border-t border-[#e5e0da]" />

          {/* Internal links */}
          <section className="mt-12">
            <h2 className="text-2xl font-semibold text-[#1e2226]">
              Related Pages
            </h2>

            <ul className="mt-6 space-y-2 text-sm">
              <li>
                <a href="/hdb-valuation-singapore" className="underline text-[#8b6b52]">
                  HDB Valuation Singapore
                </a>
              </li>
              <li>
                <a href="/condo-valuation-singapore" className="underline text-[#8b6b52]">
                  Condo Valuation Singapore
                </a>
              </li>
            </ul>
          </section>

        </div>
      </div>
    </main>
  )
}
