/**
 * AB-7M real identity-cutover assessment — READ ONLY.
 * A cryptographically pinned independent first TL bootstrap signature
 * is mandatory. No account creation, enrollment, grants or deployment.
 */
import {createPublicKey,verify} from "node:crypto";
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const sha=/^[a-f0-9]{64}$/;
const recent=(v,now)=>Number.isSafeInteger(v)&&v<=now&&now-v<=60000;
const stop=reason=>Object.freeze({
 verified:false,releaseAuthorized:false,canBootstrap:false,
 canMutateAuth:false,reason,requiresIndependentReview:true,
 manualSteps:["ENROLL_GENUINE_OWNER_AAL2","APPROVE_FIRST_NEUTRAL_TEAM_LEADER",
 "ENROLL_SEPARATE_REAL_TEAM_LEADER_AAL2","RECHECK_CORE_MEMBERSHIP_AND_SESSION"]});
export function canonicalAb7mFirstTlReview(m){
 if(!m||typeof m!=="object"||Array.isArray(m))return null;
 const fields=["schema","environment","ownerId","teamLeaderId",
 "reviewerId","firstTlApprovalDigest","reviewedAtMs","reviewExpiresAtMs"];
 if(Object.keys(m).sort().join("|")!==fields.sort().join("|"))return null;
 return JSON.stringify(Object.fromEntries(fields.map(k=>[k,m[k]])));
}
function verifiedIndependentReview({signedReview,reviewSignature,pinnedReviewerPublicKey,now}){
 if(!canonicalAb7mFirstTlReview(signedReview)||
    signedReview.schema!=="qf.vox.ab7m.first-tl-independent-review.v1"||
    signedReview.environment!=="staging"||
    !uuid.test(signedReview.reviewerId??"")||
    signedReview.reviewerId===signedReview.ownerId||
    signedReview.reviewerId===signedReview.teamLeaderId||
    !recent(signedReview.reviewedAtMs,now)||
    !Number.isSafeInteger(signedReview.reviewExpiresAtMs)||
    signedReview.reviewExpiresAtMs<=now||
    signedReview.reviewExpiresAtMs-signedReview.reviewedAtMs>600000||
    typeof reviewSignature!=="string"||
    !/^[A-Za-z0-9_-]{80,100}$/.test(reviewSignature)||
    typeof pinnedReviewerPublicKey!=="string")return false;
 try{
  const key=createPublicKey(pinnedReviewerPublicKey);
  return key.asymmetricKeyType==="ed25519"&&verify(null,
   Buffer.from(canonicalAb7mFirstTlReview(signedReview)),key,
   Buffer.from(reviewSignature,"base64url"));
 }catch{return false;}
}
export async function inspectAb7mIdentityGate({
 environment,enabled=false,ownerId,teamLeaderId,firstTlApprovalDigest,
 signedReview,reviewSignature,pinnedReviewerPublicKey,
 readCurrentOwnerFromAuth,readCurrentNeutralLeaderFromAuthAndCore,
 now=Date.now()
}={}){
 if(environment!=="staging"||enabled!==true||
  !uuid.test(ownerId??"")||!uuid.test(teamLeaderId??"")||
  ownerId===teamLeaderId||!sha.test(firstTlApprovalDigest??"")||
  !Number.isSafeInteger(now)||now<=0||
  ![readCurrentOwnerFromAuth,readCurrentNeutralLeaderFromAuthAndCore]
    .every(f=>typeof f==="function"))
  return stop("GENUINE_DISTINCT_AAL2_STAGING_PRINCIPALS_REQUIRED");
 if(signedReview?.ownerId!==ownerId||
   signedReview?.teamLeaderId!==teamLeaderId||
   signedReview?.firstTlApprovalDigest!==firstTlApprovalDigest||
   !verifiedIndependentReview({signedReview,reviewSignature,
    pinnedReviewerPublicKey,now}))
  return stop("PINNED_INDEPENDENT_BOOTSTRAP_SIGNATURE_UNVERIFIED");
 try{
  const [owner,tl]=await Promise.all([
   readCurrentOwnerFromAuth(ownerId),readCurrentNeutralLeaderFromAuthAndCore(teamLeaderId)
  ]);
  if(owner?.userId!==ownerId||owner.superadminRole!=="Superadmin"||
     owner.profileActive!==true||owner.currentAal!=="aal2"||
     !Number.isInteger(owner.verifiedMfaFactors)||
     owner.verifiedMfaFactors<1||!recent(owner.checkedAtMs,now))
    return stop("OWNER_REAL_SUPABASE_AAL2_NOT_VERIFIED");
  if(tl?.userId!==teamLeaderId||tl.profileRole!==null||
     tl.profileActive!==true||tl.currentAal!=="aal2"||
     !Number.isInteger(tl.verifiedMfaFactors)||
     tl.verifiedMfaFactors<1||tl.staffRole!=="team_leader"||
     tl.membershipActive!==true||tl.teamActive!==true||
     tl.revokedAt!==null||tl.memberExpiresAtMs<=now||
     !recent(tl.checkedAtMs,now))
    return stop("NEUTRAL_TEAM_LEADER_REAL_AAL2_NOT_VERIFIED");
  return Object.freeze({
   verified:true,releaseAuthorized:false,canBootstrap:false,
   canMutateAuth:false,requiresIndependentReview:true,
   evidenceKind:"AB7M_CURRENT_READONLY_IDENTITY_REVIEW",
   verifiedAtMs:now,ownerId,teamLeaderId,
   approvedSubjectDigest:firstTlApprovalDigest,
   manualSteps:["INDEPENDENT_DBA_APPSEC_APPROVE","OWNER_SEPARATE_SIGNED_GO",
    "STAGING_SIGNED_DEPLOY_AND_AUTHENTICATED_E2E"]});
 }catch{return stop("AUTH_PROVIDER_OR_INDEPENDENT_REVIEW_UNAVAILABLE");}
}
