import { NextResponse } from "next/server";

import {
  AGNI_PROPOSAL_PATH,
  parseAgniProposalSubmission,
} from "@/lib/agni/contracts";
import { parseQfjVerificationKeys } from "@/lib/jarvis/coreDecisionAuth";
import {
  qfjScaleHeadersForResult,
  qfjScaleHttpStatus,
  verifyQfjScaleWebRequest,
} from "@/lib/jarvis/scaleRequestGuard";
import { submitAgniProposal } from "@/services/agniGovernanceService";

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
  if(raw.byteLength<2||raw.byteLength>16_384)return reply(413,{error:"invalid_request"});

  let json:unknown;
  try{json=JSON.parse(Buffer.from(raw).toString("utf8"));}
  catch{return reply(400,{error:"invalid_request"});}
  const proposal=parseAgniProposalSubmission(json);
  if(!proposal)return reply(400,{error:"invalid_request"});

  const keys=parseQfjVerificationKeys(process.env.QF_AGNI_VERIFICATION_KEYS_JSON);
  if(!keys)return reply(503,{error:"service_unavailable"});
  const scale=verifyQfjScaleWebRequest({
    request,rawBody:raw,path:AGNI_PROPOSAL_PATH,verificationKeys:keys,nowMs:Date.now(),allowLegacy:false,
  });
  if(!scale.ok){
    return reply(qfjScaleHttpStatus(scale.errorClass),{error:"scale_contract_rejected",errorClass:scale.errorClass});
  }
  if(scale.mode!=="v1"||scale.metadata.actor!=="qf-agni-control-plane"){
    return reply(403,{error:"actor_refused"},qfjScaleHeadersForResult(scale,"QFJ_REMOTE_REFUSED"));
  }
  try{
    const result=await submitAgniProposal({
      proposal,
      traceId:scale.metadata.traceId,
      correlationId:scale.metadata.correlationId,
    });
    if(!result.ok){
      const status=result.code==="PROPOSAL_CONFLICT"?409:result.code==="PREAUTHORIZED_POLICY_REFUSED"?403:503;
      return reply(status,result,qfjScaleHeadersForResult(scale,status===503?"QFJ_UPSTREAM_UNAVAILABLE":"QFJ_REMOTE_REFUSED"));
    }
    return reply(result.status==="AUTHORIZED"?200:202,result,qfjScaleHeadersForResult(scale));
  }catch{
    return reply(503,{error:"service_unavailable"},qfjScaleHeadersForResult(scale,"QFJ_UPSTREAM_UNAVAILABLE"));
  }
}
