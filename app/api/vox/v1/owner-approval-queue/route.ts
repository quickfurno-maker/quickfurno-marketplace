import "server-only";
import {adminClient} from "@/lib/supabase";
import {verifyVoxOwnerBearer} from "@/services/vox/verifiedStaffBearer";

export const runtime="nodejs";
export const dynamic="force-dynamic";
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const reply=(data:unknown,status:number)=>Response.json(data,{status,headers:{
 "cache-control":"private, no-store, max-age=0",
 "vary":"Authorization","x-content-type-options":"nosniff"
}});
const validId=(x:unknown):x is string=>typeof x==="string"&&UUID.test(x);
const actionTarget:Record<string,string>={AAROHI_FOLLOWUP:"prospect",VENDOR_PROFILE_CHANGE:"vendor",SUPPORT_REPLY:"support_thread"};

export async function GET(request:Request){
 if(process.env.VOX_STAFF_READ_ENABLED!=="staging"||
    process.env.VOX_STAFF_GRANTS_ENABLED!=="staging"||
    process.env.VOX_OWNER_APPROVALS_READ_ENABLED!=="staging")
  return reply({ok:false,error:"OWNER_APPROVALS_DISABLED"},503);
 const u=new URL(request.url);
 if(u.search||u.hash)return reply({ok:false,error:"UNSUPPORTED_FILTER"},400);
 try {
  const owner=await verifyVoxOwnerBearer(request.headers.get("authorization"));
  if(!owner)return reply({ok:false,error:"OWNER_AAL2_REQUIRED"},403);
  const result=await adminClient().from("vox_operational_intents_v1")
   .select("id,requester_id,action_kind,target_kind,target_id,team_id,city_id,created_at,revision,state")
   .eq("state","PENDING").eq("revision",0)
   .neq("requester_id",owner)
   .order("created_at",{ascending:true}).limit(16);
  if(result.error||!Array.isArray(result.data))return reply({ok:false,error:"QUEUE_UNAVAILABLE"},503);
  const pending=[];
  for(const r of result.data){
   if(!validId(r.id)||!validId(r.requester_id)||!validId(r.target_id)||
      !validId(r.team_id)||!validId(r.city_id)||
      typeof r.action_kind!=="string"||actionTarget[r.action_kind]!==r.target_kind||
      r.revision!==0||r.state!=="PENDING"||
      typeof r.created_at!=="string"||!Number.isFinite(Date.parse(r.created_at)))
    return reply({ok:false,error:"QUEUE_RECORD_UNTRUSTED"},503);
   pending.push({requestId:r.id,requesterRef:"STAFF-"+r.requester_id.slice(0,8),
    actionKind:r.action_kind,targetKind:r.target_kind,
    targetRef:r.target_id,teamRef:"TEAM-"+r.team_id.slice(0,8),
    cityRef:"CITY-"+r.city_id.slice(0,8),
    submittedAt:r.created_at,revision:0,state:"PENDING"});
  }
  const freshOwner=await verifyVoxOwnerBearer(request.headers.get("authorization"));
  if(!freshOwner||freshOwner!==owner)return reply({ok:false,error:"OWNER_SESSION_REVOKED"},403);
  return reply({ok:true,schema:"qf.vox.owner.approvals.queue.v1",
   mode:"READ_ONLY",source:"quickfurno-core",pending,canApprove:false,
   canExecute:false,requiresSeparateCoreReview:true},200);
 }catch{return reply({ok:false,error:"QUEUE_UNAVAILABLE"},503);}
}
export function POST(){return reply({ok:false,error:"REVIEW_NOT_ENABLED"},405);}
export function PUT(){return reply({ok:false,error:"REVIEW_NOT_ENABLED"},405);}
export function PATCH(){return reply({ok:false,error:"REVIEW_NOT_ENABLED"},405);}
export function DELETE(){return reply({ok:false,error:"REVIEW_NOT_ENABLED"},405);}
