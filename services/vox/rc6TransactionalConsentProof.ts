// VOX FINAL-1 / Track B — disposable/source-only D2-C same-session transaction proof.
// This is NOT the native Staff writer. It never commits or writes. Production
// CORE_CONVERSATION and the SQL CHECK remain hard-off pending reviewed integration.
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
