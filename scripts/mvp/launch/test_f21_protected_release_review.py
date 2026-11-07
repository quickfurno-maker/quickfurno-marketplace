#!/usr/bin/env python3
"""F21 integration-lineage audit hostile tests; no GitHub APIs or live systems."""
import importlib.util
from pathlib import Path
import re
import unittest
from unittest.mock import patch
HERE=Path(__file__).resolve().parent
ROOT=HERE.parents[2]
spec=importlib.util.spec_from_file_location("f21review",HERE/"f21_protected_release_review.py")
mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod)
class F21ProtectedReleaseTests(unittest.TestCase):
 def test_01_current_original_protection_is_immutable(self):
  value=mod.check(ROOT)
  self.assertTrue(value["valid"],value["failures"])
  self.assertEqual(value["checkedProtectedPathCount"],13)
  self.assertEqual(value["releaseVerdict"],"HOLD")
 def test_02_never_claims_old_protected_check_green(self):
  r=mod.check(ROOT)
  self.assertTrue(r["historicalOriginalChecksRemainUnwaived"])
  self.assertEqual(set(r["historicalFailedRuns"]),{"F0","F1","F5","F6","F7"})
  self.assertFalse(r["newIntegratedReleaseApprovalGranted"])
 def test_03_never_claims_signed_provider_or_deployment(self):
  r=mod.check(ROOT)
  for k in ("mayDeployStaging","maySendOtp","mayDeployProduction",
            "newLiveStagingCredentialsChecked","realStagingDeploymentPerformed"):
   self.assertFalse(r[k],k)
 def test_04_f1_f5_f6_f7_file_digests_pin_in_review(self):
  r=mod.check(ROOT)
  self.assertEqual(len(r["protectedSourceSha256"]),13)
  for p,h in r["protectedSourceSha256"].items():
   self.assertTrue((ROOT/p).is_file())
   self.assertRegex(h,r"^[0-9a-f]{64}$")
 def test_05_missing_original_verifier_is_rejected(self):
  extra=mod.REQUIRED_PROTECTED+("scripts/mvp/launch/f21-this-does-not-exist.py",)
  with patch.object(mod,"REQUIRED_PROTECTED",extra):
   r=mod.check(ROOT)
  self.assertFalse(r["valid"])
  self.assertIn("PROTECTED_HISTORICAL_FILE_MISSING:scripts/mvp/launch/f21-this-does-not-exist.py",r["failures"])
 def test_06_wrong_integration_base_is_rejected(self):
  with patch.object(mod,"F20","0"*40):
   r=mod.check(ROOT)
  self.assertFalse(r["valid"])
  self.assertIn("UNKNOWN_PINNED_REVISION",r["failures"])
  self.assertIn("NOT_F20_ANCESTOR",r["failures"])
 def test_07_wrong_f7_source_pin_is_rejected(self):
  with patch.object(mod,"F7","0"*40):
   r=mod.check(ROOT)
  self.assertFalse(r["valid"])
  self.assertTrue(any("F7" in s or "f7" in s or "PINNED" in s
                      for s in r["failures"]))
 def test_08_migration_source_byte_guard_persists(self):
  r=mod.check(ROOT)
  self.assertTrue(r["migrationSourceParityPinsPreserved"])
 def test_09_runtime_change_is_bounded_to_owner_bff(self):
  r=mod.check(ROOT)
  self.assertTrue(r["reviewedChangedRuntimePaths"] in (
      [],["apps/vox-web/lib/ownerVendorVerification.ts"]))
 def test_10_historical_original_workflows_not_mutated(self):
  r=mod.check(ROOT)
  self.assertIn(".github/workflows/qf-f0-owner-vox-scope.yml",r["protectedSourceSha256"])
  r=mod.check(ROOT)
  paths=r["protectedSourceSha256"]
  for tag in ("f1","f5","f6","f7"):
   self.assertIn(".github/workflows/qf-"+tag+"-"+{
     "f1":"core-owner-vendor.yml","f5":"vendor-returning-login.yml",
     "f6":"whatsapp-auth-lane-isolation.yml","f7":"dedicated-whatsapp-auth.yml"}[tag],paths)
if __name__=="__main__":unittest.main()
