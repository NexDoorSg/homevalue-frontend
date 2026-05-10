'use client'

/**
 * Temporarily disabled.
 *
 * This component previously injected sqft/sqm selectors into the HomeValue forms
 * by scanning and mutating the DOM. On landed property selections, the injected
 * layout changes could repeatedly trigger its MutationObserver and freeze the
 * page.
 *
 * Keep this as a no-op until the sqft/sqm selector is rebuilt directly inside
 * the React form components.
 */
export default function HomeValueAreaUnitSelector() {
  return null
}
