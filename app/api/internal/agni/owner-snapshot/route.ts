import { NextResponse } from "next/server";

import {
  AGNI_OWNER_ACTOR,
  AGNI_OWNER_SNAPSHOT_PATH,
  parseAgniOwnerSnapshotRequest,
} from "@/lib/agni/ownerContract";
import { parseQfjVerificationKeys } from "@/lib/jarvis/coreDecisionAuth";
import {
  qfjScaleHeadersForResult,
  qfjScaleHttpStatus,
  verifyQfjScaleWebRequest,
} from "@/lib/jarvis/scaleRequestGuard";
import { getAgniOwnerQuickFurnoSnapshot } from "@/services/agniOwnerSnapshotService";

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
  if(raw.byteLength<2||raw.byteLength>4096)return reply(413,{error:"invalid_request"});

  let decoded:unknown;
  try{decoded=JSON.parse(Buffer.from(raw).toString("utf8"));}
  catch{return reply(400,{error:"invalid_request"});}
  if(!parseAgniOwnerSnapshotRequest(decoded))return reply(400,{error:"invalid_request"});

  const keys=parseQfjVerificationKeys(process.env.QF_AGNI_VERIFICATION_KEYS_JSON);
  if(!keys)return reply(503,{error:"service_unavailable"});
  const verified=verifyQfjScaleWebRequest({
    request,rawBody:raw,path:AGNI_OWNER_SNAPSHOT_PATH,verificationKeys:keys,nowMs:Date.now(),allowLegacy:false,
  });
  if(!verified.ok){
    return reply(qfjScaleHttpStatus(verified.errorClass),{error:"scale_contract_rejected",errorClass:verified.errorClass});
  }
  if(verified.mode!=="v1"||verified.metadata.actor!==AGNI_OWNER_ACTOR){
    return reply(403,{error:"actor_refused"},qfjScaleHeadersForResult(verified,"QFJ_REMOTE_REFUSED"));
  }

  try{
    return reply(200,await getAgniOwnerQuickFurnoSnapshot(),qfjScaleHeadersForResult(verified));
  }catch{
    return reply(503,{error:"service_unavailable"},qfjScaleHeadersForResult(verified,"QFJ_UPSTREAM_UNAVAILABLE"));
  }
}
