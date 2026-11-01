import "server-only";
import {adminClient} from "@/lib/supabase";
import {getVerifiedScopedStaff} from "@/services/vox/verifiedScopedStaff";
import {deriveCanonicalCityVendorIds} from "@/contracts/vox/canonicalZoneGate.mjs";
export const runtime="nodejs";
export const dynamic="force-dynamic";
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const json=(value:unknown,status:number)=>Response.json(value,{status,headers:{
 "cache-control":"private, no-store, max-age=0","vary":"Authorization",
 "x-content-type-options":"nosniff"}});
const denied=(error:string,status:number)=>json({ok:false,error},status);
/** Only a verified, active Operations Manager with exact conversation AND
 * vendor grants can discover a bounded CURRENT-revision selection hint.
 * It cannot authorize a write; Core's locked SQL independently rechecks every
 * user, department, zone, consent, state, revision and revocation.
 */
export async function GET(request:Request){
 if(process.env.VOX_STAFF_READ_ENABLED!=="staging"||
    process.env.VOX_RC42_CORE_CONVERSATION_OPERATOR_ENABLED!=="staging"||
    process.env.VOX_STAFF_GRANTS_ENABLED!=="staging"||
    process.env.VOX_DEPARTMENT_ENFORCEMENT_ENABLED!=="staging")
  return denied("CONVERSATION_DISCOVERY_NOT_APPROVED",503);
 const url=new URL(request.url);
 if(url.search||url.hash)return denied("UNSUPPORTED_FILTER",400);
 try{
  const scope=await getVerifiedScopedStaff(request.headers.get("authorization"));
  if(!scope||scope.role!=="operations_manager"||!scope.canReadContent||
     !UUID.test(scope.userId)||!UUID.test(scope.cityId)||!UUID.test(scope.teamId))
   return denied("SCOPED_OPERATIONS_MANAGER_REQUIRED",403);
  if(!scope.conversationIds.length||!scope.vendorIds.length)
   return json({ok:true,schema:"qf.vox.conversation.candidates.v1",
    mode:"READ_ONLY",actionsEnabled:false,conversations:[]},200);
  const db=adminClient();
  const vendors=await db.from("vendors").select("id,service_zone_id")
   .in("id",[...scope.vendorIds]).limit(201);
  if(vendors.error||!vendors.data||vendors.data.length>200)
   return denied("VENDOR_SCOPE_UNAVAILABLE",503);
  const zonesIds=[...new Set(vendors.data.map(v=>v.service_zone_id))];
  const zones=zonesIds.length?await db.from("marketplace_service_zones")
   .select("id,city_id,is_active").in("id",zonesIds)
   .eq("city_id",scope.cityId).eq("is_active",true).limit(201):
   {data:[],error:null};
  if(zones.error||!zones.data||zones.data.length>200)
   return denied("ZONE_SCOPE_UNAVAILABLE",503);
  const verified=deriveCanonicalCityVendorIds({cityId:scope.cityId,
   grantedVendorIds:scope.vendorIds,vendors:vendors.data,zones:zones.data});
  if(!verified.ok)return denied("CITY_ZONE_SCOPE_UNAVAILABLE",503);
  if(!verified.ids.length)return json({ok:true,
   schema:"qf.vox.conversation.candidates.v1",mode:"READ_ONLY",
   actionsEnabled:false,conversations:[]},200);
  const rows=await db.from("communication_conversations")
   .select("id,subject_id,subject_type,tenant_id,channel,state,human_takeover,assigned_actor,revision")
   .in("id",[...scope.conversationIds]).in("subject_id",verified.ids)
   .eq("subject_type","vendor").eq("tenant_id","quickfurno")
   .eq("channel","whatsapp").eq("human_takeover",false)
   .in("state",["OPEN","PAUSED"]).in("assigned_actor",["RIYA","ANISHA","AAROHI"])
   .order("updated_at",{ascending:false}).limit(201);
  if(rows.error||!rows.data||rows.data.length>200)
   return denied("CONVERSATION_SCOPE_UNAVAILABLE",503);
  const allow=new Set(scope.conversationIds),vendorIds=new Set(verified.ids),seen=new Set<string>();
  const conversations=[] as Array<{id:string;revision:number;state:"OPEN"|"PAUSED";allowedActions:("PAUSE_AI"|"TAKEOVER")[]}>;
  for(const row of rows.data){
   if(!UUID.test(row.id)||!allow.has(row.id)||seen.has(row.id)||
      !vendorIds.has(row.subject_id)||row.subject_type!=="vendor"||
      row.tenant_id!=="quickfurno"||row.channel!=="whatsapp"||
      row.human_takeover!==false||!["RIYA","ANISHA","AAROHI"].includes(row.assigned_actor)||
      !["OPEN","PAUSED"].includes(row.state)||
      !Number.isSafeInteger(row.revision)||row.revision<0||row.revision>2147483646)
    return denied("CONVERSATION_PROJECTION_INVALID",503);
   seen.add(row.id);
   if(conversations.length<20)conversations.push({id:row.id,revision:row.revision,
    state:row.state,allowedActions:row.state==="OPEN"?["PAUSE_AI","TAKEOVER"]:["TAKEOVER"]});
  }
  // A vendor can be re-zoned or its city zone disabled while the above
  // read is in flight, even with unchanged Staff object grants. Re-query
  // canonical locations before presenting a CURRENT operator selection.
  const currentVendors=await db.from("vendors").select("id,service_zone_id")
   .in("id",verified.ids).limit(201);
  if(currentVendors.error||!currentVendors.data||
     currentVendors.data.length!==verified.ids.length)
   return denied("VENDOR_SCOPE_CHANGED_DURING_READ",403);
  const currentZoneIds=[...new Set(currentVendors.data.map(v=>v.service_zone_id))];
  const currentZones=currentZoneIds.length?await db.from("marketplace_service_zones")
   .select("id,city_id,is_active").in("id",currentZoneIds)
   .eq("city_id",scope.cityId).eq("is_active",true).limit(201):
   {data:[],error:null};
  if(currentZones.error||!currentZones.data||currentZones.data.length>200)
   return denied("ZONE_SCOPE_CHANGED_DURING_READ",403);
  const currentProof=deriveCanonicalCityVendorIds({
   cityId:scope.cityId,grantedVendorIds:verified.ids,
   vendors:currentVendors.data,zones:currentZones.data});
  if(!currentProof.ok||currentProof.ids.length!==verified.ids.length||
     !verified.ids.every(id=>currentProof.ids.includes(id)))
   return denied("VENDOR_CITY_CHANGED_DURING_READ",403);
  // Re-fetch every selected conversation after the asynchronous zone reads.
  // Current revision and state are only hints, but must not knowingly be
  // returned stale (the independent atomic writer still verifies under lock).
  const latest=await db.from("communication_conversations")
   .select("id,subject_id,subject_type,tenant_id,channel,state,human_takeover,assigned_actor,revision")
   .in("id",conversations.map(x=>x.id)).limit(21);
  if(latest.error||!latest.data||latest.data.length!==conversations.length)
   return denied("CONVERSATION_CHANGED_DURING_READ",409);
  const selected=new Map(conversations.map(x=>[x.id,x]));
  const initialById=new Map(rows.data.map(row=>[row.id,row]));
  const latestIds=new Set<string>();
  for(const row of latest.data){
   const original=selected.get(row.id),first=initialById.get(row.id);
   if(!original||!first||latestIds.has(row.id)||!vendorIds.has(row.subject_id)||
      row.subject_id!==first.subject_id||row.subject_type!==first.subject_type||
      row.tenant_id!==first.tenant_id||row.channel!==first.channel||
      row.assigned_actor!==first.assigned_actor||
      row.revision!==original.revision||row.state!==original.state||
      row.human_takeover!==false||!["RIYA","ANISHA","AAROHI"].includes(row.assigned_actor))
    return denied("CONVERSATION_CHANGED_DURING_READ",409);
   latestIds.add(row.id);
  }
  // Staff authority is checked LAST, after all current conversation and
  // location reads; this selection is never sufficient to authorize a write.
  const fresh=await getVerifiedScopedStaff(request.headers.get("authorization"));
  if(!fresh||fresh.userId!==scope.userId||fresh.role!=="operations_manager"||
     fresh.teamId!==scope.teamId||fresh.cityId!==scope.cityId||
     !fresh.canReadContent||
     conversations.some(x=>!fresh.conversationIds.includes(x.id))||
     !verified.ids.every(id=>fresh.vendorIds.includes(id)))
   return denied("STAFF_SCOPE_CHANGED_DURING_READ",403);
  return json({ok:true,schema:"qf.vox.conversation.candidates.v1",
   mode:"READ_ONLY",actionsEnabled:false,conversations},200);
 }catch{return denied("CONVERSATION_DISCOVERY_UNAVAILABLE",503);}
}
const readOnly=()=>denied("METHOD_NOT_ALLOWED",405);
export const POST=readOnly;export const PATCH=readOnly;
export const PUT=readOnly;export const DELETE=readOnly;
