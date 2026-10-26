/**
 * VOX-08T SOURCE-ONLY one-shot Core worker integration; not installed as a
 * cron/daemon/API route in Staging or Production. Reuses approved (future)
 * Core RPC adapter and VOX-08N processor; no new secrets/queues.
 */
import {runIsolatedNotificationOutboxOnce} from "../contracts/vox/notificationOutboxWorker.mjs";
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const validId=s=>typeof s==="string"&&UUID.test(s);
const exact=(o,keys)=>o!==null&&typeof o==="object"&&!Array.isArray(o)&&
 Object.keys(o).sort().join("|")===[...keys].sort().join("|");
const blocked=status=>Object.freeze({ok:false,status,source:"CORE_INTERNAL_WORK_ONLY",
 jobsClaimed:0,jobsProcessed:0,jobsRetried:0,jobsDeadLettered:0,
 internalRecords:0,externalMessagesSent:0,pushDeliveriesVerified:0,
 releaseCertified:false});
/**
 * No self-approved booleans or browser-controlled config: the injected
 * verifyDeploymentAuthority MUST belong to future Core's trusted bootstrap
 * service with independently approved signing keys/DB/Staff MFA. This code
 * cannot create that human approval or certify live deployment.
 */
export async function runVoxInternalNotificationCycle({
 environment,featureGates,verifyDeploymentAuthority,rpc,workerId,
 now=Date.now(),emitObservation,maxJobs=5
}={}){
 if(environment!=="staging"||
  !exact(featureGates,["portal","workActions","notificationWorker"])||
  featureGates.portal!=="staging"||
  featureGates.workActions!=="staging"||
  featureGates.notificationWorker!=="staging")
  return blocked("NOT_ACTIVATED_OR_NOT_STAGING");
 if(typeof verifyDeploymentAuthority!=="function"||
  typeof rpc!=="function"||typeof emitObservation!=="function"||
  !validId(workerId)||!Number.isSafeInteger(maxJobs)||maxJobs<1||
  maxJobs>10||!Number.isSafeInteger(now)||now<=0)
  return blocked("TRUSTED_CORE_DEPLOYMENT_INTERFACE_REQUIRED");
 let proof;
 try{proof=await verifyDeploymentAuthority();}catch{
  return blocked("SIGNED_RELEASE_PROOF_UNAVAILABLE");
 }
 if(!exact(proof,["kind","environment","scope","independentReviewsVerified",
  "signedReleaseDigestVerified","expiresAtMs","schemaInstalledAndReviewed"])||
  proof.kind!=="CORE_TRUSTED_DEPLOYMENT_ATTESTATION"||
  proof.environment!=="staging"||
  proof.scope!=="STAFF_INTERNAL_OUTBOX_ONLY"||
  proof.independentReviewsVerified!==true||
  proof.signedReleaseDigestVerified!==true||
  proof.schemaInstalledAndReviewed!==true||
  !Number.isSafeInteger(proof.expiresAtMs)||
  proof.expiresAtMs<=now||proof.expiresAtMs>now+300000)
  return blocked("INDEPENDENT_RELEASE_AUTHORITY_REQUIRED");
 const result=await runIsolatedNotificationOutboxOnce({
  rpc,workerId,enabled:true,maxJobs,leaseSeconds:90
 });
 const safe=Object.freeze({
  ok:result.ok,status:result.status,source:"CORE_INTERNAL_WORK_ONLY",
  jobsClaimed:result.jobsClaimed,jobsProcessed:result.jobsProcessed,
  jobsRetried:result.jobsRetried,jobsDeadLettered:result.jobsDeadLettered,
  internalRecords:result.internalRecords,
  externalMessagesSent:0,pushDeliveriesVerified:0,
  releaseCertified:false
 });
 // Do not block Core job completion on telemetry error. Record no raw data.
 try{await emitObservation(safe);}catch{}
 return safe;
}
