import "server-only";
import {adminClient} from "@/lib/supabase";
import {runAb5InAppOnlyBatch} from "@/contracts/vox/ab5InternalOutboxBatch.mjs";
/**
 * Candidate composition for an explicitly attested, private Core worker.
 * Not referenced from Next public app routes; NO scheduler or provider.
 * DB functions are uninstalled SQL candidates, and stage defaults to OFF.
 */
export async function runGovernedCoreInAppNotificationBatch(
 workerId:string,batch=5
):Promise<unknown>{
 const enabled=process.env.VOX_AB5_PRIVATE_INAPP_WORKER_ENABLED==="staging"&&
  process.env.VOX_STAFF_GRANTS_ENABLED==="staging"&&
  process.env.VOX_STAFF_WORK_NOTIFICATIONS_ENABLED==="staging";
 if(!enabled)return {ok:false,reason:"IN_APP_PRIVATE_WORKER_DISABLED",
  providerMessagesSent:0};
 const db=adminClient();
 const rpc=async(name:string,args:Record<string,unknown>)=>{
  const res=await db.rpc(name,args);
  if(res.error||!Array.isArray(res.data))throw Error("CORE_RPC_UNAVAILABLE");
  return res.data;
 };
 return runAb5InAppOnlyBatch({enabled,workerId,batch,leaseSeconds:60,
  privateWorkerAttested:true,
  claim:async({workerId:actor,batch:size,leaseSeconds:lease}:{
   workerId:string;batch:number;leaseSeconds:number
  })=>rpc("qf_vox_staff_notification_outbox_claim_v1",{
   p_worker:actor,p_batch:size,p_lease_seconds:lease}),
  process:async({workerId:actor,jobId,leaseToken}:{
   workerId:string;jobId:string;leaseToken:string
  })=>{
   const data=await rpc("qf_vox_staff_notification_outbox_process_v1",{
    p_worker:actor,p_job:jobId,p_token:leaseToken});
   if(data.length!==1)throw Error("PROCESS_RECEIPT_COUNT");
   return data[0];
  },
  fail:async({workerId:actor,jobId,leaseToken,errorCode}:{
   workerId:string;jobId:string;leaseToken:string;errorCode:string
  })=>{
   const data=await rpc("qf_vox_staff_notification_outbox_fail_v1",{
    p_worker:actor,p_job:jobId,p_token:leaseToken,p_code:errorCode});
   if(data.length!==1)throw Error("RECOVERY_RECEIPT_COUNT");
   return data[0];
  }
 });
}
