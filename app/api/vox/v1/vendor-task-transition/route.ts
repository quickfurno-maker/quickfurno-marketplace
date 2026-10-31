import {getVerifiedScopedStaff} from "@/services/vox/verifiedScopedStaff";
import {adminClient} from "@/lib/supabase";
import {normalizeVendorTaskTransition} from "@/contracts/vox/vendorTaskTransitionInput.mjs";
export const runtime="nodejs";export const dynamic="force-dynamic";
const reply=(body:unknown,status:number)=>Response.json(body,{status,headers:{
 "cache-control":"private, no-store, max-age=0","vary":"Authorization","x-content-type-options":"nosniff"}});
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ACTIVE=["open","in_progress","blocked"];
const SELECT="id,vendor_id,status,completion_result,updated_by";
const ATOMIC_RPC="qf_vox_core_vendor_task_transition_atomic_candidate_v1";
// Native Vendor CRM task lifecycle (complete/cancel). Writes only vendor_tasks
// status columns through service_role after Core authority is re-read; never
// vendors, consent, WhatsApp, credits or conversations.
export async function POST(request:Request){
 // Separate default-OFF gate: this service-role CAS is not a DB-locked staff
 // authority transaction. Do not activate alongside task creation automatically.
 if(process.env.VOX_VENDOR_CRM_TASKS_ENABLED!=="staging"||
    process.env.VOX_VENDOR_TASK_TRANSITIONS_ENABLED!=="staging")
  return reply({ok:false,error:"VENDOR_TASKS_DISABLED"},503);
 if(!request.headers.get("content-type")?.startsWith("application/json"))
  return reply({ok:false,error:"INVALID_CONTENT_TYPE"},415);
 try{
  const scope=await getVerifiedScopedStaff(request.headers.get("authorization"));
  if(!scope||!["operations_manager","vendor_success_agent"].includes(scope.role))
   return reply({ok:false,error:"SCOPE_DENIED"},403);
  const raw=await request.text();
  if(raw.length>600)return reply({ok:false,error:"PAYLOAD_TOO_LARGE"},413);
  const cmd=normalizeVendorTaskTransition(JSON.parse(raw),scope);
  if(!cmd)return reply({ok:false,error:"INVALID_TRANSITION"},400);
  const db=adminClient();
  // Additional default-OFF gate. When atomic is required ("staging") the DB
  // transaction is the ONLY writer: no fallback to the weak CAS below, ever.
  // Any other non-empty value is a misconfiguration and fails closed.
  const atomic=process.env.VOX_VENDOR_TASK_ATOMIC_RPC_ENABLED;
  if(atomic!==undefined&&atomic!==""){
   if(process.env.VOX_VENDOR_TASK_ATOMIC_RPC_ENABLED!=="staging")
    return reply({ok:false,error:"VENDOR_TASKS_DISABLED"},503);
   const rpc=await db.rpc(ATOMIC_RPC,{p_actor:scope.userId,p_team:scope.teamId,
    p_city:scope.cityId,p_role:scope.role,p_task:cmd.taskId,p_action:cmd.action,
    p_result:cmd.result});
   if(rpc.error){
    const m=String(rpc.error.message??"");
    if(/VOX_CORE_TASK_(STAFF|TEAM_OR_CITY|VENDOR_GRANT)_NOT_CURRENT/.test(m))
     return reply({ok:false,error:"SCOPE_DENIED"},403);
    if(/VOX_CORE_TASK_VENDOR_CITY_DENIED/.test(m))
     return reply({ok:false,error:"VENDOR_CITY_DENIED"},403);
    if(/VOX_VENDOR_TASK_STATE_CONFLICT/.test(m))
     return reply({ok:false,error:"TASK_STATE_CONFLICT"},409);
    if(/VOX_CORE_TASK_TRANSITION_INPUT_DENIED/.test(m))
     return reply({ok:false,error:"INVALID_TRANSITION"},400);
    return reply({ok:false,error:"VENDOR_TASK_UNAVAILABLE"},503);
   }
   const row=Array.isArray(rpc.data)?(rpc.data.length===1?rpc.data[0]:null):rpc.data;
   if(!row||row.task_id!==cmd.taskId||row.task_status!==cmd.status||
      typeof row.replayed!=="boolean"||typeof row.receipt!=="string"||
      !/^[0-9a-f]{64}$/.test(row.receipt))
    return reply({ok:false,error:"VENDOR_TASK_UNAVAILABLE"},503);
   return reply({ok:true,taskId:cmd.taskId,status:cmd.status,replayed:row.replayed,
    receipt:row.receipt,authority:"quickfurno-core-vendor-crm",
    scope:"ASSIGNED_VENDOR_ONLY"},row.replayed?200:201);
  }
  const read=await db.from("vendor_tasks").select(SELECT).eq("id",cmd.taskId).maybeSingle();
  if(read.error)return reply({ok:false,error:"VENDOR_TASK_UNAVAILABLE"},503);
  // Unknown task and out-of-grant task are indistinguishable to the caller.
  const task=read.data;
  if(!task||typeof task.vendor_id!=="string"||!scope.vendorIds.includes(task.vendor_id))
   return reply({ok:false,error:"SCOPE_DENIED"},403);
  const vendor=await db.from("vendors").select("id,service_zone_id").eq("id",task.vendor_id).maybeSingle();
  if(vendor.error||!vendor.data?.service_zone_id)
   return reply({ok:false,error:"VENDOR_SCOPE_UNAVAILABLE"},503);
  const zone=await db.from("marketplace_service_zones").select("city_id,is_active")
   .eq("id",vendor.data.service_zone_id).maybeSingle();
  if(zone.error||zone.data?.city_id!==scope.cityId||zone.data?.is_active!==true)
   return reply({ok:false,error:"VENDOR_CITY_DENIED"},403);
  // Revocation recheck after the last lookup and before ANY write or replay.
  const fresh=await getVerifiedScopedStaff(request.headers.get("authorization"));
  if(!fresh||fresh.userId!==scope.userId||fresh.cityId!==scope.cityId||
     fresh.teamId!==scope.teamId||fresh.role!==scope.role||
     !fresh.vendorIds.includes(task.vendor_id))
   return reply({ok:false,error:"SCOPE_DENIED"},403);
  const done=(replayed:boolean)=>reply({ok:true,taskId:cmd.taskId,status:cmd.status,replayed,
   authority:"quickfurno-core-vendor-crm",scope:"ASSIGNED_VENDOR_ONLY"},replayed?200:201);
  // Exact replay only: same actor, same terminal state, same completion text.
  const sameTerminal=(t:{status:unknown;completion_result:unknown;updated_by:unknown})=>
   t.status===cmd.status&&t.updated_by===scope.userId&&
   (cmd.status==="cancelled"||t.completion_result===cmd.result);
  if(!ACTIVE.includes(task.status))
   return sameTerminal(task)?done(true):reply({ok:false,error:"TASK_STATE_CONFLICT"},409);
  const patch=cmd.status==="done"
   ?{status:"done",completion_result:cmd.result,completed_at:new Date().toISOString(),updated_by:scope.userId}
   :{status:"cancelled",updated_by:scope.userId};
  // Compare-and-set on the active states: a concurrent transition wins once.
  const upd=await db.from("vendor_tasks").update(patch).eq("id",cmd.taskId)
   .eq("vendor_id",task.vendor_id).in("status",ACTIVE).select("id");
  if(upd.error)return reply({ok:false,error:"VENDOR_TASK_UNAVAILABLE"},503);
  if(Array.isArray(upd.data)&&upd.data.length>1)
   return reply({ok:false,error:"VENDOR_TASK_UNAVAILABLE"},503);
  if(Array.isArray(upd.data)&&upd.data.length===1&&typeof upd.data[0]?.id==="string"&&
     UUID.test(upd.data[0].id)&&upd.data[0].id===cmd.taskId)return done(false);
  // Lost the race: classify against the winner without echoing foreign data.
  const again=await db.from("vendor_tasks").select(SELECT).eq("id",cmd.taskId).maybeSingle();
  if(again.error||!again.data)return reply({ok:false,error:"VENDOR_TASK_UNAVAILABLE"},503);
  return !ACTIVE.includes(again.data.status)&&sameTerminal(again.data)
   ?done(true):reply({ok:false,error:"TASK_STATE_CONFLICT"},409);
 }catch{return reply({ok:false,error:"VENDOR_TASK_UNAVAILABLE"},503);}
}
export function GET(){return reply({ok:false,error:"METHOD_NOT_ALLOWED"},405);}
export function PUT(){return reply({ok:false,error:"METHOD_NOT_ALLOWED"},405);}
export function PATCH(){return reply({ok:false,error:"METHOD_NOT_ALLOWED"},405);}
export function DELETE(){return reply({ok:false,error:"METHOD_NOT_ALLOWED"},405);}
