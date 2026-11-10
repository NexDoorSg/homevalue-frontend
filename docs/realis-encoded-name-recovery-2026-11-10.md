# HomeValue audit follow-up — 10 November 2026

## Production recovery completed

Recovered **118 additional verified single-unit apartment transactions**, all with exact OneMap coordinates. The source names contained HTML-encoded apostrophes, which hid them from the previous exact-name checks.

| Master project | Archive name | Source file | Recovered | IDs |
|---|---|---|---:|---|
| D'CHATEAU @ SHELFORD | D&#039;CHATEAU @ SHELFORD | D11_all.csv | 65 | 1400381–1400445 |
| PEOPLE'S PARK CENTRE | PEOPLE&#039;S PARK CENTRE | D01_all.csv | 53 | 1400446–1400498 |

The source files are in the connected [Realis Data folder](https://drive.google.com/drive/folders/1g298LZ4kwARngBZlvuruOSBROd5hl2CN). The full D11 archive contained 24,880 rows and the full D01 archive 8,539 rows. The project name transformation was HTML entity decoding only, and each decoded name matched a master record exactly. ENCHANTÉ's existing mapping was not changed.

Four older terrace-house sales at 25/25A Shelford Road, under THE SHELFORD RESIDENCES, were deliberately excluded. They belong to a previous development and were not mapped into D'Chateau. All 118 accepted records have Number of Units = 1, Property Type = Apartment, Type of Area = Strata, positive prices/areas and strict numeric unit addresses. No ETC/en-bloc record was included.

Coordinates came from exact OneMap block/street, postal and project-name matches for 25/25A Shelford Road and 101/101B Upper Cross Street. No project-centroid or postal-only copying was used. Property classification uses unit_type = Apartment and property_subtype = the source sale activity, preserving the valuation engine's convention. Source price, date, PSF, area, tenure and completion year were preserved.

## Verification outcomes

- Preview found **118 candidates, zero existing transaction keys**, and 118 exact master-name matches.
- Insert was atomic, with a table write lock, expected maximum-ID check, unique-key conflict protection and an assertion requiring exactly 118 inserted rows. No existing transactions were updated.
- Readback matched **all 118 complete inserted rows** against the prepared source payload, including coordinates and classifications.
- Live Tower API checks matched **all 118 prices, dates, areas, floors and stacks across four towers**: block 25 (32), 25A (33), 101 (4), 101B (49).
- Both projects have zero missing coordinates, zero invalid unit addresses and zero classification errors.
- Combined recovery now contains **3,736 transactions and 3,736 distinct keys**. Missing coordinates remain **177**.
- Re-ran 43 transaction-integrity tests and 7 geocoding safety tests: **50 passed**. No application code was changed in this follow-up.

## Remaining coverage questions

Unmatched exact master names fell from **32 to 30**: 21 landed, 7 unspecified and 2 condo/apartment names. One of those two is the encoded ENCHANTÉ name, already served by its verified 25-transaction alias. The only genuine remaining condo/apartment question is **CONDOMINIUM DEVELOPMENT**.

The full District 10 archive (50,074 rows) contains neither that project name nor transactions at 362 Holland Road. Public directory metadata linking the generic name to 362 Holland Road conflicts with [SLA's property listing](https://app.sla.gov.sg/spio/property-detail?page=0&propertyId=SLP2025100006M), which describes a state property offered for hostel/residential/other specified uses. Its identity remains uncertain; no master record was renamed, merged or deleted.

Rechecked OneMap by exact address and project name for Lakeside Apartments and Park View Mansion. Responses again returned zero results with a missing-authentication-token warning. The **177 historical coordinate gaps remain unresolved**; this does not establish that authenticated or historical results are unavailable.

## PR #87 and deployment status

[PR #87](https://github.com/NexDoorSg/homevalue-frontend/pull/87) contains the tested Tower parsing and directory-statistics fixes from the previous audit. Its validation job passed and Vercel preview commit `96ea1bf7a111f43a66b44dc481e38b508d9d7cd3` reached READY. Its application changes have not been merged or released in this follow-up.

Preview HTTP access redirects to Vercel protection. Automatic approval review rejected the connector fetch because it would create or reuse a temporary share link, expanding deployment access. No access setting or protection was changed, and no alternate access path was used to bypass that rejection. Approval for the temporary preview link is needed before that verification and release can continue. The connector states new links expire in 23 hours; possession of a share link grants access.

## Saved evidence

`encoded-name-recovery-118.csv` contains all recovered rows; `encoded-name-onemap-evidence.json` preserves the four exact-address responses. Source downloads, validation payload, atomic SQL and live-comparison results are retained in the local work directory. No signed Drive download URLs are included in the deliverables.
