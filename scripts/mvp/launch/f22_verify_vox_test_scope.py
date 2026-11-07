#!/usr/bin/env python3
"""F22 real Owner-only test-scope reconciliation and Staff legacy provenance.
NO NETWORK, no DB, no secrets, no deployment, never waives original F0/F1/F5/F6/F7.
Archive bytes must match an exact historical Staff Git commit. This test
rebaselines ONLY the default npm test command to today's approved Owner host.
"""
from __future__ import annotations
from pathlib import Path
import argparse,hashlib,importlib.util,json,re,subprocess

F21="4281e2b79e76ce12cdcfe2c376e40138fe09e1cb"
STAFF="015ad722c543b2106b0b46f3fc573e16c4edee63"
MANIFEST="docs/launch/qf-f22-legacy-vox-archive-20261107.json"
ORIGINAL_TEST_SHA="49f7777646476e1b9176dee70705b652df73b7f4f30f13e181b5a47e2cc980be"
EXPECTED_F0={
 "modified_file:apps/vox-web/lib/ownerVendorVerification.ts",
 "modified_file:apps/vox-web/package.json",
}
EXPECTED_F21={"UNAPPROVED_VOX_WEB_PACKAGE_DELTA"}
REPLACEMENT="scripts/mvp/launch/f21_owner_positive_synthetic.test.cjs"
def git(repo:Path,*args)->bytes:
 p=subprocess.run(["git","-C",str(repo),*args],capture_output=True,timeout=25)
 if p.returncode:raise ValueError("GIT_OBJECT_UNAVAILABLE")
 return p.stdout
def sha(raw:bytes)->str:return hashlib.sha256(raw).hexdigest()
def audit(repo:Path,override_manifest=None,override_package=None)->dict:
 errors=[]
 try:
  prior=json.loads(git(repo,"show",F21+":apps/vox-web/package.json"))
  current=override_package if override_package is not None else json.loads(
    (repo/"apps/vox-web/package.json").read_text(encoding="utf8"))
 except (ValueError,OSError,KeyError,json.JSONDecodeError):
  prior={};current={};errors.append("VOX_PACKAGE_PROVENANCE_MISSING")
 original_test=prior.get("scripts",{}).get("test","")
 old_paths=re.findall(r"scripts/[^\s]+?\.mjs",original_test)
 if len(old_paths)!=25 or len(set(old_paths))!=25 or sha(original_test.encode())!=ORIGINAL_TEST_SHA:
  errors.append("HISTORICAL_25_TEST_COMMAND_DRIFT")
 if current.get("scripts",{}).get("test")!="npm run test:internal":
  errors.append("OWNER_ONLY_DEFAULT_TEST_ENTRY_INVALID")
 if not isinstance(current,dict) or not isinstance(prior,dict):
  errors.append("PACKAGE_SHAPE_INVALID")
 else:
  lhs=json.loads(json.dumps(current))
  rhs=json.loads(json.dumps(prior))
  lhs.get("scripts",{}).pop("test",None)
  rhs.get("scripts",{}).pop("test",None)
  if lhs!=rhs:errors.append("UNREVIEWED_VOX_PACKAGE_DELTA")
 try:
  manifest=override_manifest if override_manifest is not None else json.loads(
    (repo/MANIFEST).read_text(encoding="utf8"))
 except (OSError,ValueError,TypeError,json.JSONDecodeError):
  manifest={};errors.append("ARCHIVE_MANIFEST_NOT_FOUND")
 rows=manifest.get("records",[])
 if not (manifest.get("schema")=="quickfurno.f22.legacy-vox-source-archive.v1"
    and manifest.get("historicalCommit")==STAFF
    and manifest.get("historicalOriginalScriptsRecovered")==24
    and manifest.get("historicalOwnerVendorVerificationScriptAbsent") is True
    and manifest.get("reviewedReplacement")==REPLACEMENT
    and manifest.get("replacementTestCasesPassed")==23
    and manifest.get("historicalStandaloneStaffFeaturesNotMergedIntoOwnerHost") is True
    and manifest.get("releaseVerdict")=="HOLD"
    and manifest.get("mayDeployStaging") is False
    and manifest.get("maySendOtp") is False
    and manifest.get("mayDeployProduction") is False
    and manifest.get("secretsIncluded") is False
    and isinstance(rows,list) and len(rows)==24):
  errors.append("INVALID_LEGACY_ARCHIVE_POLICY")
 names=set()
 for entry in rows if isinstance(rows,list) else []:
  if not isinstance(entry,dict):
   errors.append("INVALID_ARCHIVED_ITEM");continue
  historical=entry.get("historicalPath")
  archived=entry.get("archivedPath")
  if not isinstance(historical,str) or not isinstance(archived,str) or historical in names:
   errors.append("DUPLICATE_OR_MALFORMED_ARCHIVE_ITEM");continue
  names.add(historical)
  if (historical!="apps/vox-web/scripts/"+Path(historical).name or
      archived!="docs/launch/archive/vox-staff-legacy-tests/"+Path(historical).name or
      historical.removeprefix("apps/vox-web/") not in old_paths):
   errors.append("UNAUTHORIZED_ARCHIVE_PATH");continue
  try:
   content=(repo/archived).read_bytes()
   previous=git(repo,"show",STAFF+":"+historical)
   if (content!=previous or sha(content)!=entry.get("sha256") or
       len(content)!=entry.get("bytes") or
       entry.get("historicalGitSourceCommit")!=STAFF):
    errors.append("ARCHIVED_HISTORICAL_GIT_BYTES_DIFFER:"+historical)
  except (OSError,ValueError):
   errors.append("ARCHIVED_HISTORICAL_GIT_SOURCE_UNAVAILABLE:"+historical)
 remaining={"apps/vox-web/"+p for p in old_paths}-names
 if remaining!={"apps/vox-web/scripts/validate-owner-vendor-verification.spec.mjs"}:
  errors.append("UNACCOUNTED_LEGACY_SCRIPT:"+str(len(remaining)))
 if not (repo/REPLACEMENT).is_file():
  errors.append("MODERN_OWNER_REPLACEMENT_MISSING")
 # Never turn a historical red check green by retroactively modifying its
 # verifier or source manifest. The exact old F21/F0 deltas are *observed*
 # and separately eligible for formal integrated release approval later.
 f21_valid=False;f0_legacy_expected=False;protected_count=0
 try:
  spec=importlib.util.spec_from_file_location("f21check",repo/"scripts/mvp/launch/f21_protected_release_review.py")
  mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod)
  f21=mod.check(repo)
  protected_count=f21.get("checkedProtectedPathCount",0)
  f21_valid=set(f21.get("failures",[]))==EXPECTED_F21 and protected_count==13 and (
    f21.get("historicalOriginalChecksRemainUnwaived") is True and
    f21.get("releaseVerdict")=="HOLD")
  if not f21_valid:errors.append("F21_BASELINE_BYPASS_OR_EXTRA_DRIFT")
 except Exception:errors.append("F21_PROTECTED_LINEAGE_UNAVAILABLE")
 try:
  p=subprocess.run(["python","scripts/mvp/launch/verify-owner-vox-scope.py","--repo",str(repo)],
     cwd=repo,capture_output=True,text=True,timeout=30)
  f0=json.loads(p.stdout)
  f0_legacy_expected=p.returncode!=0 and set(f0.get("failures",[]))==EXPECTED_F0 and (
    f0.get("valid") is False and f0.get("deployment_authorized") is False)
  if not f0_legacy_expected:errors.append("F0_ORIGINAL_MANIFEST_DRIFT_NOT_EXPLAINED")
 except (ValueError,OSError,subprocess.TimeoutExpired,TypeError):
  errors.append("F0_ORIGINAL_VERIFIER_UNAVAILABLE")
 return {
  "schema":"quickfurno.f22.owner-staff-test-separation.v1",
  "valid":not errors,"issues":sorted(set(errors)),
  "archivedHistoricalScriptsChecked":len(names),
  "historicalGitBytesCompared":True,"syntheticOwnerReplacementPreserved":True,
  "historicalF0OriginalManifestFailureAcknowledged":f0_legacy_expected,
  "historicalF21PackageDeltaIndependentlyAcknowledged":f21_valid,
  "originalProtectedVerifiersAndManifestsPreserved":protected_count==13,
  "oldStaffCodeMergedIntoCurrentOwnerHost":False,
  "legacyStaffSuiteAlreadyCertifiedInCurrentOwnerHost":False,
  "releaseVerdict":"HOLD",
  "mayDeployStaging":False,"maySendOtp":False,"mayDeployProduction":False
 }
if __name__=="__main__":
 parser=argparse.ArgumentParser()
 parser.add_argument("--repo",default=".")
 args=parser.parse_args()
 try:r=audit(Path(args.repo).resolve())
 except Exception:r={"valid":False,"issues":["F22_INTERNAL_VERIFIER_ERROR"],"releaseVerdict":"HOLD"}
 print(json.dumps(r,sort_keys=True))
 raise SystemExit(0 if r.get("valid") else 1)
