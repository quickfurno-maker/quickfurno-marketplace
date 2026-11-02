/**
 * AB7E internal worker safety. A stale lease/DLQ must not cause a fabricated
 * delivery receipt or automatic provider retry. Produces manual recovery
 * candidates, NOT commands to SQL, AGNI, AOS, scheduler or WhatsApp.
 */
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STATES=new Set(["PENDING","LEASED","DONE","DEAD_LETTER","OUTCOME_UNKNOWN"]);
const deny=reason=>Object.freeze({ok:false,reason,mayDispatch:false,
 mayRetryAutomatically:false,externalMessagesSent:0});
export async function prepareInternalRecoveryReview({
 viewer,rows,now=Date.now(),verifyCurrentOwnerAal2,verifyCurrentCoreJob
}={}){
 if(!viewer||viewer.role!=="superadmin"||viewer.currentAal!=="aal2"||
  !Array.isArray(rows)||rows.length>200||
  !Number.isSafeInteger(now)||now<=0||
  typeof verifyCurrentOwnerAal2!=="function"||
  typeof verifyCurrentCoreJob!=="function")
  return deny("CURRENT_OWNER_QUEUE_AUTHORITY_REQUIRED");
 try{
  if(await verifyCurrentOwnerAal2(viewer)!==true)return deny("OWNER_REVOKED");
  const ids=new Set(),items=[];
  for(const row of rows){
   if(!row||typeof row!=="object"||Array.isArray(row)||
    Object.keys(row).sort().join("|")!==
     "attempts|id|leaseExpiresAtMs|nextAttemptAtMs|providerBound|state"||
    !UUID.test(row.id??"")||ids.has(row.id)||!STATES.has(row.state)||
    !Number.isSafeInteger(row.attempts)||row.attempts<0||row.attempts>5||
    (row.leaseExpiresAtMs!==null&&
     !Number.isSafeInteger(row.leaseExpiresAtMs))||
    !Number.isSafeInteger(row.nextAttemptAtMs)||
    row.providerBound!==false||
    (row.state==="LEASED")!==(row.leaseExpiresAtMs!==null)||
    await verifyCurrentCoreJob({row})!==true)
    return deny("UNVERIFIED_OR_PROVIDER_BOUND_RECOVERY_JOB");
   ids.add(row.id);
   const issue=row.state==="OUTCOME_UNKNOWN"?"UNKNOWN_OUTCOME":
    row.state==="DEAD_LETTER"?"DEAD_LETTER":
    row.state==="LEASED"&&row.leaseExpiresAtMs<now?"STALE_LEASE":
    row.state==="PENDING"&&row.nextAttemptAtMs<now-60000?"OVERDUE_PENDING":null;
   if(issue)items.push(Object.freeze({jobId:row.id,issue,action:"MANUAL_OWNER_REVIEW_ONLY"}));
  }
  if(await verifyCurrentOwnerAal2(viewer)!==true)return deny("OWNER_SCOPE_CHANGED");
  return Object.freeze({ok:true,schema:"qf.vox.ab7e.manual-recovery-review.v1",
   observed:rows.length,recoveryCandidates:Object.freeze(items),
   mayDispatch:false,mayRetryAutomatically:false,
   autonomousRemediation:false,externalMessagesSent:0,productionCertified:false});
 }catch{return deny("CORE_QUEUE_READ_UNAVAILABLE");}
}
