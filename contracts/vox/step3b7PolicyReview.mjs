/**
 * Step 3B-7 INTERNAL REVIEW MODEL ONLY.
 * Not an RLS policy, RPC, authorization check, release approval or source of truth.
 * Actual managed permission semantics depend on effective PostgreSQL RLS, grants,
 * Supabase JWT/session state, policy composition, and independent AppSec review.
 */
const CLASSIFICATIONS=Object.freeze({
  new_lead:"OPERATIONAL",
  accept_job:"OPERATIONAL",
  payment_write:"OPERATIONAL",
  whatsapp_outbound:"OPERATIONAL",
  profile_change:"OPERATIONAL",
  old_invoice:"HISTORY",
  historic_dispute:"HISTORY",
  prior_support_case:"HISTORY",
  prior_notification:"HISTORY",
});
const ROLES=new Set(["vendor","admin"]);
const ALLOWED=new Set(["active","inactive","suspended","revoked"]);
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[89ab0-9a-f]{12}$/i;
// Intentionally conservative: do not use this as actual permission to access data.
export function reviewVendorRlsScenario(input={}){
 const {role,status,actorUserId,ownerUserId,vendorId,resource,
  validSession,verifiedCurrentOwnership,recordVendorId}=input;
 const category=CLASSIFICATIONS[resource];
 const shape=role==="vendor"&&ALLOWED.has(status)&&category&&
   uuid.test(actorUserId??"")&&uuid.test(ownerUserId??"")&&
   uuid.test(vendorId??"")&&uuid.test(recordVendorId??"");
 const sameVendor=Boolean(shape&&actorUserId===ownerUserId&&vendorId===recordVendorId&&verifiedCurrentOwnership===true);
 const active=Boolean(sameVendor&&status==="active"&&validSession===true);
 const historicalCandidate=Boolean(sameVendor&&status==="suspended"&&validSession===true&&category==="HISTORY");
 return Object.freeze({schema:"qf.step3b7.vendor.rls.review.v1",
  classification:category??"UNKNOWN",
  candidateForReview:active?"ACTIVE_CASE":historicalCandidate?"SUSPENDED_HISTORICAL_REQUIRES_DECISION":"DENY_CASE",
  validShape:Boolean(shape),sameVendor,requiresIndependentAppsec:true,
  historicalBusinessDecisionApproved:false,
  actualRlsEvaluated:false,actualRlsAuthorized:false,
  mayRead:false,mayMutate:false,maySend:false,
  releaseStatus:"HOLD"});
}
export function reviewAdminRlsScenario(input={}){
 const valid=Boolean(input.role==="admin"&&ALLOWED.has(input.status)&&
  input.status==="active"&&input.isActive===true&&input.authSessionVerified===true&&
  input.durableRoleActive===true&&input.aal==="aal2");
 return Object.freeze({schema:"qf.step3b7.admin.rls.review.v1",
  candidateForReview:valid?"ACTIVE_ADMIN_REQUIRES_FULL_POLICY_REVIEW":"DENY_CASE",
  requiresIndependentAppsec:true,actualRlsEvaluated:false,
  actualRlsAuthorized:false,mayGrant:false,mayMutate:false,
  releaseStatus:"HOLD"});
}
