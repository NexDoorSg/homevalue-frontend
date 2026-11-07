# REALIS historical Tower View recovery — 7 November 2026

## Purpose
Restore project-specific historical transaction records omitted from the live
`property_transactions_v2` table, using the company's own district-wide URA
REALIS CSV exports retained in connected Google Drive. Keep each original
single-unit sale price, address, date, area, tenure and property type.

This document records production actions already performed. It does NOT
represent a new migration, automated job, or authorization to import every
row from the district archives without deduplication.

## Source inventory and inserted rows

| Internal Drive source | Target master projects | Inserted |
| --- | --- | ---: |
| `D22_all.csv` | WESTMERE; PARK VIEW MANSION; LAKESIDE TOWER; LAKESIDE APARTMENTS | 759 |
| `D04_all.csv` | TERESA VILLE; THE AZURE; THE FORESTA @ MOUNT FABER; MOUNT FABER LODGE; TURQUOISE; HARBOUR SUITES | 999 |
| `D11_all.csv` | 18 previously unmatched condo/apartment names, including TREVOSE PARK, ADAM PARK CONDOMINIUM and SHELFORD SUITES | 1,327 |
| `D01_all.csv` | THE RIVERSIDE PIAZZA; FOOK HAI BUILDING | 63 |
| `D02_all.csv` | DORSETT RESIDENCES; CRAIG PLACE; ONZE @ TANJONG PAGAR | 297 |
| **TOTAL** | **33 distinct project names** | **3,445** |

New IDs assigned: **1396936–1400380**. Source `realis`.

Each batch inserted only rows absent under the live unique key
`(address, transaction_date, transaction_price)`; writes were in SQL
transactions with a table lock, generated IDs after the current maximum,
and `ON CONFLICT ... DO NOTHING`. The final readback found 3,445 records,
3,445 distinct unique transaction keys, across 33 project names.

Original CSV dates (`DD Mon YYYY`) were converted to ISO dates; comma-grouped
numeric fields were parsed; positive transaction prices and areas were
validated. Source `number_of_units=1` and strata apartment/condominium/EC
classifications were required. Uncompleted completion dates remain NULL.

### Bulk transactions excluded from individual-unit recovery

- `THE AZURE`: 2 multi-unit transactions with `ETC` unit address suffixes
- `WATTEN ESTATE CONDOMINIUM`: en-bloc transaction covering 104 units
- `LAKESIDE APARTMENTS`: en-bloc transaction covering 120 units
- `PARK VIEW MANSION`: en-bloc transaction covering 160 units

These 5 bulk transactions must never be assigned as a single unit's purchase
or resale price. Tower View parsing now accepts only a strict `#digits-digits`
unit address (HomeValue PR #85). Basement `#B1-xx` transactions may be
preserved as source sales but do not map to ordinary residential tower floors.

## Verification

```sql
SELECT count(*) AS imported,
       count(distinct project_name) AS projects,
       count(distinct (address,transaction_date,transaction_price)) AS distinct_keys,
       count(*) FILTER (WHERE address ~ '#[0-9]+-[0-9]+$') AS standard_unit_addresses,
       count(*) FILTER (WHERE latitude IS NULL OR longitude IS NULL) AS missing_coordinates
FROM public.property_transactions_v2
WHERE id BETWEEN 1396936 AND 1400380;
-- 3445 imported, 33 projects, 3445 distinct keys,
-- 3282 standard unit addresses, 3445 missing coordinates at recovery time.
```

The earlier September 2026 staging recovery was separate: 173 records
assigned IDs 1396763–1396935, with 73 coordinates resolved at the last audit
and 100 remaining.

Three recent weekly REALIS files (covering 28 Sep–1 Nov 2026) were compared
against live unique keys after the historical backfill: **1,367 / 1,367**
records already present; none required reimport.

## Remaining issues

1. **Coordinates**: all 3,445 historical recovered records lack lat/lon.
   This limits location-bounded comparable searches even though Tower View can
   use source unit addresses. Do not copy a shared postal-code coordinate
   without an exact and unambiguous building match; some existing coordinates
   disagree by hundreds of metres or more. Use exact OneMap address results,
   verified geocoding, or a separately documented project-centroid strategy.
2. **Master project coverage**: 32 of 2,994 master project names remain without
   an exact transaction-name match (as of this recovery), including 21 landed,
   7 unspecified, and 4 apartment/condo. One of the four, `ENCHANTÃ‰`,
   has a separate verified runtime alias to `ENCHANTÉ` and 25 transactions.
   Do not merge distinct projects based on fuzzy spelling or street name.
3. **No automatically scheduled import guard**: `scripts/db/realis_import_reconciliation.sql`
   is a read-only audit for a known staged batch; run it after future exports,
   updating source table references for the new batch.

This recovery did **not** create fictitious floor numbers, overwrite existing
sale prices, merge project master identities, or add inferred coordinates.
