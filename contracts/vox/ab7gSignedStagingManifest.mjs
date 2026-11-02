/** AB7G independent release-evidence verifier, NOT a deploy command.
 * Verify a pinned AppSec/DBA review signature independent of Core Owner.
 * Never accept self-asserted 'approved' booleans as authority.
 */
import {createPublicKey,verify} from "node:crypto";
const sha=/^[a-f0-9]{40}$/;
const digest=/^[a-f0-9]{64}$/;
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const fail=reason=>Object.freeze({ok:false,reason,canDeploy:false});
export function canonicalAb7gManifest(m){
 const fields=["schema","environment","coreCommit","jarvisCommit",
 "agniCommit","migrationSha256","rollbackSha256","ownerId",
 "reviewerId","issuedAtMs","expiresAtMs","reviewScope"];
 if(!m||typeof m!=="object"||Array.isArray(m)||
  Object.keys(m).sort().join("|")!==fields.sort().join("|"))
  return null;
 return JSON.stringify(Object.fromEntries(fields.map(k=>[k,m[k]])));
}
export function verifyAb7gIndependentManifest({
 manifest,signature,pinnedReviewerPublicKey,
 expectedCoreCommit,now=Date.now()
}={}){
 if(!sha.test(expectedCoreCommit??"")||!canonicalAb7gManifest(manifest)||
  manifest.schema!=="qf.vox.ab7g.independent-review.v1"||
  manifest.environment!=="staging"||
  manifest.coreCommit!==expectedCoreCommit||
  !sha.test(manifest.jarvisCommit??"")||
  !sha.test(manifest.agniCommit??"")||
  !digest.test(manifest.migrationSha256??"")||
  !digest.test(manifest.rollbackSha256??"")||
  !UUID.test(manifest.ownerId??"")||
  !UUID.test(manifest.reviewerId??"")||
  manifest.ownerId===manifest.reviewerId||
  manifest.reviewScope!=="DBA_APPSEC_STAGING_ONLY"||
  !Number.isSafeInteger(now)||!Number.isSafeInteger(manifest.issuedAtMs)||
  !Number.isSafeInteger(manifest.expiresAtMs)||
  manifest.issuedAtMs>now||now-manifest.issuedAtMs>15*60*1000||
  manifest.expiresAtMs<=now||
  manifest.expiresAtMs-manifest.issuedAtMs>15*60*1000||
  typeof signature!=="string"||
  !/^[A-Za-z0-9_-]{80,100}$/.test(signature)||
  typeof pinnedReviewerPublicKey!=="string")
  return fail("CURRENT_PINNED_INDEPENDENT_STAGING_MANIFEST_REQUIRED");
 try{
  const key=createPublicKey(pinnedReviewerPublicKey);
  if(key.asymmetricKeyType!=="ed25519")return fail("PINNED_ED25519_REQUIRED");
  if(!verify(null,Buffer.from(canonicalAb7gManifest(manifest)),
   key,Buffer.from(signature,"base64url")))
   return fail("REVIEW_SIGNATURE_INVALID");
  return Object.freeze({ok:true,canDeploy:false,
   schema:"qf.vox.ab7g.verified-review-v1",
   coreCommit:manifest.coreCommit,
   migrationSha256:manifest.migrationSha256,
   expiresAtMs:manifest.expiresAtMs,
   signedReviewVerified:true,
   requiresSeparateOwnerGo:true,
   requiresCurrentDatabasePreflight:true,
   productionAuthorized:false});
 }catch{return fail("PINNED_REVIEW_SIGNATURE_UNAVAILABLE");}
}
