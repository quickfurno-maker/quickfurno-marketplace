import { NextResponse } from "next/server";

import {
  AGNI_CAPABILITY_PATH,
  parseAgniCapabilityRequest,
} from "@/lib/agni/contracts";
import { parseQfjVerificationKeys } from "@/lib/jarvis/coreDecisionAuth";
import {
  qfjScaleHeadersForResult,
  qfjScaleHttpStatus,
  verifyQfjScaleWebRequest,
} from "@/lib/jarvis/scaleRequestGuard";
import { getAgniCapability } from "@/services/agniGovernanceService";

export const runtime="nodejs";
export const dynamic="force-dynamic";

function reply(status:number,body:unknown,headers:Readonly<Record<string,string>>={}):Response{
  return NextResponse.json(body,{
    status,
    headers:{"cache-control":"no-store","x-content-type-options":"nosniff",...headers},
  });
}

export async function POST(request:Request):Promise<Response>{
  if(process.env.QF_AGNI_ENABLED?.trim().toLowerCase()!=="true"){
    return reply(503,{error:"service_unavailable"});
  }
  if(request.headers.get("content-type")?.split(";",1)[0]?.trim().toLowerCase()!=="application/json"){
    return reply(415,{error:"invalid_request"});
  }
  let raw:Uint8Array;
  try{raw=new Uint8Array(await request.arrayBuffer());}
  catch{return reply(400,{error:"invalid_request"});}
  if(raw.byteLength<2||raw.byteLength>4096)return reply(413,{error:"invalid_request"});

  let json:unknown;
  try{json=JSON.parse(Buffer.from(raw).toString("utf8"));}
  catch{return reply(400,{error:"invalid_request"});}
  const capabilityRequest=parseAgniCapabilityRequest(json);
  if(!capabilityRequest)return reply(400,{error:"invalid_request"});
  if(Math.abs(Date.now()-Date.parse(capabilityRequest.requestedAt))>60_000){
    return reply(400,{error:"stale_request"});
  }

  const keys=parseQfjVerificationKeys(process.env.QF_AGNI_VERIFICATION_KEYS_JSON);
  if(!keys)return reply(503,{error:"service_unavailable"});
  const scale=verifyQfjScaleWebRequest({
    request,rawBody:raw,path:AGNI_CAPABILITY_PATH,verificationKeys:keys,nowMs:Date.now(),allowLegacy:false,
  });
  if(!scale.ok){
    return reply(qfjScaleHttpStatus(scale.errorClass),{error:"scale_contract_rejected",errorClass:scale.errorClass});
  }
  if(scale.mode!=="v1"||scale.metadata.actor!=="qf-agni-action-broker"){
    return reply(403,{error:"actor_refused"},qfjScaleHeadersForResult(scale,"QFJ_REMOTE_REFUSED"));
  }

  const environment=process.env.QF_RUNTIME_ENV?.trim().toLowerCase();
  if(environment!=="staging"&&environment!=="production"){
    return reply(503,{error:"environment_unavailable"},qfjScaleHeadersForResult(scale,"QFJ_UPSTREAM_UNAVAILABLE"));
  }
  try{
    const result=await getAgniCapability({
      proposalId:capabilityRequest.proposalId,
      actionFingerprint:capabilityRequest.actionFingerprint,
      environment,
    });
    if(!result.ok){
      const status=result.code==="NOT_FOUND"?404
        :result.code==="NOT_AUTHORIZED"||result.code==="EXPIRED"?403
          :result.code==="FINGERPRINT_MISMATCH"?409:503;
      return reply(status,result,qfjScaleHeadersForResult(scale,status===503?"QFJ_UPSTREAM_UNAVAILABLE":"QFJ_REMOTE_REFUSED"));
    }
    return reply(200,result,qfjScaleHeadersForResult(scale));
  }catch{
    return reply(503,{error:"service_unavailable"},qfjScaleHeadersForResult(scale,"QFJ_UPSTREAM_UNAVAILABLE"));
  }
}
