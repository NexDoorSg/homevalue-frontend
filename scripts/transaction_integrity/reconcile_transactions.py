#!/usr/bin/env python3
"""Read-only reconciliation for the shared residential transaction foundation.

The tool never sends POST/PATCH/DELETE requests.  HDB is compared with the
current official data.gov.sg dataset.  Private data receives internal integrity,
classification, coordinate and source-handover checks only because the upstream
REALIS/Cowork API contract and credentials are not owned by this repository.
"""

from __future__ import annotations

import argparse
import collections
import datetime as dt
import hashlib
import importlib.util
import json
import os
import sys
import urllib.parse

HERE = os.path.dirname(os.path.abspath(__file__))
SCRIPTS_DIR = os.path.dirname(HERE)
if SCRIPTS_DIR not in sys.path:
    sys.path.insert(0, SCRIPTS_DIR)

from transaction_integrity import core

_sync_spec = importlib.util.spec_from_file_location(
    "sync_hdb",
    os.path.join(SCRIPTS_DIR, "hdb_sync", "sync_hdb_datagov.py"),
)
sync = importlib.util.module_from_spec(_sync_spec)
_sync_spec.loader.exec_module(sync)


PAGE = 1000
PRIVATE_SOURCES = ("ura_private", "realis")
BEDOK_SUBJECT = "40 BEDOK SOUTH ROAD"
BEDOK_START = "2025-10-01"
BEDOK_END = "2026-04-30"
BEDOK_RADIUS_M = 300


def _coverage(rows, field="transaction_date"):
    values = sorted(
        value
        for row in rows
        if (value := core.canonical_date(row.get(field))) is not None
    )
    return {"start": values[0] if values else None, "end": values[-1] if values else None}


def _bounded(rows, limit):
    return rows[: max(0, limit)]


def _fingerprint(value):
    return hashlib.sha256(str(value or "").encode("utf-8")).hexdigest()[:12]


def fetch_supabase_rows(select, filters=None, order="id", page_size=PAGE, max_rows=0):
    """Read a complete PostgREST result set using Range pagination."""
    base = f"{sync.SUPABASE_URL}/rest/v1/{sync.TABLE}"
    rows, start = [], 0
    while True:
        params = {"select": select}
        if order:
            params["order"] = order
        params.update(filters or {})
        data, _ = sync.get_json(
            f"{base}?{urllib.parse.urlencode(params)}",
            {
                "apikey": sync.ANON_KEY,
                "Authorization": f"Bearer {sync.ANON_KEY}",
                "Range": f"{start}-{start + page_size - 1}",
            },
        )
        if not isinstance(data, list):
            raise RuntimeError("Supabase returned a non-list response")
        rows.extend(data)
        if max_rows and len(rows) >= max_rows:
            return rows[:max_rows], False
        if len(data) < page_size:
            return rows, True
        if not data:
            raise RuntimeError("Supabase pagination returned an empty intermediate page")
        start += len(data)


def count_supabase_rows(filters=None):
    base = f"{sync.SUPABASE_URL}/rest/v1/{sync.TABLE}"
    params = {"select": "id"}
    params.update(filters or {})
    _, headers = sync.get_json(
        f"{base}?{urllib.parse.urlencode(params)}",
        {
            "apikey": sync.ANON_KEY,
            "Authorization": f"Bearer {sync.ANON_KEY}",
            "Prefer": "count=exact",
            "Range": "0-0",
        },
    )
    content_range = headers.get("Content-Range") or headers.get("content-range") or ""
    try:
        return int(content_range.rsplit("/", 1)[1])
    except (IndexError, ValueError):
        raise RuntimeError("Supabase exact count was not returned")


def fetch_hdb_source(page_size=PAGE, max_rows=0, requester=None, pace_s=None):
    """Fetch the published official HDB dataset, detecting partial pagination."""
    requester = requester or sync.get_json
    pace_s = sync.DATAGOV_PACING_S if pace_s is None else pace_s
    rows, offset, expected = [], 0, None
    while True:
        params = {
            "resource_id": sync.OFFICIAL_DATASET_ID,
            "limit": page_size,
            "offset": offset,
        }
        data, _ = requester(f"{sync.DATAGOV}?{urllib.parse.urlencode(params)}")
        result = data.get("result", {})
        page = result.get("records", [])
        total = int(result.get("total", 0))
        if expected is None:
            expected = total
        elif total != expected:
            raise RuntimeError(f"official HDB total changed during pagination: {expected} -> {total}")
        rows.extend(page)
        offset += len(page)
        if max_rows and len(rows) >= max_rows:
            return rows[:max_rows], expected, False
        if offset >= total:
            if len(rows) != total:
                raise RuntimeError(f"official HDB result incomplete: {len(rows)}/{total}")
            return rows, total, True
        if not page:
            raise RuntimeError(f"official HDB pagination stopped at {offset}/{total}")
        if pace_s:
            import time

            time.sleep(pace_s)


def normalize_hdb_source(row):
    transformed = sync.transform(row)
    transaction_date = core.canonical_date(row.get("month"))
    return {
        "source_id": row.get("_id"),
        "town": core.normalize_name(row.get("town")),
        "address": core.normalize_address(transformed.get("address")),
        "transaction_date": transaction_date,
        "transaction_price": core.decimal_token(transformed.get("transaction_price")),
        "unit_type": core.normalize_name(transformed.get("unit_type")),
        "floor_level": core.normalize_name(transformed.get("floor_level")),
        "floor_area_sqm": core.decimal_token(transformed.get("floor_area_sqm")),
        "flat_model": core.normalize_name(row.get("flat_model")),
        "lease_commence_date": core.normalize_name(row.get("lease_commence_date")),
        "remaining_lease": core.normalize_name(row.get("remaining_lease")),
    }


def normalize_hdb_db(row):
    return {
        "id": row.get("id"),
        "address": core.normalize_address(row.get("address")),
        "transaction_date": core.canonical_date(row.get("transaction_date")),
        "transaction_price": core.decimal_token(row.get("transaction_price")),
        "unit_type": core.normalize_name(row.get("unit_type")),
        "floor_level": core.normalize_name(row.get("floor_level")),
        "floor_area_sqm": core.decimal_token(row.get("floor_area_sqm")),
        "lease_commence_date": core.normalize_name(row.get("completion_year")),
        "latitude": row.get("latitude"),
        "longitude": row.get("longitude"),
        "postal_code": row.get("postal_code"),
    }


def hdb_conflict_key(row):
    return row.get("address"), row.get("transaction_date"), row.get("transaction_price")


def hdb_comparison_key(row):
    return (
        *hdb_conflict_key(row),
        row.get("unit_type"),
        row.get("floor_level"),
        row.get("floor_area_sqm"),
        row.get("lease_commence_date"),
    )


def hdb_source_identity(row):
    return (
        *hdb_comparison_key(row),
        row.get("town"),
        row.get("flat_model"),
        row.get("remaining_lease"),
    )


def audit_hdb_collisions(source_rows, max_examples=8):
    grouped = collections.defaultdict(list)
    for row in source_rows:
        grouped[hdb_conflict_key(row)].append(row)
    identical_public_groups, distinct_authoritative_groups = [], []
    for key, rows in grouped.items():
        if len(rows) < 2:
            continue
        identities = {hdb_source_identity(row) for row in rows}
        target = (
            identical_public_groups
            if len(identities) == 1
            else distinct_authoritative_groups
        )
        target.append((key, rows))

    def examples(groups):
        out = []
        for key, rows in groups[:max_examples]:
            out.append(
                {
                    "address_fingerprint": _fingerprint(key[0]),
                    "transaction_date": key[1],
                    "transaction_price": key[2],
                    "record_count": len(rows),
                    "public_field_records": _bounded(
                        [
                            {
                                "flat_type": row.get("unit_type"),
                                "storey_range": row.get("floor_level"),
                                "floor_area_sqm": row.get("floor_area_sqm"),
                                "flat_model": row.get("flat_model"),
                                "lease_commence_date": row.get("lease_commence_date"),
                                "remaining_lease": row.get("remaining_lease"),
                            }
                            for row in rows
                        ],
                        4,
                    ),
                }
            )
        return out

    return {
        "coarse_unique_key_count": len(grouped),
        "identical_public_field_multiplicity_groups": len(identical_public_groups),
        "identical_public_field_multiplicity_rows": sum(
            len(rows) for _, rows in identical_public_groups
        ),
        "identical_public_field_multiplicity_excess_rows": sum(
            len(rows) - 1 for _, rows in identical_public_groups
        ),
        "distinct_authoritative_field_collision_groups": len(distinct_authoritative_groups),
        "distinct_authoritative_field_collision_rows": sum(
            len(rows) for _, rows in distinct_authoritative_groups
        ),
        "distinct_authoritative_field_collision_excess_rows": sum(
            len(rows) - 1 for _, rows in distinct_authoritative_groups
        ),
        "current_unique_key_can_represent_all_distinct_authoritative_rows": not distinct_authoritative_groups,
        "examples": examples(distinct_authoritative_groups or identical_public_groups),
    }


def reconcile_hdb_rows(source_rows, db_rows, max_examples=8):
    source_by_anchor, db_by_anchor = collections.defaultdict(list), collections.defaultdict(list)
    for row in source_rows:
        source_by_anchor[hdb_conflict_key(row)].append(row)
    for row in db_rows:
        db_by_anchor[hdb_conflict_key(row)].append(row)

    exact = mismatch = source_only = database_only = 0
    mismatch_examples, source_examples, database_examples = [], [], []
    for anchor in sorted(set(source_by_anchor) | set(db_by_anchor), key=repr):
        source_group = source_by_anchor.get(anchor, [])
        db_group = db_by_anchor.get(anchor, [])
        source_counts = collections.Counter(hdb_comparison_key(row) for row in source_group)
        db_counts = collections.Counter(hdb_comparison_key(row) for row in db_group)
        matched_here = sum((source_counts & db_counts).values())
        exact += matched_here

        source_left = list((source_counts - db_counts).elements())
        db_left = list((db_counts - source_counts).elements())
        changed_here = min(len(source_left), len(db_left))
        mismatch += changed_here
        source_only += len(source_left) - changed_here
        database_only += len(db_left) - changed_here

        if changed_here and len(mismatch_examples) < max_examples:
            mismatch_examples.append(
                {
                    "address_fingerprint": _fingerprint(anchor[0]),
                    "transaction_date": anchor[1],
                    "transaction_price": anchor[2],
                    "source_shape": source_left[0][3:],
                    "database_shape": db_left[0][3:],
                }
            )
        if len(source_left) > changed_here and len(source_examples) < max_examples:
            source_examples.append(
                {"address_fingerprint": _fingerprint(anchor[0]), "transaction_date": anchor[1], "transaction_price": anchor[2]}
            )
        if len(db_left) > changed_here and len(database_examples) < max_examples:
            database_examples.append(
                {"address_fingerprint": _fingerprint(anchor[0]), "transaction_date": anchor[1], "transaction_price": anchor[2]}
            )

    return {
        "exact_matches": exact,
        "source_only": source_only,
        "database_only": database_only,
        "mismatched": mismatch,
        "examples": {
            "source_only": source_examples,
            "database_only": database_examples,
            "mismatched": mismatch_examples,
        },
    }


def coordinate_completeness(rows):
    missing_lat = sum(row.get("latitude") is None for row in rows)
    missing_lon = sum(row.get("longitude") is None for row in rows)
    return {
        "total": len(rows),
        "missing_latitude": missing_lat,
        "missing_longitude": missing_lon,
        "missing_either_coordinate": sum(core.coordinate_pair(row) is None for row in rows),
    }


def _unambiguous_coordinate_index(rows, key_fn):
    grouped = collections.defaultdict(list)
    for row in rows:
        key = key_fn(row)
        if key and core.coordinate_pair(row):
            grouped[key].append(row)
    return {
        key: chosen
        for key, values in grouped.items()
        if (chosen := core.select_unambiguous_coordinate(values)) is not None
    }


def bedok_regression(source_rows, db_rows):
    address_coords = _unambiguous_coordinate_index(
        db_rows, lambda row: core.normalize_address(row.get("address"))
    )
    subject = address_coords.get(core.normalize_address(BEDOK_SUBJECT))
    if not subject:
        return {
            "status": "INCONCLUSIVE",
            "conclusion": "Subject coordinates were unavailable from exact stored HDB evidence.",
        }

    def in_period_and_type(row):
        date_value = row.get("transaction_date")
        return BEDOK_START <= (date_value or "") <= BEDOK_END and row.get("unit_type") == "3 ROOM"

    qualifying_source, unresolved_addresses = [], set()
    for row in source_rows:
        if not in_period_and_type(row) or row.get("town") != "BEDOK":
            continue
        coordinates = address_coords.get(row.get("address"))
        if not coordinates:
            unresolved_addresses.add(row.get("address"))
            continue
        distance = core.haversine_m(
            subject["latitude"], subject["longitude"], coordinates["latitude"], coordinates["longitude"]
        )
        if distance <= BEDOK_RADIUS_M:
            qualifying_source.append(row)

    qualifying_db = []
    for row in db_rows:
        if not in_period_and_type(row):
            continue
        pair = core.coordinate_pair(row)
        if pair and core.haversine_m(subject["latitude"], subject["longitude"], pair[0], pair[1]) <= BEDOK_RADIUS_M:
            qualifying_db.append(row)

    source_counts = collections.Counter(hdb_comparison_key(row) for row in qualifying_source)
    db_counts = collections.Counter(hdb_comparison_key(row) for row in qualifying_db)
    source_only = sum((source_counts - db_counts).values())
    exact = sum((source_counts & db_counts).values())
    if unresolved_addresses:
        status = "PARTIAL"
        conclusion = "Nearby official rows could not all be placed from exact stored coordinate evidence."
    elif not qualifying_source:
        status = "COMPLETE"
        conclusion = "GENUINE_SOURCE_GAP: no qualifying official 3 ROOM transaction exists in Oct 2025-Apr 2026."
    elif source_only:
        status = "COMPLETE"
        conclusion = "DATABASE_MISSING_AUTHORITATIVE_ROWS: qualifying official rows are absent from Supabase."
    else:
        status = "COMPLETE"
        conclusion = "OFFICIAL_ROWS_PRESENT_IN_DATABASE: the apparent gap is not caused by missing canonical HDB rows."
    return {
        "status": status,
        "subject": BEDOK_SUBJECT,
        "radius_m": BEDOK_RADIUS_M,
        "period": {"start": BEDOK_START, "end": BEDOK_END},
        "official_qualifying_rows": len(qualifying_source),
        "database_qualifying_rows": len(qualifying_db),
        "exact_matches": exact,
        "official_source_only": source_only,
        "unresolved_candidate_addresses": len(unresolved_addresses),
        "conclusion": conclusion,
    }


def bedok_official_source_only(source_rows, coordinate_lookup, max_examples=8):
    """Place the Bedok official subset without consulting transaction storage."""
    subject = coordinate_lookup(BEDOK_SUBJECT)
    if not subject:
        return {
            "status": "FAILED",
            "conclusion": "The subject address did not resolve through exact OneMap evidence.",
        }
    candidates = [
        row
        for row in source_rows
        if BEDOK_START <= (row.get("transaction_date") or "") <= BEDOK_END
        and row.get("unit_type") == "3 ROOM"
        and row.get("town") == "BEDOK"
    ]
    coordinates, unresolved = {}, []
    for address in sorted({row.get("address") for row in candidates if row.get("address")}):
        chosen = coordinate_lookup(address)
        if chosen:
            coordinates[address] = chosen
        else:
            unresolved.append(address)
    qualifying = []
    for row in candidates:
        chosen = coordinates.get(row.get("address"))
        if not chosen:
            continue
        distance = core.haversine_m(
            subject["latitude"], subject["longitude"], chosen["latitude"], chosen["longitude"]
        )
        if distance <= BEDOK_RADIUS_M:
            qualifying.append({**row, "distance_m": round(distance, 1)})
    status = "COMPLETE" if not unresolved else "PARTIAL"
    if qualifying:
        conclusion = "OFFICIAL_SOURCE_HAS_QUALIFYING_ROWS"
    elif unresolved:
        conclusion = "INCONCLUSIVE_WITH_UNRESOLVED_ADDRESSES"
    else:
        conclusion = "GENUINE_SOURCE_GAP"
    return {
        "status": status,
        "subject": BEDOK_SUBJECT,
        "radius_m": BEDOK_RADIUS_M,
        "period": {"start": BEDOK_START, "end": BEDOK_END},
        "official_bedok_3_room_rows_considered": len(candidates),
        "unique_addresses_resolved": len(coordinates),
        "unique_addresses_unresolved": len(unresolved),
        "official_qualifying_rows": len(qualifying),
        "examples": _bounded(
            [
                {
                    "source_id": row.get("source_id"),
                    "transaction_date": row.get("transaction_date"),
                    "transaction_price": row.get("transaction_price"),
                    "distance_m": row.get("distance_m"),
                }
                for row in qualifying
            ],
            max_examples,
        ),
        "conclusion": conclusion,
        "database_comparison": "NOT RUN — production read-only access was not approved in this environment",
    }


def run_hdb_reconciliation(max_examples=8, max_rows=0):
    raw_source, advertised_total, source_complete = fetch_hdb_source(max_rows=max_rows)
    source_rows = [normalize_hdb_source(row) for row in raw_source]
    raw_db, db_complete = fetch_supabase_rows(
        "id,address,transaction_date,transaction_price,floor_area_sqm,unit_type,floor_level,completion_year,latitude,longitude,postal_code",
        {"source": "eq.data_gov_hdb"},
        max_rows=max_rows,
    )
    db_rows = [normalize_hdb_db(row) for row in raw_db]
    invalid_source = [row for row in source_rows if row.get("transaction_date") is None]
    invalid_db = [row for row in db_rows if row.get("transaction_date") is None]
    today = dt.date.today().isoformat()
    future_source = [row for row in source_rows if (row.get("transaction_date") or "") > today]
    comparison = reconcile_hdb_rows(
        [row for row in source_rows if row.get("transaction_date")],
        [row for row in db_rows if row.get("transaction_date")],
        max_examples=max_examples,
    )
    collisions = audit_hdb_collisions(source_rows, max_examples=max_examples)
    complete = source_complete and db_complete and not invalid_source and not invalid_db
    return {
        "status": "COMPLETE" if complete else "PARTIAL",
        "read_only": True,
        "authoritative_source": "HDB resale flat prices based on registration date from Jan-2017 onwards (data.gov.sg)",
        "dataset_id": sync.OFFICIAL_DATASET_ID,
        "legacy_writer_resource_id": sync.LEGACY_RESOURCE_ID,
        "legacy_identifier_status": "retained live alias; writer contract unchanged",
        "source_coverage": _coverage(source_rows),
        "authoritative_advertised_count": advertised_total,
        "authoritative_rows_fetched": len(source_rows),
        "database_coverage": _coverage(db_rows),
        "database_canonical_count": len(db_rows),
        **comparison,
        "unique_key_collision_audit": collisions,
        "coordinate_completeness": coordinate_completeness(db_rows),
        "malformed_source_dates": len(invalid_source),
        "malformed_database_dates": len(invalid_db),
        "future_source_dates": len(future_source),
        "bedok_regression": bedok_regression(source_rows, db_rows),
        "coverage_note": (
            "Full Jan-2017 onward official dataset checked."
            if complete
            else "A bounded or malformed-row condition made this check partial."
        ),
    }


def private_coordinate_audit(rows):
    address_index = _unambiguous_coordinate_index(
        rows, lambda row: core.normalize_address(row.get("address"))
    )
    project_index = _unambiguous_coordinate_index(
        rows, lambda row: core.normalize_name(row.get("project_name"))
    )
    report = {}
    for source in PRIVATE_SOURCES:
        report[source] = {}
        for ptype in core.PROPERTY_TYPES:
            scoped = [
                row for row in rows
                if row.get("source") == source and core.canonical_property_type(row.get("unit_type")) == ptype
            ]
            missing = [row for row in scoped if core.coordinate_pair(row) is None]
            exact_address = exact_project = potential_onemap = unresolved = 0
            for row in missing:
                address = core.normalize_address(row.get("address"))
                project = core.normalize_name(row.get("project_name"))
                if address and address in address_index:
                    exact_address += 1
                elif project and project != "N A" and project in project_index:
                    exact_project += 1
                elif address:
                    potential_onemap += 1
                else:
                    unresolved += 1
            report[source][ptype] = {
                **coordinate_completeness(scoped),
                "resolvable_exact_existing_address": exact_address,
                "resolvable_trusted_exact_project": exact_project,
                "potentially_onemap_resolvable_not_attempted": potential_onemap,
                "unresolved_without_exact_address": unresolved,
            }
    return report, address_index, project_index


def audit_malformed_realis(rows, project_types, address_index, project_index, max_examples):
    malformed = [row for row in rows if core.canonical_activity(row.get("unit_type"))]
    valid = [row for row in rows if core.canonical_property_type(row.get("unit_type"))]
    by_activity = collections.Counter(core.canonical_activity(row.get("unit_type")) for row in malformed)
    malformed_dates = [
        date_value
        for row in malformed
        if (date_value := core.canonical_date(row.get("transaction_date")))
    ]
    valid_dates = [
        date_value
        for row in valid
        if (date_value := core.canonical_date(row.get("transaction_date")))
    ]
    earliest_malformed = min(malformed_dates, default=None)
    latest_malformed = max(malformed_dates, default=None)
    latest_valid = max(valid_dates, default=None)
    valid_after_latest_malformed = (
        sum(date_value > latest_malformed for date_value in valid_dates)
        if latest_malformed
        else 0
    )
    malformed_after_latest_malformed = (
        sum(date_value > latest_malformed for date_value in malformed_dates)
        if latest_malformed
        else 0
    )
    if not malformed:
        forward_writer_assessment = "No malformed REALIS rows were observed."
    elif latest_valid and latest_malformed and latest_valid > latest_malformed:
        forward_writer_assessment = (
            "Historical malformed population: later valid REALIS rows exist and no malformed "
            "row occurs after the observed latest malformed transaction date. Current dates do "
            "not prove that forward ingestion is still broken."
        )
    else:
        forward_writer_assessment = (
            "INCONCLUSIVE: malformed rows reach the latest observed REALIS date boundary, so "
            "current dates do not prove that forward ingestion is fixed."
        )
    resolvable = unresolved = coord_address = coord_project = coord_potential = coord_unresolved = 0
    examples = []
    for row in malformed:
        ptype, activity, reason, source = core.resolve_classification(row, project_types)
        if reason:
            unresolved += 1
        else:
            resolvable += 1
        if core.coordinate_pair(row):
            pass
        else:
            address = core.normalize_address(row.get("address"))
            project = core.normalize_name(row.get("project_name"))
            if address and address in address_index:
                coord_address += 1
            elif project and project != "N A" and project in project_index:
                coord_project += 1
            elif address:
                coord_potential += 1
            else:
                coord_unresolved += 1
        if len(examples) < max_examples:
            examples.append(
                {
                    "row_fingerprint": _fingerprint(
                        "|".join(
                            str(row.get(field) or "")
                            for field in (
                                "id", "address", "project_name", "transaction_date",
                                "transaction_price",
                            )
                        )
                    ),
                    "project_fingerprint": _fingerprint(row.get("project_name")),
                    "malformed_unit_type": row.get("unit_type"),
                    "resolved_property_type": ptype,
                    "resolved_activity": activity,
                    "classification_evidence": source,
                    "unresolved_reason": reason,
                    "missing_coordinate": core.coordinate_pair(row) is None,
                }
            )
    return {
        "total": len(malformed),
        "by_activity": {activity: by_activity.get(activity, 0) for activity in core.TRANSACTION_ACTIVITIES},
        "earliest_malformed_transaction_date": earliest_malformed,
        "latest_malformed_transaction_date": latest_malformed,
        "malformed_rows_with_invalid_date": len(malformed) - len(malformed_dates),
        "malformed_rows_after_latest_malformed_date": malformed_after_latest_malformed,
        "latest_valid_realis_transaction_date": latest_valid,
        "valid_realis_rows_after_latest_malformed_date": valid_after_latest_malformed,
        "forward_writer_assessment": forward_writer_assessment,
        "resolvable_classification": resolvable,
        "unresolved_classification": unresolved,
        "coordinate_resolvable_exact_address": coord_address,
        "coordinate_resolvable_exact_project": coord_project,
        "coordinate_potential_onemap_not_attempted": coord_potential,
        "coordinate_unresolved_without_address": coord_unresolved,
        "examples": examples,
    }


def audit_private_collisions(rows, project_types, max_examples):
    groups = collections.defaultdict(list)
    for row in rows:
        coarse = (
            core.normalize_transaction_address(row.get("address")),
            core.canonical_date(row.get("transaction_date")),
            core.decimal_token(row.get("transaction_price")),
        )
        groups[coarse].append(row)
    exact = legitimate = representation = unclear = 0
    examples = []
    for key, group in groups.items():
        if len(group) < 2:
            continue
        structural = {core.private_structural_key(row, project_types) for row in group}
        raw = {
            (
                row.get("address"), row.get("project_name"), row.get("transaction_date"),
                row.get("transaction_price"), row.get("floor_area_sqm"), row.get("unit_type"),
                row.get("property_subtype"),
            )
            for row in group
        }
        if len(raw) == 1:
            category = "exact_duplicate"
            exact += 1
        elif len(structural) == 1:
            category = "source_representation_difference"
            representation += 1
        elif any(key_part is None or key_part == "" for key_part in key):
            category = "unclear"
            unclear += 1
        else:
            category = "legitimate_distinct"
            legitimate += 1
        if len(examples) < max_examples:
            examples.append(
                {
                    "category": category,
                    "address_fingerprint": _fingerprint(key[0]),
                    "transaction_date": key[1],
                    "transaction_price": key[2],
                    "row_count": len(group),
                    "sources": sorted({row.get("source") for row in group}),
                }
            )
    return {
        "exact_duplicate_groups": exact,
        "legitimate_distinct_groups": legitimate,
        "source_representation_difference_groups": representation,
        "unclear_groups": unclear,
        "examples": examples,
        "schema_action": "none performed; authoritative private source is unavailable",
    }


def handover_audit(rows, project_types, start="2026-05-01"):
    scoped = [row for row in rows if (core.canonical_date(row.get("transaction_date")) or "") >= start]
    ura = [row for row in scoped if row.get("source") == "ura_private"]
    realis = [row for row in scoped if row.get("source") == "realis"]
    ura_counts = collections.Counter(core.private_structural_key(row, project_types) for row in ura)
    realis_counts = collections.Counter(core.private_structural_key(row, project_types) for row in realis)
    return {
        "audit_start": start,
        "date_semantics": "exact transaction_date only; different dates are never fuzzy-deduplicated",
        "ura_private": {"count": len(ura), "coverage": _coverage(ura)},
        "realis": {"count": len(realis), "coverage": _coverage(realis)},
        "exact_canonical_cross_source_matches": sum((ura_counts & realis_counts).values()),
        "ura_only_internal_rows": sum((ura_counts - realis_counts).values()),
        "realis_only_internal_rows": sum((realis_counts - ura_counts).values()),
        "interpretation": (
            "Internal overlap only. A non-match does not prove a source gap because the external "
            "REALIS publication/date contract is not present in this repository."
        ),
    }


def representative_private_cases(rows):
    cases = {
        "high_volume_amo": lambda row: "AMO" in core.normalize_name(row.get("project_name")),
        "sparse_balmoral": lambda row: "BALMORAL" in (
            core.normalize_name(row.get("project_name")) + " " + core.normalize_address(row.get("address"))
        ),
        "landed_goldhill_barker": lambda row: any(
            token in (core.normalize_name(row.get("project_name")) + " " + core.normalize_address(row.get("address")))
            for token in ("GOLDHILL", "BARKER")
        ),
        "new_launch_malformed": lambda row: core.canonical_activity(row.get("unit_type")) == "New Sale",
    }
    report = {}
    for name, predicate in cases.items():
        scoped = [row for row in rows if predicate(row)]
        report[name] = {
            "stored_rows": len(scoped),
            "usable_classification": sum(core.canonical_property_type(row.get("unit_type")) is not None for row in scoped),
            "usable_coordinates": sum(core.coordinate_pair(row) is not None for row in scoped),
            "status": "INTERNAL ONLY — NOT AUTHORITATIVELY VERIFIED",
        }
    return report


def run_private_integrity(max_examples=8, private_since=None, max_rows=0):
    if private_since is None:
        today = dt.date.today()
        try:
            private_since = today.replace(year=today.year - 5).isoformat()
        except ValueError:
            private_since = today.replace(year=today.year - 5, day=28).isoformat()
    recent_rows, complete = fetch_supabase_rows(
        "id,address,project_name,transaction_date,transaction_price,floor_area_sqm,unit_type,property_subtype,property_group,source,latitude,longitude,postal_code,is_strata",
        {
            "source": "in.(ura_private,realis)",
            "transaction_date": f"gte.{private_since}",
        },
        max_rows=max_rows,
    )

    project_base = f"{sync.SUPABASE_URL}/rest/v1/projects_master"
    project_rows = []
    start = 0
    while True:
        data, _ = sync.get_json(
            f"{project_base}?{urllib.parse.urlencode({'select': 'project_name,property_type', 'order': 'project_name'})}",
            {
                "apikey": sync.ANON_KEY,
                "Authorization": f"Bearer {sync.ANON_KEY}",
                "Range": f"{start}-{start + PAGE - 1}",
            },
        )
        project_rows.extend(data)
        if len(data) < PAGE:
            break
        start += len(data)
    project_types = core.collapse_project_types(project_rows)

    coordinates, address_index, project_index = private_coordinate_audit(recent_rows)
    realis_rows = [row for row in recent_rows if row.get("source") == "realis"]
    all_time_counts = {}
    for source in PRIVATE_SOURCES:
        all_time_counts[source] = {}
        for ptype in core.PROPERTY_TYPES:
            all_time_counts[source][ptype] = count_supabase_rows(
                {"source": f"eq.{source}", "unit_type": f"eq.{ptype}"}
            )

    return {
        "status": "NOT VERIFIED",
        "read_only": True,
        "authoritative_source": None,
        "authoritative_coverage": None,
        "reason": (
            "PRIVATE AUTHORITATIVE RECONCILIATION: NOT VERIFIED. This repository contains no "
            "upstream REALIS/Cowork ingestion client, source credential contract, or authoritative "
            "private transaction export; it contains repair tooling only."
        ),
        "internal_audit_complete": complete,
        "recent_integrity_period": {"start": private_since, "end": _coverage(recent_rows)["end"]},
        "recent_internal_rows": len(recent_rows),
        "all_time_stored_counts": all_time_counts,
        "coordinate_completeness": coordinates,
        "malformed_realis": audit_malformed_realis(
            realis_rows, project_types, address_index, project_index, max_examples
        ),
        "ura_private_to_realis_handover": handover_audit(recent_rows, project_types),
        "internal_unique_key_collision_audit": audit_private_collisions(
            recent_rows, project_types, max_examples
        ),
        "representative_cases": representative_private_cases(recent_rows),
        "source_ownership": {
            "ura_private": "No loader found in this repository; historical origin is external/unrecorded here.",
            "realis": "Weekly REALIS/Cowork writer is external to this repository; only backfill_realis.py is repo-owned.",
            "required_follow_up": (
                "Use the malformed-date audit to verify the external writer's current mapping and "
                "coordinate behavior; change that external writer only if current evidence shows "
                "recurrence. Do not treat this repository's backfill as a forward-ingestion fix."
            ),
        },
    }


def source_ownership_map():
    return {
        "hdb": {
            "source": "Official public data.gov.sg HDB resale dataset",
            "ingestion": "scripts/hdb_sync/sync_hdb_datagov.py",
            "workflow": ".github/workflows/hdb_sync.yml",
            "schedule": "weekly Friday 02:00 UTC; current + previous calendar month",
            "pagination": "offset/limit with advertised-total validation",
            "authentication": "none for data.gov.sg; service role required only for writer",
            "deduplication": "new-row 5-field dedup; database conflict key address/date/price",
            "coordinates": "exact stored reuse then OneMap",
            "retry_alerting": "HTTP exponential retries plus workflow retry, summary annotation and optional email",
        },
        "private": {
            "ura_private": "No ingestion implementation or authoritative contract found in this repository.",
            "realis": "Upstream weekly REALIS/Cowork writer not found; repo owns dry-run-first repair tooling only.",
        },
    }


def markdown_summary(report):
    lines = ["# Residential transaction integrity", "", "Read-only reconciliation; no production writes performed.", ""]
    hdb = report.get("hdb")
    if hdb:
        collision = hdb["unique_key_collision_audit"]
        lines.extend(
            [
                "## HDB",
                "",
                f"- Status: **{hdb['status']}**",
                f"- Source / DB rows: {hdb['authoritative_rows_fetched']:,} / {hdb['database_canonical_count']:,}",
                f"- Exact / source-only / DB-only / mismatch: {hdb['exact_matches']:,} / {hdb['source_only']:,} / {hdb['database_only']:,} / {hdb['mismatched']:,}",
                f"- Identical-public-field multiplicity groups: {collision['identical_public_field_multiplicity_groups']:,}",
                f"- Distinct-authoritative-field collision groups: {collision['distinct_authoritative_field_collision_groups']:,}",
                f"- Missing either coordinate: {hdb['coordinate_completeness']['missing_either_coordinate']:,}",
                f"- Bedok: {hdb['bedok_regression']['conclusion']}",
                "",
            ]
        )
    private = report.get("private")
    if private:
        malformed = private["malformed_realis"]
        lines.extend(
            [
                "## Private / EC / landed",
                "",
                f"- Status: **{private['status']}**",
                f"- Recent internal rows checked: {private['recent_internal_rows']:,}",
                f"- Malformed REALIS rows: {malformed['total']:,} (resolvable {malformed['resolvable_classification']:,}; unresolved {malformed['unresolved_classification']:,})",
                f"- Malformed REALIS date range: {malformed['earliest_malformed_transaction_date']} through {malformed['latest_malformed_transaction_date']}",
                f"- Latest valid REALIS transaction date: {malformed['latest_valid_realis_transaction_date']}",
                f"- Forward-writer evidence: {malformed['forward_writer_assessment']}",
                "- Authoritative private comparison is unavailable because its external source contract is not in this repository.",
                "",
            ]
        )
    if report.get("stop_conditions"):
        lines.extend(["## Stop conditions", ""])
        lines.extend(f"- {condition}" for condition in report["stop_conditions"])
        lines.append("")
    return "\n".join(lines)


def divergence_found(report):
    hdb = report.get("hdb") or {}
    private = report.get("private") or {}
    return bool(
        hdb.get("source_only")
        or hdb.get("database_only")
        or hdb.get("mismatched")
        or (hdb.get("unique_key_collision_audit") or {}).get("distinct_authoritative_field_collision_groups")
        or (private.get("malformed_realis") or {}).get("total")
    )


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--skip-hdb", action="store_true")
    parser.add_argument("--skip-private", action="store_true")
    parser.add_argument("--private-since", default=None, help="Recent coordinate audit start date (default: trailing 5 years).")
    parser.add_argument("--max-rows", type=int, default=0, help="Bound each large fetch; marks results partial (0 = complete).")
    parser.add_argument("--max-examples", type=int, default=8)
    parser.add_argument("--output", default=None, help="Write the aggregate JSON report to this path.")
    parser.add_argument("--markdown-output", default=None, help="Write a bounded Markdown summary to this path.")
    parser.add_argument("--fail-on-divergence", action="store_true")
    args = parser.parse_args(argv)

    report = {
        "generated_at": dt.datetime.now(dt.timezone.utc).isoformat(),
        "mode": "READ ONLY",
        "source_ownership": source_ownership_map(),
    }
    if not args.skip_hdb:
        report["hdb"] = run_hdb_reconciliation(args.max_examples, args.max_rows)
    if not args.skip_private:
        report["private"] = run_private_integrity(
            args.max_examples, args.private_since, args.max_rows
        )

    stop_conditions = []
    hdb = report.get("hdb") or {}
    collision_count = (hdb.get("unique_key_collision_audit") or {}).get(
        "distinct_authoritative_field_collision_groups", 0
    )
    if collision_count:
        stop_conditions.append(
            "STOP CONDITION A/B: distinct-authoritative-field HDB collisions cannot all coexist under the current unique key; no index or schema change was made."
        )
    report["stop_conditions"] = stop_conditions
    report["production_mutated"] = False
    report["complete_overall"] = (
        report.get("hdb", {}).get("status") == "COMPLETE"
        and report.get("private", {}).get("status") != "NOT VERIFIED"
    )

    rendered_json = json.dumps(report, indent=2, sort_keys=True)
    rendered_markdown = markdown_summary(report)
    if args.output:
        with open(args.output, "w", encoding="utf-8") as handle:
            handle.write(rendered_json + "\n")
    if args.markdown_output:
        with open(args.markdown_output, "w", encoding="utf-8") as handle:
            handle.write(rendered_markdown + "\n")
    print(rendered_markdown)
    if args.fail_on_divergence and divergence_found(report):
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
