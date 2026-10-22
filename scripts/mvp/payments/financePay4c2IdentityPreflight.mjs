import {readFileSync} from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"../../..");
const sourcePaths=[
 "services/vox/verifiedStaffBearer.ts",
 "services/vox/verifiedScopedStaff.ts",
 "services/financeV2Scope.ts",
 "app/api/vox/v1/finance-history/route.ts",
 "app/api/vox/v1/finance-case/route.ts",
 "app/api/vox/v1/finance-case-review/route.ts"
];
export function inspectFinanceMfaSource({root=ROOT,read=readFileSync}={}){
 const errors=[],files={};
 for(const file of sourcePaths){
  try{files[file]=read(path.join(root,file),"utf8");}
  catch{errors.push("AUTH_SOURCE_MISSING:"+file);}
 }
 const owner=files["services/vox/verifiedStaffBearer.ts"]??"";
 const staff=files["services/vox/verifiedScopedStaff.ts"]??"";
 const grant=files["services/financeV2Scope.ts"]??"";
 const review=files["app/api/vox/v1/finance-case-review/route.ts"]??"";
 const casework=files["app/api/vox/v1/finance-case/route.ts"]??"";
 if(!owner.includes("verifySupabaseBearerUser(token)")||!owner.includes('data.aal==="aal2"')||
  !owner.includes('admin_role!=="Superadmin"'))errors.push("OWNER_VERIFICATION_CONTRACT_DRIFT");
 if(!staff.includes("verifySupabaseBearerUser(raw)")||
  !staff.includes('jwt.aal!=="aal2"')||!staff.includes("isNeutralVoxStaffPrincipal")||
  !staff.includes("restrictScopedStaffByDepartment"))
  errors.push("STAFF_AAL2_OR_NEUTRAL_PRINCIPAL_DRIFT");
 if(!grant.includes("finance_staff_read_revocations")||
  !grant.includes("evaluateFinanceReadGrant")||
  !grant.includes("VOX_DEPARTMENT_ENFORCEMENT_ENABLED"))
  errors.push("FINANCE_GRANT_REVOCATION_DRIFT");
 if(!review.includes("verifyVoxOwnerBearer(bearer)")||
  !review.includes("original.data.requested_by===owner"))
  errors.push("REVIEWER_INDEPENDENCE_DRIFT");
 if(!casework.includes("financeStaffAllowed(fresh,vendor)"))
  errors.push("CASE_GRANT_FRESH_RECHECK_DRIFT");
 return Object.freeze({
  schema:"qf.finance.pay4c2.identity-preflight.v1",
  sourceGuardsVerified:errors.length===0,errors,
  genuineStagingOwnerSessionVerified:false,
  genuineStagingStaffSessionVerified:false,
  stagedFinanceGrantsVerified:false,
  independentReviewerBootstrapVerified:false,
  authenticatedAal2Certification:false,
  canGrantOrApprove:false,
  testedPermissionRevocationOnRealSessions:false,
  identityEvidenceRequired:["OWNER_REMOTE_AAL2_LOGIN",
   "STAFF_REMOTE_AAL2_LOGIN","REVIEWER_DISTINCT_REMOTE_USER",
   "FINANCE_GRANT_WITH_OWNER_APPROVAL","REVOKED_GRANT_DENY",
   "TENANT_CROSS_VENDOR_DENY","SINGLE_EXISTING_AUTH_SYSTEM"],
  releaseStatus:"HOLD"
 });
}
