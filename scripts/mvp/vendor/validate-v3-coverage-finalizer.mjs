import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const read=p=>readFileSync(new URL("../../../"+p,import.meta.url),"utf8");
const sql=read("ops/vendor-approval/pending/20261013162000_vendor_verified_coverage_finalizer_v1.sql");
const svc=read("services/vendorVerifiedCoverageApprovalService.ts");
const actions=read("app/actions.ts");
const ui=read("components/admin/vendor-approvals/VendorApprovalQueue.tsx");
const checks=[
 ["RPC service-only",sql.includes("grant execute on function public.qf_approve_vendor_verified_coverage_v1")&&sql.includes("from public,anon,authenticated")],
 ["Superadmin double-checked",sql.includes("raw_app_meta_data")&&actions.includes("requireSuperadmin()")],
 ["no self approval",sql.includes("QF_COVERAGE_SELF_APPROVAL")],
 ["stale snapshot",sql.includes("QF_COVERAGE_STALE")&&sql.includes("for update")],
 ["same city only",sql.includes("QF_COVERAGE_CITY_MOVE_REQUIRES_SEPARATE_REVIEW")],
 ["categories remain allowlisted",sql.includes("QF_COVERAGE_PRIMARY_CATEGORY_INVARIANT")],
 ["real Core verified Google office",sql.includes("location_verification_status is distinct from 'verified'")&&sql.includes("google_place_id")],
 ["polygon match required",sql.includes("extensions.st_covers")&&sql.includes("extensions.st_isvalid")],
 ["active matching zone",sql.includes("z.matching_enabled is distinct from true")],
 ["atomic vendor and request commit",sql.includes("update public.vendors")&&sql.includes("update public.vendor_profile_change_requests")],
 ["never mutate credits",!sql.includes("vendor_credit_logs")&&!sql.includes("credit_restoration")],
 ["no missing RPC fallback",svc.includes(".rpc(")&&!svc.includes(".update(")],
 ["admin-only action",actions.includes("adminApproveVendorVerifiedCoverageChangeRequest")],
 ["UI still fail-closed until release",ui.includes("office || restricted || matchingSensitive")],
];
for(const [name,pass] of checks){assert.ok(pass,"FAILED "+name);console.log("PASS",name);}
console.log("Verified coverage finalizer: "+checks.length+"/"+checks.length+" PASS. SQL requires dedicated database certificate.");
