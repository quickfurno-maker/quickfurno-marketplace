import "server-only";
import {getVerifiedScopedStaff} from "@/services/vox/verifiedScopedStaff";
import {adminClient} from "@/lib/supabase";
import {normalizeScopedSupportTask} from "@/contracts/vox/supportTaskInput.mjs";
export const runtime="nodejs";export const dynamic="force-dynamic";
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const respond=(body:unknown,status:number)=>Response.json(body,{status,headers:{
 "cache-control":"private, no-store, max-age=0","vary":"Authorization",
 "x-content-type-options":"nosniff"}});
export async function POST(request:Request){
 // No legacy split transaction. A Staff task must atomically create its
 // original Core CRM task, immutable F1 Staff record and one-use nonce.
 // Feature switches default OFF; this uninstalled SQL is RELEASE HOLD.
 if(process.env.VOX_SUPPORT_INTERNAL_TASKS_ENABLED!=="staging"||
    process.env.VOX_SUPPORT_ATOMIC_AUDIT_ENABLED!=="staging")
  return respond({ok:false,error:"ATOMIC_SUPPORT_TASK_DISABLED"},503);
 if(!request.headers.get("content-type")?.startsWith("application/json"))
  return respond({ok:false,error:"CONTENT_TYPE_DENIED"},415);
 try{
  const scope=await getVerifiedScopedStaff(request.headers.get("authorization"));
  // The AB-7B SQL candidate presently supports the exact Support department
  // role, not a vendor-success or generic operations-manager impersonation.
  if(!scope||scope.role!=="support_agent"||scope.canReadContent!==true||
     !UUID.test(scope.userId)||!UUID.test(scope.teamId)||!UUID.test(scope.cityId))
   return respond({ok:false,error:"STAFF_SCOPE_DENIED"},403);
  const raw=await request.text();
  if(raw.length>320)return respond({ok:false,error:"BODY_TOO_LARGE"},413);
  const input:unknown=JSON.parse(raw);
  const task=normalizeScopedSupportTask(input,scope);
  if(!task)return respond({ok:false,error:"ASSIGNMENT_OR_TASK_DENIED"},400);
  const nonce=(input as {nonce:string}).nonce;
  // Exact identity and active object grant are rechecked by reviewed Core
  // SQL. Do not use createVendorTask(): it writes without the F1 record.
  const {data,error}=await adminClient().rpc(
   "qf_vox_ab7b_support_task_atomic_candidate_v1",{
    p_actor:scope.userId,p_team:scope.teamId,p_city:scope.cityId,
    p_thread:task.threadId,p_nonce:nonce,p_priority:task.priority,
    p_due:task.due_at,p_idempotency_key:task.idempotency_key
   });
  if(error||!Array.isArray(data)||data.length!==1)
   return respond({ok:false,error:"ATOMIC_SUPPORT_TASK_DENIED_OR_REPLAY"},409);
  const receipt=data[0] as Record<string,unknown>;
  if(!receipt||typeof receipt!=="object"||Array.isArray(receipt)||
     !UUID.test(String(receipt.task_id))||
     receipt.source_event_id!==receipt.task_id||
     receipt.nonce_consumed!==true||
     receipt.native_event_appended!==true||
     receipt.provider_messages_sent!==0)
   return respond({ok:false,error:"ATOMIC_SUPPORT_RECEIPT_UNTRUSTED"},503);
  return respond({ok:true,taskId:receipt.task_id,threadId:task.threadId,
   created:true,authority:"quickfurno-core-atomic-vendor-crm",
   immutableStaffActivity:true,effect:"INTERNAL_SUPPORT_TASK_ONLY",
   providerMessagesSent:0},201);
 }catch{return respond({ok:false,error:"ATOMIC_SUPPORT_TASK_UNAVAILABLE"},503);}
}
export function GET(){return respond({ok:false,error:"METHOD_NOT_ALLOWED"},405);}
export function PATCH(){return respond({ok:false,error:"METHOD_NOT_ALLOWED"},405);}
export function DELETE(){return respond({ok:false,error:"METHOD_NOT_ALLOWED"},405);}
