'use client'

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { usePathname } from 'next/navigation'

const USE_CASES = [
  { title: 'Selling', body: 'Know your possible selling range before setting a price.' },
  { title: 'Buying', body: 'Check if an asking price feels realistic before you shortlist.' },
  { title: 'Upgrading', body: 'Estimate sale proceeds before planning the next move.' },
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

function findSectionByHeading(phrases: string[]) {
  const headings = Array.from(document.querySelectorAll('h2, h3'))

  const match = headings.find((heading) => {
    const text = heading.textContent?.toLowerCase().replace(/\s+/g, ' ').trim() || ''
    return phrases.some((phrase) => text.includes(phrase))
  })

  return match?.closest('section') || null
}

export default function HomeValueBrandSections() {
  const pathname = usePathname()
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null)

  const showSections = pathname === '/' || pathname === '/free-property-valuation-singapore'

  useEffect(() => {
    if (!showSections) return

    const existingSlot = document.getElementById('homevalue-brand-sections-slot')
    if (existingSlot) existingSlot.remove()

    const slot = document.createElement('div')
    slot.id = 'homevalue-brand-sections-slot'

    const preferredTarget =
      findSectionByHeading(['a faster way to understand']) ||
      findSectionByHeading(['questions homeowners often ask']) ||
      findSectionByHeading(['know what your property could be worth before your next move'])

    if (preferredTarget?.parentElement) {
      preferredTarget.parentElement.insertBefore(slot, preferredTarget)
    } else {
      const main = document.querySelector('main')
      main?.appendChild(slot)
    }

    setPortalTarget(slot)

    return () => {
      slot.remove()
      setPortalTarget(null)
    }
  }, [showSections, pathname])

  if (!showSections || !portalTarget) return null

  return createPortal(
    <div className="homevalue-brand-sections" aria-label="HomeValue by NexDoor information">
      <section className="homevalue-use-section">
        <div className="homevalue-section-inner">
          <div className="homevalue-section-heading">
            <p className="homevalue-eyebrow">Why homeowners use HomeValue</p>
            <h2>Useful before your next property move</h2>
            <p>
              A quick benchmark before selling, buying, upgrading or checking where
              your property stands in today’s market.
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
            <h2>Property decisions, made with more clarity</h2>
            <p>
              HomeValue is created by NexDoor, a Singapore property agency operated by
              NEXDOOR PTE. LTD. and licensed under CEA Estate Agent Licence L3011052H.
              We help homeowners and buyers read the numbers, understand the market and
              plan the next move with confidence.
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
              free whether you are selling, buying, upgrading or just checking.
            </p>
          </div>
          <a href={pathname === '/' ? '/free-property-valuation-singapore' : '#valuation-form-card'}>
            Check Your Value First
          </a>
        </div>
      </section>
    </div>,
    portalTarget
  )
}
