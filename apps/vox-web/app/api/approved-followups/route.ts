import {allowedOrigin,safeJson} from "../../../lib/auth";
import {fetchApprovedNativeFollowups,executeApprovedNativeFollowup} from "../../../lib/core";
export const runtime="nodejs";export const dynamic="force-dynamic";
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{12}$/i;
export async function GET(){const v=await fetchApprovedNativeFollowups();return safeJson(v,v.status);}
export async function POST(request:Request){
 if(!allowedOrigin(request))return safeJson({ok:false,error:"ORIGIN_DENIED"},403);
 if(!request.headers.get("content-type")?.startsWith("application/json"))
  return safeJson({ok:false,error:"INVALID_CONTENT_TYPE"},415);
 try{
  const raw=await request.text();if(raw.length>128)return safeJson({ok:false,error:"TOO_LARGE"},413);
  const data:unknown=JSON.parse(raw);
  if(!data||typeof data!=="object"||Array.isArray(data))return safeJson({ok:false,error:"INVALID_BODY"},400);
  const x=data as Record<string,unknown>;
  if(Object.keys(x).some(k=>!["intentId","expectedRevision"].includes(k))||
     typeof x.intentId!=="string"||!UUID.test(x.intentId)||x.expectedRevision!==1)
   return safeJson({ok:false,error:"INVALID_EXECUTION"},400);
  const r=await executeApprovedNativeFollowup(x.intentId);return safeJson(r,r.status);
 }catch{return safeJson({ok:false,error:"EXECUTION_UNAVAILABLE"},503);}
}
export function PATCH(){return safeJson({ok:false,error:"METHOD_NOT_ALLOWED"},405);}
export function DELETE(){return safeJson({ok:false,error:"METHOD_NOT_ALLOWED"},405);}
