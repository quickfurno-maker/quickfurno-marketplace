import { NextResponse } from "next/server";
import { parseQfjVerificationKeys } from "@/lib/jarvis/coreDecisionAuth";
import {
  QFJ_AAROHI_RUNTIME_PATH,
  QFJ_AAROHI_RUNTIME_PROTOCOL,
  QFJ_AAROHI_RUNTIME_SIGNING_DOMAIN,
  parseQfjAarohiRuntimeContextRequest,
} from "@/lib/jarvis/aarohiRuntimeContract";
import {
  QFJ_KEY_ID_HEADER,
  QFJ_SIGNATURE_HEADER,
  verifyQfjSignedRequestSignature,
} from "@/lib/jarvis/signedRequestAuth";
import { readAarohiRuntimeContext } from "@/services/jarvisAarohiRuntimeContextService";

export const runtime="nodejs";
export const dynamic="force-dynamic";
const MAX_BODY_BYTES=8_192;
const reply=(status:number,body:unknown)=>NextResponse.json(body,{status,headers:{"cache-control":"no-store"}});

export async function POST(request:Request):Promise<Response>{
  if(process.env.QF_JARVIS_AAROHI_RUNTIME_ENABLED?.trim().toLowerCase()!=="true"){
    return reply(503,{error:"service_unavailable"});
  }
  let raw:Uint8Array;
  try{raw=new Uint8Array(await request.arrayBuffer());}catch{return reply(400,{error:"invalid_request"});}
  if(raw.byteLength<2||raw.byteLength>MAX_BODY_BYTES)return reply(413,{error:"invalid_request"});
  let decoded:unknown;
  try{decoded=JSON.parse(Buffer.from(raw).toString("utf8"));}catch{return reply(400,{error:"invalid_request"});}
  const parsed=parseQfjAarohiRuntimeContextRequest(decoded);
  if(!parsed)return reply(400,{error:"invalid_request"});

  const keys=parseQfjVerificationKeys(process.env.QF_JARVIS_CORE_VERIFICATION_KEYS_JSON);
  if(!keys)return reply(503,{error:"service_unavailable"});
  const verified=verifyQfjSignedRequestSignature({
    rawBody:raw,
    domain:QFJ_AAROHI_RUNTIME_SIGNING_DOMAIN,
    path:QFJ_AAROHI_RUNTIME_PATH,
    requestId:parsed.requestId,
    issuedAt:parsed.issuedAt,
    keyId:request.headers.get(QFJ_KEY_ID_HEADER),
    signature:request.headers.get(QFJ_SIGNATURE_HEADER),
    keys,
    now:new Date().toISOString(),
  });
  if(!verified)return reply(401,{error:"authentication_failed"});

  const result=await readAarohiRuntimeContext({
    conversationId:parsed.conversationId,
    revision:parsed.revision,
  });
  if(!result.ok){
    const status=result.reason==="stale_revision"?409:result.reason==="not_ready"?404:503;
    return reply(status,{
      protocol:QFJ_AAROHI_RUNTIME_PROTOCOL,
      version:1,
      requestId:parsed.requestId,
      status:result.reason,
    });
  }
  return reply(200,{
    protocol:QFJ_AAROHI_RUNTIME_PROTOCOL,
    version:1,
    requestId:parsed.requestId,
    status:"ready",
    input:result.input,
  });
}
