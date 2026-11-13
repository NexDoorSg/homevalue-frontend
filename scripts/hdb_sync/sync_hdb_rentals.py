#!/usr/bin/env python3
"""Append official HDB rental approvals safely; preview unless --apply is set.

Uses the source ID cursor, including late approvals for earlier months. Refuses
source resets, count gaps and conflicting IDs rather than overwriting history.
No third-party packages. SUPABASE_KEY is required only for --apply.
"""
import argparse
import collections
import datetime as dt
import json
import math
import os
import time
import urllib.parse
import urllib.request

import sync_hdb_datagov as shared

RESOURCE = "d_c9f57187485a850908655db0e8cfe651"
TABLE = "hdb_rental_transactions"
FIELDS = "source_id,town,block,street_name,flat_type,monthly_rent,approval_date,address,latitude,longitude,postal_code"
IDENTITY = ("source_id", "town", "block", "street_name", "flat_type", "monthly_rent", "approval_date")


def transform(row):
    month = str(row["rent_approval_date"])
    dt.date.fromisoformat(month + "-01")
    source_id = int(row["_id"])
    rent = float(row["monthly_rent"])
    if source_id <= 0 or not math.isfinite(rent) or rent <= 0:
        raise ValueError("Invalid official rental ID or rent")
    result = {k: str(row[k]).strip() for k in ("town", "block", "street_name", "flat_type")}
    if not all(result.values()):
        raise ValueError("Incomplete official rental address/type")
    result.update(source_id=source_id, monthly_rent=rent, approval_date=month + "-01",
                  address=f"{result['block']} {result['street_name']}", source="data_gov_hdb_rental")
    return result


def same_identity(left, right):
    return all(left.get(k) == right.get(k) for k in IDENTITY)


def headers(write=False):
    key = os.environ.get("SUPABASE_KEY") if write else shared.ANON_KEY
    if not key:
        raise RuntimeError("SUPABASE_KEY is required for --apply")
    return {"apikey": key, "Authorization": "Bearer " + key}


def db_read(params, extra_headers=None):
    query = urllib.parse.urlencode(params)
    return shared.get_json(f"{shared.SUPABASE_URL}/rest/v1/{TABLE}?{query}",
                           {**headers(), **(extra_headers or {})})


def db_state():
    rows, response_headers = db_read({"select": FIELDS, "order": "source_id.desc", "limit": 1},
                                     {"Prefer": "count=exact"})
    content_range = next((v for k, v in response_headers.items() if k.lower() == "content-range"), "")
    return (rows[0] if rows else None), int(content_range.split("/")[-1])


def fetch_after(cursor):
    rows, offset, total = [], 0, None
    boundary = None
    seen = set()
    last_id = None
    while True:
        query = urllib.parse.urlencode({"resource_id": RESOURCE, "sort": "_id desc",
                                        "limit": 1000, "offset": offset})
        data, _ = shared.get_json(shared.DATAGOV + "?" + query)
        if not data.get("success"):
            raise RuntimeError("Official rental API did not succeed")
        result = data["result"]
        if total is not None and int(result["total"]) != total:
            raise RuntimeError("Official dataset changed during pagination; retry")
        total = int(result["total"])
        page = result["records"]
        for raw in page:
            row = transform(raw)
            row_id = row["source_id"]
            if row_id in seen or (last_id is not None and row_id >= last_id):
                raise RuntimeError("Unstable source ID ordering; refusing partial import")
            seen.add(row_id)
            last_id = row_id
            if row_id > cursor:
                rows.append(row)
            elif row_id == cursor:
                boundary = row
        offset += len(page)
        time.sleep(shared.DATAGOV_PACING_S)
        if offset >= total or (page and last_id <= cursor):
            break
        if not page:
            raise RuntimeError("Official API stopped before the advertised total")
    return rows, boundary, total


def validate_append(latest, existing_count, rows, boundary, source_total):
    if latest and (boundary is None or not same_identity(latest, boundary)):
        raise RuntimeError("Source cursor identity changed; manual reconciliation required")
    if existing_count + len(rows) != source_total:
        raise RuntimeError("Source/database count gap; manual reconciliation required")


def coordinate_cache(addresses):
    cache = {}
    addresses = sorted(addresses)
    for start in range(0, len(addresses), 25):
        chunk = addresses[start:start + 25]
        inlist = ",".join(json.dumps(a) for a in chunk)
        candidates = collections.defaultdict(set)
        offset = 0
        while True:
            rows, _ = db_read({"select": "address,latitude,longitude,postal_code", "address": f"in.({inlist})",
                               "order": "source_id.asc", "limit": 1000, "offset": offset})
            for row in rows:
                lat, lon = row.get("latitude"), row.get("longitude")
                if lat is not None and lon is not None and 1.15 <= lat <= 1.5 and 103.55 <= lon <= 104.1:
                    candidates[row["address"]].add((lat, lon, shared.clean_postal(row.get("postal_code"))))
            offset += len(rows)
            if len(rows) < 1000:
                break
        for address, options in candidates.items():
            if len(options) == 1:
                cache[address] = next(iter(options))
    return cache


def insert_batch(rows):
    query = urllib.parse.urlencode({"on_conflict": "source_id"})
    request = urllib.request.Request(f"{shared.SUPABASE_URL}/rest/v1/{TABLE}?{query}",
        data=json.dumps(rows).encode(), method="POST", headers={**headers(True),
        "Content-Type": "application/json", "Prefer": "resolution=ignore-duplicates,return=minimal"})
    # A partial failure is safe to rerun: the cursor and unique source ID prevent duplicates.
    with urllib.request.urlopen(request, timeout=60) as response:
        response.read()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="Append validated records to Supabase")
    args = parser.parse_args()
    if args.apply:
        headers(True)
    latest, count = db_state()
    cursor = latest["source_id"] if latest else 0
    rows, boundary, source_total = fetch_after(cursor)
    validate_append(latest, count, rows, boundary, source_total)
    summary = {"existing": count, "official_total": source_total, "new": len(rows),
               "approval_months": dict(sorted(collections.Counter(r["approval_date"][:7] for r in rows).items())),
               "applied": args.apply}
    if args.apply and rows:
        cache = coordinate_cache({r["address"] for r in rows})
        for address in sorted({r["address"] for r in rows} - cache.keys()):
            found = shared.geocode(address)
            if found and 1.15 <= found[0] <= 1.5 and 103.55 <= found[1] <= 104.1:
                cache[address] = found
        for row in rows:
            lat, lon, postal = cache.get(row["address"], (None, None, None))
            row.update(latitude=lat, longitude=lon, postal_code=postal)
        for start in range(0, len(rows), 500):
            insert_batch(rows[start:start + 500])
        after, after_count = db_state()
        if after_count != source_total or after["source_id"] != max(r["source_id"] for r in rows):
            raise RuntimeError("Post-import count/cursor verification failed")
        # Verify persisted source fields, not just a successful HTTP response.
        saved, _ = db_read({"select": FIELDS, "source_id": f"gt.{cursor}", "order": "source_id.asc", "limit": 1000})
        offset = len(saved)
        while len(saved) < len(rows):
            page, _ = db_read({"select": FIELDS, "source_id": f"gt.{cursor}", "order": "source_id.asc", "limit": 1000, "offset": offset})
            if not page:
                raise RuntimeError("Post-import verification returned an incomplete result")
            saved.extend(page)
            offset += len(page)
        expected = {r["source_id"]: r for r in rows}
        if len(saved) != len(rows) or any(not same_identity(r, expected.get(r["source_id"], {})) for r in saved):
            raise RuntimeError("Post-import source identity verification failed")
        summary["missing_coordinates_new"] = sum(r["latitude"] is None for r in rows)
    print(json.dumps(summary, sort_keys=True))
    if os.environ.get("GITHUB_STEP_SUMMARY"):
        with open(os.environ["GITHUB_STEP_SUMMARY"], "a") as handle:
            handle.write("### HDB rental sync\n\n```json\n" + json.dumps(summary, indent=2) + "\n```\n")


if __name__ == "__main__":
    main()
