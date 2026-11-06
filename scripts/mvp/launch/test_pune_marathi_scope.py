import json, runpy, shutil, tempfile, unittest
from pathlib import Path
ROOT = Path(__file__).resolve().parents[3]
mod = runpy.run_path(str(ROOT/"scripts/mvp/launch/verify-pune-marathi-city.py"))
check = mod["failures"]
files = list(mod["CODE"]) + [mod["MANIFEST"],"components/location/ProjectLocationProvider.tsx"]

class PuneMarathiScopeTests(unittest.TestCase):
    def fixture(self):
        tmp = tempfile.TemporaryDirectory()
        repo = Path(tmp.name)
        for name in files:
            dest = repo/name
            dest.parent.mkdir(parents=True,exist_ok=True)
            shutil.copyfile(ROOT/name,dest)
        return tmp,repo

    def test_exact_unreleased_source(self):
        self.assertEqual(check(ROOT),[])
        obj=json.loads((ROOT/mod["MANIFEST"]).read_text(encoding="utf8"))
        self.assertTrue(all(obj[f] is False for f in mod["FLAGS"]))

    def test_malicious_code_change_rejected(self):
        tmp,repo=self.fixture()
        try:
            p=repo/"lib/google-maps/normalizePlace.ts"
            p.write_bytes(p.read_bytes()+b"\n// unauthorized override")
            self.assertIn("source_modified:lib/google-maps/normalizePlace.ts",check(repo))
        finally: tmp.cleanup()

    def test_forged_production_approval_rejected(self):
        tmp,repo=self.fixture()
        try:
            p=repo/mod["MANIFEST"];m=json.loads(p.read_text())
            m["production_deployed"]=True;m["geofence_disabled"]=True
            p.write_text(json.dumps(m))
            self.assertIn("unauthorized_production_deployed",check(repo))
            self.assertIn("unauthorized_geofence_disabled",check(repo))
        finally: tmp.cleanup()

    def test_altered_test_source_rejected(self):
        tmp,repo=self.fixture()
        try:
            p=repo/"scripts/mvp/location/validate-google-marathi-city.test.mjs"
            p.unlink()
            self.assertIn("source_modified:scripts/mvp/location/validate-google-marathi-city.test.mjs",check(repo))
        finally: tmp.cleanup()

    def test_unrelated_prod_change_rejected(self):
        bad=check(ROOT,set(mod["CODE"])|mod["META"]|
            {"app/api/vendor/onboarding/complete/route.ts"})
        self.assertIn("unreviewed_diff:app/api/vendor/onboarding/complete/route.ts",bad)

    def test_fake_city_activation_claim_rejected(self):
        tmp,repo=self.fixture()
        try:
            p=repo/mod["MANIFEST"];m=json.loads(p.read_text())
            m["city_activation_changed"]=True
            p.write_text(json.dumps(m))
            self.assertIn("unauthorized_city_activation_changed",check(repo))
        finally: tmp.cleanup()

if __name__=="__main__":
    unittest.main()
