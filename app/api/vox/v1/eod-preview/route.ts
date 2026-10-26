import "server-only";
import {adminClient} from "@/lib/supabase";
import {getVerifiedScopedStaff} from "@/services/vox/verifiedScopedStaff";
import {projectCurrentCoreWorkEod} from "@/contracts/vox/coreWorkEodPreview.mjs";
import {selectCurrentEodReferences,verifyCurrentEodCanonicalProof}
 from "@/contracts/vox/currentEodCanonicalProof.mjs";
export const runtime="nodejs";
export const dynamic="force-dynamic";
const send=(body:unknown,status:number)=>Response.json(body,{status,headers:{
 "cache-control":"private, no-store, max-age=0","vary":"Authorization",
 "x-content-type-options":"nosniff"
}});
const emptyRead={data:[],error:null};
/** Current IST day only, verified actor-only, always PARTIAL read-only EOD.
 * No browser-controlled team/city/date, subject, history cursor or report total.
 * No message, report submit, acknowledgement, mutation or export capability.
 */
export async function GET(request:Request){
 if(process.env.VOX_STAFF_GRANTS_ENABLED!=="staging"||
    process.env.VOX_DEPARTMENT_ENFORCEMENT_ENABLED!=="staging"||
    process.env.VOX_WORK_QUEUE_READ_ENABLED!=="staging"||
    process.env.VOX_EOD_PREVIEW_ENABLED!=="staging")
  return send({ok:false,error:"EOD_PREVIEW_DISABLED"},503);
 try{
  const url=new URL(request.url);
  if(url.search||url.hash)return send({ok:false,error:"UNSUPPORTED_EOD_FILTER"},400);
  const scope=await getVerifiedScopedStaff(request.headers.get("authorization"));
  if(!scope||scope.canReadContent!==true||scope.canMutate!==false||
     !["operations_manager","acquisition_agent","vendor_success_agent","support_agent"].includes(scope.role))
   return send({ok:false,error:"CURRENT_AAL2_STAFF_REQUIRED"},403);
  const businessDate=new Intl.DateTimeFormat("sv-SE",{timeZone:"Asia/Kolkata",
   year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
  const dayStart=new Date(businessDate+"T00:00:00+05:30");
  const dayEnd=new Date(dayStart.getTime()+86400000);
  const db=adminClient();
  // 101 is a sentinel: never silently truncate >100 real work events.
  const log=await db.from("vox_work_events_candidate_v1")
   .select("id,work_item_id,actor_id,event_type,from_revision,to_revision,created_at")
   .eq("actor_id",scope.userId)
   .gte("created_at",dayStart.toISOString())
   .lt("created_at",dayEnd.toISOString())
   .order("created_at",{ascending:false}).limit(101);
  if(log.error||!log.data||log.data.length>100)
   return send({ok:false,error:"EOD_EVENT_WINDOW_UNVERIFIED"},503);
  const ids=[...new Set(log.data.map(e=>e.work_item_id))];
  const lookup=ids.length?await db.from("vox_work_items_candidate_v1")
   .select("id,team_id,city_id,source_kind,source_id,related_vendor_id,revision")
   .in("id",ids).eq("team_id",scope.teamId).eq("city_id",scope.cityId)
   .limit(101):emptyRead;
  if(lookup.error||!lookup.data||lookup.data.length!==ids.length)
   return send({ok:false,error:"EOD_CORE_WORK_SCOPE_UNVERIFIED"},503);
  // Fail before accessing canonical data if current source grants were revoked.
  const refs=selectCurrentEodReferences({scope,workItems:lookup.data});
  if(!refs.ok)return send({ok:false,error:"EOD_OBJECT_SCOPE_DENIED"},403);
  const prospects=refs.prospectIds.length?await db.from("aarohi_prospects")
   .select("id,city_id").in("id",refs.prospectIds)
   .eq("city_id",scope.cityId).limit(101):emptyRead;
  const vendors=refs.vendorIds.length?await db.from("vendors")
   .select("id,service_zone_id").in("id",refs.vendorIds).limit(101):emptyRead;
  if(prospects.error||vendors.error||!prospects.data||!vendors.data)
   return send({ok:false,error:"EOD_CANONICAL_SOURCE_UNAVAILABLE"},503);
  const zoneIds=[...new Set(vendors.data.map(v=>v.service_zone_id))];
  const zones=zoneIds.length?await db.from("marketplace_service_zones")
   .select("id,city_id,is_active").in("id",zoneIds)
   .eq("city_id",scope.cityId).eq("is_active",true).limit(101):emptyRead;
  const threads=refs.supportThreadIds.length&&refs.vendorIds.length?
   await db.from("vendor_support_threads").select("id,vendor_id")
    .in("id",refs.supportThreadIds).in("vendor_id",refs.vendorIds)
    .limit(101):emptyRead;
  if(zones.error||threads.error||!zones.data||!threads.data)
   return send({ok:false,error:"EOD_CANONICAL_SUPPORT_UNAVAILABLE"},503);
  const proof=verifyCurrentEodCanonicalProof({scope,workItems:lookup.data,
   references:refs,prospects:prospects.data,vendors:vendors.data,
   zones:zones.data,threads:threads.data});
  if(!proof.ok)return send({ok:false,error:"EOD_CANONICAL_PROOF_DENIED"},503);
  const report=projectCurrentCoreWorkEod({scope,workItems:lookup.data,
   events:log.data,verifiedSourceIds:proof.verifiedSourceIds,businessDate});
  if(!report.ok)return send({ok:false,error:"EOD_EVENT_PROJECTION_DENIED"},503);
  // Never represent the partial Core work ledger as an audited 4-source total.
  return send(report,200);
 }catch{return send({ok:false,error:"EOD_PREVIEW_UNAVAILABLE"},503);}
}
export function POST(){return send({ok:false,error:"READ_ONLY"},405);}
export function PUT(){return send({ok:false,error:"READ_ONLY"},405);}
export function PATCH(){return send({ok:false,error:"READ_ONLY"},405);}
export function DELETE(){return send({ok:false,error:"READ_ONLY"},405);}
