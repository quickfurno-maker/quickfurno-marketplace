/**
 * F1 bounded run-cycle supervision for the Core-only internal notification
 * worker. No timer, daemon or live process activation in this source module.
 * A separately approved bootstrap/supervisor can call this after DBA/AppSec,
 * identity and managed staging SQL have been verified.
 */
import {runVoxInternalNotificationCycle}
 from "./voxInternalNotificationCycle.mjs";
const fail=reason=>Object.freeze({ok:false,reason,cycles:0,
 totalInternalRecords:0,totalExternalMessagesSent:0,source:"CORE_ONLY"});
export async function runApprovedStagingOutboxCycles({
 environment,featureGates,verifyDeploymentAuthority,rpc,workerId,
 emitObservation,shouldContinue,maxCycles=1,maxJobs=5
}={}){
 if(environment!=="staging"||typeof verifyDeploymentAuthority!=="function"||
  typeof rpc!=="function"||typeof emitObservation!=="function"||
  typeof shouldContinue!=="function"||
  !Number.isSafeInteger(maxCycles)||maxCycles<1||maxCycles>20||
  !Number.isSafeInteger(maxJobs)||maxJobs<1||maxJobs>10)
  return fail("APPROVED_STAGING_SUPERVISOR_REQUIRED");
 let cycles=0,totalInternalRecords=0,jobsRetried=0,jobsDeadLettered=0;
 for(let i=0;i<maxCycles;i++){
  let keepGoing;
  try{keepGoing=await shouldContinue(i);}catch{
   return fail("SUPERVISOR_STOP_VERIFICATION_UNAVAILABLE");
  }
  if(keepGoing!==true)break;
  // Never cache approval or skip the existing independent release attestation.
  const result=await runVoxInternalNotificationCycle({
   environment,featureGates,verifyDeploymentAuthority,rpc,workerId,
   emitObservation,maxJobs
  });
  if(!result.ok)return Object.freeze({ok:false,reason:result.status,
   cycles,totalInternalRecords,jobsRetried,jobsDeadLettered,
   requiresOwnerAlert:true,totalExternalMessagesSent:0,source:"CORE_ONLY"});
  cycles++;totalInternalRecords+=result.internalRecords;
  jobsRetried+=result.jobsRetried;jobsDeadLettered+=result.jobsDeadLettered;
 }
 return Object.freeze({ok:true,status:jobsDeadLettered>0?
  "DEAD_LETTERS_REQUIRE_OWNER_REVIEW":"BOUNDED_INTERNAL_CYCLES_COMPLETE",
  cycles,totalInternalRecords,jobsRetried,jobsDeadLettered,
  requiresOwnerAlert:jobsDeadLettered>0,
  totalExternalMessagesSent:0,pushDeliveriesVerified:0,
  source:"CORE_ONLY",releaseCertified:false});
}
