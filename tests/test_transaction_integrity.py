import contextlib
import copy
import datetime as dt
import importlib.util
import io
import os
import pathlib
import sys
import unittest
from unittest import mock
from urllib.parse import parse_qs, urlparse


ROOT = pathlib.Path(__file__).resolve().parents[1]
SCRIPTS = ROOT / "scripts"
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))

from transaction_integrity import core
from transaction_integrity import reconcile_transactions as reconcile


BACKFILL_SPEC = importlib.util.spec_from_file_location(
    "backfill_realis", ROOT / "scripts" / "realis_backfill" / "backfill_realis.py"
)
backfill = importlib.util.module_from_spec(BACKFILL_SPEC)
BACKFILL_SPEC.loader.exec_module(backfill)


def hdb_source(**overrides):
    row = {
        "_id": 1,
        "month": "2025-11",
        "town": "BEDOK",
        "flat_type": "3 ROOM",
        "block": "40",
        "street_name": "BEDOK STH RD",
        "storey_range": "04 TO 06",
        "floor_area_sqm": "67.00",
        "flat_model": "New Generation",
        "lease_commence_date": "1978",
        "remaining_lease": "51 years 02 months",
        "resale_price": "400000",
    }
    row.update(overrides)
    return row


def hdb_db(**overrides):
    row = {
        "id": 1,
        "address": "40 BEDOK STH RD",
        "transaction_date": "2025-11-01",
        "transaction_price": 400000,
        "floor_area_sqm": 67,
        "unit_type": "3 ROOM",
        "floor_level": "04 TO 06",
        "completion_year": "1978",
        "latitude": 1.3200,
        "longitude": 103.9500,
        "postal_code": "460040",
    }
    row.update(overrides)
    return row


class HdbCanonicalTests(unittest.TestCase):
    def test_source_normalization_reuses_sync_contract(self):
        normalized = reconcile.normalize_hdb_source(hdb_source(floor_area_sqm="67.0"))
        self.assertEqual(normalized["address"], "40 BEDOK STH RD")
        self.assertEqual(normalized["transaction_date"], "2025-11-01")
        self.assertEqual(normalized["floor_area_sqm"], "67")
        self.assertEqual(normalized["lease_commence_date"], "1978")

    def test_exact_comparison(self):
        result = reconcile.reconcile_hdb_rows(
            [reconcile.normalize_hdb_source(hdb_source())],
            [reconcile.normalize_hdb_db(hdb_db())],
        )
        self.assertEqual(result["exact_matches"], 1)
        self.assertEqual(result["source_only"], 0)

    def test_source_only_and_database_only(self):
        source = reconcile.normalize_hdb_source(hdb_source())
        database = reconcile.normalize_hdb_db(hdb_db(address="41 BEDOK STH RD"))
        result = reconcile.reconcile_hdb_rows([source], [database])
        self.assertEqual(result["source_only"], 1)
        self.assertEqual(result["database_only"], 1)

    def test_changed_row_is_mismatch(self):
        source = reconcile.normalize_hdb_source(hdb_source())
        database = reconcile.normalize_hdb_db(hdb_db(floor_area_sqm=68))
        result = reconcile.reconcile_hdb_rows([source], [database])
        self.assertEqual(result["mismatched"], 1)
        self.assertEqual(result["source_only"], 0)

    def test_late_historical_divergence_is_detected(self):
        old = reconcile.normalize_hdb_source(hdb_source(month="2022-01"))
        result = reconcile.reconcile_hdb_rows([old], [])
        self.assertEqual(result["source_only"], 1)

    def test_legitimate_same_month_price_collision_is_not_collapsed(self):
        first = reconcile.normalize_hdb_source(hdb_source())
        second = reconcile.normalize_hdb_source(
            hdb_source(_id=2, storey_range="10 TO 12", floor_area_sqm="68")
        )
        audit = reconcile.audit_hdb_collisions([first, second])
        self.assertEqual(audit["distinct_authoritative_field_collision_groups"], 1)
        self.assertEqual(audit["distinct_authoritative_field_collision_excess_rows"], 1)
        self.assertFalse(audit["current_unique_key_can_represent_all_distinct_authoritative_rows"])

    def test_identical_public_fields_are_multiplicity_not_confirmed_duplicates(self):
        first = reconcile.normalize_hdb_source(hdb_source())
        second = copy.deepcopy(first)
        second["source_id"] = 2
        audit = reconcile.audit_hdb_collisions([first, second])
        self.assertEqual(audit["identical_public_field_multiplicity_groups"], 1)
        self.assertEqual(audit["identical_public_field_multiplicity_excess_rows"], 1)
        self.assertEqual(audit["distinct_authoritative_field_collision_groups"], 0)
        self.assertNotIn("exact_duplicate_groups", audit)

    def test_malformed_and_future_dates_are_safe(self):
        malformed = reconcile.normalize_hdb_source(hdb_source(month="not-a-month"))
        future = reconcile.normalize_hdb_source(hdb_source(month="2099-01"))
        self.assertIsNone(malformed["transaction_date"])
        self.assertGreater(future["transaction_date"], dt.date.today().isoformat())


class PaginationTests(unittest.TestCase):
    def test_official_pagination_is_complete(self):
        pages = {
            0: [{"_id": 1}, {"_id": 2}],
            2: [{"_id": 3}],
        }

        def requester(url):
            offset = int(parse_qs(urlparse(url).query)["offset"][0])
            return {"result": {"total": 3, "records": pages[offset]}}, {}

        rows, total, complete = reconcile.fetch_hdb_source(
            page_size=2, requester=requester, pace_s=0
        )
        self.assertEqual([row["_id"] for row in rows], [1, 2, 3])
        self.assertEqual(total, 3)
        self.assertTrue(complete)

    def test_empty_intermediate_page_fails(self):
        def requester(url):
            return {"result": {"total": 2, "records": []}}, {}

        with self.assertRaises(RuntimeError):
            reconcile.fetch_hdb_source(requester=requester, pace_s=0)

    def test_bounded_fetch_is_marked_partial(self):
        def requester(url):
            return {"result": {"total": 2, "records": [{"_id": 1}, {"_id": 2}]}}, {}

        rows, total, complete = reconcile.fetch_hdb_source(
            requester=requester, pace_s=0, max_rows=1
        )
        self.assertEqual(len(rows), 1)
        self.assertEqual(total, 2)
        self.assertFalse(complete)

    def test_incremental_month_fetch_delegates_to_shared_pagination(self):
        with mock.patch.object(reconcile.sync, "fetch_datagov_rows", return_value=[{"_id": 1}]) as fetch:
            rows = reconcile.sync.fetch_datagov_month("2026-08")
        self.assertEqual(rows, [{"_id": 1}])
        fetch.assert_called_once_with({"month": "2026-08"})

    def test_public_api_pacing_respects_current_quota(self):
        self.assertGreaterEqual(reconcile.sync.DATAGOV_PACING_S, 2.5)


class PrivateMappingTests(unittest.TestCase):
    def test_all_canonical_property_types_remain_distinct(self):
        inputs = {
            "Condominium": "Condominium",
            "Apartment": "Apartment",
            "EC": "Executive Condominium",
            "Terrace": "Terrace House",
            "Semi-Detached": "Semi-Detached House",
            "Detached": "Detached House",
        }
        self.assertEqual(
            {value: core.canonical_property_type(value) for value in inputs}, inputs
        )

    def test_activity_mapping(self):
        self.assertEqual(
            [core.canonical_activity(value) for value in ("New Sale", "Resale", "Sub Sale")],
            ["New Sale", "Resale", "Sub Sale"],
        )

    def test_malformed_new_sale_resolves_only_from_proven_project(self):
        row = {
            "unit_type": "New Sale",
            "property_subtype": None,
            "property_group": "private",
            "project_name": "AMO RESIDENCE",
            "is_strata": True,
        }
        result = core.resolve_classification(row, {"AMO RESIDENCE": "Condominium"})
        self.assertEqual(result[:2], ("Condominium", "New Sale"))
        self.assertEqual(result[3], "projects_master")

    def test_malformed_resale_without_evidence_stays_unresolved(self):
        row = {
            "unit_type": "Resale",
            "property_subtype": None,
            "property_group": "landed",
            "project_name": "N.A.",
            "is_strata": False,
        }
        ptype, activity, reason, source = core.resolve_classification(row, {})
        self.assertIsNone(ptype)
        self.assertEqual(activity, "Resale")
        self.assertIsNotNone(reason)
        self.assertIsNone(source)

    def test_valid_existing_type_wins(self):
        row = {"unit_type": "Executive Condominium", "property_subtype": "Resale"}
        self.assertEqual(
            core.resolve_classification(row, {})[:2],
            ("Executive Condominium", "Resale"),
        )

    def test_explicit_landed_subtypes_map_without_strata_inference(self):
        for group, expected in (
            ("Terrace House", "Terrace House"),
            ("Semi-Detached House", "Semi-Detached House"),
            ("Detached House", "Detached House"),
        ):
            row = {"unit_type": "Resale", "property_group": group, "is_strata": False}
            self.assertEqual(core.resolve_classification(row, {})[0], expected)

    def test_ambiguous_project_master_mapping_is_rejected(self):
        rows = [
            {"project_name": "SAME", "property_type": "Condominium"},
            {"project_name": "SAME", "property_type": "Apartment"},
        ]
        self.assertNotIn("SAME", core.collapse_project_types(rows))

    def test_source_transition_normalizes_html_and_punctuation(self):
        first = {
            "project_name": "A &amp; B Residences",
            "address": "1 Example &amp; Test Road, #01-01",
            "transaction_date": "2026-06-01",
            "transaction_price": 1000000,
            "floor_area_sqm": 90,
            "unit_type": "Condominium",
        }
        second = {
            **first,
            "project_name": "A & B RESIDENCES",
            "address": "1 EXAMPLE AND TEST RD # 01 / 01",
        }
        self.assertEqual(core.private_structural_key(first), core.private_structural_key(second))

    def test_private_transaction_identity_preserves_different_units(self):
        first = {"address": "1 Example Road #01-01", "transaction_date": "2026-06-01"}
        second = {"address": "1 Example Road #02-02", "transaction_date": "2026-06-01"}
        self.assertNotEqual(core.private_structural_key(first), core.private_structural_key(second))

    def test_geographic_address_normalization_still_strips_private_unit(self):
        self.assertEqual(
            core.normalize_address("1 Example Road #01-01"),
            core.normalize_address("1 EXAMPLE RD #02-02"),
        )

    def test_private_collision_coarse_key_preserves_unit_identity(self):
        rows = [
            {
                "address": "1 Example Road #01-01",
                "transaction_date": "2026-06-01",
                "transaction_price": 1000000,
            },
            {
                "address": "1 Example Road #02-02",
                "transaction_date": "2026-06-01",
                "transaction_price": 1000000,
            },
        ]
        audit = reconcile.audit_private_collisions(rows, {}, max_examples=8)
        self.assertEqual(audit["exact_duplicate_groups"], 0)
        self.assertEqual(audit["legitimate_distinct_groups"], 0)
        self.assertEqual(audit["source_representation_difference_groups"], 0)

    def test_handover_does_not_match_different_units(self):
        shared = {
            "project_name": "Example",
            "transaction_date": "2026-06-01",
            "transaction_price": 1000000,
            "floor_area_sqm": 90,
            "unit_type": "Condominium",
        }
        rows = [
            {**shared, "source": "ura_private", "address": "1 Example Road #01-01"},
            {**shared, "source": "realis", "address": "1 Example Road #02-02"},
        ]
        audit = reconcile.handover_audit(rows, {})
        self.assertEqual(audit["exact_canonical_cross_source_matches"], 0)
        self.assertEqual(audit["ura_only_internal_rows"], 1)
        self.assertEqual(audit["realis_only_internal_rows"], 1)

    def test_malformed_realis_date_coverage_assesses_later_valid_rows(self):
        rows = [
            {
                "id": 1,
                "address": "1 Example Road #01-01",
                "project_name": "Example",
                "transaction_date": "2026-06-01",
                "transaction_price": 1000000,
                "unit_type": "New Sale",
            },
            {
                "id": 2,
                "address": "1 Example Road #02-02",
                "project_name": "Example",
                "transaction_date": "2026-07-01",
                "transaction_price": 1100000,
                "unit_type": "Condominium",
            },
        ]
        audit = reconcile.audit_malformed_realis(rows, {}, {}, {}, max_examples=8)
        self.assertEqual(audit["earliest_malformed_transaction_date"], "2026-06-01")
        self.assertEqual(audit["latest_malformed_transaction_date"], "2026-06-01")
        self.assertEqual(audit["latest_valid_realis_transaction_date"], "2026-07-01")
        self.assertEqual(audit["valid_realis_rows_after_latest_malformed_date"], 1)
        self.assertEqual(audit["malformed_rows_after_latest_malformed_date"], 0)
        self.assertIn("Historical malformed population", audit["forward_writer_assessment"])
        self.assertNotIn("id", audit["examples"][0])
        self.assertNotIn("project_name", audit["examples"][0])

    def test_different_dates_never_fuzzy_deduplicate(self):
        first = {"address": "1 EXAMPLE RD", "transaction_date": "2026-06-01"}
        second = {"address": "1 EXAMPLE RD", "transaction_date": "2026-06-02"}
        self.assertNotEqual(core.private_structural_key(first), core.private_structural_key(second))


class CoordinateSafetyTests(unittest.TestCase):
    def test_existing_explicit_coordinates_win(self):
        row = {"latitude": 1.3, "longitude": 103.8, "address": "1 A RD"}
        chosen, source = backfill.resolve_coordinate(
            row,
            {"1 A RD": {"latitude": 1.4, "longitude": 103.9}},
            {},
            allow_onemap=False,
        )
        self.assertEqual(source, "existing")
        self.assertEqual((chosen["latitude"], chosen["longitude"]), (1.3, 103.8))

    def test_unambiguous_exact_coordinate_may_enrich(self):
        chosen = core.select_unambiguous_coordinate(
            [
                {"latitude": 1.3, "longitude": 103.8, "postal_code": "123456"},
                {"latitude": "1.300001", "longitude": "103.800001", "postal_code": "123456"},
            ]
        )
        self.assertIsNotNone(chosen)

    def test_ambiguous_coordinate_is_rejected(self):
        chosen = core.select_unambiguous_coordinate(
            [
                {"latitude": 1.3, "longitude": 103.8},
                {"latitude": 1.31, "longitude": 103.81},
            ]
        )
        self.assertIsNone(chosen)

    def test_onemap_never_accepts_fuzzy_first_hit(self):
        result = core.onemap_result_coordinate(
            "10 EXACT ROAD",
            [
                {
                    "BLK_NO": "11",
                    "ROAD_NAME": "EXACT ROAD",
                    "SEARCHVAL": "11 EXACT ROAD",
                    "LATITUDE": "1.3",
                    "LONGITUDE": "103.8",
                }
            ],
        )
        self.assertIsNone(result)

    def test_onemap_accepts_one_exact_match(self):
        result = core.onemap_result_coordinate(
            "10 EXACT ROAD",
            [
                {
                    "BLK_NO": "10",
                    "ROAD_NAME": "EXACT RD",
                    "SEARCHVAL": "10 EXACT ROAD",
                    "LATITUDE": "1.3",
                    "LONGITUDE": "103.8",
                    "POSTAL": "123456",
                }
            ],
        )
        self.assertEqual(result["postal_code"], "123456")

    def test_onemap_query_variants_expand_only_known_address_tokens(self):
        variants = core.onemap_query_variants("40 BEDOK STH RD #01-01")
        self.assertIn("40 BEDOK SOUTH ROAD", variants)
        self.assertNotIn("41 BEDOK SOUTH ROAD", variants)


class RegressionAndSafetyTests(unittest.TestCase):
    def test_bedok_source_gap_fixture(self):
        db = [reconcile.normalize_hdb_db(hdb_db(transaction_date="2025-09-01"))]
        result = reconcile.bedok_regression([], db)
        self.assertEqual(result["status"], "COMPLETE")
        self.assertIn("GENUINE_SOURCE_GAP", result["conclusion"])

    def test_bedok_missing_db_fixture(self):
        source = [reconcile.normalize_hdb_source(hdb_source(month="2025-11"))]
        coordinate_history = reconcile.normalize_hdb_db(hdb_db(transaction_date="2025-09-01"))
        result = reconcile.bedok_regression(source, [coordinate_history])
        self.assertEqual(result["official_source_only"], 1)
        self.assertIn("DATABASE_MISSING", result["conclusion"])

    def test_bedok_ignores_unresolved_out_of_town_source_rows(self):
        out_of_town = reconcile.normalize_hdb_source(
            hdb_source(month="2025-11", town="YISHUN", block="999", street_name="UNKNOWN RD")
        )
        coordinate_history = reconcile.normalize_hdb_db(hdb_db(transaction_date="2025-09-01"))
        result = reconcile.bedok_regression([out_of_town], [coordinate_history])
        self.assertEqual(result["status"], "COMPLETE")
        self.assertEqual(result["unresolved_candidate_addresses"], 0)
        self.assertIn("GENUINE_SOURCE_GAP", result["conclusion"])

    def test_bedok_source_only_fixture(self):
        source = [reconcile.normalize_hdb_source(hdb_source(month="2025-11"))]

        def lookup(address):
            return {"latitude": 1.32, "longitude": 103.95, "postal_code": None}

        result = reconcile.bedok_official_source_only(source, lookup)
        self.assertEqual(result["status"], "COMPLETE")
        self.assertEqual(result["official_qualifying_rows"], 1)
        self.assertEqual(result["conclusion"], "OFFICIAL_SOURCE_HAS_QUALIFYING_ROWS")

    def test_dry_run_is_backfill_default(self):
        with mock.patch.object(sys, "argv", ["backfill_realis.py"]), \
             mock.patch.object(backfill, "fetch_projects_master_types", return_value={}), \
             mock.patch.object(backfill, "fetch_realis_rows", return_value=[]), \
             mock.patch.object(backfill, "fetch_trusted_coordinate_maps", return_value=({}, {})), \
             mock.patch.object(backfill, "patch_row") as patch_row, \
             contextlib.redirect_stdout(io.StringIO()):
            backfill.main()
        patch_row.assert_not_called()

    def test_write_requires_explicit_service_role_credential(self):
        with self.assertRaises(SystemExit):
            backfill.require_write_credentials(True, "")
        backfill.require_write_credentials(False, "")

    def test_examples_are_bounded(self):
        rows = []
        for index in range(5):
            rows.extend(
                [
                    reconcile.normalize_hdb_source(
                        hdb_source(block=str(index), resale_price=str(400000 + index))
                    ),
                    reconcile.normalize_hdb_source(
                        hdb_source(
                            _id=100 + index,
                            block=str(index),
                            resale_price=str(400000 + index),
                            floor_area_sqm="68",
                        )
                    ),
                ]
            )
        audit = reconcile.audit_hdb_collisions(rows, max_examples=2)
        self.assertLessEqual(len(audit["examples"]), 2)

    def test_reconciliation_module_exposes_no_write_path(self):
        forbidden = {"upsert", "patch_row", "delete", "insert"}
        self.assertTrue(forbidden.isdisjoint(set(dir(reconcile))))

    def test_workflow_is_read_only_and_does_not_reference_credentials(self):
        workflow = (ROOT / ".github" / "workflows" / "transaction_integrity.yml").read_text()
        self.assertIn("--fail-on-divergence", workflow)
        self.assertIn("workflow_dispatch:", workflow)
        self.assertNotIn("\n  schedule:", workflow)
        self.assertNotIn("SUPABASE_KEY", workflow)
        self.assertNotIn("service_role", workflow)
        self.assertNotIn("--write", workflow)

    def test_no_schema_mutation_is_implemented(self):
        text = (ROOT / "scripts" / "transaction_integrity" / "reconcile_transactions.py").read_text().lower()
        for statement in ("drop index", "create index", "alter table", "delete from"):
            self.assertNotIn(statement, text)


if __name__ == "__main__":
    unittest.main()
