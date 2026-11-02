import "server-only";
import {adminClient} from "@/lib/supabase";
import {verifyVoxOwnerBearer} from "@/services/vox/verifiedStaffBearer";
import {projectRc10FinanceOrderDetail} from "@/contracts/vox/rc10FinanceOrderDetail.mjs";
export const runtime="nodejs";
export const dynamic="force-dynamic";
const ID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const reply=(value:unknown,status:number)=>Response.json(value,{status,headers:{
 "cache-control":"private, no-store, max-age=0","vary":"Authorization",
 "x-content-type-options":"nosniff"}});
/** Owner-only, immutable-record read. Never financial settlement authority. */
export async function GET(request:Request,{params}:{params:Promise<{orderId:string}>}){
 if(process.env.VOX_FINANCE_READ_ENABLED!=="staging"||
    process.env.VOX_FINANCE_DETAIL_READ_ENABLED!=="staging"||
    process.env.VOX_STAFF_READ_ENABLED!=="staging"||
    process.env.VOX_STAFF_GRANTS_ENABLED!=="staging")
  return reply({ok:false,error:"FINANCE_DETAIL_DISABLED"},503);
 const {orderId}=await params;
 if(!ID.test(orderId)||new URL(request.url).search||new URL(request.url).hash)
  return reply({ok:false,error:"ORDER_ID_INVALID"},400);
 const bearer=request.headers.get("authorization");
 try{
  const actor=await verifyVoxOwnerBearer(bearer);
  if(!actor)return reply({ok:false,error:"OWNER_AAL2_REQUIRED"},403);
  const db=adminClient();
  const o=await db.from("vendor_package_orders")
   .select("id,vendor_id,package_id,package_price,package_currency,credits_included,order_status,payment_status,activation_status,created_at")
   .eq("id",orderId).maybeSingle();
  if(o.error)return reply({ok:false,error:"ORDER_SOURCE_UNAVAILABLE"},503);
  if(!o.data)return reply({ok:false,error:"ORDER_NOT_FOUND"},404);
  const p=await db.from("payments")
   .select("id,vendor_id,package_id,amount,payment_status,created_at")
   .eq("id",orderId).maybeSingle();
  if(p.error)return reply({ok:false,error:"LEDGER_SOURCE_UNAVAILABLE"},503);
  const detail=projectRc10FinanceOrderDetail(o.data,p.data);
  if(!detail)return reply({ok:false,error:"CORE_FINANCE_RECORD_MISMATCH"},503);
  // An MFA revocation during either read invalidates the entire response.
  const current=await verifyVoxOwnerBearer(bearer);
  if(!current||current!==actor)return reply({ok:false,error:"OWNER_AUTH_REVOKED_DURING_READ"},403);
  return reply({ok:true,schema:"qf.vox.finance.order-detail.v1",mode:"READ_ONLY",detail},200);
 }catch{return reply({ok:false,error:"FINANCE_DETAIL_UNAVAILABLE"},503);}
}
export function POST(){return reply({ok:false,error:"METHOD_NOT_ALLOWED"},405);}
export function PUT(){return reply({ok:false,error:"METHOD_NOT_ALLOWED"},405);}
export function PATCH(){return reply({ok:false,error:"METHOD_NOT_ALLOWED"},405);}
export function DELETE(){return reply({ok:false,error:"METHOD_NOT_ALLOWED"},405);}
