import {verifyVoxOwnerBearer} from "@/services/vox/verifiedStaffBearer";
import {adminClient} from "@/lib/supabase";
export const runtime="nodejs";export const dynamic="force-dynamic";
const respond=(body:unknown,status:number)=>Response.json(body,{status,headers:{
 "cache-control":"private, no-store, max-age=0","vary":"Authorization","x-content-type-options":"nosniff"}});
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{12}$/i;
export async function POST(request:Request){
 if(process.env.VOX_APPROVED_FOLLOWUP_EXECUTION_ENABLED!=="staging")
  return respond({ok:false,error:"FOLLOWUP_EXECUTION_DISABLED"},503);
 if(!request.headers.get("content-type")?.startsWith("application/json"))
  return respond({ok:false,error:"INVALID_CONTENT_TYPE"},415);
 const owner=await verifyVoxOwnerBearer(request.headers.get("authorization"));
 if(!owner)return respond({ok:false,error:"OWNER_AAL2_REQUIRED"},403);
 try{
  const raw=await request.text();if(raw.length>180)return respond({ok:false,error:"TOO_LARGE"},413);
  const v:unknown=JSON.parse(raw);
  if(!v||typeof v!=="object"||Array.isArray(v))return respond({ok:false,error:"BAD_PAYLOAD"},400);
  const x=v as Record<string,unknown>;
  if(Object.keys(x).some(k=>!["intentId","expectedRevision"].includes(k))||
     typeof x.intentId!=="string"||!UUID.test(x.intentId)||x.expectedRevision!==1)
   return respond({ok:false,error:"BAD_EXECUTION_REQUEST"},400);
  const result=await adminClient().rpc("qf_vox_execute_approved_aarohi_followup_v1",{
   p_intent_id:x.intentId,p_owner_id:owner,p_expected_revision:1,
  });
  if(result.error||!Array.isArray(result.data)||result.data.length!==1||
     typeof result.data[0].task_id!=="string"||!UUID.test(result.data[0].task_id)||
     typeof result.data[0].created!=="boolean")
   return respond({ok:false,error:"FOLLOWUP_DENIED_OR_UNAVAILABLE"},409);
  return respond({ok:true,taskId:result.data[0].task_id,created:result.data[0].created,
   authority:"canonical-aarohi-crm",effect:"INTERNAL_FOLLOW_UP_ONLY",
   externalMessagesSent:0,creditsChanged:0},200);
 }catch{return respond({ok:false,error:"FOLLOWUP_UNAVAILABLE"},503);}
}
export async function GET(request:Request){
 if(process.env.VOX_APPROVED_FOLLOWUP_EXECUTION_ENABLED!=="staging")
  return respond({ok:false,error:"FOLLOWUP_EXECUTION_DISABLED"},503);
 const owner=await verifyVoxOwnerBearer(request.headers.get("authorization"));
 if(!owner)return respond({ok:false,error:"OWNER_AAL2_REQUIRED"},403);
 try{
  const url=new URL(request.url);
  if([...url.searchParams.keys()].length)return respond({ok:false,error:"UNKNOWN_QUERY"},400);
  const db=adminClient();
  const pending=await db.from("vox_operational_intents_v1")
   .select("id,target_id,requester_id,city_id,team_id,revision,expires_at")
   .eq("action_kind","AAROHI_FOLLOWUP").eq("state","APPROVED")
   .eq("revision",1).eq("decided_by",owner).neq("requester_id",owner)
   .gt("expires_at",new Date().toISOString()).order("decided_at",{ascending:true}).limit(32);
  if(pending.error||!pending.data)return respond({ok:false,error:"APPROVED_QUEUE_UNAVAILABLE"},503);
  const ids=pending.data.map(v=>v.id);
  const receipts=ids.length?await db.from("vox_approved_followup_executions_v1")
   .select("intent_id").in("intent_id",ids):{data:[],error:null};
  if(receipts.error||!receipts.data)return respond({ok:false,error:"EXECUTION_RECEIPTS_UNAVAILABLE"},503);
  const executed=new Set(receipts.data.map(v=>v.intent_id));
  return respond({ok:true,schema:"qf.vox.followup.approved.queue.v1",mode:"EXECUTION_ELIGIBLE_ONLY",
   pending:pending.data.filter(v=>!executed.has(v.id)).slice(0,16).map(v=>({
    intentId:v.id,prospectId:v.target_id,requesterId:v.requester_id,
    cityId:v.city_id,teamId:v.team_id,revision:1,expiresAt:v.expires_at
   })),effect:"INTERNAL_FOLLOW_UP_ONLY",providerSendsAllowed:false},200);
 }catch{return respond({ok:false,error:"APPROVED_QUEUE_UNAVAILABLE"},503);}
}
export function PATCH(){return respond({ok:false,error:"METHOD_NOT_ALLOWED"},405);}
export function DELETE(){return respond({ok:false,error:"METHOD_NOT_ALLOWED"},405);}
