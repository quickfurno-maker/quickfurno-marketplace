/**
 * AB7E deterministic outbox + AOS/AGNI advisory reconciliation.
 * Whitelisted counters only; external instructions, autonomous activation,
 * payment/credits, leads and notification providers are NOT supported.
 */
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const safeInt=x=>Number.isSafeInteger(x)&&x>=0&&x<=1_000_000;
const denial=reason=>Object.freeze({ok:false,reason,
 recommendedAction:"OWNER_REVIEW_ONLY",executionAuthorized:false,
 alerts:[],providerMessagesSent:0});
export async function prepareAb7OperationsAdvisory({
 enabled=false,cityId,teamId,metrics,sourceRevision,
 verifyCurrentInternalCoreMetrics,now=Date.now()
}={}){
 if(enabled!==true||!UUID.test(String(cityId))||
  !UUID.test(String(teamId))||!metrics||
  Object.keys(metrics).sort().join("|")!==[
   "deadLetter","duplicateRejected","inFlight","pending","processed",
   "revokedGrants","retrying","staleLeases"
  ].sort().join("|")||
  !Object.values(metrics).every(safeInt)||
  !Number.isSafeInteger(sourceRevision)||sourceRevision<1||
  !Number.isSafeInteger(now)||now<=0||
  typeof verifyCurrentInternalCoreMetrics!=="function")
  return denial("CURRENT_SANITIZED_CORE_METRICS_REQUIRED");
 try{
  if(await verifyCurrentInternalCoreMetrics({
   cityId,teamId,metrics,sourceRevision
  })!==true)return denial("CORE_METRIC_WINDOW_CHANGED");
 }catch{return denial("CORE_METRICS_UNAVAILABLE");}
 const alerts=[];
 if(metrics.deadLetter>0)alerts.push({
  code:"INTERNAL_DLQ_REVIEW",severity:"review",count:metrics.deadLetter
 });
 if(metrics.staleLeases>0)alerts.push({
  code:"UNSETTLED_PRIVATE_LEASES",severity:"review",count:metrics.staleLeases
 });
 if(metrics.revokedGrants>0)alerts.push({
  code:"REVOKED_STAFF_SCOPE",severity:"review",count:metrics.revokedGrants
 });
 if(metrics.duplicateRejected>0)alerts.push({
  code:"NONCE_REPLAY_DENIED",severity:"informational",count:metrics.duplicateRejected
 });
 return Object.freeze({ok:true,
  schema:"qf.vox.ab7e.internal-advisory.v1",
  cityId,teamId,sourceRevision,
  boundedSnapshot:true,completeSystemTotals:false,
  alerts:Object.freeze(alerts),
  recommendedAction:"OWNER_REVIEW_ONLY",
  executionAuthorized:false,
  canTriggerProviderSends:false,
  canGrantStaff:false,canChangeCredits:false,
  canOverrideThreeVendorLimit:false,
  providerMessagesSent:0
 });
}
