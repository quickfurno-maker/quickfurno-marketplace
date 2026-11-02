/**
 * VOX-08N one-shot Core-only Staff notification outbox processor.
 * SOURCE-ONLY: no scheduler, server action, provider send or live credential.
 * SQL candidate is outside managed migrations and uninstalled in Staging/Prod.
 * A future approved Core service-role worker must inject its existing RPC
 * adapter only after independent DBA/AppSec/TL/staging release authorization.
 */
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const isUuid=v=>typeof v==="string"&&uuid.test(v);
const integer=(v,lo,hi)=>Number.isSafeInteger(v)&&v>=lo&&v<=hi;
const isRecord=x=>!!x&&typeof x==="object"&&!Array.isArray(x);
const precise=(obj,fields)=>isRecord(obj)&&
 Object.keys(obj).sort().join("|")===[...fields].sort().join("|");
export const candidateRpcNames=Object.freeze({
 claim:"qf_vox_staff_notification_outbox_claim_v1",
 process:"qf_vox_staff_notification_outbox_process_v1",
 fail:"qf_vox_staff_notification_outbox_fail_v1"
});
/**
 * Strictly one batch, no unapproved async/recurring scheduler. An "enabled"
 * boolean is solely an in-process safety gate, NOT human authorization.
 * Caller still has to prove real approval and stage-only deployment separately.
 */
export async function runIsolatedNotificationOutboxOnce({
 rpc,workerId,enabled=false,maxJobs=5,leaseSeconds=90
}={}){
 if(enabled!==true)return {ok:false,status:"NOT_ACTIVATED",jobsClaimed:0,
  jobsProcessed:0,jobsRetried:0,jobsDeadLettered:0,internalRecords:0,
  externalMessagesSent:0,pushDeliveriesVerified:0};
 if(typeof rpc!=="function"||!isUuid(workerId)||
  !integer(maxJobs,1,10)||!integer(leaseSeconds,30,300))
  return {ok:false,status:"INVALID_PROCESSOR_INPUT",jobsClaimed:0,
   jobsProcessed:0,jobsRetried:0,jobsDeadLettered:0,internalRecords:0,
   externalMessagesSent:0,pushDeliveriesVerified:0};
 const stats={ok:true,status:"SOURCE_ONLY_BATCH",jobsClaimed:0,
  jobsProcessed:0,jobsRetried:0,jobsDeadLettered:0,unverified:0,
  internalRecords:0,externalMessagesSent:0,pushDeliveriesVerified:0};
 let claim;
 try{
  claim=await rpc(candidateRpcNames.claim,{
   p_worker:workerId,p_batch:maxJobs,p_lease_seconds:leaseSeconds
  });
 }catch{
  return {...stats,ok:false,status:"CLAIM_TRANSPORT_UNKNOWN"};
 }
 if(!isRecord(claim)||claim.error||!Array.isArray(claim.data)||
  claim.data.length>maxJobs)
  return {...stats,ok:false,status:"CLAIM_DENIED_OR_UNVERIFIED"};
 const claims=claim.data;
 const seen=new Set(),events=new Set();
 for(const item of claims){
  if(!precise(item,["job_id","work_event_id","lease_token","attempt"])||
   !isUuid(item.job_id)||!isUuid(item.work_event_id)||
   !isUuid(item.lease_token)||!integer(item.attempt,1,5)||
   seen.has(item.job_id)||events.has(item.work_event_id))
   return {...stats,ok:false,status:"CLAIM_PROOF_INVALID"};
  seen.add(item.job_id);events.add(item.work_event_id);
 }
 stats.jobsClaimed=claims.length;
 for(const job of claims){
  let response;
  try{
   response=await rpc(candidateRpcNames.process,{
    p_worker:workerId,p_job:job.job_id,p_token:job.lease_token
   });
  }catch{
   // Ambiguous transport errors: do not guess whether SQL committed.
   // Lease expiry + deterministic event nonce handles replay safely.
   stats.unverified++;
   continue;
  }
  if(isRecord(response)&&!response.error&&Array.isArray(response.data)&&
   response.data.length===1&&
   precise(response.data[0],["job_id","internal_records"])&&
   response.data[0].job_id===job.job_id&&
   integer(response.data[0].internal_records,0,100)){
   stats.jobsProcessed++;
   stats.internalRecords+=response.data[0].internal_records;
   continue;
  }
  if(!isRecord(response)||!response.error){
   // Invalid/ambiguous success: never call fail to overwrite a potential DONE.
   stats.unverified++;
   continue;
  }
  // Confirmed SQL error (a rolled-back RPC). Lease-bound, no raw text/PII.
  let retry;
  try{
   retry=await rpc(candidateRpcNames.fail,{
    p_worker:workerId,p_job:job.job_id,p_token:job.lease_token,
    p_code:"SQL_TRANSIENT"
   });
  }catch{stats.unverified++;continue;}
  if(!isRecord(retry)||retry.error||!Array.isArray(retry.data)||
   retry.data.length!==1||!precise(retry.data[0],
    ["job_id","new_state","attempt"])||
   retry.data[0].job_id!==job.job_id||
   retry.data[0].attempt!==job.attempt||
   !["PENDING","DEAD_LETTER"].includes(retry.data[0].new_state)){
   stats.unverified++;continue;
  }
  if(retry.data[0].new_state==="PENDING")stats.jobsRetried++;
  else stats.jobsDeadLettered++;
 }
 if(stats.unverified>0){stats.ok=false;stats.status="PARTIAL_UNVERIFIED";}
 return stats;
}
