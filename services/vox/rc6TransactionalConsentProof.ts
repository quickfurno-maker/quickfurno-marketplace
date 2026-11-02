// VOX FINAL-1 / Track B — disposable/source-only D2-C same-session transaction proof.
// This is NOT the native Staff writer. It never commits or writes. Production
// CORE_CONVERSATION and the SQL CHECK remain hard-off pending reviewed integration.
import {createHash} from "node:crypto";
import {decideCommunicationConsent} from "../communicationConsentDecisionService";
import {authorizeConversationalWhatsAppConsent} from "../outboundConsentEnforcementService";

export const RC6_CONVERSATION_WRITER_INSTALLED = false as const;
const HEX64=/^[a-f0-9]{64}$/;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export type Rc6PgQueryClient={query:(sql:string,values?:readonly unknown[])=>Promise<{rows:unknown[]}>};
type Subject={destinationHash:string;subjectType:"client"|"vendor";subjectId:string};
const closed=(reason:string)=>Object.freeze({kind:"unavailable" as const,reason,
  consentAllowed:false,transactionCommitted:false,sourceRowsWritten:0,providerMessagesSent:0});
const timestamp=(col:string)=>
  "CASE WHEN "+col+" IS NULL THEN NULL ELSE to_char("+col+
  " AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"') END";
const suppressionsSql =
 "SELECT id::text AS id,scope,reason,policy_version,is_active,"+
 timestamp("expires_at")+" AS expires_at,"+timestamp("deactivated_at")+
 " AS deactivated_at FROM public.communication_suppressions "+
 "WHERE destination_hash=$1 AND channel=$2 AND is_active=true AND scope=ANY($3::text[])";
const preferencesSql =
 "SELECT id::text AS id,state,policy_version,"+timestamp("consented_at")+
 " AS consented_at,"+timestamp("withdrawn_at")+
 " AS withdrawn_at FROM public.communication_preferences "+
 "WHERE principal_type=$1 AND principal_id=$2::uuid AND channel=$3 AND scope=$4";

/**
 * Demonstrates the *real canonical TypeScript D2-C authority* with both SQL
 * reads on the SAME PostgreSQL connection while the exact D2-D destination
 * advisory-xact lock is held. This read-only transaction ALWAYS rolls back.
 * A future native writer must own the equivalent READ WRITE transaction and
 * perform Staff revalidation + nonce + actual mutation in that same transaction.
 */
export async function proveRc6TransactionalConsent(client:Rc6PgQueryClient,subject:Subject){
 if(!client||typeof client.query!=="function"||!subject||
    typeof subject.destinationHash!=="string"||!HEX64.test(subject.destinationHash)||
    !["client","vendor"].includes(subject.subjectType)||
    typeof subject.subjectId!=="string"||!UUID.test(subject.subjectId))
    return closed("INPUT_INVALID");
 let attempted=false,rollbackOk=true;
 let result:Readonly<{kind:"allow"|"deny"|"unavailable";reason:string;consentAllowed:boolean;
  transactionCommitted:false;sourceRowsWritten:0;providerMessagesSent:0}>=closed("AUTHORITY_UNAVAILABLE");
 try{
   attempted=true;
   await client.query("BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE READ ONLY");
   // Must match D2-D apply_communication_consent_command destination lock.
   await client.query("SELECT pg_advisory_xact_lock(hashtextextended('dst|' || $1::text || '|' || $2::text, 0))",
     [subject.destinationHash,"whatsapp"]);
   const decision=await authorizeConversationalWhatsAppConsent(subject,{
     decide:input=>decideCommunicationConsent(input,{
       now:()=>new Date(),
       readSuppressions:async q=>{
         const r=await client.query(suppressionsSql,[q.destinationHash,q.channel,q.scopes]);
         return r.rows as any;
       },
       readExactPreference:async q=>{
         const r=await client.query(preferencesSql,[q.principalType,q.principalId,q.channel,q.scope]);
         return r.rows as any;
       }
     })
   });
   result=decision.kind==="allow"&&decision.scope==="transactional"
    ? Object.freeze({kind:"allow" as const,reason:"CANONICAL_D2C_CURRENT",
       consentAllowed:true,transactionCommitted:false,sourceRowsWritten:0,providerMessagesSent:0})
    : decision.kind==="unavailable" ? closed("AUTHORITY_UNAVAILABLE")
    : Object.freeze({kind:"deny" as const,reason:"CONSENT_NOT_ALLOWED",
       consentAllowed:false,transactionCommitted:false,sourceRowsWritten:0,providerMessagesSent:0});
 }catch{
   result=closed("AUTHORITY_UNAVAILABLE");
 }finally{
   if(attempted)try{await client.query("ROLLBACK");}catch{rollbackOk=false;}
 }
 return rollbackOk?result:closed("ROLLBACK_UNVERIFIED");
}

// ---------------------------------------------------------------------------
// RC40 — read-only transactional consent DECISION HANDOFF.
// Produces bounded immutable evidence a *future* native writer may compare with
// its own in-transaction decision. NOT a writer: never commits, never sends,
// cannot authorize a write (evidence.writer is always "NOT_A_WRITER");
// CORE_CONVERSATION stays off. D2-C preference rows expose no revision column,
// so the revision bound is conversation revision + consent policy version,
// stated explicitly in the evidence.
// ---------------------------------------------------------------------------
export const RC40_CONSENT_HANDOFF_VERSION="rc40-consent-handoff-v1" as const;
const conversationSql=
 "SELECT id::text AS id,tenant_id,channel,destination_hash,subject_type,"+
 "subject_id::text AS subject_id,revision FROM public.communication_conversations "+
 "WHERE id=$1::uuid";
type HandoffRequest={conversationId:string;destinationHash:string;expectedRevision:number;
 principal:{type:"client"|"vendor";id:string}};
export type Rc40ConsentHandoffEvidence=Readonly<{
 version:typeof RC40_CONSENT_HANDOFF_VERSION;writer:"NOT_A_WRITER";
 consentScope:"transactional";channel:"whatsapp";
 conversationId:string;conversationRevision:number;
 principal:Readonly<{type:"client"|"vendor";id:string}>;
 policyVersion:string;disposition:string;reasonCode:string;
 matchedPreferenceId:string|null;matchedSuppressionId:string|null;
 revisionBinding:"CONVERSATION_REVISION_AND_POLICY_VERSION";
 sameTransaction:true;evidenceDigest:string}>;
const handoffClosed=(kind:"blocked"|"deny"|"unavailable",reason:string)=>Object.freeze({
 kind,reason,consentAllowed:false as const,writer:"NOT_A_WRITER" as const,
 evidence:null as Rc40ConsentHandoffEvidence|null,
 transactionCommitted:false as const,sourceRowsWritten:0 as const,providerMessagesSent:0 as const});
type HandoffResult=ReturnType<typeof handoffClosed>|Readonly<{kind:"allow";reason:string;
 consentAllowed:true;writer:"NOT_A_WRITER";evidence:Rc40ConsentHandoffEvidence;
 transactionCommitted:false;sourceRowsWritten:0;providerMessagesSent:0}>;
export async function proveRc40ConsentDecisionHandoff(client:Rc6PgQueryClient,request:HandoffRequest):
 Promise<HandoffResult>{
 const p=request?.principal;
 if(!client||typeof client.query!=="function"||!request||
    typeof request.conversationId!=="string"||!UUID.test(request.conversationId)||
    typeof request.destinationHash!=="string"||!HEX64.test(request.destinationHash)||
    !Number.isSafeInteger(request.expectedRevision)||request.expectedRevision<0||
    !p||!["client","vendor"].includes(p.type)||typeof p.id!=="string"||!UUID.test(p.id))
  return handoffClosed("blocked","HANDOFF_INPUT_INVALID");
 const convId=request.conversationId.toLowerCase(),principalId=p.id.toLowerCase();
 let attempted=false,rollbackOk=true;
 let result:HandoffResult=handoffClosed("unavailable","AUTHORITY_UNAVAILABLE");
 try{
  attempted=true;
  await client.query("BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE READ ONLY");
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended('dst|' || $1::text || '|' || $2::text, 0))",
   [request.destinationHash,"whatsapp"]);
  // Current conversation identity, read in the SAME transaction after the lock.
  const conv=await client.query(conversationSql,[convId]);
  const rows=conv.rows as any[];
  const c=Array.isArray(rows)&&rows.length===1?rows[0]:null;
  if(!c)result=handoffClosed("blocked","CONVERSATION_NOT_FOUND");
  else if(typeof c.id!=="string"||c.id.toLowerCase()!==convId)
   result=handoffClosed("blocked","CONVERSATION_IDENTITY_MISMATCH");
  else if(c.tenant_id!=="quickfurno"||c.channel!=="whatsapp")
   result=handoffClosed("blocked","CONVERSATION_SCOPE_MISMATCH");
  else if(c.destination_hash!==request.destinationHash)
   result=handoffClosed("blocked","DESTINATION_HASH_MISMATCH");
  else if(c.subject_type!==p.type||typeof c.subject_id!=="string"||
          c.subject_id.toLowerCase()!==principalId)
   result=handoffClosed("blocked","PRINCIPAL_BINDING_MISMATCH");
  else if(!Number.isSafeInteger(Number(c.revision))||Number(c.revision)!==request.expectedRevision)
   result=handoffClosed("blocked","STALE_CONVERSATION_REVISION");
  else{
   const decision=await decideCommunicationConsent({
    channel:"whatsapp",scope:"transactional",destinationHash:request.destinationHash,
    identityConfidence:"exact",principal:{type:p.type,id:principalId}},{
    now:()=>new Date(),
    readSuppressions:async q=>(await client.query(suppressionsSql,
     [q.destinationHash,q.channel,q.scopes])).rows as any,
    readExactPreference:async q=>(await client.query(preferencesSql,
     [q.principalType,q.principalId,q.channel,q.scope])).rows as any});
   if(!decision.ok)
    result=decision.code==="AUTHORITY_LOOKUP_FAILED"?handoffClosed("unavailable","AUTHORITY_UNAVAILABLE")
     :handoffClosed("blocked",decision.code==="AUTHORITY_INTEGRITY_VIOLATION"
      ?"CONSENT_AUTHORITY_INTEGRITY":"DECISION_INPUT_INVALID");
   else if(decision.disposition!=="no_consent_objection")
    result=handoffClosed("deny","CONSENT_NOT_ALLOWED");
   else{
    const body={version:RC40_CONSENT_HANDOFF_VERSION,writer:"NOT_A_WRITER" as const,
     consentScope:"transactional" as const,channel:"whatsapp" as const,
     conversationId:convId,conversationRevision:Number(c.revision),
     principal:Object.freeze({type:p.type,id:principalId}),
     policyVersion:decision.policyVersion as string,disposition:decision.disposition as string,
     reasonCode:decision.reasonCode as string,matchedPreferenceId:decision.matchedPreferenceId,
     matchedSuppressionId:decision.matchedSuppressionId,
     revisionBinding:"CONVERSATION_REVISION_AND_POLICY_VERSION" as const,sameTransaction:true as const};
    const evidenceDigest=createHash("sha256")
     .update(JSON.stringify([body,request.destinationHash])).digest("hex");
    result=Object.freeze({kind:"allow" as const,reason:"CANONICAL_D2C_CURRENT_HANDOFF",
     consentAllowed:true as const,writer:"NOT_A_WRITER" as const,
     evidence:Object.freeze({...body,evidenceDigest}) as Rc40ConsentHandoffEvidence,
     transactionCommitted:false as const,sourceRowsWritten:0 as const,providerMessagesSent:0 as const});
   }
  }
 }catch{
  result=handoffClosed("unavailable","AUTHORITY_UNAVAILABLE");
 }finally{
  if(attempted)try{await client.query("ROLLBACK");}catch{rollbackOk=false;}
 }
 return rollbackOk?result:handoffClosed("unavailable","ROLLBACK_UNVERIFIED");
}
