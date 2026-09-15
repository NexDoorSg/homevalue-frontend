// Canonical HDB street-abbreviation normaliser — the single source of truth,
// replacing 6+ drifted inline copies across the codebase. Maps the fuller street
// words OneMap returns ("BEDOK SOUTH ROAD") to the abbreviated form the HDB data
// stores ("BEDOK STH RD"), so subject-vs-record street matching lines up.
//
// The rule list lives in hdbStreetAbbrev.json so a Python consumer
// (scripts/*) can read the exact same rules — TS and Python never drift.
//
// Zero dependencies: safe to import from BOTH server code (valuation engine) and
// client components (browser bundle) without pulling in anything heavy.

import rules from './hdbStreetAbbrev.json'

// [/\bWORD\b/g, replacement] built from the JSON — identical to the previous
// hand-written literal arrays (every source is a single \bWORD\b token).
export const HDB_STREET_ABBREV: [RegExp, string][] = (rules as [string, string][]).map(
  ([src, rep]) => [new RegExp(`\\b${src}\\b`, 'g'), rep],
)

// Apply ONLY the abbreviation replacements, in order, to an already-cased string.
// For callers that keep chaining their own extra rules afterwards (e.g. the public
// pages that also fold in property-type abbreviations before their final trim).
export function applyHdbStreetAbbrev(s: string): string {
  let out = s
  for (const [rx, rep] of HDB_STREET_ABBREV) out = out.replace(rx, rep)
  return out
}

// Full street-key normaliser: upper-case, collapse whitespace, trim, abbreviate,
// collapse + trim again. Byte-identical to the previous normalizeHdbStreetKey()
// (valuation.ts / agent-report pages) and normalizeStreetName() (comparableRanking.ts).
export function normalizeHdbStreet(street: string | null | undefined): string {
  const s = (street || '').toUpperCase().replace(/\s+/g, ' ').trim()
  return applyHdbStreetAbbrev(s).replace(/\s+/g, ' ').trim()
}

// Alias under the name the engine / agent-report pages already used.
export const normalizeHdbStreetKey = normalizeHdbStreet

// Subject street key from an explicit street name, else parsed off the address
// (leading block token removed). Byte-identical to valuation.ts's exported
// subjectHdbStreetKey (its normalizeText = upper-case + trim, no inner collapse —
// replicated inline here so this module stays dependency-free).
export function subjectHdbStreetKey(
  streetName: string | null | undefined,
  address: string | null | undefined,
): string {
  const direct = normalizeHdbStreetKey(streetName)
  if (direct) return direct
  const fromAddress = (address || '').toUpperCase().trim().replace(/^(\d+[A-Z]?)\s+/, '').trim()
  return normalizeHdbStreetKey(fromAddress)
}
