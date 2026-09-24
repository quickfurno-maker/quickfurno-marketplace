import { NextResponse } from "next/server";

import { parseQfjVerificationKeys } from "@/lib/jarvis/coreDecisionAuth";
import { verifyQfjOperatorCommandSignature } from "@/lib/jarvis/operatorCommandAuth";
import {
  parseQfjOperatorCommand,
  QFJ_OPERATOR_COMMAND_OPERATOR_ID_HEADER,
} from "@/lib/jarvis/operatorCommandContract";
import { QFJ_KEY_ID_HEADER,QFJ_SIGNATURE_HEADER } from "@/lib/jarvis/signedRequestAuth";
import { executeJarvisOperatorCommand } from "@/services/jarvisOperatorCommandService";

export const runtime="nodejs";
export const dynamic="force-dynamic";

const reply=(status:number,body:unknown)=>NextResponse.json(body,{
  status,
  headers:{"cache-control":"no-store","x-content-type-options":"nosniff"},
});

export async function POST(request:Request):Promise<Response>{
  if(process.env.QF_JARVIS_OS_COMMANDS_ENABLED?.trim().toLowerCase()!=="true"){
    return reply(503,{error:"service_unavailable"});
  }

  let raw:Uint8Array;
  try{raw=new Uint8Array(await request.arrayBuffer());}
  catch{return reply(400,{error:"invalid_request"});}
  if(raw.byteLength<2||raw.byteLength>16_384)return reply(413,{error:"invalid_request"});

  let json:unknown;
  try{json=JSON.parse(Buffer.from(raw).toString("utf8"));}
  catch{return reply(400,{error:"invalid_request"});}
  const command=parseQfjOperatorCommand(json);
  if(!command)return reply(400,{error:"invalid_request"});

  const keys=parseQfjVerificationKeys(process.env.QF_JARVIS_OS_COMMAND_VERIFICATION_KEYS_JSON);
  if(!keys)return reply(503,{error:"service_unavailable"});
  const operatorId=request.headers.get(QFJ_OPERATOR_COMMAND_OPERATOR_ID_HEADER);
  const verified=verifyQfjOperatorCommandSignature({
    rawBody:raw,
    command,
    keyId:request.headers.get(QFJ_KEY_ID_HEADER),
    signature:request.headers.get(QFJ_SIGNATURE_HEADER),
    operatorId,
    keys,
    now:new Date().toISOString(),
  });
  if(!verified)return reply(401,{error:"authentication_failed"});

  try{
    const result=await executeJarvisOperatorCommand({
      command,
      rawBody:raw,
      operatorId:operatorId!,
    });
    const status=result.status==="APPLIED_BY_AUTHORITY"?200
      :result.status==="SUBMITTED_TO_AUTHORITY"?202
        :result.status==="CONFLICT"?409
          :result.status==="REFUSED"?403:503;
    return reply(status,result);
  }catch{
    return reply(503,{error:"service_unavailable"});
  }
}
