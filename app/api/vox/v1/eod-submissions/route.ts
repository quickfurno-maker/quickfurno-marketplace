import "server-only";
import {adminClient} from "@/lib/supabase";
import {getVerifiedScopedStaff} from "@/services/vox/verifiedScopedStaff";
export const runtime="nodejs";
export const dynamic="force-dynamic";
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const id=(v:unknown):v is string=>typeof v==="string"&&UUID.test(v);
const send=(body:unknown,status:number)=>Response.json(body,{status,headers:{
 "cache-control":"private, no-store, max-age=0","vary":"Authorization",
 "x-content-type-options":"nosniff"
}});
const enabled=()=>process.env.VOX_STAFF_GRANTS_ENABLED==="staging"&&
 process.env.VOX_DEPARTMENT_ENFORCEMENT_ENABLED==="staging"&&
 process.env.VOX_EOD_SUBMISSIONS_ENABLED==="staging";
const eligible=(s:Awaited<ReturnType<typeof getVerifiedScopedStaff>>)=>{
 return !!s&&s.canReadContent===true&&s.canMutate===false&&
 ["operations_manager","acquisition_agent","vendor_success_agent","support_agent"].includes(s.role);
};
const IST=()=>new Intl.DateTimeFormat("sv-SE",{timeZone:"Asia/Kolkata",
 year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
/** Only current employee sees own proposals; never expose raw events or PII.
 * The preview is PARTIAL, not a complete daily performance report. */
export async function GET(request:Request){
 if(!enabled())return send({ok:false,error:"EOD_SUBMISSIONS_DISABLED"},503);
 if(new URL(request.url).search)return send({ok:false,error:"FILTER_NOT_SUPPORTED"},400);
 try{
  const scope=await getVerifiedScopedStaff(request.headers.get("authorization"));
  if(!eligible(scope))return send({ok:false,error:"CURRENT_AAL2_STAFF_REQUIRED"},403);
  const result=await adminClient().from("vox_staff_eod_reports_candidate_v1")
   .select("id,business_date,source,completeness,event_count,state,revision,created_at")
   .eq("staff_id",scope!.userId).eq("team_id",scope!.teamId).eq("city_id",scope!.cityId)
   .order("created_at",{ascending:false}).limit(17);
  if(result.error||!result.data||result.data.length>16)
   return send({ok:false,error:"EOD_HISTORY_UNAVAILABLE"},503);
  const states=new Set(["PENDING_REVIEW","ACKNOWLEDGED","REJECTED"]);
  const records=[];
  for(const e of result.data){
   if(!id(e.id)||typeof e.business_date!=="string"||
     !/^\d{4}-\d{2}-\d{2}$/.test(e.business_date)||
     e.source!=="CORE_WORK_LEDGER_ONLY"||
     e.completeness!=="PARTIAL_UNVERIFIED_TOTAL"||
     !Number.isSafeInteger(e.event_count)||e.event_count<0||e.event_count>100||
     !states.has(e.state)||![0,1].includes(e.revision)||
     (e.state==="PENDING_REVIEW"&&e.revision!==0)||
     (e.state!=="PENDING_REVIEW"&&e.revision!==1)||
     typeof e.created_at!=="string"||!Number.isFinite(Date.parse(e.created_at)))
    return send({ok:false,error:"EOD_HISTORY_PROOF_INVALID"},503);
   records.push({reportId:e.id,businessDate:e.business_date,
     eventCount:e.event_count,state:e.state,revision:e.revision});
  }
  return send({ok:true,schema:"qf.vox.eod.my-submissions.v1",mode:"READ_ONLY",
   completeness:"PARTIAL_UNVERIFIED_TOTAL",totalKnown:false,records},200);
 }catch{return send({ok:false,error:"EOD_HISTORY_UNAVAILABLE"},503);}
}
/** Snapshot is calculated in SQL exclusively from live Core work event history
 * and current authoritative membership/object/department verification.
 * No client-supplied counts or external messaging.
 */
export async function POST(request:Request){
 if(!enabled())return send({ok:false,error:"EOD_SUBMISSIONS_DISABLED"},503);
 if(!request.headers.get("content-type")?.startsWith("application/json"))
  return send({ok:false,error:"JSON_REQUIRED"},415);
 let parsed:Record<string,unknown>;
 try{
  const raw=await request.text();
  if(!raw||raw.length>180)return send({ok:false,error:"PAYLOAD_SIZE_INVALID"},413);
  const x:unknown=JSON.parse(raw);
  if(!x||typeof x!=="object"||Array.isArray(x))
   return send({ok:false,error:"INVALID_JSON_OBJECT"},400);
  parsed=x as Record<string,unknown>;
 }catch{return send({ok:false,error:"INVALID_JSON"},400);}
 if(Object.keys(parsed).sort().join("|")!=="businessDate|nonce"||
    !id(parsed.nonce)||typeof parsed.businessDate!=="string"||
    parsed.businessDate!==IST())
  return send({ok:false,error:"CURRENT_IST_NONCE_REQUIRED"},400);
 try{
  const scope=await getVerifiedScopedStaff(request.headers.get("authorization"));
  if(!eligible(scope))return send({ok:false,error:"CURRENT_AAL2_STAFF_REQUIRED"},403);
  const {data,error}=await adminClient().rpc("qf_vox_eod_submit_candidate_v1",{
   p_actor:scope!.userId,p_nonce:parsed.nonce,p_business_date:parsed.businessDate
  });
  if(error||!Array.isArray(data)||data.length!==1)
   return send({ok:false,error:"EOD_CORE_DENIED_OR_STALE"},409);
  const row:unknown=data[0];
  if(!row||typeof row!=="object"||Array.isArray(row))
   return send({ok:false,error:"EOD_RECEIPT_INVALID"},503);
  const r=row as Record<string,unknown>;
  if(!id(r.report_id)||!["PENDING_REVIEW","ACKNOWLEDGED","REJECTED"].includes(String(r.report_state))||
   !Number.isSafeInteger(r.report_revision)||!Number.isSafeInteger(r.event_count)||
   (r.event_count as number)<0||(r.event_count as number)>100||
   (r.report_state==="PENDING_REVIEW"&&r.report_revision!==0)||
   (r.report_state!=="PENDING_REVIEW"&&r.report_revision!==1))
   return send({ok:false,error:"EOD_RECEIPT_INVALID"},503);
  return send({ok:true,schema:"qf.vox.eod.submission.receipt.v1",
   reportId:r.report_id,state:r.report_state,revision:r.report_revision,
   eventCount:r.event_count,completeness:"PARTIAL_UNVERIFIED_TOTAL",
   externalMessagesSent:0,staffPrivilegesChanged:false},200);
 }catch{return send({ok:false,error:"EOD_CORE_UNAVAILABLE"},503);}
}
export function PUT(){return send({ok:false,error:"METHOD_NOT_ALLOWED"},405);}
export function PATCH(){return send({ok:false,error:"METHOD_NOT_ALLOWED"},405);}
export function DELETE(){return send({ok:false,error:"METHOD_NOT_ALLOWED"},405);}
