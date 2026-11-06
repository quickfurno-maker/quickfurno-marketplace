"""Adversarial checks against staged Google Places SDK bootstrap regression."""
from pathlib import Path
import json, runpy, shutil, tempfile, unittest

ROOT = Path(__file__).resolve().parents[3]
program = runpy.run_path(str(ROOT / "scripts/mvp/launch/verify-google-places-reliability.py"))
check = program["failures"]
MANIFEST = Path("docs/launch/f3-google-places-source-manifest.json")

class GooglePlacesReliabilityScope(unittest.TestCase):
    def fixture(self):
        tmp = tempfile.TemporaryDirectory()
        dest = Path(tmp.name)
        for name in [MANIFEST, *map(Path, program["FILES"])]:
            path = dest / name
            path.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(ROOT / name, path)
        return tmp, dest

    def test_exact_source_is_pinned_and_no_live_certification(self):
        self.assertEqual(check(ROOT), [])
        m = json.loads((ROOT / MANIFEST).read_text(encoding="utf8"))
        self.assertIs(m["google_billing_certified"], False)
        self.assertIs(m["google_places_live_certified"], False)
        self.assertIs(m["vendor_geofence_bypass_authorized"], False)

    def test_modified_loader_rejected(self):
        tmp, repo = self.fixture()
        try:
            p = repo / "lib/google-maps/loadGoogleMaps.ts"
            p.write_bytes(p.read_bytes() + b"\n// forged")
            self.assertIn("source_tampered:lib/google-maps/loadGoogleMaps.ts", check(repo))
        finally:
            tmp.cleanup()

    def test_removed_bounded_import_rejected(self):
        tmp, repo = self.fixture()
        try:
            p = repo / "lib/google-maps/loadGoogleMaps.ts"
            p.write_text(p.read_text(encoding="utf8").replace(
                "boundedPlacesImport", "unboundedImport"), encoding="utf8")
            self.assertIn("bounded_bootstrap_contract_missing:boundedPlacesImport", check(repo))
        finally:
            tmp.cleanup()

    def test_billing_certification_forgery_rejected(self):
        tmp, repo = self.fixture()
        try:
            p = repo / MANIFEST
            m = json.loads(p.read_text())
            m["google_billing_certified"] = True
            m["managed_env_updated"] = True
            p.write_text(json.dumps(m))
            result = check(repo)
            self.assertIn("unsafe_certification:google_billing_certified", result)
            self.assertIn("unsafe_certification:managed_env_updated", result)
        finally:
            tmp.cleanup()

    def test_unlisted_core_or_payment_change_rejected(self):
        got = check(ROOT, set(program["FILES"]) | program["REVIEW"] |
                    {"app/api/payments/route.ts"})
        self.assertIn("unlisted_release_diff:app/api/payments/route.ts", got)

    def test_missing_timeout_test_is_rejected(self):
        tmp, repo = self.fixture()
        try:
            (repo / "scripts/mvp/location/validate-google-places-timeout.test.mjs").unlink()
            result = check(repo)
            self.assertTrue(any(x.startswith("source_tampered:") for x in result))
        finally:
            tmp.cleanup()

if __name__ == "__main__":
    unittest.main()
