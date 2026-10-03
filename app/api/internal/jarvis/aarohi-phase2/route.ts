import { NextResponse } from "next/server";
import { parseQfjVerificationKeys } from "@/lib/jarvis/coreDecisionAuth";
import {
  QFJ_KEY_ID_HEADER,
  QFJ_SIGNATURE_HEADER,
  verifyQfjSignedRequestSignature,
} from "@/lib/jarvis/signedRequestAuth";
import {
  QFJ_AAROHI_PHASE2_PATH,
  QFJ_AAROHI_PHASE2_PROTOCOL,
  QFJ_AAROHI_PHASE2_SIGNING_DOMAIN,
  QFJ_AAROHI_PHASE2_VERSION,
  parseQfjAarohiPhase2Request,
} from "@/lib/jarvis/aarohiPhase2Contract";
import {
  claimAarohiDiscoveryRun,
  claimAarohiSocialOutreach,
  completeAarohiDiscoveryRun,
  completeAarohiSocialOutreach,
  ingestAarohiDiscoveryCandidate,
  recordAarohiSocialReply,
} from "@/services/aarohiPhase2AcquisitionService";

export const runtime="nodejs";
export const dynamic="force-dynamic";
const MAX_BODY_BYTES=131_072;
const reply=(status:number,body:unknown)=>NextResponse.json(body,{
  status,headers:{"cache-control":"no-store"},
});

export async function POST(request:Request):Promise<Response>{
  if(process.env.QF_JARVIS_AAROHI_PHASE2_ENABLED?.trim().toLowerCase()!=="true"){
    return reply(503,{error:"service_unavailable"});
  }
  let raw:Uint8Array;
  try{raw=new Uint8Array(await request.arrayBuffer());}
  catch{return reply(400,{error:"invalid_request"});}
  if(raw.byteLength<2||raw.byteLength>MAX_BODY_BYTES) return reply(413,{error:"invalid_request"});

  let decoded:unknown;
  try{decoded=JSON.parse(Buffer.from(raw).toString("utf8"));}
  catch{return reply(400,{error:"invalid_request"});}
  const parsed=parseQfjAarohiPhase2Request(decoded);
  if(!parsed) return reply(400,{error:"invalid_request"});

  const keys=parseQfjVerificationKeys(process.env.QF_JARVIS_CORE_VERIFICATION_KEYS_JSON);
  if(!keys) return reply(503,{error:"service_unavailable"});
  const authenticated=verifyQfjSignedRequestSignature({
    rawBody:raw,
    domain:QFJ_AAROHI_PHASE2_SIGNING_DOMAIN,
    path:QFJ_AAROHI_PHASE2_PATH,
    requestId:parsed.requestId,
    issuedAt:parsed.issuedAt,
    keyId:request.headers.get(QFJ_KEY_ID_HEADER),
    signature:request.headers.get(QFJ_SIGNATURE_HEADER),
    keys,
    now:new Date().toISOString(),
  });
  if(!authenticated) return reply(401,{error:"authentication_failed"});

  try{
    const operation=parsed.operation;
    if(operation.kind==="CLAIM_DISCOVERY_RUN"){
      const run=await claimAarohiDiscoveryRun(String(operation.payload.workerRef));
      return reply(200,{
        protocol:QFJ_AAROHI_PHASE2_PROTOCOL,version:QFJ_AAROHI_PHASE2_VERSION,
        requestId:parsed.requestId,status:run?"claimed":"idle",run,
      });
    }
    if(operation.kind==="SUBMIT_DISCOVERY_CANDIDATES"){
      const candidateIds:string[]=[];
      for(const rawCandidate of operation.payload.candidates as Record<string,unknown>[]){
        const candidate=await ingestAarohiDiscoveryCandidate({
          runId:String(operation.payload.runId),
          connectorId:String(operation.payload.connectorId),
          sourceType:String(rawCandidate.sourceType) as any,
          externalReference:String(rawCandidate.externalReference),
          profileUrl:rawCandidate.profileUrl==null?null:String(rawCandidate.profileUrl),
          businessName:String(rawCandidate.businessName),
          cityHint:rawCandidate.cityHint==null?null:String(rawCandidate.cityHint),
          categoryHint:rawCandidate.categoryHint==null?null:String(rawCandidate.categoryHint),
          website:rawCandidate.website==null?null:String(rawCandidate.website),
          phoneE164:rawCandidate.phoneE164==null?null:String(rawCandidate.phoneE164),
          email:rawCandidate.email==null?null:String(rawCandidate.email),
          confidence:typeof rawCandidate.confidence==="number"?rawCandidate.confidence:0,
          metadata:rawCandidate.metadata as Record<string,unknown>|undefined,
          observedAt:rawCandidate.observedAt==null?null:String(rawCandidate.observedAt),
        });
        candidateIds.push(String(candidate.id));
      }
      return reply(200,{
        protocol:QFJ_AAROHI_PHASE2_PROTOCOL,version:QFJ_AAROHI_PHASE2_VERSION,
        requestId:parsed.requestId,status:"accepted",candidateIds,
      });
    }
    if(operation.kind==="CLAIM_SOCIAL_OUTREACH"){
      const job=await claimAarohiSocialOutreach(String(operation.payload.workerRef));
      return reply(200,{
        protocol:QFJ_AAROHI_PHASE2_PROTOCOL,version:QFJ_AAROHI_PHASE2_VERSION,
        requestId:parsed.requestId,status:job?"claimed":"idle",job,
      });
    }
    if(operation.kind==="COMPLETE_SOCIAL_OUTREACH"){
      const job=await completeAarohiSocialOutreach({
        jobId:String(operation.payload.jobId),
        executionToken:String(operation.payload.executionToken),
        outcome:String(operation.payload.outcome) as "ACCEPTED"|"DEFINITIVE_FAILURE"|"UNCERTAIN",
        providerMessageRef:operation.payload.providerMessageRef==null?null:String(operation.payload.providerMessageRef),
        errorCode:operation.payload.errorCode==null?null:String(operation.payload.errorCode),
      });
      return reply(200,{
        protocol:QFJ_AAROHI_PHASE2_PROTOCOL,version:QFJ_AAROHI_PHASE2_VERSION,
        requestId:parsed.requestId,status:"recorded",job,
      });
    }
    if(operation.kind==="COMPLETE_DISCOVERY_RUN"){
      await completeAarohiDiscoveryRun({
        runId:String(operation.payload.runId),
        state:String(operation.payload.state) as "COMPLETED"|"PARTIAL"|"FAILED"|"CANCELLED",
        candidateCount:Number(operation.payload.candidateCount),
        promotedCount:Number(operation.payload.promotedCount),
        errorCode:operation.payload.errorCode==null?null:String(operation.payload.errorCode),
      });
      return reply(200,{
        protocol:QFJ_AAROHI_PHASE2_PROTOCOL,version:QFJ_AAROHI_PHASE2_VERSION,
        requestId:parsed.requestId,status:"recorded",
      });
    }
    const result=await recordAarohiSocialReply({
      prospectId:String(operation.payload.prospectId),
      channel:String(operation.payload.channel) as "INSTAGRAM"|"FACEBOOK"|"X",
      threadRef:String(operation.payload.threadRef),
      messageRef:String(operation.payload.messageRef),
      replyKind:String(operation.payload.replyKind) as "INTERESTED"|"WHATSAPP_SHARED"|"STOP"|"OTHER",
      safeSummary:String(operation.payload.safeSummary),
      occurredAt:String(operation.payload.occurredAt),
      phoneE164:operation.payload.phoneE164==null?null:String(operation.payload.phoneE164),
    });
    return reply(200,{
      protocol:QFJ_AAROHI_PHASE2_PROTOCOL,version:QFJ_AAROHI_PHASE2_VERSION,
      requestId:parsed.requestId,status:"recorded",result,
    });
  }catch(error){
    const code=error instanceof Error?error.message.slice(0,160):"aarohi_phase2_operation_failed";
    return reply(409,{
      protocol:QFJ_AAROHI_PHASE2_PROTOCOL,version:QFJ_AAROHI_PHASE2_VERSION,
      requestId:parsed.requestId,status:"refused",code,
    });
  }
}
