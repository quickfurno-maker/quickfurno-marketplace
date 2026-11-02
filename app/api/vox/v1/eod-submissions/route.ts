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
const STAFF_PREFLIGHT_TIMEOUT_MS=1500;
const submissionUnknown=()=>send({ok:false,error:"EOD_SUBMISSION_OUTCOME_UNKNOWN",
 committed:null,retrySameNonceOnly:true},503);
const enabled=()=>process.env.VOX_STAFF_GRANTS_ENABLED==="staging"&&
 process.env.VOX_DEPARTMENT_ENFORCEMENT_ENABLED==="staging"&&
 process.env.VOX_EOD_SUBMISSIONS_ENABLED==="staging";
const eligible=(s:Awaited<ReturnType<typeof getVerifiedScopedStaff>>)=>{
 return !!s&&s.canReadContent===true&&s.canMutate===false&&
 ["operations_manager","acquisition_agent","vendor_success_agent","support_agent"].includes(s.role);
};
// Compare the fresh effective role, city, team, department packs and every
// object grant after a potentially committed Core submission.
const sameScoped=(a:Awaited<ReturnType<typeof getVerifiedScopedStaff>>,
 b:Awaited<ReturnType<typeof getVerifiedScopedStaff>>):boolean=>{
 if(!a||!b||a.userId!==b.userId||a.teamId!==b.teamId||
    a.cityId!==b.cityId||a.role!==b.role||a.canReadContent!==b.canReadContent||
    a.canMutate!==false||b.canMutate!==false)return false;
 const props=["prospectIds","vendorIds","supportThreadIds","conversationIds",
  "verifiedDepartments"] as const;
 for(const key of props){
  const left=a[key],right=b[key];
  if(!Array.isArray(left)||!Array.isArray(right)||left.length!==right.length||
     left.some(x=>typeof x!=="string")||right.some(x=>typeof x!=="string"))
   return false;
  const x=[...left].sort(),y=[...right].sort();
  if(x.some((v,i)=>v!==y[i]))return false;
 }
 return true;
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
  // The scoped history query can race a Staff grant revocation. Never
  // disclose the selected rows under an authority that is now stale.
  let recheckTimer:ReturnType<typeof setTimeout>|undefined;
  try{
   const fresh=await Promise.race([
    getVerifiedScopedStaff(request.headers.get("authorization"))
     .then(value=>({timedOut:false as const,value})),
    new Promise<{timedOut:true}>(resolve=>{
     recheckTimer=setTimeout(()=>resolve({timedOut:true}),1250);
    })
   ]);
   if(fresh.timedOut||!sameScoped(scope,fresh.value))
    return send({ok:false,error:"EOD_HISTORY_AUTH_CHANGED"},503);
  }catch{return send({ok:false,error:"EOD_HISTORY_AUTH_CHANGED"},503);}
  finally{if(recheckTimer!==undefined)clearTimeout(recheckTimer);}
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
 let attempted=false;
 try{
  const authHeader=request.headers.get("authorization");
  let preflightTimer:ReturnType<typeof setTimeout>|undefined;
  let scope:Awaited<ReturnType<typeof getVerifiedScopedStaff>>;
  try{
   const checked=await Promise.race([
    getVerifiedScopedStaff(authHeader).then(value=>({timedOut:false as const,value})),
    new Promise<{timedOut:true}>(resolve=>{
     preflightTimer=setTimeout(()=>resolve({timedOut:true}),STAFF_PREFLIGHT_TIMEOUT_MS);
    })
   ]);
   if(checked.timedOut)return send({ok:false,error:"EOD_STAFF_PREFLIGHT_TIMEOUT"},503);
   scope=checked.value;
  }finally{if(preflightTimer!==undefined)clearTimeout(preflightTimer);}
  if(!eligible(scope))return send({ok:false,error:"CURRENT_AAL2_STAFF_REQUIRED"},403);
  attempted=true;
  // A timeout or rejected transport is not proof the same-date SQL submission
  // rolled back. Never send a different nonce or claim a clean denial.
  let rpcTimer:ReturnType<typeof setTimeout>|undefined;
  let result:{data:unknown;error:unknown};
  try{
   const response=await Promise.race([
    Promise.resolve(adminClient().rpc("qf_vox_eod_submit_candidate_v1",{
     p_actor:scope!.userId,p_nonce:parsed.nonce,p_business_date:parsed.businessDate
    })).then(value=>({timedOut:false as const,value})),
    new Promise<{timedOut:true}>(resolve=>{
     rpcTimer=setTimeout(()=>resolve({timedOut:true}),4000);
    })
   ]);
   if(response.timedOut)return submissionUnknown();
   result=response.value;
  }finally{if(rpcTimer!==undefined)clearTimeout(rpcTimer);}
  const {data,error}=result;
  if(error||!Array.isArray(data)||data.length!==1)return submissionUnknown();
  const row:unknown=data[0];
  if(!row||typeof row!=="object"||Array.isArray(row))return submissionUnknown();
  const r=row as Record<string,unknown>;
  if(!id(r.report_id)||!["PENDING_REVIEW","ACKNOWLEDGED","REJECTED"].includes(String(r.report_state))||
   !Number.isSafeInteger(r.report_revision)||!Number.isSafeInteger(r.event_count)||
   (r.event_count as number)<0||(r.event_count as number)>100||
   (r.report_state==="PENDING_REVIEW"&&r.report_revision!==0)||
   (r.report_state!=="PENDING_REVIEW"&&r.report_revision!==1))
   return submissionUnknown();
  // The Staff grant may have been revoked since SQL committed. Verify once
  // more, with a hard deadline and no second Core submission RPC.
  let authTimer:ReturnType<typeof setTimeout>|undefined;
  try{
   const latest=await Promise.race([
    getVerifiedScopedStaff(authHeader).then(value=>({timedOut:false as const,value})),
    new Promise<{timedOut:true}>(resolve=>{
     authTimer=setTimeout(()=>resolve({timedOut:true}),1250);
    })
   ]);
   if(latest.timedOut||!sameScoped(scope,latest.value))return submissionUnknown();
  }catch{return submissionUnknown();}
  finally{if(authTimer!==undefined)clearTimeout(authTimer);}
  return send({ok:true,schema:"qf.vox.eod.submission.receipt.v1",
   reportId:r.report_id,nonce:parsed.nonce,businessDate:parsed.businessDate,state:r.report_state,revision:r.report_revision,
   eventCount:r.event_count,completeness:"PARTIAL_UNVERIFIED_TOTAL",
   externalMessagesSent:0,staffPrivilegesChanged:false},200);
 }catch{return attempted?submissionUnknown():send({ok:false,error:"EOD_CORE_UNAVAILABLE"},503);}
}
export function PUT(){return send({ok:false,error:"METHOD_NOT_ALLOWED"},405);}
export function PATCH(){return send({ok:false,error:"METHOD_NOT_ALLOWED"},405);}
export function DELETE(){return send({ok:false,error:"METHOD_NOT_ALLOWED"},405);}
