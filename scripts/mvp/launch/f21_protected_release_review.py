#!/usr/bin/env python3
"""F21 immutable protected-release lineage review (source-only, NO DEPLOY).

Inspects exact git objects and the original F10 source-contract certification.
A valid review does NOT waive historical F0/F1/F5/F6/F7 protected CI failures,
merge PRs, permit OTP, or promote any container.
"""
from pathlib import Path
import argparse,hashlib,importlib.util,json,subprocess

BASE="223e9daa1da1f6a705a04a72cd723c2930ece543"
F7="61bb1ce1e06cf138fe65ed10fe03c0c15557d931"
F20="99c9a56c63fba6db179201ca0688f96465f07985"
F0_PATHS=(
 ".github/workflows/qf-f0-owner-vox-scope.yml",
 "scripts/mvp/launch/verify-owner-vox-scope.py",
 "docs/launch/f0-owner-vox-file-manifest.json",
)
REQUIRED_PROTECTED=F0_PATHS+(
 ".github/workflows/qf-f1-core-owner-vendor.yml",
 ".github/workflows/qf-f5-vendor-returning-login.yml",
 ".github/workflows/qf-f6-whatsapp-auth-lane-isolation.yml",
 ".github/workflows/qf-f7-dedicated-whatsapp-auth.yml",
 "scripts/mvp/launch/verify-core-owner-vendor.py",
 "scripts/mvp/launch/verify-vendor-returning-login.py",
 "scripts/mvp/launch/verify-whatsapp-lane-isolation-scope.py",
 "scripts/mvp/launch/verify-whatsapp-f7-scope.py",
 "docs/launch/f1-core-owner-vendor-manifest.json",
 "docs/launch/f5-vendor-returning-login-manifest.json",
)
# These status snapshots were verified against exact GitHub runs during F17.
# They are *historical evidence*, NOT a substitute for current branch checks.
LEGACY_RUNS={
 "F0":"42359751693",
 "F1":"42213054624","F5":"42213054292",
 "F6":"42213054355","F7":"42347125699"
}
def git(repo,*args)->bytes:
 result=subprocess.run(["git","-C",str(repo),*args],
      capture_output=True,check=False,timeout=20)
 if result.returncode:raise ValueError("LOCAL_GIT_CHECK_FAILED")
 return result.stdout
def sha(b:bytes)->str:return hashlib.sha256(b).hexdigest()
def check(repo:Path)->dict:
 failures=[]
 if not repo.is_dir():raise ValueError("REPO_NOT_FOUND")
 for rev in (BASE,F7,F20):
  try:git(repo,"cat-file","-e",rev+"^{commit}")
  except ValueError:failures.append("UNKNOWN_PINNED_REVISION")
 try:
  git(repo,"merge-base","--is-ancestor",F20,"HEAD")
 except ValueError:failures.append("NOT_F20_ANCESTOR")
 protected_sha={}
 for p in REQUIRED_PROTECTED:
  anchor=F20 if p in F0_PATHS else F7 if "f7" in p.lower() else BASE
  try:
   old=git(repo,"show",anchor+":"+p)
   now=(repo/p).read_bytes()
   protected_sha[p]=sha(now)
   if old!=now:failures.append("PROTECTED_HISTORICAL_FILE_MODIFIED:"+p)
  except (OSError,ValueError):failures.append("PROTECTED_HISTORICAL_FILE_MISSING:"+p)
 # F0's original historical byte-inventory verifier is expected to flag
 # exactly the two F21-reviewed VOX module/package deltas. Any additional
 # drift must stop review; successful F0 alone cannot authorize deployment.
 try:
  cmd=subprocess.run(["python","scripts/mvp/launch/verify-owner-vox-scope.py",
      "--repo",str(repo)],cwd=repo,capture_output=True,text=True,timeout=30)
  f0=json.loads(cmd.stdout)
  expected_f0={
   "modified_file:apps/vox-web/lib/ownerVendorVerification.ts",
   "modified_file:apps/vox-web/package.json"
  }
  if (cmd.returncode==0 or f0.get("valid") is not False or
      set(f0.get("failures",[]))!=expected_f0 or
      f0.get("deployment_authorized") is not False):
   failures.append("UNRECONCILED_F0_OWNER_VOX_MANIFEST")
 except (OSError,ValueError,subprocess.TimeoutExpired,TypeError):
  failures.append("F0_HISTORICAL_VERIFIER_UNAVAILABLE")
 spec=importlib.util.spec_from_file_location("f10recert",repo/"scripts/mvp/launch/verify-f10-cross-phase-whatsapp-recert.py")
 if not spec or not spec.loader:failures.append("F10_CERTIFIER_UNAVAILABLE")
 else:
  try:
   mod=importlib.util.module_from_spec(spec)
   spec.loader.exec_module(mod)
   signed=mod.report(repo,False)
   if not signed.get("valid") or signed.get("release_authorized"):
    failures.append("F10_ORIGINAL_CROSS_PHASE_RECERT_INCONSISTENT")
   if signed.get("f6_source_contract")!="PASS":
    failures.append("F6_SOURCE_CONTRACT_FAILED")
  except Exception:
   failures.append("F10_VERIFIER_ERROR")
 try:
  changed=git(repo,"diff","--name-only",F20,"HEAD").decode("utf-8").splitlines()
 except (ValueError,UnicodeDecodeError):
  changed=[];failures.append("F20_TO_HEAD_DELTA_UNAVAILABLE")
 # The reviewed PR's only application runtime delta is BFF strict response
 # field validation. All other changes are F21 tests/attestation artifacts.
 runtime=[x for x in changed if x.startswith(("apps/vox-web/","app/","services/","lib/"))
          and x!="apps/vox-web/package.json"]
 if runtime not in ([],["apps/vox-web/lib/ownerVendorVerification.ts"]):
  failures.append("UNREVIEWED_RUNTIME_DELTA:"+",".join(runtime))
 # The VOX manifest change is allowed only if it preserves every historical
 # script (including explicitly missing legacy scripts) and adds one genuine
 # internal test entrypoint. Never "fix" CI by deleting an old security test.
 try:
  old_pkg=json.loads(git(repo,"show",F20+":apps/vox-web/package.json"))
  new_pkg=json.loads((repo/"apps/vox-web/package.json").read_text("utf8"))
  original_scripts=old_pkg["scripts"]
  current_scripts=new_pkg["scripts"]
  expected_entry=("node ../../scripts/mvp/vox/validate-vox-final-internal-gates-20261030.mjs "
    "&& node ../../scripts/mvp/vox/validate-vox-02c-owner-auth200.harness.mjs "
    "&& node --test ../../scripts/mvp/launch/f21_owner_positive_synthetic.test.cjs")
  if (set(new_pkg)-{"scripts"}!=set(old_pkg)-{"scripts"} or
      any(new_pkg.get(k)!=v for k,v in old_pkg.items() if k!="scripts") or
      current_scripts.get("test:internal")!=expected_entry or
      {k:v for k,v in current_scripts.items() if k!="test:internal"}!=original_scripts):
   failures.append("UNAPPROVED_VOX_WEB_PACKAGE_DELTA")
 except (OSError,ValueError,KeyError,TypeError):
  failures.append("VOX_WEB_PACKAGE_PROOF_MISSING")
 try:
  e=json.loads((repo/"docs/launch/qf-f18-managed-sql-ledger-proof-20261107.json").read_text("utf8"))
  for item in e.get("versions",[]):
   p=repo/"supabase"/"migrations"/(item["version"]+"_"+item["name"]+".sql")
   if not p.is_file() or sha(p.read_bytes())!=item.get("localSourceSha256"):
    failures.append("UNPINNED_MANAGED_MIGRATION:"+str(item.get("version")))
 except Exception:failures.append("F18_MIGRATION_AUTHORITY_UNAVAILABLE")
 return {
  "schema":"quickfurno.f21.protected-source-lineage.v1",
  "reviewedIntegrationBase":F20,
  "historicalSourceAnchor":BASE,
  "firstVendorSenderAnchor":F7,
  "checkedProtectedPathCount":len(REQUIRED_PROTECTED),
  "protectedSourceSha256":protected_sha,
  "historicalFailedRuns":LEGACY_RUNS,
  "historicalOriginalChecksRemainUnwaived":True,
  "migrationSourceParityPinsPreserved":not any(x.startswith("UNPINNED_MANAGED_MIGRATION:") for x in failures),
  "reviewedChangedRuntimePaths":runtime,
  "newIntegratedReleaseApprovalGranted":False,
  "newLiveStagingCredentialsChecked":False,
  "realStagingDeploymentPerformed":False,
  "releaseVerdict":"HOLD",
  "mayDeployStaging":False,"maySendOtp":False,"mayDeployProduction":False,
  "valid":not failures,"failures":failures,
 }
if __name__=="__main__":
 ap=argparse.ArgumentParser()
 ap.add_argument("--repo",default=".")
 a=ap.parse_args()
 try:output=check(Path(a.repo).resolve())
 except Exception:output={"valid":False,"failures":["LOCAL_CERTIFIER_FAILED"],"releaseVerdict":"HOLD"}
 print(json.dumps(output,sort_keys=True))
 raise SystemExit(0 if output.get("valid") else 1)
