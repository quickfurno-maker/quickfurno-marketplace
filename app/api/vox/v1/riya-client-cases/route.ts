import { adminClient } from "@/lib/supabase";
import { getVerifiedScopedStaff } from "@/services/vox/verifiedScopedStaff";
import { projectScopedClientCaseList } from "@/contracts/vox/verifiedClientCasePreview.mjs";
export const runtime="nodejs";
export const dynamic="force-dynamic";
const send=(data:unknown,status:number)=>Response.json(data,{status,headers:{
 "cache-control":"private, no-store, max-age=0","vary":"Authorization",
 "x-content-type-options":"nosniff"
}});
const empty={data:[],error:null};
/** VOX-L2: real Core-backed read-only Riya case metadata.
 * NO transcript, no send or takeover. Client conversations are intentionally
 * masked in general staff scope. Here a separate exact current object grant,
 * independent client_success TL department approval, canonical verified lead,
 * and active matching city service zone are all REQUIRED.
 */
export async function GET(request:Request):Promise<Response>{
 if(process.env.VOX_STAFF_GRANTS_ENABLED!=="staging"||
  process.env.VOX_DEPARTMENT_ENFORCEMENT_ENABLED!=="staging"||
  process.env.VOX_RIYA_CLIENT_CASE_READ_ENABLED!=="staging")
  return send({ok:false,error:"RIYA_CASES_DISABLED"},503);
 try{
  const url=new URL(request.url);
  if(url.search||url.hash)return send({ok:false,error:"UNSUPPORTED_FILTER"},400);
  const scope=await getVerifiedScopedStaff(request.headers.get("authorization"));
  if(!scope||scope.canReadContent!==true||scope.canMutate!==false||
    !["operations_manager","support_agent"].includes(scope.role)||
    !scope.verifiedDepartments?.includes("client_success"))
   return send({ok:false,error:"CURRENT_CLIENT_SUCCESS_AAL2_REQUIRED"},403);
  const db=adminClient();
  // Re-query actual, current, distinct Core object grant as an independent
  // proof: department resolver masks all conversation IDs by design.
  const grants=await db.from("vox_staff_object_scopes_v1")
   .select("auth_user_id,scope_kind,object_id,expires_at,revoked_at")
   .eq("auth_user_id",scope.userId).eq("scope_kind","conversation")
   .is("revoked_at",null).gt("expires_at",new Date().toISOString()).limit(26);
  if(grants.error||!grants.data||grants.data.length>25)
   return send({ok:false,error:"CLIENT_OBJECT_GRANTS_UNAVAILABLE"},503);
  const ids=[...new Set(grants.data.map(g=>g.object_id))];
  if(ids.length!==grants.data.length)
   return send({ok:false,error:"DUPLICATE_CLIENT_GRANT"},503);
  const conversations=ids.length?await db.from("communication_conversations")
   .select("id,subject_type,subject_id,assigned_actor,state,human_takeover,revision,updated_at")
   .in("id",ids).eq("subject_type","client").limit(26):empty;
  if(conversations.error||!conversations.data||conversations.data.length>25)
   return send({ok:false,error:"CLIENT_CONVERSATION_UNAVAILABLE"},503);
  const leadIds=[...new Set(conversations.data.map(c=>c.subject_id))];
  if(leadIds.some(x=>typeof x!=="string"))
   return send({ok:false,error:"CLIENT_LEAD_REFERENCE_DENIED"},503);
  const leads=leadIds.length?await db.from("leads")
   .select("id,service_zone_id,google_place_id,location_verification_status,latitude,longitude")
   .in("id",leadIds).limit(26):empty;
  if(leads.error||!leads.data||leads.data.length!==leadIds.length)
   return send({ok:false,error:"CLIENT_LEAD_SOURCE_UNAVAILABLE"},503);
  const zoneIds=[...new Set(leads.data.map(l=>l.service_zone_id))];
  const zones=zoneIds.length?await db.from("marketplace_service_zones")
   .select("id,city_id,is_active").in("id",zoneIds)
   .eq("city_id",scope.cityId).eq("is_active",true).limit(26):empty;
  if(zones.error||!zones.data)
   return send({ok:false,error:"CLIENT_LOCATION_ZONE_UNAVAILABLE"},503);
  const projected=projectScopedClientCaseList({
   scope,grants:grants.data,conversations:conversations.data,
   leads:leads.data,zones:zones.data
  });
  if(!projected.ok)return send({ok:false,error:"CLIENT_CASE_SCOPE_DENIED"},403);
  // AB7N: multi-hop client read can outlive staff permission revocation.
  // Reconfirm the real Auth/department/team scope AND each exact active
  // conversation grant immediately before releasing case metadata.
  const current=await getVerifiedScopedStaff(request.headers.get("authorization"));
  if(!current||current.userId!==scope.userId||
    current.teamId!==scope.teamId||current.cityId!==scope.cityId||
    current.role!==scope.role||current.canReadContent!==true||
    current.canMutate!==false||
    !current.verifiedDepartments?.includes("client_success"))
   return send({ok:false,error:"CLIENT_CASE_AUTH_REVOKED_DURING_READ"},403);
  const renewed=await db.from("vox_staff_object_scopes_v1")
   .select("auth_user_id,scope_kind,object_id,expires_at,revoked_at")
   .eq("auth_user_id",scope.userId).eq("scope_kind","conversation")
   .is("revoked_at",null).gt("expires_at",new Date().toISOString()).limit(26);
  if(renewed.error||!renewed.data||renewed.data.length>25||
     renewed.data.length!==grants.data.length||
     renewed.data.some(g=>g.auth_user_id!==scope.userId||
      g.scope_kind!=="conversation"||
      !ids.includes(g.object_id))||
     ids.some(id=>!renewed.data!.some(g=>g.object_id===id)))
   return send({ok:false,error:"CLIENT_CASE_OBJECT_GRANT_REVOKED_DURING_READ"},403);
  return send(projected,200);
 }catch{return send({ok:false,error:"CLIENT_CASE_UNAVAILABLE"},503);}
}
export function POST(){return send({ok:false,error:"READ_ONLY"},405);}
export function PUT(){return send({ok:false,error:"READ_ONLY"},405);}
export function PATCH(){return send({ok:false,error:"READ_ONLY"},405);}
export function DELETE(){return send({ok:false,error:"READ_ONLY"},405);}
