"""Negative security and scope tests for bounded Core Vendor / Owner extraction."""
import json
from pathlib import Path
import runpy
import shutil
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[3]
v = runpy.run_path(str(ROOT / "scripts/mvp/launch/verify-core-owner-vendor.py"))
checks = v["checks"]
MANIFEST = Path("docs/launch/f1-core-owner-vendor-manifest.json")

class CoreOwnerVendorScopeTests(unittest.TestCase):
    def fixture(self):
        temp = tempfile.TemporaryDirectory()
        dest = Path(temp.name)
        raw = json.loads((ROOT / MANIFEST).read_text(encoding="utf8"))
        for item in [MANIFEST] + [Path(x["path"]) for x in raw["files"]]:
            dst = dest / item
            dst.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(ROOT / item, dst)
        return temp, dest

    def test_unmodified_source_holds_release_off(self):
        self.assertEqual(checks(ROOT), [])
        data = json.loads((ROOT / MANIFEST).read_text())
        self.assertIs(data["release_authorized"], False)
        self.assertIs(data["managed_migrations_applied_by_this_batch"], False)
        self.assertIs(data["public_vendor_signup_enabled"], False)

    def test_untrusted_vendor_route_byte_rejected(self):
        temp, root = self.fixture()
        try:
            file = root / "app/api/vendor/onboarding/complete/route.ts"
            file.write_bytes(file.read_bytes() + b"\n// unauthorized change")
            self.assertTrue(any(x.startswith("source_hash_mismatch:") for x in checks(root)))
        finally:
            temp.cleanup()

    def test_missing_provider_gate_rejected(self):
        temp, root = self.fixture()
        try:
            file = root / "app/api/vendor/onboarding/request-otp/route.ts"
            file.write_text(file.read_text().replace(
                "QF_VENDOR_WHATSAPP_PROVIDER_CERTIFIED", "UNVERIFIED_PROVIDER"))
            self.assertTrue(any(x.startswith("missing_feature_guard:") for x in checks(root)))
        finally:
            temp.cleanup()

    def test_legacy_action_bypass_rejected(self):
        temp, root = self.fixture()
        try:
            file = root / "app/actions.ts"
            file.write_text(file.read_text().replace(
                'QF_VENDOR_LEGACY_REGISTRATION_MODE !== "staging"', "false"))
            self.assertIn("legacy_server_actions_not_closed", checks(root))
        finally:
            temp.cleanup()

    def test_client_user_id_reintroduction_rejected(self):
        temp, root = self.fixture()
        try:
            file = root / "lib/types.ts"
            data = file.read_text()
            needle = "export interface VendorRegistrationInput {"
            self.assertIn(needle, data)
            file.write_text(data.replace(needle, needle + "\n  user_id?: string;"))
            self.assertIn("user_id_in_public_signup_contract", checks(root))
        finally:
            temp.cleanup()

    def test_sql_change_rejected(self):
        temp, root = self.fixture()
        try:
            file = root / "supabase/migrations/20261104170000_vox_owner_vendor_review_queue.sql"
            file.write_bytes(file.read_bytes() + b"\n-- drift")
            self.assertTrue(any(x.startswith("vendor_sql_mismatch:") for x in checks(root)))
        finally:
            temp.cleanup()

    def test_forged_go_rejected(self):
        temp, root = self.fixture()
        try:
            file = root / MANIFEST
            raw = json.loads(file.read_text())
            raw["release_authorized"] = True
            file.write_text(json.dumps(raw))
            self.assertIn("unsafe_release_switch:release_authorized", checks(root))
        finally:
            temp.cleanup()

    def test_unlisted_staff_or_finance_route_change_rejected(self):
        diff = {x["path"] for x in json.loads((ROOT / MANIFEST).read_text())["files"]}
        diff |= v["NONRUNTIME"]
        diff.add("app/api/vox/v1/finance/route.ts")
        self.assertIn("unlisted_git_change:app/api/vox/v1/finance/route.ts",
                      checks(ROOT, diff))

    def test_missing_core_route_rejected(self):
        temp, root = self.fixture()
        try:
            (root / "app/api/vox/v1/owner-vendor-verification-case/route.ts").unlink()
            self.assertTrue(any(x.startswith("missing:") for x in checks(root)))
        finally:
            temp.cleanup()

    def test_migration_reorder_rejected(self):
        temp, root = self.fixture()
        try:
            file = root / MANIFEST
            raw = json.loads(file.read_text())
            raw["sql_order"].reverse()
            file.write_text(json.dumps(raw))
            self.assertIn("migration_order_or_membership", checks(root))
        finally:
            temp.cleanup()

if __name__ == "__main__":
    unittest.main()
