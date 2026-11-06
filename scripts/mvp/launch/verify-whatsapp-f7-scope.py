#!/usr/bin/env python3
"""Exact-source QuickFurno F7 sender-isolation and no-deploy scope policy."""
from pathlib import Path
import subprocess
import argparse

BASE="0d0aa496b97359feea10c3bd946e729eb71231b4"
ALLOWED={
 ".github/workflows/qf-f7-dedicated-whatsapp-auth.yml",
 "app/api/vendor/onboarding/complete/route.ts",
 "docs/launch/QF-F7-DEDICATED-WHATSAPP-AUTH-20261106.md",
 "lib/communication/vendorWhatsappOtpTransport.ts",
 "scripts/mvp/launch/verify-whatsapp-f7-scope.py",
 "scripts/mvp/vendor/vendor-dedicated-otp-transport.test.mjs",
 "services/anishaWhatsappOtpDeliveryService.ts",
 "services/returningWhatsappVendorLoginService.ts",
 "services/supabaseSendSmsHookService.ts",
 "services/vendorOtpEvidenceReadService.ts",
 "supabase/migrations/20261106113825_qf_f7_dormant_riya_anisha_auth_template_catalog.sql",
 "supabase/migrations/20261106114301_qf_f7_client_vendor_auth_copy_code_v2_inactive_bindings.sql",
}
NEEDED={
 "lib/communication/vendorWhatsappOtpTransport.ts",
 "services/anishaWhatsappOtpDeliveryService.ts",
 "services/supabaseSendSmsHookService.ts",
 "services/vendorOtpEvidenceReadService.ts",
 "app/api/vendor/onboarding/complete/route.ts",
 "services/returningWhatsappVendorLoginService.ts",
 "scripts/mvp/vendor/vendor-dedicated-otp-transport.test.mjs",
}
def audit(repo:Path,paths=None):
 issues=[]
 def read(p):
  try:return (repo/p).read_text(encoding="utf8")
  except OSError:
   issues.append("missing:"+p)
   return ""
 pure=read("lib/communication/vendorWhatsappOtpTransport.ts")
 svc=read("services/anishaWhatsappOtpDeliveryService.ts")
 hook=read("services/supabaseSendSmsHookService.ts")
 evidence=read("services/vendorOtpEvidenceReadService.ts")
 route=read("app/api/vendor/onboarding/complete/route.ts")
 returning=read("services/returningWhatsappVendorLoginService.ts")
 init=read("supabase/migrations/20261106113825_qf_f7_dormant_riya_anisha_auth_template_catalog.sql")
 binding=read("supabase/migrations/20261106114301_qf_f7_client_vendor_auth_copy_code_v2_inactive_bindings.sql")
 # Reuse the locked F6 canonical sender identity instead of duplicating
 # phone/WABA literals in the F7 vendor transport adapter.
 for val in ("WHATSAPP_AUTH_LANE_IDENTITIES","isExactWhatsappSenderForLane",
             "1640977640737783","qf_vendor_auth_otp",
             "AUTH_OTP_COPY_CODE","QF_VENDOR_META_QUALITY_RATING"):
  if val not in pure: issues.append("pure_missing:"+val)
 if pure.count("GREEN")==0:issues.append("quality_gate_not_green_only")
 for val in ("createRuntimeCommunicationService(vendorEnv)",
             "hasValidVendorAccountIdentity","isApprovedVendorOtpBinding",
             "isApprovedVendorAutomation"):
  if val not in svc:issues.append("missing_adapter_gate:"+val)
 for val in ("claimSignedAuthOtpPurpose","signedPurpose === \"vendor_login\"",
             "await deliverVendorWhatsappOtp(","canUseSignedClientOtpDispatch",
             "await deliverClientLoginOtp("):
  if val not in hook:issues.append("hook_missing:"+val)
 if "await deliverVendorWhatsappOtp(" not in hook or hook.index("claimSignedAuthOtpPurpose")>hook.index("await deliverVendorWhatsappOtp("):
  issues.append("unsigned_vendor_dispatch")
 for val in ('providerRequired !== VENDOR_OTP_PROVIDER_KEY',
             '.eq("provider_account_id", vendorAccountId)',
             'row.provider_account_id !== vendorAccountId'):
  if val not in evidence:issues.append("unbound_vendor_evidence:"+val)
 if 'return p==="meta_whatsapp_cloud" ? p : null' not in route:
  issues.append("legacy_signup_provider")
 if 'QF_VENDOR_TRUSTED_WHATSAPP_PROVIDER === "meta_whatsapp_cloud"' not in returning:
  issues.append("legacy_returning_provider")
 for text,name in ((init,"init"),(binding,"binding")):
  if "is_active = true" in text or "is_operationally_enabled = true" in text:
   # These phrases may appear in DENY assertions, not in SET statements.
   if "SET is_active = true" in text or "SET is_operationally_enabled = true" in text:
    issues.append("unauthorized_activation:"+name)
 if "'provider_mapping_required'" not in init or "false" not in init:
  issues.append("dormant_catalog_prestate")
 if "AUTH_OTP_COPY_CODE" not in binding or "is_active = false" not in binding:
  issues.append("binding_migration_not_dormant")
 for bad in ("fetch(","/messages","sendSms("):
  if bad in svc:issues.append("bypass_canonical_meta_sender:"+bad)
 if paths is not None:
  issues += ["unreviewed_changed_file:"+p for p in sorted(paths-ALLOWED)]
  issues += ["missing_required_change:"+p for p in sorted(NEEDED-paths)]
 return issues

def gitpaths(repo):
 return set(subprocess.check_output(
  ["git","-C",str(repo),"diff","--name-only",BASE+"...HEAD"],text=True
 ).splitlines())

if __name__=="__main__":
 parser=argparse.ArgumentParser()
 parser.add_argument("--repo",type=Path,default=Path("."))
 parser.add_argument("--exact-git-diff",action="store_true")
 a=parser.parse_args()
 problems=audit(a.repo,gitpaths(a.repo) if a.exact_git_diff else None)
 print("F7_TWO_SENDER_SCOPE_"+("FAIL" if problems else "PASS")+" "+str(problems))
 raise SystemExit(bool(problems))
