import "server-only";
import {adminClient} from "@/lib/supabase";
import {getVerifiedScopedStaff} from "@/services/vox/verifiedScopedStaff";
import {verifyVoxOwnerBearer} from "@/services/vox/verifiedStaffBearer";
import {financeStaffAllowed} from "@/services/financeV2Scope";
export const runtime="nodejs";export const dynamic="force-dynamic";
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const deny=(reason:string,status:number)=>Response.json({ok:false,reason},{
 status,headers:{"cache-control":"private, no-store, max-age=0","vary":"Authorization"}});
/** Explicit vendor scoped, <=20 rows/page, <=10 pages, no full search. */
export async function GET(request:Request){
 if(process.env.FINANCE_V2_PAY4B_ORDER_SEARCH_ENABLED!=="staging"||
 process.env.VOX_STAFF_PORTAL_ENABLED!=="staging")return deny("FINANCE_SEARCH_DISABLED",503);
 const url=new URL(request.url),params=url.searchParams;
 if(url.hash||[...params.keys()].some(k=>!["vendorId","page"].includes(k))||
 params.getAll("vendorId").length!==1||params.getAll("page").length!==1)
  return deny("SCOPE_INVALID",400);
 const vendorId=params.get("vendorId"),pageValue=params.get("page");
 if(!vendorId||!UUID.test(vendorId)||!pageValue||!/^(?:[0-9])$/.test(pageValue))
  return deny("SCOPE_INVALID",400);
 const page=Number(pageValue);
 const bearer=request.headers.get("authorization");
 try{
  const owner=await verifyVoxOwnerBearer(bearer);
  const staff=!owner?await getVerifiedScopedStaff(bearer):null;
  if(!owner&&!staff)return deny("FINANCE_AAL2_REQUIRED",403);
  if(staff&&!await financeStaffAllowed(staff,vendorId))return deny("FINANCE_SCOPE_DENIED",403);
  const response=await adminClient().from("vendor_package_orders")
   .select("id,vendor_id,payment_provider,provider_mode,payment_status,activation_status,created_at")
   .eq("vendor_id",vendorId).eq("payment_provider","razorpay")
   .order("created_at",{ascending:false}).order("id",{ascending:false})
   .range(page*20,page*20+20);
  if(response.error||!response.data||response.data.length>21)
   return deny("FINANCE_SEARCH_UNAVAILABLE",503);
  const list=response.data.slice(0,20);
  if(list.some(o=>!UUID.test(o.id)||o.vendor_id!==vendorId||
   o.payment_provider!=="razorpay"||!["test","live"].includes(o.provider_mode)||
   typeof o.created_at!=="string"))
   return deny("FINANCE_ORDER_ROW_INVALID",503);
  if(owner){
   if(await verifyVoxOwnerBearer(bearer)!==owner)return deny("OWNER_AUTH_REVOKED",403);
  }else{
   const fresh=await getVerifiedScopedStaff(bearer);
   if(!fresh||fresh.userId!==staff?.userId||
    !await financeStaffAllowed(fresh,vendorId))return deny("STAFF_AUTH_REVOKED",403);
  }
  return Response.json({ok:true,mode:"READ_ONLY",actionsEnabled:false,vendorId,page,
   hasMore:response.data.length===21,orders:list.map(o=>({
    id:o.id,createdAt:o.created_at,providerMode:o.provider_mode,
    paymentStatus:o.payment_status,activationStatus:o.activation_status
   }))},{headers:{"cache-control":"private, no-store"}});
 }catch{return deny("FINANCE_SEARCH_UNAVAILABLE",503);}
}
export function POST(){return deny("METHOD_NOT_ALLOWED",405);}
export function PUT(){return deny("METHOD_NOT_ALLOWED",405);}
export function DELETE(){return deny("METHOD_NOT_ALLOWED",405);}
