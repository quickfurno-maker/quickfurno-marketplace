/** AB7F actual Core internal-notification worker invocation, source only.
 * No timer/bootstrap, no provider, no message sender and no autonomous AGNI.
 * Reuses approved supervisor and SQL lease/nonce RPCs.
 */
import {runApprovedStagingOutboxCycles}
 from "./voxInternalNotificationSupervisor.mjs";
const deny=reason=>Object.freeze({ok:false,reason,started:false,
 externalMessagesSent:0,productionCertified:false});
export async function runAb7fCoreInternalWorker({
 environment,enabled=false,workerId,featureGates,rpc,
 verifyDeploymentAuthority,emitSanitizedAgniObservation,
 verifyCurrentOperatorAal2,now=Date.now()
}={}){
 if(environment!=="staging"||enabled!==true||
  typeof workerId!=="string"||
  !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(workerId)||
  !Number.isSafeInteger(now)||now<=0||
  typeof rpc!=="function"||
  typeof verifyDeploymentAuthority!=="function"||
  typeof verifyCurrentOperatorAal2!=="function"||
  typeof emitSanitizedAgniObservation!=="function")
  return deny("SIGNED_INTERNAL_STAGING_WORKER_ONLY");
 try{
  if(await verifyCurrentOperatorAal2()!==true)
   return deny("CURRENT_OPERATOR_REVOKED");
  const seen=[];
  const outcome=await runApprovedStagingOutboxCycles({
   environment:"staging",featureGates,rpc,workerId,
   verifyDeploymentAuthority,
   emitObservation:async v=>seen.push({
    status:v.status,processed:v.jobsProcessed,
    retried:v.jobsRetried,deadLetter:v.jobsDeadLettered,
    unverified:v.unverified??0,
    source:"CORE_ONLY",providerMessagesSent:0
   }),
   shouldContinue:async cycle=>cycle===0&&
    await verifyCurrentOperatorAal2()===true,
   maxCycles:1,maxJobs:5
  });
  if(!outcome.ok)
   return deny(outcome.reason??"CORE_INTERNAL_WORKER_UNVERIFIED");
  // Observability must never be allowed to mutate or retry the Core job.
  try{
   await emitSanitizedAgniObservation(Object.freeze({
    schema:"qf.vox.ab7f.internal-worker-health.v1",
    cycles:outcome.cycles,internalRecords:outcome.totalInternalRecords,
    deadLetters:outcome.jobsDeadLettered,
    needsOwnerReview:outcome.requiresOwnerAlert,
    externalMessagesSent:0,advisoryOnly:true
   }));
  }catch{/* advisory transport outage cannot undo a Core transaction */}
  return Object.freeze({ok:true,started:outcome.cycles===1,
   cycles:outcome.cycles,internalRecords:outcome.totalInternalRecords,
   jobsRetried:outcome.jobsRetried,jobsDeadLettered:outcome.jobsDeadLettered,
   needsOwnerReview:outcome.requiresOwnerAlert,
   externalMessagesSent:0,pushDeliveriesVerified:0,
   productionCertified:false,noSchedulerInstalled:true});
 }catch{return deny("CORE_WORKER_BRIDGE_OUTCOME_UNKNOWN");}
}
