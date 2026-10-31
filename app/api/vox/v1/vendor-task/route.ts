import {getVerifiedScopedStaff} from "@/services/vox/verifiedScopedStaff";
import {adminClient} from "@/lib/supabase";
import {createVendorTask} from "@/services/vendorCrmService";
import {normalizeScopedVendorTask} from "@/contracts/vox/vendorTaskInput.mjs";
export const runtime="nodejs";export const dynamic="force-dynamic";
const reply=(body:unknown,status:number)=>Response.json(body,{status,headers:{
 "cache-control":"private, no-store, max-age=0","vary":"Authorization","x-content-type-options":"nosniff"}});
const RPC="qf_vox_core_vendor_task_atomic_candidate_v1";
// Default OFF. Only an explicit "staging" value after the reviewed SQL is
// installed routes writes through the atomic RPC. No silent fallback either way.
const atomicRpcOn=()=>process.env.VOX_VENDOR_TASK_ATOMIC_RPC_ENABLED==="staging";
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
 if(process.env.VOX_VENDOR_CRM_TASKS_ENABLED!=="staging")
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
  const db=adminClient();
  if(atomicRpcOn()){
   // Authority is locked and re-verified inside the same DB transaction as the insert.
   const rpc=await db.rpc(RPC,{p_actor:scope.userId,p_team:scope.teamId,
    p_city:scope.cityId,p_role:scope.role,p_vendor:task.vendorId,
    p_task_type:task.task_type,p_title:task.title,p_priority:task.priority,
    p_due:task.due_at,p_idempotency_key:task.idempotency_key});
   if(rpc.error)return rpcError(String(rpc.error.message??""));
   const row=Array.isArray(rpc.data)?rpc.data[0]:rpc.data;
   if(!row||typeof row.task_id!=="string"||typeof row.created!=="boolean")
    return reply({ok:false,error:"VENDOR_TASK_UNAVAILABLE"},503);
   return reply({ok:true,taskId:row.task_id,created:row.created,
    authority:"quickfurno-core-vendor-crm",scope:"ASSIGNED_VENDOR_ONLY"},row.created?201:200);
  }
  // Recheck canonical Core vendor service-zone city immediately before mutation.
  const vendor=await db.from("vendors").select("id,service_zone_id")
    .eq("id",task.vendorId).maybeSingle();
  if(vendor.error||!vendor.data?.service_zone_id)
   return reply({ok:false,error:"VENDOR_SCOPE_UNAVAILABLE"},503);
  const zone=await db.from("marketplace_service_zones").select("city_id,is_active")
    .eq("id",vendor.data.service_zone_id).maybeSingle();
  if(zone.error||zone.data?.city_id!==scope.cityId||zone.data?.is_active!==true)
   return reply({ok:false,error:"VENDOR_CITY_DENIED"},403);
  // Staff grant/team/city/role may be revoked between the initial check and
  // here. Re-read full Core staff authority after the last vendor lookup and
  // immediately before the CRM write; require the same actor/role/team/city
  // and a still-assigned vendor. This also gates idempotent replays, so a
  // revoked actor cannot read back an existing task id.
  const fresh=await getVerifiedScopedStaff(request.headers.get("authorization"));
  if(!fresh||fresh.userId!==scope.userId||fresh.cityId!==scope.cityId||
     fresh.teamId!==scope.teamId||fresh.role!==scope.role||
     !fresh.vendorIds.includes(task.vendorId))
   return reply({ok:false,error:"SCOPE_DENIED"},403);
  let result;
  try{
   result=await createVendorTask(task.vendorId,{
    task_type:task.task_type,title:task.title,priority:task.priority,
    due_at:task.due_at,idempotency_key:task.idempotency_key,
   },scope.userId);
  }catch(error){
   // Same key with a different payload is a client conflict, not an outage.
   if(error instanceof Error&&error.message==="VENDOR_TASK_IDEMPOTENCY_CONFLICT")
    return reply({ok:false,error:"IDEMPOTENCY_CONFLICT"},409);
   throw error;
  }
  const created=result.idempotent!==true;
  // 201 = this request created the row; 200 = exact replay of an earlier one.
  return reply({ok:true,taskId:result.id,created,
   authority:"quickfurno-core-vendor-crm",scope:"ASSIGNED_VENDOR_ONLY"},created?201:200);
 }catch{return reply({ok:false,error:"VENDOR_TASK_UNAVAILABLE"},503);}
}
export function GET(){return reply({ok:false,error:"METHOD_NOT_ALLOWED"},405);}
export function PATCH(){return reply({ok:false,error:"METHOD_NOT_ALLOWED"},405);}
export function DELETE(){return reply({ok:false,error:"METHOD_NOT_ALLOWED"},405);}
