#!/usr/bin/env python3
"""
Production HDB sync: data.gov.sg Resale Flat Prices -> property_transactions_v2

Flow:
  1. Pull the target months from data.gov.sg (paginated).
  2. Transform to the property_transactions_v2 schema (data_gov_hdb conventions).
  3. Cross-check vs existing (address, transaction_date, transaction_price).
  4. 5-key dedup on the NEW rows (address, date, price, floor_level,
     floor_area_sqm), keep first occurrence.
  5. Coordinates: reuse lat/lon from EXISTING table rows by exact address
     (any property_group); only call OneMap for addresses with no table match.
  6a. --dry-run : write the full insert set to a CSV in ~/Downloads. NO WRITES.
  6b. (default) : UPSERT with ON CONFLICT (address,transaction_date,
      transaction_price) DO NOTHING — never overwrites existing rows.
      Requires SUPABASE_KEY (service_role) in the environment.

Usage:
  python3 ~/Downloads/sync_hdb_datagov.py --dry-run
  SUPABASE_KEY="<service_role>" python3 ~/Downloads/sync_hdb_datagov.py
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
from datetime import date, timedelta

# ---- data.gov.sg ----
DATAGOV = "https://data.gov.sg/api/action/datastore_search"
RID = "f1765b54-a209-4718-8d38-a39237f502b3"

# Always sync the previous + current calendar month, computed at runtime,
# so a recurring (e.g. weekly) job never freezes on a stale month list.
def month_str(d):
    return d.strftime("%Y-%m")

today = date.today()
this_month = today.replace(day=1)
prev_month = (this_month - timedelta(days=1)).replace(day=1)
MONTHS = [month_str(prev_month), month_str(this_month)]
PAGE = 1000
DATAGOV_PACING_S = 0.3

# ---- HTTP (shared by get_json) ----
HTTP_MAX_RETRIES = 4
HTTP_BACKOFF_S = 0.4

# ---- OneMap ----
ONEMAP = "https://www.onemap.gov.sg/api/common/elastic/search"
GEO_PACING_S = 0.25
GEO_MAX_RETRIES = 4

# ---- Supabase ----
SUPABASE_URL = "https://uooqynhqjeusryuwghhe.supabase.co"
ANON_KEY = (
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVvb3F5"
    "bmhxamV1c3J5dXdnaGhlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU3MDUwMTMsImV4cCI6MjA5MTI4MTAxM30."
    "t4kKDQGY-YNSPJxYLu1fgeGFSrIiEc2nHlgksiCTbSE"
)
SERVICE_KEY = os.environ.get("SUPABASE_KEY", "")   # only needed for the write path
TABLE = "property_transactions_v2"
CONFLICT_KEY = "address,transaction_date,transaction_price"
SQFT_PER_SQM = 10.7639

# Columns we write (must exist on the table).
OUT_COLS = [
    "address", "street_name", "project_name", "transaction_date", "transaction_price",
    "floor_area_sqm", "price_psf", "unit_type", "property_group", "property_subtype",
    "floor_level", "tenure", "completion_year", "source", "latitude", "longitude",
    "postal_code",
]

# OneMap returns the literal string "NIL" when it has no postal code for a
# result. Storing that would look like a real value and parse as a bogus
# postal sector, so it is normalised to None.
ONEMAP_NIL = "NIL"


def clean_postal(value):
    """OneMap POSTAL -> a 6-digit string, or None."""
    postal = (value or "").strip()
    if not postal or postal.upper() == ONEMAP_NIL:
        return None
    return postal if postal.isdigit() else None


# data.gov.sg abbreviates the LANE street suffix to "LN"; OneMap does not
# recognise it and returns no result at all. ~168 of the 9,762 distinct HDB
# addresses (~4,315 rows) end this way — Teck Whye, Marsiling, Compassvale,
# St. George's and others. Anchored to the end and preceded by whitespace so it
# only ever rewrites a whole-word suffix, never a substring inside a name.
LN_SUFFIX_RE = re.compile(r"\sLN$", re.IGNORECASE)


def expand_ln(address):
    """'12B MARSILING LN' -> '12B MARSILING LANE'. None if not LN-suffixed."""
    return LN_SUFFIX_RE.sub(" LANE", address) if LN_SUFFIX_RE.search(address or "") else None


def get_json(url, headers=None):
    """GET + parse JSON, retrying on 429/5xx with exponential backoff.

    Same backoff shape as _geocode_once, but this re-raises once the retries are
    spent instead of returning None: callers unpack the (data, headers) tuple and
    a soft failure here would silently sync nothing rather than fail the run.
    """
    for attempt in range(HTTP_MAX_RETRIES + 1):
        try:
            req = urllib.request.Request(url, headers=headers or {})
            with urllib.request.urlopen(req, timeout=60) as r:
                return json.load(r), dict(r.headers)
        except urllib.error.HTTPError as e:
            if (e.code == 429 or e.code >= 500) and attempt < HTTP_MAX_RETRIES:
                time.sleep(HTTP_BACKOFF_S * (2 ** attempt)); continue
            raise
        except Exception:
            if attempt < HTTP_MAX_RETRIES:
                time.sleep(HTTP_BACKOFF_S * (2 ** attempt)); continue
            raise


def fetch_datagov_month(month):
    rows, offset = [], 0
    while True:
        qs = urllib.parse.urlencode(
            {"resource_id": RID, "filters": json.dumps({"month": month}), "limit": PAGE, "offset": offset}
        )
        data, _ = get_json(f"{DATAGOV}?{qs}")
        result = data.get("result", {})
        recs = result.get("records", [])
        rows.extend(recs)
        total = result.get("total", 0)
        offset += PAGE
        # Pace every request, including the last one of a month: the rate limit is
        # account-wide, so the next month's first page needs the gap just as much
        # as the next page does.
        time.sleep(DATAGOV_PACING_S)
        if not recs or offset >= total:
            break
    return rows


def to_float(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def transform(row):
    block = (row.get("block") or "").strip()
    street = (row.get("street_name") or "").strip()
    price = to_float(row.get("resale_price"))
    sqm = to_float(row.get("floor_area_sqm"))
    lease = (row.get("lease_commence_date") or "").strip()
    psf = round(price / (sqm * SQFT_PER_SQM), 2) if price and sqm else None
    return {
        "address": f"{block} {street}".strip(),
        "street_name": street or None,
        "project_name": None,
        "transaction_date": f"{row.get('month')}-01",
        "transaction_price": price,
        "floor_area_sqm": sqm,
        "price_psf": psf,
        "unit_type": (row.get("flat_type") or "").strip() or None,
        "property_group": "hdb",
        "property_subtype": "hdb",
        "floor_level": (row.get("storey_range") or "").strip() or None,
        "tenure": f"99 yrs from {lease}" if lease else None,
        "completion_year": lease or None,
        "source": "data_gov_hdb",
        "latitude": None,
        "longitude": None,
        # Filled from the same OneMap lookup that resolves lat/lon, or reused
        # from an existing table row. data.gov.sg's resale dataset has no
        # postal field of its own (only block + street_name).
        "postal_code": None,
    }


def key3(t):
    return ((t["address"] or "").strip().upper(), t["transaction_date"], t["transaction_price"])


def key5(t):
    return (*key3(t), t["floor_level"], t["floor_area_sqm"])


def fetch_existing_keys(dates):
    base = f"{SUPABASE_URL}/rest/v1/{TABLE}"
    in_dates = ",".join(f'"{d}"' for d in dates)
    keys, frm = set(), 0
    while True:
        qs = urllib.parse.urlencode(
            {"select": "address,transaction_date,transaction_price", "property_group": "eq.hdb",
             "transaction_date": f"in.({in_dates})"}
        )
        data, _ = get_json(f"{base}?{qs}", {"apikey": ANON_KEY, "Range": f"{frm}-{frm + 999}"})
        if not isinstance(data, list) or not data:
            break
        for r in data:
            keys.add(((r.get("address") or "").strip().upper(), r.get("transaction_date"),
                      to_float(r.get("transaction_price"))))
        if len(data) < 1000:
            break
        frm += 1000
    return keys


def table_coords_for(addresses):
    """Batch-lookup lat/lon AND postal_code by exact address (any property_group).

    Returns {address: (lat, lon, postal_code)}, taking the first non-null value
    of each independently — a row may carry coordinates but no postal, or the
    reverse.

    Postal is read here so the coord-reuse path can satisfy postal_code without
    an OneMap call. Note this only pays off once existing rows actually have
    postal codes: before the backfill every HDB row has postal_code NULL, so
    these addresses still fall through to OneMap (which now returns postal
    anyway). After the backfill it resolves from the table for free.
    """
    base = f"{SUPABASE_URL}/rest/v1/{TABLE}"
    coords, postals = {}, {}
    addrs = list(addresses)
    CH = 50
    for i in range(0, len(addrs), CH):
        chunk = addrs[i:i + CH]
        inlist = ",".join('"' + a.replace('"', "") + '"' for a in chunk)
        qs = urllib.parse.urlencode(
            {"select": "address,latitude,longitude,postal_code", "address": f"in.({inlist})", "limit": "10000"}
        )
        data, _ = get_json(f"{base}?{qs}", {"apikey": ANON_KEY})
        for r in data:
            a = (r.get("address") or "").strip()
            if not a:
                continue
            if a not in coords and r.get("latitude") is not None:
                coords[a] = (r["latitude"], r["longitude"])
            if a not in postals and clean_postal(r.get("postal_code")):
                postals[a] = clean_postal(r.get("postal_code"))
    return {
        a: (coords.get(a, (None, None))[0], coords.get(a, (None, None))[1], postals.get(a))
        for a in set(coords) | set(postals)
    }


_geo_cache = {}


def _geocode_once(query):
    """One OneMap lookup, with retry/backoff. -> (lat, lon, postal_code) or None."""
    url = f"{ONEMAP}?searchVal={urllib.parse.quote(query)}&returnGeom=Y&getAddrDetails=Y&pageNum=1"
    for attempt in range(GEO_MAX_RETRIES + 1):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(req, timeout=30) as r:
                data = json.load(r)
            results = data.get("results", [])
            if not results:
                return None
            return (
                float(results[0]["LATITUDE"]),
                float(results[0]["LONGITUDE"]),
                clean_postal(results[0].get("POSTAL")),
            )
        except urllib.error.HTTPError as e:
            if (e.code == 429 or e.code >= 500) and attempt < GEO_MAX_RETRIES:
                time.sleep(0.4 * (2 ** attempt)); continue
            return None
        except Exception:
            if attempt < GEO_MAX_RETRIES:
                time.sleep(0.4 * (2 ** attempt)); continue
            return None
    return None


def geocode(address):
    """-> (lat, lon, postal_code) or None.

    The request already asks for getAddrDetails=Y, so the response carries
    POSTAL alongside LATITUDE/LONGITUDE — it just used to be discarded.
    Capturing it costs no extra call.

    Falls back once to the LANE-expanded form for LN-suffixed addresses, which
    OneMap otherwise fails outright. If both attempts come back empty the
    address is left unresolved — never guessed.
    """
    if address in _geo_cache:
        return _geo_cache[address]
    found = _geocode_once(address)
    if found is None:
        alt = expand_ln(address)
        if alt:
            found = _geocode_once(alt)
    # Cached under the original address either way, so a hit via the fallback
    # is not re-attempted.
    _geo_cache[address] = found
    return found


def upsert(rows):
    """UPSERT with ON CONFLICT (CONFLICT_KEY) DO NOTHING. Requires service key."""
    if not SERVICE_KEY:
        raise SystemExit("SUPABASE_KEY (service_role) not set — refusing to write.")
    url = f"{SUPABASE_URL}/rest/v1/{TABLE}?on_conflict={CONFLICT_KEY}"
    headers = {
        "apikey": SERVICE_KEY,
        "Authorization": f"Bearer {SERVICE_KEY}",
        "Content-Type": "application/json",
        # resolution=ignore-duplicates == ON CONFLICT DO NOTHING; never overwrites.
        "Prefer": "resolution=ignore-duplicates,return=minimal",
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
    ap.add_argument("--dry-run", action="store_true", help="Preview only: write CSV, no Supabase writes.")
    ap.add_argument("--limit", type=int, default=0,
                    help="Cap the WRITE to the first N rows of the derived insert set (0 = all).")
    args = ap.parse_args()

    print(f"Months: {', '.join(MONTHS)} | dry-run: {args.dry_run} | limit: {args.limit or 'none'}\n")

    candidates = []
    for m in MONTHS:
        raw = fetch_datagov_month(m)
        candidates.extend(transform(r) for r in raw)
        print(f"data.gov.sg {m}: {len(raw)} raw rows")
    print(f"Total candidates: {len(candidates)}")

    # Cross-check vs existing (3-key = the table's conflict constraint).
    existing = fetch_existing_keys([f"{m}-01" for m in MONTHS])
    new_rows = [t for t in candidates if key3(t) not in existing]
    print(f"Existing HDB rows for these months: {len(existing)}")
    print(f"NEW (not in table by 3-key): {len(new_rows)}")

    # 5-key dedup, keep first occurrence.
    seen, final = set(), []
    for t in new_rows:
        k = key5(t)
        if k in seen:
            continue
        seen.add(k)
        final.append(t)
    print(f"After 5-key dedup (keep first): {len(final)}  (dropped {len(new_rows) - len(final)} true dupes)")

    # Cap the WRITE to the first N of the fully-derived set (derivation itself is unchanged).
    to_write = final[: args.limit] if args.limit else final
    if args.limit:
        print(f"--limit {args.limit}: writing only the first {len(to_write)} of {len(final)} derived rows\n")
    else:
        print()

    # Coordinates: reuse from table first, OneMap only for the remainder (of the rows to write).
    uniq_addr = sorted({t["address"] for t in to_write})
    print(f"Unique addresses in insert set: {len(uniq_addr)}")
    tcoords = table_coords_for(uniq_addr)
    # An address only skips OneMap if the table can supply BOTH coordinates and
    # a postal code; a partial hit still needs the lookup.
    def complete(a):
        v = tcoords.get(a)
        return bool(v and v[0] is not None and v[2])
    from_table = [a for a in uniq_addr if complete(a)]
    need_onemap = [a for a in uniq_addr if not complete(a)]
    print(f"  Resolved from existing table rows: {len(from_table)}")
    print(f"  Need a fresh OneMap call         : {len(need_onemap)}")
    for i, a in enumerate(need_onemap, 1):
        geocode(a)
        time.sleep(GEO_PACING_S)
        if i % 50 == 0:
            print(f"    OneMap … {i}/{len(need_onemap)}")

    resolved = {a: tcoords[a] for a in from_table}
    for a in need_onemap:
        g = _geo_cache.get(a)
        partial = tcoords.get(a) or (None, None, None)
        if g:
            # Prefer OneMap for anything the table couldn't supply.
            resolved[a] = (g[0], g[1], g[2] or partial[2])
        elif partial[0] is not None or partial[2]:
            resolved[a] = partial
    for t in to_write:
        v = resolved.get(t["address"])
        if v:
            t["latitude"], t["longitude"], t["postal_code"] = v
    with_geo = sum(1 for t in to_write if t["latitude"] is not None)
    with_postal = sum(1 for t in to_write if t["postal_code"])
    print(f"  Rows to write with lat/lon: {with_geo}/{len(to_write)}")
    print(f"  Rows to write with postal : {with_postal}/{len(to_write)}\n")

    print(f"Upsert conflict target: ({CONFLICT_KEY}) — ON CONFLICT DO NOTHING (never overwrites)\n")

    if args.dry_run:
        stamp = datetime.date.today().strftime("%Y%m%d")
        path = os.path.expanduser(f"~/Downloads/hdb_sync_insert_{stamp}.csv")
        with open(path, "w", newline="") as f:
            w = csv.DictWriter(f, fieldnames=OUT_COLS)
            w.writeheader()
            for t in to_write:
                w.writerow({k: t.get(k) for k in OUT_COLS})
        print(f"DRY RUN — wrote {len(to_write)} rows to {path}")
        print("No Supabase writes performed.")
    else:
        print(f"WRITING {len(to_write)} rows to {TABLE} …")
        upsert(to_write)
        # Print the exact keys written, for verification.
        print("\nKeys written:")
        for t in to_write:
            print(f"  {t['address']} | {t['transaction_date']} | {t['transaction_price']}")
        print("Done.")


if __name__ == "__main__":
    main()
