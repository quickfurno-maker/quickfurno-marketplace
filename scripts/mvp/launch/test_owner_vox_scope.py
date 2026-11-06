"""Adversarial tests for the scoped VOX Owner artifact inventory."""
from pathlib import Path
import json
import runpy
import shutil
import tempfile
import unittest

REPO = Path(__file__).resolve().parents[3]
verify = runpy.run_path(str(REPO / "scripts/mvp/launch/verify-owner-vox-scope.py"))["errors_for"]

class OwnerVoxScopeTests(unittest.TestCase):
    def test_current_candidate_is_exact_and_not_authorized(self):
        self.assertEqual(verify(REPO), [])
        obj = json.loads((REPO / "docs/launch/f0-owner-vox-file-manifest.json").read_text())
        self.assertIs(obj["production_authorized"], False)
        self.assertIs(obj["unreviewed_staff_enabled"], False)

    def fixture(self):
        directory = tempfile.TemporaryDirectory()
        dst = Path(directory.name)
        manifest_rel = Path("docs/launch/f0-owner-vox-file-manifest.json")
        (dst / manifest_rel).parent.mkdir(parents=True)
        shutil.copyfile(REPO / manifest_rel, dst / manifest_rel)
        files = json.loads((REPO / manifest_rel).read_text())["files"]
        for row in files:
            rel = Path(row["path"])
            target = dst / rel
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(REPO / rel, target)
        return directory, dst

    def test_new_staff_endpoint_is_denied(self):
        temp, dst = self.fixture()
        try:
            file = dst / "apps/vox-web/app/api/team-chat/route.ts"
            file.parent.mkdir(parents=True)
            file.write_text("export function GET(){return Response.json({ok:true})}")
            self.assertTrue(any(x.startswith("forbidden_app_route:") for x in verify(dst)))
        finally:
            temp.cleanup()

    def test_tampered_owner_handler_is_denied(self):
        temp, dst = self.fixture()
        try:
            file = dst / "apps/vox-web/app/api/owner/vendor-verification/decision/route.ts"
            file.write_text(file.read_text() + "\n// unauthorized mutation\n")
            self.assertTrue(any(x.startswith("modified_file:") for x in verify(dst)))
        finally:
            temp.cleanup()

    def test_release_authorization_forgery_is_denied(self):
        temp, dst = self.fixture()
        try:
            file = dst / "docs/launch/f0-owner-vox-file-manifest.json"
            obj = json.loads(file.read_text())
            obj["production_authorized"] = True
            file.write_text(json.dumps(obj))
            self.assertIn("no_production_authorization", verify(dst))
        finally:
            temp.cleanup()

    def test_generated_landing_redirect_accepts_canonical_lf(self):
        temp, dst = self.fixture()
        try:
            file = dst / "apps/vox-web/app/page.tsx"
            file.write_bytes(file.read_bytes().replace(b"\r\n", b"\n"))
            self.assertEqual(verify(dst), [])
        finally:
            temp.cleanup()

    def test_missing_owner_route_is_denied(self):
        temp, dst = self.fixture()
        try:
            (dst / "apps/vox-web/app/owner/vendors/verification/page.tsx").unlink()
            self.assertTrue(any(x.startswith("missing_file:") for x in verify(dst)))
        finally:
            temp.cleanup()

if __name__ == "__main__":
    unittest.main()
