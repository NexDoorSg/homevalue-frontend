export const metadata = {
  title: "Condo Valuation Singapore (2026) – Check Your Property Value Instantly | HomeValue",
  description:
    "Find out how much your condo or EC is worth in Singapore using real URA transaction data. Get an instant, data-driven valuation in seconds – free and no obligation.",
}

export default function CondoValuationSingaporePage() {
  return (
    <main className="min-h-screen bg-[#f7f4ef] px-6 py-12 md:px-12 lg:px-20">
      <div className="mx-auto max-w-4xl">
        <div className="bg-white rounded-2xl p-8 shadow-sm">

          {/* Title */}
          <h1 className="text-3xl font-semibold tracking-tight text-[#1e2226] md:text-4xl">
            Condo Valuation Singapore – How Much Is Your Property Worth?
          </h1>

          {/* Intro */}
          <p className="mt-4 text-base leading-7 text-[#4a4f55]">
            Wondering how much your condo or EC in Singapore is worth? This page helps you
            estimate your property valuation using recent URA transactions, comparable units,
            and current market trends. Whether you are planning to sell or just exploring your
            options, you can also use our free valuation tool to get an instant estimate based
            on real data in Singapore.
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
              Condo Prices in Singapore – What Is Your Unit Worth Today?
            </h2>
            <p className="mt-4 text-base leading-7 text-[#4a4f55]">
              Condo and EC prices in Singapore vary based on project, location, floor level,
              unit size, tenure, and recent transactions. Developments near MRT stations,
              in prime districts, or with strong rental demand tend to command higher prices
              in today’s market.
            </p>
          </section>

          <div className="mt-12 border-t border-[#e5e0da]" />

          {/* Section 2 */}
          <section className="mt-12">
            <h2 className="text-xl font-semibold text-[#1e2226]">
              What Affects Your Condo Valuation
            </h2>
            <ul className="mt-4 space-y-3 text-base text-[#4a4f55]">
              <li>• Project and location (district and proximity to MRT)</li>
              <li>• Unit size and layout efficiency</li>
              <li>• Floor level, facing, and view</li>
              <li>• Tenure (freehold vs leasehold)</li>
              <li>• Recent nearby URA transactions</li>
              <li>• Facilities, condition, and overall demand</li>
            </ul>
          </section>

          <div className="mt-12 border-t border-[#e5e0da]" />

          {/* Section 3 */}
          <section className="mt-12">
            <h2 className="text-xl font-semibold text-[#1e2226]">
              Get an Instant Condo Valuation
            </h2>
            <p className="mt-4 text-base leading-7 text-[#4a4f55]">
              Many homeowners search for terms like "condo valuation Singapore",
              "how much is my condo worth", or "property valuation Singapore".
              Instead of relying on rough estimates, our HomeValue tool gives you a fast
              and data-driven valuation based on real nearby transactions.
            </p>

            <p className="mt-4 text-sm text-[#5f666d]">
              Want a more accurate estimate?{" "}
              <a href="/" className="underline font-medium text-[#1e2226]">
                Check your property value now
              </a>.
            </p>
          </section>

          <div className="mt-12 text-center">
            <div className="border-t border-[#e5e0da] mb-6" />
          
            <p className="text-sm text-[#5f666d]">
              Looking for HDB valuations instead?{" "}
              <a href="/hdb-valuation-singapore" className="underline font-medium text-[#1e2226]">
                Check HDB valuation Singapore
              </a>.
            </p>
          
            <div className="border-t border-[#e5e0da] mt-6" />
          </div>

          {/* FAQ */}
          <section className="mt-12">
            <h2 className="text-2xl font-semibold text-[#1e2226]">
              Frequently Asked Questions
            </h2>

            <div className="mt-6 space-y-4">
              <div>
                <h3 className="font-medium text-[#1e2226]">
                  How do I estimate my condo value in Singapore?
                </h3>
                <p className="text-sm text-[#5f666d]">
                  You can estimate your condo value by looking at recent URA transactions,
                  similar units within your development, and current market demand.
                </p>
              </div>

              <div>
                <h3 className="font-medium text-[#1e2226]">
                  Are condo valuations accurate?
                </h3>
                <p className="text-sm text-[#5f666d]">
                  Online valuations provide a strong estimate based on data, but the final
                  selling price depends on buyer demand and negotiation.
                </p>
              </div>

              <div>
                <h3 className="font-medium text-[#1e2226]">
                  What affects condo prices the most?
                </h3>
                <p className="text-sm text-[#5f666d]">
                  Location, project demand, unit size, tenure, and nearby recent transactions
                  are the biggest factors affecting condo prices in Singapore.
                </p>
              </div>
            </div>
          </section>

        </div>
      </div>
    </main>
  )
}
