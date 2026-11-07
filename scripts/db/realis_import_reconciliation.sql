-- REALIS batch reconciliation — READ ONLY
--
-- Purpose:
--   After staging and selecting a REALIS import batch, verify every intended
--   new row appears in property_transactions_v2. Run BEFORE considering the
--   batch finished, and again after any recovery/backfill.
--
-- Update both source table names for later batches; this version checks the
-- 2026-10-02 staging/new-rows tables, containing September 2026 sales.
-- Matching by the live unique index's fields (address, date, price) avoids
-- false "missing" reports from name aliases or differing metadata.
-- This audit does NOT create transactions, IDs, units, or coordinates.

-- 1. Overall completeness of the explicitly selected new rows
WITH status AS (
  SELECT n.idx, n.project_name, n.address, n.sale_date_iso,
         n.transacted_price, n.property_type, n.type_of_area,
         EXISTS (
           SELECT 1 FROM public.property_transactions_v2 t
           WHERE t.address = n.address
             AND t.transaction_date = n.sale_date_iso
             AND t.transaction_price = n.transacted_price
         ) AS present
  FROM public.realis_new_rows_20261002 n
)
SELECT count(*) AS designated_new_rows,
       count(*) FILTER (WHERE present) AS in_live_table,
       count(*) FILTER (WHERE NOT present) AS missing,
       count(DISTINCT project_name) FILTER (WHERE NOT present) AS affected_projects,
       count(*) FILTER (
         WHERE NOT present AND address ~ '^[0-9]+[A-Z]?[[:space:]].+#[0-9]+-[0-9]+$'
       ) AS missing_with_standard_unit_address
FROM status;

-- 2. Missing source records for investigation (expected 0 after recovery)
SELECT n.idx, n.project_name, n.address, n.sale_date_iso,
       n.transacted_price, n.property_type, n.type_of_area, n.number_of_units
FROM public.realis_new_rows_20261002 n
WHERE NOT EXISTS (
  SELECT 1 FROM public.property_transactions_v2 t
  WHERE t.address = n.address
    AND t.transaction_date = n.sale_date_iso
    AND t.transaction_price = n.transacted_price
)
ORDER BY n.idx;

-- 3. Source duplicates must be reviewed before any new ingestion
SELECT address, sale_date_iso, transacted_price, count(*) AS instances
FROM public.realis_new_rows_20261002
GROUP BY address, sale_date_iso, transacted_price
HAVING count(*) > 1
ORDER BY instances DESC;

-- 4. Project master names with no EXACT transaction-name match (separate issue)
-- These are not necessarily missing imports: new/landed projects may have no
-- unit-level sales, and source-name variants must be verified individually.
WITH txn_names AS (
  SELECT DISTINCT upper(project_name) AS project_name
  FROM public.property_transactions_v2
  WHERE project_name IS NOT NULL
)
SELECT p.project_name, p.street_name, p.property_type, p.total_units
FROM public.projects_master p
LEFT JOIN txn_names t ON t.project_name = upper(p.project_name)
WHERE t.project_name IS NULL
ORDER BY p.total_units DESC NULLS LAST, p.project_name;

-- Safety:
-- Never substitute transactions by fuzzy project name or street alone.
-- Never fabricate floor/stack, geocodes, sale dates, or prices.
-- The unique live index is (address, transaction_date, transaction_price).
-- Any backfill should be bounded, transactional, idempotent, and post-verified.
