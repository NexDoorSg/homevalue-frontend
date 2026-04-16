export default function TampinesValuationPage() {
  return (
    <main className="min-h-screen bg-[#f7f4ef] px-6 py-12 md:px-12 lg:px-20">
      
      <div className="mx-auto max-w-4xl">
        
        <div className="bg-white rounded-2xl p-8 shadow-sm">
        
          {/* Title */}
          <h1 className="text-3xl font-semibold tracking-tight text-[#1e2226] md:text-4xl">
            HDB Valuation in Tampines (Free Estimate Based on Recent Transactions)
          </h1>

          {/* Intro */}
          <p className="mt-4 text-base leading-7 text-[#4a4f55]">
            Looking to find out how much your HDB flat in Tampines is worth? 
            This page gives you an overview of Tampines HDB prices based on recent 
            transactions, and you can use our free valuation tool to get an instant estimate.
          </p>

          {/* ✅ SINGLE MAIN CTA */}
          <div className="mt-6">
            <a
              href="/"
              className="inline-block rounded-full bg-[#8b6b52] px-6 py-3 text-sm font-medium text-white transition hover:opacity-90"
            >
              Get Your Free Property Valuation
            </a>
          </div>

          {/* Divider */}
          <div className="mt-12 border-t border-[#e5e0da]" />

          {/* Section 1 */}
          <section className="mt-12">
            <h2 className="text-xl font-semibold text-[#1e2226]">
              Tampines HDB Prices and Market Trends
            </h2>
            <p className="mt-4 text-base leading-7 text-[#4a4f55]">
              Tampines is one of the largest and most mature HDB estates in Singapore, 
              with strong demand from both families and upgraders. Prices vary depending 
              on flat type, floor level, proximity to MRT stations, and renovation condition.
            </p>
          </section>

          {/* Divider */}
          <div className="mt-12 border-t border-[#e5e0da]" />

          {/* Section 2 */}
          <section className="mt-12">
            <h2 className="text-xl font-semibold text-[#1e2226]">
              What Affects Your HDB Valuation in Tampines
            </h2>
            <ul className="mt-4 space-y-3 text-base text-[#4a4f55]">
              <li>• Distance to Tampines MRT and major amenities</li>
              <li>• Floor level and facing</li>
              <li>• Flat size and layout</li>
              <li>• Remaining lease</li>
              <li>• Recent nearby transactions</li>
            </ul>
          </section>

          {/* Divider */}
          <div className="mt-12 border-t border-[#e5e0da]" />

          {/* Section 3 */}
          <section className="mt-12">
            <h2 className="text-xl font-semibold text-[#1e2226]">
              Get an Instant HDB Valuation
            </h2>
            <p className="mt-4 text-base leading-7 text-[#4a4f55]">
              Instead of relying on rough estimates, you can use our HomeValue tool 
              to get a data-driven valuation based on recent HDB transactions across Singapore.
            </p>

            {/* ✅ SOFT CTA (not a button) */}
            <p className="mt-4 text-sm text-[#5f666d]">
              Want a more accurate estimate?{" "}
              <a href="/" className="underline font-medium text-[#1e2226]">
                Check your HDB value now
              </a>.
            </p>
          </section>

          {/* Divider */}
          <div className="mt-16 border-t border-[#e5e0da]" />

          {/* FAQ */}
          <section className="mt-12">
            <h2 className="text-2xl font-semibold text-[#1e2226]">
              Frequently Asked Questions
            </h2>

            <div className="mt-6 space-y-4">
              <div>
                <h3 className="font-medium text-[#1e2226]">
                  How much are HDB flats in Tampines worth?
                </h3>
                <p className="text-sm text-[#5f666d]">
                  Prices vary depending on flat type, location and condition, but Tampines 
                  generally sees strong demand due to its amenities and connectivity.
                </p>
              </div>

              <div>
                <h3 className="font-medium text-[#1e2226]">
                  Can I sell above valuation in Tampines?
                </h3>
                <p className="text-sm text-[#5f666d]">
                  Yes, depending on market demand and buyer interest, some units may achieve 
                  Cash Over Valuation (COV).
                </p>
              </div>

              <div>
                <h3 className="font-medium text-[#1e2226]">
                  How accurate is an online valuation?
                </h3>
                <p className="text-sm text-[#5f666d]">
                  It provides a strong estimate based on recent data, but final pricing 
                  depends on buyer demand and negotiations.
                </p>
              </div>
            </div>
          </section>

        </div>
      </div>
    </main>
  )
}
