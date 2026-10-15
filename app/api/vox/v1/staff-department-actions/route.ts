import "server-only";
import {adminClient} from "@/lib/supabase";
import {verifyVoxOwnerBearer} from "@/services/vox/verifiedStaffBearer";
import {getVerifiedScopedStaff} from "@/services/vox/verifiedScopedStaff";
export const runtime="nodejs";
export const dynamic="force-dynamic";

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PACKS=new Set(["client_success","vendor_success","acquisition","service_support"]);
const ALLOWED:Record<string,readonly string[]>={
 request:["action","nonce","targetStaffId","teamId","pack","expiresAt","reason"],
 review:["action","requestId","expectedRevision","decision","reference","eventNonce"],
 activate:["action","requestId","expectedRevision","reference","eventNonce"],
 revoke:["action","capabilityId","expectedRevision","reference","eventNonce"]
};
const send=(value:unknown,status:number)=>Response.json(value,{status,headers:{
 "cache-control":"private, no-store, max-age=0",
 "x-content-type-options":"nosniff","vary":"Authorization"
}});
const id=(v:unknown):v is string=>typeof v==="string"&&UUID.test(v);
const str=(v:unknown,min:number,max:number):v is string=>
 typeof v==="string"&&v.length>=min&&v.length<=max&&v===v.trim();
/**
 * Core-only, feature-gated HTTP boundary for independently reviewed staff
 * departments. NO client/WhatsApp message, Auth invitation or object grants.
 * SQL proposals live under ops/vox/sql-candidates and are NOT deployable.
 */
export async function POST(request:Request){
 if(process.env.VOX_STAFF_GRANTS_ENABLED!=="staging"||
    process.env.VOX_DEPARTMENT_ACTIONS_ENABLED!=="staging")
  return send({ok:false,error:"DEPARTMENT_ACTIONS_DISABLED"},503);
 if(!request.headers.get("content-type")?.startsWith("application/json"))
  return send({ok:false,error:"INVALID_CONTENT_TYPE"},415);
 try{
  const raw=await request.text();
  if(raw.length>1300)return send({ok:false,error:"PAYLOAD_TOO_LARGE"},413);
  const parsed:unknown=JSON.parse(raw);
  if(!parsed||typeof parsed!=="object"||Array.isArray(parsed))
   return send({ok:false,error:"INVALID_BODY"},400);
  const data=parsed as Record<string,unknown>;
  const action=data.action;
  if(typeof action!=="string"||!Object.prototype.hasOwnProperty.call(ALLOWED,action))
   return send({ok:false,error:"UNKNOWN_ACTION"},400);
  const keys=Object.keys(data).sort();
  if(keys.join("|")!==[...ALLOWED[action]].sort().join("|"))
   return send({ok:false,error:"UNKNOWN_OR_MISSING_FIELDS"},400);
  const leader=action==="review"?
    await getVerifiedScopedStaff(request.headers.get("authorization")):null;
  const actor=action==="review"
   ?(leader?.role==="team_leader"?leader.userId:null)
   :await verifyVoxOwnerBearer(request.headers.get("authorization"));
  if(!actor)return send({ok:false,error:"VERIFIED_AAL2_AUTHORITY_REQUIRED"},403);
  const db=adminClient();

  if(action==="request"){
   const expiry=typeof data.expiresAt==="string"?Date.parse(data.expiresAt):NaN;
   if(!id(data.targetStaffId)||data.targetStaffId===actor||!id(data.teamId)||
      !id(data.nonce)||!PACKS.has(String(data.pack))||
      !Number.isFinite(expiry)||expiry<=Date.now()+300000||
      expiry>Date.now()+30*86400000||
      !str(data.reason,12,500))
    return send({ok:false,error:"INVALID_CAPABILITY_REQUEST"},400);
   const result=await db.rpc("qf_vox_request_department_v1",{
    p_authenticated_owner_id:actor,p_target_staff_id:data.targetStaffId,
    p_team_id:data.teamId,p_department:data.pack,
    p_expires_at:new Date(expiry).toISOString(),p_reason:data.reason,p_nonce:data.nonce
   });
   if(result.error||!id(result.data))
    return send({ok:false,error:"REQUEST_DENIED_OR_DUPLICATE"},409);
   return send({ok:true,requestId:result.data,state:"PENDING",revision:0,
     grantsActivated:0,providerMessagesSent:0},201);
  }
  if(action==="review"){
   if(!id(data.requestId)||!id(data.eventNonce)||data.expectedRevision!==0||
      !["APPROVE","REJECT"].includes(String(data.decision))||
      !str(data.reference,8,128))
    return send({ok:false,error:"INVALID_INDEPENDENT_REVIEW"},400);
   const result=await db.rpc("qf_vox_review_department_v1",{
    p_request_id:data.requestId,p_authenticated_reviewer_id:actor,
    p_expected_revision:0,p_decision:data.decision,
    p_reference:data.reference,p_event_nonce:data.eventNonce
   });
   if(result.error||result.data!==data.requestId)
    return send({ok:false,error:"REVIEW_DENIED_OR_STALE"},409);
   return send({ok:true,requestId:result.data,reviewRecorded:true,
    grantsActivated:0,providerMessagesSent:0},200);
  }
  if(action==="activate"){
   if(!id(data.requestId)||!id(data.eventNonce)||data.expectedRevision!==1||
      !str(data.reference,8,128))
    return send({ok:false,error:"INVALID_ACTIVATION"},400);
   const result=await db.rpc("qf_vox_activate_department_v1",{
    p_request_id:data.requestId,p_authenticated_owner_id:actor,
    p_expected_revision:1,p_activation_reference:data.reference,
    p_event_nonce:data.eventNonce
   });
   if(result.error||!id(result.data))
    return send({ok:false,error:"ACTIVATION_DENIED_OR_STALE"},409);
   return send({ok:true,capabilityId:result.data,approval:"INDEPENDENTLY_REVIEWED",
    objectGrantsAdded:0,providerMessagesSent:0},200);
  }
  if(action==="revoke"){
   if(!id(data.capabilityId)||!id(data.eventNonce)||data.expectedRevision!==2||
      !str(data.reference,12,128))
    return send({ok:false,error:"INVALID_REVOCATION"},400);
   const result=await db.rpc("qf_vox_revoke_department_v1",{
    p_capability_id:data.capabilityId,p_authenticated_owner_id:actor,
    p_expected_revision:2,p_incident_reference:data.reference,
    p_event_nonce:data.eventNonce
   });
   if(result.error||result.data!==data.capabilityId)
    return send({ok:false,error:"REVOCATION_DENIED_OR_STALE"},409);
   return send({ok:true,capabilityId:result.data,state:"REVOKED",
     providerMessagesSent:0},200);
  }
  return send({ok:false,error:"UNKNOWN_ACTION"},400);
 }catch{return send({ok:false,error:"CORE_DEPARTMENT_UNAVAILABLE"},503);}
}
export function GET(){return send({ok:false,error:"METHOD_NOT_ALLOWED"},405);}
export function PUT(){return send({ok:false,error:"METHOD_NOT_ALLOWED"},405);}
export function PATCH(){return send({ok:false,error:"METHOD_NOT_ALLOWED"},405);}
export function DELETE(){return send({ok:false,error:"METHOD_NOT_ALLOWED"},405);}
