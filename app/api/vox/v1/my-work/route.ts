import {adminClient} from "@/lib/supabase";
import {getVerifiedScopedStaff} from "@/services/vox/verifiedScopedStaff";
import {deriveCanonicalCityVendorIds} from "@/contracts/vox/canonicalZoneGate.mjs";
import {projectVoxOverview} from "@/services/vox/overviewProjection.mjs";
import {filterHumanConversations} from "@/contracts/vox/scopedStaff.mjs";
export const runtime="nodejs";
export const dynamic="force-dynamic";
const HEADERS={"content-type":"application/json; charset=utf-8","cache-control":"private, no-store, max-age=0","vary":"Authorization"};
function json(data:unknown,status:number){return new Response(JSON.stringify(data),{status,headers:HEADERS});}
/** Only explicit, active, assigned staff may see their own tiny Core projections.
 * No full message bodies or financial data, no client conversation, no writes. */
export async function GET(request:Request){
 try{
  const scope=await getVerifiedScopedStaff(request.headers.get("authorization"));
  if(!scope)return json({ok:false,error:"UNAUTHORIZED_OR_UNSCOPED"},403);
  const db=adminClient();
  let prospects:Record<string,unknown>[]=[];
  let crm:Record<string,unknown>[]=[];
  let support:Record<string,unknown>[]=[];
  let human:Record<string,unknown>[]=[];
  let permittedVendorIds:string[]=[];
  if(scope.prospectIds.length){
   const q=await db.from("aarohi_prospects")
    .select("id,business_name,prospect_stage,priority_band,last_activity_at,city_id")
    .eq("city_id",scope.cityId).in("id",[...scope.prospectIds])
    .order("last_activity_at",{ascending:false}).limit(8);
   if(q.error)return json({ok:false,error:"READ_UNAVAILABLE"},503);
   prospects=q.data??[];
  }
  if(scope.vendorIds.length){
   // Verify exact object grants BEFORE resolving canonical active city zones.
   // City-wide LIMIT 201 misses valid Staff vendors in large marketplaces.
   const vendors=await db.from("vendors").select("id,service_zone_id")
     .in("id",[...scope.vendorIds]).limit(201);
   if(vendors.error||!vendors.data||vendors.data.length>200)
     return json({ok:false,error:"VENDOR_SCOPE_UNAVAILABLE"},503);
   const zoneIds=[...new Set(vendors.data.map(v=>v.service_zone_id))];
   const zones=zoneIds.length?await db.from("marketplace_service_zones")
     .select("id,city_id,is_active").in("id",zoneIds)
     .eq("city_id",scope.cityId).eq("is_active",true).limit(201)
     :{data:[],error:null};
   if(zones.error||!zones.data||zones.data.length>200)
     return json({ok:false,error:"ZONE_SCOPE_UNAVAILABLE"},503);
   const proof=deriveCanonicalCityVendorIds({
     cityId:scope.cityId,grantedVendorIds:scope.vendorIds,
     vendors:vendors.data,zones:zones.data
   });
   if(!proof.ok)return json({ok:false,error:"INVALID_CORE_VENDOR_ZONE"},503);
   permittedVendorIds=proof.ids;
  }
  if(permittedVendorIds.length){
   const q=await db.from("vendor_crm_profiles")
     .select("vendor_id,onboarding_stage,relationship_status,next_follow_up_at")
     .in("vendor_id",permittedVendorIds).order("updated_at",{ascending:false}).limit(8);
   if(q.error)return json({ok:false,error:"READ_UNAVAILABLE"},503);
   crm=q.data??[];
  }
  if(scope.supportThreadIds.length&&permittedVendorIds.length&&scope.canReadContent){
   // Dual-grant: exact support thread AND linked vendor city validation.
   const q=await db.from("vendor_support_threads")
     .select("id,vendor_id,status,priority,updated_at")
     .in("id",[...scope.supportThreadIds]).in("vendor_id",permittedVendorIds)
     .order("updated_at",{ascending:false}).limit(8);
   if(q.error)return json({ok:false,error:"READ_UNAVAILABLE"},503);
   support=q.data??[];
  }
  if(scope.conversationIds.length&&scope.canReadContent){
   const q=await db.from("communication_conversations")
    .select("id,subject_type,subject_id,state,human_takeover,revision,updated_at")
    .in("id",[...scope.conversationIds]).eq("state","HUMAN")
    .eq("human_takeover",true).order("updated_at",{ascending:false}).limit(201);
   if(q.error||!q.data||q.data.length>200)return json({ok:false,error:"READ_UNAVAILABLE"},503);
   human=[...filterHumanConversations(q.data,scope,prospects.map(p=>String(p.id)),permittedVendorIds)];
  }
  const view=projectVoxOverview({prospects,crm,vendorSupport:support,humanConversations:human});
  return json({ok:true,view,staff:{role:scope.role,teamId:scope.teamId,cityId:scope.cityId,
    actionsEnabled:false}},200);
 }catch{return json({ok:false,error:"READ_UNAVAILABLE"},503);}
}
export function POST(){return json({ok:false,error:"READ_ONLY"},405);}
export function PUT(){return json({ok:false,error:"READ_ONLY"},405);}
export function PATCH(){return json({ok:false,error:"READ_ONLY"},405);}
export function DELETE(){return json({ok:false,error:"READ_ONLY"},405);}
