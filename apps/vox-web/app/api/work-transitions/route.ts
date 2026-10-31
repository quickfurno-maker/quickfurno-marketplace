import {allowedOrigin,safeJson} from "../../../lib/auth";
import {submitScopedWorkTransition} from "../../../lib/workTransitions";
export const runtime="nodejs";
export const dynamic="force-dynamic";
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ACTIONS=["CLAIM","START","WAIT_EXTERNAL","REQUEST_APPROVAL","BLOCK","RESUME","COMPLETE"] as const;
export async function POST(request:Request){
 if(process.env.VOX_WORK_ACTIONS_UI_ENABLED!=="staging"||
    process.env.VOX_WORK_ACTIONS_ENABLED!=="staging")
  return safeJson({ok:false,error:"WORK_ACTIONS_DISABLED"},503);
 if(new URL(request.url).search||new URL(request.url).hash)
  return safeJson({ok:false,error:"UNSUPPORTED_FILTER"},400);
 if(!allowedOrigin(request))return safeJson({ok:false,error:"ORIGIN_DENIED"},403);
 if(new URL(request.url).search)return safeJson({ok:false,error:"FILTER_DENIED"},400);
 if(request.headers.get("content-type")?.split(";",1)[0]?.trim().toLowerCase()!=="application/json")
  return safeJson({ok:false,error:"JSON_REQUIRED"},415);
 try{
  const raw=await request.text();
  if(raw.length<2||raw.length>900)return safeJson({ok:false,error:"INVALID_SIZE"},413);
  const body:unknown=JSON.parse(raw);
  if(!body||typeof body!=="object"||Array.isArray(body))
   return safeJson({ok:false,error:"INVALID_BODY"},400);
  const v=body as Record<string,unknown>;
  if(Object.keys(v).sort().join("|")!==["action","itemId","expectedRevision","nonce","reason"].sort().join("|")||
    !ACTIONS.includes(v.action as typeof ACTIONS[number])||
    typeof v.itemId!=="string"||!UUID.test(v.itemId)||
    typeof v.nonce!=="string"||!UUID.test(v.nonce)||
    !Number.isSafeInteger(v.expectedRevision)||(v.expectedRevision as number)<0||(v.expectedRevision as number)>2147483646||
    (v.expectedRevision as number)>2147483646||
    typeof v.reason!=="string"||v.reason.length>300||
    v.reason!==v.reason.trim()||
    (v.action==="CLAIM"&&v.reason!=="")||
    (["BLOCK","REQUEST_APPROVAL","COMPLETE"].includes(String(v.action))&&v.reason.length<12))
   return safeJson({ok:false,error:"INVALID_WORK_COMMAND"},400);
  const result=await submitScopedWorkTransition({
   action:v.action as typeof ACTIONS[number],
   itemId:v.itemId,expectedRevision:v.expectedRevision as number,
   nonce:v.nonce,reason:v.reason});
  return safeJson(result,result.status);
 }catch{return safeJson({ok:false,error:"INVALID_JSON"},400);}
}
export function GET(){return safeJson({ok:false,error:"METHOD_NOT_ALLOWED"},405);}
export function PUT(){return safeJson({ok:false,error:"METHOD_NOT_ALLOWED"},405);}
export function PATCH(){return safeJson({ok:false,error:"METHOD_NOT_ALLOWED"},405);}
export function DELETE(){return safeJson({ok:false,error:"METHOD_NOT_ALLOWED"},405);}
