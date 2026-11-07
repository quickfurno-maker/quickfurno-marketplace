#!/usr/bin/env python3
"""F22 hostile immutable historical VOX test provenance and current Owner scope."""
from pathlib import Path
from copy import deepcopy
import importlib.util,json
import unittest
HERE=Path(__file__).resolve().parent
ROOT=HERE.parents[2]
spec=importlib.util.spec_from_file_location("f22check",HERE/"f22_verify_vox_test_scope.py")
mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod)
BASE_MANIFEST=json.loads((ROOT/mod.MANIFEST).read_text("utf8"))
BASE_PACKAGE=json.loads((ROOT/"apps/vox-web/package.json").read_text("utf8"))
class F22OwnerLegacySeparationTests(unittest.TestCase):
 def test_01_actual_real_archived_sources_match_git(self):
  r=mod.audit(ROOT)
  self.assertTrue(r["valid"],r["issues"])
  self.assertEqual(r["archivedHistoricalScriptsChecked"],24)
 def test_02_no_fake_current_staff_full_certification(self):
  r=mod.audit(ROOT)
  self.assertFalse(r["legacyStaffSuiteAlreadyCertifiedInCurrentOwnerHost"])
  self.assertFalse(r["oldStaffCodeMergedIntoCurrentOwnerHost"])
  self.assertTrue(r["historicalF0OriginalManifestFailureAcknowledged"])
  self.assertTrue(r["historicalF21PackageDeltaIndependentlyAcknowledged"])
 def test_03_no_implicit_release_or_otp(self):
  r=mod.audit(ROOT)
  self.assertEqual(r["releaseVerdict"],"HOLD")
  for name in ("mayDeployStaging","mayDeployProduction","maySendOtp"):
   self.assertFalse(r[name])
 def test_04_default_npm_test_cannot_disable_maintained_suite(self):
  package=deepcopy(BASE_PACKAGE)
  package["scripts"]["test"]="echo All Tests Passed"
  r=mod.audit(ROOT,override_package=package)
  self.assertIn("OWNER_ONLY_DEFAULT_TEST_ENTRY_INVALID",r["issues"])
 def test_05_original_test_internal_remains_exact(self):
  package=deepcopy(BASE_PACKAGE)
  package["scripts"]["test:internal"]="echo bypass"
  self.assertIn("UNREVIEWED_VOX_PACKAGE_DELTA",
                mod.audit(ROOT,override_package=package)["issues"])
 def test_06_staff_activation_script_cannot_be_added(self):
  package=deepcopy(BASE_PACKAGE)
  package["scripts"]["activate:staff"]="VOX_STAFF_VIEW_MODE=dual"
  self.assertIn("UNREVIEWED_VOX_PACKAGE_DELTA",
                mod.audit(ROOT,override_package=package)["issues"])
 def test_07_archive_cannot_turn_release_go(self):
  manifest=deepcopy(BASE_MANIFEST);manifest["releaseVerdict"]="GO"
  self.assertIn("INVALID_LEGACY_ARCHIVE_POLICY",
                mod.audit(ROOT,override_manifest=manifest)["issues"])
 def test_08_archive_cannot_claim_staging_authorization(self):
  manifest=deepcopy(BASE_MANIFEST);manifest["mayDeployStaging"]=True
  self.assertIn("INVALID_LEGACY_ARCHIVE_POLICY",
                mod.audit(ROOT,override_manifest=manifest)["issues"])
 def test_09_forged_original_file_checksum_denied(self):
  manifest=deepcopy(BASE_MANIFEST);manifest["records"][0]["sha256"]="0"*64
  self.assertTrue(any(x.startswith("ARCHIVED_HISTORICAL_GIT_BYTES_DIFFER:")
    for x in mod.audit(ROOT,override_manifest=manifest)["issues"]))
 def test_10_duplicate_or_missing_original_denied(self):
  manifest=deepcopy(BASE_MANIFEST)
  manifest["records"][1]=deepcopy(manifest["records"][0])
  result=mod.audit(ROOT,override_manifest=manifest)
  self.assertIn("DUPLICATE_OR_MALFORMED_ARCHIVE_ITEM",result["issues"])
 def test_11_foreign_source_commit_cannot_approve(self):
  manifest=deepcopy(BASE_MANIFEST)
  manifest["records"][0]["historicalGitSourceCommit"]="a"*40
  self.assertTrue(any(x.startswith("ARCHIVED_HISTORICAL_GIT_BYTES_DIFFER:")
    for x in mod.audit(ROOT,override_manifest=manifest)["issues"]))
 def test_12_modern_owner_replacement_is_required(self):
  manifest=deepcopy(BASE_MANIFEST);manifest["reviewedReplacement"]="fakeOwnerTest"
  self.assertIn("INVALID_LEGACY_ARCHIVE_POLICY",
                mod.audit(ROOT,override_manifest=manifest)["issues"])
 def test_13_staff_current_host_mixing_denied(self):
  manifest=deepcopy(BASE_MANIFEST)
  manifest["historicalStandaloneStaffFeaturesNotMergedIntoOwnerHost"]=False
  self.assertIn("INVALID_LEGACY_ARCHIVE_POLICY",
                mod.audit(ROOT,override_manifest=manifest)["issues"])
 def test_14_old_historical_test_command_immutable(self):
  self.assertRegex(mod.ORIGINAL_TEST_SHA,r"^[0-9a-f]{64}$")
  self.assertEqual(len(BASE_MANIFEST["records"]),24)
  self.assertEqual(BASE_PACKAGE["scripts"]["test"],"npm run test:internal")
if __name__=="__main__":unittest.main()
