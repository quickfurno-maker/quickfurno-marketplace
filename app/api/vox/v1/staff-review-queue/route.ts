import {getVerifiedScopedStaff} from "@/services/vox/verifiedScopedStaff";
import {adminClient} from "@/lib/supabase";
export const runtime="nodejs";export const dynamic="force-dynamic";
const send=(payload:unknown,status:number)=>Response.json(payload,{status,headers:{
 "cache-control":"private, no-store, max-age=0","vary":"Authorization","x-content-type-options":"nosniff"}});
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const safeId=(v:unknown)=>typeof v==="string"&&UUID.test(v)?v:null;
export async function GET(request:Request){
 if(process.env.VOX_STAFF_GRANTS_ENABLED!=="staging")
  return send({ok:false,error:"STAFF_REVIEW_DISABLED"},503);
 try{
  const actor=await getVerifiedScopedStaff(request.headers.get("authorization"));
  if(!actor||actor.role!=="team_leader")return send({ok:false,error:"TEAM_LEADER_AAL2_REQUIRED"},403);
  // Only PENDING entries in this exact canonical Core team. A requestor or
  // target cannot review their own request. Never fetch private emails here.
  const result=await adminClient().from("vox_staff_access_requests_v1")
   .select("id,target_profile_id,request_kind,requested_role,scope_kind,scope_object_id,desired_expires_at,created_at,revision,requested_by")
   .eq("team_id",actor.teamId).eq("state","PENDING").eq("revision",0)
   .neq("requested_by",actor.userId).neq("target_profile_id",actor.userId)
   .order("created_at",{ascending:true}).limit(16);
  if(result.error||!result.data)return send({ok:false,error:"REVIEW_QUEUE_UNAVAILABLE"},503);
  const queue=result.data.filter(r=>safeId(r.id)&&safeId(r.target_profile_id))
   .map(r=>({requestId:r.id,targetId:r.target_profile_id,
    kind:r.request_kind==="STAFF_MEMBERSHIP"?"STAFF_MEMBERSHIP":"OBJECT_SCOPE",
    role:typeof r.requested_role==="string"?r.requested_role:null,
    scopeKind:typeof r.scope_kind==="string"?r.scope_kind:null,
    scopeObjectId:safeId(r.scope_object_id),
    expiresAt:typeof r.desired_expires_at==="string"?r.desired_expires_at:null,
    revision:0,state:"PENDING" as const})).slice(0,16);
  return send({ok:true,schema:"qf.vox.staff.review.queue.v1",mode:"READ_ONLY",
    scope:"EXACT_TEAM",pending:queue,canSelfApprove:false,actionsRequireAtomicCoreRpc:true},200);
 }catch{return send({ok:false,error:"REVIEW_QUEUE_UNAVAILABLE"},503);}
}
export function POST(){return send({ok:false,error:"USE_GOVERNED_CORE_REVIEW"},405);}
export function PATCH(){return send({ok:false,error:"USE_GOVERNED_CORE_REVIEW"},405);}
export function DELETE(){return send({ok:false,error:"USE_GOVERNED_CORE_REVIEW"},405);}
