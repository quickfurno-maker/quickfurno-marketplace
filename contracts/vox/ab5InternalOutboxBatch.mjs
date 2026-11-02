/**
 * AB-5 private in-app-only outbox runner, deliberately not an HTTP route,
 * scheduled task, WhatsApp provider or live worker. Calls existing 08N
 * service-role PostgreSQL claim/process/fail procedures and stops closed on
 * any uncertain lease receipt. This module NEVER accesses an outbound API.
 */
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const deny=reason=>Object.freeze({ok:false,reason,workerActivated:false,
 attempted:0,internalDelivered:0,providerMessagesSent:0});
export async function runAb5InAppOnlyBatch({
 enabled=false,workerId,batch=5,leaseSeconds=60,
 privateWorkerAttested=false,claim,process,fail
}={}){
 if(enabled!==true||privateWorkerAttested!==true||
  typeof workerId!=="string"||!UUID.test(workerId)||
  !Number.isInteger(batch)||batch<1||batch>10||
  !Number.isInteger(leaseSeconds)||leaseSeconds<30||leaseSeconds>300||
  typeof claim!=="function"||typeof process!=="function"||typeof fail!=="function")
  return deny("APPROVED_PRIVATE_CORE_WORKER_REQUIRED");
 let jobs;
 try{jobs=await claim({workerId,batch,leaseSeconds});}
 catch{return deny("OUTBOX_CLAIM_UNAVAILABLE");}
 if(!Array.isArray(jobs)||jobs.length>batch)
  return deny("UNVERIFIED_PRIVATE_LEASE_WINDOW");
 const seen=new Set(),safe=[];
 for(const row of jobs){
  if(!row||typeof row!=="object"||Array.isArray(row)||
   typeof row.job_id!=="string"||!UUID.test(row.job_id)||
   typeof row.work_event_id!=="string"||!UUID.test(row.work_event_id)||
   typeof row.lease_token!=="string"||!UUID.test(row.lease_token)||
   !Number.isInteger(row.attempt)||row.attempt<1||row.attempt>5||
   seen.has(row.job_id)||seen.has(row.lease_token))
   return deny("UNVERIFIED_PRIVATE_LEASE_WINDOW");
  seen.add(row.job_id);seen.add(row.lease_token);
  safe.push(row);
 }
 let delivered=0,processed=0,requeued=0,deadLetter=0;
 for(const row of safe){
  let receipt;
  try{
   receipt=await process({workerId,jobId:row.job_id,
    leaseToken:row.lease_token});
  }catch{receipt=null;}
  if(receipt&&receipt.job_id===row.job_id&&
   Number.isInteger(receipt.internal_records)&&
   receipt.internal_records>=0&&receipt.internal_records<=100&&
   Object.keys(receipt).sort().join("|")==="internal_records|job_id"){
   delivered+=receipt.internal_records;processed++;continue;
  }
  let failure;
  try{
   failure=await fail({workerId,jobId:row.job_id,
    leaseToken:row.lease_token,errorCode:"SQL_TRANSIENT"});
  }catch{return Object.freeze({ok:false,reason:"LEASE_RECOVERY_UNCERTAIN",
   workerActivated:false,attempted:safe.length,processed,requeued,deadLetter,
   internalDelivered:delivered,providerMessagesSent:0});}
  if(!failure||failure.job_id!==row.job_id||
   !["PENDING","DEAD_LETTER"].includes(failure.new_state)||
   failure.attempt!==row.attempt)
   return Object.freeze({ok:false,reason:"LEASE_RECOVERY_UNVERIFIED",
    workerActivated:false,attempted:safe.length,processed,requeued,deadLetter,
    internalDelivered:delivered,providerMessagesSent:0});
  if(failure.new_state==="DEAD_LETTER")deadLetter++;
  else requeued++;
 }
 return Object.freeze({ok:true,
  schema:"qf.vox.ab5.in-app-only-worker-batch.v1",
  workerActivated:false,attempted:safe.length,processed,requeued,deadLetter,
  internalDelivered:delivered,providerMessagesSent:0,
  requiresIndependentStagingAuthorization:true});
}
