/** AB7F actual reviewed Core suspension-RPC invocation; NEVER Auth logout. */
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const deny=reason=>({ok:false,reason,membershipRevokedVerified:false,
 authSessionsInvalidated:false});
export async function suspendCoreStaffGrants({
 environment,enabled=false,ownerId,reviewerId,targetId,teamId,cityId,nonce,
 verifyFreshOwnerAal2,verifyFreshTlAal2,verifySignedIndependentDecision,rpc
}={}){
 if(environment!=="staging"||enabled!==true||
  ![ownerId,reviewerId,targetId,teamId,cityId,nonce].every(x=>
   typeof x==="string"&&uuid.test(x))||
  new Set([ownerId,reviewerId,targetId]).size!==3||
  ![verifyFreshOwnerAal2,verifyFreshTlAal2,
    verifySignedIndependentDecision,rpc].every(x=>typeof x==="function"))
  return deny("INDEPENDENT_STAFF_STAGING_AUTHORITY_REQUIRED");
 const proof=Object.freeze({ownerId,reviewerId,targetId,teamId,cityId,nonce});
 try{
  if(await verifyFreshOwnerAal2(proof)!==true||
   await verifyFreshTlAal2(proof)!==true||
   await verifySignedIndependentDecision(proof)!==true)
   return deny("CURRENT_INDEPENDENT_SUSPENSION_DENIED");
  const result=await rpc("qf_vox_ab7f_staff_suspend_atomic_candidate_v1",{
   p_target:targetId,p_owner:ownerId,p_reviewer:reviewerId,p_team:teamId,
   p_city:cityId,p_nonce:nonce
  });
  if(result?.error||!Array.isArray(result?.data)||result.data.length!==1)
   return deny("CORE_STAFF_SUSPEND_RECEIPT_UNVERIFIED");
  const x=result.data[0];
  if(!x||Object.keys(x).sort().join("|")!==
   "department_grants_revoked|object_scopes_revoked|receipt_nonce|target_id"||
    x.receipt_nonce!==nonce||x.target_id!==targetId||
    !Number.isSafeInteger(x.department_grants_revoked)||
    !Number.isSafeInteger(x.object_scopes_revoked)||
    x.department_grants_revoked<0||x.object_scopes_revoked<0)
   return deny("CORE_STAFF_SUSPEND_RECEIPT_MISMATCH");
  return Object.freeze({ok:true,membershipRevokedVerified:true,
   targetId,departmentGrantsRevoked:x.department_grants_revoked,
   objectScopesRevoked:x.object_scopes_revoked,
   state:"CORE_SUSPENDED_AUTH_SESSION_RECONCILIATION_PENDING",
   authSessionsInvalidated:false,productionCertified:false});
 }catch{return deny("CORE_SUSPENSION_OUTCOME_UNKNOWN");}
}
