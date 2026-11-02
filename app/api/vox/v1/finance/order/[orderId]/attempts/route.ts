import "server-only";
import {adminClient} from "@/lib/supabase";
import {verifyVoxOwnerBearer} from "@/services/vox/verifiedStaffBearer";
import {projectRc11PaymentAttemptTimeline} from "@/contracts/vox/rc11PaymentAttemptTimeline.mjs";
export const runtime="nodejs";
export const dynamic="force-dynamic";
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const reply=(value:unknown,status:number)=>Response.json(value,{status,headers:{
 "cache-control":"private, no-store, max-age=0","vary":"Authorization",
 "x-content-type-options":"nosniff"}});
/** Owner only. Uninstalled table and independent gating; no payment mutation. */
export async function GET(request:Request,{params}:{params:Promise<{orderId:string}>}){
 if(process.env.VOX_FINANCE_READ_ENABLED!=="staging"||
    process.env.VOX_FINANCE_DETAIL_READ_ENABLED!=="staging"||
    process.env.VOX_FINANCE_ATTEMPTS_READ_ENABLED!=="staging"||
    process.env.VOX_STAFF_READ_ENABLED!=="staging"||
    process.env.VOX_STAFF_GRANTS_ENABLED!=="staging")
  return reply({ok:false,error:"FINANCE_ATTEMPT_EVIDENCE_DISABLED"},503);
 const {orderId}=await params;
 if(!UUID.test(orderId)||new URL(request.url).search||new URL(request.url).hash)
  return reply({ok:false,error:"ORDER_ID_INVALID"},400);
 const bearer=request.headers.get("authorization");
 try{
  const owner=await verifyVoxOwnerBearer(bearer);
  if(!owner)return reply({ok:false,error:"OWNER_AAL2_REQUIRED"},403);
  const db=adminClient();
  const existing=await db.from("vendor_package_orders")
   .select("id").eq("id",orderId).maybeSingle();
  if(existing.error)return reply({ok:false,error:"ORDER_READ_UNAVAILABLE"},503);
  if(!existing.data)return reply({ok:false,error:"ORDER_NOT_FOUND"},404);
  const result=await db.from("vox_rc11_payment_attempt_events_candidate_v1")
   .select("event_id,order_id,attempt_id,attempt_sequence,environment,event_kind,origin,observed_at,recorded_at")
   .eq("order_id",orderId).order("recorded_at",{ascending:false}).limit(51);
  if(result.error||!Array.isArray(result.data)||result.data.length>50)
   return reply({ok:false,error:"ATTEMPT_EVIDENCE_UNAVAILABLE_OR_OVER_LIMIT"},503);
  const projected=projectRc11PaymentAttemptTimeline(result.data,orderId);
  if(!projected)return reply({ok:false,error:"ATTEMPT_EVIDENCE_UNTRUSTED"},503);
  const current=await verifyVoxOwnerBearer(bearer);
  if(!current||current!==owner)
   return reply({ok:false,error:"OWNER_AUTH_REVOKED_DURING_READ"},403);
  return reply({ok:true,...projected},200);
 }catch{return reply({ok:false,error:"ATTEMPT_EVIDENCE_UNAVAILABLE"},503);}
}
export function POST(){return reply({ok:false,error:"METHOD_NOT_ALLOWED"},405);}
export function PUT(){return reply({ok:false,error:"METHOD_NOT_ALLOWED"},405);}
export function PATCH(){return reply({ok:false,error:"METHOD_NOT_ALLOWED"},405);}
export function DELETE(){return reply({ok:false,error:"METHOD_NOT_ALLOWED"},405);}
