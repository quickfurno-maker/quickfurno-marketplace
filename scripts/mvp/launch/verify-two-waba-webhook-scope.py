#!/usr/bin/env python3
"""F8: reviewed exact-head scope for the Riya/Anisha webhook identity inventory. NO DEPLOY."""
from pathlib import Path
import argparse
import hashlib
import subprocess

BASE="61bb1ce1e06cf138fe65ed10fe03c0c15557d931"
MIG="supabase/migrations/20261106120124_qf_f8_dormant_riya_client_provider_account.sql"
MIG_SHA256="ba56e0814611dd0e3b4df8164714328d70f33ab0bbc195f2976fcfaaf35a7566"
ALLOWED={
 "lib/communication/providers/metaCloudWhatsAppConfig.ts",
 "scripts/mvp/vendor/vendor-dual-waba-webhook-registry.test.mjs",
 MIG,
 "scripts/mvp/launch/verify-two-waba-webhook-scope.py",
 ".github/workflows/qf-f8-two-waba-webhook-no-deploy.yml",
 "docs/launch/QF-F8-TWO-WABA-WEBHOOK-STAGING-20261106.md",
}
NEEDED={
 "lib/communication/providers/metaCloudWhatsAppConfig.ts",
 "scripts/mvp/vendor/vendor-dual-waba-webhook-registry.test.mjs",
 MIG,
}
def audit(repo,changed=None):
    issues=[]
    try:
        source=(repo/"lib/communication/providers/metaCloudWhatsAppConfig.ts").read_text(encoding="utf-8")
        tests=(repo/"scripts/mvp/vendor/vendor-dual-waba-webhook-registry.test.mjs").read_text(encoding="utf-8")
        sql=(repo/MIG).read_bytes()
        if hashlib.sha256(sql).hexdigest()!=MIG_SHA256:
            issues.append("applied_migration_source_sha_mismatch")
        for marker in ("WHATSAPP_VENDOR_WABA_ID","WHATSAPP_VENDOR_PHONE_NUMBER_ID",
                       'isExactWhatsappSenderForLane("vendor"',
                       'isExactWhatsappSenderForLane("client"',
                       "WHATSAPP_CONVERSATIONAL_WABA_ID_ENV"):
            if marker not in source: issues.append("missing_registry_gate:"+marker)
        for marker in ("decideCallbackIdentityRegistry", "vendor.phoneNumberId",
                       "client.phoneNumberId", "same-WABA", "signed webhook"):
            if marker not in tests: issues.append("missing_hostile_test:"+marker)
        if "outbound_enabled=true" in sql.decode("utf-8") or "webhook_processing_enabled=true" in sql.decode("utf-8"):
            issues.append("migration_enablement")
        if not all(x in sql.decode("utf-8") for x in (
            "'disabled','pending','unknown','connected','pending'",
            "1333595106493545","27861262223494153",
            "1569174604351612","1088396637681784",
            "is_operationally_enabled=true","is_active=true")):
            issues.append("missing_staging_dormancy_assertion")
    except (OSError, ValueError) as e:
        issues.append("source_missing:"+type(e).__name__)
    if changed is not None:
        issues.extend("unapproved_path:"+p for p in sorted(changed-ALLOWED))
        issues.extend("not_changed:"+p for p in sorted(NEEDED-changed))
    return issues

if __name__=="__main__":
    parser=argparse.ArgumentParser()
    parser.add_argument("--repo",type=Path,default=Path("."))
    parser.add_argument("--exact-git-diff",action="store_true")
    args=parser.parse_args()
    changed=None
    if args.exact_git_diff:
        changed=set(subprocess.check_output(
            ["git","-C",str(args.repo),"diff","--name-only",BASE+"...HEAD"],
            text=True).splitlines())
    issues=audit(args.repo,changed)
    print("F8_TWO_WABA_NO_DEPLOY_SCOPE_"+("FAIL" if issues else "PASS")+" "+repr(issues))
    raise SystemExit(bool(issues))
