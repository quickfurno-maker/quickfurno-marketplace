#!/usr/bin/env python3
"""F20 adversarial cross-layer source guards; live providers never contacted."""
from __future__ import annotations
from copy import deepcopy
import importlib.util
from pathlib import Path
import unittest
ROOT=Path(__file__).resolve().parents[3]
MODULE_PATH=Path(__file__).with_name("f20_verify_owner_scan_internal.py")
spec=importlib.util.spec_from_file_location("f20check",MODULE_PATH)
m=importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
ORIGINAL={p:(ROOT/p).read_text(encoding="utf8") for p in m.FILES}
def modified(path,old,new):
    x=deepcopy(ORIGINAL)
    assert old in x[path],(path,old)
    x[path]=x[path].replace(old,new,1)
    return m.validate_text(x)
class F20GuardTests(unittest.TestCase):
    def test_01_actual_integrated_sources_pass(self):
        r=m.audit(ROOT)
        self.assertTrue(r["valid"],r["issues"])
        self.assertEqual(r["releaseVerdict"],"HOLD")
        self.assertFalse(r["mayDeployStaging"])
        self.assertFalse(r["maySendOtp"])
    def test_02_no_scan_receipt_schema_denied(self):
        self.assertIn("IMMUTABLE_SCAN_RECEIPTS_MISSING",modified(m.SCAN,
          "create table if not exists qf_vendor_private.verification_scan_receipts",
          "create table if not exists dummy_receipts"))
    def test_03_no_immutable_receipt_trigger_denied(self):
        self.assertIn("IMMUTABLE_SCAN_RECEIPTS_MISSING",modified(m.SCAN,
          "before update or delete","before insert"))
    def test_04_missing_anonymous_revoke_denied(self):
        self.assertIn("BROWSER_SCAN_RECEIPT_ESCALATION",modified(m.SCAN,
          "revoke all on qf_vendor_private.verification_scan_receipts from public,anon,authenticated",
          "grant select on qf_vendor_private.verification_scan_receipts to anon"))
    def test_05_missing_scanner_sha_binding_denied(self):
        self.assertIn("SCAN_FREE_OFFICE_APPROVAL",modified(m.SCAN,
          "scan.content_sha256=office_doc.content_sha256",
          "scan.content_sha256 is not null"))
    def test_06_fake_clean_verdict_denied(self):
        self.assertIn("SCAN_FREE_OFFICE_APPROVAL",modified(m.SCAN,
          "scan.verdict='clean'","scan.verdict is not null"))
    def test_07_old_unapproved_case_denied(self):
        self.assertIn("SCAN_FREE_OFFICE_APPROVAL",modified(m.SCAN,
          "c.case_version=(select max(n.case_version)",
          "c.case_version>0"))
    def test_08_office_proof_requires_document_verified(self):
        self.assertIn("SCAN_FREE_OFFICE_APPROVAL",modified(m.SCAN,
          "office_doc.scan_status='clean'","office_doc.scan_status in ('pending','clean')"))
    def test_09_scan_writer_hash_must_match_evidence(self):
        self.assertIn("FORGEABLE_CLEAN_RECEIPT",modified(m.SCAN,
          "e.content_sha256=p_expected_sha256","e.content_sha256 is not null"))
    def test_10_scan_writer_must_serialize_case(self):
        self.assertIn("FORGEABLE_CLEAN_RECEIPT",modified(m.SCAN,
          "pg_advisory_xact_lock","pg_try_advisory_lock"))
    def test_11_owner_review_must_recheck_after_approval(self):
        self.assertIn("OWNER_REVIEW_ALLOWS_UNVERIFIED_APPROVAL",modified(m.REVIEW,
          "QF_OWNER_REVIEW_EVIDENCE_CHANGED","QF_OWNER_REVIEW_BYPASS"))
    def test_12_owner_superadmin_cannot_be_any_admin(self):
        self.assertIn("OWNER_REVIEW_ALLOWS_UNVERIFIED_APPROVAL",modified(m.REVIEW,
          "a.raw_app_meta_data->>'admin_role'='Superadmin'","true"))
    def test_13_assignment_gate_must_remain(self):
        self.assertIn("NEW_ASSIGNMENT_GATE_REMOVED",modified(m.REVIEW,
          "QF_VENDOR_ASSIGNMENT_VERIFICATION_REQUIRED","QF_VENDOR_ASSIGNMENT_OPTIONAL"))
    def test_14_core_owner_must_validate_aal2_twice(self):
        self.assertIn("OWNER_AAL2_NOT_RECHECKED",m.validate_text({
          **ORIGINAL,m.OWNER:ORIGINAL[m.OWNER].replace(
           'await verifyVoxOwnerBearer(request.headers.get("authorization"))',
           'undefined') }))
    def test_15_core_owner_browser_origin_guard(self):
        self.assertIn("OWNER_CSRF_ORIGIN_UNGUARDED",modified(m.OWNER,
          "new URL(origin).origin !== new URL(request.url).origin",
          "false"))
    def test_16_vox_bff_cannot_call_supabase_directly(self):
        x=deepcopy(ORIGINAL)
        x[m.WEB]+="\n const db=adminClient();\n"
        self.assertIn("VOX_OWNER_BFF_DIRECT_DATABASE_ACCESS",m.validate_text(x))
    def test_17_vox_bff_must_require_csrf_origin(self):
        self.assertIn("VOX_OWNER_BFF_BYPASSES_CORE",modified(m.WEB,
          "allowedOrigin(request)","true"))
    def test_18_vox_bff_mfa_revalidation_required(self):
        self.assertIn("VOX_OWNER_BFF_AAL2_OR_CORE_BRIDGE_CHANGED",modified(m.BFF,
          "OWNER_SESSION_REVOKED","OWNER_SESSION_IGNORED"))
    def test_19_release_gate_cannot_grant_production(self):
        self.assertIn("OPERATIONAL_RELEASE_FENCE_RELAXED",modified(m.F17,
          "mayDeployProduction:false","mayDeployProduction:true"))
    def test_20_scan_postflight_sql_rolls_back(self):
        source=(ROOT/"scripts/mvp/launch/f20_private_scan_isolated_postflight.sql").read_text("utf8")
        self.assertRegex(source,r"(?mi)^rollback;")
        self.assertRegex(source,r"F20_SCAN_RECEIPT_IMMUTABILITY_TRIGGER_MISSING")
        self.assertIn("F20_BROWSER_CAN_FORGE_CLEAN_SCAN",source)
        self.assertIn("F20_UNVERIFIED_RANDOM_VENDOR_EVER_READY",source)
    def test_21_no_runtime_deployment_on_source_audit(self):
        for name in ("mayDeployStaging","mayDeployProduction","maySendOtp"):
            self.assertFalse(m.audit(ROOT)[name])
if __name__=="__main__":unittest.main()
