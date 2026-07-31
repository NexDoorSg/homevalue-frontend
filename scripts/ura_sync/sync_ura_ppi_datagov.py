#!/usr/bin/env python3
"""
URA Property Price Index (by locality) sync: data.gov.sg -> Supabase ura_ppi_index.

Mirrors the conventions of sync_hdb_block_info.py (stdlib only, paced HTTP with
retry/backoff, dry-run default, service-role UPSERT), and is even simpler: this
series has no coordinates and only ~150–300 rows.

Source: "Private Property Price Index of Non-landed Residential Properties by
Locality, Quarterly" — data.gov.sg resource d_f65e490a8ad430f60a9a3d9df2bff2a0
(URA, CCR / RCR / OCR breakdown; matches URA's own quarterly press releases).

Publication lag note: data.gov.sg only ever serves quarters URA has already
published (~3–4 weeks after quarter-end), so there is NO as-of / look-ahead
discipline to apply at sync time — we simply store whatever is currently served.
The as-of discipline lives in the live valuation engine (getIndexValueAsOf), not
here. This is why the sync can run any day of the month safely.

What it does:
  1. Pull the full PPI-by-locality series from data.gov.sg (paginated).
  2. Map URA's segment labels to the compact CCR / RCR / OCR codes the engine
     and projects_master.market_segment use.
  3. Derive quarter_start_date (first day of the quarter) for range queries.
  4. Dedup on (segment, quarter), keep the LAST occurrence (a later page would
     carry a revised index for the same quarter).
  5a. (default) --dry-run: print counts + a sample and write a CSV preview.
      NO Supabase writes.
  5b. --write: UPSERT into ura_ppi_index with ON CONFLICT (segment, quarter)
      resolution=merge-duplicates (URA revises recent quarters; refresh in place).
      Requires SUPABASE_KEY (service_role) in the environment.

Usage:
  python3 scripts/ura_sync/sync_ura_ppi_datagov.py                 # dry-run (default)
  python3 scripts/ura_sync/sync_ura_ppi_datagov.py --limit 12      # dry-run, sample
  SUPABASE_KEY="<service_role>" python3 scripts/ura_sync/sync_ura_ppi_datagov.py --write
"""

import os
import csv
import json
import time
import argparse
import datetime
import urllib.request
import urllib.error
import urllib.parse

# ---- data.gov.sg ----
DATAGOV = "https://data.gov.sg/api/action/datastore_search"
RID = "d_f65e490a8ad430f60a9a3d9df2bff2a0"  # URA PPI of non-landed by locality, quarterly
PAGE = 1000
DATAGOV_PACING_S = 0.5

# ---- HTTP ----
HTTP_MAX_RETRIES = 5
HTTP_BACKOFF_S = 0.8

# ---- Supabase ----
SUPABASE_URL = "https://uooqynhqjeusryuwghhe.supabase.co"
SERVICE_KEY = os.environ.get("SUPABASE_KEY", "")  # only needed for the write path
TABLE = "ura_ppi_index"
CONFLICT_KEY = "segment,quarter"

OUT_COLS = ["segment", "quarter", "quarter_start_date", "index_value", "fetched_at"]

# URA's verbose locality labels -> the compact codes stored in
# projects_master.market_segment and used by the valuation engine.
SEGMENT_MAP = {
    "Core Central Region": "CCR",
    "Rest of Central Region": "RCR",
    "Outside Central Region": "OCR",
}


def to_float(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def quarter_start_date(quarter):
    """'2026-Q2' -> '2026-04-01'. Returns None for an unparseable quarter."""
    q = (quarter or "").strip().upper()
    try:
        year_s, qtr_s = q.split("-Q")
        year = int(year_s)
        qtr = int(qtr_s)
        if qtr not in (1, 2, 3, 4):
            return None
        month = (qtr - 1) * 3 + 1
        return f"{year:04d}-{month:02d}-01"
    except (ValueError, AttributeError):
        return None


def get_json(url, headers=None):
    """GET + parse JSON, retrying on 429/5xx with exponential backoff."""
    for attempt in range(HTTP_MAX_RETRIES + 1):
        try:
            req = urllib.request.Request(url, headers=headers or {})
            with urllib.request.urlopen(req, timeout=60) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            if (e.code == 429 or e.code >= 500) and attempt < HTTP_MAX_RETRIES:
                time.sleep(HTTP_BACKOFF_S * (2 ** attempt))
                continue
            raise
        except Exception:
            if attempt < HTTP_MAX_RETRIES:
                time.sleep(HTTP_BACKOFF_S * (2 ** attempt))
                continue
            raise


def fetch_all():
    rows, offset = [], 0
    while True:
        qs = urllib.parse.urlencode({"resource_id": RID, "limit": PAGE, "offset": offset})
        result = get_json(f"{DATAGOV}?{qs}").get("result", {})
        recs = result.get("records", [])
        rows.extend(recs)
        total = result.get("total", 0)
        offset += PAGE
        time.sleep(DATAGOV_PACING_S)
        if not recs or offset >= total:
            break
    return rows


def transform(row, fetched_at):
    segment = SEGMENT_MAP.get((row.get("market_segment") or "").strip())
    quarter = (row.get("quarter") or "").strip()
    index_value = to_float(row.get("price_index"))
    qsd = quarter_start_date(quarter)
    if not segment or not quarter or index_value is None or not qsd:
        return None
    return {
        "segment": segment,
        "quarter": quarter,
        "quarter_start_date": qsd,
        "index_value": index_value,
        "fetched_at": fetched_at,
    }


def upsert(rows):
    """UPSERT with ON CONFLICT (CONFLICT_KEY) merge-duplicates. Requires service key."""
    if not SERVICE_KEY:
        raise SystemExit("SUPABASE_KEY (service_role) not set — refusing to write.")
    url = f"{SUPABASE_URL}/rest/v1/{TABLE}?on_conflict={CONFLICT_KEY}"
    headers = {
        "apikey": SERVICE_KEY,
        "Authorization": f"Bearer {SERVICE_KEY}",
        "Content-Type": "application/json",
        # merge-duplicates == ON CONFLICT DO UPDATE: URA revises recent quarters,
        # so refresh the index value (and fetched_at) in place.
        "Prefer": "resolution=merge-duplicates,return=minimal",
    }
    B = 500
    for i in range(0, len(rows), B):
        batch = [{k: r.get(k) for k in OUT_COLS} for r in rows[i:i + B]]
        req = urllib.request.Request(url, data=json.dumps(batch).encode(), headers=headers, method="POST")
        with urllib.request.urlopen(req, timeout=120) as resp:
            resp.read()
        print(f"  upserted batch {i}-{i + len(batch)}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--write", action="store_true",
                    help="Actually UPSERT to Supabase. Default is a dry run (no writes).")
    ap.add_argument("--limit", type=int, default=0,
                    help="Cap the derived set to the first N rows (0 = all).")
    args = ap.parse_args()
    dry_run = not args.write

    print(f"Source RID: {RID} | write: {args.write} | limit: {args.limit or 'none'}\n")

    fetched_at = datetime.datetime.now(datetime.timezone.utc).isoformat()
    raw = fetch_all()
    print(f"Fetched {len(raw)} raw rows from data.gov.sg")

    candidates = [t for t in (transform(r, fetched_at) for r in raw) if t]
    dropped = len(raw) - len(candidates)
    if dropped:
        print(f"  dropped {dropped} rows (unmapped segment / bad quarter / null index)")

    # Dedup on (segment, quarter), keep the LAST occurrence — a later page carries
    # the more recent (possibly revised) value for a quarter.
    by_key = {}
    for c in candidates:
        by_key[(c["segment"], c["quarter"])] = c
    final = list(by_key.values())
    final.sort(key=lambda c: (c["quarter"], c["segment"]))
    print(f"After (segment, quarter) dedup: {len(final)} "
          f"(dropped {len(candidates) - len(final)} dupes)")

    segs = {}
    for c in final:
        segs[c["segment"]] = segs.get(c["segment"], 0) + 1
    latest = max((c["quarter"] for c in final), default="—")
    print(f"  by segment: {segs} | latest quarter: {latest}\n")

    to_write = final[: args.limit] if args.limit else final
    if args.limit:
        print(f"--limit {args.limit}: using the first {len(to_write)} of {len(final)} rows\n")

    print("Sample rows (latest quarters):")
    for c in sorted(to_write, key=lambda c: (c["quarter"], c["segment"]), reverse=True)[:6]:
        print(f"  {c['segment']} | {c['quarter']} | start={c['quarter_start_date']} | index={c['index_value']}")
    print()

    if dry_run:
        stamp = datetime.date.today().strftime("%Y%m%d")
        path = os.path.expanduser(f"~/Downloads/ura_ppi_index_{stamp}.csv")
        try:
            with open(path, "w", newline="") as f:
                w = csv.DictWriter(f, fieldnames=OUT_COLS)
                w.writeheader()
                for c in to_write:
                    w.writerow({k: c.get(k) for k in OUT_COLS})
            print(f"DRY RUN — wrote {len(to_write)} rows to {path}")
        except OSError as e:
            print(f"DRY RUN — {len(to_write)} rows derived (CSV not written: {e})")
        print("No Supabase writes performed. Re-run with --write to upsert.")
    else:
        print(f"WRITING {len(to_write)} rows to {TABLE} …")
        upsert(to_write)
        print("Done.")


if __name__ == "__main__":
    main()
