import {adminClient} from "@/lib/supabase";
import {getVerifiedScopedStaff} from "@/services/vox/verifiedScopedStaff";
export const runtime="nodejs";export const dynamic="force-dynamic";
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const send=(x:unknown,s:number)=>Response.json(x,{status:s,headers:{
 "cache-control":"private, no-store, max-age=0","vary":"Authorization","x-content-type-options":"nosniff"}});
/** Read-only bridge to canonical vendor_profile_change_requests and native v3
 * approval. VOX action-intent approval alone NEVER executes vendor mutation. */
export async function GET(request:Request){
 if(process.env.VOX_VENDOR_PROFILE_REVIEW_ENABLED!=="staging")
  return send({ok:false,error:"PROFILE_REVIEW_DISABLED"},503);
 try{
  const scope=await getVerifiedScopedStaff(request.headers.get("authorization"));
  if(!scope||!["vendor_success_agent","operations_manager"].includes(scope.role))
   return send({ok:false,error:"STAFF_AAL2_SCOPE_DENIED"},403);
  const u=new URL(request.url);
  if([...u.searchParams.keys()].length!==1||!u.searchParams.has("vendorId")||
    !UUID.test(u.searchParams.get("vendorId")??""))return send({ok:false,error:"INVALID_VENDOR"},400);
  const vendorId=u.searchParams.get("vendorId")!;
  if(!scope.vendorIds.includes(vendorId))return send({ok:false,error:"VENDOR_NOT_ASSIGNED"},403);
  const db=adminClient();
  const vendor=await db.from("vendors").select("id,service_zone_id")
   .eq("id",vendorId).eq("is_active",true).maybeSingle();
  if(vendor.error||!vendor.data?.service_zone_id)return send({ok:false,error:"VENDOR_NOT_ELIGIBLE"},403);
  const zone=await db.from("marketplace_service_zones").select("id").eq("id",vendor.data.service_zone_id)
   .eq("city_id",scope.cityId).eq("is_active",true).maybeSingle();
  if(zone.error||!zone.data)return send({ok:false,error:"CROSS_CITY_DENIED"},403);
  const results=await db.from("vendor_profile_change_requests")
   .select("id,vendor_id,request_type,status,created_at,updated_at")
   .eq("vendor_id",vendorId).eq("status","pending")
   .order("created_at",{ascending:true}).limit(21);
  if(results.error||!results.data||results.data.length>20)
   return send({ok:false,error:"REVIEW_QUEUE_UNAVAILABLE"},503);
  return send({ok:true,schema:"qf.vox.vendor.profile.review.v1",vendorId,
   authority:"CORE_VENDOR_PROFILE_CHANGE_REQUESTS_V3",mode:"READ_ONLY",
   actionsEnabled:false,requests:results.data.map(r=>({
    id:r.id,requestType:r.request_type,status:r.status,createdAt:r.created_at,
    updatedAt:r.updated_at,canExecute:false,
    requiresNativeCoreReview:true,
    reason:r.request_type==="office_location_change"?"PROVIDER_PROOF_REQUIRED":"NATIVE_ATOMIC_V3_REQUIRED"
   }))},200);
 }catch{return send({ok:false,error:"REVIEW_UNAVAILABLE"},503);}
}
export function POST(){return send({ok:false,error:"CORE_APPROVAL_REQUIRED"},405);}
export function PATCH(){return send({ok:false,error:"CORE_APPROVAL_REQUIRED"},405);}
export function DELETE(){return send({ok:false,error:"CORE_APPROVAL_REQUIRED"},405);}
