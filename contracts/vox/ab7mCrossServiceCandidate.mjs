/**
 * AB7M real cross-service candidate lock. This is a NO-SEND release REVIEW,
 * never a deploy API. Requires pinned independent ED25519 approval for the
 * exact core/jarvis/agni commits, separate current Owner GO and managed schema.
 */
import {verifyAb7gIndependentManifest}
 from "./ab7gSignedStagingManifest.mjs";
const exact=Object.freeze({
 // Previously certified pre-RC baseline, not a future-release SHA pin.
 core:"724d856fa7d3144f794c26b3fdbafd55cf36d4b3",
 jarvis:"0e6f432985b156bcee148a3521165d2285384da7",
 agni:"6fa59afe8627f9a585189d759daa5bee6648c359"});
const fail=reason=>Object.freeze({ok:false,reason,
 candidateLocked:false,canDeploy:false,productionAuthorized:false,
 outboundProviderAuthorized:false,workerSchedulerAuthorized:false});
export function inspectAb7mCrossServiceCandidate({
 environment,coreCommit,jarvisCommit,agniCommit,
 signedManifest,reviewSignature,pinnedReviewerPublicKey,
 flags,providerIsolationVerified=false,
 installedSchemaDigest,now=Date.now()
}={}){
 if(environment!=="staging"||
    !/^[a-f0-9]{40}$/.test(coreCommit??"")||
    jarvisCommit!==exact.jarvis||agniCommit!==exact.agni)
  return fail("EXACT_REVIEWED_THREE_REPOSITORY_DIGESTS_REQUIRED");
 if(!flags||typeof flags!=="object"||
   flags.voxPortal!=="staging"||flags.staffWork!=="staging"||
   flags.operatorAtomic!=="staging"||
   flags.whatsappOutbound!=="disabled"||
   flags.notificationProvider!=="disabled"||
   flags.agentAutonomy!=="disabled"||
   flags.productionActions!=="disabled"||
   providerIsolationVerified!==true)
  return fail("NO_SEND_STAGE_ONLY_FLAGS_AND_PROVIDER_ISOLATION_REQUIRED");
 const review=verifyAb7gIndependentManifest({
  manifest:signedManifest,signature:reviewSignature,
  pinnedReviewerPublicKey,expectedCoreCommit:coreCommit,now
 });
 if(!review.ok||signedManifest.coreCommit!==coreCommit||
    signedManifest.jarvisCommit!==jarvisCommit||
    signedManifest.agniCommit!==agniCommit)
  return fail("INDEPENDENT_REVIEW_SIGNATURE_AND_SERVICE_COMMIT_BINDING_MISSING");
 if(installedSchemaDigest!==signedManifest.migrationSha256)
  return fail("EXACT_MANAGED_SCHEMA_DIGEST_NOT_PROVEN");
 return Object.freeze({
  ok:true,candidateLocked:true,
  exactCommits:Object.freeze({core:coreCommit,jarvis:exact.jarvis,agni:exact.agni}),
  reviewExpiresAtMs:review.expiresAtMs,
  canDeploy:false,productionAuthorized:false,outboundProviderAuthorized:false,
  workerSchedulerAuthorized:false,
  independentReviewSignatureVerified:true,
  needsSeparateCurrentOwnerGo:true,
  needsDbGrantAndRollbackApproval:true,
  needsGenuineOwnerAndTeamLeaderAal2:true,
  needsAuthenticatedNoSendStagingE2E:true
 });
}
export const ab7mPinnedServiceHeads=exact;
