import "server-only";
import {adminClient} from "@/lib/supabase";
import {verifyVoxOwnerBearer} from "@/services/vox/verifiedStaffBearer";
import {getVerifiedScopedStaff} from "@/services/vox/verifiedScopedStaff";
export const runtime="nodejs";
export const dynamic="force-dynamic";

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PACKS=new Set(["client_success","vendor_success","acquisition","service_support"]);
const send=(value:unknown,status:number)=>Response.json(value,{status,headers:{
 "cache-control":"private, no-store, max-age=0",
 "vary":"Authorization","x-content-type-options":"nosniff"
}});
const record=(x:unknown):x is Record<string,unknown>=>x!==null&&typeof x==="object"&&!Array.isArray(x);
const uuid=(v:unknown):v is string=>typeof v==="string"&&UUID.test(v);
const reference=(v:unknown):v is string=>typeof v==="string"&&v.trim()===v&&v.length>=8&&v.length<=128;
const reason=(v:unknown):v is string=>typeof v==="string"&&v.trim()===v&&v.length>=12&&v.length<=500;
const one=(v:unknown):Record<string,unknown>|null=>
 Array.isArray(v)&&v.length===1&&record(v[0])?v[0]:null;
/** Core service-only execute path. All actor IDs are derived from verified
 * Supabase Auth AAL2, never from an untrusted browser actor or role field.
 * SQL independently enforces reviewer/finalizer separation and current grants.
 * Defaults OFF; candidate SQL is NOT applied to any managed environment.
 */
export async function POST(request:Request){
 if(process.env.VOX_STAFF_GRANTS_ENABLED!=="staging"||
    process.env.VOX_STAFF_DEPARTMENT_WRITES_ENABLED!=="staging")
  return send({ok:false,error:"DEPARTMENT_WRITES_DISABLED"},503);
 if(!request.headers.get("content-type")?.startsWith("application/json"))
  return send({ok:false,error:"INVALID_CONTENT_TYPE"},415);
 let data:Record<string,unknown>;
 try{
  const raw=await request.text();
  if(raw.length===0||raw.length>1600)return send({ok:false,error:"BODY_INVALID_OR_TOO_LARGE"},413);
  const json:unknown=JSON.parse(raw);
  if(!record(json))return send({ok:false,error:"INVALID_BODY"},400);
  data=json;
 }catch{return send({ok:false,error:"INVALID_BODY"},400);}
 const action=data.action;
 if(!["request","review","activate","revoke"].includes(String(action)))
  return send({ok:false,error:"UNKNOWN_ACTION"},400);
 try{
  const token=request.headers.get("authorization");
  // Independent TL review is the ONLY mutation that does not use owner bearer.
  const tl=action==="review"?await getVerifiedScopedStaff(token):null;
  const actor=action==="review"?(tl?.role==="team_leader"?tl.userId:null):
     await verifyVoxOwnerBearer(token);
  if(!actor)return send({ok:false,error:"VERIFIED_AAL2_ACTOR_REQUIRED"},403);
  const db=adminClient();
  if(action==="request"){
   if(!uuid(data.targetStaffId)||!uuid(data.teamId)||!uuid(data.cityId)||
      !uuid(data.nonce)||!PACKS.has(String(data.department))||
      !reason(data.reason)||typeof data.expiresAt!=="string"||
      data.expiresAt.length>40||!Number.isFinite(Date.parse(data.expiresAt)))
    return send({ok:false,error:"INVALID_REQUEST"},400);
   const exp=Date.parse(data.expiresAt);
   if(exp<=Date.now()+5*60_000||exp>Date.now()+30*86400_000)
    return send({ok:false,error:"INVALID_LEASE"},400);
   const {data:result,error}=await db.rpc("qf_vox_department_request_v1",{
    p_owner:actor,p_target:data.targetStaffId,p_team:data.teamId,
    p_city:data.cityId,p_pack:data.department,p_request_nonce:data.nonce,
    p_expires:new Date(exp).toISOString(),p_reason:data.reason
   });
   const item=one(result);
   if(error||!item||!uuid(item.request_id)||item.request_state!=="PENDING"||
      item.request_revision!==0)
    return send({ok:false,error:"REQUEST_DENIED_OR_REPLAY"},409);
   return send({ok:true,state:"PENDING",requestId:item.request_id,
    revision:0,execution:"NO_CAPABILITY_ACTIVE"},201);
  }
  if(action==="review"){
   if(!uuid(data.requestId)||data.revision!==0||
      !["APPROVE","REJECT"].includes(String(data.decision))||
      !reference(data.reference)||!uuid(data.nonce))
    return send({ok:false,error:"INVALID_REVIEW"},400);
   const {data:result,error}=await db.rpc("qf_vox_department_review_v1",{
    p_reviewer:actor,p_request:data.requestId,p_revision:0,
    p_decision:data.decision,p_reference:data.reference,p_event_nonce:data.nonce
   });
   const item=one(result);
   if(error||!item||item.request_id!==data.requestId||
      !["APPROVED","REJECTED"].includes(String(item.request_state))||
      item.request_revision!==1)
    return send({ok:false,error:"REVIEW_DENIED_OR_STALE"},409);
   return send({ok:true,state:item.request_state,revision:1,
    effect:"REVIEW_ONLY"},200);
  }
  if(action==="activate"){
   if(!uuid(data.requestId)||data.revision!==1||
      !reference(data.reference)||!uuid(data.nonce))
    return send({ok:false,error:"INVALID_ACTIVATION"},400);
   const {data:result,error}=await db.rpc("qf_vox_department_activate_v1",{
    p_owner:actor,p_request:data.requestId,p_revision:1,
    p_reference:data.reference,p_event_nonce:data.nonce
   });
   const item=one(result);
   if(error||!item||item.request_id!==data.requestId||
      !uuid(item.capability_id))
    return send({ok:false,error:"ACTIVATION_DENIED_OR_STALE"},409);
   return send({ok:true,capabilityId:item.capability_id,
    effect:"DEPARTMENT_CAPABILITY_ONLY",source:"CORE_ATOMIC_RPC"},200);
  }
  if(!uuid(data.capabilityId)||data.revision!==2||
     !reference(data.reference)||!uuid(data.nonce))
    return send({ok:false,error:"INVALID_REVOCATION"},400);
  const {data:result,error}=await db.rpc("qf_vox_department_revoke_v1",{
   p_owner:actor,p_capability:data.capabilityId,p_revision:2,
   p_reference:data.reference,p_event_nonce:data.nonce
  });
  const item=one(result);
  if(error||!item||item.revoked_capability_id!==data.capabilityId||
     item.new_revision!==3)
   return send({ok:false,error:"REVOCATION_DENIED_OR_STALE"},409);
  return send({ok:true,state:"REVOKED",revision:3,
   effect:"DEPARTMENT_ONLY",source:"CORE_ATOMIC_RPC"},200);
 }catch{return send({ok:false,error:"CORE_UNAVAILABLE"},503);}
}
export function GET(){return send({ok:false,error:"METHOD_NOT_ALLOWED"},405);}
export function PUT(){return send({ok:false,error:"METHOD_NOT_ALLOWED"},405);}
export function PATCH(){return send({ok:false,error:"METHOD_NOT_ALLOWED"},405);}
export function DELETE(){return send({ok:false,error:"METHOD_NOT_ALLOWED"},405);}
