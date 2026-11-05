/**
 * Phase 4 provider readiness from existing NON-AUTHORIZING evidence only.
 * Does not contact Meta, Google, Cloudflare, Auth, Storage, or production.
 * No secret values or identity documents. Never authorizes rollout.
 */
import {readFileSync} from "node:fs";
import {resolve,dirname} from "node:path";
import {fileURLToPath} from "node:url";
const root=resolve(dirname(fileURLToPath(import.meta.url)),"../../..");
const REQUIRED=Object.freeze([
 ["scanner","certified",true,"REAL_CLAMAV_SIGNATURE_ENGINE_MISSING"],
 ["scanner","behaviorObserved",true,"REAL_CLAMAV_CLEAN_EICAR_NOT_OBSERVED"],
 ["whatsapp","signedHook","verified","REAL_WHATSAPP_SIGNED_HOOK_NOT_CERTIFIED"],
 ["whatsapp","templateDeliveryReceipt","verified","REAL_WHATSAPP_DELIVERY_NOT_CERTIFIED"],
 ["whatsapp","otpReplayNegative","verified","REAL_WHATSAPP_OTP_REPLAY_NOT_CERTIFIED"],
 ["whatsapp","recipientConsent","verified","WHATSAPP_OPTIN_NOT_CERTIFIED"],
 ["googlePlaces","billingActive","verified","GOOGLE_PLACES_BILLING_NOT_CERTIFIED"],
 ["googlePlaces","restrictedServerKey","verified","GOOGLE_PLACES_RESTRICTED_KEY_NOT_CERTIFIED"],
 ["googlePlaces","realSuggestions","verified","GOOGLE_PLACES_SUGGESTIONS_NOT_CERTIFIED"],
 ["googlePlaces","punePcmcGeofence","verified","GOOGLE_PLACES_PUNE_PCMC_GEOFENCE_NOT_CERTIFIED"],
 ["privateStorage","privateBucketAcl","verified","PRIVATE_STORAGE_BUCKET_ACL_NOT_CERTIFIED"],
 ["privateStorage","scanQuarantineReceipt","verified","PRIVATE_SCAN_QUARANTINE_NOT_CERTIFIED"],
 ["privateStorage","retentionPolicy","verified","PRIVATE_EVIDENCE_RETENTION_NOT_CERTIFIED"],
 ["owner","cloudflareAccessAal2Uat","verified","OWNER_REAL_CLOUDFLARE_AAL2_NOT_CERTIFIED"],
 ["owner","webCoreRunningDigest","verified","DEPLOYED_WEB_CORE_DIGEST_NOT_CERTIFIED"]
]);
export function assessP4ProviderObservation(x){
 if(!x||x.schema!=="qf.launch.p4.provider-observation.v1"||
    x.mode!=="SOURCE_AND_LOOPBACK_OBSERVATION_ONLY"||
    x.secretsRead!==false||x.providerMessagesSent!==0||
    x.managedSystemsChanged!==0||x.releaseDecision!=="HOLD"||
    x.authz?.stagingGoApproved!==false||x.authz?.productionGoApproved!==false)
  throw Error("P4_PROVIDER_OBSERVATION_UNTRUSTED");
 for(const [category,name] of REQUIRED){
  if(!(category in x)||!(name in x[category]))throw Error("P4_PROVIDER_OBSERVATION_INCOMPLETE");
 }
 const missing=REQUIRED.filter(([category,name,want])=>x[category][name]!==want).map(([, , ,why])=>why);
 return Object.freeze({
  schema:"qf.launch.p4.provider-source-preflight.v1",
  observationDate:x.date,
  verifiedProviderChecks:REQUIRED.length-missing.length,
  requiredProviderChecks:REQUIRED.length,
  unmet:Object.freeze(missing),
  scannerActualBehaviorObserved:x.scanner.behaviorObserved,
  providerMessagesSent:0,
  credentialsExposed:false,
  actualProviderCertification:false,
  managedStorageCertified:false,
  ownerActualAal2Certified:false,
  canSendWhatsapp:false,canEnablePrivateEvidence:false,
  canEnableVendorSignup:false,canDeploy:false,
  releaseDecision:"HOLD",
  blockers:Object.freeze([...missing,"SEPARATE_OWNER_APPROVAL_AND_RECOVERY_REQUIRED"])
 });
}
export function localProviderObservation(){
 const snapshot=JSON.parse(readFileSync(resolve(root,
  "docs/vox/QF-P4-PROVIDER-READONLY-OBSERVATION-20261105.json"),"utf8"));
 return assessP4ProviderObservation(snapshot);
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 process.stdout.write(JSON.stringify(localProviderObservation(),null,2)+"\n");
 process.exitCode=2; // real providers have not been authenticated or certified
}
