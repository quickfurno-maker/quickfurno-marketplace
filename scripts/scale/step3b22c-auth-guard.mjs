/** Pure preflight for supported Supabase Auth Admin API lifecycle.
 * It never calls Auth, exposes secrets, revokes sessions or deletes principals.
 */
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PRESENT=["userId","vendorId","identityCount","sessionCount","refreshTokenCount"];
export function assessTestAuthCohort(input={}){
 const blockers=[];const deny=x=>{if(!blockers.includes(x))blockers.push(x);};
 if(input.projectRef!=="yqpgcsduqbxulrlzwzap"||input.environment!=="production")
  deny("WRONG_AUTH_PROJECT");
 const candidates=input.candidates;
 const protectedIds=input.protectedPrincipals;
 if(!Array.isArray(candidates)||candidates.length!==9)deny("EXPECTED_NINE_TEST_ACCOUNTS");
 if(!Array.isArray(protectedIds)||protectedIds.length<1||protectedIds.some(x=>!UUID.test(x)))
  deny("OWNER_OR_PRIVILEGED_IDSET_MISSING");
 const listed=new Set(),vendors=new Set(),owner=new Set(protectedIds??[]);
 let sessions=0,refresh=0,identities=0;
 for(const record of Array.isArray(candidates)?candidates:[]){
  if(PRESENT.some(k=>record?.[k]===undefined))deny("INCOMPLETE_VENDOR_AUTH_RECORD");
  if(!UUID.test(record?.userId??"")||listed.has(record.userId)||
     !UUID.test(record?.vendorId??"")||vendors.has(record.vendorId))
    deny("DUPLICATE_OR_INVALID_ID");
  listed.add(record.userId);vendors.add(record.vendorId);
  if(owner.has(record.userId))deny("PROTECTED_OWNER_ID_IN_TEST_SET");
  if(record.onlyTestVendorUsage!==true||record.isPrivileged===true||
     record.hasExternalAppMembership!==false)
    deny("CROSS_APP_OR_PRIVILEGE_UNCERTIFIED");
  for(const n of ["identityCount","sessionCount","refreshTokenCount"]){
   if(!Number.isSafeInteger(record[n])||record[n]<0)deny("AUTH_COUNTS_INVALID");
  }
  identities+=record.identityCount||0;sessions+=record.sessionCount||0;
  refresh+=record.refreshTokenCount||0;
 }
 if(identities!==9)deny("AUTH_IDENTITY_COUNT_DRIFT");
 if(sessions!==8)deny("AUTH_SESSION_COUNT_DRIFT");
 if(refresh!==23)deny("AUTH_REFRESH_COUNT_DRIFT");
 if(input.ownerLoginRegressionVerified!==true)deny("OWNER_LOGIN_UNVERIFIED");
 if(input.supportedAuthAdminPlanReviewed!==true)deny("AUTH_ADMIN_PLAN_NOT_REVIEWED");
 if(input.sessionAndJwtExpiryPlanReviewed!==true)deny("TOKEN_LIFECYCLE_NOT_REVIEWED");
 if(input.fullRecoveryVerified!==true)deny("RECOVERY_NOT_CERTIFIED");
 if(input.ownerConsentPermanentErasure!==true)deny("OWNER_CONSENT_NOT_RECORDED");
 return Object.freeze({
  decision:blockers.length?"HOLD":"AUTH_COHORT_REVIEW_COMPLETE_MANUAL_ADMIN_API_REQUIRED",
  executable:false,blockers:Object.freeze(blockers)
 });
}
