import { NextResponse } from "next/server";

import {
  AGNI_OWNER_ACTOR,
  AGNI_OWNER_APPROVAL_PATH,
  AGNI_OWNER_APPROVAL_RESPONSE_PROTOCOL,
  parseAgniOwnerApprovalRequest,
} from "@/lib/agni/ownerContract";
import { parseQfjVerificationKeys } from "@/lib/jarvis/coreDecisionAuth";
import {
  qfjScaleHeadersForResult,
  qfjScaleHttpStatus,
  verifyQfjScaleWebRequest,
} from "@/lib/jarvis/scaleRequestGuard";
import { decideAgniProposal } from "@/services/agniGovernanceService";

export const runtime="nodejs";
export const dynamic="force-dynamic";

function reply(status:number,body:unknown,headers:Readonly<Record<string,string>>={}):Response{
  return NextResponse.json(body,{status,headers:{
    "cache-control":"no-store, private",
    "x-content-type-options":"nosniff",
    ...headers,
  }});
}

export async function POST(request:Request):Promise<Response>{
  if(request.headers.get("content-type")?.split(";",1)[0]?.trim().toLowerCase()!=="application/json"){
    return reply(415,{error:"invalid_request"});
  }
  let raw:Uint8Array;
  try{raw=new Uint8Array(await request.arrayBuffer());}
  catch{return reply(400,{error:"invalid_request"});}
  if(raw.byteLength<2||raw.byteLength>8192)return reply(413,{error:"invalid_request"});

  let decoded:unknown;
  try{decoded=JSON.parse(Buffer.from(raw).toString("utf8"));}
  catch{return reply(400,{error:"invalid_request"});}
  const command=parseAgniOwnerApprovalRequest(decoded);
  if(!command)return reply(400,{error:"invalid_request"});

  const keys=parseQfjVerificationKeys(process.env.QF_AGNI_VERIFICATION_KEYS_JSON);
  if(!keys)return reply(503,{error:"service_unavailable"});
  const verified=verifyQfjScaleWebRequest({
    request,rawBody:raw,path:AGNI_OWNER_APPROVAL_PATH,verificationKeys:keys,nowMs:Date.now(),allowLegacy:false,
  });
  if(!verified.ok){
    return reply(qfjScaleHttpStatus(verified.errorClass),{error:"scale_contract_rejected",errorClass:verified.errorClass});
  }
  if(verified.mode!=="v1"||verified.metadata.actor!==AGNI_OWNER_ACTOR){
    return reply(403,{error:"actor_refused"},qfjScaleHeadersForResult(verified,"QFJ_REMOTE_REFUSED"));
  }

  try{
    const result=await decideAgniProposal({
      proposalId:command.proposalId,
      actionFingerprint:command.actionFingerprint,
      decision:command.decision,
      decisionId:command.decisionId,
      operatorRef:"agni-owner:"+command.ownerRef,
    });
    if(result.ok){
      return reply(200,{
        protocol:AGNI_OWNER_APPROVAL_RESPONSE_PROTOCOL,
        status:result.status,
        proposalId:command.proposalId,
      },qfjScaleHeadersForResult(verified));
    }
    const status=result.code==="NOT_FOUND"?404
      :result.code==="ALREADY_DECIDED"||result.code==="EXPIRED"||result.code==="FINGERPRINT_MISMATCH"?409
        :503;
    return reply(status,{
      protocol:AGNI_OWNER_APPROVAL_RESPONSE_PROTOCOL,
      status:"REFUSED",
      reasonCode:result.code,
      proposalId:command.proposalId,
    },qfjScaleHeadersForResult(verified,status===503?"QFJ_UPSTREAM_UNAVAILABLE":"QFJ_REMOTE_REFUSED"));
  }catch{
    return reply(503,{error:"service_unavailable"},qfjScaleHeadersForResult(verified,"QFJ_UPSTREAM_UNAVAILABLE"));
  }
}
