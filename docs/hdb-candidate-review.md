# HDB candidate valuation review

Prepared 9 October 2026. Research branch: `codex/hdb-valuation-candidate`. Baseline: `54759932c7d76ef5f56f7d7c44e1d6a6130df665`.

**Recommendation: keep this as a draft candidate.** Local results support further testing, but some subsets worsen. No live checker rollout, database migration, cache writes or lead writes were performed.

## Block 870 regression

Subject: 870 Woodlands Street 81 #11-296, 5 ROOM, 131 sqm, floor 11. Actual completion year is 1994; transaction `completion_year` holds lease commencement year 1996.

HDB transaction dates identify months. To represent the evidence available at the opening of September conservatively, the first case has an August-31 cutoff. The second includes September's newly recorded $705,000 same-block sale (133 sqm, storeys 07–09). These are replays of the current snapshot, not reconstructed publication histories.

| Evidence cutoff | Before | Candidate | Candidate range | Raw / effective count | Maximum individual weight |
|---|---:|---:|---|---|---:|
| 2026-08-31 | $733,805 | $704,167 | $654,876–$753,459 | 5 / 4.04 | 33.9% |
| 2026-09-30 | $706,331 | $704,392 | $655,085–$753,700 | 5 / 4.47 | 27.8% |

Both candidate results are Moderate confidence and use recent nearby matches. The older December-2024 floor-2 sale contributes 8.33% before September's sale is included, with a +4.5% floor adjustment. After the September sale is included, the fresh same-block sale gets 25% and nearby evidence gets 75%.

The requested $680,000–$725,000 range conflicts with the agreed nearby-quality minimum of ±7%. The candidate implements the latter; it does not force a narrow range or hardcode a price for this block.

## Held-out comparison

119 July–September 2026 transactions: Woodlands 30, Bedok 30, Punggol 30, Queenstown 29. Candidate available for 118; baseline available for all 119. Targets lie within 500m of each sampled neighbourhood centre, so a 2km comparable circle lies inside each exported box. Sampling is deterministic and stratified by thin/fresh block history and low/middle/high floors. The entire target month is excluded to avoid within-month leakage.

Fair comparison below uses the 118 cases where both models returned a value.

| Metric | Before | Candidate |
|---|---:|---:|
| Median absolute percentage error | 3.91% | 2.57% |
| 90th-percentile absolute error | 9.91% | 9.04% |
| Actual sale within displayed range | 36.44% | 85.59% |

Range coverage improves largely because bands are wider. It does not establish a 90% or 95% statistical confidence level.

| Neighbourhood | Cases | Before median error | Candidate median error | Before P90 error | Candidate P90 error |
|---|---:|---:|---:|---:|---:|
| Woodlands | 30 | 4.10% | 2.50% | 10.02% | 12.85% |
| Bedok | 30 | 3.24% | 3.10% | 12.51% | 9.30% |
| Punggol | 30 | 3.15% | 1.74% | 6.34% | 6.58% |
| Queenstown | 29 | 5.74% | 2.99% | 11.18% | 8.15% |

**Regressions to investigate before rollout:** Woodlands P90 error worsens, Punggol P90 error slightly worsens, and fresh low-floor cases worsen in median error. Only two final candidate results are Low confidence, so broad-fallback conclusions are especially weak. One thin low-floor Queenstown case (50 Stirling Road) returns unavailable instead of a concentrated estimate.

## Floor-rate comparison

Same candidate selection and weighting; individual comparable adjustments capped at ±5%. The ratio variant applies the legacy aggregate floor-ratio multiplier to the zero-adjustment candidate pool (±10%). This separates the floor rule from the full legacy-versus-candidate comparison, although outlier trimming can change when adjusted prices change.

| Floor rule | Median error | P90 error |
|---|---:|---:|
| No price floor adjustment | 2.72% | 8.69% |
| 0.3% per floor | 2.58% | 8.82% |
| 0.5% per floor (candidate default) | 2.57% | 9.04% |
| 0.75% per floor | 2.55% | 9.11% |
| Legacy aggregate ratio, on candidate pool | 2.77% | 9.05% |

Differences among linear rates are small in this sample. 0.5% remains a provisional starting point, not a demonstrated nationwide optimum. The repository's earlier 55k/60.9k backtest claims have not been reproduced.

## Candidate rules implemented

- Same flat type throughout. No all-type block-price anchor. Exact block AND canonical street identity; no block-only/50m proxy. Duplicate IDs are removed.
- Tier 1: same-block, last 12 calendar months, area ±10%. Prefer the same three-storey band, then adjacent bands; broaden floors if those subsets cannot support three healthy comparables.
- Nearby: same type, last 12 months, area ±10%, actual completion year ±5. Search true circular 300m, then 500m, then 800m; stop when at least three rows have effective N ≥2 and largest weight ≤70%.
- If insufficient: expand the age window to ±15, then all known/unknown ages with soft age weighting; then area ±20% and circular 800m/1500m/2000m. Relaxation is disclosed and confidence becomes Low.
- One or two recent block sales retain a collective share n/(n+3), capped at 50%, with recent nearby support. A raw block pool of three or more also needs dominance/effective-count checks before it can stand alone.
- If no recent same-block evidence, 12–24-month matched block sales contribute at most 25% collectively, tapered by effective N/3. Older than 24 months: historical reference only.
- Individual adjusted price = sale price × subject sqm / sale sqm × clamp(1 + 0.005 × (subject floor − storey midpoint), 0.95, 1.05). Missing floor data receives no price adjustment and confidence is reduced.
- Within-pool weight = 0.5^(age days/180) × 1/(1+10×absolute relative area difference) × 1/(1+distance/300) × 1/(1+floor difference/6) × age similarity weight. Missing floors make that proximity factor neutral. Age weights: differences ≤3/8/15/25/>25 years = 1.5/1.2/0.9/0.7/0.5; missing age = 1.
- MAD trim uses subject-size/floor-adjusted prices, at least four rows, 3 MAD threshold; reverts if fewer than three survive. Identical median prices/MAD zero cause no trim.
- Diagnostics use final individual weights after all blends: effective N = 1/sum(normalized weight²). Maximum individual weight is the largest final share. No aggregate anchor hides its underlying sales.
- If final effective N <2 or maximum weight >70% after nearby incorporation/expansion, return unavailable. Do not manufacture a sole-comparable valuation.
- High confidence: healthy recent same-block pool, effective N ≥3 and complete floor/year data. Moderate: other supported same-block/strict nearby pools. Low: relaxed/broad matching or missing year/floor information.
- Range uses weighted adjusted-price dispersion, with floors/caps: High same-block ±3–5%; supported same-block below High ±7–10%; Moderate nearby/blends ±7–10%; Low ±10–12%. Confidence bands are provisional.
- Engine numbers remain unrounded. Preview money rounds to dollars; effective N and percentages are display-rounded only.

Actual completion years come from `hdb_block_info` for both subject and comparables. This avoids mixing `lease_commence_date` (stored in transaction `completion_year`) with actual building completion. Missing reference rows retain unknown comparable year and lower confidence. Explicit supplied subject years are used only if the reference lacks that block.

## Testing the branch

- Open `/hdb-valuation-preview` on a local or Vercel branch preview. Enter block/street, type, sqm, floor and date. The page reads transaction data only; it does not save leads or shared cache entries. It is excluded from search indexing.
- Historical candidate dates are supported. The page shows a live legacy comparison only for today, because the unchanged legacy engine uses today's clock. Historical baseline comparisons use the offline replay harness.
- Office opt-in: send `hdbModel: "candidate_v2"` and optional `valuationDate: "2026-09-30"` to the existing authenticated internal valuation endpoint. Default requests continue to use the legacy model. Candidate responses include `hdbDiagnostics` and exact calculation evidence; legacy comparable-table shapes remain unchanged for default requests.
- Candidate cache reads/writes are disabled. Candidate fetch errors and safety-limit overruns fail explicitly instead of returning a partial pool.

## Validation and reproducibility

15 candidate tests plus 38 existing JavaScript tests pass (53 total). Type checking and targeted lint pass. Production build passes using the exact existing npm lockfile and harmless build-only server-setting placeholders. Existing privileged server routes were not exercised with live secrets. Live anonymous read-only candidate calls reproduce the Block 870 snapshot estimates within a dollar. Browser verification confirms the submitted historical date and diagnostics.

Files: `hdb-before-after.csv` contains every held-out before/after result; `hdb-backtest.json` includes floor variants, strata, evidence and snapshot hashes. A public-transaction snapshot archive is supplied with the local deliverables for exact replay. No lead/customer tables were exported.

From the repository root:

```sh
npm ci --ignore-scripts
node --test tests/hdb-valuation-candidate.test.cjs tests/*.test.mjs
npx tsc --noEmit
node scripts/hdb_valuation/backtest.cjs /path/to/extracted/snapshots /path/to/results
```

Snapshot limitations: Bedok/Punggol/Queenstown histories start January 2023. Woodlands includes 5 ROOM history since January 2017 plus other flat types since July 2022. Legacy sparse all-type block-anchor queries have no ordering; replay uses deterministic snapshot date/id order. These limitations are recorded in the JSON report. This is a four-neighbourhood local validation, not a nationwide independent holdout. No floor rate should be finalized or deployed solely from this sample.
