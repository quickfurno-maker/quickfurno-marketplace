/** AB7G Staff Auth session-reconciliation handoff, source-only.
 * Do not confuse Core membership revocation with GoTrue session invalidation.
 * Never send the target's JWT to a browser. Requires independently reviewed
 * exact Core suspension nonce, current AAL2 and injected trusted Auth admin.
 */
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const fail=reason=>Object.freeze({ok:false,reason,
 coreAccessRevoked:false,authSessionsInvalidated:false,
 requiresManualAuthReview:true});
export async function reconcileStaffAuthAfterCoreFence({
 environment,enabled=false,targetId,ownerId,reviewerId,suspensionNonce,
 verifyIndependentSuspensionReceipt,verifyCurrentOwnerAal2,
 verifyCurrentTargetIsDisabled,requestGlobalSessionRevoke,
 verifyGlobalSessionRevoke
}={}){
 if(environment!=="staging"||enabled!==true||
  ![targetId,ownerId,reviewerId,suspensionNonce].every(x=>typeof x==="string"&&uuid.test(x))||
  new Set([targetId,ownerId,reviewerId]).size!==3||
  ![verifyIndependentSuspensionReceipt,verifyCurrentOwnerAal2,
   verifyCurrentTargetIsDisabled,requestGlobalSessionRevoke,
   verifyGlobalSessionRevoke].every(x=>typeof x==="function"))
   return fail("INDEPENDENT_CORE_SUSPENSION_AND_AUTH_STAGING_REQUIRED");
 const proof={targetId,ownerId,reviewerId,suspensionNonce};
 try{
  if(await verifyIndependentSuspensionReceipt(proof)!==true||
   await verifyCurrentOwnerAal2(proof)!==true||
   await verifyCurrentTargetIsDisabled(proof)!==true)
   return fail("CURRENT_CORE_SUSPENSION_UNVERIFIED");
  const requested=await requestGlobalSessionRevoke(proof);
  // A provider API request is NOT evidence that every JWT is invalidated;
  // deny access via fresh membership checks even while tokens age out.
  if(!requested||requested.accepted!==true||
   requested.targetId!==targetId||requested.nonce!==suspensionNonce)
   return fail("GOTRUE_GLOBAL_REVOCATION_UNCONFIRMED");
  if(await verifyGlobalSessionRevoke(proof)!==true)
   return fail("AUTH_PROVIDER_SESSION_RECONCILIATION_PENDING");
  return Object.freeze({ok:true,state:"AUTH_PROVIDER_RECONCILED",
   coreAccessRevoked:true,authSessionsInvalidated:true,
   targetId,requiresManualAuthReview:false,
   productionCertified:false,externalMessagesSent:0});
 }catch{return fail("AUTH_RECONCILIATION_OUTCOME_UNKNOWN");}
}
