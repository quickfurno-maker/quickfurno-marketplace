import { adminClient } from "@/lib/supabase";
import { getVerifiedScopedStaff } from "@/services/vox/verifiedScopedStaff";
import { deriveCanonicalCityVendorIds } from "@/contracts/vox/canonicalZoneGate.mjs";
import { projectActualStaffSourceStatus } from "@/contracts/vox/actualEodSourceStatus.mjs";
export const runtime="nodejs";
export const dynamic="force-dynamic";
const send=(data:unknown,status:number)=>Response.json(data,{status,headers:{
 "cache-control":"private, no-store, max-age=0","vary":"Authorization",
 "x-content-type-options":"nosniff"
}});
const empty={data:[],error:null};
/**
 * Actual Core server DB READs of current authorized source object existence.
 * NEVER a four-system final EOD or counts. Missing agent event streams are
 * explicitly NOT PROVEN. No browser-supplied dates, team, city or subject IDs.
 */
export async function GET(request:Request):Promise<Response>{
 if(process.env.VOX_STAFF_GRANTS_ENABLED!=="staging"||
  process.env.VOX_DEPARTMENT_ENFORCEMENT_ENABLED!=="staging"||
  process.env.VOX_EOD_PREVIEW_ENABLED!=="staging"||
  process.env.VOX_EOD_SOURCE_READINESS_ENABLED!=="staging")
  return send({ok:false,error:"SOURCE_READINESS_DISABLED"},503);
 try{
  const url=new URL(request.url);
  if(url.search||url.hash)return send({ok:false,error:"UNSUPPORTED_FILTER"},400);
  const scope=await getVerifiedScopedStaff(request.headers.get("authorization"));
  if(!scope||scope.canReadContent!==true||scope.canMutate!==false||
   !["acquisition_agent","vendor_success_agent","support_agent","operations_manager"].includes(scope.role))
   return send({ok:false,error:"CURRENT_AAL2_STAFF_REQUIRED"},403);
  const db=adminClient();
  const businessDate=new Intl.DateTimeFormat("sv-SE",{timeZone:"Asia/Kolkata",
   year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
  const start=new Date(businessDate+"T00:00:00+05:30");
  const end=new Date(start.getTime()+86400000);
  // Four independent real Core-only source-existence readers, NOT event totals.
  const work=db.from("vox_work_events_candidate_v1")
   .select("id").eq("actor_id",scope.userId)
   .gte("created_at",start.toISOString()).lt("created_at",end.toISOString()).limit(101);
  const prospects=scope.prospectIds.length?db.from("aarohi_prospects")
   .select("id").in("id",[...scope.prospectIds])
   .eq("city_id",scope.cityId).limit(201):empty;
  const vendors=scope.vendorIds.length?db.from("vendors")
   .select("id,service_zone_id").in("id",[...scope.vendorIds]).limit(201):empty;
  const [w,p,v]=await Promise.all([work,prospects,vendors]);
  if(w.error||p.error||v.error||!w.data||!p.data||!v.data||
   w.data.length>100||p.data.length>200||v.data.length>200)
   return send({ok:false,error:"CORE_SOURCE_WINDOW_UNVERIFIED"},503);
  // Canonical location eligibility must be verified before a vendor support
  // subject can appear as an observed source.
  const zonesIds=[...new Set(v.data.map(x=>x.service_zone_id))];
  const z=zonesIds.length?await db.from("marketplace_service_zones")
   .select("id,city_id,is_active").in("id",zonesIds)
   .eq("city_id",scope.cityId).eq("is_active",true).limit(201):empty;
  if(z.error||!z.data||z.data.length>200)
   return send({ok:false,error:"VENDOR_ZONE_UNVERIFIED"},503);
  const vProof=deriveCanonicalCityVendorIds({cityId:scope.cityId,
   grantedVendorIds:scope.vendorIds,vendors:v.data,zones:z.data});
  if(!vProof.ok)return send({ok:false,error:"VENDOR_ZONE_DENIED"},403);
  const t=scope.supportThreadIds.length&&vProof.ids.length?
   await db.from("vendor_support_threads").select("id,vendor_id")
    .in("id",[...scope.supportThreadIds]).in("vendor_id",vProof.ids)
    .limit(201):empty;
  if(t.error||!t.data||t.data.length>200)
   return send({ok:false,error:"SUPPORT_SOURCE_UNAVAILABLE"},503);
  // CRM and Support object existence is not a source of Staff *activity*
  // unless it has a separately verifiable actor event. Do not count objects.
  // The client conversation type currently lacks a canonical project grant.
  const c=scope.conversationIds.length?await db.from("communication_conversations")
   .select("id,subject_type,subject_id").in("id",[...scope.conversationIds])
   .limit(201):empty;
  if(c.error||!c.data||c.data.length>200)
   return send({ok:false,error:"CONVERSATION_SOURCE_UNAVAILABLE"},503);
  const noObjects=(count:number)=>count===0?"NO_GRANTED_OBJECTS":"AVAILABLE";
  const result=projectActualStaffSourceStatus({
   scope,businessDate,observations:[
    {source:"CORE_WORK_LEDGER",readerState:noObjects(w.data.length),
     currentScopeVerified:true,eventProvenance:"CORE_WORK_ONLY"},
    {source:"CRM_AAROHI",
     readerState:scope.prospectIds.length!==p.data.length?"GRANT_UNVERIFIED":noObjects(p.data.length),
     currentScopeVerified:p.data.length===scope.prospectIds.length,
     eventProvenance:"NOT_PROVEN"},
    {source:"SUPPORT_DESK",
     readerState:scope.supportThreadIds.length!==t.data.length?"GRANT_UNVERIFIED":noObjects(t.data.length),
     currentScopeVerified:t.data.length===scope.supportThreadIds.length,
     eventProvenance:"NOT_PROVEN"},
    {source:"CORE_CONVERSATION",
     readerState:scope.conversationIds.length?"GRANT_UNVERIFIED":"NO_GRANTED_OBJECTS",
     currentScopeVerified:c.data.length===0&&scope.conversationIds.length===0,
     eventProvenance:"NOT_PROVEN"}
   ]});
  if(!result.ok)return send({ok:false,error:"SOURCE_READINESS_DENIED"},503);
  return send(result,200);
 }catch{return send({ok:false,error:"SOURCE_READINESS_UNAVAILABLE"},503);}
}
export function POST(){return send({ok:false,error:"READ_ONLY"},405);}
export function PATCH(){return send({ok:false,error:"READ_ONLY"},405);}
export function PUT(){return send({ok:false,error:"READ_ONLY"},405);}
export function DELETE(){return send({ok:false,error:"READ_ONLY"},405);}
