-- HDB Property Information reference table (Stage 5, Part A).
--
-- Source: data.gov.sg "HDB Property Information",
--   resource_id d_17f5382f26140b1fdae0ba2ef6239d2f
--   (13,357 blocks total; only the ~10,796 residential blocks are synced here).
--
-- Purpose: supply an authoritative year_completed for HDB blocks that have NO
-- resale transaction history. Such a block currently falls to the broadest
-- nearby tier (hdb_nearby_all) in valuation.ts because there is no same-block
-- data AND no completion year (nearbyWithSimilarAge is forced empty). Supplying
-- year_completed lets the valuation use the age-matched tier
-- (hdb_nearby_same_age) instead — a modest fallback-quality upgrade. It cannot
-- produce a same-block valuation (no same-block prices exist for these blocks).
--
-- max_floor_lvl and total_dwelling_units are stored as descriptive fields.
-- NOTE: max_floor_lvl has NO consumer today. The shipped HDB floor multiplier
-- (valuation.ts hdbFloorMultiplier) is an ABSOLUTE-storey ratio model
-- (subjectStorey / compAvgStorey)^beta and does not use per-block height. It is
-- kept only as the natural input IF HDB ever moves to a height-tiered beta like
-- the condo/EC condoEcHeightTierBeta path. Do not wire it in without
-- re-deriving and re-backtesting the beta on a relative-height basis.
--
-- Join key: (blk_no, street) stored already NORMALISED to the same uppercase,
-- whitespace-collapsed, HDB-abbreviated form the valuation engine's street
-- normaliser produces (e.g. "MACPHERSON LANE" -> "MACPHERSON LN"), so the
-- engine can look up by the exact primary key.
--
-- Populated by scripts/hdb_sync/sync_hdb_block_info.py; refreshed monthly by
-- .github/workflows/hdb_block_info_sync.yml. The property-information dataset
-- changes rarely (year_completed is fixed once a block completes; new BTOs are
-- added and unit counts get occasional corrections), so the sync upserts with
-- merge-duplicates rather than insert-only.

create table if not exists public.hdb_block_info (
  blk_no                text        not null,  -- normalised: upper/trim (e.g. "82A")
  street                text        not null,  -- normalised street key (e.g. "MACPHERSON LN")
  year_completed        integer,
  max_floor_lvl         integer,               -- stored only; no consumer today
  total_dwelling_units  integer,
  updated_at            timestamptz not null default now(),
  primary key (blk_no, street)
);

comment on table public.hdb_block_info is
  'HDB Property Information reference (data.gov.sg d_17f5382f26140b1fdae0ba2ef6239d2f), residential blocks only. Supplies year_completed for HDB blocks with no resale transaction history so valuation can use the age-matched nearby tier. Synced monthly.';

-- Read path: the valuation engine reads with the anon key, so it needs SELECT.
-- Writes come from the sync using the service_role key, which bypasses RLS.
alter table public.hdb_block_info enable row level security;

drop policy if exists hdb_block_info_read on public.hdb_block_info;
create policy hdb_block_info_read on public.hdb_block_info
  for select using (true);
