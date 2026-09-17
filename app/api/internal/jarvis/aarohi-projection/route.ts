import { NextResponse } from "next/server";
import { parseQfjVerificationKeys } from "@/lib/jarvis/coreDecisionAuth";
import { QFJ_KEY_ID_HEADER,QFJ_SIGNATURE_HEADER,verifyQfjSignedRequestSignature } from "@/lib/jarvis/signedRequestAuth";
import { QFJ_AAROHI_PROJECTION_PATH,QFJ_AAROHI_PROJECTION_PROTOCOL,QFJ_AAROHI_PROJECTION_SIGNING_DOMAIN,parseQfjAarohiProjectionRequest } from "@/lib/jarvis/aarohiProjectionContract";
import { applyJarvisAarohiProjection } from "@/services/jarvisAarohiProjectionService";
export const runtime="nodejs";export const dynamic="force-dynamic";const MAX_BODY_BYTES=65_536;
const reply=(status:number,body:unknown)=>NextResponse.json(body,{status,headers:{"cache-control":"no-store"}});
export async function POST(request:Request):Promise<Response>{
 if(process.env.QF_JARVIS_AAROHI_PROJECTION_ENABLED?.trim().toLowerCase()!=="true")return reply(503,{error:"service_unavailable"});
 let raw:Uint8Array;try{raw=new Uint8Array(await request.arrayBuffer());}catch{return reply(400,{error:"invalid_request"});}
 if(raw.byteLength<2||raw.byteLength>MAX_BODY_BYTES)return reply(413,{error:"invalid_request"});
 let json:unknown;try{json=JSON.parse(Buffer.from(raw).toString("utf8"));}catch{return reply(400,{error:"invalid_request"});}
 const parsed=parseQfjAarohiProjectionRequest(json);if(!parsed)return reply(400,{error:"invalid_request"});
 const keys=parseQfjVerificationKeys(process.env.QF_JARVIS_CORE_VERIFICATION_KEYS_JSON);if(!keys)return reply(503,{error:"service_unavailable"});
 const ok=verifyQfjSignedRequestSignature({rawBody:raw,domain:QFJ_AAROHI_PROJECTION_SIGNING_DOMAIN,path:QFJ_AAROHI_PROJECTION_PATH,requestId:parsed.requestId,issuedAt:parsed.issuedAt,keyId:request.headers.get(QFJ_KEY_ID_HEADER),signature:request.headers.get(QFJ_SIGNATURE_HEADER),keys,now:new Date().toISOString()});
 if(!ok)return reply(401,{error:"authentication_failed"});
 const result=await applyJarvisAarohiProjection(parsed);
 return reply(200,{protocol:QFJ_AAROHI_PROJECTION_PROTOCOL,version:1,requestId:parsed.requestId,results:result.results});
}
