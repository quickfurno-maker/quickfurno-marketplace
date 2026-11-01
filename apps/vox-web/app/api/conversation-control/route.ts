import {allowedOrigin,safeJson} from "../../../lib/auth";
import {submitConversationControl} from "../../../lib/conversationControl";
export const runtime="nodejs";
export const dynamic="force-dynamic";
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export async function POST(request:Request){
 if(process.env.VOX_RC42_CORE_CONVERSATION_OPERATOR_ENABLED!=="staging"||
    process.env.VOX_STAFF_GRANTS_ENABLED!=="staging")
  return safeJson({ok:false,error:"CONVERSATION_ATOMIC_NOT_APPROVED"},503);
 const u=new URL(request.url);
 if(u.search||u.hash)return safeJson({ok:false,error:"FILTER_DENIED"},400);
 if(!allowedOrigin(request))return safeJson({ok:false,error:"ORIGIN_DENIED"},403);
 if(request.headers.get("content-type")?.split(";",1)[0].trim()!=="application/json")
  return safeJson({ok:false,error:"JSON_REQUIRED"},415);
 const size=request.headers.get("content-length");
 if(size!==null&&(!/^\d+$/.test(size)||Number(size)>512))
  return safeJson({ok:false,error:"COMMAND_TOO_LARGE"},413);
 let data:unknown;
 try{const raw=await request.text();if(raw.length>512||raw.length<2)
  return safeJson({ok:false,error:"COMMAND_TOO_LARGE"},413);
  data=JSON.parse(raw);
 }catch{return safeJson({ok:false,error:"INVALID_JSON"},400);}
 if(!data||typeof data!=="object"||Array.isArray(data))
  return safeJson({ok:false,error:"INVALID_COMMAND"},400);
 const v=data as Record<string,unknown>;
 if(Object.keys(v).sort().join("|")!=="action|conversationId|expectedRevision|nonce"||
   typeof v.conversationId!=="string"||!UUID.test(v.conversationId)||
   typeof v.nonce!=="string"||!UUID.test(v.nonce)||
   !Number.isSafeInteger(v.expectedRevision)||(v.expectedRevision as number)<0||
   (v.expectedRevision as number)>2147483646||
   (v.action!=="PAUSE_AI"&&v.action!=="TAKEOVER"))
  return safeJson({ok:false,error:"INVALID_COMMAND"},400);
 const result=await submitConversationControl({conversationId:v.conversationId,
  nonce:v.nonce,expectedRevision:v.expectedRevision as number,
  action:v.action});
 return safeJson(result,result.status);
}
export const GET=()=>safeJson({ok:false,error:"METHOD_NOT_ALLOWED"},405);
export const PUT=GET;
export const PATCH=GET;
export const DELETE=GET;
