#!/usr/bin/env python3
"""QuickFurno F11: strict, no-deploy signed webhook preflight scope.

Only independent QA/runbook additions. No runtime code, Meta token, secret,
Cloudflare configuration, Supabase Auth Hook configuration, or DB mutation.
"""
from pathlib import Path
import argparse,subprocess

BASE="5aa60a67c0745237b15b90277c8079dc0f2b4f35"
ALLOWED={
 "scripts/mvp/vendor/vendor-signed-callback-preflight.test.mjs",
 "scripts/mvp/launch/f11-callback-perimeter-policy.mjs",
 "scripts/mvp/launch/f11-callback-perimeter-policy.test.mjs",
 "scripts/mvp/launch/probe-f11-callbacks-no-send.mjs",
 "scripts/mvp/launch/verify-f11-signed-callback-preflight-scope.py",
 ".github/workflows/qf-f11-signed-staging-callback-no-send.yml",
 "docs/launch/QF-F11-STAGING-SIGNED-CALLBACK-PREFLIGHT-20261106.md",
}
NEEDED=ALLOWED.copy()
def checks(repo:Path,changed=None):
 errors=[]
 try:
  policy=(repo/"scripts/mvp/launch/f11-callback-perimeter-policy.mjs").read_text("utf8")
  probe=(repo/"scripts/mvp/launch/probe-f11-callbacks-no-send.mjs").read_text("utf8")
  crypto=(repo/"scripts/mvp/vendor/vendor-signed-callback-preflight.test.mjs").read_text("utf8")
  tests=(repo/"scripts/mvp/launch/f11-callback-perimeter-policy.test.mjs").read_text("utf8")
  doc=(repo/"docs/launch/QF-F11-STAGING-SIGNED-CALLBACK-PREFLIGHT-20261106.md").read_text("utf8")
  for required in (
   '"/api/webhooks/whatsapp/meta"','"/api/auth/hooks/supabase-send-sms"',
   "F11_OWNER_PROTECTED", "F11_DECISION_HOLD", "maySendOtp:false",
   "mayDeployProduction:false", 'owner.toUpperCase()+"_CLOUDFLARE_ACCESS_INTERCEPTED"'
  ):
   if required not in policy:errors.append("perimeter_policy_missing:"+required)
  for required in (
   'method:"GET"','redirect:"manual"',
   'networkExecuted:false', 'NO_SIGNED_EVENT', 'configuredHookUrlsVerified:false'
  ):
   if required not in probe and required!="NO_SIGNED_EVENT":
    errors.append("probe_not_failclosed:"+required)
  if 'fetch(' in policy or 'process.env' in policy:
   errors.append("pure_policy_network_or_secret_access")
  if "method:\"POST\"" in probe or "redirect:\"follow\"" in probe:
   errors.append("dangerous_probe_method")
  if 'process.env' in crypto:
   errors.append("signed_callback_test_reads_real_secrets")
  for required in ("StandardWebhooksSignatureVerifier","verifyMetaWebhookSignatureBytes",
                   "decideCallbackIdentityRegistry","wh.sign(", "client.phoneNumberId",
                   "vendor.phoneNumberId"):
   if required not in crypto:errors.append("crypto_proof_missing:"+required)
  if 'F11-R28' not in tests or 'F11-28' not in crypto:
   errors.append("test_inventory_incomplete")
  for required in ("quality RED","not confirm the actual","two callback paths",
                   "Cloudflare Access","No production"):
   if required.lower() not in doc.lower():errors.append("operator_runbook_missing:"+required)
  if "cloudflareaccess.com" in probe and "noPost:true" not in probe:
   errors.append("no_send_evidence_missing")
 except OSError as e:
  errors.append("missing_required_source:"+type(e).__name__)
 if changed is not None:
  errors.extend("unapproved_path:"+x for x in sorted(changed-ALLOWED))
  errors.extend("required_file_not_changed:"+x for x in sorted(NEEDED-changed))
  for name in changed:
   if (name.startswith(("app/","lib/","services/","supabase/")) or
       name in (".github/workflows/qf-f1-core-owner-vendor.yml",
                ".github/workflows/qf-f5-vendor-returning-login.yml",
                ".github/workflows/qf-f6-whatsapp-auth-lane-isolation.yml")):
    errors.append("protected_runtime_or_prior_ci_changed:"+name)
 return errors
if __name__=="__main__":
 p=argparse.ArgumentParser()
 p.add_argument("--repo",type=Path,default=Path("."))
 p.add_argument("--exact-git-diff",action="store_true")
 args=p.parse_args()
 changed=None
 if args.exact_git_diff:
  changed=set(subprocess.check_output(["git","-C",str(args.repo),"diff","--name-only",BASE+"...HEAD"],text=True).splitlines())
 errors=checks(args.repo,changed)
 print("F11_SIGNED_CALLBACK_NO_SEND_SCOPE_"+("FAIL" if errors else "PASS")+" errors="+repr(errors))
 raise SystemExit(bool(errors))
