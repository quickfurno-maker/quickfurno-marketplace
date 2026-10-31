import {adminClient} from "@/lib/supabase";
import {getVerifiedScopedStaff} from "@/services/vox/verifiedScopedStaff";
import {normalizeAgentSubjectAccess,hasHumanCoreConversation,SCHEMA} from "@/contracts/vox/agentSubjectAccess.mjs";
export const runtime="nodejs";export const dynamic="force-dynamic";
const respond=(v:unknown,status:number)=>Response.json(v,{status,headers:{
 "cache-control":"private, no-store, max-age=0","vary":"Authorization","x-content-type-options":"nosniff"}});
export async function POST(request:Request){
 if(process.env.VOX_AGENT_SUBJECT_AUTH_ENABLED!=="staging")
  return respond({ok:false,error:"AGENT_SUBJECT_AUTH_DISABLED"},503);
 if(!request.headers.get("content-type")?.startsWith("application/json"))
  return respond({ok:false,error:"CONTENT_TYPE_DENIED"},415);
 try{
  const raw=await request.text();
  if(raw.length>256)return respond({ok:false,error:"BODY_TOO_LARGE"},413);
  const input:unknown=JSON.parse(raw);
  const scope=await getVerifiedScopedStaff(request.headers.get("authorization"));
  if(!scope)return respond({ok:false,error:"STAFF_AAL2_OR_SCOPE_REQUIRED"},403);
  const query=normalizeAgentSubjectAccess(input,scope);
  if(!query)return respond({ok:false,error:"SUBJECT_SCOPE_DENIED"},403);
  const db=adminClient();
  if(query.agent==="AAROHI"){
   const prospect=await db.from("aarohi_prospects").select("id")
    .eq("id",query.subjectId).eq("city_id",scope.cityId)
    .eq("human_takeover",true).maybeSingle();
   if(prospect.error||!prospect.data)return respond({ok:false,error:"PROSPECT_CITY_OR_HANDOVER_DENIED"},403);
  }else{
   const vendor=await db.from("vendors").select("id,service_zone_id")
    .eq("id",query.subjectId).eq("is_active",true).maybeSingle();
   if(vendor.error||!vendor.data?.service_zone_id)
    return respond({ok:false,error:"INACTIVE_OR_UNASSIGNED_VENDOR"},403);
   const zone=await db.from("marketplace_service_zones").select("id")
    .eq("id",vendor.data.service_zone_id).eq("city_id",scope.cityId)
    .eq("is_active",true).maybeSingle();
   if(zone.error||!zone.data)return respond({ok:false,error:"CROSS_CITY_VENDOR_DENIED"},403);
  }
  const c=await db.from("communication_conversations")
   .select("id,subject_type,subject_id,state,human_takeover,revision")
   .in("id",[...scope.conversationIds])
   .eq("subject_type",query.subjectType).eq("subject_id",query.subjectId)
   .eq("state","HUMAN").eq("human_takeover",true)
   .eq("revision",query.revision).limit(2);
  if(c.error||!hasHumanCoreConversation(c.data??[],query,scope))
   return respond({ok:false,error:"HUMAN_REVISION_OR_CONVERSATION_DENIED"},403);
  return respond({ok:true,schema:SCHEMA,allowed:true,agent:query.agent,
   subjectType:query.subjectType,subjectId:query.subjectId,revision:query.revision,
   staffUserId:scope.userId,aal2Verified:true,objectScopeActive:true,
   cityScopeActive:true,humanTakeoverAllowed:true,permissions:["READ_ONLY"]},200);
 }catch{return respond({ok:false,error:"AUTHORIZATION_UNAVAILABLE"},503);}
}
export function GET(){return respond({ok:false,error:"METHOD_NOT_ALLOWED"},405);}
export function PUT(){return respond({ok:false,error:"METHOD_NOT_ALLOWED"},405);}
export function PATCH(){return respond({ok:false,error:"METHOD_NOT_ALLOWED"},405);}
export function DELETE(){return respond({ok:false,error:"METHOD_NOT_ALLOWED"},405);}
