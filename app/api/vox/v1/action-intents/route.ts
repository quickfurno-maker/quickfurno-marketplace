import {getVerifiedScopedStaff} from "@/services/vox/verifiedScopedStaff";
import {verifyVoxOwnerBearer} from "@/services/vox/verifiedStaffBearer";
import {adminClient} from "@/lib/supabase";
import {normalizeOperationalIntent} from "@/contracts/vox/operationalIntent.mjs";
export const runtime="nodejs";export const dynamic="force-dynamic";
const send=(x:unknown,status:number)=>Response.json(x,{status,headers:{
 "cache-control":"private, no-store, max-age=0","vary":"Authorization","x-content-type-options":"nosniff"}});
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export async function POST(request:Request){
 if(process.env.VOX_OPERATIONAL_INTENTS_ENABLED!=="staging")return send({ok:false,error:"INTENTS_DISABLED"},503);
 if(!request.headers.get("content-type")?.startsWith("application/json"))return send({ok:false,error:"INVALID_TYPE"},415);
 const body=await request.text();
 if(body.length>700)return send({ok:false,error:"PAYLOAD_TOO_LARGE"},413);
 let data:Record<string,unknown>;
 try{const obj:unknown=JSON.parse(body);if(!obj||typeof obj!=="object"||Array.isArray(obj))return send({ok:false,error:"INVALID_INPUT"},400);data=obj as Record<string,unknown>;}
 catch{return send({ok:false,error:"INVALID_INPUT"},400);}
 const action=data.action;
 const db=adminClient();
 try{
 if(action==="propose"){
  const scope=await getVerifiedScopedStaff(request.headers.get("authorization"));
  if(!scope)return send({ok:false,error:"STAFF_AAL2_REQUIRED"},403);
  const intent=normalizeOperationalIntent(data.intent,scope);
  if(!intent)return send({ok:false,error:"INTENT_DENIED"},400);
  // A valid grant by itself never overrules the current canonical city.
  if(intent.target_kind==="prospect"){
   const v=await db.from("aarohi_prospects").select("id").eq("id",intent.target_id)
      .eq("city_id",scope.cityId).maybeSingle();
   if(v.error||!v.data)return send({ok:false,error:"PROSPECT_CITY_DENIED"},403);
  }else{
   const target=intent.target_kind==="vendor"?
     {vendorId:intent.target_id}:null;
   let vendorId=target?.vendorId;
   if(intent.target_kind==="support_thread"){
    const thread=await db.from("vendor_support_threads").select("id,vendor_id")
     .eq("id",intent.target_id).maybeSingle();
    if(thread.error||!thread.data||!scope.vendorIds.includes(thread.data.vendor_id))
      return send({ok:false,error:"THREAD_VENDOR_DENIED"},403);
    vendorId=thread.data.vendor_id;
   }
   if(!vendorId)return send({ok:false,error:"INVALID_TARGET"},403);
   const vendor=await db.from("vendors").select("id,service_zone_id")
     .eq("id",vendorId).maybeSingle();
   if(vendor.error||!vendor.data?.service_zone_id)return send({ok:false,error:"VENDOR_DENIED"},403);
   const zone=await db.from("marketplace_service_zones").select("id")
     .eq("id",vendor.data.service_zone_id).eq("city_id",scope.cityId)
     .eq("is_active",true).maybeSingle();
   if(zone.error||!zone.data)return send({ok:false,error:"ZONE_DENIED"},403);
  }
  const saved=await db.from("vox_operational_intents_v1").insert(intent)
   .select("id,state,revision").single();
  if(saved.error||!saved.data)return send({ok:false,error:"DUPLICATE_OR_UNAVAILABLE"},409);
  return send({ok:true,intentId:saved.data.id,state:"PENDING",execution:"NOT_AUTHORIZED"},202);
 }
 if(action==="review"){
  const reviewer=await verifyVoxOwnerBearer(request.headers.get("authorization"));
  if(!reviewer)return send({ok:false,error:"OWNER_AAL2_REQUIRED"},403);
  if(typeof data.intentId!=="string"||!UUID.test(data.intentId)||
    data.expectedRevision!==0||!["APPROVED","REJECTED"].includes(String(data.decision)))
    return send({ok:false,error:"INVALID_REVIEW"},400);
  const result=await db.rpc("qf_vox_decide_operational_intent_v1",{
    p_intent_id:data.intentId,p_reviewer_id:reviewer,
    p_expected_revision:0,p_decision:data.decision,
  });
  if(result.error||!Array.isArray(result.data)||result.data.length!==1)
    return send({ok:false,error:"REVIEW_DENIED_OR_STALE"},409);
  return send({ok:true,state:result.data[0].new_state,revision:result.data[0].new_revision,
   execution:"NOT_AUTHORIZED"},200);
 }
 return send({ok:false,error:"UNKNOWN_ACTION"},400);
 }catch{return send({ok:false,error:"INTENT_UNAVAILABLE"},503);}
}
export async function GET(request:Request){
 if(process.env.VOX_OPERATIONAL_INTENTS_ENABLED!=="staging")
  return send({ok:false,error:"INTENTS_DISABLED"},503);
 try{
  const owner=await verifyVoxOwnerBearer(request.headers.get("authorization"));
  if(!owner)return send({ok:false,error:"OWNER_AAL2_REQUIRED"},403);
  const u=new URL(request.url);
  if([...u.searchParams.keys()].length!==0)return send({ok:false,error:"UNKNOWN_FILTER"},400);
  const rows=await adminClient().from("vox_operational_intents_v1")
   .select("id,requester_id,action_kind,target_kind,target_id,team_id,city_id,created_at,revision,state")
   .eq("state","PENDING").eq("revision",0).neq("requester_id",owner)
   .order("created_at",{ascending:true}).limit(16);
  if(rows.error||!rows.data)return send({ok:false,error:"INTENT_QUEUE_UNAVAILABLE"},503);
  return send({ok:true,schema:"qf.vox.operational.intents.v1",mode:"REVIEW_ONLY",
   owner:"quickfurno-core",pending:rows.data.slice(0,16).map(r=>({
    id:r.id,requesterId:r.requester_id,actionKind:r.action_kind,
    targetKind:r.target_kind,targetId:r.target_id,
    teamId:r.team_id,cityId:r.city_id,revision:r.revision,state:"PENDING",
    createdAt:r.created_at
   })),canExecute:false},200);
 }catch{return send({ok:false,error:"INTENT_QUEUE_UNAVAILABLE"},503);}
}
export function PATCH(){return send({ok:false,error:"METHOD_NOT_ALLOWED"},405);}
export function DELETE(){return send({ok:false,error:"METHOD_NOT_ALLOWED"},405);}
