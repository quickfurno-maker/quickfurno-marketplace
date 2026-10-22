import "server-only";
import {verifiedMfaSession} from "../../../lib/auth";
import {origin} from "../../../lib/core";
export const runtime="nodejs";export const dynamic="force-dynamic";
const refuse=(status:number)=>Response.json({ok:false,error:"FINANCE_REVIEW_UNAVAILABLE"},
 {status,headers:{"cache-control":"no-store"}});
async function relay(method:"GET"|"POST",req:Request){
 if(process.env.VOX_FINANCE_PAY4A_CASE_UI_ENABLED!=="staging"||
   process.env.VOX_STAFF_PORTAL_ENABLED!=="staging")return refuse(503);
 const token=await verifiedMfaSession(),base=origin();
 if(!token||!base)return refuse(403);
 const body=method==="POST"?await req.text():undefined;
 if(body&&body.length>2048)return refuse(413);
 try{
  const r=await fetch(base+"/api/vox/v1/finance-case-review",{
   method,headers:{authorization:"Bearer "+token,
    ...(method==="POST"?{"content-type":"application/json"}:{})},
   body,cache:"no-store",redirect:"error",signal:AbortSignal.timeout(4000)});
  const x:unknown=await r.json();
  if(!x||typeof x!=="object"||Array.isArray(x))return refuse(503);
  const value=x as Record<string,unknown>;
  if(value.ok!==true)return refuse(r.status===403?403:503);
  if(method==="POST")
   return Response.json({ok:true,reviewId:value.reviewId,execution:false},
    {status:r.status===201?201:200,headers:{"cache-control":"no-store"}});
  if(!Array.isArray(value.cases)||value.cases.length>20)return refuse(503);
  const uu=/^[0-9a-f-]{36}$/i;
  const cases=[];
  for(const v of value.cases){
   if(!v||typeof v!=="object")return refuse(503);
   const e=v as Record<string,unknown>;
   if(!uu.test(String(e.id))||!uu.test(String(e.order_id))||
     !["MANUAL_RECEIPT_REVIEW","REFUND_POLICY_REVIEW"].includes(String(e.case_kind))||
     typeof e.requested_amount_subunits!=="number"||
     !Number.isSafeInteger(e.requested_amount_subunits)||e.requested_amount_subunits<=0||
     typeof e.created_at!=="string")return refuse(503);
   cases.push({id:e.id,orderId:e.order_id,caseKind:e.case_kind,
    amountSubunits:e.requested_amount_subunits,createdAt:e.created_at});
  }
  return Response.json({ok:true,cases,execution:false},{headers:{"cache-control":"no-store"}});
 }catch{return refuse(503);}
}
export async function GET(req:Request){return relay("GET",req);}
export async function POST(req:Request){return relay("POST",req);}
