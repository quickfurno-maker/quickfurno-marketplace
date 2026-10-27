/** AB7J protected *single run*, no daemon/cron. Real Ed25519 independent
 * reviewer signature and current Owner + schema/provider evidence are REQUIRED.
 * Existing Core SQL RPCs process in-app-only notification outbox entries.
 */
import {verifyAb7gIndependentManifest} from "../contracts/vox/ab7gSignedStagingManifest.mjs";
import {runAb7fCoreInternalWorker} from "./voxAb7fIntegratedInternalWorker.mjs";
const stop=reason=>Object.freeze({ok:false,reason,started:false,
 externalMessagesSent:0,productionCertified:false});
export async function runAb7jSignedInternalOnce({
 environment,enabled=false,workerId,manifest,signature,
 pinnedReviewerPublicKey,expectedCoreCommit,
 verifyCurrentOwnerAal2,verifyInstalledSchema,
 verifyNoOutboundProviders,coreRpc,emitSanitizedAgniObservation,
 now=Date.now()
}={}){
 if(environment!=="staging"||enabled!==true||
  ![verifyCurrentOwnerAal2,verifyInstalledSchema,
    verifyNoOutboundProviders,coreRpc,emitSanitizedAgniObservation]
   .every(x=>typeof x==="function"))
  return stop("SIGNED_STAGING_WORKER_DISABLED");
 const signed=verifyAb7gIndependentManifest({
  manifest,signature,pinnedReviewerPublicKey,expectedCoreCommit,now
 });
 if(!signed.ok)return stop("PINNED_INDEPENDENT_REVIEW_REQUIRED");
 try{
  if(await verifyCurrentOwnerAal2(manifest.ownerId)!==true||
   await verifyInstalledSchema(manifest.migrationSha256)!==true||
   await verifyNoOutboundProviders()!==true)
   return stop("LIVE_OWNER_SCHEMA_OR_PROVIDER_DENIED");
  // AB7N: slow Auth/managed DB/provider probes must never consume a now-
  // expired reviewer lease then run a Core job with stale release authority.
  // Reverify signature+expiry using the actual clock immediately before claim.
  const currentTime=Date.now();
  const stillSigned=verifyAb7gIndependentManifest({
    manifest,signature,pinnedReviewerPublicKey,expectedCoreCommit,
    now:currentTime});
  if(!stillSigned.ok||currentTime>=manifest.expiresAtMs)
   return stop("INDEPENDENT_RELEASE_EXPIRED_DURING_PREFLIGHT");
  // The current signed manifest + read-only DB verification is the only
  // source of release evidence; no caller-provided 'approved' boolean.
  return await runAb7fCoreInternalWorker({
   environment:"staging",enabled:true,workerId,now,
   featureGates:{portal:"staging",workActions:"staging",
    notificationWorker:"staging"},
   rpc:coreRpc,
   verifyCurrentOperatorAal2:()=>verifyCurrentOwnerAal2(manifest.ownerId),
   verifyDeploymentAuthority:async()=>({
    kind:"CORE_TRUSTED_DEPLOYMENT_ATTESTATION",
    environment:"staging",scope:"STAFF_INTERNAL_OUTBOX_ONLY",
    independentReviewsVerified:true,signedReleaseDigestVerified:true,
    schemaInstalledAndReviewed:true,
    expiresAtMs:Math.min(manifest.expiresAtMs,Date.now()+180000)
   }),
   emitSanitizedAgniObservation
  });
 }catch{return stop("INTERNAL_SIGNED_RUN_OUTCOME_UNKNOWN");}
}
