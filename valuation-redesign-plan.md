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

## Stage 2 — Repeat-sale anchor (condo/EC), as a conditional fallback

Blend the **exact subject unit's own prior sale** (trended forward by the
project's appreciation CAGR) into the estimate — but, per the backtest below,
**only when the same-project comparable pool is thin.** The engine currently has
*zero* exact-unit logic (`subjectAddress` is only used to extract an HDB block
number).

**The headline result: repeat-sale is NOT a broad win — it only helps where
comparables are weak.** Two out-of-sample backtests (leave-one-out, no
look-ahead, three approaches: comparable-only / repeat-only-trended / blended)
settled this:

| Segment | comparable-only median APE | Does the repeat-sale blend help? |
| --- | --- | --- |
| **Well-comped** (majority of valuation volume; 15,940 subjects across 120 active projects) | ~3.3% | **No — ~0 net gain.** Comparable-only already wins at every staleness; repeat-only is worse (5–12% APE) because trending a stale price by CAGR compounds error. |
| **Thin-comp** (illiquid long tail; 2,191 subjects across 510 quiet/boutique projects) | **6.26%** | **Yes — consistent improvement.** Blending lowers median APE to **6.08%**, and helps in *every* staleness bucket from 2 to 10+ years. |

### Design: apply the blend ONLY when comparables are thin
- **Gate:** engage the repeat-sale blend only when the same-project similar-size
  comparable pool is **≤5 comps**. In the well-comped majority, use the Stage 1
  comparable estimate unchanged (blending adds nothing and risks diluting a
  good number).
- **Blend:** `estimate = w(gap)·(prior_price · (1+CAGR)^gap) + (1−w(gap))·comparable`.
- **CAGR:** project-level median of same-unit pair annualized returns, computed
  only from pairs that completed *before* the valuation date (no look-ahead).
  Density is fine: **88.3% of projects have ≥5 pairs, 77.6% ≥10, 60.7% ≥20**
  (187,859 pairs across 2,343 projects). The ~12% with <5 pairs fall back to the
  **citywide median appreciation, 3.28%/yr** (district-level is a possible
  refinement). Clamp CAGR to a sane band (e.g. [−5%, +15%]).
- Confidence band widens with the trend-forward distance.

### Two weight functions, both empirically derived (only one is used)
Both were fit to the optimal per-staleness-bin blend weight found by grid search
in each segment:

- **Well-comped (NOT implemented — kept for the record):**
  `w(gap) = 0.75 / (1 + e^((gap − 1.5)/0.5))` — sharp logistic decay, effectively
  **0 by ~3 years**. Only a very fresh prior sale would earn weight here, and
  such units are rare (~0.2% of repeat-sales), so overall gain is ~0. **Not
  used.**
- **Thin-comp (IMPLEMENTED):**
  `w(gap) = 0.40 · e^(−gap/3.5)` — lower peak but **slow decay, persisting to
  ~8–10 years** (w: 1yr=0.30, 2yr=0.23, 3yr=0.17, 5yr=0.10, 8yr=0.04). When
  comparables are weak, even a moderately-stale prior sale is worth a small,
  steady vote.

The shapes differ because the *relative* value of the prior sale depends on how
good the comparable alternative is: strong comparable ⇒ trust the prior only if
very fresh; weak comparable ⇒ give it a modest, longer-lived weight.

### Backtest evidence (thin-comp segment, median APE by staleness)

| Gap bucket | n | comparable | repeat-only | blended |
| --- | --- | --- | --- | --- |
| 2–5yr | 432 | 6.96% | 10.26% | **6.42%** |
| 5–10yr | 624 | 6.03% | 12.38% | **5.82%** |
| >10yr | 1,130 | 6.24% | 16.72% | **6.11%** |
| **overall** | 2,191 | **6.26%** | — | **6.08%** |

### ⚠ Honest scope note
This is a **modest, targeted improvement (~0.2–0.5pp)** in the **hardest
segment** — illiquid / boutique projects where the post-Stage-1 engine is
weakest (~6.3% APE) and a wrong number is most consequential for agents and
clients. It is **not a broad accuracy transformation.** Most valuation *volume*
runs through active, well-comped projects, which already perform well (~3.3%
APE) after Stage 1 and are **unaffected** by this stage. Whether the added
complexity (exact-unit detection + CAGR + conditional blend) is worth ~0.2–0.5pp
on the long tail is a product call, not a slam-dunk.

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
