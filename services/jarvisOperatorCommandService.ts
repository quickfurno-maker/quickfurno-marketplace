import "server-only";

import { createHash } from "node:crypto";

import { adminClient } from "@/lib/supabase";
import {
  QFJ_OPERATOR_COMMAND_PROTOCOL,
  parseQfjOperatorCommandResult,
  type QfjOperatorCommand,
  type QfjOperatorCommandResult,
} from "@/lib/jarvis/operatorCommandContract";
import {
  authorizeAutomationActionRequest,
  rejectAutomationActionRequest,
} from "@/services/automationPersistenceService";
import { releaseHumanConversationToAi } from "@/services/conversationalWhatsAppService";

const OPERATOR_ID=/^[A-Za-z0-9._:-]{1,64}$/;

function result(commandId:string,status:QfjOperatorCommandResult["status"],reasonCode:string):QfjOperatorCommandResult{
  const parsed=parseQfjOperatorCommandResult({
    protocol:QFJ_OPERATOR_COMMAND_PROTOCOL,
    commandId,
    status,
    jarvisAuthorized:false,
    reasonCode,
  });
  if(!parsed)throw new Error("OPERATOR_COMMAND_RESULT_INVALID");
  return parsed;
}

function operatorActorId(operatorId:string):string|null{
  return OPERATOR_ID.test(operatorId) ? `jarvis-os:${operatorId}` : null;
}

type ReceiptClaim=
  | {readonly kind:"CLAIMED"}
  | {readonly kind:"FINAL";readonly result:QfjOperatorCommandResult}
  | {readonly kind:"CONFLICT";readonly reason:string}
  | {readonly kind:"UNAVAILABLE"};

async function claimReceipt(command:QfjOperatorCommand,rawBody:Uint8Array):Promise<ReceiptClaim>{
  const requestDigest=createHash("sha256").update(rawBody).digest("hex");
  const db=adminClient();
  const inserted=await db.from("jarvis_os_operator_command_receipts").insert({
    command_id:command.commandId,
    idempotency_key:command.idempotencyKey,
    request_digest:requestDigest,
    action:command.action,
    state:"CLAIMED",
  });
  if(!inserted.error)return {kind:"CLAIMED"};
  if(inserted.error.code!=="23505")return {kind:"UNAVAILABLE"};

  const prior=await db.from("jarvis_os_operator_command_receipts")
    .select("command_id,idempotency_key,request_digest,state,result_status,reason_code")
    .or("command_id.eq."+command.commandId+",idempotency_key.eq."+command.idempotencyKey)
    .limit(2);
  if(prior.error||!prior.data?.length)return {kind:"UNAVAILABLE"};
  const row=prior.data.find((candidate:any)=>
    String(candidate.command_id)===command.commandId ||
    String(candidate.idempotency_key)===command.idempotencyKey
  ) as Record<string,unknown>|undefined;
  if(!row)return {kind:"UNAVAILABLE"};
  if(
    String(row.command_id)!==command.commandId||
    String(row.idempotency_key)!==command.idempotencyKey||
    String(row.request_digest)!==requestDigest
  )return {kind:"CONFLICT",reason:"COMMAND_REPLAY_CONFLICT"};
  if(row.state==="FINALIZED"&&typeof row.result_status==="string"&&typeof row.reason_code==="string"){
    return {kind:"FINAL",result:result(command.commandId,row.result_status as QfjOperatorCommandResult["status"],row.reason_code)};
  }
  return {kind:"CONFLICT",reason:"COMMAND_INDETERMINATE"};
}

async function finalizeReceipt(commandId:string,outcome:QfjOperatorCommandResult):Promise<boolean>{
  const updated=await adminClient().from("jarvis_os_operator_command_receipts").update({
    state:"FINALIZED",
    result_status:outcome.status,
    reason_code:outcome.reasonCode,
    finalized_at:new Date().toISOString(),
  }).eq("command_id",commandId).eq("state","CLAIMED").select("command_id");
  return !updated.error&&Array.isArray(updated.data)&&updated.data.length===1;
}

async function decideApproval(
  command:Extract<QfjOperatorCommand,{action:"APPROVAL_DECIDE"}>,
  actorId:string,
):Promise<QfjOperatorCommandResult>{
  const current=await adminClient().from("automation_action_requests")
    .select("id,decision_status").eq("id",command.payload.approvalId).maybeSingle();
  if(current.error)return result(command.commandId,"UNAVAILABLE","APPROVAL_READ_FAILED");
  if(!current.data)return result(command.commandId,"REFUSED","APPROVAL_NOT_FOUND");
  if(current.data.decision_status!=="requested")return result(command.commandId,"CONFLICT","APPROVAL_ALREADY_DECIDED");
  try{
    if(command.payload.decision==="APPROVE"){
      await authorizeAutomationActionRequest({
        requestId:command.payload.approvalId,
        authorizationId:command.commandId,
        authorizedBy:{actorType:"admin_user",actorId},
        reasonCode:"JARVIS_OS_OPERATOR_APPROVED",
      });
    }else{
      await rejectAutomationActionRequest({
        requestId:command.payload.approvalId,
        decisionId:command.commandId,
        rejectedBy:{actorType:"admin_user",actorId},
        reasonCode:"JARVIS_OS_OPERATOR_REJECTED",
      });
    }
    return result(command.commandId,"APPLIED_BY_AUTHORITY","CORE_DECISION_APPLIED");
  }catch{
    return result(command.commandId,"UNAVAILABLE","CORE_DECISION_FAILED");
  }
}

async function takeOverConversation(
  command:Extract<QfjOperatorCommand,{action:"CONVERSATION_TAKEOVER"}>,
  actorId:string,
):Promise<QfjOperatorCommandResult>{
  const revision=command.payload.expectedRevision+1;
  const updated=await adminClient().from("communication_conversations").update({
    assigned_actor:"HUMAN",
    state:"HUMAN",
    human_takeover:true,
    jarvis_enabled:false,
    revision,
    updated_at:new Date().toISOString(),
  }).eq("id",command.payload.conversationId)
    .eq("revision",command.payload.expectedRevision)
    .eq("human_takeover",false)
    .in("state",["OPEN","PAUSED"])
    .in("assigned_actor",["RIYA","ANISHA","AAROHI"])
    .select("id");
  if(updated.error)return result(command.commandId,"UNAVAILABLE","CONVERSATION_UPDATE_FAILED");
  if(!updated.data?.length)return result(command.commandId,"CONFLICT","CONVERSATION_STATE_CHANGED");
  await adminClient().from("communication_conversation_events").insert({
    conversation_id:command.payload.conversationId,
    event_type:"human.takeover_started",
    actor_type:"HUMAN",
    safe_summary:"A QuickFurno operator took over the conversation from Jarvis OS.",
    event_data:{operatorUserId:actorId,revision},
  });
  return result(command.commandId,"APPLIED_BY_AUTHORITY","CORE_TAKEOVER_APPLIED");
}

async function pauseConversation(
  command:Extract<QfjOperatorCommand,{action:"CONVERSATION_PAUSE_AI"}>,
  actorId:string,
):Promise<QfjOperatorCommandResult>{
  const revision=command.payload.expectedRevision+1;
  const updated=await adminClient().from("communication_conversations").update({
    state:"PAUSED",
    jarvis_enabled:false,
    revision,
    updated_at:new Date().toISOString(),
  }).eq("id",command.payload.conversationId)
    .eq("revision",command.payload.expectedRevision)
    .eq("state","OPEN")
    .eq("human_takeover",false)
    .in("assigned_actor",["RIYA","ANISHA","AAROHI"])
    .select("id");
  if(updated.error)return result(command.commandId,"UNAVAILABLE","CONVERSATION_UPDATE_FAILED");
  if(!updated.data?.length)return result(command.commandId,"CONFLICT","CONVERSATION_STATE_CHANGED");
  await adminClient().from("communication_conversation_events").insert({
    conversation_id:command.payload.conversationId,
    event_type:"ai.paused_by_operator",
    actor_type:"HUMAN",
    safe_summary:"A QuickFurno operator paused AI handling from Jarvis OS.",
    event_data:{operatorUserId:actorId,revision},
  });
  return result(command.commandId,"APPLIED_BY_AUTHORITY","CORE_PAUSE_APPLIED");
}

async function resumeConversation(
  command:Extract<QfjOperatorCommand,{action:"CONVERSATION_RESUME_AI"}>,
  actorId:string,
):Promise<QfjOperatorCommandResult>{
  try{
    const current=await adminClient().from("communication_conversations")
      .select("id,state,human_takeover,assigned_actor,revision")
      .eq("id",command.payload.conversationId).maybeSingle();
    if(current.error)return result(command.commandId,"UNAVAILABLE","CONVERSATION_READ_FAILED");
    if(!current.data)return result(command.commandId,"REFUSED","CONVERSATION_NOT_FOUND");
    if(Number(current.data.revision)!==command.payload.expectedRevision){
      return result(command.commandId,"CONFLICT","CONVERSATION_STATE_CHANGED");
    }

    if(current.data.state==="HUMAN"&&current.data.human_takeover===true){
      const resumed=await releaseHumanConversationToAi({
        conversationId:command.payload.conversationId,
        expectedRevision:command.payload.expectedRevision,
        operatorUserId:actorId,
      });
      if(!resumed.ok){
        return result(
          command.commandId,
          resumed.reason==="stale_revision"?"CONFLICT":"REFUSED",
          resumed.reason==="stale_revision"?"CONVERSATION_STATE_CHANGED":"CONVERSATION_RESUME_REFUSED",
        );
      }
      return result(command.commandId,"APPLIED_BY_AUTHORITY","CORE_RESUME_APPLIED");
    }

    if(
      current.data.state!=="PAUSED"||
      current.data.human_takeover===true||
      !["RIYA","ANISHA","AAROHI"].includes(String(current.data.assigned_actor))
    ){
      return result(command.commandId,"REFUSED","CONVERSATION_RESUME_REFUSED");
    }

    const revision=command.payload.expectedRevision+1;
    const updated=await adminClient().from("communication_conversations").update({
      state:"OPEN",
      jarvis_enabled:true,
      revision,
      updated_at:new Date().toISOString(),
    }).eq("id",command.payload.conversationId)
      .eq("revision",command.payload.expectedRevision)
      .eq("state","PAUSED")
      .eq("human_takeover",false)
      .select("id");
    if(updated.error)return result(command.commandId,"UNAVAILABLE","CONVERSATION_UPDATE_FAILED");
    if(!updated.data?.length)return result(command.commandId,"CONFLICT","CONVERSATION_STATE_CHANGED");

    await adminClient().from("communication_conversation_events").insert({
      conversation_id:command.payload.conversationId,
      event_type:"ai.resumed_by_operator",
      actor_type:"HUMAN",
      safe_summary:"A QuickFurno operator resumed AI handling from Jarvis OS.",
      event_data:{operatorUserId:actorId,revision},
    });
    return result(command.commandId,"APPLIED_BY_AUTHORITY","CORE_RESUME_APPLIED");
  }catch{
    return result(command.commandId,"UNAVAILABLE","CONVERSATION_RESUME_FAILED");
  }
}

export async function executeJarvisOperatorCommand(args:{
  readonly command:QfjOperatorCommand;
  readonly rawBody:Uint8Array;
  readonly operatorId:string;
}):Promise<QfjOperatorCommandResult>{
  const actorId=operatorActorId(args.operatorId);
  if(!actorId)return result(args.command.commandId,"UNAVAILABLE","OPERATOR_ACTOR_UNCONFIGURED");

  const claim=await claimReceipt(args.command,args.rawBody);
  if(claim.kind==="FINAL")return claim.result;
  if(claim.kind==="CONFLICT")return result(args.command.commandId,"CONFLICT",claim.reason);
  if(claim.kind==="UNAVAILABLE")return result(args.command.commandId,"UNAVAILABLE","COMMAND_RECEIPT_UNAVAILABLE");

  let outcome:QfjOperatorCommandResult;
  if(args.command.action==="APPROVAL_DECIDE")outcome=await decideApproval(args.command,actorId);
  else if(args.command.action==="CONVERSATION_TAKEOVER")outcome=await takeOverConversation(args.command,actorId);
  else if(args.command.action==="CONVERSATION_PAUSE_AI")outcome=await pauseConversation(args.command,actorId);
  else outcome=await resumeConversation(args.command,actorId);

  if(!(await finalizeReceipt(args.command.commandId,outcome))){
    return result(args.command.commandId,"UNAVAILABLE","COMMAND_RESULT_INDETERMINATE");
  }
  return outcome;
}
