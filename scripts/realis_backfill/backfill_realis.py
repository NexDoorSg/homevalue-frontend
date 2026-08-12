#!/usr/bin/env python3
"""
One-off backfill for REALIS-sourced rows in property_transactions_v2.

Why this exists:
  The realis pipeline (weekly REALIS/Cowork pull, live since Jun 2026) writes rows
  the valuation engine's getComparableTransactions can't see, for TWO independent
  reasons:
    (A) latitude/longitude are NULL — the pipeline never geocodes, so the rows fall
        outside the engine's coordinate bounding-box query.
    (B) unit_type / property_subtype are populated BACKWARDS vs the ura_private
        convention the engine filters on: the TRANSACTION type (Resale/New Sale/
        Sub Sale) lands in unit_type, and the PROPERTY type (Condominium/Apartment/
        …) lands in property_subtype (or is null). The engine requires
        unit_type ∈ {Condominium, Apartment, Executive Condominium, …}.

  This backfills what is already there. It does NOT fix the pipeline (separate,
  out-of-scope task — next week's pull still lands broken until then).

What it does, per realis row:
  1. Geocode (A): if latitude/longitude is null, resolve lat/lon/postal via OneMap
     from the block+street (unit token stripped), reusing the HDB sync's geocode()
     (same pacing / retry / NIL handling). Geocoding is per distinct block-address.
  2. Remap (B): set
       property_subtype := the transaction type (read from the current unit_type),
       unit_type        := the property type, resolved by priority:
                             (i)  current property_subtype if it names a property type,
                             (ii) else derived from property_group,
                             (iii) else UNRESOLVED → row skipped + reported (never guessed).

Safety:
  - --dry-run (default) writes NOTHING. Resolves + reports only.
  - --limit N     : only the first N rows (after ordering by id) — sample before full.
  - --project X   : only rows whose project_name = X  (e.g. LAKEVILLE, for Fix 1).
  - Writes are guarded per row by id and only set the specific columns; re-runs are
    idempotent (coords only written when null; remap is deterministic).
  - Addresses OneMap cannot resolve, and rows whose property type cannot be
    determined, are reported and SKIPPED, never guessed.

Usage:
  python3 scripts/realis_backfill/backfill_realis.py --project LAKEVILLE          # dry run, Fix 1 scope
  python3 scripts/realis_backfill/backfill_realis.py                              # dry run, ALL realis (Fix 2)
  SUPABASE_KEY="<service_role>" python3 scripts/realis_backfill/backfill_realis.py --project LAKEVILLE --write
  SUPABASE_KEY="<service_role>" python3 scripts/realis_backfill/backfill_realis.py --write
"""

import os
import re
import sys
import json
import time
import argparse
import importlib.util
import urllib.parse
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
# Reuse the HDB sync's geocoder + constants (same OneMap pacing/retry/NIL guard).
_spec = importlib.util.spec_from_file_location("sync_hdb", os.path.join(HERE, "..", "hdb_sync", "sync_hdb_datagov.py"))
sync = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(sync)

SUPABASE_URL = sync.SUPABASE_URL
ANON_KEY = sync.ANON_KEY
TABLE = sync.TABLE
SERVICE_KEY = os.environ.get("SUPABASE_KEY", "")
PAGE = 1000

UNIT_RE = re.compile(r"\s*#\s*\d+[-/]\S+\s*$")  # strip a trailing "#07-15" unit token

# ── Canonicalisation ─────────────────────────────────────────────────────────
# Target property-type vocabulary the valuation engine filters on.
_PTYPE = {
    "condominium": "Condominium",
    "condo": "Condominium",
    "apartment": "Apartment",
    "executive condominium": "Executive Condominium",
    "ec": "Executive Condominium",
    "terrace house": "Terrace House",
    "semi-detached house": "Semi-Detached House",
    "detached house": "Detached House",
}
_TXN = {"resale": "Resale", "new sale": "New Sale", "sub sale": "Sub Sale"}
# property_group values that are a property type (not a region / not "private").
_GROUP_PTYPE = {
    "condo": "Condominium",
    "condominium": "Condominium",
    "apartment": "Apartment",
    "ec": "Executive Condominium",
    "executive condominium": "Executive Condominium",
    "terrace house": "Terrace House",
    # "Landed" is deliberately absent: it does not disambiguate Terrace/Semi-D/Detached.
}


# projects_master.property_type vocabulary → engine vocabulary.
_PM_PTYPE = {
    "apartment": "Apartment",
    "condominium": "Condominium",
    "executive condominium": "Executive Condominium",
    "terrace": "Terrace House",
    "strata terrace": "Terrace House",
    "semi-detached": "Semi-Detached House",
    "strata semi-detached": "Semi-Detached House",
    "detached": "Detached House",
    "strata detached": "Detached House",
}


def ptype_of(v):
    return _PTYPE.get((v or "").strip().lower())


def txn_of(v):
    return _TXN.get((v or "").strip().lower())


def group_ptype_of(v):
    return _GROUP_PTYPE.get((v or "").strip().lower())


def norm_name(v):
    return (v or "").strip().upper()


def resolve_remap(row, pm_types):
    """-> (new_unit_type, new_property_subtype, reason_if_unresolved, ptype_source).

    Property type is resolved by priority:
      (i)  current property_subtype if it names a property type,
      (ii) else property_group if it names a property type (Condo/EC/…),
      (iii)else projects_master.property_type by project_name,
      (iv) else UNRESOLVED — the property type is absent from the row and not in
           projects_master, so it cannot be recovered by this backfill.
    """
    txn = txn_of(row.get("unit_type")) or txn_of(row.get("property_subtype"))
    src = "subtype"
    ptype = ptype_of(row.get("property_subtype"))
    if ptype is None:
        ptype = group_ptype_of(row.get("property_group")); src = "group"
    if ptype is None:
        ptype = pm_types.get(norm_name(row.get("project_name"))); src = "projects_master"
    if ptype is None:
        return (None, None, f"property-type absent (group={row.get('property_group')!r}, subtype={row.get('property_subtype')!r}, project not in projects_master)", None)
    if txn is None:
        return (None, None, f"txn-type unresolved (unit_type={row.get('unit_type')!r})", None)
    return (ptype, txn, None, src)


def strip_unit(address):
    return UNIT_RE.sub("", (address or "").strip()).strip()


# ── Supabase read ────────────────────────────────────────────────────────────
def fetch_projects_master_types():
    """{normalised project_name: engine property type} from projects_master."""
    base = f"{SUPABASE_URL}/rest/v1/projects_master"
    out, frm = {}, 0
    while True:
        qs = urllib.parse.urlencode({"select": "project_name,property_type", "order": "project_name"})
        req = urllib.request.Request(f"{base}?{qs}", headers={"apikey": ANON_KEY, "Authorization": f"Bearer {ANON_KEY}", "Range": f"{frm}-{frm + PAGE - 1}"})
        with urllib.request.urlopen(req, timeout=60) as r:
            data = json.load(r)
        for row in data:
            pt = _PM_PTYPE.get((row.get("property_type") or "").strip().lower())
            nm = norm_name(row.get("project_name"))
            if pt and nm:
                out.setdefault(nm, pt)
        if len(data) < PAGE:
            break
        frm += PAGE
    return out


def fetch_realis_rows(project=None, limit=0):
    base = f"{SUPABASE_URL}/rest/v1/{TABLE}"
    out, frm = [], 0
    while True:
        params = {
            "select": "id,address,project_name,latitude,longitude,postal_code,unit_type,property_subtype,property_group",
            "source": "eq.realis",
            "order": "id",
        }
        if project:
            params["project_name"] = f"eq.{project}"
        qs = urllib.parse.urlencode(params)
        req = urllib.request.Request(f"{base}?{qs}", headers={"apikey": ANON_KEY, "Authorization": f"Bearer {ANON_KEY}", "Range": f"{frm}-{frm + PAGE - 1}"})
        with urllib.request.urlopen(req, timeout=60) as r:
            data = json.load(r)
        out.extend(data)
        if len(data) < PAGE:
            break
        frm += PAGE
        if limit and len(out) >= limit:
            break
    return out[:limit] if limit else out


# ── Supabase write ───────────────────────────────────────────────────────────
def patch_row(row_id, payload):
    if not SERVICE_KEY:
        raise SystemExit("SUPABASE_KEY (service_role) not set — refusing to write.")
    url = f"{SUPABASE_URL}/rest/v1/{TABLE}?{urllib.parse.urlencode({'id': f'eq.{row_id}'})}"
    req = urllib.request.Request(url, data=json.dumps(payload).encode(), method="PATCH", headers={
        "apikey": SERVICE_KEY, "Authorization": f"Bearer {SERVICE_KEY}",
        "Content-Type": "application/json", "Prefer": "return=representation",
    })
    with urllib.request.urlopen(req, timeout=60) as r:
        return len(json.load(r))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--write", action="store_true", help="Actually write. Default is a dry run.")
    ap.add_argument("--project", default=None, help="Restrict to one project_name (e.g. LAKEVILLE).")
    ap.add_argument("--limit", type=int, default=0, help="Only the first N realis rows (0 = all).")
    ap.add_argument("--no-geocode", action="store_true", help="Skip OneMap in dry-run (remap analysis only).")
    args = ap.parse_args()
    dry = not args.write

    print(f"Mode: {'DRY RUN (no writes)' if dry else 'WRITE'} | project: {args.project or 'ALL'} | limit: {args.limit or 'none'}\n")

    pm_types = fetch_projects_master_types()
    print(f"projects_master types loaded   : {len(pm_types):,}")
    rows = fetch_realis_rows(project=args.project, limit=args.limit)
    print(f"realis rows in scope           : {len(rows):,}")
    need_geo = [r for r in rows if r.get("latitude") is None or r.get("longitude") is None]
    print(f"  rows needing geocode (null xy): {len(need_geo):,}")

    # Remap analysis (exact, read-only).
    from collections import Counter
    resolvable, unresolved, by_src = [], [], Counter()
    for r in rows:
        nu, ns, why, src = resolve_remap(r, pm_types)
        if why is None:
            resolvable.append((r, nu, ns, why)); by_src[src] += 1
        else:
            unresolved.append((r, nu, ns, why))
    print(f"  rows with resolvable remap    : {len(resolvable):,}   (ptype source: {dict(by_src)})")
    print(f"  rows UNRESOLVED (skipped)     : {len(unresolved):,}")
    if unresolved:
        print("    unresolved by reason:")
        for reason, c in Counter(u[3] for u in unresolved).most_common(12):
            print(f"      {c:>4}  {reason}")

    # Distinct block-addresses to geocode.
    addr_map = {}
    for r in need_geo:
        a = strip_unit(r.get("address"))
        if a:
            addr_map.setdefault(a, []).append(r)
    print(f"  distinct block-addresses      : {len(addr_map):,}")

    geo_ok, geo_fail = {}, []
    if not args.no_geocode and addr_map:
        est = len(addr_map) * sync.GEO_PACING_S / 60
        print(f"\nGeocoding {len(addr_map):,} distinct addresses via OneMap (~{est:.1f} min)…")
        for i, a in enumerate(sorted(addr_map), 1):
            g = sync.geocode(a)
            if g and g[0] is not None and g[1] is not None:
                geo_ok[a] = g
            else:
                geo_fail.append(a)
            time.sleep(sync.GEO_PACING_S)
            if i % 50 == 0:
                print(f"  … {i}/{len(addr_map)}  ok={len(geo_ok)} fail={len(geo_fail)}")
        print(f"\n  geocode resolved  : {len(geo_ok):,} addresses")
        print(f"  geocode FAILED    : {len(geo_fail):,} addresses")
        for a in geo_fail[:20]:
            print(f"      UNRESOLVED ADDR: {a}  ({len(addr_map[a])} row(s))")

    # ── Write ────────────────────────────────────────────────────────────────
    if not dry:
        updated = 0
        for r, nu, ns, why in resolvable:
            payload = {}
            if r.get("latitude") is None or r.get("longitude") is None:
                a = strip_unit(r.get("address"))
                g = geo_ok.get(a)
                if g:
                    payload["latitude"], payload["longitude"] = g[0], g[1]
                    if g[2] and not r.get("postal_code"):
                        payload["postal_code"] = g[2]
            # Only rewrite the columns when they actually change.
            if nu != r.get("unit_type"):
                payload["unit_type"] = nu
            if ns != r.get("property_subtype"):
                payload["property_subtype"] = ns
            if payload:
                updated += patch_row(r["id"], payload)
        print(f"\n--- WRITE COMPLETE --- rows patched: {updated:,}")
    else:
        print("\n--- DRY RUN — nothing written --- re-run with --write and SUPABASE_KEY set to apply.")

    # Preview a few concrete remaps.
    print("\nSample remaps (id: unit_type/subtype  ->  unit_type/subtype  | geocode):")
    for r, nu, ns, why in resolvable[:12]:
        a = strip_unit(r.get("address"))
        g = geo_ok.get(a)
        gtxt = f"{g[0]:.5f},{g[1]:.5f}" if g else ("(has xy)" if r.get("latitude") is not None else "(no geo)")
        print(f"  {r['id']}: {r.get('unit_type')!r}/{r.get('property_subtype')!r} -> {nu!r}/{ns!r}  | {gtxt}")


if __name__ == "__main__":
    main()
