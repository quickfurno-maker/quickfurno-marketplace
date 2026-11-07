#!/usr/bin/env python3
"""F20 cross-layer Owner/VOX/private-scan/assignment source guard.
Only reads actual source. Real isolated DB semantics are separately exercised
by f20_private_scan_isolated_postflight.sql via a disposable, offline PG17.
"""
from __future__ import annotations
import json
from pathlib import Path

SCAN="supabase/migrations/20261104173000_vendor_private_scan_quarantine.sql"
REVIEW="supabase/migrations/20261104160000_vendor_owner_review_assignment_gate.sql"
OWNER="app/api/vox/v1/owner-vendor-verification-case/route.ts"
WEB="apps/vox-web/app/api/owner/vendor-verification/decision/route.ts"
BFF="apps/vox-web/lib/ownerVendorVerification.ts"
F17="scripts/mvp/launch/f17_operational_release_gate.mjs"
FILES=(SCAN,REVIEW,OWNER,WEB,BFF,F17)

def validate_text(files:dict[str,str])->list[str]:
    problems=[]
    def require(path, needles, reason):
        data=files.get(path,"")
        if not all(n in data for n in needles):problems.append(reason)
    require(SCAN,[
      "create table if not exists qf_vendor_private.verification_scan_receipts",
      "id uuid primary key","evidence_id uuid not null unique",
      "content_sha256 text not null","scanner_engine='clamav_local'",
      "verdict in ('clean','infected')",
      "verification_scan_receipts_immutable",
      "before update or delete",
    ],"IMMUTABLE_SCAN_RECEIPTS_MISSING")
    require(SCAN,[
      "revoke all on qf_vendor_private.verification_scan_receipts from public,anon,authenticated",
      "revoke all on function public.qf_vendor_private_scan_queue()",
      "revoke all on function public.qf_vendor_record_private_scan(uuid,text,text,text)",
      "grant execute on function public.qf_vendor_record_private_scan(uuid,text,text,text)",
      "to service_role",
      "PRIVATE_SCAN_BROWSER_GRANT"
    ],"BROWSER_SCAN_RECEIPT_ESCALATION")
    scan_sql=files.get(SCAN,"")
    ready_sql=scan_sql.split("create or replace function public.qf_vendor_verification_case_ready(",1)[-1].split("create or replace function public.qf_vendor_owner_review_snapshot(",1)[0]
    files={**files,SCAN:scan_sql}
    # Check the actual assignment-ready function body; a second copy of a
    # clean receipt predicate in a read-only view must not mask its removal.
    require(SCAN,[
      "office_doc.scan_status='clean'",
      "scan.evidence_id=office_doc.id",
      "scan.case_id=office_doc.case_id",
      "scan.content_sha256=office_doc.content_sha256",
      "scan.scanner_engine='clamav_local'",
      "scan.verdict='clean'",
      "identity_doc.evidence_state='verified'",
      "consent.revoked_at is null",
      "c.case_version=(select max(n.case_version)",
      "and c.state='approved'",
    ],"SCAN_FREE_OFFICE_APPROVAL")
    required_ready=("scan.verdict='clean'","c.case_version=(select max(n.case_version)",
      "scan.content_sha256=office_doc.content_sha256","scan.scanner_engine='clamav_local'")
    if not all(needle in ready_sql for needle in required_ready):
      problems.append("SCAN_FREE_OFFICE_APPROVAL")
    require(SCAN,[
      "p_expected_sha256 !~ '^[0-9a-f]{64}$'",
      "p_verdict not in ('clean','infected')",
      "e.content_sha256=p_expected_sha256",
      "and e.scan_status='pending' and e.evidence_state='pending'",
      "and not exists(select 1 from qf_vendor_private.verification_scan_receipts receipt",
      "pg_advisory_xact_lock",
      "VENDOR_SCAN_RESULT_CONFLICT",
    ],"FORGEABLE_CLEAN_RECEIPT")
    require(REVIEW,[
      "a.raw_app_meta_data->>'admin_role'='Superadmin'",
      "p_expected_case_version",
      "case_not_reviewable",
      "qf_vendor_verification_case_ready(p_vendor_id)",
      "QF_OWNER_REVIEW_EVIDENCE_CHANGED",
      "revoke all on function public.qf_owner_record_vendor_verification_decision",
    ],"OWNER_REVIEW_ALLOWS_UNVERIFIED_APPROVAL")
    require(REVIEW,[
      "new.vendor_id is distinct from old.vendor_id",
      "new.lead_id is distinct from old.lead_id",
      "public.qf_vendor_verification_case_ready(new.vendor_id)",
      "QF_VENDOR_ASSIGNMENT_VERIFICATION_REQUIRED",
      "trg_qf_vendor_new_assignment_verification",
      "before insert or update of vendor_id,lead_id,lifecycle_status",
    ],"NEW_ASSIGNMENT_GATE_REMOVED")
    owner=files.get(OWNER,"")
    if owner.count('await verifyVoxOwnerBearer(request.headers.get("authorization"))')<4:
      problems.append("OWNER_AAL2_NOT_RECHECKED")
    require(OWNER,[
      "MAX_REVIEW_BODY_BYTES = 2048",
      "caseVersion", "Number.isSafeInteger(body.caseVersion)",
      "OWNER_AAL2_REQUIRED",
    ],"OWNER_REVIEW_BODY_CONTRACT_CHANGED")
    # Owner Core route uses explicit Origin validation, rather than sameOrigin helper.
    if "new URL(origin).origin !== new URL(request.url).origin" not in owner:
      problems.append("OWNER_CSRF_ORIGIN_UNGUARDED")
    require(OWNER,[
      "requiresSeparateCoreVendorApproval:true",
      "leadActivationUnchanged:true",
      "vendorBusinessStatusUnchanged:true",
      "qf_owner_record_vendor_verification_decision",
    ],"OWNER_DIRECTLY_ACTIVATES_VENDOR")
    require(WEB,[
      "allowedOrigin(request)",
      "validOwnerReviewInput(raw)",
      "ownerVendorDecision(raw)",
      "canActivateLeads:false",
      "requiresSeparateCoreVendorApproval:true",
    ],"VOX_OWNER_BFF_BYPASSES_CORE")
    if any(s in files.get(WEB,"") for s in (
      "adminClient(", 'from("vendors")', ".rpc(", "SUPABASE_SERVICE_ROLE_KEY")):
      problems.append("VOX_OWNER_BFF_DIRECT_DATABASE_ACCESS")
    require(BFF,[
      "verifiedMfaSession()",
      'cache:"no-store"',
      'redirect:"error"',
      'authorization:"Bearer "+token',
      "OWNER_SESSION_REVOKED",
    ],"VOX_OWNER_BFF_AAL2_OR_CORE_BRIDGE_CHANGED")
    require(F17,[
      "releaseVerdict:\"HOLD\"",
      "mayDeployStaging:false",
      "maySendOtp:false",
      "mayDeployProduction:false",
    ],"OPERATIONAL_RELEASE_FENCE_RELAXED")
    if any(token in files.get(F17,"") for token in (
      "mayDeployStaging:true","mayDeployProduction:true","maySendOtp:true",
      'releaseVerdict:"GO"')):
      problems.append("OPERATIONAL_RELEASE_FENCE_RELAXED")
    return sorted(set(problems))

def audit(repo:Path)->dict:
    loaded={p:(repo/p).read_text(encoding="utf8") if (repo/p).is_file() else "" for p in FILES}
    failed=validate_text(loaded)
    return {
      "schema":"quickfurno.f20.owner-private-scan-gates.v1",
      "sourceOnly":True,"managedDbQueried":False,"providerCalled":False,
      "valid":not failed,"issues":failed,
      "releaseVerdict":"HOLD","mayDeployStaging":False,"mayDeployProduction":False,
      "maySendOtp":False
    }
if __name__=="__main__":
    import argparse
    parser=argparse.ArgumentParser()
    parser.add_argument("--repo",default=".")
    args=parser.parse_args()
    try:result=audit(Path(args.repo).resolve())
    except OSError:result={"valid":False,"issues":["FILES_UNAVAILABLE"],"releaseVerdict":"HOLD"}
    print(json.dumps(result,sort_keys=True))
    raise SystemExit(0 if result.get("valid") else 1)
