#!/usr/bin/env python3
"""Fail-closed 6 Nov vendor-only UI source manifest / Core bridge gate."""
import argparse
import hashlib
import json
import subprocess
from pathlib import Path

SOURCE_SHA = "f7ffbc1dbf1f9165c7818d2cfb767be33e238c73"
BASE_SHA = "e44d4d1552431d7aaf1d03fb674c1dcef8f6e7db"
POLICY = "quickfurno.f2.vendor-whatsapp-ui-no-deploy.v1"
EXPECTED = {
    "app/vendor/page.tsx":
        "13d5de3ebd20048e68a5a34dc096ae62937879ef0c165df34d09c38b17252ae4",
    "components/VendorRegisterForm.tsx":
        "76dcf01dde730733740cc7ef2a93b2cba21d9692a0d85d95665942517c2a06e1",
    "components/vendor/VendorPrivateEvidenceForm.tsx":
        "b340ae0c3ef418ffb5439d135f22bb31c89d5d568fc96ed01653046e29d95ec8",
    "lib/vendors/vendorSignupUi.ts":
        "8996d8c354968432d9923f02bfba789fca9a9bfb7dacc0c7903bea98fbd1a12b",
}
FORM_DONOR_SHA = "b3b59d59b39040a2f1883968ce4780e3600cf250e78bde3c1a89a28aebeaf4a7"
ARTIFACTS = {
    "docs/launch/F2-VENDOR-WHATSAPP-FRONTEND-20261106.md",
    "docs/launch/f2-vendor-frontend-manifest.json",
    ".github/workflows/qf-f2-vendor-frontend.yml",
    "scripts/mvp/launch/verify-vendor-frontend.py",
    "scripts/mvp/launch/test_vendor_frontend_scope.py",
    "scripts/mvp/launch/smoke-vendor-frontend.mjs",
    "scripts/mvp/vendor/vendor-phase2-ui-contract.test.mjs",
}
MANIFEST = Path("docs/launch/f2-vendor-frontend-manifest.json")

def digest(content: bytes) -> str:
    return hashlib.sha256(content.replace(b"\r\n", b"\n")).hexdigest()

def failures(repo: Path, changed: set[str] | None = None):
    repo = repo.resolve()
    errors = []
    try:
        m = json.loads((repo / MANIFEST).read_text(encoding="utf8"))
    except (OSError, ValueError):
        return ["manifest_missing"]
    if m.get("policy") != POLICY or m.get("source_sha") != SOURCE_SHA or m.get("base_sha") != BASE_SHA:
        errors.append("bad_source_pin")
    for flag in ("production_authorized", "staging_deployed",
                 "provider_delivery_certified", "owner_approval_authorized",
                 "staff_activation_authorized", "scanner_certified",
                 "legacy_password_signup_authorized"):
        if m.get(flag) is not False:
            errors.append("unsafe_release_flag:" + flag)
    if m.get("code_files") != len(EXPECTED):
        errors.append("code_file_count")
    if m.get("expected_paths") != sorted(EXPECTED):
        errors.append("scope_manifest_drift")
    records = m.get("files", [])
    if not isinstance(records, list):
        return errors + ["bad_records"]
    seen = set()
    for row in records:
        if not isinstance(row, dict) or not isinstance(row.get("path"), str):
            errors.append("invalid_file_record"); continue
        path = row["path"]
        if Path(path).is_absolute() or ".." in Path(path).parts or path in seen:
            errors.append("invalid_path"); continue
        seen.add(path)
        if path not in EXPECTED or row.get("sha256") != EXPECTED.get(path):
            errors.append("unexpected_source_file:" + path)
        if path == "components/VendorRegisterForm.tsx" and (
            row.get("overlay") != "pending-vendor-login-safety" or
            row.get("donor_sha256") != FORM_DONOR_SHA):
            errors.append("unreviewed_signup_overlay")
        absolute = repo / path
        if not absolute.is_file() or digest(absolute.read_bytes()) != EXPECTED.get(path):
            errors.append("modified_or_missing_source:" + path)
    if seen != set(EXPECTED):
        errors.append("incomplete_source_files")
    try:
        form = (repo / "components/VendorRegisterForm.tsx").read_text(encoding="utf8")
        helper = (repo / "lib/vendors/vendorSignupUi.ts").read_text(encoding="utf8")
        evidence = (repo / "components/vendor/VendorPrivateEvidenceForm.tsx").read_text(encoding="utf8")
        page = (repo / "app/vendor/page.tsx").read_text(encoding="utf8")
        redirect = (repo / "app/vendors/register/page.tsx").read_text(encoding="utf8")
        request = (repo / "app/api/vendor/onboarding/request-otp/route.ts").read_text(encoding="utf8")
        complete = (repo / "app/api/vendor/onboarding/complete/route.ts").read_text(encoding="utf8")
        private = (repo / "app/api/vendor/private-evidence/route.ts").read_text(encoding="utf8")
        required_form = [
            '/api/vendor/onboarding/request-otp',
            '/api/vendor/onboarding/complete',
            'registration_consent_accepted: f.registrationConsent',
            'isValidOptionalGstin(f.gstNumber)',
            'google_place_id:',
            'isPlaceCompatibleWithSelectedCity',
            'otpRequested',
            'VendorPrivateEvidenceForm',
        ]
        for value in required_form:
            if value not in form:
                errors.append("form_contract_missing:" + value)
        if 'submitVendorAccountRegistration' in form or 'type="password"' in form:
            errors.append("password_signup_resurrected")
        if 'Go to vendor login' in form or (
            "WhatsApp-only accounts do not have an email/password login" not in form):
            errors.append("pending_vendor_login_misrepresented")
        if 'deliveryConfirmed===false' not in helper or 'status===202' not in helper:
            errors.append("delivery_claim_unsafe")
        if 'pending_scan_and_owner_review' not in helper or 'p.approved===false' not in helper:
            errors.append("unverified_approval_claim")
        if 'office_proof' not in evidence or 'category_proof' not in evidence:
            errors.append("unbounded_evidence_kind")
        if '/api/vendor/private-evidence' not in evidence or 'identityConsent' not in evidence:
            errors.append("evidence_private_route_missing")
        if 'aadhaar_number' in form.lower() or 'pan_number' in form.lower():
            errors.append("public_raw_id_field")
        if 'New Vendor Signup' not in page and 'VendorPortal' not in page:
            errors.append("canonical_portal_missing")
        if 'redirect("/vendor?mode=signup")' not in redirect:
            errors.append("legacy_bookmark_break")
        if 'QF_VENDOR_OTP_REQUEST_MODE' not in request or 'QF_VENDOR_WHATSAPP_PROVIDER_CERTIFIED' not in request:
            errors.append("request_provider_gate_missing")
        if 'QF_VENDOR_ATOMIC_SIGNUP_MODE' not in complete or 'QF_VENDOR_WHATSAPP_PROVIDER_CERTIFIED' not in complete:
            errors.append("atomic_provider_gate_missing")
        if 'QF_VENDOR_PRIVATE_EVIDENCE_MODE' not in private:
            errors.append("evidence_upload_gate_missing")
    except OSError:
        errors.append("missing_runtime_dependent_source")
    if changed is not None:
        for f in changed - (set(EXPECTED) | ARTIFACTS):
            errors.append("unlisted_diff:" + f)
        for f in set(EXPECTED) - changed:
            errors.append("expected_ui_not_in_diff:" + f)
    return sorted(set(errors))

def git_diff(repo: Path):
    raw = subprocess.check_output(["git", "-C", str(repo),
        "diff", "--name-only", BASE_SHA + "...HEAD"], text=True)
    return set(raw.splitlines())

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo", type=Path, default=Path("."))
    parser.add_argument("--exact-git-diff", action="store_true")
    a = parser.parse_args()
    result = failures(a.repo, git_diff(a.repo) if a.exact_git_diff else None)
    print(json.dumps({"policy": POLICY, "valid": not result,
        "release_authorized": False, "failures": result}, indent=2))
    raise SystemExit(1 if result else 0)
