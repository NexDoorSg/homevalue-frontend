-- Public market data only. No historical transactions are deleted or repriced.
-- property_group/source provide explicit HDB identity; fill only the legacy null field.
UPDATE public.property_transactions_v2
SET property_type = 'hdb'
WHERE source = 'data_gov_hdb' AND property_group = 'hdb' AND property_type IS NULL;

-- Temporary REALIS import workspaces are administrative, not public API tables.
-- Keep all existing rows. Table owners/service_role retain their existing access.
ALTER TABLE public.realis_staging_20261002 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.realis_new_rows_20261002 ENABLE ROW LEVEL SECURITY;

-- Preserve existing function bodies and execution permissions. Public schema
-- CREATE is not granted to anon/authenticated; pg_temp must be searched last.
ALTER FUNCTION public.set_agent_valuation_reports_updated_at() SET search_path = public, pg_temp;
ALTER FUNCTION public.is_nexdoor_agent() SET search_path = public, pg_temp;
ALTER FUNCTION public.get_duplicate_groups(integer, integer) SET search_path = public, pg_temp;
ALTER FUNCTION public.get_hdb_valuation_summary(double precision, double precision, text, numeric) SET search_path = public, pg_temp;
ALTER FUNCTION public.get_hdb_top_comparables(double precision, double precision, text, numeric) SET search_path = public, pg_temp;
