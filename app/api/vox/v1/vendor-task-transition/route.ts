import {getVerifiedScopedStaff} from "@/services/vox/verifiedScopedStaff";
import {adminClient} from "@/lib/supabase";
import {normalizeVendorTaskTransition} from "@/contracts/vox/vendorTaskTransitionInput.mjs";
export const runtime="nodejs";export const dynamic="force-dynamic";
const reply=(body:unknown,status:number)=>Response.json(body,{status,headers:{
 "cache-control":"private, no-store, max-age=0","vary":"Authorization","x-content-type-options":"nosniff"}});
const ATOMIC_RPC="qf_vox_core_vendor_task_transition_atomic_candidate_v1";
const gatesOn=()=>process.env.VOX_VENDOR_CRM_TASKS_ENABLED==="staging"&&
 process.env.VOX_VENDOR_TASK_TRANSITIONS_ENABLED==="staging"&&
 process.env.VOX_VENDOR_TASK_ATOMIC_RPC_ENABLED==="staging";
// Native Vendor CRM task lifecycle (complete/cancel). RC38: the reviewed atomic
// DB transaction is the ONLY writer. There is no service-role compare-and-set
// fallback and the route performs no direct table read or write at all.
export async function POST(request:Request){
 // All three exact "staging" gates are required BEFORE any header, Auth or body
 // access. Absent, empty or any other value fails closed.
 if(!gatesOn())return reply({ok:false,error:"VENDOR_TASKS_DISABLED"},503);
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
  const rpc=await adminClient().rpc(ATOMIC_RPC,{p_actor:scope.userId,p_team:scope.teamId,
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
 }catch{return reply({ok:false,error:"VENDOR_TASK_UNAVAILABLE"},503);}
}
export function GET(){return reply({ok:false,error:"METHOD_NOT_ALLOWED"},405);}
export function PUT(){return reply({ok:false,error:"METHOD_NOT_ALLOWED"},405);}
export function PATCH(){return reply({ok:false,error:"METHOD_NOT_ALLOWED"},405);}
export function DELETE(){return reply({ok:false,error:"METHOD_NOT_ALLOWED"},405);}
