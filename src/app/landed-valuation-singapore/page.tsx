export const metadata = {
  title: "Landed Property Valuation Singapore (2026) – Check Your Home Value | HomeValue",
  description:
    "Find out how much your landed property in Singapore is worth using real transaction data. Estimate your terrace, semi-detached or bungalow value instantly.",
}

export default function LandedValuationSingaporePage() {
  return (
    <main className="min-h-screen bg-[#f7f4ef] px-6 py-12 md:px-12 lg:px-20">
      <div className="mx-auto max-w-4xl">
        <div className="bg-white rounded-2xl p-8 shadow-sm">

          {/* Title */}
          <h1 className="text-3xl font-semibold tracking-tight text-[#1e2226] md:text-4xl">
            Landed Property Valuation Singapore – How Much Is Your House Worth?
          </h1>

          {/* Intro */}
          <p className="mt-4 text-base leading-7 text-[#4a4f55]">
            Wondering how much your landed property in Singapore is worth? Whether you own a terrace house,
            semi-detached home or bungalow, valuation is influenced by land size, built-up area, location,
            tenure and recent nearby transactions. This page helps you understand how landed property valuation
            works and how to estimate your home’s value using real data.
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

          {/* Section 1 */}
          <section className="mt-12">
            <h2 className="text-xl font-semibold text-[#1e2226]">
              What Is Landed Property Valuation?
            </h2>
            <p className="mt-4 text-base leading-7 text-[#4a4f55]">
              Landed property valuation estimates how much your house is worth based on recent comparable
              transactions and key characteristics such as land size, frontage, zoning and condition.
              Unlike HDB flats or condos, landed homes vary significantly, making valuation more nuanced.
            </p>
          </section>

          <div className="mt-12 border-t border-[#e5e0da]" />

          {/* Section 2 */}
          <section className="mt-12">
            <h2 className="text-xl font-semibold text-[#1e2226]">
              What Affects Landed Property Value
            </h2>
            <ul className="mt-4 space-y-3 text-base text-[#4a4f55]">
              <li>• Land size and plot dimensions</li>
              <li>• Built-up area and layout</li>
              <li>• Property type (terrace, semi-detached, detached)</li>
              <li>• Tenure (freehold vs leasehold)</li>
              <li>• Location and neighbourhood demand</li>
              <li>• Road access, frontage and facing</li>
              <li>• Renovation condition and age</li>
              <li>• Nearby recent landed transactions</li>
            </ul>
          </section>

          <div className="mt-12 border-t border-[#e5e0da]" />

          {/* Section 3 */}
          <section className="mt-12">
            <h2 className="text-xl font-semibold text-[#1e2226]">
              Why Landed Homes Are Harder to Value
            </h2>
            <p className="mt-4 text-base leading-7 text-[#4a4f55]">
              Unlike HDB flats or condos, no two landed homes are exactly the same. Differences in land size,
              shape, elevation, built-up space and condition mean that valuations require more adjustments.
              This is why landed pricing can vary significantly even within the same street.
            </p>
          </section>

          <div className="mt-12 border-t border-[#e5e0da]" />

          {/* Section 4 */}
          <section className="mt-12">
            <h2 className="text-xl font-semibold text-[#1e2226]">
              How to Estimate Your Landed Property Value
            </h2>
            <p className="mt-4 text-base leading-7 text-[#4a4f55]">
              The best way to estimate your landed property value is by comparing recent transactions of similar
              homes nearby, then adjusting for land size, built-up area and condition. A data-driven approach
              gives you a strong starting point before considering actual buyer demand.
            </p>
          </section>

          <div className="mt-12 border-t border-[#e5e0da]" />

          {/* CTA */}
          <section className="mt-12 text-center">
            <h2 className="text-xl font-semibold text-[#1e2226]">
              Get a Free Landed Property Valuation
            </h2>

            <p className="mt-4 text-base text-[#4a4f55]">
              Use our HomeValue tool to estimate your property value instantly using real transaction data.
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
              Explore Other Valuation Pages
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
