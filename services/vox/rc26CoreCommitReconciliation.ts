/** RC26-A: deterministic reconciliation for RC8 COMMIT_OUTCOME_UNKNOWN.
 * REVIEW ONLY. No route, no sends, no mutation: the transaction ALWAYS rolls back.
 *
 * Why a lock first: the RC8 writer holds FOR UPDATE OF c on the conversation
 * row from its scope check until COMMIT/abort. Acquiring FOR SHARE on that row
 * therefore waits for the original transaction to finish (or for the server to
 * abort it after the dropped connection). Only then does a fresh READ COMMITTED
 * statement read the nonce receipt, so "absent" is a durable NOT_COMMITTED and
 * never an in-flight commit observed too early.
 */
export const RC26_CORE_RECONCILER_ROUTE_INSTALLED=false as const;
type Db={query:(sql:string,values?:unknown[])=>Promise<{rows:any[];rowCount:number}>;
 release:(destroy?:boolean)=>void};
type Original={conversationId:string;nonce:string;actorId:string;
 action:"PAUSE_AI"|"TAKEOVER";expectedRevision:number};
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const base={providerMessagesSent:0 as const,mutationsApplied:0 as const};
const unknown=(reason:string)=>Object.freeze({...base,outcome:"UNKNOWN" as const,reason,
 requiresReconciliation:true});
const done=(outcome:"COMMITTED"|"NOT_COMMITTED"|"CONFLICT",reason:string,revision:number|null)=>
 Object.freeze({...base,outcome,reason,revision,requiresReconciliation:false});
const receiptSql=
 "SELECT r.nonce::text AS nonce,r.conversation_id::text AS conversation_id,"+
 "r.actor_id::text AS actor_id,r.action,r.previous_revision,r.new_revision,"+
 "r.event_id::text AS event_id,r.consent_scope,"+
 "e.conversation_id::text AS event_conversation_id "+
 "FROM public.vox_rc8_conversation_operator_receipts_candidate_v1 r "+
 "LEFT JOIN public.communication_conversation_events e ON e.id=r.event_id "+
 "WHERE r.nonce=$1::uuid";
export async function reconcileRc8CoreCommitOutcome(original:Original,
 acquireClient:()=>Promise<Db>){
 if(!original||!UUID.test(original.conversationId??"")||!UUID.test(original.nonce??"")||
    !UUID.test(original.actorId??"")||!["PAUSE_AI","TAKEOVER"].includes(original.action)||
    !Number.isSafeInteger(original.expectedRevision)||original.expectedRevision<0||
    original.expectedRevision>2147483646||typeof acquireClient!=="function")
  return unknown("RECONCILIATION_INPUT_INVALID");
 let db:Db|undefined,started=false,rolledBack=false;
 let result:ReturnType<typeof unknown>|ReturnType<typeof done>=unknown("RECONCILIATION_UNAVAILABLE");
 try{
  db=await acquireClient();
  if(!db||typeof db.query!=="function"||typeof db.release!=="function"){
   db=undefined;return unknown("TRANSACTION_ADAPTER_INVALID");
  }
  // READ WRITE only because PostgreSQL rejects FOR SHARE in READ ONLY; nothing
  // is written and the transaction is unconditionally rolled back below.
  await db.query("BEGIN TRANSACTION ISOLATION LEVEL READ COMMITTED READ WRITE");
  started=true;
  await db.query("SET LOCAL lock_timeout='5s'");
  const conv=await db.query(
   "SELECT id FROM public.communication_conversations WHERE id=$1::uuid FOR SHARE",
   [original.conversationId]);
  if(conv.rowCount!==1){result=unknown("CONVERSATION_NOT_FOUND");return result;}
  const receipt=await db.query(receiptSql,[original.nonce]);
  if(receipt.rowCount===0){
   // Safe to retry with the SAME nonce: the receipt nonce is unique, so a
   // retry can never produce a second committed operator action.
   result=done("NOT_COMMITTED","NO_RECEIPT_AFTER_WRITER_LOCK_RELEASED",null);
   return result;
  }
  const r=receipt.rows[0];
  const next=original.expectedRevision+1;
  if(receipt.rowCount!==1||!r||r.nonce!==original.nonce||
     r.conversation_id!==original.conversationId||r.actor_id!==original.actorId||
     r.action!==original.action||Number(r.previous_revision)!==original.expectedRevision||
     Number(r.new_revision)!==next||r.consent_scope!=="transactional"||
     typeof r.event_id!=="string"||!UUID.test(r.event_id)||
     r.event_conversation_id!==original.conversationId){
   // Never treat a nonce bound to another command/actor as this commit.
   result=done("CONFLICT","NONCE_RECEIPT_DOES_NOT_MATCH_ORIGINAL_COMMAND",null);
   return result;
  }
  result=done("COMMITTED","RECEIPT_AND_EVENT_DURABLE",next);
  return result;
 }catch{
  result=unknown("RECONCILIATION_UNAVAILABLE");return result;
 }finally{
  if(db){
   if(started)try{await db.query("ROLLBACK");rolledBack=true}catch{}
   // A connection whose ROLLBACK is unverified must never return to the pool
   // where the next borrower could run inside this transaction.
   try{db.release(started&&!rolledBack)}catch{}
  }
 }
}
