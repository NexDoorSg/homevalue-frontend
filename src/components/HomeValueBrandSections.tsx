'use client'

import { usePathname } from 'next/navigation'

const USE_CASES = [
  { title: 'Selling', body: 'Know your possible selling range before setting a price.' },
  { title: 'Buying', body: 'Check if an asking price feels realistic before you shortlist.' },
  { title: 'Upgrading', body: 'Estimate your sale proceeds before planning the next move.' },
  { title: 'Exploring', body: 'Track your home’s market value without obligation.' },
]

function BrandLogoLockup() {
  return (
    <div className="homevalue-logo-lockup">
      <div className="homevalue-logo-wordmark">NexDoor.</div>
      <div className="homevalue-logo-tagline">Property Decisions, Made With Precision.</div>
    </div>
  )
}

export default function HomeValueBrandSections() {
  const pathname = usePathname()
  const showSections = pathname === '/' || pathname === '/free-property-valuation-singapore'

  if (!showSections) return null

  return (
    <div className="homevalue-brand-sections">
      <section className="homevalue-use-section">
        <div className="homevalue-section-inner">
          <div className="homevalue-section-heading">
            <p className="homevalue-eyebrow">Why homeowners use HomeValue</p>
            <h2>Useful before your next property move</h2>
            <p>
              Whether you are selling, buying, upgrading or simply checking the market,
              HomeValue gives you a clearer starting point using recent transaction data.
            </p>
          </div>

          <div className="homevalue-use-grid">
            {USE_CASES.map((item) => (
              <article key={item.title} className="homevalue-use-card">
                <p>{item.title}</p>
                <span>{item.body}</span>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="homevalue-nexdoor-section">
        <div className="homevalue-section-inner homevalue-nexdoor-panel">
          <div>
            <p className="homevalue-eyebrow">Powered by NexDoor</p>
            <h2>A boutique property agency built around clearer decisions</h2>
            <p>
              HomeValue is created by NexDoor to help homeowners and buyers make sense
              of property values with data, market context and practical planning.
            </p>
          </div>
          <BrandLogoLockup />
        </div>
      </section>

      <section className="homevalue-offer-section">
        <div className="homevalue-section-inner homevalue-offer-panel">
          <div>
            <p className="homevalue-eyebrow">For homeowners considering a sale</p>
            <h2>Selling soon? 1% commission, 0% GST.</h2>
            <p>
              Available for the first 100 appointed selling clients. HomeValue remains
              free to use whether you are selling, buying, upgrading or just checking.
            </p>
          </div>
          <a href="/free-property-valuation-singapore">
            Check Your Value First
          </a>
        </div>
      </section>
    </div>
  )
}
