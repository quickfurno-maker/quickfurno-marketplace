import {allowedOrigin,safeJson} from "../../../lib/auth";
import {proposeAarohiInternalFollowup} from "../../../lib/core";
export const runtime="nodejs";export const dynamic="force-dynamic";
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export async function POST(request:Request){
 if(!allowedOrigin(request))return safeJson({ok:false,error:"ORIGIN_DENIED"},403);
 if(!request.headers.get("content-type")?.startsWith("application/json"))
  return safeJson({ok:false,error:"INVALID_CONTENT_TYPE"},415);
 try{
  const raw=await request.text();
  if(raw.length>510)return safeJson({ok:false,error:"PAYLOAD_TOO_LARGE"},413);
  const data:unknown=JSON.parse(raw);
  if(!data||typeof data!=="object"||Array.isArray(data))
   return safeJson({ok:false,error:"INVALID_BODY"},400);
  const x=data as Record<string,unknown>;
  if(Object.keys(x).some(k=>!["targetId","nonce","rationale"].includes(k))||
     typeof x.targetId!=="string"||!UUID.test(x.targetId)||
     typeof x.nonce!=="string"||!UUID.test(x.nonce)||
     typeof x.rationale!=="string"||x.rationale.trim().length<12||
     x.rationale.trim().length>300)
   return safeJson({ok:false,error:"INVALID_PROPOSAL"},400);
  const result=await proposeAarohiInternalFollowup({
    targetId:x.targetId,nonce:x.nonce,rationale:x.rationale.trim()
  });
  return safeJson(result,result.status);
 }catch{return safeJson({ok:false,error:"PROPOSAL_UNAVAILABLE"},503);}
}
export function GET(){return safeJson({ok:false,error:"METHOD_NOT_ALLOWED"},405);}
export function PATCH(){return safeJson({ok:false,error:"METHOD_NOT_ALLOWED"},405);}
export function DELETE(){return safeJson({ok:false,error:"METHOD_NOT_ALLOWED"},405);}
