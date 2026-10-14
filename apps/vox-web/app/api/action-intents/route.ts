import {allowedOrigin,safeJson} from "../../../lib/auth";
import {fetchOwnerOperationalIntents,submitOwnerOperationalDecision} from "../../../lib/core";
export const runtime="nodejs";export const dynamic="force-dynamic";
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export async function GET(){const result=await fetchOwnerOperationalIntents();return safeJson(result,result.status);}
export async function POST(request:Request){
 if(!allowedOrigin(request))return safeJson({ok:false,error:"ORIGIN_DENIED"},403);
 if(!request.headers.get("content-type")?.startsWith("application/json"))
  return safeJson({ok:false,error:"INVALID_CONTENT_TYPE"},415);
 try{
  const body=await request.text();
  if(body.length>180)return safeJson({ok:false,error:"TOO_LARGE"},413);
  const data:unknown=JSON.parse(body);
  if(!data||typeof data!=="object"||Array.isArray(data))return safeJson({ok:false,error:"INVALID_INPUT"},400);
  const x=data as Record<string,unknown>;
  if(Object.keys(x).some(k=>!["id","decision","expectedRevision"].includes(k))||
     typeof x.id!=="string"||!UUID.test(x.id)||x.expectedRevision!==0||
     (x.decision!=="APPROVED"&&x.decision!=="REJECTED"))
   return safeJson({ok:false,error:"INVALID_REVIEW"},400);
  const result=await submitOwnerOperationalDecision(x.id,x.decision);
  return safeJson(result,result.status);
 }catch{return safeJson({ok:false,error:"REVIEW_UNAVAILABLE"},503);}
}
export function PATCH(){return safeJson({ok:false,error:"METHOD_NOT_ALLOWED"},405);}
export function DELETE(){return safeJson({ok:false,error:"METHOD_NOT_ALLOWED"},405);}
