import {getVerifiedScopedStaff} from "@/services/vox/verifiedScopedStaff";
import {adminClient} from "@/lib/supabase";
import {normalizeScopedVendorTask} from "@/contracts/vox/vendorTaskInput.mjs";
export const runtime="nodejs";export const dynamic="force-dynamic";
const reply=(body:unknown,status:number)=>Response.json(body,{status,headers:{
 "cache-control":"private, no-store, max-age=0","vary":"Authorization","x-content-type-options":"nosniff"}});
const RPC="qf_vox_core_vendor_task_atomic_candidate_v1";
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
// Default OFF. Both exact "staging" gates are required BEFORE any header, Auth
// or body access. Absent, empty or any other value fails closed.
const gatesOff=()=>process.env.VOX_VENDOR_CRM_TASKS_ENABLED!=="staging"||
 process.env.VOX_VENDOR_TASK_ATOMIC_RPC_ENABLED!=="staging";
function rpcError(message:string){
 if(message.includes("VOX_VENDOR_TASK_IDEMPOTENCY_CONFLICT"))
  return reply({ok:false,error:"IDEMPOTENCY_CONFLICT"},409);
 if(message.includes("VOX_CORE_TASK_INPUT_DENIED"))
  return reply({ok:false,error:"INVALID_TASK_OR_SCOPE"},400);
 if(/VOX_CORE_TASK_(STAFF|TEAM_OR_CITY|VENDOR_GRANT|VENDOR_CITY)/.test(message))
  return reply({ok:false,error:"SCOPE_DENIED"},403);
 // Missing function, no EXECUTE, or any other fault: fail closed.
 return reply({ok:false,error:"VENDOR_TASK_UNAVAILABLE"},503);
}
export async function POST(request:Request){
 // No vendor/WhatsApp/credit mutations. Only native Vendor CRM task rows.
 if(gatesOff())
  return reply({ok:false,error:"VENDOR_TASKS_DISABLED"},503);
 if(!request.headers.get("content-type")?.startsWith("application/json"))
  return reply({ok:false,error:"INVALID_CONTENT_TYPE"},415);
 try{
  const scope=await getVerifiedScopedStaff(request.headers.get("authorization"));
  if(!scope||!["operations_manager","vendor_success_agent"].includes(scope.role))
   return reply({ok:false,error:"SCOPE_DENIED"},403);
  const raw=await request.text();
  if(raw.length>700)return reply({ok:false,error:"PAYLOAD_TOO_LARGE"},413);
  const data:unknown=JSON.parse(raw);
  const task=normalizeScopedVendorTask(data,scope);
  if(!task)return reply({ok:false,error:"INVALID_TASK_OR_SCOPE"},400);
  // RC38: the reviewed atomic DB transaction is the ONLY writer. Authority is
  // locked and re-verified in the same transaction as the insert. There is no
  // service-role fallback and no direct vendor/zone/task table access.
  const rpc=await adminClient().rpc(RPC,{p_actor:scope.userId,p_team:scope.teamId,
   p_city:scope.cityId,p_role:scope.role,p_vendor:task.vendorId,
   p_task_type:task.task_type,p_title:task.title,p_priority:task.priority,
   p_due:task.due_at,p_idempotency_key:task.idempotency_key});
  if(rpc.error)return rpcError(String(rpc.error.message??""));
  // Exactly one receipt row with a canonical UUID and a real boolean; any
  // other shape is a forged/faulty result and is never echoed to the caller.
  const row=Array.isArray(rpc.data)?(rpc.data.length===1?rpc.data[0]:null):rpc.data;
  if(!row||typeof row.task_id!=="string"||!UUID.test(row.task_id)||
     typeof row.created!=="boolean")
   return reply({ok:false,error:"VENDOR_TASK_UNAVAILABLE"},503);
  return reply({ok:true,taskId:row.task_id,created:row.created,
   authority:"quickfurno-core-vendor-crm",scope:"ASSIGNED_VENDOR_ONLY"},row.created?201:200);
 }catch{return reply({ok:false,error:"VENDOR_TASK_UNAVAILABLE"},503);}
}
export function GET(){return reply({ok:false,error:"METHOD_NOT_ALLOWED"},405);}
export function PATCH(){return reply({ok:false,error:"METHOD_NOT_ALLOWED"},405);}
export function DELETE(){return reply({ok:false,error:"METHOD_NOT_ALLOWED"},405);}
