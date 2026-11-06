-- Tower View data coverage audit (read-only).
-- Run against HomeValue Supabase. This does NOT infer unit numbers or update data.
-- A '#' indicates only a candidate unit address, not validated parseability.
-- Project matching uses the same exact project name as the Tower View API.

WITH tx AS (
  SELECT
    project_name,
    count(*) AS all_tx,
    count(*) FILTER (WHERE position('#' IN coalesce(address, '')) > 0) AS hash_address_tx,
    count(*) FILTER (
      WHERE coalesce(address, '') ~ '#[[:digit:]]+[[:space:]]*-[[:space:]]*[[:digit:]]+'
    ) AS unit_pattern_tx,
    min(transaction_date) AS first_tx,
    max(transaction_date) AS latest_tx
  FROM public.property_transactions_v2
  WHERE project_name IS NOT NULL
  GROUP BY project_name
)
SELECT
  p.project_name,
  p.street_name,
  p.total_units,
  coalesce(t.all_tx, 0) AS all_tx,
  coalesce(t.hash_address_tx, 0) AS hash_address_tx,
  coalesce(t.unit_pattern_tx, 0) AS unit_pattern_tx,
  coalesce(t.all_tx, 0) - coalesce(t.hash_address_tx, 0) AS no_unit_address_tx,
  t.first_tx,
  t.latest_tx,
  CASE
    WHEN t.all_tx IS NULL THEN 'NO_EXACT_PROJECT_MATCH'
    WHEN t.hash_address_tx = 0 THEN 'BUILDING_ONLY'
    WHEN t.unit_pattern_tx < t.hash_address_tx THEN 'REVIEW_UNIT_FORMAT'
    WHEN t.hash_address_tx < t.all_tx THEN 'PARTIAL_UNIT_COVERAGE'
    ELSE 'UNIT_ADDRESS_COVERED'
  END AS coverage_status
FROM public.projects_master p
LEFT JOIN tx t ON t.project_name = p.project_name
ORDER BY
  CASE WHEN t.all_tx IS NULL THEN 0 WHEN t.hash_address_tx = 0 THEN 1
       WHEN t.hash_address_tx < t.all_tx THEN 2 ELSE 3 END,
  p.total_units DESC NULLS LAST, p.project_name;

-- CAUTION:
-- NO_EXACT_PROJECT_MATCH does not establish that a project never transacted.
-- Do not automatically reassign other projects' transactions by street name.
-- Validate project identity using source-record names and full addresses first.
