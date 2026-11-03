/** Read-only snapshot adjudicator; no provider or database control interfaces.
 * A quiet database snapshot is not a certified worker freeze.
 */
export const STAGING_PROJECT="uckafzuochmbvtiodmcl";
const int=v=>Number.isSafeInteger(v)&&v>=0;
const utc=s=>typeof s==="string"&&s.endsWith("Z")&&!Number.isNaN(Date.parse(s));
const REQUIRED_EXTERNAL=Object.freeze([
 "marketplace_worker","automation_worker","lead_matching_worker",
 "jarvis_communication_worker","provider_webhook_ingress","scheduled_cron",
 "external_message_gateway","finance_webhook"
]);
export function checkMaintenanceFreeze(e={},now){
 const blockers=[];
 const deny=b=>{if(!blockers.includes(b))blockers.push(b);};
 if(e.projectRef!==STAGING_PROJECT||e.environment!=="staging")deny("WRONG_MANAGED_ENVIRONMENT");
 if(!utc(now)||!utc(e.observedAt)||Date.parse(e.observedAt)>Date.parse(now)||
    Date.parse(now)-Date.parse(e.observedAt)>120000)deny("OBSERVATION_NOT_FRESH");
 const counts=e.counts;
 for(const k of ["registeredWorkers","acceptingWorkers","workerInFlight","recentHeartbeat5m",
  "conversationOutboxPending","jarvisTurnOutboxPending","outboundEnabledPolicies",
  "webhookEnabledPolicies"]){
  if(!int(counts?.[k]))deny("COUNT_INVALID:"+k);
 }
 for(const k of ["acceptingWorkers","workerInFlight","recentHeartbeat5m",
  "conversationOutboxPending","jarvisTurnOutboxPending","outboundEnabledPolicies",
  "webhookEnabledPolicies"]){
  if(counts?.[k]!==0)deny("ACTIVE_WORK_DETECTED:"+k);
 }
 if(!Array.isArray(e.externalStops)||e.externalStops.length!==REQUIRED_EXTERNAL.length)
  deny("EXTERNAL_STOP_INVENTORY_INCOMPLETE");
 else{
  const services=new Set();
  for(const s of e.externalStops){
   if(!REQUIRED_EXTERNAL.includes(s?.service)||services.has(s.service)){
    deny("EXTERNAL_SERVICE_MISMATCH");continue;
   }
   services.add(s.service);
   // Proof must be a separate operator artifact, not merely an on/off boolean.
   if(s.confirmedStopped!==true||typeof s.evidenceSha256!=="string"||
      !/^[0-9a-f]{64}$/i.test(s.evidenceSha256)||!utc(s.observedAt)||
      Date.parse(s.observedAt)>Date.parse(now)||
      Date.parse(now)-Date.parse(s.observedAt)>120000)
    deny("EXTERNAL_STOP_UNVERIFIED:"+s.service);
  }
 }
 if(typeof e.operatorId!=="string"||e.operatorId.trim().length<3||
    !utc(e.windowStartsAt)||!utc(e.windowEndsAt)||
    Date.parse(e.windowStartsAt)>Date.parse(now)||
    Date.parse(e.windowEndsAt)<=Date.parse(now)||
    Date.parse(e.windowEndsAt)-Date.parse(e.windowStartsAt)>1800000)
   deny("CONTROLLED_WINDOW_NOT_PROVEN");
 // No automatic permission to mutate: there can be external workers not represented here.
 return Object.freeze({
  decision:blockers.length?"HOLD":"FREEZE_EVIDENCE_PRESENT_INDEPENDENT_RELEASE_REQUIRED",
  executable:false,blockers:Object.freeze(blockers)
 });
}
export const REQUIRED_EXTERNAL_SERVICES=REQUIRED_EXTERNAL;
