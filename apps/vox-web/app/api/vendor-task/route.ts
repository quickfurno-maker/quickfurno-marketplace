import {allowedOrigin,safeJson} from "../../../lib/auth";
import {submitScopedVendorTask} from "../../../lib/core";
export const runtime="nodejs";export const dynamic="force-dynamic";
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export async function POST(request:Request){
 if(!allowedOrigin(request))return safeJson({ok:false,error:"ORIGIN_DENIED"},403);
 if(!request.headers.get("content-type")?.startsWith("application/json"))
  return safeJson({ok:false,error:"INVALID_CONTENT_TYPE"},415);
 try{
  const raw=await request.text();if(raw.length>700)return safeJson({ok:false,error:"PAYLOAD_TOO_LARGE"},413);
  const obj:unknown=JSON.parse(raw);
  if(!obj||typeof obj!=="object"||Array.isArray(obj))return safeJson({ok:false,error:"INVALID_BODY"},400);
  const v=obj as Record<string,unknown>;
  const fields=["vendorId","nonce","taskType","title","priority","dueAt"];
  if(Object.keys(v).some(k=>!fields.includes(k))||typeof v.vendorId!=="string"||!UUID.test(v.vendorId)||
     typeof v.nonce!=="string"||!UUID.test(v.nonce)||
     typeof v.title!=="string"||v.title.length>120||
     typeof v.taskType!=="string"||typeof v.priority!=="string"||typeof v.dueAt!=="string")
   return safeJson({ok:false,error:"INVALID_TASK"},400);
  const result=await submitScopedVendorTask({vendorId:v.vendorId,nonce:v.nonce,
   taskType:v.taskType,title:v.title,priority:v.priority,dueAt:v.dueAt});
  return safeJson(result,result.status);
 }catch{return safeJson({ok:false,error:"CORE_TASK_UNAVAILABLE"},503);}
}
export function GET(){return safeJson({ok:false,error:"METHOD_NOT_ALLOWED"},405);}
export function PATCH(){return safeJson({ok:false,error:"METHOD_NOT_ALLOWED"},405);}
export function DELETE(){return safeJson({ok:false,error:"METHOD_NOT_ALLOWED"},405);}
