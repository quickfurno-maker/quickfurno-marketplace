"""Negative source/binding tests for returning-vendor WhatsApp login, no deploy."""
import json, runpy, shutil, tempfile, unittest
from pathlib import Path

ROOT=Path(__file__).resolve().parents[3]
policy=runpy.run_path(str(ROOT/"scripts/mvp/launch/verify-vendor-returning-login.py"))
check=policy["failures"]
MANIFEST=policy["MANIFEST"]
DEPENDENCIES=[
  "app/api/vendor/onboarding/complete/route.ts",
  "app/api/vendor/private-evidence/route.ts",
  "app/api/vox/v1/owner-vendor-verification-case/route.ts",
]

class VendorReturningLoginScopeTests(unittest.TestCase):
    def fixture(self):
        tmp=tempfile.TemporaryDirectory()
        repo=Path(tmp.name)
        for name in [*policy["FILES"],MANIFEST,*DEPENDENCIES]:
            f=repo/name
            f.parent.mkdir(parents=True,exist_ok=True)
            shutil.copyfile(ROOT/name,f)
        return tmp,repo

    def test_source_pinned_and_release_hold(self):
        self.assertEqual(check(ROOT),[])
        m=json.loads((ROOT/MANIFEST).read_text())
        self.assertTrue(all(m[f] is False for f in policy["FLAGS"]))

    def test_new_vendor_creation_disallowed_by_returning_login(self):
        tmp,repo=self.fixture()
        try:
            p=repo/"app/api/vendor/auth/login/request-otp/route.ts"
            p.write_text(p.read_text(encoding="utf8").replace(
                "shouldCreateUser:false","shouldCreateUser:true"),encoding="utf8")
            result=check(repo)
            self.assertIn("missing_security_contract:no_auth_user_creation",result)
        finally:tmp.cleanup()

    def test_login_without_signed_delivery_denied(self):
        tmp,repo=self.fixture()
        try:
            p=repo/"services/returningWhatsappVendorLoginService.ts"
            p.write_text(p.read_text(encoding="utf8").replace(
                "verifyVendorSignupWhatsappOtp","bypassOtpVerify"),encoding="utf8")
            self.assertIn("missing_security_contract:validated_real_otp",check(repo))
        finally:tmp.cleanup()

    def test_no_locally_generated_provider_certification(self):
        tmp,repo=self.fixture()
        try:
            p=repo/MANIFEST;m=json.loads(p.read_text())
            m["meta_sender_certified"]=True;m["production_deployed"]=True
            p.write_text(json.dumps(m))
            bad=check(repo)
            self.assertIn("release_switch_enabled:meta_sender_certified",bad)
            self.assertIn("release_switch_enabled:production_deployed",bad)
        finally:tmp.cleanup()

    def test_lost_session_invalidation_is_not_ignored(self):
        tmp,repo=self.fixture()
        try:
            p=repo/"services/returningWhatsappVendorLoginService.ts"
            p.write_text(p.read_text(encoding="utf8").replace("invalidateLocalSession(sb)","true"),encoding="utf8")
            self.assertIn("missing_security_contract:denial_local_signout",check(repo))
        finally:tmp.cleanup()

    def test_mutated_runtime_source_rejected(self):
        tmp,repo=self.fixture()
        try:
            p=repo/"lib/vendors/vendorReturningLoginPolicy.ts"
            p.write_bytes(p.read_bytes()+b"\n// malicious loosen")
            self.assertIn("source_modified:lib/vendors/vendorReturningLoginPolicy.ts",check(repo))
        finally:tmp.cleanup()

    def test_forged_business_or_wallet_route_not_permitted(self):
        changed=set(policy["FILES"])|policy["META"]|{"app/api/vendor/grant-credits/route.ts"}
        self.assertIn("unlisted_diff:app/api/vendor/grant-credits/route.ts",check(ROOT,changed))

    def test_forged_owner_approval_gate_does_not_enable_scan(self):
        tmp,repo=self.fixture()
        try:
            p=repo/MANIFEST;m=json.loads(p.read_text())
            m["scanner_certified"]=True;m["owner_approved"]=True
            p.write_text(json.dumps(m))
            self.assertIn("release_switch_enabled:scanner_certified",check(repo))
            self.assertIn("release_switch_enabled:owner_approved",check(repo))
        finally:tmp.cleanup()

if __name__=="__main__":
    unittest.main()
