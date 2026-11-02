import "server-only";
import {adminClient} from "@/lib/supabase";
import {verifyVoxOwnerBearer} from "@/services/vox/verifiedStaffBearer";
import {getVerifiedScopedStaff} from "@/services/vox/verifiedScopedStaff";
import {
 validateAb4StaffReviewRequest,validateAb4StaffReviewDecision
} from "@/contracts/vox/ab4StaffRequestGateway.mjs";
export const runtime="nodejs";
export const dynamic="force-dynamic";
const enabled=()=>process.env.VOX_AB4_STAFF_REVIEW_ENABLED==="staging"&&
 process.env.VOX_STAFF_GRANTS_ENABLED==="staging"&&
 process.env.VOX_DEPARTMENT_ENFORCEMENT_ENABLED==="staging";
const send=(v:unknown,status:number)=>Response.json(v,{status,headers:{
 "cache-control":"private, no-store, max-age=0",
 "vary":"Authorization","x-content-type-options":"nosniff"
}});
const fail=(error:string,status:number)=>send({ok:false,error,
 accountCreated:false,inviteSent:false,grantsActivated:false},status);
const keys=(obj:Record<string,unknown>,names:string[])=>Object.keys(obj).sort().join("|")===names.sort().join("|");
/**
 * Genuine Core DB candidate-backed action only, not an Auth provisioning API.
 * Never accepts email, password, owner identity or TL identity from browser.
 * Database tables are candidate-only; absent schema MUST fail CLOSED.
 */
export async function POST(request:Request):Promise<Response>{
 if(!enabled())return fail("AB4_STAFF_REVIEW_DISABLED",503);
 if(!request.headers.get("content-type")?.toLowerCase().startsWith("application/json"))
  return fail("JSON_REQUIRED",415);
 const u=new URL(request.url);
 if(u.search||u.hash)return fail("CLIENT_FILTERS_DENIED",400);
 let body:Record<string,unknown>;
 try{
  const raw=await request.text();
  if(!raw||raw.length>1400)return fail("BODY_SIZE_INVALID",413);
  const v:unknown=JSON.parse(raw);
  if(!v||typeof v!=="object"||Array.isArray(v))
   return fail("BODY_OBJECT_REQUIRED",400);
  body=v as Record<string,unknown>;
 }catch{return fail("BODY_INVALID",400);}
 try{
  if(body.action==="REQUEST"){
   const owner=await verifyVoxOwnerBearer(request.headers.get("authorization"));
   if(!owner)return fail("CURRENT_OWNER_SUPERADMIN_AAL2_REQUIRED",403);
   const proof=validateAb4StaffReviewRequest(body,{ownerId:owner,now:Date.now()});
   if(!proof.ok||!proof.insert)return fail(proof.reason??"REQUEST_DENIED",400);
   // Recheck canonical team/city and active independently approved TL
   // inside SQL trigger; no browser-Supabase service role.
   const db=adminClient();
   const result=await db.from("vox_ab3_staff_invitation_requests_candidate_v1")
    .insert(proof.insert)
    .select("id,state,owner_id,reviewer_id,nonce").single();
   if(result.error||!result.data||
    result.data.owner_id!==owner||result.data.id!==body.requestId||
    result.data.reviewer_id!==body.reviewerId||
    result.data.nonce!==body.nonce||
    result.data.state!=="PENDING_INDEPENDENT_REVIEW")
    return fail("PENDING_REVIEW_DB_UNAVAILABLE_OR_DUPLICATE",409);
   return send({ok:true,schema:"qf.vox.ab4.staff-review.request-receipt.v1",
    requestId:result.data.id,state:"PENDING_INDEPENDENT_REVIEW",
    accountCreated:false,inviteSent:false,grantsActivated:false,
    reviewDecisionAvailable:false,providerMessagesSent:0},201);
  }
  if(body.action==="REVIEW"){
   const leader=await getVerifiedScopedStaff(request.headers.get("authorization"));
   if(!leader||leader.role!=="team_leader"||leader.canMutate!==false)
    return fail("CURRENT_INDEPENDENT_TL_AAL2_REQUIRED",403);
   const proof=validateAb4StaffReviewDecision(body,{reviewerId:leader.userId});
   if(!proof.ok||!proof.insert)return fail(proof.reason??"DECISION_DENIED",400);
   const db=adminClient();
   const result=await db.from("vox_ab3_staff_invitation_decisions_candidate_v1")
    .insert(proof.insert).select("request_id,reviewer_id,decision").single();
   if(result.error||!result.data||result.data.request_id!==body.requestId||
    result.data.reviewer_id!==leader.userId||
    result.data.decision!==body.decision)
    return fail("INDEPENDENT_REVIEW_REVOKED_OR_DUPLICATE",409);
   return send({ok:true,schema:"qf.vox.ab4.staff-review.decision-receipt.v1",
    requestId:result.data.request_id,decision:result.data.decision,
    state:"REVIEWED_ONLY",accountCreated:false,inviteSent:false,
    grantsActivated:false,providerMessagesSent:0},200);
  }
  return fail("UNKNOWN_ACTION",400);
 }catch{return fail("STAFF_REVIEW_CORE_UNAVAILABLE",503);}
}
export const GET=()=>fail("METHOD_NOT_ALLOWED",405);
export const PUT=()=>fail("METHOD_NOT_ALLOWED",405);
export const PATCH=()=>fail("METHOD_NOT_ALLOWED",405);
export const DELETE=()=>fail("METHOD_NOT_ALLOWED",405);
