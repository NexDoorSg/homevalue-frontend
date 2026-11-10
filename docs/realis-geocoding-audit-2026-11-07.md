# HomeValue production recovery audit — 7 November 2026

Follow-up: [10 November encoded-name recovery](realis-encoded-name-recovery-2026-11-10.md) restored another 118 transactions and resolves two of the three project gaps listed below.

Baseline: merged PR #86, main commit `df2be6456df9eeb880473326a08811940f93418c`.
Production Supabase project: HomeValue By NexDoor (`uooqynhqjeusryuwghhe`).

## Production data changes completed

Updated latitude and longitude only for **3,368 recovered REALIS transactions** across **230 exact building/project/postal matches**. IDs are bounded to 1396763–1400380 and source `realis`; both coordinates had to be NULL. This includes all 100 outstanding September records and 3,268 historical records. No project-centroid or postal-only coordinate reuse was used. OneMap results were checked against exact normalized block/street and the original six-digit postal code. Two ambiguous address results were resolved by also requiring the exact project/building name.

The update ran atomically with an expected-row-count assertion and a pre-write fingerprint check. All 3,368 pairs were read back and compared with saved source evidence. The 73 previously populated coordinate pairs were preserved.

| Check | Before | After |
|---|---:|---:|
| Recovered records | 3,618 | 3,618 |
| Distinct address/date/price keys | 3,618 | 3,618 |
| Missing coordinate pairs | 3,545 | 177 |
| Partial coordinate pairs | 0 | 0 |
| Coordinates outside Singapore bounds | — | 0 |
| ETC/ENBLOC address flags in recovered batch | — | 0 |

The MD5 of the ordered complete records excluding latitude/longitude remained `c42bebcb64ce8ec7aadd6fce1d425700`. Prices, dates, addresses, areas, classifications, postal codes, project names and all other transaction fields are unchanged. ENCHANTÉ master identities were not modified.

## Unresolved coordinates

177 records across six addresses remain empty: Lakeside Apartments, 9E/9F Yuan Ching Road (85 records); Park View Mansion, 9A/9B/9C/9D Yuan Ching Road (92 records). Both address searches and postal searches returned zero address results. Responses included OneMap's missing-authentication-token warning, so these results do not establish that no authenticated or historical result exists. An authenticated OneMap lookup or independently verified historical building coordinates are required. No coordinates were guessed.

## Live verification

Live Tower API coverage matched database counts for The Azure (244), Trevose Park (212), Westmere (441), Dorsett Residences (111), Lakeside Tower (141), Lakeside Apartments (85), Park View Mansion (92), and the encoded ENCHANTÉ alias (25).

Across the seven recovered projects, **1,326 transactions in all 17 towers** were compared individually: price, date, floor area, block, floor and stack all matched the database snapshot. The live Azure directory detail loaded its historical PSF chart and profitability summary (49 profitable, 24 unprofitable). This repository exposes a Tower API; its directory UI displays project statistics rather than a separate tower grid.

The live directory statistics endpoint for the encoded ENCHANTÉ master name returned zero price-history points, while its Tower endpoint returned all 25 transactions. This confirmed the statistics alias bug addressed in the code changes.

## Code fixes prepared

- Tower parsing rejects multiple `#` segments and explicit ETC/ENBLOC markers, retains strict numeric floor/stack parsing, and preserves lettered blocks.
- Directory statistics apply the existing exact ENCHANTÃ‰ → ENCHANTÉ alias. No new fuzzy name mapping was introduced.
- Quarterly price history excludes explicit bulk-sale markers. Condo/apartment unit profitability requires an explicit unit address, excluding building-only and basement records. Landed building-address profitability remains supported.
- Added a resumable, evidence-saving exact OneMap lookup script with rate-limit backoff and optional `ONEMAP_TOKEN`; it does not write to the database.
- Added read-only SQL recovery-quality checks. These checks are manual; no new scheduled monitor was created.

## Remaining project mismatches

The 32 exact-name mismatches remain: 21 landed, 7 unspecified, 4 condo/apartment. ENCHANTÉ is covered by its verified alias and 25 transactions. The other three are PEOPLE'S PARK CENTRE, D'CHATEAU @ SHELFORD, and CONDOMINIUM DEVELOPMENT. Targeted name and address checks found no supported transaction match; no master records were renamed or merged. PEOPLE'S PARK COMPLEX is a distinct project and was not substituted for PEOPLE'S PARK CENTRE. Source evidence is still needed to resolve these three.

## Validation

- 43 existing transaction-integrity tests passed.
- 7 geocoding safety tests passed.
- 8 Tower/statistics regression tests passed, including bulk markers, repeated `#`, basement and building-only addresses, lettered towers, deduplication, query failures, alias mapping, and landed compatibility.
- Targeted ESLint, TypeScript checking, and production build passed. The build used non-secret placeholder Supabase environment values because this checkout has no local production settings; live data checks were performed separately through the connected database and public endpoints.
- Database readback and unchanged-field fingerprint checks passed.

## Other observed advisory findings

Health advisory list was empty. Existing security advisories include RLS disabled on the two October staging tables, five functions with mutable search paths, and disabled leaked-password protection. These were recorded without changing unrelated access policies. See [RLS remediation](https://supabase.com/docs/guides/database/database-linter?lint=0013_rls_disabled_in_public), [function search-path remediation](https://supabase.com/docs/guides/database/database-linter?lint=0011_function_search_path_mutable), and [password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection). Performance advisories include staging tables without primary keys, overlapping lead insert policies, and an unrelated missing foreign-key index.

## Evidence and rollback

`geocoding-evidence.csv` lists all 236 building/project/postal groups. `onemap-source-evidence.json` preserves returned address results. `geocoding-rollback.sql` restores only the newly written pairs to NULL, guarded by each exact ID and applied coordinate pair. Review before use; rollback is not automatic. The original snapshot and full live comparison results are retained in the local work directory.

Production coordinate changes are complete. Application fixes are prepared for pull-request review and have not been merged or deployed by this audit.
