import {allowedOrigin,safeJson} from "../../../lib/auth";
import {submitScopedOperationalProposal} from "../../../lib/core";
export const runtime="nodejs";export const dynamic="force-dynamic";
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{12}$/i;
export async function POST(request:Request){
 if(!allowedOrigin(request))return safeJson({ok:false,error:"ORIGIN_DENIED"},403);
 if(!request.headers.get("content-type")?.startsWith("application/json"))
  return safeJson({ok:false,error:"INVALID_CONTENT_TYPE"},415);
 try{
  const raw=await request.text();if(raw.length>256)return safeJson({ok:false,error:"PAYLOAD_TOO_LARGE"},413);
  const value:unknown=JSON.parse(raw);
  if(!value||typeof value!=="object"||Array.isArray(value))
   return safeJson({ok:false,error:"INVALID_BODY"},400);
  const x=value as Record<string,unknown>;
  if(Object.keys(x).some(k=>!["actionKind","targetId","nonce","reasonCode"].includes(k))||
     typeof x.targetId!=="string"||!UUID.test(x.targetId)||
     typeof x.nonce!=="string"||!UUID.test(x.nonce)||
     (x.actionKind!=="AAROHI_FOLLOWUP"&&x.actionKind!=="VENDOR_PROFILE_CHANGE"&&x.actionKind!=="SUPPORT_REPLY")||
     (x.reasonCode!=="INTERNAL_FOLLOWUP"&&x.reasonCode!=="PROFILE_REVIEW"&&x.reasonCode!=="SUPPORT_REVIEW"))
   return safeJson({ok:false,error:"INVALID_PROPOSAL"},400);
  const result=await submitScopedOperationalProposal({
   actionKind:x.actionKind,targetId:x.targetId,nonce:x.nonce,reasonCode:x.reasonCode,
  });
  return safeJson(result,result.status);
 }catch{return safeJson({ok:false,error:"PROPOSAL_UNAVAILABLE"},503);}
}
export function GET(){return safeJson({ok:false,error:"METHOD_NOT_ALLOWED"},405);}
export function PATCH(){return safeJson({ok:false,error:"METHOD_NOT_ALLOWED"},405);}
export function DELETE(){return safeJson({ok:false,error:"METHOD_NOT_ALLOWED"},405);}
