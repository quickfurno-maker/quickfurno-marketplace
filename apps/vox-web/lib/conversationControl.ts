import "server-only";
import {verifiedMfaSession} from "./auth";
import {origin} from "./core";

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH=/^[a-f0-9]{64}$/;
export type ConversationCommand={conversationId:string;nonce:string;
 expectedRevision:number;action:"PAUSE_AI"|"TAKEOVER"};
const off=()=>({ok:false,status:503,error:"CONVERSATION_ATOMIC_NOT_APPROVED"} as const);
/** Browser -> same-origin VOX BFF -> pinned Core -> installed atomic SQL.
 * The actual Core HTTP route and SQL check operations manager AAL2, reviewed
 * department capability, exact object scope, consent, revision and replay.
 * No direct Supabase access, provider sends, or optimistic success fallback.
 */
export async function submitConversationControl(cmd:ConversationCommand){
 if(process.env.VOX_STAFF_PORTAL_ENABLED!=="staging"||
    process.env.VOX_TEAM_WORKSPACE_ENABLED!=="staging"||
    process.env.VOX_STAFF_GRANTS_ENABLED!=="staging"||
    process.env.VOX_DEPARTMENT_ENFORCEMENT_ENABLED!=="staging"||
    process.env.VOX_RC42_CORE_CONVERSATION_OPERATOR_ENABLED!=="staging"||
    !["scoped","dual"].includes(String(process.env.VOX_STAFF_VIEW_MODE)))return off();
 if(!cmd||!UUID.test(cmd.conversationId)||!UUID.test(cmd.nonce)||
    !Number.isSafeInteger(cmd.expectedRevision)||cmd.expectedRevision<0||
    cmd.expectedRevision>2147483646||
    (cmd.action!=="PAUSE_AI"&&cmd.action!=="TAKEOVER"))
  return {ok:false,status:400,error:"INVALID_CONVERSATION_COMMAND"} as const;
 const token=await verifiedMfaSession();
 if(!token)return {ok:false,status:401,error:"STAFF_MFA_REQUIRED"} as const;
 const base=origin();
 if(!base)return {ok:false,status:503,error:"CORE_ORIGIN_UNVERIFIED"} as const;
 try{
  const response=await fetch(base+"/api/vox/v1/core/conversation-operator",{
   method:"POST",headers:{authorization:"Bearer "+token,
    "content-type":"application/json",accept:"application/json"},
   body:JSON.stringify(cmd),cache:"no-store",redirect:"error",
   signal:AbortSignal.timeout(3500)
  });
  if(!response.ok)return {ok:false,status:response.status===401?401:
   response.status===403?403:response.status===409?409:503,
   error:"CORE_CONVERSATION_NOT_VERIFIED"} as const;
  const raw:unknown=await response.json();
  if(!raw||typeof raw!=="object"||Array.isArray(raw))
   return {ok:false,status:503,error:"INVALID_ATOMIC_RECEIPT"} as const;
  const r=raw as Record<string,unknown>;
  const expectedKeys=["ok","state","action","nonce","conversationId",
   "previousRevision","newRevision","replayed","receiptSha256",
   "providerMessagesSent","mode"];
  if(Object.keys(r).sort().join("|")!==expectedKeys.sort().join("|")||
    r.ok!==true||r.mode!=="ATOMIC_NO_PROVIDER_SEND"||
    r.conversationId!==cmd.conversationId||r.action!==cmd.action||
    r.nonce!==cmd.nonce||r.previousRevision!==cmd.expectedRevision||
    r.newRevision!==cmd.expectedRevision+1||
    r.state!==(cmd.action==="PAUSE_AI"?"PAUSED":"HUMAN")||
    typeof r.replayed!=="boolean"||
    typeof r.receiptSha256!=="string"||!HASH.test(r.receiptSha256)||
    r.providerMessagesSent!==0)
   return {ok:false,status:503,error:"UNTRUSTED_ATOMIC_RECEIPT"} as const;
  return {ok:true,status:200,conversationId:cmd.conversationId,
   action:cmd.action,newRevision:cmd.expectedRevision+1,
   state:r.state as "PAUSED"|"HUMAN",
   replayed:r.replayed,providerMessagesSent:0 as const,
   receiptSha256:r.receiptSha256,nonce:cmd.nonce} as const;
 }catch{return {ok:false,status:503,error:"CORE_CONVERSATION_UNAVAILABLE"} as const;}
}

export type ConversationCandidate={id:string;revision:number;state:"OPEN"|"PAUSED";
 allowedActions:Array<"PAUSE_AI"|"TAKEOVER">};
/** Read-only Core-scoped selector. Never claims this is an authorization to
 * execute; the atomic Core write rechecks all live grants and revision.
 */
export async function fetchConversationCandidates(){
 if(process.env.VOX_STAFF_PORTAL_ENABLED!=="staging"||
    process.env.VOX_TEAM_WORKSPACE_ENABLED!=="staging"||
    process.env.VOX_STAFF_GRANTS_ENABLED!=="staging"||
    process.env.VOX_DEPARTMENT_ENFORCEMENT_ENABLED!=="staging"||
    process.env.VOX_RC42_CORE_CONVERSATION_OPERATOR_ENABLED!=="staging"||
    !["scoped","dual"].includes(String(process.env.VOX_STAFF_VIEW_MODE)))return off();
 const token=await verifiedMfaSession();
 if(!token)return {ok:false,status:401,error:"STAFF_MFA_REQUIRED"} as const;
 const base=origin();
 if(!base)return {ok:false,status:503,error:"CORE_ORIGIN_UNVERIFIED"} as const;
 try{
  const response=await fetch(base+"/api/vox/v1/core/conversation-candidates",{
   method:"GET",headers:{authorization:"Bearer "+token,accept:"application/json"},
   cache:"no-store",redirect:"error",signal:AbortSignal.timeout(3500)});
  if(!response.ok)return {ok:false,status:response.status===403?403:503,
   error:"CORE_CONVERSATION_DISCOVERY_DENIED"} as const;
  const raw:unknown=await response.json();
  if(!raw||typeof raw!=="object"||Array.isArray(raw))
   return {ok:false,status:503,error:"UNTRUSTED_CONVERSATION_LIST"} as const;
  const v=raw as Record<string,unknown>;
  if(v.ok!==true||v.schema!=="qf.vox.conversation.candidates.v1"||
     v.mode!=="READ_ONLY"||v.actionsEnabled!==false||
     !Array.isArray(v.conversations)||v.conversations.length>20)
   return {ok:false,status:503,error:"UNTRUSTED_CONVERSATION_LIST"} as const;
  const seen=new Set<string>(),conversations:ConversationCandidate[]=[];
  for(const item of v.conversations){
   if(!item||typeof item!=="object"||Array.isArray(item))
    return {ok:false,status:503,error:"UNTRUSTED_CONVERSATION_LIST"} as const;
   const x=item as Record<string,unknown>;
   const actions=x.state==="OPEN"?["PAUSE_AI","TAKEOVER"]:["TAKEOVER"];
   if(Object.keys(x).sort().join("|")!=="allowedActions|id|revision|state"||
      typeof x.id!=="string"||!UUID.test(x.id)||seen.has(x.id)||
      (x.state!=="OPEN"&&x.state!=="PAUSED")||
      !Number.isSafeInteger(x.revision)||(x.revision as number)<0||
      (x.revision as number)>2147483646||
      !Array.isArray(x.allowedActions)||x.allowedActions.join("|")!==actions.join("|"))
    return {ok:false,status:503,error:"UNTRUSTED_CONVERSATION_LIST"} as const;
   seen.add(x.id);conversations.push({id:x.id,revision:x.revision as number,
    state:x.state as "OPEN"|"PAUSED",allowedActions:actions as Array<"PAUSE_AI"|"TAKEOVER">});
  }
  return {ok:true,status:200,mode:"READ_ONLY" as const,
   actionsEnabled:false as const,conversations} as const;
 }catch{return {ok:false,status:503,error:"CONVERSATION_DISCOVERY_UNAVAILABLE"} as const;}
}
