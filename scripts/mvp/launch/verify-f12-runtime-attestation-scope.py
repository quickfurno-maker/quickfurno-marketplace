#!/usr/bin/env python3
"""F12 exact six-file NO DEPLOY scope, with immutable sanitized Staging evidence."""
from pathlib import Path
import argparse,json,subprocess

BASE="73c2c822bb04d1953d8c5155b75372964cbacd9a"
ALLOWED={
 "scripts/mvp/launch/f12-core-runtime-release-gate.mjs",
 "scripts/mvp/launch/f12-core-runtime-release-gate.test.mjs",
 "scripts/mvp/launch/verify-f12-runtime-attestation-scope.py",
 ".github/workflows/qf-f12-staging-runtime-attestation-no-deploy.yml",
 "docs/launch/qf-f12-staging-core-attestation-20261106.json",
 "docs/launch/QF-F12-STAGING-CORE-RUNTIME-DRIFT-20261106.md",
}
def audit(repo,changed=None):
 problems=[]
 try:
  js=(repo/"scripts/mvp/launch/f12-core-runtime-release-gate.mjs").read_text("utf8")
  tst=(repo/"scripts/mvp/launch/f12-core-runtime-release-gate.test.mjs").read_text("utf8")
  raw=(repo/"docs/launch/qf-f12-staging-core-attestation-20261106.json").read_text("utf8")
  data=json.loads(raw)
  doc=(repo/"docs/launch/QF-F12-STAGING-CORE-RUNTIME-DRIFT-20261106.md").read_text("utf8")
  for marker in ("STALE_VENDOR_WABA","OLD_VENDOR_WABA_PAIRED_WITH_ANISHA_PHONE",
                 "STAGING_IMAGE_STALE_OCT30","RUNTIME_ENV_MISSING_",
                 "META_REGISTERED_CALLBACK_URI_UNVERIFIED",
                 "releaseVerdict:\"HOLD\"","maySendOtp:false",
                 "mayDeployProduction:false","actualSupabaseAuthHookUriVerified"):
   if marker not in js:problems.append("failclosed_policy_missing:"+marker)
  for forbidden in ("fetch(", "exec(", "spawn(", "writeFile", "process.env", "child_process"):
   if forbidden in js:problems.append("policy_with_side_effect:"+forbidden)
  if "F12-22" not in tst:problems.append("hostile_tests_missing")
  expected={"schema":"quickfurno.f12.observed-staging-core.v1",
    "networkExecuted":True,"containerName":"qf-core-staging",
    "imageTag":"qf-core-staging:09b9d7a4",
    "deployedDefaultSender":"STALE_VENDOR_WABA",
    "vendorPairExact":False,"coreCallbackHost":"staging-core.quickfurno.in",
    "metaGetHttp":403,"metaGetTls":0,
    "authHookGetHttp":405,"authHookGetTls":0,
    "actualMetaRegisteredCallbackVerified":False,
    "actualSupabaseAuthHookUriVerified":False,
    "signedWebhookEndToEndVerified":False,
    "vendorMetaQuality":"RED","ownerStageGo":False}
  for k,v in expected.items():
   if data.get(k)!=v:problems.append("snapshot_value_not_verified:"+k)
  required={
   "WHATSAPP_ACCESS_TOKEN","WHATSAPP_WABA_ID","WHATSAPP_PHONE_NUMBER_ID"}
  if set(data.get("envNames",[]))!=required:
   problems.append("snapshot_env_names_not_sanitized")
  if any(k.lower().endswith(("secret","password","token","key"))
         for k in data if k!="envNames"):
   problems.append("snapshot_secret_value_key")
  if "39 commits" not in doc or "227 changed paths" not in doc:
   problems.append("release_delta_not_recorded")
  if "No production deployment occurred" not in doc and "Production unchanged" not in doc:
   problems.append("no_production_proof_missing")
 except (OSError,ValueError,TypeError) as e:
  problems.append("required_f12_file_missing_or_invalid:"+type(e).__name__)
 if changed is not None:
  problems += ["out_of_scope:"+p for p in sorted(changed-ALLOWED)]
  problems += ["required_file_not_changed:"+p for p in sorted(ALLOWED-changed)]
  for p in changed:
   if p.startswith(("app/","services/","lib/","supabase/")):
    problems.append("runtime_or_migration_modified:"+p)
 return problems
if __name__=="__main__":
 p=argparse.ArgumentParser()
 p.add_argument("--repo",type=Path,default=Path("."))
 p.add_argument("--exact-git-diff",action="store_true")
 a=p.parse_args()
 changed=None
 if a.exact_git_diff:
  changed=set(subprocess.check_output(
   ["git","-C",str(a.repo),"diff","--name-only",BASE+"...HEAD"],text=True).splitlines())
 errors=audit(a.repo,changed)
 print("F12_STAGING_RUNTIME_NO_DEPLOY_SCOPE_"+("FAIL" if errors else "PASS")+" "+repr(errors))
 raise SystemExit(bool(errors))
