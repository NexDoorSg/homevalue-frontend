export default function HdbValuationSingaporePage() {
  return (
    <main className="min-h-screen bg-[#f7f4ef] px-6 py-12 md:px-12 lg:px-20">
      <div className="mx-auto max-w-4xl">
        <div className="bg-white rounded-2xl p-8 shadow-sm">
          <h1 className="text-3xl font-semibold tracking-tight text-[#1e2226] md:text-4xl">
            HDB Valuation Singapore (Free Estimate Based on Recent Transactions)
          </h1>

          <p className="mt-4 text-base leading-7 text-[#4a4f55]">
            Find out how much your HDB flat in Singapore may be worth using recent
            transaction data. Our free valuation tool gives homeowners a fast,
            data-driven estimate based on nearby comparable sales and market trends.
          </p>

          <div className="mt-6">
            <a
              href="/"
              className="inline-block rounded-full bg-[#8b6b52] px-6 py-3 text-sm font-medium text-white transition hover:opacity-90"
            >
              Get Your Free Property Valuation
            </a>
          </div>

          <div className="mt-12 border-t border-[#e5e0da]" />

          <section className="mt-12">
            <h2 className="text-xl font-semibold text-[#1e2226]">
              How HDB Valuation Works in Singapore
            </h2>
            <p className="mt-4 text-base leading-7 text-[#4a4f55]">
              HDB valuation depends on factors such as location, flat type, floor
              level, remaining lease, condition, and recent nearby transactions.
              Buyers and sellers often look at comparable resale prices in the
              surrounding area to understand current market value before deciding on
              pricing.
            </p>
          </section>

          <div className="mt-12 border-t border-[#e5e0da]" />

          <section className="mt-12">
            <h2 className="text-xl font-semibold text-[#1e2226]">
              What Affects Your HDB Value
            </h2>
            <ul className="mt-4 space-y-3 text-base text-[#4a4f55]">
              <li>• Town and specific block location</li>
              <li>• Flat type and floor area</li>
              <li>• Floor level and facing</li>
              <li>• Remaining lease</li>
              <li>• Nearby recent resale transactions</li>
              <li>• Renovation condition and overall appeal</li>
            </ul>
          </section>

          <div className="mt-12 border-t border-[#e5e0da]" />

          <section className="mt-12">
            <h2 className="text-xl font-semibold text-[#1e2226]">
              Get an Instant HDB Valuation
            </h2>
            <p className="mt-4 text-base leading-7 text-[#4a4f55]">
              Instead of relying on rough estimates, use our HomeValue tool to get a
              fast HDB valuation in Singapore based on recent transactions and
              comparable homes in the market.
            </p>

            <p className="mt-4 text-sm text-[#5f666d]">
              Want a more accurate estimate?{" "}
              <a href="/" className="underline font-medium text-[#1e2226]">
                Check your HDB value now
              </a>.
            </p>
          </section>

          <div className="mt-16 border-t border-[#e5e0da]" />

          <section className="mt-12">
            <h2 className="text-2xl font-semibold text-[#1e2226]">
              Explore HDB Valuation by Area
            </h2>

            <div className="mt-6 space-y-3 text-sm">
              <div>
                <a
                  href="/hdb-valuation-tampines"
                  className="underline text-[#8b6b52] hover:text-[#6f5440]"
                >
                  HDB Valuation Tampines
                </a>
              </div>
              <div>
                <a
                  href="/hdb-valuation-yishun"
                  className="underline text-[#8b6b52] hover:text-[#6f5440]"
                >
                  HDB Valuation Yishun
                </a>
              </div>
              <div>
                <a
                  href="/hdb-valuation-woodlands"
                  className="underline text-[#8b6b52] hover:text-[#6f5440]"
                >
                  HDB Valuation Woodlands
                </a>
              </div>
              <div>
                <a
                  href="/hdb-valuation-jurong-west"
                  className="underline text-[#8b6b52] hover:text-[#6f5440]"
                >
                  HDB Valuation Jurong West
                </a>
              </div>
            </div>
          </section>

          <div className="mt-12 border-t border-[#e5e0da]" />

          <section className="mt-12">
            <h2 className="text-2xl font-semibold text-[#1e2226]">
              Frequently Asked Questions
            </h2>

            <div className="mt-6 space-y-4">
              <div>
                <h3 className="font-medium text-[#1e2226]">
                  How do I estimate my HDB value in Singapore?
                </h3>
                <p className="text-sm text-[#5f666d]">
                  You can estimate your HDB value by looking at recent nearby resale
                  transactions, comparable flat types, and current market conditions.
                </p>
              </div>

              <div>
                <h3 className="font-medium text-[#1e2226]">
                  Can I sell my HDB above valuation?
                </h3>
                <p className="text-sm text-[#5f666d]">
                  Yes, depending on buyer demand and market conditions, some sellers
                  may achieve Cash Over Valuation (COV).
                </p>
              </div>

              <div>
                <h3 className="font-medium text-[#1e2226]">
                  How accurate is an online HDB valuation?
                </h3>
                <p className="text-sm text-[#5f666d]">
                  It gives a strong indicative estimate based on recent data, but the
                  final sale price still depends on actual buyer demand and negotiation.
                </p>
              </div>
            </div>
          </section>
        </div>
      </div>
    </main>
  )
}
