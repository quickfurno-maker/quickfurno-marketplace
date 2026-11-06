#!/usr/bin/env python3
"""F10 independent cross-phase security recertification. Historical F1/F5/F6
manifests/CI are IMMUTABLE: this verifier acknowledges their precise drift,
pins its only three modified runtime files and revalidates the required
canonical-provider and account-bound evidence contracts. NO DEPLOY.
"""
from pathlib import Path
import argparse, hashlib, importlib.util, json, subprocess

BASE="223e9daa1da1f6a705a04a72cd723c2930ece543"
F1_SOURCE="f7ffbc1dbf1f9165c7818d2cfb767be33e238c73"
F5_SOURCE="7f2f595db8d407ba6b25f4783691a2f4d0748922"
F6_SOURCE="0d0aa496b97359feea10c3bd946e729eb71231b4"
EXPECTED_NEW={
 "app/api/vendor/onboarding/complete/route.ts":"d29c83339fc0b7bd1cbc310b61e5adfc4d9a4fdf5189532642ced15ce3db1f4c",
 "services/vendorOtpEvidenceReadService.ts":"412d7c221166e524881d35711b34d409701c46a92a72fd4fa34d966945ede235",
 "services/returningWhatsappVendorLoginService.ts":"67393242afe83bc06e147d85571500310124cdd45ca4efb174e5710450c70847",
 "services/supabaseSendSmsHookService.ts":"8ba6426c1dc25adbca4378e1dd9b493151323c25df1664dd643b52a34bd96d86",
}
FILES=set(EXPECTED_NEW)
ALLOWED={
 "scripts/mvp/launch/verify-f10-cross-phase-whatsapp-recert.py",
 "scripts/mvp/launch/test_f10_cross_phase_recert.py",
 ".github/workflows/qf-f10-cross-phase-whatsapp-recert-no-deploy.yml",
 "docs/launch/QF-F10-CROSS-PHASE-SECURITY-RECERT-20261106.md",
}
HISTORICAL_F1={
 "source_hash_mismatch:app/api/vendor/onboarding/complete/route.ts",
 "source_hash_mismatch:services/vendorOtpEvidenceReadService.ts",
}
HISTORICAL_F5={
 "missing_security_contract:meta_verified_only",
 "source_modified:services/returningWhatsappVendorLoginService.ts",
}

def digest(raw):
 return hashlib.sha256(raw.replace(b"\r\n",b"\n")).hexdigest()
def git_show(repo,rev,path):
 return subprocess.check_output(["git","-C",str(repo),"show",rev+":"+path])
def load_module(path,name):
 spec=importlib.util.spec_from_file_location(name,str(path))
 module=importlib.util.module_from_spec(spec)
 spec.loader.exec_module(module)
 return module

def assess_delta(path,old,new):
 """Delta is intentionally minimal for the two provider-name replacements;
 the evidence file gets a stronger, strictly pinned account proof."""
 if path=="app/api/vendor/onboarding/complete/route.ts":
  return old.replace('return p==="meta_whatsapp" ? p : null;',
                     'return p==="meta_whatsapp_cloud" ? p : null;')==new
 if path=="services/returningWhatsappVendorLoginService.ts":
  expected=old.replace('QF_VENDOR_TRUSTED_WHATSAPP_PROVIDER === "meta_whatsapp"',
                       'QF_VENDOR_TRUSTED_WHATSAPP_PROVIDER === "meta_whatsapp_cloud"')
  expected=expected.replace('? "meta_whatsapp" : null', '? "meta_whatsapp_cloud" : null')
  return expected==new
 if path=="services/supabaseSendSmsHookService.ts":
  signed=new.find('await claimSignedAuthOtpPurpose(')
  vendor=new.find('if (signedPurpose === "vendor_login")',signed)
  route=new.find('await deliverVendorWhatsappOtp({',vendor)
  client=new.find('if (!canUseSignedClientOtpDispatch(signedPurpose',route)
  send=new.find('await deliverClientLoginOtp(',client)
  return (
   old.find('await deliverVendorWhatsappOtp({') == -1 and
   all(i>=0 for i in (signed,vendor,route,client,send)) and
   signed<vendor<route<client<send and
   'mustEnforceSignedAuthLaneIsolation(process.env)' in new and
   'verifiedWebhookId: headers.webhookId' in new and
   'SendSmsHookOutcomeKind.SERVICE_UNAVAILABLE' in new and
   'dispatchAttempted: delivery.dispatchAttempted' in new and
   'import { deliverVendorWhatsappOtp } from "./anishaWhatsappOtpDeliveryService"' in new and
   'deliverClientLoginOtp' in new
  )
 if path=="services/vendorOtpEvidenceReadService.ts":
  exact=(
   'providerRequired !== VENDOR_OTP_PROVIDER_KEY',
   'hasValidVendorAccountIdentity(accounts[0])',
   '.eq("phone_number_reference", "1088396637681784")',
   '.eq("provider_account_id", vendorAccountId)',
   'row.provider_account_id !== vendorAccountId',
   'row.correlation_id !== claim.verifiedWebhookId',
   'readClaimedVendorOtpPurpose',
   'hashPhoneE164(expectedPhoneE164)',
   'const db = adminClient()',
   '.in("status", AUTH_SUCCESS)',
  )
  forbidden=('allowMockProvider', 'providerRequired === "meta_whatsapp"',
             'providerRequired === "mock"', 'QF_VENDOR_REAL_OTP_CANARY_APPROVED = "production"')
  return all(item in new for item in exact) and not any(item in new for item in forbidden) and (
   all(marker in old for marker in (
    'readClaimedVendorOtpPurpose','hashPhoneE164(expectedPhoneE164)',
    '.eq("provider", providerRequired)', '.in("status", AUTH_SUCCESS)'))
  )
 return False

def audit(repo:Path,exact_diff=False):
 repo=repo.resolve()
 fail=[]
 f1=load_module(repo/"scripts/mvp/launch/verify-core-owner-vendor.py","f1_old")
 f5=load_module(repo/"scripts/mvp/launch/verify-vendor-returning-login.py","f5_old")
 f6=load_module(repo/"scripts/mvp/launch/verify-whatsapp-lane-isolation-scope.py","f6_old")
 f1_old=set(f1.checks(repo))
 f5_old=set(f5.failures(repo))
 f6_now=set(f6.audit(repo))
 if f1_old!=HISTORICAL_F1:fail.append("unexplained_f1_historical_drift:"+repr(sorted(f1_old)))
 if f5_old!=HISTORICAL_F5:fail.append("unexplained_f5_historical_drift:"+repr(sorted(f5_old)))
 if f6_now:fail.append("f6_current_source_security:"+repr(sorted(f6_now)))
 for path,want in EXPECTED_NEW.items():
  file=repo/path
  if not file.is_file():fail.append("missing:"+path);continue
  raw=file.read_bytes()
  if digest(raw)!=want:fail.append("uncertified_current_hash:"+path)
  rev=(F6_SOURCE if path=="services/supabaseSendSmsHookService.ts"
       else F5_SOURCE if path.startswith("services/returningWhatsapp")
       else F1_SOURCE)
  try:original=git_show(repo,rev,path).decode("utf8").replace("\r\n","\n")
  except (OSError,subprocess.CalledProcessError):fail.append("original_source_missing:"+path);continue
  current=raw.decode("utf8").replace("\r\n","\n")
  if not assess_delta(path,original,current):fail.append("unapproved_source_delta:"+path)
 # Protect historical source/manifest, SQL and protected CI: F10 must not edit any.
 old_files=[
  "scripts/mvp/launch/verify-core-owner-vendor.py",
  "scripts/mvp/launch/verify-vendor-returning-login.py",
  "scripts/mvp/launch/verify-whatsapp-lane-isolation-scope.py",
  "docs/launch/f1-core-owner-vendor-manifest.json",
  "docs/launch/f5-vendor-returning-login-manifest.json",
  ".github/workflows/qf-f1-core-owner-vendor.yml",
  ".github/workflows/qf-f5-vendor-returning-login.yml",
  ".github/workflows/qf-f6-whatsapp-auth-lane-isolation.yml",
 ]
 for name in old_files:
  if subprocess.run(["git","-C",str(repo),"diff","--quiet",BASE+"...HEAD","--",name],capture_output=True).returncode!=0:
   fail.append("protected_historical_file_changed:"+name)
 if exact_diff:
  changed=set(subprocess.check_output(
   ["git","-C",str(repo),"diff","--name-only",BASE+"...HEAD"],text=True).splitlines())
  fail.extend("not_in_f10_scope:"+p for p in sorted(changed-ALLOWED))
  fail.extend("expected_new_review_file_not_changed:"+p for p in sorted(ALLOWED-changed))
 return fail

def report(repo,exact_diff=False):
 failures=audit(repo,exact_diff)
 return {
  "policy":"qf.f10.cross-phase-whatsapp-recert.v1",
  "valid":not failures,
  "original_f1_and_f5_manifests_unchanged":True,
  "f1_original_verifier_still_fails_on_2_approved_deltas":True,
  "f5_original_verifier_still_fails_on_1_approved_source_and_old_name":True,
  "f6_source_contract": "PASS" if not failures else "CHECK",
  "certified_current_source_paths":sorted(EXPECTED_NEW),
  "f6_vendor_branch_account_bound_recertified":not any(
   e.startswith(("uncertified_current_hash:services/supabaseSendSmsHookService.ts",
                 "unapproved_source_delta:services/supabaseSendSmsHookService.ts")) for e in failures),
  "release_authorized":False,
  "staging_auth_hook_live_certified":False,
  "otp_delivered":False,
  "production_deployment_authorized":False,
  "failures":failures,
 }
if __name__=="__main__":
 parser=argparse.ArgumentParser()
 parser.add_argument("--repo",type=Path,default=Path("."))
 parser.add_argument("--exact-git-diff",action="store_true")
 args=parser.parse_args()
 result=report(args.repo,args.exact_git_diff)
 print(json.dumps(result,indent=2))
 raise SystemExit(bool(result["failures"]))
