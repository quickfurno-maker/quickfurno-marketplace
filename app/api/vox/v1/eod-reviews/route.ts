import "server-only";
import {adminClient} from "@/lib/supabase";
import {getVerifiedScopedStaff} from "@/services/vox/verifiedScopedStaff";
export const runtime="nodejs";
export const dynamic="force-dynamic";
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const id=(v:unknown):v is string=>typeof v==="string"&&UUID.test(v);
const send=(v:unknown,status:number)=>Response.json(v,{status,headers:{
 "cache-control":"private, no-store, max-age=0","vary":"Authorization",
 "x-content-type-options":"nosniff"
}});
const enabled=()=>process.env.VOX_STAFF_GRANTS_ENABLED==="staging"&&
 process.env.VOX_DEPARTMENT_ENFORCEMENT_ENABLED==="staging"&&
 process.env.VOX_EOD_SUBMISSIONS_ENABLED==="staging"&&
 process.env.VOX_EOD_TL_REVIEW_ENABLED==="staging";
export async function GET(request:Request){
 if(!enabled())return send({ok:false,error:"EOD_REVIEW_DISABLED"},503);
 if(new URL(request.url).search)return send({ok:false,error:"FILTER_NOT_ALLOWED"},400);
 try{
  const scope=await getVerifiedScopedStaff(request.headers.get("authorization"));
  if(!scope||scope.role!=="team_leader"||scope.canMutate!==false)
   return send({ok:false,error:"CURRENT_INDEPENDENT_TL_AAL2_REQUIRED"},403);
  const q=await adminClient().from("vox_staff_eod_reports_candidate_v1")
   .select("id,staff_id,team_id,city_id,business_date,event_count,state,revision,completeness")
   .eq("team_id",scope.teamId).eq("city_id",scope.cityId)
   .neq("staff_id",scope.userId)
   .eq("state","PENDING_REVIEW").eq("revision",0)
   .order("created_at",{ascending:true}).limit(17);
  if(q.error||!q.data||q.data.length>16)
   return send({ok:false,error:"EOD_TL_QUEUE_UNAVAILABLE"},503);
  const pending=[];
  for(const r of q.data){
   if(!id(r.id)||!id(r.staff_id)||r.team_id!==scope.teamId||
      r.city_id!==scope.cityId||r.staff_id===scope.userId||
      typeof r.business_date!=="string"||r.event_count<0||
      !Number.isSafeInteger(r.event_count)||r.event_count>100||
      r.state!=="PENDING_REVIEW"||r.revision!==0||
      r.completeness!=="PARTIAL_UNVERIFIED_TOTAL")
    return send({ok:false,error:"EOD_TL_QUEUE_PROOF_FAILED"},503);
   pending.push({reportId:r.id,staffRef:"STAFF-"+r.staff_id.slice(0,8),
    businessDate:r.business_date,eventCount:r.event_count,revision:0,
    completeness:"PARTIAL_UNVERIFIED_TOTAL"});
  }
  return send({ok:true,schema:"qf.vox.eod.tl.queue.v1",mode:"READ_ONLY",
   actionsRequireCurrentCoreRpc:true,totalKnown:false,pending},200);
 }catch{return send({ok:false,error:"EOD_TL_QUEUE_UNAVAILABLE"},503);}
}
export async function POST(request:Request){
 if(!enabled())return send({ok:false,error:"EOD_REVIEW_DISABLED"},503);
 if(!request.headers.get("content-type")?.startsWith("application/json"))
  return send({ok:false,error:"JSON_REQUIRED"},415);
 let body:Record<string,unknown>;
 try{
  const raw=await request.text();
  if(!raw||raw.length>210)return send({ok:false,error:"INVALID_SIZE"},413);
  const data:unknown=JSON.parse(raw);
  if(!data||typeof data!=="object"||Array.isArray(data))
   return send({ok:false,error:"INVALID_BODY"},400);
  body=data as Record<string,unknown>;
 }catch{return send({ok:false,error:"INVALID_JSON"},400);}
 if(Object.keys(body).sort().join("|")!=="decision|expectedRevision|nonce|reportId"||
    !id(body.reportId)||!id(body.nonce)||body.expectedRevision!==0||
    !["ACKNOWLEDGED","REJECTED"].includes(String(body.decision)))
  return send({ok:false,error:"INVALID_REVIEW_COMMAND"},400);
 try{
  const scope=await getVerifiedScopedStaff(request.headers.get("authorization"));
  if(!scope||scope.role!=="team_leader"||scope.canMutate!==false)
   return send({ok:false,error:"CURRENT_INDEPENDENT_TL_AAL2_REQUIRED"},403);
  // p_actor comes only from independently verified Supabase Auth/Core; SQL
  // locks report and checks TL identity, city, team, expiry and non-self-review.
  const {data,error}=await adminClient().rpc("qf_vox_eod_review_candidate_v1",{
   p_actor:scope.userId,p_report:body.reportId,
   p_expected_revision:0,p_nonce:body.nonce,p_decision:body.decision
  });
  if(error||!Array.isArray(data)||data.length!==1)
   return send({ok:false,error:"REVIEW_DENIED_STALE_OR_SELF"},409);
  const row:unknown=data[0];
  if(!row||typeof row!=="object"||Array.isArray(row))
   return send({ok:false,error:"INVALID_REVIEW_RECEIPT"},503);
  const r=row as Record<string,unknown>;
  if(r.report_id!==body.reportId||r.report_state!==body.decision||r.report_revision!==1)
   return send({ok:false,error:"INVALID_REVIEW_RECEIPT"},503);
  return send({ok:true,schema:"qf.vox.eod.tl.receipt.v1",reportId:r.report_id,
   state:r.report_state,revision:1,source:"PARTIAL_CORE_WORK_ONLY",
   providerMessagesSent:0,staffPrivilegesChanged:false},200);
 }catch{return send({ok:false,error:"EOD_REVIEW_UNAVAILABLE"},503);}
}
export function PUT(){return send({ok:false,error:"METHOD_NOT_ALLOWED"},405);}
export function PATCH(){return send({ok:false,error:"METHOD_NOT_ALLOWED"},405);}
export function DELETE(){return send({ok:false,error:"METHOD_NOT_ALLOWED"},405);}
