import "server-only";
import {adminClient} from "@/lib/supabase";
import {verifyVoxOwnerBearer} from "@/services/vox/verifiedStaffBearer";
export const runtime="nodejs";
export const dynamic="force-dynamic";
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ROLES=new Set(["operations_manager","acquisition_agent","vendor_success_agent","support_agent","auditor"]);
const SCOPES=new Set(["prospect","vendor","support_thread","conversation"]);
const json=(v:unknown,s:number)=>Response.json(v,{status:s,headers:{
 "cache-control":"private, no-store, max-age=0","x-content-type-options":"nosniff","vary":"Authorization"}});
const asUuid=(x:unknown)=>typeof x==="string"&&UUID.test(x)?x:null;
function shape(data:unknown):Record<string,unknown>|null{
 return data!==null&&typeof data==="object"&&!Array.isArray(data)?data as Record<string,unknown>:null;
}
/** Explicit staging-only Core access request, two-person review and grant
 * activation. No browser Supabase service-role credential, never exposes wallet,
 * provider messages, vendor status or independent approvals.
 * Reviewer identity is obtained exclusively from remote Supabase Auth AAL2.
 */
export async function POST(request:Request){
 if(process.env.VOX_STAFF_GRANTS_ENABLED!=="staging")
  return json({ok:false,error:"STAFF_GRANTS_DISABLED"},503);
 if(!request.headers.get("content-type")?.startsWith("application/json"))
  return json({ok:false,error:"INVALID_CONTENT_TYPE"},415);
 try{
  const actor=await verifyVoxOwnerBearer(request.headers.get("authorization"));
  if(!actor)return json({ok:false,error:"UNAUTHORIZED"},401);
  const raw=await request.text();
  if(raw.length>1500)return json({ok:false,error:"PAYLOAD_TOO_LARGE"},413);
  const data=shape(JSON.parse(raw));
  if(!data)return json({ok:false,error:"INVALID_BODY"},400);
  const action=data.action;
  const db=adminClient();
  if(action==="request"){
   const requestNonce=asUuid(data.requestNonce);
   const teamId=asUuid(data.teamId);
   const targetId=asUuid(data.targetProfileId);
   const expiresAt=typeof data.expiresAt==="string"?data.expiresAt:"";
   const expiration=Date.parse(expiresAt);
   const reason=typeof data.reason==="string"?data.reason.trim():"";
   const kind=data.kind;
   const role=typeof data.role==="string"?data.role:"";
   const objectKind=typeof data.scopeKind==="string"?data.scopeKind:"";
   const objectId=asUuid(data.objectId);
   if(!requestNonce||!teamId||!targetId||targetId===actor||
      !Number.isFinite(expiration)||expiration<=Date.now()+60_000||
      expiration>Date.now()+30*86_400_000||reason.length<12||reason.length>500)
    return json({ok:false,error:"INVALID_REQUEST"},400);
   const membership=kind==="STAFF_MEMBERSHIP" && ROLES.has(role) && !objectId && !objectKind;
   const object=kind==="OBJECT_SCOPE" && SCOPES.has(objectKind) && Boolean(objectId) && !role;
   if(!membership&&!object)return json({ok:false,error:"INVALID_REQUEST"},400);
   const [team,target]=await Promise.all([
    db.from("vox_staff_teams_v1").select("id,city_id,is_active").eq("id",teamId).maybeSingle(),
    db.from("profiles").select("id,role,is_active").eq("id",targetId).maybeSingle()
   ]);
   if(team.error||target.error)return json({ok:false,error:"AUTHORITY_UNAVAILABLE"},503);
   if(!team.data?.is_active||target.data?.role!=="admin"||target.data?.is_active!==true)
    return json({ok:false,error:"INVALID_TARGET_OR_TEAM"},403);
   const result=await db.from("vox_staff_access_requests_v1")
    .insert({request_nonce:requestNonce,requested_by:actor,target_profile_id:targetId,
      team_id:teamId,request_kind:kind,requested_role:membership?role:null,
      scope_kind:object?objectKind:null,scope_object_id:object?objectId:null,
      desired_expires_at:new Date(expiration).toISOString(),reason})
    .select("id,state,revision").single();
   if(result.error||!result.data)return json({ok:false,error:"REQUEST_UNAVAILABLE_OR_DUPLICATE"},409);
   return json({ok:true,requestId:result.data.id,state:"PENDING",revision:0},201);
  }
  const requestId=asUuid(data.requestId);
  const expectedRevision=data.expectedRevision;
  const reference=typeof data.reference==="string"?data.reference.trim():"";
  if(!requestId||reference.length<8||reference.length>128)
   return json({ok:false,error:"INVALID_REQUEST"},400);
  if(action==="review"){
   if(expectedRevision!==0||!["APPROVE","REJECT"].includes(String(data.decision)))
    return json({ok:false,error:"INVALID_REVIEW"},400);
   const {data:result,error}=await db.rpc("qf_vox_review_staff_access_v1",{
    p_request_id:requestId,p_reviewer_profile_id:actor,p_expected_revision:0,
    p_decision:data.decision,p_approval_reference:reference});
   if(error||!Array.isArray(result)||result.length!==1)
    return json({ok:false,error:"REVIEW_REJECTED_OR_STALE"},409);
   return json({ok:true,state:result[0].decision,revision:result[0].new_revision},200);
  }
  if(action==="activate"){
   if(expectedRevision!==1)return json({ok:false,error:"INVALID_REVISION"},400);
   const {data:result,error}=await db.rpc("qf_vox_activate_reviewed_access_v1",{
    p_request_id:requestId,p_authenticated_reviewer_id:actor,
    p_expected_review_revision:1,p_activation_reference:reference});
   if(error||!Array.isArray(result)||result.length!==1)
    return json({ok:false,error:"ACTIVATION_REJECTED_OR_STALE"},409);
   return json({ok:true,appliedKind:result[0].applied_kind,authorizedByCore:true},200);
  }
  return json({ok:false,error:"UNKNOWN_ACTION"},400);
 }catch{return json({ok:false,error:"UNAVAILABLE"},503);}
}
export function GET(){return json({ok:false,error:"METHOD_NOT_ALLOWED"},405);}
export function PUT(){return json({ok:false,error:"METHOD_NOT_ALLOWED"},405);}
export function PATCH(){return json({ok:false,error:"METHOD_NOT_ALLOWED"},405);}
export function DELETE(){return json({ok:false,error:"METHOD_NOT_ALLOWED"},405);}
