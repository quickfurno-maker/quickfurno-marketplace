import { NextResponse } from "next/server";

import { parseQfjVerificationKeys } from "@/lib/jarvis/coreDecisionAuth";
import {
  QFJ_AOS_MARKET_CAPACITY_PATH,
  QFJ_AOS_MARKET_CAPACITY_PROTOCOL,
  QFJ_AOS_MARKET_CAPACITY_SIGNING_DOMAIN,
  parseQfjAosMarketCapacityRequest,
} from "@/lib/jarvis/aosMarketCapacityContract";
import {
  QFJ_KEY_ID_HEADER,
  QFJ_SIGNATURE_HEADER,
  verifyQfjSignedRequestSignature,
} from "@/lib/jarvis/signedRequestAuth";
import { resolveQfJarvisRuntimePolicy } from "@/lib/jarvis/runtimePolicy";
import { readAosMarketCapacitySnapshot } from "@/services/aosMarketCapacitySnapshotService";

export const runtime="nodejs";
export const dynamic="force-dynamic";

const reply=(status:number,body:unknown)=>NextResponse.json(body,{
  status,
  headers:{
    "cache-control":"no-store, private",
    "x-content-type-options":"nosniff",
  },
});

export async function POST(request:Request):Promise<Response>{
  let raw:Uint8Array;
  try{raw=new Uint8Array(await request.arrayBuffer());}
  catch{return reply(400,{error:"invalid_request"});}
  if(raw.byteLength<2||raw.byteLength>4096)return reply(413,{error:"invalid_request"});

  let json:unknown;
  try{json=JSON.parse(Buffer.from(raw).toString("utf8"));}
  catch{return reply(400,{error:"invalid_request"});}
  const parsed=parseQfjAosMarketCapacityRequest(json);
  if(!parsed)return reply(400,{error:"invalid_request"});

  const policy=resolveQfJarvisRuntimePolicy();
  if(policy.mode==="off")return reply(503,{error:"service_unavailable"});

  const expectedTenant=process.env.QF_JARVIS_TENANT_ID?.trim();
  if(!expectedTenant||parsed.tenantId!==expectedTenant)return reply(403,{error:"scope_refused"});

  const keys=parseQfjVerificationKeys(process.env.QF_JARVIS_CORE_VERIFICATION_KEYS_JSON);
  if(!keys)return reply(503,{error:"service_unavailable"});
  const verified=verifyQfjSignedRequestSignature({
    rawBody:raw,
    domain:QFJ_AOS_MARKET_CAPACITY_SIGNING_DOMAIN,
    path:QFJ_AOS_MARKET_CAPACITY_PATH,
    requestId:parsed.requestId,
    issuedAt:parsed.issuedAt,
    keyId:request.headers.get(QFJ_KEY_ID_HEADER),
    signature:request.headers.get(QFJ_SIGNATURE_HEADER),
    keys,
    requestHeaders:request.headers,
    now:new Date().toISOString(),
  });
  if(!verified)return reply(401,{error:"authentication_failed"});

  try{
    const snapshot=await readAosMarketCapacitySnapshot();
    return reply(200,{
      protocol:QFJ_AOS_MARKET_CAPACITY_PROTOCOL,
      version:1,
      requestId:parsed.requestId,
      snapshot,
    });
  }catch{
    return reply(503,{error:"service_unavailable"});
  }
}
