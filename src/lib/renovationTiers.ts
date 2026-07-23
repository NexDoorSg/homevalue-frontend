// ─── Renovation-condition tiers (presentation deck) ──────────────────────────
// A COST-APPROACH overlay, deliberately kept OUT of the valuation engine and out
// of Market Value / Suggested Listing Price. No data source tracks renovation
// condition, so these tiers are NOT derived from comparable sales — they are
// typical Singapore renovation costs applied around the Market Value baseline.
// Anything that displays them must say so (see CONDITION_BASIS_NOTE).
//
//   conditionOriginal      = Market Value − full renovation cost   (floored)
//   conditionRenovated     = Market Value                          (the baseline)
//   conditionWellRenovated = Market Value + recovered premium-spec increment
//
// Cost anchors are 2026 Singapore full-renovation figures, banded by size because
// floor area is always available (HDB room type is not, on every caller).

export type ConditionPropertyCategory = 'hdb' | 'condo' | 'ec' | 'landed'

type RenoBand = { maxSqm: number; cost: number; label: string }

// HDB — anchors: 3-room ~60-70sqm $55k, 4-room ~90-100sqm $75k,
// 5-room ~110-120sqm $95k, Executive ~130-145sqm $110k. The <55sqm band is an
// extension below the smallest researched anchor: applying the 3-room $55k to a
// 31sqm 1-room implied ~$1,774/sqm (vs the 3-room anchor's ~$846/sqm) and an
// out-of-scale ~21% discount, so 1-2 room flats get their own ~$40k cost.
const HDB_BANDS: RenoBand[] = [
  { maxSqm: 55, cost: 40_000, label: 'HDB 1-2 room' },
  { maxSqm: 75, cost: 55_000, label: 'HDB 3-room' },
  { maxSqm: 105, cost: 75_000, label: 'HDB 4-room' },
  { maxSqm: 125, cost: 95_000, label: 'HDB 5-room' },
  { maxSqm: Infinity, cost: 110_000, label: 'HDB Executive' },
]

// Condo/EC — anchors: studio/1BR <60sqm $45k, 2BR 60-90sqm $60k,
// 3BR 90-125sqm $72k, 4BR+ 125sqm+ $85k.
const CONDO_BANDS: RenoBand[] = [
  { maxSqm: 60, cost: 45_000, label: 'Condo studio / 1BR' },
  { maxSqm: 90, cost: 60_000, label: 'Condo 2BR' },
  { maxSqm: 125, cost: 72_000, label: 'Condo 3BR' },
  { maxSqm: Infinity, cost: 85_000, label: 'Condo 4BR+' },
]

// Premium spec is assumed to cost 1.5× a standard full renovation; a buyer
// typically pays back ~half of that incremental spend. Net effect:
// wellRenovated = MV + 0.5 × (1.5 − 1) × renoCost = MV + 0.25 × renoCost.
// These two are the softest assumptions here — tune them if the deck's
// renovation research says otherwise.
const PREMIUM_SPEC_MULTIPLIER = 1.5
const PREMIUM_RECOVERY_SHARE = 0.5

// An unrenovated unit is never worth less than this share of Market Value — stops
// the flat cost subtraction going absurd (or negative) on small/low-value units,
// where a $55k renovation would otherwise be a huge share of the price.
const ORIGINAL_CONDITION_FLOOR_SHARE = 0.7

export const CONDITION_BASIS_NOTE =
  'Based on typical Singapore renovation costs, not comparable sales.'

export type RenovationConditionTiers = {
  conditionOriginal: number
  conditionRenovated: number
  conditionWellRenovated: number
  /** Full-renovation cost used for this unit's size/type band. */
  conditionRenoCost: number
  /** Human-readable band the cost came from, e.g. "HDB 4-room". */
  conditionRenoBand: string
  /** Always 'cost_approach' — these tiers are not derived from transactions. */
  conditionBasis: 'cost_approach'
  /** Display-ready disclaimer; render wherever the tiers appear. */
  conditionNote: string
  /** True when conditionOriginal hit the floor instead of the raw subtraction. */
  conditionOriginalFloored: boolean
}

function pickBand(bands: RenoBand[], floorAreaSqm: number): RenoBand {
  for (const band of bands) {
    if (floorAreaSqm < band.maxSqm) return band
  }
  return bands[bands.length - 1]
}

/**
 * Cost-approach renovation-condition tiers around a Market Value baseline.
 * Returns null when the inputs can't support it (no valid estimate/area) or for
 * landed, which has no researched cost anchors.
 */
export function getRenovationConditionTiers(
  marketValue: number,
  propertyCategory: ConditionPropertyCategory,
  floorAreaSqm: number
): RenovationConditionTiers | null {
  if (!Number.isFinite(marketValue) || marketValue <= 0) return null
  if (!Number.isFinite(floorAreaSqm) || floorAreaSqm <= 0) return null
  if (propertyCategory === 'landed') return null // no cost anchors researched

  const bands = propertyCategory === 'hdb' ? HDB_BANDS : CONDO_BANDS
  const band = pickBand(bands, floorAreaSqm)

  const rawOriginal = marketValue - band.cost
  const floor = marketValue * ORIGINAL_CONDITION_FLOOR_SHARE
  const conditionOriginal = Math.max(floor, rawOriginal)

  const premiumIncrement = band.cost * (PREMIUM_SPEC_MULTIPLIER - 1)
  const conditionWellRenovated = marketValue + premiumIncrement * PREMIUM_RECOVERY_SHARE

  return {
    conditionOriginal: Math.round(conditionOriginal),
    conditionRenovated: Math.round(marketValue),
    conditionWellRenovated: Math.round(conditionWellRenovated),
    conditionRenoCost: band.cost,
    conditionRenoBand: band.label,
    conditionBasis: 'cost_approach',
    conditionNote: CONDITION_BASIS_NOTE,
    conditionOriginalFloored: rawOriginal < floor,
  }
}
