import "server-only";
import {verifiedMfaSession} from "../../../lib/auth";
import {origin} from "../../../lib/core";
export const runtime="nodejs";export const dynamic="force-dynamic";
const reject=(status:number)=>Response.json({ok:false,error:"FINANCE_ORDERS_UNAVAILABLE"},
 {status,headers:{"cache-control":"no-store"}});
export async function GET(req:Request){
 if(process.env.VOX_FINANCE_PAY4B_SEARCH_UI_ENABLED!=="staging"||
 process.env.VOX_STAFF_PORTAL_ENABLED!=="staging")return reject(503);
 const url=new URL(req.url),vendorId=url.searchParams.get("vendorId"),page=url.searchParams.get("page");
 if(url.searchParams.size!==2||!vendorId||!/^[a-f0-9-]{36}$/i.test(vendorId)||
 !page||!/^[0-9]$/.test(page))return reject(400);
 const token=await verifiedMfaSession(),base=origin();
 if(!token||!base)return reject(403);
 try{
  const response=await fetch(base+"/api/vox/v1/finance-orders?vendorId="+
   encodeURIComponent(vendorId)+"&page="+encodeURIComponent(page),{
   headers:{authorization:"Bearer "+token},cache:"no-store",redirect:"error",
   signal:AbortSignal.timeout(4500)});
  if(!response.ok)return reject(response.status===403?403:503);
  const body=await response.json();
  if(body?.ok!==true||!Array.isArray(body.orders)||body.orders.length>20||
    body.vendorId!==vendorId||body.page!==Number(page)||
    typeof body.hasMore!=="boolean")return reject(503);
  for(const o of body.orders){
   if(!/^[a-f0-9-]{36}$/i.test(String(o.id))||
      !["test","live"].includes(o.providerMode)||
      typeof o.createdAt!=="string")return reject(503);
  }
  return Response.json({ok:true,vendorId,page:Number(page),orders:body.orders,
   hasMore:body.hasMore,actionsEnabled:false},{headers:{"cache-control":"no-store"}});
 }catch{return reject(503);}
}
export function POST(){return reject(405);}
