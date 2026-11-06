"""Negative scope tests for the production vendor WhatsApp UI cut."""
from pathlib import Path
import json
import runpy
import shutil
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[3]
tool = runpy.run_path(str(ROOT / "scripts/mvp/launch/verify-vendor-frontend.py"))
failures = tool["failures"]
MANIFEST = Path("docs/launch/f2-vendor-frontend-manifest.json")
SUPPORT = (
    "app/vendors/register/page.tsx",
    "app/api/vendor/onboarding/request-otp/route.ts",
    "app/api/vendor/onboarding/complete/route.ts",
    "app/api/vendor/private-evidence/route.ts",
)

class VendorFrontendScopeTests(unittest.TestCase):
    def fixture(self):
        tmp = tempfile.TemporaryDirectory()
        root = Path(tmp.name)
        files = [MANIFEST] + [Path(x) for x in tool["EXPECTED"]] + [Path(x) for x in SUPPORT]
        for rel in files:
            file = root / rel
            file.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(ROOT / rel, file)
        return tmp, root

    def test_pinned_frontend_is_reviewed_and_all_release_switches_off(self):
        self.assertEqual(failures(ROOT), [])
        m = json.loads((ROOT / MANIFEST).read_text())
        for key in ("production_authorized", "staging_deployed",
                    "provider_delivery_certified", "owner_approval_authorized",
                    "staff_activation_authorized", "scanner_certified",
                    "legacy_password_signup_authorized"):
            self.assertIs(m[key], False)

    def test_changed_signup_bytes_fail_closed(self):
        tmp, repo = self.fixture()
        try:
            f = repo / "components/VendorRegisterForm.tsx"
            f.write_bytes(f.read_bytes() + b"\n// unsafe edit")
            self.assertTrue(any(x.startswith("modified_or_missing_source:") for x in failures(repo)))
        finally:
            tmp.cleanup()

    def test_reintroducing_password_action_fails_closed(self):
        tmp, repo = self.fixture()
        try:
            f = repo / "components/VendorRegisterForm.tsx"
            f.write_text(f.read_text(encoding="utf8") + "\n// submitVendorAccountRegistration", encoding="utf8")
            self.assertIn("password_signup_resurrected", failures(repo))
        finally:
            tmp.cleanup()

    def test_fake_whatsapp_delivery_claim_fails_closed(self):
        tmp, repo = self.fixture()
        try:
            f = repo / "lib/vendors/vendorSignupUi.ts"
            f.write_text(f.read_text().replace("deliveryConfirmed===false", "deliveryConfirmed===true"))
            self.assertIn("delivery_claim_unsafe", failures(repo))
        finally:
            tmp.cleanup()

    def test_forged_go_and_scanner_certification_rejected(self):
        tmp, repo = self.fixture()
        try:
            f = repo / MANIFEST
            m = json.loads(f.read_text())
            m["production_authorized"] = True
            m["scanner_certified"] = True
            f.write_text(json.dumps(m))
            got = failures(repo)
            self.assertIn("unsafe_release_flag:production_authorized", got)
            self.assertIn("unsafe_release_flag:scanner_certified", got)
        finally:
            tmp.cleanup()

    def test_pending_whatsapp_user_is_not_sent_to_password_login(self):
        tmp, repo = self.fixture()
        try:
            f = repo / "components/VendorRegisterForm.tsx"
            f.write_text(f.read_text(encoding="utf8") +
                "\n// Go to vendor login", encoding="utf8")
            self.assertIn("pending_vendor_login_misrepresented", failures(repo))
        finally:
            tmp.cleanup()

    def test_old_registration_bookmark_must_resolve(self):
        tmp, repo = self.fixture()
        try:
            f = repo / "app/vendors/register/page.tsx"
            f.write_text('export default function Page() { return null; }')
            self.assertIn("legacy_bookmark_break", failures(repo))
        finally:
            tmp.cleanup()

    def test_google_place_requirement_cannot_disappear(self):
        tmp, repo = self.fixture()
        try:
            f = repo / "components/VendorRegisterForm.tsx"
            f.write_text(f.read_text(encoding="utf8").replace("isPlaceCompatibleWithSelectedCity",
                "allowTypedAddressOnly"), encoding="utf8")
            self.assertIn("form_contract_missing:isPlaceCompatibleWithSelectedCity", failures(repo))
        finally:
            tmp.cleanup()

    def test_unlisted_staff_route_change_rejected(self):
        changed = set(tool["EXPECTED"]) | tool["ARTIFACTS"] | {
            "app/api/vox/v1/team-chat/route.ts",
        }
        self.assertIn("unlisted_diff:app/api/vox/v1/team-chat/route.ts",
                      failures(ROOT, changed))

    def test_unreviewed_http_endpoint_change_rejected(self):
        changed = set(tool["EXPECTED"]) | tool["ARTIFACTS"] | {
            "app/api/vendor/onboarding/complete/route.ts",
        }
        self.assertIn("unlisted_diff:app/api/vendor/onboarding/complete/route.ts",
                      failures(ROOT, changed))

if __name__ == "__main__":
    unittest.main()
