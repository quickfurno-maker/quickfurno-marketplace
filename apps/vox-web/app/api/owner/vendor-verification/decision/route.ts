/**
 * VOX Owner command BFF: strict browser Origin/Host, bounded JSON, AAL2,
 * same-origin cookie only, then verified Core AAL2 + immutable caseVersion CAS.
 * NO direct Supabase write, vendor activation, credit, lead or provider sends.
 */
import {allowedOrigin,safeJson} from "../../../../../lib/auth";
import {ownerVendorDecision,validOwnerReviewInput} from "../../../../../lib/ownerVendorVerification";
export const runtime="nodejs";export const dynamic="force-dynamic";
const MAX_BYTES=2048;
async function smallJson(request:Request):Promise<unknown|null>{
 const declared=request.headers.get("content-length");
 if(declared!==null&&(!/^[0-9]{1,5}$/.test(declared)||Number(declared)>MAX_BYTES))
  return null;
 const reader=request.body?.getReader();if(!reader)return null;
 const chunks:Uint8Array[]=[];let size=0;
 try{
  while(true){
   const {done,value}=await reader.read();if(done)break;
   size+=value.byteLength;
   if(size>MAX_BYTES){await reader.cancel().catch(()=>{});return null;}
   chunks.push(value);
  }
 }catch{return null;}finally{reader.releaseLock();}
 if(size<2)return null;
 try{
  const output=Buffer.alloc(size);let start=0;
  for(const chunk of chunks){output.set(chunk,start);start+=chunk.length;}
  return JSON.parse(output.toString("utf8")) as unknown;
 }catch{return null;}
}
export async function POST(request:Request):Promise<Response>{
 if(!allowedOrigin(request))return safeJson({ok:false,code:"ORIGIN_REQUIRED"},403);
 if(request.headers.get("content-type")?.split(";")[0].trim().toLowerCase()!=="application/json")
  return safeJson({ok:false,code:"INVALID_CONTENT_TYPE"},415);
 const raw=await smallJson(request);
 if(!validOwnerReviewInput(raw))
  return safeJson({ok:false,code:"INVALID_REVIEW_ACTION"},400);
 const r=await ownerVendorDecision(raw);
 return r.ok?safeJson({
  ok:true,schema:"qf.vox.owner.vendor-decision-bff.v1",
  vendorId:r.data.vendorId,caseState:r.data.caseState,
  vendorBusinessStatusUnchanged:true,canActivateLeads:false,
  requiresSeparateCoreVendorApproval:true
 },200):safeJson({ok:false,code:r.error},r.status);
}
export function GET(){return safeJson({ok:false,code:"METHOD_NOT_ALLOWED"},405);}
export function PUT(){return safeJson({ok:false,code:"METHOD_NOT_ALLOWED"},405);}
export function PATCH(){return safeJson({ok:false,code:"METHOD_NOT_ALLOWED"},405);}
export function DELETE(){return safeJson({ok:false,code:"METHOD_NOT_ALLOWED"},405);}
