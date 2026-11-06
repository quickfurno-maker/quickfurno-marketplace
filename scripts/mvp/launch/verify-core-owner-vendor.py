#!/usr/bin/env python3
"""Fail-closed Marketplace Core / Owner vendor release scope and SQL inventory."""
import argparse
import hashlib
import json
import subprocess
from pathlib import Path

POLICY = "quickfurno.f1.core-vendor-owner-no-deploy.v1"
SOURCE = "f7ffbc1dbf1f9165c7818d2cfb767be33e238c73"
BASE = "a01ce330b199b8e5f03d336122fc4752b3116566"
ROOTS = (
    "app/api/vendor/onboarding/request-otp/route.ts",
    "app/api/vendor/onboarding/complete/route.ts",
    "app/api/vendor/private-evidence/route.ts",
    "app/api/vox/v1/owner-vendor-signup-status/route.ts",
    "app/api/vox/v1/owner-vendor-verification-readiness/route.ts",
    "app/api/vox/v1/owner-vendor-verification-queue/route.ts",
    "app/api/vox/v1/owner-vendor-verification-case/route.ts",
    "app/api/vox/v1/owner-workspaces/route.ts",
)
SQL_HASHES = {
    "20261104090000_vendor_registration_consent_receipt.sql":
        "d633187e5084591056c4a87687297fd9ca385a9e1a8d03ff8ae4df6d9e2c9e19",
    "20261104140000_vendor_private_otp_and_verification_foundation.sql":
        "cb5a4e1f74c6cbc6a6f4a89464c4d7235956b2ae9b71c3bd79bf39ed70581f48",
    "20261104153000_vendor_atomic_pending_registration.sql":
        "2f62663edc5f64122f771f8c141019933b7f4eba1680a8a62a8af9c150972596",
    "20261104160000_vendor_owner_review_assignment_gate.sql":
        "177c8f11ffeee951040e04bdb1a75e0391308ba022e00cdbd979a675a352e89e",
    "20261104163000_vendor_private_document_intake.sql":
        "dd4914f154e75e361ad862a17a702b9e72f3252e22e3c0a041616507ef3fd7d2",
    "20261104170000_vox_owner_vendor_review_queue.sql":
        "47dd11398806729bb93609857cf037cb3123cc0faaf703383a4885f287fe7012",
    "20261104173000_vendor_private_scan_quarantine.sql":
        "da53a260e9a15b39c24701e480f3d52759965406c8fbbebc2ac383767f481a68",
}
BASELINE = {"lib/supabase.ts", "services/vox/verifiedStaffBearer.ts"}
COMPAT = {"app/actions.ts", "services/vendorService.ts"}
NONRUNTIME = {
    ".github/workflows/qf-f1-core-owner-vendor.yml",
    "docs/launch/f1-core-owner-vendor-manifest.json",
    "docs/launch/QF-F1-CORE-OWNER-VENDOR-EXTRACTION-20261106.md",
    "scripts/mvp/launch/extract-core-owner-vendor.py",
    "scripts/mvp/launch/verify-core-owner-vendor.py",
    "scripts/mvp/launch/test_core_owner_vendor_scope.py",
}
MANIFEST = Path("docs/launch/f1-core-owner-vendor-manifest.json")

def sha(data: bytes) -> str:
    return hashlib.sha256(data.replace(b"\r\n", b"\n")).hexdigest()

def checks(repo: Path, diff_paths: set[str] | None = None) -> list[str]:
    repo = repo.resolve()
    failures = []
    try:
        document = json.loads((repo / MANIFEST).read_text(encoding="utf8"))
    except (OSError, ValueError):
        return ["missing_or_invalid_manifest"]
    if document.get("policy") != POLICY or document.get("source_sha") != SOURCE or document.get("base_sha") != BASE:
        failures.append("untrusted_source_identity")
    for field in ("release_authorized", "managed_migrations_applied_by_this_batch",
                  "public_vendor_signup_enabled", "staff_activation_authorized"):
        if document.get(field) is not False:
            failures.append("unsafe_release_switch:" + field)
    if tuple(document.get("entrypoints", [])) != ROOTS:
        failures.append("unreviewed_entrypoints")
    expected_sql = ["supabase/migrations/" + x for x in SQL_HASHES]
    if document.get("sql_order") != expected_sql:
        failures.append("migration_order_or_membership")
    if set(document.get("baseline_dependencies_preserved", [])) != BASELINE:
        failures.append("baseline_auth_modified")
    if set(document.get("legacy_compatibility_overlays", [])) != COMPAT:
        failures.append("missing_legacy_guard")
    rows = document.get("files", [])
    if not isinstance(rows, list):
        return failures + ["invalid_file_list"]
    recorded = {}
    for row in rows:
        if not isinstance(row, dict) or not isinstance(row.get("path"), str):
            failures.append("invalid_file_entry")
            continue
        name = row["path"]
        if name in recorded or Path(name).is_absolute() or ".." in Path(name).parts:
            failures.append("duplicate_or_escaping_path")
            continue
        recorded[name] = row
        file = repo / name
        if not file.is_file():
            failures.append("missing:" + name)
            continue
        if sha(file.read_bytes()) != row.get("sha256"):
            failures.append("source_hash_mismatch:" + name)
        if name.startswith("supabase/migrations/"):
            if name not in expected_sql or sha(file.read_bytes()) != SQL_HASHES.get(Path(name).name):
                failures.append("vendor_sql_mismatch:" + name)
            if row.get("migration") is not True:
                failures.append("unmarked_migration:" + name)
        if name.startswith("app/api/") and name not in ROOTS:
            failures.append("unexpected_new_api:" + name)
        if name.startswith(("services/vox/finance", "lib/payments/", "app/api/vox/v1/staff",
                            "app/api/vox/v1/finance", "app/api/vox/v1/team")):
            failures.append("unauthorized_staff_or_finance_code:" + name)
    if len(recorded) != document.get("file_count"):
        failures.append("manifest_file_count")
    if not set(ROOTS).issubset(recorded):
        failures.append("entrypoint_not_present")
    if set(expected_sql) != {p for p in recorded if p.startswith("supabase/migrations/")}:
        failures.append("migration_bundle_incomplete")
    if COMPAT != {p for p, row in recorded.items() if row.get("overlay") == "legacy-signup-disabled-by-default"}:
        failures.append("legacy_overlay_unreviewed")
    for name in BASELINE:
        if name in recorded:
            failures.append("baseline_owner_auth_imported:" + name)
    try:
        legacy = (repo / "app/actions.ts").read_text(encoding="utf8")
        service = (repo / "services/vendorService.ts").read_text(encoding="utf8")
        vendor_type = (repo / "lib/types.ts").read_text(encoding="utf8")
        if legacy.count('QF_VENDOR_LEGACY_REGISTRATION_MODE !== "staging"') < 2:
            failures.append("legacy_server_actions_not_closed")
        if 'QF_VENDOR_LEGACY_REGISTRATION_MODE !== "staging"' not in service or             "user_id: trustedAuthUserId" not in service or "user_id: input.user_id" in service:
            failures.append("legacy_service_untrusted_owner")
        if "is_active: false" not in service:
            failures.append("legacy_vendor_activation_not_closed")
        # Prevent reintroducing browser-provided auth ownership into this interface.
        section = vendor_type.split("export interface VendorRegistrationInput", 1)[1].split("}", 1)[0]
        if "user_id" in section:
            failures.append("user_id_in_public_signup_contract")
        for route, flags in {
            ROOTS[0]: ("QF_VENDOR_OTP_REQUEST_MODE", "QF_VENDOR_WHATSAPP_PROVIDER_CERTIFIED"),
            ROOTS[1]: ("QF_VENDOR_ATOMIC_SIGNUP_MODE", "QF_VENDOR_OTP_VERIFY_MODE"),
            ROOTS[2]: ("QF_VENDOR_PRIVATE_EVIDENCE_MODE", "QF_VENDOR_PRIVATE_BUCKET_CERTIFIED"),
            ROOTS[3]: ("VOX_OWNER_VENDOR_SIGNUP_STATUS_READ_ENABLED",),
            ROOTS[4]: ("VOX_OWNER_VENDOR_VERIFICATION_READ_ENABLED",),
            ROOTS[5]: ("VOX_OWNER_VENDOR_CASE_REVIEW_ENABLED", "VOX_OWNER_VENDOR_QUEUE_ENABLED"),
            ROOTS[6]: ("VOX_OWNER_VENDOR_CASE_REVIEW_ENABLED",),
            ROOTS[7]: ("VOX_OWNER_WORKSPACES_ENABLED", "VOX_OWNER_WORKSPACES_STAGE"),
        }.items():
            text = (repo / route).read_text(encoding="utf8")
            for flag in flags:
                if flag not in text:
                    failures.append("missing_feature_guard:" + route + ":" + flag)
    except (IndexError, OSError):
        failures.append("missing_legacy_or_endpoint_source")
    if diff_paths is not None:
        actual = set(diff_paths)
        allowed = set(recorded) | NONRUNTIME
        for item in actual - allowed:
            failures.append("unlisted_git_change:" + item)
        for item in allowed - actual:
            if item in recorded:
                failures.append("uncommitted_manifest_file:" + item)
    return sorted(set(failures))

def current_git_diff(repo: Path) -> set[str]:
    raw = subprocess.check_output(
        ["git", "-C", str(repo), "diff", "--name-only", BASE + "...HEAD"], text=True)
    return set(raw.splitlines())

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo", type=Path, default=Path("."))
    parser.add_argument("--exact-git-diff", action="store_true")
    args = parser.parse_args()
    failures = checks(args.repo, current_git_diff(args.repo) if args.exact_git_diff else None)
    print(json.dumps({"policy": POLICY, "valid": not failures, "release_authorized": False,
                      "failures": failures}, indent=2))
    raise SystemExit(1 if failures else 0)
