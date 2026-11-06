#!/usr/bin/env python3
"""F6 exact isolated source-only sender partition: no unrelated Core, Riya or Staff modifications."""
import argparse
import subprocess
from pathlib import Path

BASE="7f2f595db8d407ba6b25f4783691a2f4d0748922"
ALLOWED={
 "lib/communication/whatsappAuthLaneIsolation.ts",
 "services/supabaseSendSmsHookService.ts",
 "scripts/mvp/vendor/vendor-whatsapp-lane-isolation.test.mjs",
 "scripts/mvp/launch/verify-whatsapp-lane-isolation-scope.py",
 ".github/workflows/qf-f6-whatsapp-auth-lane-isolation.yml",
 "docs/launch/QF-F6-WHATSAPP-CLIENT-VENDOR-LANE-ISOLATION-20261106.md",
}
REQUIRED={
 "lib/communication/whatsappAuthLaneIsolation.ts",
 "services/supabaseSendSmsHookService.ts",
 "scripts/mvp/vendor/vendor-whatsapp-lane-isolation.test.mjs",
}
def audit(repo:Path,changed=None):
 bad=[]
 try:
  policy=(repo/"lib/communication/whatsappAuthLaneIsolation.ts").read_text(encoding="utf8")
  hook=(repo/"services/supabaseSendSmsHookService.ts").read_text(encoding="utf8")
  for expected in ("27861262223494153","1333595106493545","1569174604351612","1088396637681784","qf_client_auth_otp","qf_vendor_auth_otp"):
   if expected not in policy:bad.append("missing_lane_identity:"+expected)
  if "canUseSignedClientOtpDispatch(signedPurpose" not in hook:bad.append("no_actual_hook_guard")
  if "claimSignedAuthOtpPurpose" not in hook:bad.append("unsigned_hook")
  if "SendSmsHookOutcomeKind.SERVICE_UNAVAILABLE" not in hook:bad.append("no_fenced_hook_hold")
  if "deliverClientLoginOtp" not in hook:bad.append("client_hook_removed")
  if "deliverVendorLoginOtp" in hook:bad.append("unreviewed_vendor_send")
 except OSError:
  bad.append("missing_required_source")
 if changed is not None:
  bad += ["unapproved_path:"+x for x in sorted(changed-ALLOWED)]
  bad += ["missing_changed_path:"+x for x in sorted(REQUIRED-changed)]
 return bad

def gitdiff(repo:Path):
 return set(subprocess.check_output(["git","-C",str(repo),"diff","--name-only",BASE+"...HEAD"],text=True).splitlines())

if __name__=="__main__":
 p=argparse.ArgumentParser()
 p.add_argument("--repo",type=Path,default=Path("."))
 p.add_argument("--exact-git-diff",action="store_true")
 a=p.parse_args()
 bad=audit(a.repo,gitdiff(a.repo) if a.exact_git_diff else None)
 print(f"F6_SENDER_LANE_SCOPE_{'FAIL' if bad else 'PASS'} failures={bad} base={BASE}")
 raise SystemExit(bool(bad))
