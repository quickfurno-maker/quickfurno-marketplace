import test from "node:test";import assert from "node:assert/strict";
import {generateKeyPairSync,sign} from "node:crypto";
import {inspectAb7mIdentityGate as check,canonicalAb7mFirstTlReview}
 from "../../../contracts/vox/ab7mIdentityCutover.mjs";
const id=n=>"00000000-0000-4000-8000-"+String(n).padStart(12,"0");
const now=Date.now(),hash="a".repeat(64),key=generateKeyPairSync("ed25519");
const review=()=>({schema:"qf.vox.ab7m.first-tl-independent-review.v1",
 environment:"staging",ownerId:id(1),teamLeaderId:id(2),reviewerId:id(3),
 firstTlApprovalDigest:hash,reviewedAtMs:now-1000,reviewExpiresAtMs:now+100000});
const signReview=x=>sign(null,Buffer.from(canonicalAb7mFirstTlReview(x)),
 key.privateKey).toString("base64url");
const spec=()=>({environment:"staging",enabled:true,ownerId:id(1),teamLeaderId:id(2),
 firstTlApprovalDigest:hash,now,signedReview:review(),
 reviewSignature:signReview(review()),
 pinnedReviewerPublicKey:key.publicKey.export({type:"spki",format:"pem"}),
 readCurrentOwnerFromAuth:async()=>({userId:id(1),superadminRole:"Superadmin",
   profileActive:true,currentAal:"aal2",verifiedMfaFactors:1,checkedAtMs:now-100}),
 readCurrentNeutralLeaderFromAuthAndCore:async()=>({userId:id(2),
   profileRole:null,profileActive:true,currentAal:"aal2",verifiedMfaFactors:1,
   staffRole:"team_leader",membershipActive:true,teamActive:true,
   revokedAt:null,memberExpiresAtMs:now+3600000,checkedAtMs:now-100})});
test("AB7M valid real cryptographic reviewer signature and distinct AAL2 principals never auto-release",async()=>{
 const x=await check(spec());assert.equal(x.verified,true,x.reason);
 assert.equal(x.releaseAuthorized,false);assert.equal(x.canBootstrap,false);
 assert.equal(x.canMutateAuth,false);
});
test("AB7M forged/expired reviewer and owner=TL, stale Auth and revoked member deny",async()=>{
 const a=spec(),cases=[
 {ownerId:id(2)},{enabled:false},{environment:"production"},
 {reviewSignature:"a".repeat(86)},
 {signedReview:{...review(),reviewerId:id(1)}},
 {signedReview:{...review(),reviewExpiresAtMs:now-100}},
 {readCurrentOwnerFromAuth:async()=>({...await a.readCurrentOwnerFromAuth(),currentAal:"aal1"})},
 {readCurrentNeutralLeaderFromAuthAndCore:async()=>({...await a.readCurrentNeutralLeaderFromAuthAndCore(),membershipActive:false})},
 {readCurrentNeutralLeaderFromAuthAndCore:async()=>({...await a.readCurrentNeutralLeaderFromAuthAndCore(),verifiedMfaFactors:0})},
 {readCurrentOwnerFromAuth:async()=>({...await a.readCurrentOwnerFromAuth(),checkedAtMs:now-61000})}
 ];
 for(const patch of cases){const x=await check({...spec(),...patch});
  assert.equal(x.verified,false,x.reason);assert.equal(x.releaseAuthorized,false);}
});
test("AB7M Auth provider failure denies; no mutation",async()=>{
 const x=await check({...spec(),readCurrentOwnerFromAuth:async()=>{throw Error("AUTH_DOWN")}});
 assert.equal(x.verified,false);assert.equal(x.canMutateAuth,false);
});
