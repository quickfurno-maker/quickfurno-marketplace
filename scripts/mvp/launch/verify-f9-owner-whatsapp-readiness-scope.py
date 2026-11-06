#!/usr/bin/env python3
"""QuickFurno F9 read-only Owner WhatsApp Staging preflight exact diff guard."""
from pathlib import Path
import argparse,re,subprocess

BASE="c2a5443e3eeae78882f1822d7be6626bada15aa1"
FILES={
 "lib/communication/whatsappStagingReadiness.ts",
 "app/api/vox/v1/owner-whatsapp-launch-readiness/route.ts",
 "scripts/mvp/vendor/vendor-staging-readiness.test.mjs",
 "scripts/mvp/launch/qf-f9-staging-whatsapp-readonly.sql",
 "scripts/mvp/launch/smoke-f9-owner-whatsapp-no-send.mjs",
 "scripts/mvp/launch/verify-f9-owner-whatsapp-readiness-scope.py",
 ".github/workflows/qf-f9-owner-whatsapp-staging-readiness-no-deploy.yml",
 "docs/launch/QF-F9-OWNER-WHATSAPP-STAGING-READINESS-20261106.md",
}
REQUIRED=FILES-{"docs/launch/QF-F9-OWNER-WHATSAPP-STAGING-READINESS-20261106.md"}
def audit(repo:Path,changed=None):
    errors=[]
    try:
        pure=(repo/"lib/communication/whatsappStagingReadiness.ts").read_text("utf-8")
        route=(repo/"app/api/vox/v1/owner-whatsapp-launch-readiness/route.ts").read_text("utf-8")
        sql=(repo/"scripts/mvp/launch/qf-f9-staging-whatsapp-readonly.sql").read_text("utf-8")
        test=(repo/"scripts/mvp/vendor/vendor-staging-readiness.test.mjs").read_text("utf-8")
        smoke=(repo/"scripts/mvp/launch/smoke-f9-owner-whatsapp-no-send.mjs").read_text("utf-8")
        for marker in ('releaseVerdict:"HOLD"','canSendOtp:false','canApproveVendor:false',
                       "isExactWhatsappSenderForLane","vendor_meta_quality_red_or_unverified",
                       "consented_handset_delivery_unverified"):
            if marker not in pure:errors.append("missing_fail_closed_readiness:"+marker)
        for marker in ('VOX_OWNER_WHATSAPP_READINESS_ENABLED!=="staging"',
                       'await verifyVoxOwnerBearer','const fresh=await verifyVoxOwnerBearer',
                       'assessWhatsappStagingReadiness','private, no-store'):
            if marker not in route:errors.append("missing_privileged_read_guard:"+marker)
        for forbidden in ('.insert(','.update(','.delete(','.upsert(','fetch(',
                          'deliverClientLoginOtp(','deliverVendorWhatsappOtp('):
            if forbidden in route:errors.append("owner_route_mutates_or_sends:"+forbidden)
        if not all(('export function '+method+'()') in route for method in
                   ("POST","PUT","PATCH","DELETE")):
            errors.append("owner_route_exposes_write_method")
        stripped=re.sub(r"--[^\n]*", "", sql)
        stripped=re.sub(r"'[^']*'", "''", stripped)
        if re.search(r"\b(INSERT|UPDATE|DELETE|ALTER|DROP|CREATE|TRUNCATE|GRANT|REVOKE|COPY)\b",
                     stripped,re.I):
            errors.append("sql_not_readonly")
        for marker in ("uckafzuochmbvtiodmcl","27861262223494153",
                       "1333595106493545","1569174604351612",
                       "1088396637681784","verified_service_only_functions",
                       "dormant_preflight_pass",
                       "FALSE AS actual_live_otp_e2e_certified",
                       "FALSE AS owner_production_go"):
            if marker not in sql:errors.append("missing_preflight_attestation:"+marker)
        if "tests 24" not in test and "F9-24" not in test: errors.append("f9_hostile_test_missing")
        if "F9_LOOPBACK_NO_SEND_PASS" not in smoke:errors.append("missing_compiled_smoke")
        if "NEXT_PUBLIC_SUPABASE_URL" not in smoke:errors.append("smoke_db_isolation_missing")
    except OSError as e:
        errors.append("source_missing:"+type(e).__name__)
    if changed is not None:
        errors += ["unapproved_path:"+p for p in sorted(changed-FILES)]
        errors += ["missing_required_path:"+p for p in sorted(REQUIRED-changed)]
    return errors

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
    print("F9_OWNER_WHATSAPP_READ_ONLY_SCOPE_"+("FAIL" if issues else "PASS")+" "+repr(issues))
    raise SystemExit(bool(issues))
