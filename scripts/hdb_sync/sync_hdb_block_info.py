#!/usr/bin/env python3
"""
HDB Property Information sync: data.gov.sg -> Supabase hdb_block_info.

Mirrors the conventions of sync_hdb_datagov.py (stdlib only, paced HTTP with
retry/backoff, dry-run preview), but is much simpler: this dataset has no
coordinates, so there is NO geocoding step.

What it does:
  1. Pull the full "HDB Property Information" dataset from data.gov.sg
     (resource_id d_17f5382f26140b1fdae0ba2ef6239d2f, ~13,357 blocks, paginated).
  2. Keep residential blocks only (residential == "Y").
  3. Normalise the join key: blk_no (upper/trim) and street (upper/trim,
     whitespace-collapsed, HDB-abbreviated the SAME way the valuation engine's
     normalizeStreetName does), so the engine can look up by the exact PK.
  4. Dedup on (blk_no, street), keep first occurrence.
  5a. (default) --dry-run: print counts + a sample and write a CSV preview.
      NO Supabase writes.
  5b. --write: UPSERT into hdb_block_info with ON CONFLICT (blk_no, street)
      resolution=merge-duplicates (values can be corrected; new BTOs get added).
      Requires SUPABASE_KEY (service_role) in the environment.

Usage:
  python3 scripts/hdb_sync/sync_hdb_block_info.py                 # dry-run (default)
  python3 scripts/hdb_sync/sync_hdb_block_info.py --limit 20      # dry-run, sample
  SUPABASE_KEY="<service_role>" python3 scripts/hdb_sync/sync_hdb_block_info.py --write
"""

import os
import csv
import re
import json
import time
import argparse
import datetime
import urllib.request
import urllib.error
import urllib.parse

# ---- data.gov.sg ----
DATAGOV = "https://data.gov.sg/api/action/datastore_search"
RID = "d_17f5382f26140b1fdae0ba2ef6239d2f"  # HDB Property Information
PAGE = 1000
DATAGOV_PACING_S = 0.5

# ---- HTTP ----
HTTP_MAX_RETRIES = 5
HTTP_BACKOFF_S = 0.8

# ---- Supabase ----
SUPABASE_URL = "https://uooqynhqjeusryuwghhe.supabase.co"
SERVICE_KEY = os.environ.get("SUPABASE_KEY", "")  # only needed for the write path
TABLE = "hdb_block_info"
CONFLICT_KEY = "blk_no,street"

OUT_COLS = ["blk_no", "street", "year_completed", "max_floor_lvl", "total_dwelling_units"]

# ── Street normalisation ──────────────────────────────────────────────────────
# Must stay byte-for-byte equivalent to normalizeStreetName() in
# src/lib/comparableRanking.ts (and normalizeHdbStreetKey in src/lib/valuation.ts),
# so the stored join key matches what the valuation engine queries with. The
# data.gov.sg HDB streets already use these abbreviations, so most rules are
# no-ops on this dataset; they exist to normalise the SUBJECT side, which may
# arrive as a fuller form ("MACPHERSON LANE" -> "MACPHERSON LN").
_STREET_ABBREV = [
    (r"\bBUKIT\b", "BT"),
    (r"\bMOUNT\b", "MT"),
    (r"\bSAINT\b", "ST"),
    (r"\bAVENUE\b", "AVE"),
    (r"\bSTREET\b", "ST"),
    (r"\bROAD\b", "RD"),
    (r"\bDRIVE\b", "DR"),
    (r"\bCRESCENT\b", "CRES"),
    (r"\bPLACE\b", "PL"),
    (r"\bCLOSE\b", "CL"),
    (r"\bLANE\b", "LN"),
    (r"\bTERRACE\b", "TER"),
    (r"\bBOULEVARD\b", "BLVD"),
    (r"\bCENTRAL\b", "CTRL"),
    (r"\bHEIGHTS\b", "HTS"),
    (r"\bGARDENS\b", "GDNS"),
    (r"\bNORTH\b", "NTH"),
    (r"\bSOUTH\b", "STH"),
    (r"\bEAST\b", "EST"),
    (r"\bWEST\b", "WEST"),
    (r"\bKAMPONG\b", "KG"),
    (r"\bJALAN\b", "JLN"),
    (r"\bLORONG\b", "LOR"),
    (r"\bUPPER\b", "UPP"),
    (r"\bCOMMONWEALTH\b", "C'WEALTH"),
    (r"\bTANJONG\b", "TG"),
]
_STREET_ABBREV_RE = [(re.compile(p), r) for p, r in _STREET_ABBREV]


def normalize_street(value):
    s = re.sub(r"\s+", " ", (value or "").upper()).strip()
    for rx, rep in _STREET_ABBREV_RE:
        s = rx.sub(rep, s)
    return re.sub(r"\s+", " ", s).strip()


def normalize_block(value):
    return re.sub(r"\s+", " ", (value or "").upper()).strip()


def to_int(v):
    """'1970' / '16' -> int; blanks / non-numeric -> None."""
    s = (v or "").strip()
    if not s:
        return None
    try:
        return int(float(s))
    except (TypeError, ValueError):
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


def transform(row):
    return {
        "blk_no": normalize_block(row.get("blk_no")),
        "street": normalize_street(row.get("street")),
        "year_completed": to_int(row.get("year_completed")),
        "max_floor_lvl": to_int(row.get("max_floor_lvl")),
        "total_dwelling_units": to_int(row.get("total_dwelling_units")),
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
        # merge-duplicates == ON CONFLICT DO UPDATE: refresh values for a block
        # whose unit count / max floor was corrected upstream.
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

    raw = fetch_all()
    print(f"Fetched {len(raw)} raw blocks from data.gov.sg")

    residential = [r for r in raw if (r.get("residential") or "").strip().upper() == "Y"]
    print(f"Residential (residential == 'Y'): {len(residential)}")

    candidates = [transform(r) for r in residential]
    # A transform can only produce a usable row if it has both key parts.
    candidates = [c for c in candidates if c["blk_no"] and c["street"]]

    # Dedup on (blk_no, street), keep first occurrence.
    seen, final = set(), []
    for c in candidates:
        k = (c["blk_no"], c["street"])
        if k in seen:
            continue
        seen.add(k)
        final.append(c)
    print(f"After (blk_no, street) dedup: {len(final)} "
          f"(dropped {len(candidates) - len(final)} dupes)")

    with_year = sum(1 for c in final if c["year_completed"] is not None)
    with_floor = sum(1 for c in final if c["max_floor_lvl"] is not None)
    print(f"  with year_completed: {with_year}/{len(final)}")
    print(f"  with max_floor_lvl : {with_floor}/{len(final)}\n")

    to_write = final[: args.limit] if args.limit else final
    if args.limit:
        print(f"--limit {args.limit}: using the first {len(to_write)} of {len(final)} rows\n")

    print("Sample rows:")
    for c in to_write[:10]:
        print(f"  {c['blk_no']:>5} | {c['street']:<24} | yr={c['year_completed']} "
              f"| maxflr={c['max_floor_lvl']} | units={c['total_dwelling_units']}")
    print()

    if dry_run:
        stamp = datetime.date.today().strftime("%Y%m%d")
        path = os.path.expanduser(f"~/Downloads/hdb_block_info_{stamp}.csv")
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
