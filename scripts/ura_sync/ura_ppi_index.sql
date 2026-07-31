-- URA Property Price Index (by locality) reference table (Stage 6).
--
-- Source: data.gov.sg "Private Property Price Index of Non-landed Residential
--   Properties by Locality, Quarterly",
--   resource_id d_f65e490a8ad430f60a9a3d9df2bff2a0
--   (CCR / RCR / OCR breakdown; matches URA's own quarterly press releases).
--
-- Purpose: power the Stage 6 Indexed Market Value for condo/EC. The engine takes
-- the nearest size-matched same-project transaction and scales its psf forward by
-- the matching market-segment PPI from the anchor's sale quarter to today, then
-- blends that against the neutral valuation via a same-project-volume taper. This
-- closes the neutral estimate's structural under-prediction in thin-volume,
-- appreciating projects. HDB is deliberately out of scope — its only published
-- RPI is nationwide, which testing confirmed is too coarse for this signal.
--
-- Segment codes (CCR/RCR/OCR) match projects_master.market_segment, which the
-- engine uses to resolve a project's segment (getProjectMarketSegment).
--
-- quarter_start_date is the first day of the quarter, stored so getIndexValueAsOf
-- can do a plain `quarter_start_date <= date` range lookup for the most recent
-- published quarter. No publication-lag arithmetic is stored: this table only
-- ever holds quarters URA has already published, and the live engine values
-- as-of now, so the latest row <= now IS the latest published quarter. (The
-- no-look-ahead discipline only matters when backtesting a past date.)
--
-- Populated by scripts/ura_sync/sync_ura_ppi_datagov.py; refreshed monthly by
-- .github/workflows/ura_ppi_sync.yml. URA publishes one new quarter ~3-4 weeks
-- after each quarter-end and revises recent quarters, so the sync upserts with
-- merge-duplicates rather than insert-only.

create table if not exists public.ura_ppi_index (
  id                  bigint generated always as identity primary key,
  segment             text        not null check (segment in ('CCR', 'RCR', 'OCR')),
  quarter             text        not null,  -- e.g. "2026-Q2"
  quarter_start_date  date        not null,  -- first day of the quarter (range key)
  index_value         numeric     not null,
  fetched_at          timestamptz not null default now(),
  unique (segment, quarter)
);

create index if not exists ura_ppi_index_seg_qsd_idx
  on public.ura_ppi_index (segment, quarter_start_date desc);

comment on table public.ura_ppi_index is
  'URA Property Price Index of Non-landed Residential Properties by Locality (CCR/RCR/OCR), quarterly. Source: data.gov.sg d_f65e490a8ad430f60a9a3d9df2bff2a0. Refreshed monthly by scripts/ura_sync/sync_ura_ppi_datagov.py. Powers Stage 6 Indexed Market Value (condo/EC).';

-- Read path: the valuation engine reads with the anon key, so it needs SELECT.
-- Writes come from the sync using the service_role key, which bypasses RLS.
alter table public.ura_ppi_index enable row level security;

drop policy if exists ura_ppi_index_read on public.ura_ppi_index;
create policy ura_ppi_index_read on public.ura_ppi_index
  for select using (true);
