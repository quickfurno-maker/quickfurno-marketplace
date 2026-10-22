import "server-only";
import {timingSafeEqual} from "node:crypto";
import {runFinanceV2StagingInboxCanary} from "@/services/financeV2InboxWorker";
export const runtime="nodejs";export const dynamic="force-dynamic";
const deny=(code:string,status:number)=>Response.json({ok:false,code},{
 status,headers:{"cache-control":"private, no-store, max-age=0",
 "x-content-type-options":"nosniff"}
});
/** Source-only gated operator scheduler entry. No managed cron created. */
export async function POST(req:Request){
 if(process.env.FINANCE_V2_PAY4A_CRON_ENABLED!=="staging"||
  process.env.FINANCE_V2_PAY3_INBOX_WORKER_ENABLED!=="staging"||
  process.env.RAZORPAY_VENDOR_PACKAGE_MODE!=="test")
  return deny("FINANCE_WORKER_DISABLED",503);
 const secret=process.env.FINANCE_V2_PAY4A_CRON_TOKEN;
 const auth=req.headers.get("authorization");
 if(!secret||secret.length<32||secret.length>256||!auth?.startsWith("Bearer "))
  return deny("FINANCE_INTERNAL_DENIED",403);
 const submitted=auth.slice(7);
 const a=Buffer.from(secret),b=Buffer.from(submitted);
 if(a.length!==b.length||!timingSafeEqual(a,b))
  return deny("FINANCE_INTERNAL_DENIED",403);
 if(req.headers.get("content-length")&&req.headers.get("content-length")!=="0")
  return deny("FINANCE_BODY_FORBIDDEN",400);
 try{
  const out=await runFinanceV2StagingInboxCanary();
  return Response.json(out,{status:200,headers:{"cache-control":"no-store"}});
 }catch{return deny("FINANCE_WORKER_UNAVAILABLE",503);}
}
export function GET(){return deny("METHOD_NOT_ALLOWED",405);}
export function PUT(){return deny("METHOD_NOT_ALLOWED",405);}
export function PATCH(){return deny("METHOD_NOT_ALLOWED",405);}
export function DELETE(){return deny("METHOD_NOT_ALLOWED",405);}
