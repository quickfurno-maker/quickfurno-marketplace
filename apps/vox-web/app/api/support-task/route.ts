import {allowedOrigin,safeJson} from "../../../lib/auth";
import {submitScopedSupportTask} from "../../../lib/core";
export const runtime="nodejs";export const dynamic="force-dynamic";
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export async function POST(request:Request){
 if(!allowedOrigin(request))return safeJson({ok:false,error:"ORIGIN_DENIED"},403);
 if(!request.headers.get("content-type")?.startsWith("application/json"))
  return safeJson({ok:false,error:"CONTENT_TYPE_DENIED"},415);
 try{
  const raw=await request.text();if(raw.length>320)return safeJson({ok:false,error:"TOO_LARGE"},413);
  const data:unknown=JSON.parse(raw);
  if(!data||typeof data!=="object"||Array.isArray(data))return safeJson({ok:false,error:"INVALID_BODY"},400);
  const v=data as Record<string,unknown>;
  if(Object.keys(v).some(k=>!["threadId","nonce","priority","dueAt"].includes(k))||
   typeof v.threadId!=="string"||!UUID.test(v.threadId)||
   typeof v.nonce!=="string"||!UUID.test(v.nonce)||
   typeof v.dueAt!=="string"||typeof v.priority!=="string")
   return safeJson({ok:false,error:"INVALID_FIELDS"},400);
  const result=await submitScopedSupportTask({
   threadId:v.threadId,nonce:v.nonce,priority:v.priority,dueAt:v.dueAt});
  return safeJson(result,result.status);
 }catch{return safeJson({ok:false,error:"SUPPORT_TASK_UNAVAILABLE"},503);}
}
export function GET(){return safeJson({ok:false,error:"METHOD_NOT_ALLOWED"},405);}
export function PATCH(){return safeJson({ok:false,error:"METHOD_NOT_ALLOWED"},405);}
export function DELETE(){return safeJson({ok:false,error:"METHOD_NOT_ALLOWED"},405);}
