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
  1. Geocode (A): if latitude/longitude is null, first reuse one unambiguous
     coordinate from an exact stored address, then an exact project. Only then
     query OneMap, accepting an exact normalized block/street match rather than
     its first plausible search result. Geocoding is per distinct block-address.
  2. Remap (B): set
       property_subtype := the transaction type (read from the current unit_type),
       unit_type        := the property type, resolved by priority:
                             (i)  existing valid unit_type/property_subtype,
                             (ii) an explicit property_group,
                             (iii) one unambiguous exact projects_master type,
                             (iv) else UNRESOLVED → skipped + reported (never guessed).

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
import sys
import json
import time
import argparse
import importlib.util
import urllib.parse
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
SCRIPTS_DIR = os.path.dirname(HERE)
if SCRIPTS_DIR not in sys.path:
    sys.path.insert(0, SCRIPTS_DIR)
from transaction_integrity import core

# Reuse the HDB sync's geocoder + constants (same OneMap pacing/retry/NIL guard).
_spec = importlib.util.spec_from_file_location("sync_hdb", os.path.join(HERE, "..", "hdb_sync", "sync_hdb_datagov.py"))
sync = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(sync)

SUPABASE_URL = sync.SUPABASE_URL
ANON_KEY = sync.ANON_KEY
TABLE = sync.TABLE
SERVICE_KEY = os.environ.get("SUPABASE_KEY", "")
PAGE = 1000

# ── Canonicalisation ─────────────────────────────────────────────────────────
def ptype_of(v):
    return core.canonical_property_type(v)


def txn_of(v):
    return core.canonical_activity(v)


def group_ptype_of(v):
    return core.property_type_from_group(v)


def norm_name(v):
    return core.normalize_name(v)


def resolve_remap(row, pm_types):
    """-> (new_unit_type, new_property_subtype, reason_if_unresolved, ptype_source).

    Classification uses only explicit, unambiguous evidence; see
    transaction_integrity.core.resolve_classification.
    """
    ptype, txn, reason, source = core.resolve_classification(row, pm_types)
    return ptype, txn, reason, source


def strip_unit(address):
    return core.strip_unit(address)


# ── Supabase read ────────────────────────────────────────────────────────────
def fetch_projects_master_types():
    """{normalised project_name: engine property type} from projects_master."""
    base = f"{SUPABASE_URL}/rest/v1/projects_master"
    rows, frm = [], 0
    while True:
        qs = urllib.parse.urlencode({"select": "project_name,property_type", "order": "project_name"})
        data, _ = sync.get_json(
            f"{base}?{qs}",
            {"apikey": ANON_KEY, "Authorization": f"Bearer {ANON_KEY}", "Range": f"{frm}-{frm + PAGE - 1}"},
        )
        rows.extend(data)
        if len(data) < PAGE:
            break
        frm += PAGE
    return core.collapse_project_types(rows)


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
        data, _ = sync.get_json(
            f"{base}?{qs}",
            {"apikey": ANON_KEY, "Authorization": f"Bearer {ANON_KEY}", "Range": f"{frm}-{frm + PAGE - 1}"},
        )
        out.extend(data)
        if len(data) < PAGE:
            break
        frm += PAGE
        if limit and len(out) >= limit:
            break
    return out[:limit] if limit else out


def _fetch_coordinate_rows(column, values):
    """Fetch coordinate-bearing rows for exact raw values, fully paginated."""
    base = f"{SUPABASE_URL}/rest/v1/{TABLE}"
    out = []
    clean_values = sorted({str(value).replace('"', "").strip() for value in values if str(value or "").strip()})
    for start in range(0, len(clean_values), 20):
        chunk = clean_values[start:start + 20]
        in_values = ",".join(f'"{value}"' for value in chunk)
        frm = 0
        while True:
            params = {
                "select": "address,project_name,latitude,longitude,postal_code",
                column: f"in.({in_values})",
                "latitude": "not.is.null",
                "longitude": "not.is.null",
                "order": "id",
            }
            qs = urllib.parse.urlencode(params)
            data, _ = sync.get_json(
                f"{base}?{qs}",
                {"apikey": ANON_KEY, "Authorization": f"Bearer {ANON_KEY}", "Range": f"{frm}-{frm + PAGE - 1}"},
            )
            out.extend(data)
            if len(data) < PAGE:
                break
            frm += PAGE
    return out


def fetch_trusted_coordinate_maps(rows):
    """Return unambiguous coordinates keyed by exact normalized address/project."""
    candidates = _fetch_coordinate_rows("address", [row.get("address") for row in rows])
    candidates.extend(_fetch_coordinate_rows("project_name", [row.get("project_name") for row in rows]))
    by_address, by_project = {}, {}
    for candidate in candidates:
        address = core.normalize_address(candidate.get("address"))
        project = core.normalize_name(candidate.get("project_name"))
        if address:
            by_address.setdefault(address, []).append(candidate)
        if project and project != "N A":
            by_project.setdefault(project, []).append(candidate)
    address_map = {
        key: chosen
        for key, values in by_address.items()
        if (chosen := core.select_unambiguous_coordinate(values)) is not None
    }
    project_map = {
        key: chosen
        for key, values in by_project.items()
        if (chosen := core.select_unambiguous_coordinate(values)) is not None
    }
    return address_map, project_map


_onemap_exact_cache = {}


def lookup_onemap_exact(address):
    """Resolve one exact address; never accept OneMap's first fuzzy result."""
    query = strip_unit(address)
    if query in _onemap_exact_cache:
        return _onemap_exact_cache[query]
    chosen = None
    variants = core.onemap_query_variants(query)
    variants.extend(candidate for candidate in (sync.expand_ln(query), sync.expand_ctrl(query)) if candidate)
    for candidate_query in dict.fromkeys(variants):
        if not candidate_query:
            continue
        url = (
            f"{sync.ONEMAP}?searchVal={urllib.parse.quote(candidate_query)}"
            "&returnGeom=Y&getAddrDetails=Y&pageNum=1"
        )
        data, _ = sync.get_json(url, {"User-Agent": "Mozilla/5.0"})
        chosen = core.onemap_result_coordinate(query, data.get("results", []))
        if chosen:
            break
    _onemap_exact_cache[query] = chosen
    return chosen


def resolve_coordinate(row, address_map, project_map, allow_onemap=True):
    existing = core.coordinate_pair(row)
    if existing:
        return {
            "latitude": existing[0],
            "longitude": existing[1],
            "postal_code": row.get("postal_code"),
        }, "existing"
    address = core.normalize_address(row.get("address"))
    if address and address in address_map:
        return address_map[address], "exact_address"
    project = core.normalize_name(row.get("project_name"))
    if project and project != "N A" and project in project_map:
        return project_map[project], "exact_project"
    if allow_onemap and strip_unit(row.get("address")):
        chosen = lookup_onemap_exact(row.get("address"))
        if chosen:
            return chosen, "onemap_exact"
    return None, "unresolved"


def require_write_credentials(write, service_key):
    if write and not service_key:
        raise SystemExit("SUPABASE_KEY (service_role) not set — refusing to write.")


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
    ap.add_argument("--no-geocode", action="store_true", help="Skip OneMap; exact stored-coordinate reuse still runs.")
    args = ap.parse_args()
    dry = not args.write
    require_write_credentials(args.write, SERVICE_KEY)

    print(f"Mode: {'DRY RUN (no writes)' if dry else 'WRITE'} | project: {args.project or 'ALL'} | limit: {args.limit or 'none'}\n")

    pm_types = fetch_projects_master_types()
    print(f"projects_master types loaded   : {len(pm_types):,}")
    rows = fetch_realis_rows(project=args.project, limit=args.limit)
    print(f"realis rows in scope           : {len(rows):,}")
    need_geo = [r for r in rows if core.coordinate_pair(r) is None]
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

    address_coords, project_coords = fetch_trusted_coordinate_maps(need_geo)
    print(f"  trusted exact address mappings: {len(address_coords):,}")
    print(f"  trusted exact project mappings: {len(project_coords):,}")

    coordinates, coordinate_source_by_id, coordinate_sources = {}, {}, Counter()
    for i, row in enumerate(need_geo, 1):
        chosen, source = resolve_coordinate(
            row, address_coords, project_coords, allow_onemap=not args.no_geocode
        )
        coordinates[row["id"]] = chosen
        coordinate_source_by_id[row["id"]] = source
        coordinate_sources[source] += 1
        if source == "onemap_exact":
            time.sleep(sync.GEO_PACING_S)
        if i % 100 == 0:
            print(f"  coordinate resolution … {i}/{len(need_geo)}")
    print(f"  coordinate resolution by source: {dict(coordinate_sources)}")

    # ── Write ────────────────────────────────────────────────────────────────
    if not dry:
        updated = 0
        for r, nu, ns, why in resolvable:
            payload = {}
            if core.coordinate_pair(r) is None:
                chosen = coordinates.get(r["id"])
                if chosen:
                    payload["latitude"] = chosen["latitude"]
                    payload["longitude"] = chosen["longitude"]
                    if chosen.get("postal_code") and not r.get("postal_code"):
                        payload["postal_code"] = chosen["postal_code"]
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
        source = "existing" if core.coordinate_pair(r) else coordinate_source_by_id.get(r["id"], "unresolved")
        print(f"  {r['id']}: {r.get('unit_type')!r}/{r.get('property_subtype')!r} -> {nu!r}/{ns!r}  | {source}")


if __name__ == "__main__":
    main()
