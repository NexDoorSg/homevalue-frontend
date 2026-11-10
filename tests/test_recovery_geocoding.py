import unittest
from scripts.realis_backfill.geocode_recovery import resolve


class ExactRecoveryGeocodingTests(unittest.TestCase):
    def candidate(self, **overrides):
        return dict(BLK_NO='201', ROAD_NAME='OCEAN DRIVE', POSTAL='098584', LATITUDE='1.25150', LONGITUDE='103.84803', **overrides)

    def test_exact_building_and_postal(self):
        self.assertIsNotNone(resolve('201 OCEAN DRIVE', '098584', [self.candidate()]))

    def test_fuzzy_first_hit_rejected(self):
        self.assertIsNone(resolve('202 OCEAN DRIVE', '098584', [self.candidate()]))

    def test_postal_disagreement_rejected(self):
        self.assertIsNone(resolve('201 OCEAN DRIVE', '000000', [self.candidate()]))

    def test_ambiguous_coordinates_rejected(self):
        other = self.candidate()
        other['LATITUDE'] = '1.26'
        self.assertIsNone(resolve('201 OCEAN DRIVE', '098584', [self.candidate(), other]))

    def test_outside_singapore_rejected(self):
        other = self.candidate()
        other['LATITUDE'] = '51.5'
        self.assertIsNone(resolve('201 OCEAN DRIVE', '098584', [other]))

    def test_no_results_rejected(self):
        self.assertIsNone(resolve('201 OCEAN DRIVE', '098584', []))

    def test_exact_project_name_disambiguates_pois_at_same_address(self):
        named = self.candidate(BUILDING='THE AZURE')
        tenant = self.candidate(BUILDING='A TENANT')
        tenant['LATITUDE'] = '1.26'
        self.assertIsNotNone(resolve('201 OCEAN DRIVE', '098584', [tenant, named], 'THE AZURE'))
        self.assertIsNone(resolve('202 OCEAN DRIVE', '098584', [tenant, named], 'THE AZURE'))
