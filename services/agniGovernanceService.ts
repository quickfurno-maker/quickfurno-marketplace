import "server-only";

import { readFile } from "node:fs/promises";
import { isAbsolute } from "node:path";
import crypto from "node:crypto";
import { z } from "zod";

import { adminClient } from "@/lib/supabase";
import {
  AGNI_CAPABILITY_PROTOCOL,
  AGNI_PROPOSAL_PROTOCOL,
  type AgniCapability,
  type AgniProposal,
  signAgniCapability,
  type SignedAgniCapability,
} from "@/lib/agni/contracts";

const MACHINE=/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}$/;
const signingKeySchema=z.object({
  keyId:z.string().min(1).max(64).regex(/^[A-Za-z0-9._:-]+$/),
  privateKeyPem:z.string().min(80).max(8192),
}).strict();

type ProposalRow=Readonly<{
  id:string;
  incident_id:string;
  target_system:"QUICKFURNO"|"JARVIS";
  target_service:string;
  action_type:AgniProposal["action"]["type"];
  action_payload:AgniProposal["action"];
  action_fingerprint:string;
  risk:AgniProposal["risk"];
  requested_approval_mode:AgniProposal["requestedApprovalMode"];
  expected_revision:number|null;
  evidence_refs:string[];
  expected_effect_code:string;
  rollback_code:string;
  source_trace_id:string;
  source_correlation_id:string;
  decision_status:"requested"|"authorized"|"rejected";
  decision_id:string|null;
  decision_at:string|null;
  decision_actor_id:string|null;
  decision_reason_code:string|null;
  policy_evidence_ref:string|null;
  critic_evidence_ref:string|null;
  capability_id:string|null;
  capability_nonce:string|null;
  capability_issued_at:string|null;
  capability_expires_at:string|null;
  created_at:string;
  expires_at:string;
}>;

function db(){return adminClient();}

function humanRef(value:string):string{
  if(!MACHINE.test(value))throw new Error("AGNI_OPERATOR_REF_INVALID");
  return value;
}

function machineRef(value:string,label:string):string{
  if(!MACHINE.test(value))throw new Error(label);
  return value;
}

function preauthorizedRateLimit(proposal:AgniProposal):{
  policyEvidenceRef:string;
  criticEvidenceRef:string;
}|null{
  if(proposal.requestedApprovalMode!=="PREAUTHORIZED_POLICY")return null;
  if(proposal.action.type!=="TEMPORARY_RATE_LIMIT")return null;
  const enabled=process.env.QF_AGNI_PREAUTHORIZED_RATE_LIMIT_ENABLED?.trim().toLowerCase()==="true";
  const configuredRef=process.env.QF_AGNI_PREAUTHORIZED_RATE_LIMIT_POLICY_REF?.trim()??"";
  const maxSeconds=Number(process.env.QF_AGNI_PREAUTHORIZED_RATE_LIMIT_MAX_SECONDS??"0");
  if(
    !enabled||
    !MACHINE.test(configuredRef)||
    !Number.isSafeInteger(maxSeconds)||
    maxSeconds<60||
    maxSeconds>600||
    proposal.action.durationSeconds>maxSeconds
  )return null;
  return {
    policyEvidenceRef:configuredRef,
    criticEvidenceRef:"agni.deterministic.security.bounded-ratelimit.v1",
  };
}

function proposalInsert(
  proposal:AgniProposal,
  traceId:string,
  correlationId:string,
):Record<string,unknown>{
  const preauthorized=preauthorizedRateLimit(proposal);
  const now=new Date();
  const decisionAt=now.toISOString();
  const capabilityIssuedAt=decisionAt;
  const capabilityExpiresAt=new Date(now.getTime()+5*60_000).toISOString();
  return {
    id:proposal.proposalId,
    incident_id:proposal.incidentId,
    target_system:proposal.targetSystem,
    target_service:proposal.targetService,
    action_type:proposal.action.type,
    action_payload:proposal.action,
    action_fingerprint:proposal.actionFingerprint,
    risk:proposal.risk,
    requested_approval_mode:proposal.requestedApprovalMode,
    expected_revision:proposal.expectedRevision??null,
    evidence_refs:[...proposal.evidenceRefs],
    expected_effect_code:proposal.expectedEffectCode,
    rollback_code:proposal.rollbackCode,
    policy_evidence_ref:preauthorized?.policyEvidenceRef??proposal.policyEvidenceRef,
    critic_evidence_ref:preauthorized?.criticEvidenceRef??proposal.criticEvidenceRef,
    source_trace_id:traceId,
    source_correlation_id:correlationId,
    created_at:proposal.createdAt,
    expires_at:proposal.expiresAt,
    ...(preauthorized?{
      decision_status:"authorized",
      decision_id:crypto.randomUUID(),
      decision_at:decisionAt,
      decision_actor_id:"quickfurno-core:agni-preauthorized-policy",
      decision_reason_code:"AGNI_PREAUTHORIZED_BOUNDED_RATE_LIMIT",
      capability_id:crypto.randomUUID(),
      capability_nonce:crypto.randomBytes(24).toString("base64url"),
      capability_issued_at:capabilityIssuedAt,
      capability_expires_at:capabilityExpiresAt,
    }:{
      decision_status:"requested",
    }),
  };
}

export type AgniProposalIntakeResult=
  |Readonly<{ok:true;protocol:typeof AGNI_PROPOSAL_PROTOCOL;proposalId:string;status:"REQUESTED"|"AUTHORIZED";idempotent:boolean}>
  |Readonly<{ok:false;code:"PROPOSAL_CONFLICT"|"PREAUTHORIZED_POLICY_REFUSED"|"PERSISTENCE_FAILED"}>;

export async function submitAgniProposal(args:{
  readonly proposal:AgniProposal;
  readonly traceId:string;
  readonly correlationId:string;
}):Promise<AgniProposalIntakeResult>{
  if(args.proposal.requestedApprovalMode==="NONE"){
    return {ok:false,code:"PREAUTHORIZED_POLICY_REFUSED"};
  }
  if(args.proposal.requestedApprovalMode==="PREAUTHORIZED_POLICY"&&!preauthorizedRateLimit(args.proposal)){
    return {ok:false,code:"PREAUTHORIZED_POLICY_REFUSED"};
  }
  const insert=proposalInsert(args.proposal,args.traceId,args.correlationId);
  const created=await db().from("agni_action_proposals").insert(insert)
    .select("id,action_fingerprint,decision_status").maybeSingle();
  if(!created.error&&created.data){
    return {
      ok:true,
      protocol:AGNI_PROPOSAL_PROTOCOL,
      proposalId:String(created.data.id),
      status:created.data.decision_status==="authorized"?"AUTHORIZED":"REQUESTED",
      idempotent:false,
    };
  }
  if(created.error?.code!=="23505")return {ok:false,code:"PERSISTENCE_FAILED"};
  const existing=await db().from("agni_action_proposals")
    .select("id,action_fingerprint,decision_status").eq("id",args.proposal.proposalId).maybeSingle();
  if(existing.error||!existing.data)return {ok:false,code:"PERSISTENCE_FAILED"};
  if(String(existing.data.action_fingerprint)!==args.proposal.actionFingerprint){
    return {ok:false,code:"PROPOSAL_CONFLICT"};
  }
  return {
    ok:true,
    protocol:AGNI_PROPOSAL_PROTOCOL,
    proposalId:String(existing.data.id),
    status:existing.data.decision_status==="authorized"?"AUTHORIZED":"REQUESTED",
    idempotent:true,
  };
}

export type AgniDecisionResult=
  |Readonly<{ok:true;status:"AUTHORIZED"|"REJECTED";proposalId:string}>
  |Readonly<{ok:false;code:"NOT_FOUND"|"ALREADY_DECIDED"|"EXPIRED"|"FINGERPRINT_MISMATCH"|"DECISION_FAILED"}>;

export async function decideAgniProposal(args:{
  readonly proposalId:string;
  readonly actionFingerprint:string;
  readonly decision:"APPROVE"|"REJECT";
  readonly decisionId:string;
  readonly operatorRef:string;
  readonly now?:Date;
}):Promise<AgniDecisionResult>{
  const now=args.now??new Date();
  const current=await db().from("agni_action_proposals")
    .select("id,action_fingerprint,decision_status,expires_at,risk,policy_evidence_ref,critic_evidence_ref")
    .eq("id",args.proposalId).maybeSingle();
  if(current.error)return {ok:false,code:"DECISION_FAILED"};
  if(!current.data)return {ok:false,code:"NOT_FOUND"};
  if(String(current.data.action_fingerprint)!==args.actionFingerprint)return {ok:false,code:"FINGERPRINT_MISMATCH"};
  if(current.data.decision_status!=="requested")return {ok:false,code:"ALREADY_DECIDED"};
  if(Date.parse(String(current.data.expires_at))<=now.getTime())return {ok:false,code:"EXPIRED"};

  const operatorRef=humanRef(args.operatorRef);
  machineRef(String(current.data.policy_evidence_ref??""),"AGNI_POLICY_EVIDENCE_INVALID");
  const criticEvidenceRef=machineRef(String(current.data.critic_evidence_ref??""),"AGNI_CRITIC_EVIDENCE_INVALID");
  if((current.data.risk==="HIGH"||current.data.risk==="CRITICAL")&&!criticEvidenceRef.startsWith("jev.")){
    return {ok:false,code:"DECISION_FAILED"};
  }
  const common={
    decision_id:args.decisionId,
    decision_at:now.toISOString(),
    decision_actor_id:operatorRef,
    updated_at:now.toISOString(),
  };
  const patch=args.decision==="APPROVE"?{
    ...common,
    decision_status:"authorized",
    decision_reason_code:"AGNI_HUMAN_APPROVED",
    capability_id:crypto.randomUUID(),
    capability_nonce:crypto.randomBytes(24).toString("base64url"),
    capability_issued_at:now.toISOString(),
    capability_expires_at:new Date(now.getTime()+5*60_000).toISOString(),
  }:{
    ...common,
    decision_status:"rejected",
    decision_reason_code:"AGNI_HUMAN_REJECTED",
  };
  const updated=await db().from("agni_action_proposals").update(patch)
    .eq("id",args.proposalId)
    .eq("decision_status","requested")
    .eq("action_fingerprint",args.actionFingerprint)
    .select("id");
  if(updated.error||!updated.data?.length)return {ok:false,code:"DECISION_FAILED"};
  return {ok:true,status:args.decision==="APPROVE"?"AUTHORIZED":"REJECTED",proposalId:args.proposalId};
}

async function loadSigningKey():Promise<{keyId:string;privateKeyPem:string}>{
  const path=process.env.QF_AGNI_CAPABILITY_SIGNING_KEY_FILE?.trim();
  if(!path||!isAbsolute(path))throw new Error("AGNI_CAPABILITY_SIGNING_KEY_FILE_INVALID");
  const stateless=await readFile(path);
  if(stateless.byteLength<80||stateless.byteLength>16_384)throw new Error("AGNI_CAPABILITY_SIGNING_KEY_FILE_INVALID");
  let parsed:unknown;
  try{parsed=JSON.parse(stateless.toString("utf8"));}
  catch{throw new Error("AGNI_CAPABILITY_SIGNING_KEY_FILE_INVALID");}
  return signingKeySchema.parse(parsed);
}

function capabilityFromRow(row:ProposalRow,environment:"staging"|"production"):AgniCapability{
  if(
    row.decision_status!=="authorized"||
    !row.capability_id||
    !row.capability_nonce||
    !row.capability_issued_at||
    !row.capability_expires_at||
    !row.decision_actor_id||
    !row.policy_evidence_ref||
    !row.critic_evidence_ref
  )throw new Error("AGNI_CAPABILITY_NOT_AUTHORIZED");
  return {
    protocolVersion:1,
    capabilityId:row.capability_id,
    proposalId:row.id,
    incidentId:row.incident_id,
    actionFingerprint:row.action_fingerprint,
    targetSystem:row.target_system,
    targetService:row.target_service,
    actionType:row.action_type,
    ...(row.expected_revision===null?{}:{expectedRevision:Number(row.expected_revision)}),
    environment,
    approvalMode:row.requested_approval_mode==="PREAUTHORIZED_POLICY"?"PREAUTHORIZED_POLICY":"HUMAN",
    approvedByRef:row.decision_actor_id,
    policyEvidenceRef:row.policy_evidence_ref,
    criticEvidenceRef:row.critic_evidence_ref,
    nonce:row.capability_nonce,
    issuedAt:row.capability_issued_at,
    expiresAt:row.capability_expires_at,
  };
}

export type AgniCapabilityResult=
  |Readonly<{ok:true;protocol:typeof AGNI_CAPABILITY_PROTOCOL;proposal:AgniProposal;signedCapability:SignedAgniCapability}>
  |Readonly<{ok:false;code:"NOT_FOUND"|"NOT_AUTHORIZED"|"EXPIRED"|"FINGERPRINT_MISMATCH"|"SIGNING_UNAVAILABLE"|"READ_FAILED"}>;

export async function getAgniCapability(args:{
  readonly proposalId:string;
  readonly actionFingerprint:string;
  readonly environment:"staging"|"production";
  readonly now?:Date;
}):Promise<AgniCapabilityResult>{
  const now=args.now??new Date();
  const found=await db().from("agni_action_proposals").select("*").eq("id",args.proposalId).maybeSingle();
  if(found.error)return {ok:false,code:"READ_FAILED"};
  if(!found.data)return {ok:false,code:"NOT_FOUND"};
  const row=found.data as unknown as ProposalRow;
  if(row.action_fingerprint!==args.actionFingerprint)return {ok:false,code:"FINGERPRINT_MISMATCH"};
  if(row.decision_status!=="authorized")return {ok:false,code:"NOT_AUTHORIZED"};
  if(!row.capability_expires_at||Date.parse(row.capability_expires_at)<=now.getTime())return {ok:false,code:"EXPIRED"};

  const proposal:AgniProposal={
    protocolVersion:1,
    proposalId:row.id,
    incidentId:row.incident_id,
    targetSystem:row.target_system,
    targetService:row.target_service,
    action:row.action_payload,
    actionFingerprint:row.action_fingerprint,
    risk:row.risk,
    requestedApprovalMode:row.requested_approval_mode,
    ...(row.expected_revision===null?{}:{expectedRevision:Number(row.expected_revision)}),
    evidenceRefs:[...row.evidence_refs],
    expectedEffectCode:row.expected_effect_code,
    rollbackCode:row.rollback_code,
    policyEvidenceRef:row.policy_evidence_ref??"agni.policy.missing",
    criticEvidenceRef:row.critic_evidence_ref??"agni.critic.missing",
    createdAt:row.created_at,
    expiresAt:row.expires_at,
  };
  try{
    const key=await loadSigningKey();
    const signedCapability=signAgniCapability({
      capability:capabilityFromRow(row,args.environment),
      keyId:key.keyId,
      privateKeyPem:key.privateKeyPem,
    });
    return {ok:true,protocol:AGNI_CAPABILITY_PROTOCOL,proposal,signedCapability};
  }catch{
    return {ok:false,code:"SIGNING_UNAVAILABLE"};
  }
}
