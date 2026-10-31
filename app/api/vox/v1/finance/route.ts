import "server-only";
import {adminClient} from "@/lib/supabase";
import {verifyVoxOwnerBearer} from "@/services/vox/verifiedStaffBearer";
import {projectRc7OwnerFinanceOrders} from "@/contracts/vox/rc7FinanceReadModel.mjs";
export const runtime="nodejs";
export const dynamic="force-dynamic";
const reply=(value:unknown,status:number)=>Response.json(value,{status,headers:{
 "cache-control":"private, no-store, max-age=0","vary":"Authorization",
 "x-content-type-options":"nosniff"}});
/** Owner-only, bounded, read-only Core order snapshot.
 * No Razorpay calls, wallet credits, balances, payment writes or reconciliation.
 * Default disabled, requiring separately approved staging activation.
 */
export async function GET(request:Request){
 if(process.env.VOX_FINANCE_READ_ENABLED!=="staging"||
    process.env.VOX_STAFF_READ_ENABLED!=="staging"||
    process.env.VOX_STAFF_GRANTS_ENABLED!=="staging")
  return reply({ok:false,error:"FINANCE_PREVIEW_DISABLED"},503);
 const u=new URL(request.url);
 if(u.search||u.hash)return reply({ok:false,error:"FILTERS_NOT_CERTIFIED"},400);
 try{
  const owner=await verifyVoxOwnerBearer(request.headers.get("authorization"));
  if(!owner)return reply({ok:false,error:"OWNER_AAL2_REQUIRED"},403);
  const result=await adminClient().from("vendor_package_orders")
   .select("id,vendor_id,package_price,package_currency,credits_included,order_status,payment_status,activation_status,created_at")
   .order("created_at",{ascending:false}).limit(21);
  if(result.error||!Array.isArray(result.data)||result.data.length>20)
   return reply({ok:false,error:"FINANCE_READ_UNAVAILABLE_OR_OVER_LIMIT"},503);
  const orders=projectRc7OwnerFinanceOrders(result.data);
  if(!orders)return reply({ok:false,error:"FINANCE_RECORD_UNTRUSTED"},503);
  const current=await verifyVoxOwnerBearer(request.headers.get("authorization"));
  if(!current||current!==owner)return reply({ok:false,error:"OWNER_AUTH_REVOKED_DURING_READ"},403);
  return reply({ok:true,schema:"qf.vox.finance.order-preview.v1",
   source:"vendor_package_orders",mode:"READ_ONLY",canRefund:false,
   canReconcile:false,canActivatePayments:false,hasProviderConfirmation:false,
   isCompleteHistory:false,previewCount:orders.length,orders},200);
 }catch{return reply({ok:false,error:"FINANCE_READ_UNAVAILABLE"},503);}
}
export function POST(){return reply({ok:false,error:"METHOD_NOT_ALLOWED"},405);}
export function PUT(){return reply({ok:false,error:"METHOD_NOT_ALLOWED"},405);}
export function PATCH(){return reply({ok:false,error:"METHOD_NOT_ALLOWED"},405);}
export function DELETE(){return reply({ok:false,error:"METHOD_NOT_ALLOWED"},405);}
