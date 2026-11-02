import "server-only";
import {getVerifiedScopedStaff} from "@/services/vox/verifiedScopedStaff";
import {adminClient} from "@/lib/supabase";
import {normalizeScopedAarohiTask} from "@/contracts/vox/aarohiTaskInput.mjs";
export const runtime="nodejs";export const dynamic="force-dynamic";
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{12}$/i;
const respond=(body:unknown,status:number)=>Response.json(body,{status,headers:{
 "cache-control":"private, no-store, max-age=0","vary":"Authorization",
 "x-content-type-options":"nosniff"}});
export async function POST(request:Request){
 // Disabled by default: no unaudited fallback, provider send or admin bypass.
 if(process.env.VOX_AAROHI_INTERNAL_TASKS_ENABLED!=="staging"||
    process.env.VOX_AAROHI_ATOMIC_AUDIT_ENABLED!=="staging"||
    process.env.VOX_DEPARTMENT_ENFORCEMENT_ENABLED!=="staging")
  return respond({ok:false,error:"ATOMIC_AAROHI_TASK_DISABLED"},503);
 if(!request.headers.get("content-type")?.startsWith("application/json"))
  return respond({ok:false,error:"CONTENT_TYPE_DENIED"},415);
 try{
  const scope=await getVerifiedScopedStaff(request.headers.get("authorization"));
  if(!scope||scope.role!=="acquisition_agent"||scope.canReadContent!==true)
   return respond({ok:false,error:"STAFF_SCOPE_DENIED"},403);
  const raw=await request.text();
  if(raw.length>320)return respond({ok:false,error:"BODY_TOO_LARGE"},413);
  const input:unknown=JSON.parse(raw);
  const task=normalizeScopedAarohiTask(input,scope);
  if(!task)return respond({ok:false,error:"ASSIGNED_PROSPECT_OR_TASK_DENIED"},400);
  const {data,error}=await adminClient().rpc(
   "qf_vox_ab7b_aarohi_task_atomic_candidate_v1",{
    p_actor:scope.userId,p_team:scope.teamId,p_city:scope.cityId,
    p_prospect:task.prospectId,p_nonce:task.nonce,p_priority:task.priority,
    p_due:task.due_at
   });
  if(error||!Array.isArray(data)||data.length!==1)
   return respond({ok:false,error:"ATOMIC_AAROHI_TASK_DENIED_OR_REPLAY"},409);
  const receipt=data[0] as Record<string,unknown>;
  if(!receipt||typeof receipt!=="object"||Array.isArray(receipt)||
     !UUID.test(String(receipt.task_id))||!UUID.test(String(receipt.crm_event_id))||
     receipt.source_event_id!==receipt.task_id||
     receipt.nonce_consumed!==true||receipt.native_event_appended!==true||
     receipt.provider_messages_sent!==0)
   return respond({ok:false,error:"ATOMIC_AAROHI_RECEIPT_UNTRUSTED"},503);
  return respond({ok:true,taskId:receipt.task_id,crmEventId:receipt.crm_event_id,
   prospectId:task.prospectId,created:true,authority:"canonical-aarohi-crm-atomic",
   immutableStaffActivity:true,effect:"INTERNAL_AAROHI_FOLLOW_UP_ONLY",
   providerMessagesSent:0},201);
 }catch{return respond({ok:false,error:"ATOMIC_AAROHI_TASK_UNAVAILABLE"},503);}
}
export function GET(){return respond({ok:false,error:"METHOD_NOT_ALLOWED"},405);}
export function PATCH(){return respond({ok:false,error:"METHOD_NOT_ALLOWED"},405);}
export function DELETE(){return respond({ok:false,error:"METHOD_NOT_ALLOWED"},405);}
