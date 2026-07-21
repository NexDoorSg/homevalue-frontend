# Valuation Engine Redesign — Staged Roadmap

Core logic lives in [`src/lib/valuation.ts`](src/lib/valuation.ts), exposed via
`src/app/api/internal/valuation/route.ts` and consumed by the Wealth Planner
(calculator.nexdoor.sg), the agent valuation checker (app.nexdoor.sg), and
seller-facing reports.

## Why this redesign

The original engine carried a **deliberate one-directional upward bias**:

- **Condo/EC:** a same-project "seller-friendly" calibration (+2.5% to +4%,
  ceilinged at the project's p90 psm) **plus** an unconditional flat +1% **plus**
  an additive floor premium (up to +4%) — roughly **+3.5% to +8%** total,
  stacked on top of the comparable-derived anchor with no downward counterpart.
- **HDB:** the same flat +1% **plus** a floor premium of 0.5%/floor capped at
  +15% — so **+4% to +16%** depending on floor. (The HDB floor premium had *no
  evidentiary basis*: `getFloorWeight` is always 1 for HDB because HDB addresses
  carry no `#NN-NN` unit token to parse a comparable floor from, so there was no
  comparable-side floor matching to justify the premium.)

That lean is reasonable for **one** use — suggesting a listing price to a seller,
where a slightly aspirational headline is a legitimate negotiation anchor. It is
**wrong** for the other uses. The Wealth Planner and the agent valuation checker
need a **neutral market estimate**, and they were showing the biased number
as-is. The confidence band made it worse: it was centered on the already-biased
point estimate, so the "fair" value often sat below the band's low.

**This plan separates the two uses into two explicitly-labelled outputs:**

| Output | Meaning | Bias | Where shown |
| --- | --- | --- | --- |
| **Estimated Market Value** | Neutral, centered on real comparables | none | Wealth Planner, valuation checker, reports |
| **Suggested Listing Price** | Strategic markup for a seller listing | explicit, momentum-based | Seller-facing listing flow only |

They are shown **side by side, never blended into one number**. Stage 1 makes the
base estimate neutral; Stage 3 builds the Suggested Listing Price as a separate,
clearly-strategic figure on top of it.

---

## Stage 1 — Remove one-directional bias, fix outlier trimming *(this PR)*

**Shipped in this PR.** Touches only existing logic; no new data sources.

- Removed `applyCondoEcSameProjectMarketCalibration` (+2.5–4% uplift, p90 ceiling)
  and its p75×1.02/p90 clamps.
- Removed the unconditional `×1.01` flat bias from all three condo/EC builders
  (same-project, strict-nearby, fallback) and both HDB return branches.
- Removed the additive floor premium (`applyFloorAdjustment`) from condo/EC and
  HDB. Condo/EC floor signal is retained via the floor-closeness term already in
  `getWeightedPsmForRows`; HDB floor handling is deferred to Stage 5 (it was dead
  anyway). Landed/non-landed paths are untouched.
- Replaced percentile trimming — `trimRowsByMetric` (p10/p90) and
  `trimCondoEcOutliers` (p15/p85), both of which **silently no-op'd below n=5** —
  with a shared MAD trim (`median ± 3×MAD`), robust down to n=3, reverting if
  fewer than 3 rows survive. This matters because ~1/3 of projects have thin
  same-project pools that previously got no outlier protection at all.
- The confidence band is now centered on the corrected (unbiased) point estimate
  in every builder.

**Verified impact:** removes ~+7.7% in condo/EC and +5.5% (floor 10) to +16%
(high floor) in HDB. Estimates now center on real comparable sales instead of
sitting consistently above them.

> ⚠️ This lowers the live number in Wealth Planner, the valuation checker, and
> seller reports the day it deploys. Brief whoever fields "why did my valuation
> drop" questions.

---

## Stage 2 — Repeat-sale anchor (condo/EC)

Use the **exact subject unit's own prior sale** as a first-class anchor before
falling back to same-project comparables. The engine currently has *zero*
exact-unit logic (`subjectAddress` is only used to extract an HDB block number).

**Feasibility (measured):** 40.7% of all strata units have a prior sale on
record; **52% of units sold in the last 2 years** (the ones actually being
valued) do. So a same-unit anchor is available for roughly half of live
valuations.

**Mechanism:**
- When the subject unit has a prior sale, trend it forward by the **project's
  appreciation rate** to the valuation date, rather than using the raw prior
  price.
- **Confidence scales with staleness.** The prior→current gap distribution is
  long: median **7.3 years**, only **5.3% under 2 years**, ~69% ≥5 years, ~30%
  >10 years. And the *most-recent* per-unit sale is itself a median 5.7 years
  old (only ~18% within 2 years). So the anchor almost always needs
  trend-forwarding, and **the error concentrates in the appreciation multiplier,
  not the prior price** — a 7-year forward at 3–5%/yr is a ~23–40% adjustment,
  a >10-year one can exceed +50%.
- **Prefer fresh comparables past a gap threshold.** For very stale prior sales
  (e.g. >10 years), a repeat-sale anchor is weaker than recent same-project
  comps; add a rule that down-weights or bypasses it beyond a threshold.
- The band must widen with trend-forward distance.

---

## Stage 3 — Floor curve, momentum thresholds, Suggested Listing Price

**3a. Floor curve.** Replace the removed additive floor premium with a proper
**log-log floor-price curve** (same construction as the existing size curve:
interpolate psm against floor in log-log space from same-project comps).

- **Density reality:** enough distinct transacted floors to fit a curve exists
  for ~36% of projects by count but **82.6% of transactions by volume**. ~1/3 of
  projects have ≤3 distinct floors (often 2, or 0 for low-rise) — a same-project
  curve overfits or fails there.
- **Segment-level fallback:** for thin projects, fall back to a global/segment
  (district × property-age × tenure) floor-premium curve rather than a
  same-project fit.
- **⚠ Known flaw in the existing size curve — fix before mirroring it for floor.**
  The current size curve introduces a **momentum-sensitive downward lean**
  (median **−3.4%**, correlated with recent price momentum at **r = −0.61** in a
  small n=10 sample). Cause: the curve's **wide area window (0.45–1.90×)** plus
  its **fallback to all-time same-project rows** when recent similar-size comps
  are thin — this dilutes fast-rising prices with older/cheaper comps far more
  than a plain recent-weighted average does. Clearest example: **TREVISTA**
  (momentum +5%, curve lean **−13.4%**). This was confirmed **NOT** caused by
  trailing-anchor market lag — that hypothesis was tested and refuted
  (correlation of momentum with the plain-average path's error was ~0). **Fix
  direction:** tighten the curve's area window and/or require recency-bounded
  comps for the side-anchors, so the curve stops under-shooting live momentum.
  The floor curve (3a) must not inherit this behaviour.

**3b. Momentum thresholds.** Formalize when momentum is computed same-project vs
nearby-project. Same-project momentum (≥3 sales in both the last-6mo and prior
6–12mo windows) is feasible for only **~18% of projects by count** (58% have at
least one window empty) but ~66% by volume — so the nearby-project fallback the
engine already uses for drift must remain the default for the long tail. Define
explicit minimum-sample thresholds for each tier.

**3c. Suggested Listing Price.** Build the strategic markup as a **separate
output** layered on top of the neutral Estimated Market Value:
- Momentum-based (larger markup in a rising local market, smaller/none when flat
  or falling).
- **Shown separately from Market Value; never blended into one number.** This is
  where the old +3.5–8% lean legitimately lives — but now labelled as strategic
  and shown only in the seller listing flow.

---

## Stage 4 — MRT proximity in cross-project weighting

Add a distance-to-nearest-MRT factor to the **cross-project (radius-expansion)
comparable weighting**, where it matters most — the engine currently has **zero**
amenity/transit factor anywhere, including the fallback path.

- **Data already on hand (no new sourcing for MRT):** the `MRT_STATIONS` array in
  the Calculator's `src/App.jsx` — **171 stations** (145 open), each
  `{name, lat, lon, status, line}` in **WGS84**, joinable to project coordinates
  by Haversine directly.
- **Gap:** LRT stations are **not** in that array (the vendored
  `mrt-lines.geojson` has LRT *lines* but no station points). Nearest-rail will
  overstate for LRT-served projects until LRT points are sourced — do that before
  trusting the factor island-wide.

---

## Stage 5 — HDB Property Information reference table + real floor matching

Integrate the data.gov.sg **HDB Property Information** dataset
(resource_id `d_17f5382f26140b1fdae0ba2ef6239d2f`, **13,357 blocks**, fields
`blk_no`, `street`, `year_completed`, `max_floor_lvl`, `total_dwelling_units`,
building-type flags, per-flat-type counts).

- **Completion-year coverage gap:** `completion_year` is already 100% populated
  on HDB *transaction* rows, but transactions cover only **9,764 distinct blocks**
  vs 13,357 in the reference set. The ~3,600-block gap is non-residential blocks +
  **new BTOs still in their 5-year MOP** + rental-only blocks. The reference table
  supplies age/floor/type for **blocks with no resale history**, so a just-MOP
  block can still get age-appropriate nearby comparables.
- **Real HDB floor matching:** wire up `storey_range` (already stored on
  transaction rows, currently never fetched) and the reference `max_floor_lvl` so
  HDB gets genuine comparable-side floor matching — replacing the dead
  `getFloorWeight` path and justifying a floor curve for HDB (Stage 3 pattern).
- **Hard age-gap ceiling at Tier 5:** the HDB comparable ladder already
  hard-prioritizes same-block and hard-filters nearby comps to ±5 years
  completion in Tier 4 — but the Tier 5 last resort (`hdb_nearby_all`) applies no
  age filter, only a soft 0.5× weight, which does **not** neutralize the ~1.8×
  psf gap between an old and a new block. (Even the closest old/new pair —
  84 C'WEALTH CL 1967 @ $515 psf vs 51 C'WEALTH DR 2015 @ $945 psf — is 309m
  apart, so this is rare, but real.) Add a hard age-gap ceiling to Tier 5.

---

## Cross-cutting principles

1. **Two outputs, never one blended number** — Estimated Market Value (neutral)
   and Suggested Listing Price (explicitly strategic).
2. **Every new signal needs a density-aware fallback.** By volume the active head
   is data-rich; by project count the long tail is not. No stage may assume
   same-project density it doesn't have.
3. **Confidence bands stay centered on the point estimate** and widen with
   uncertainty (trend-forward distance, thin pools, stale anchors).
4. **No silent disabling.** The MAD-trim fix in Stage 1 is the template: degrade
   gracefully and observably at small n, don't no-op.
