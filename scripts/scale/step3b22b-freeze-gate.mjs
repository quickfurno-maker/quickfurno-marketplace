/** Read-only snapshot adjudicator; no provider or database control interfaces.
 * A quiet database snapshot is not a certified worker freeze.
 */
export const STAGING_PROJECT="uckafzuochmbvtiodmcl";
export const PRODUCTION_PROJECT="yqpgcsduqbxulrlzwzap";
const int=v=>Number.isSafeInteger(v)&&v>=0;
const utc=s=>typeof s==="string"&&s.endsWith("Z")&&!Number.isNaN(Date.parse(s));
export const KNOWN_STAGING_BOUND_CONTAINERS=Object.freeze([
 "qf-core-staging","qf-vox-20261102-mfa-ui-test"
]);
const REQUIRED_EXTERNAL=Object.freeze([
 "marketplace_worker","automation_worker","lead_matching_worker",
 "jarvis_communication_worker","provider_webhook_ingress","scheduled_cron",
 "external_message_gateway","finance_webhook"
]);
export function checkMaintenanceFreeze(e={},now){
 const blockers=[];
 const deny=b=>{if(!blockers.includes(b))blockers.push(b);};
 const isProduction=e.environment==="production";
 if(!["staging","production"].includes(e.environment)||
    e.projectRef!==(isProduction?PRODUCTION_PROJECT:STAGING_PROJECT))
  deny("WRONG_MANAGED_ENVIRONMENT");
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
 // Independent read-only VPS inventory covers real Staging-bound processes,
 // not just the quiet database/worker-heartbeat tables.
 // Production needs an independently evidenced COMPLETE writer inventory, not
 // a copied Staging-specific list. No arbitrary self-declared zero writers.
 if(isProduction&&(!Array.isArray(e.knownProductionWriterNames)||
    e.knownProductionWriterNames.length===0||
    new Set(e.knownProductionWriterNames).size!==e.knownProductionWriterNames.length||
    e.knownProductionWriterNames.some(x=>typeof x!=="string"||!x.trim())||
    e.productionWriterScopeCrosscheckedBySre!==true||
    typeof e.productionWriterScopeEvidenceSha256!=="string"||
    !/^[0-9a-f]{64}$/i.test(e.productionWriterScopeEvidenceSha256)))
   deny("PRODUCTION_WRITER_SCOPE_NOT_CERTIFIED");
 const knownNames=isProduction?(Array.isArray(e.knownProductionWriterNames)?e.knownProductionWriterNames:[]):KNOWN_STAGING_BOUND_CONTAINERS;
 const docker=isProduction?e.productionDockerInventory:e.stagingDockerInventory;
 const scope=isProduction?"PRODUCTION":"STAGING";
 const refKey=isProduction?"productionRefPresent":"stagingRefPresent";
 if(docker?.source!=="read_only_docker_inspect"||
    docker?.inventoryComplete!==true||
    typeof docker?.evidenceSha256!=="string"||
    !/^[0-9a-f]{64}$/i.test(docker.evidenceSha256)||
    !utc(docker?.observedAt)||!utc(now)||
    Date.parse(docker.observedAt)>Date.parse(now)||
    Date.parse(now)-Date.parse(docker.observedAt)>120000)
   deny(scope+"_DOCKER_INVENTORY_UNVERIFIED");
 const seen=new Set();
 for(const c of Array.isArray(docker?.containers)?docker.containers:[]){
  if(typeof c?.name!=="string"||seen.has(c.name)){
   deny("DUPLICATE_OR_INVALID_CONTAINER");continue;
  }
  seen.add(c.name);
  if(c[refKey]===true&&c.state!=="exited")
    deny(scope+"_CONTAINER_ACTIVE:"+c.name);
  if(knownNames.includes(c.name)){
   if(c[refKey]!==true)deny(scope+"_CONTAINER_TARGET_UNVERIFIED:"+c.name);
   if(c.state!=="exited")deny(scope+"_CONTAINER_ACTIVE:"+c.name);
  }
 }
 for(const name of knownNames){
  if(!seen.has(name))deny(scope+"_CONTAINER_MISSING:"+name);
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
