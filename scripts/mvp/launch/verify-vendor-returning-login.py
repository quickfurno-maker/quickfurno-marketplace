#!/usr/bin/env python3
"""Fail-closed, exact-source F5 vendor returning WhatsApp login review gate."""
import argparse, hashlib, json, subprocess
from pathlib import Path

BASE = "abbfcbd7cb432ef3d2b72b5ddc6ae4003d05de5d"
POLICY = "quickfurno.f5.vendor-returning-whatsapp-login-no-deploy.v1"
FILES = {
 "app/api/vendor/auth/login/request-otp/route.ts":"e39b4a84ffd6ad8dd3f6c63e992d401b2caf7d49ff556354efb0ab8181092ab4",
 "app/api/vendor/auth/login/verify-otp/route.ts":"883ce4ffb207d5ecec470302511b25081084e492422cdcfc7d92f93557419a45",
 "components/vendor/VendorPortal.tsx":"09dab7b5ffbe1e1194a0358b430bbaaead6e362fd81a4c81a0d03b79d9742862",
 "components/vendor/VendorWhatsappLoginForm.tsx":"7192f644cb8ed13bb737afa582d18281adf3099d8766ac145b05adb92d2bd411",
 "lib/vendors/vendorReturningLoginPolicy.ts":"d8e1dee57015951433a674a3352e24b0f9c5598f05f923df8e7a99f8a8e8e3fe",
 "services/returningWhatsappVendorLoginService.ts":"a02d9ccc9f209b16497666a3c1341fee33d3e2791de7e49220296a71a6363ec2",
 "scripts/mvp/vendor/vendor-returning-login.test.mjs":"325e23652cc9bcff84afdfab804784e7494108359647e489679d2e4140b16fae",
 "scripts/mvp/launch/smoke-vendor-returning-login.mjs":"5e283659b04984a75484e0a5c49f00c42d9206cbb2821a6ebf99a763592f7113",
}
META = {
 ".github/workflows/qf-f5-vendor-returning-login.yml",
 "docs/launch/F5-VENDOR-RETURNING-WHATSAPP-LOGIN-20261106.md",
 "docs/launch/f5-vendor-returning-login-manifest.json",
 "scripts/mvp/launch/verify-vendor-returning-login.py",
 "scripts/mvp/launch/test_vendor_returning_login_scope.py",
}
FLAGS = (
 "release_authorized", "staging_deployed", "production_deployed",
 "meta_sender_certified", "live_otp_delivered", "owner_approved",
 "scanner_certified", "staff_activated",
)
MANIFEST = "docs/launch/f5-vendor-returning-login-manifest.json"

def sha(data):
    return hashlib.sha256(data.replace(b"\r\n",b"\n")).hexdigest()

def failures(repo, changed=None):
    repo = Path(repo).resolve()
    bad = []
    try: m = json.loads((repo/MANIFEST).read_text(encoding="utf8"))
    except (OSError,ValueError): return ["manifest_missing"]
    if m.get("policy") != POLICY or m.get("base_sha") != BASE:
        bad.append("bad_policy_or_base")
    for f in FLAGS:
        if m.get(f) is not False: bad.append("release_switch_enabled:"+f)
    rows = m.get("files",[])
    if not isinstance(rows,list): return bad+["invalid_files"]
    seen = set()
    for item in rows:
        if not isinstance(item,dict) or not isinstance(item.get("path"),str):
            bad.append("invalid_file_record"); continue
        name=item["path"]
        if name in seen or name not in FILES:
            bad.append("unapproved_path:"+name); continue
        seen.add(name)
        if item.get("sha256") != FILES.get(name):
            bad.append("source_pin_drift:"+name)
        if not (repo/name).is_file() or sha((repo/name).read_bytes()) != FILES.get(name):
            bad.append("source_modified:"+name)
    if seen != set(FILES): bad.append("missing_source_files")
    try:
        r=(repo/"app/api/vendor/auth/login/request-otp/route.ts").read_text(encoding="utf8")
        v=(repo/"app/api/vendor/auth/login/verify-otp/route.ts").read_text(encoding="utf8")
        s=(repo/"services/returningWhatsappVendorLoginService.ts").read_text(encoding="utf8")
        ui=(repo/"components/vendor/VendorWhatsappLoginForm.tsx").read_text(encoding="utf8")
        policy=(repo/"lib/vendors/vendorReturningLoginPolicy.ts").read_text(encoding="utf8")
        signup=(repo/"app/api/vendor/onboarding/complete/route.ts").read_text(encoding="utf8")
        evidence=(repo/"app/api/vendor/private-evidence/route.ts").read_text(encoding="utf8")
        owner=(repo/"app/api/vox/v1/owner-vendor-verification-case/route.ts").read_text(encoding="utf8")
        checks={
          "no_auth_user_creation":"shouldCreateUser:false" in r,
          "signed_reservation":"reserveAuthOtpPurpose" in r and "coordinateVendorOtpRequest" in r,
          "private_owner_preflight":"eligibleReturningVendorPhone" in r and
             "maySendReturningVendorOtp" in s,
          "request_non_enumeration":'OTP_REQUEST_ACCEPTED' in r and 'deliveryConfirmed:false' in r,
          "mandatory_local_staging_gate":'QF_RUNTIME_ENV === "staging"' in s,
          "meta_verified_only":'QF_VENDOR_TRUSTED_WHATSAPP_PROVIDER === "meta_whatsapp"' in s,
          "validated_real_otp":'verifyVendorSignupWhatsappOtp' in s,
          "canonical_membership":'resolveVendorAccess(verified.authUserId)' in s,
          "signed_auth_revalidation":'sb.auth.getUser()' in s,
          "denial_local_signout":'invalidateLocalSession(sb)' in s,
          "brute_force_guard":'allowPublicMutation' in v,
          "safe_post_verify_return":'redirectTo:"/vendor/dashboard"' in v,
          "no_client_provider_credentials":'signInWithOtp(' not in ui and 'verifyOtp(' not in ui,
          "no_dummy_sender":'deliveryConfirmed !== false' in ui,
          "no_self_approval":'owner_approved' not in s and 'grantCredits' not in s,
          "strict_membership":'c.membershipStatus !== "active"' in policy,
          "legacy_atomic_pending":'enrollPendingVendorAfterWhatsappOtp' in signup,
          "private_document_hold":'pending_scan_and_owner_review' in evidence,
          "owner_review_core":'qf_owner_record_vendor_verification_decision' in owner,
        }
        bad.extend("missing_security_contract:"+k for k,ok in checks.items() if not ok)
    except OSError: bad.append("dependency_read_failed")
    if changed is not None:
        bad.extend("unlisted_diff:"+f for f in changed-(set(FILES)|META))
        bad.extend("missing_changed_source:"+f for f in set(FILES)-changed)
    return sorted(set(bad))

def git_diff(repo):
    text=subprocess.check_output(["git","-C",str(repo),"diff","--name-only",BASE+"...HEAD"],text=True)
    return set(text.splitlines())

if __name__ == "__main__":
    p=argparse.ArgumentParser()
    p.add_argument("--repo",type=Path,default=Path("."))
    p.add_argument("--exact-git-diff",action="store_true")
    args=p.parse_args()
    bad=failures(args.repo,git_diff(args.repo) if args.exact_git_diff else None)
    print(json.dumps({"policy":POLICY,"valid":not bad,"release_authorized":False,"failures":bad},indent=2))
    raise SystemExit(1 if bad else 0)
