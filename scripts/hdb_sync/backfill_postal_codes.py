#!/usr/bin/env python3
"""
One-off backfill: populate postal_code on existing HDB rows.

Why this exists:
  sync_hdb_datagov.py never wrote postal_code (data.gov.sg's resale dataset has
  no postal field, and the sync discarded the POSTAL that OneMap already
  returns). Every HDB row therefore has postal_code NULL, which makes HDB
  district filtering in /api/project-matcher return 0 results — the matcher
  derives district from postal_code, and projects_master holds no HDB rows.

  The sync is fixed going forward; this backfills what is already there.

Flow:
  1. Page through property_transactions_v2 for HDB rows missing postal_code and
     collect the DISTINCT addresses (~9,762 for ~234k rows — the same block is
     sold many times, so geocoding is per-address, not per-row).
  2. Geocode each address via OneMap, reusing the sync's own geocode() so the
     pacing, retry/backoff and "NIL" handling are identical.
  3. UPDATE every HDB row for that address (postal_code still null) with the
     resolved value.

Safety:
  - --dry-run (default) writes NOTHING. It resolves and reports only.
  - --limit N samples the first N addresses — use this before a full run.
  - Writes are guarded: only rows with property_group=hdb AND postal_code is
    null are touched, so a re-run cannot clobber a good value, and the job is
    resumable and idempotent.
  - Addresses OneMap cannot resolve are reported and skipped, never guessed.

Usage:
  python3 scripts/hdb_sync/backfill_postal_codes.py --limit 20            # sample, no writes
  SUPABASE_KEY="<service_role>" python3 scripts/hdb_sync/backfill_postal_codes.py --limit 20 --write
  SUPABASE_KEY="<service_role>" python3 scripts/hdb_sync/backfill_postal_codes.py --write
"""

import os
import sys
import time
import json
import argparse
import importlib.util
import urllib.parse
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))

# Reuse the sync's constants and geocoder rather than re-implementing them —
# same pacing, same retry policy, same "NIL" guard.
_spec = importlib.util.spec_from_file_location("sync_hdb", os.path.join(HERE, "sync_hdb_datagov.py"))
sync = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(sync)

SUPABASE_URL = sync.SUPABASE_URL
ANON_KEY = sync.ANON_KEY
TABLE = sync.TABLE
SERVICE_KEY = os.environ.get("SUPABASE_KEY", "")
PAGE = 1000


def fetch_addresses_missing_postal():
    """Distinct HDB addresses with no postal_code yet."""
    base = f"{SUPABASE_URL}/rest/v1/{TABLE}"
    seen, frm = {}, 0
    while True:
        qs = urllib.parse.urlencode({
            "select": "address",
            "property_group": "eq.hdb",
            "postal_code": "is.null",
            "order": "address",
        })
        req = urllib.request.Request(
            f"{base}?{qs}",
            headers={"apikey": ANON_KEY, "Range": f"{frm}-{frm + PAGE - 1}", "User-Agent": sync.USER_AGENT}
            if hasattr(sync, "USER_AGENT") else
            {"apikey": ANON_KEY, "Range": f"{frm}-{frm + PAGE - 1}"},
        )
        with urllib.request.urlopen(req, timeout=60) as r:
            data = json.load(r)
        if not data:
            break
        for row in data:
            a = (row.get("address") or "").strip()
            if a:
                seen[a] = seen.get(a, 0) + 1
        if len(data) < PAGE:
            break
        frm += PAGE
    return seen


def update_postal(address, postal):
    """Set postal_code for every HDB row at this address that still lacks one."""
    if not SERVICE_KEY:
        raise SystemExit("SUPABASE_KEY (service_role) not set — refusing to write.")
    qs = urllib.parse.urlencode({
        "address": f"eq.{address}",
        "property_group": "eq.hdb",
        "postal_code": "is.null",   # never overwrite an existing value
    })
    url = f"{SUPABASE_URL}/rest/v1/{TABLE}?{qs}"
    body = json.dumps({"postal_code": postal}).encode()
    req = urllib.request.Request(url, data=body, method="PATCH", headers={
        "apikey": SERVICE_KEY,
        "Authorization": f"Bearer {SERVICE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "return=representation,count=exact",
    })
    with urllib.request.urlopen(req, timeout=60) as r:
        return len(json.load(r))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--write", action="store_true", help="Actually write. Default is a dry run.")
    ap.add_argument("--limit", type=int, default=0, help="Only process the first N distinct addresses (0 = all).")
    args = ap.parse_args()
    dry = not args.write

    print(f"Mode: {'DRY RUN (no writes)' if dry else 'WRITE'} | limit: {args.limit or 'none'}\n")

    addr_counts = fetch_addresses_missing_postal()
    addrs = sorted(addr_counts)
    total_rows = sum(addr_counts.values())
    print(f"HDB rows missing postal_code : {total_rows:,}")
    print(f"Distinct addresses to geocode: {len(addrs):,}")
    if args.limit:
        addrs = addrs[:args.limit]
        print(f"--limit {args.limit}: processing the first {len(addrs)} of them\n")
    else:
        est = len(addrs) * sync.GEO_PACING_S / 60
        print(f"Estimated OneMap time        : ~{est:.0f} min at {sync.GEO_PACING_S}s pacing\n")

    resolved, unresolved, updated_rows = [], [], 0
    for i, a in enumerate(addrs, 1):
        g = sync.geocode(a)
        postal = g[2] if g else None
        if postal:
            resolved.append((a, postal, addr_counts[a]))
            if not dry:
                updated_rows += update_postal(a, postal)
        else:
            unresolved.append((a, "no OneMap result" if not g else "no/NIL postal"))
        time.sleep(sync.GEO_PACING_S)
        if i % 50 == 0:
            print(f"  … {i}/{len(addrs)}  resolved={len(resolved)} unresolved={len(unresolved)}")

    print(f"\n--- {'DRY RUN — nothing written' if dry else 'WRITE COMPLETE'} ---")
    print(f"Addresses processed : {len(addrs)}")
    print(f"  resolved          : {len(resolved)}  (covering {sum(c for _, _, c in resolved):,} rows)")
    print(f"  unresolved        : {len(unresolved)}")
    if not dry:
        print(f"Rows updated        : {updated_rows:,}")

    print("\nSample of resolved (address -> postal, rows affected):")
    for a, p, c in resolved[:20]:
        print(f"  {a:<34} -> {p}   ({c:,} rows)")
    if unresolved:
        print("\nUNRESOLVED (skipped, never guessed):")
        for a, why in unresolved[:20]:
            print(f"  {a:<34} -- {why}")

    if dry:
        print("\nRe-run with --write (and SUPABASE_KEY set) to apply.")


if __name__ == "__main__":
    main()
