// VOX-10B — Core owns decisions; Jarvis observation cannot change state.
// This contract does not expose a public route or send provider messages.
import {preflightRiyaClientHandover} from "./riyaClientHandoverGate.mjs";
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const record=x=>x!==null&&typeof x==="object"&&!Array.isArray(x);
const denied=error=>Object.freeze({ok:false,error,mode:"READ_ONLY",
 executionAuthorized:false,providerMessagesSent:0,canSendReply:false});
export async function prepareRiyaHandoverCircuit({
  preflightArgs,readCurrentCoreSnapshot,readVerifiedJarvisObservation,
  verifyCurrentJarvisObservation,clock=Date.now
}={}){
 if(!record(preflightArgs)||!UUID.test(String(preflightArgs.request?.nonce))||
   typeof readCurrentCoreSnapshot!=="function"||
   typeof readVerifiedJarvisObservation!=="function"||
   typeof verifyCurrentJarvisObservation!=="function"||
   typeof clock!=="function")return denied("CORE_AND_JARVIS_EVIDENCE_REQUIRED");
 const now=clock();
 if(!Number.isSafeInteger(now)||now<=0)return denied("INVALID_OBSERVATION_TIME");
 // The original VOX-08P preflight can never execute a handover or provider send.
 const first=await preflightRiyaClientHandover({...preflightArgs,now});
 if(!first.ok)return denied(first.error);
 let observation;
 try{observation=await readVerifiedJarvisObservation({
  conversationId:first.conversationId,clientId:first.clientId,
  projectId:first.projectId,revision:first.expectedRevision
 });}catch{return denied("JARVIS_OBSERVATION_UNAVAILABLE");}
 const exact=["schema","conversationId","clientId","projectId",
  "revision","state","providerMessagesSent","origin","observedAt"];
 if(!record(observation)||Object.keys(observation).sort().join("|")!==exact.sort().join("|")||
   observation.schema!=="qfj.vox.riya.handover.observation.v1"||
   observation.origin!=="JARVIS_READ_ONLY"||
   observation.conversationId!==first.conversationId||
   observation.clientId!==first.clientId||
   observation.projectId!==first.projectId||
   observation.revision!==first.expectedRevision||
   !["AI","TAKEOVER_PENDING","HUMAN","CLOSED"].includes(observation.state)||
   observation.providerMessagesSent!==0||
   typeof observation.observedAt!=="string"||
   !Number.isFinite(Date.parse(observation.observedAt))||
   Date.parse(observation.observedAt)>clock()+30000||
   clock()-Date.parse(observation.observedAt)>60000)
  return denied("UNTRUSTED_JARVIS_OBSERVATION");
 let verified=false;
 try{verified=await verifyCurrentJarvisObservation(observation)===true;}
 catch{}
 if(!verified)return denied("JARVIS_SIGNATURE_OR_REPLAY_REQUIRED");
 let latest;
 try{latest=await readCurrentCoreSnapshot(first.conversationId);}
 catch{return denied("CORE_REVALIDATION_UNAVAILABLE");}
 if(!record(latest)||latest.conversation?.id!==first.conversationId||
   latest.conversation?.revision!==first.expectedRevision)
  return denied("CORE_STATE_CHANGED_DURING_HANDOVER");
 // Core rechecks current grants/consent after async Jarvis call. No client
 // JSON permission, signature or prior preflight is ever accepted as durable.
 const second=await preflightRiyaClientHandover({
  ...preflightArgs,scope:latest.scope,department:latest.department,
  conversation:latest.conversation,clientGrant:latest.clientGrant,
  canonicalLocationProof:latest.canonicalLocationProof,
  jarvisReceipt:latest.jarvisReceipt,now:clock()
 });
 if(!second.ok)return denied(second.error);
 if(observation.state!==latest.conversation.state)
  return denied("CORE_JARVIS_STATE_NOT_RECONCILED");
 return Object.freeze({ok:true,schema:"qf.vox.riya.handover.circuit.v1",
  mode:"READ_ONLY",conversationId:first.conversationId,
  expectedRevision:first.expectedRevision,proposedState:first.proposedState,
  currentAgentState:observation.state,grantRechecked:true,
  requiresIndependentCoreAtomicTransition:true,
  requiresRealJarvisPauseOrResumeAck:true,
  executionAuthorized:false,providerMessagesSent:0,
  canReadTranscript:false,canSendReply:false});
}
