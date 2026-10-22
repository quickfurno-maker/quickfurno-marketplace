import "server-only";
import {verifiedMfaSession} from "../../../lib/auth";
import {origin} from "../../../lib/core";
export const runtime="nodejs";export const dynamic="force-dynamic";
const refuse=(status:number)=>Response.json({ok:false,error:"FINANCE_CASE_UNAVAILABLE"},
 {status,headers:{"cache-control":"no-store"}});
export async function POST(req:Request){
 if(process.env.VOX_FINANCE_PAY4A_CASE_UI_ENABLED!=="staging"||
  process.env.VOX_STAFF_PORTAL_ENABLED!=="staging")return refuse(503);
 const token=await verifiedMfaSession(),base=origin();
 if(!token||!base)return refuse(403);
 const body=await req.text();
 if(body.length>2048)return refuse(413);
 try{
  const r=await fetch(base+"/api/vox/v1/finance-case",{method:"POST",
   headers:{authorization:"Bearer "+token,"content-type":"application/json"},
   body,cache:"no-store",redirect:"error",signal:AbortSignal.timeout(4000)});
  const result:unknown=await r.json();
  if(!result||typeof result!=="object"||Array.isArray(result))return refuse(503);
  const safe=result as Record<string,unknown>;
  if(safe.ok!==true||typeof safe.caseId!=="string")return refuse(r.status===403?403:503);
  return Response.json({ok:true,caseId:safe.caseId,state:"REVIEW_REQUESTED",execution:false},
   {status:r.status===201?201:200,headers:{"cache-control":"no-store"}});
 }catch{return refuse(503);}
}
