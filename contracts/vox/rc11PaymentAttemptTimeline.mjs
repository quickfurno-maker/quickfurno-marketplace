/** Review-only authoritative Core attempt timeline. Audit evidence is NOT
 * payment settlement, verified provider status, refunds or ledger reconciliation.
 * Deliberately never accepts provider IDs, request hashes or transaction refs.
 */
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const KINDS=new Set(["REQUESTED","PROVIDER_RESPONSE_RECEIVED","PROVIDER_ERROR",
 "TIMEOUT_UNCERTAIN","RECONCILIATION_PENDING","RECONCILIATION_OBSERVED"]);
const ORIGINS=new Set(["CORE_CHECKOUT","WEBHOOK_RECOVERY","SCHEDULED_RECONCILIATION","AUTHORIZED_OPERATOR"]);
const toIso=v=>typeof v==="string"&&Number.isFinite(Date.parse(v))?
 new Date(v).toISOString():null;
export function projectRc11PaymentAttemptTimeline(rows,orderId){
 if(!UUID.test(orderId)||!Array.isArray(rows)||rows.length>50)return null;
 const result=[],seen=new Set();
 const byAttempt=new Map();
 for(const row of rows){
  if(!row||typeof row!=="object"||Array.isArray(row)||
    !UUID.test(row.event_id??"")||row.order_id!==orderId||
    !UUID.test(row.attempt_id??"")||
    !Number.isSafeInteger(row.attempt_sequence)||row.attempt_sequence<1||
    row.attempt_sequence>1000||!["TEST","LIVE"].includes(row.environment)||
    !KINDS.has(row.event_kind)||!ORIGINS.has(row.origin)||
    !toIso(row.observed_at)||!toIso(row.recorded_at)||
    seen.has(row.event_id))return null;
  seen.add(row.event_id);
  const prev=byAttempt.get(row.attempt_id);
  if(prev&&(prev.environment!==row.environment||
    prev.sequences.has(row.attempt_sequence)))return null;
  if(prev)prev.sequences.add(row.attempt_sequence);
  else byAttempt.set(row.attempt_id,{environment:row.environment,
    sequences:new Set([row.attempt_sequence])});
  result.push(Object.freeze({
   attemptRef:"ATTEMPT-"+row.attempt_id,
   sequence:row.attempt_sequence,environment:row.environment,
   eventKind:row.event_kind,origin:row.origin,
   observedAt:toIso(row.observed_at),recordedAt:toIso(row.recorded_at)
  }));
 }
 // Server query should already be bounded, newest first; use explicit
 // deterministic presentation without making assertions about missing events.
 result.sort((a,b)=>b.recordedAt.localeCompare(a.recordedAt)||
  b.sequence-a.sequence||a.attemptRef.localeCompare(b.attemptRef));
 return Object.freeze({events:result,eventCount:result.length,
  schema:"qf.vox.finance.attempt-evidence.v1",readOnly:true,
  isCompleteHistory:false,isProviderSettlementVerified:false,
  canReconcile:false,canRefund:false,canActivateCredits:false});
}
