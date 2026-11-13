import pathlib
import sys
import unittest
from unittest import mock

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / "scripts" / "hdb_sync"))
import sync_hdb_rentals as rental
import sync_hdb_datagov as resale


def source(source_id=1, month="2026-10", **changes):
    return {"_id": source_id, "rent_approval_date": month, "town": "BEDOK",
            "block": "40", "street_name": "BEDOK STH RD", "flat_type": "3-ROOM",
            "monthly_rent": "3000", **changes}


class RentalSafeguards(unittest.TestCase):
    def test_transform_preserves_official_fields(self):
        row = rental.transform(source())
        self.assertEqual((row["source_id"], row["approval_date"], row["monthly_rent"]), (1, "2026-10-01", 3000))
        self.assertEqual(row["address"], "40 BEDOK STH RD")
        self.assertNotIn("created_at", row)

    def test_invalid_source_is_rejected(self):
        for changes in ({"monthly_rent": "NaN"}, {"monthly_rent": "0"}, {"block": ""}, {"rent_approval_date": "2026-13"}):
            with self.subTest(changes=changes), self.assertRaises(ValueError):
                rental.transform(source(**changes))

    def test_late_earlier_month_approval_is_included(self):
        payload = {"success": True, "result": {"total": 3, "records": [source(3, "2026-06"), source(2), source(1)]}}
        with mock.patch.object(resale, "get_json", return_value=(payload, {})), mock.patch.object(rental.time, "sleep"):
            rows, boundary, total = rental.fetch_after(1)
        self.assertEqual([r["source_id"] for r in rows], [3, 2])
        rental.validate_append(rental.transform(source(1)), 1, rows, boundary, total)

    def test_source_reset_or_count_gap_aborts(self):
        latest = rental.transform(source(1))
        with self.assertRaises(RuntimeError):
            rental.validate_append(latest, 1, [], rental.transform(source(1, monthly_rent="4000")), 1)
        with self.assertRaises(RuntimeError):
            rental.validate_append(latest, 1, [], latest, 2)

    def test_rerun_has_no_new_records(self):
        latest = rental.transform(source(1))
        rental.validate_append(latest, 1, [], latest, 1)

    def test_duplicate_source_page_aborts(self):
        payload = {"success": True, "result": {"total": 2, "records": [source(2), source(2)]}}
        with mock.patch.object(resale, "get_json", return_value=(payload, {})), self.assertRaises(RuntimeError):
            rental.fetch_after(1)

    def test_coordinate_lookup_handles_server_page_cap(self):
        row = {"address": "40 BEDOK STH RD", "latitude": 1.32, "longitude": 103.9, "postal_code": "460040"}
        with mock.patch.object(rental, "db_read", side_effect=[([row] * 1000, {}), ([row], {})]) as read:
            cache = rental.coordinate_cache({row["address"]})
        self.assertEqual(read.call_count, 2)
        self.assertEqual(cache[row["address"]], (1.32, 103.9, "460040"))

    def test_conflicting_coordinates_are_not_reused(self):
        rows = [{"address": "40 BEDOK STH RD", "latitude": lat, "longitude": 103.9, "postal_code": "460040"} for lat in (1.32, 1.33)]
        with mock.patch.object(rental, "db_read", return_value=(rows, {})):
            self.assertEqual(rental.coordinate_cache({"40 BEDOK STH RD"}), {})

    def test_resale_writer_keeps_legacy_property_type(self):
        self.assertEqual(resale.transform({"month": "2026-11"})["property_type"], "hdb")
        self.assertIn("property_type", resale.OUT_COLS)


if __name__ == "__main__":
    unittest.main()
