import {adminClient} from "@/lib/supabase";
import {getVerifiedScopedStaff} from "@/services/vox/verifiedScopedStaff";
import {deriveCanonicalCityVendorIds} from "@/contracts/vox/canonicalZoneGate.mjs";
import {projectStaffServiceDesk} from "@/contracts/vox/serviceDesk.mjs";
export const runtime="nodejs";
export const dynamic="force-dynamic";
const HEADERS={"content-type":"application/json; charset=utf-8","cache-control":"private, no-store, max-age=0","vary":"Authorization"};
function json(data:unknown,status:number){return new Response(JSON.stringify(data),{status,headers:HEADERS});}
/** Exact Core-authorized staff case and HUMAN agent metadata only.
 * No native support mutations, WhatsApp provider payload, AI resume or sends. */
export async function GET(request:Request){
 try{
  const scope=await getVerifiedScopedStaff(request.headers.get("authorization"));
  if(!scope||!scope.canReadContent)return json({ok:false,error:"UNAUTHORIZED_OR_UNSCOPED"},403);
  const db=adminClient();
  let verifiedVendors:string[]=[];
  let verifiedProspects:string[]=[];
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
   verifiedVendors=proof.ids;
  }
  if(scope.prospectIds.length){
   const valid=await db.from("aarohi_prospects").select("id")
     .in("id",[...scope.prospectIds]).eq("city_id",scope.cityId).limit(201);
   if(valid.error||!valid.data||valid.data.length>200)return json({ok:false,error:"PROSPECT_SCOPE_UNAVAILABLE"},503);
   verifiedProspects=valid.data.map(p=>p.id);
  }
  let threads:Record<string,unknown>[]=[];
  let conversations:Record<string,unknown>[]=[];
  if(scope.supportThreadIds.length&&verifiedVendors.length){
   const q=await db.from("vendor_support_threads")
     .select("id,vendor_id,status,priority,created_at,updated_at")
     .in("id",[...scope.supportThreadIds]).in("vendor_id",verifiedVendors)
     .order("updated_at",{ascending:false}).limit(12);
   if(q.error)return json({ok:false,error:"CASE_UNAVAILABLE"},503);
   threads=q.data??[];
  }
  if(scope.conversationIds.length&&(verifiedVendors.length||verifiedProspects.length)){
   const q=await db.from("communication_conversations")
     .select("id,subject_type,subject_id,state,human_takeover,revision,service_window_expires_at")
     .in("id",[...scope.conversationIds]).eq("state","HUMAN").eq("human_takeover",true)
     .order("updated_at",{ascending:false}).limit(201);
   if(q.error||!q.data||q.data.length>200)return json({ok:false,error:"DESK_UNAVAILABLE"},503);
   conversations=q.data;
  }
  const view=projectStaffServiceDesk({threads,conversations,context:scope,
     verifiedVendorIds:verifiedVendors,verifiedProspectIds:verifiedProspects});
  return json({ok:true,view,staff:{role:scope.role,teamId:scope.teamId,
    actionsEnabled:false}},200);
 }catch{return json({ok:false,error:"READ_UNAVAILABLE"},503);}
}
export function POST(){return json({ok:false,error:"CORE_APPROVAL_REQUIRED"},405);}
export function PATCH(){return json({ok:false,error:"CORE_APPROVAL_REQUIRED"},405);}
export function PUT(){return json({ok:false,error:"CORE_APPROVAL_REQUIRED"},405);}
export function DELETE(){return json({ok:false,error:"CORE_APPROVAL_REQUIRED"},405);}
