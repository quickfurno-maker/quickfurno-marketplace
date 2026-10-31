import "server-only";
import {verifyVoxOwnerBearer,verifyVoxTeamLeaderBearer} from "./verifiedStaffBearer";
import {reconcileRc8PgSignedIntentOutcome,
 rc8SignedEodPublicationAuthorizationState} from "../../scripts/mvp/vox/rc8-pg-signed-intent-writer.mjs";

// Real Owner and distinct TL authentication + real PostgreSQL receipt proof.
// NEVER a publishing capability: the only output is a pending review case.
export const RC28_SIGNED_EOD_REVIEW_ROUTE_INSTALLED=false as const;
type Db={query:(sql:string,values?:unknown[])=>Promise<{rows:any[];rowCount:number}>;release:()=>void};
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HEX=/^[a-f0-9]{64}$/;
const deny=(reason:string)=>Object.freeze({ok:false,state:"HOLD",reason,
 publicationAuthorized:false,approved:false,providerMessagesSent:0});
type Pending={intentId:string;subjectId:string;expectedReceiptSha256:string};
const valid=(x:unknown):x is Pending=>{
 if(!x||typeof x!=="object"||Array.isArray(x))return false;
 const v=x as Record<string,unknown>;
 return Object.keys(v).sort().join("|")==="expectedReceiptSha256|intentId|subjectId"&&
  typeof v.intentId==="string"&&UUID.test(v.intentId)&&
  typeof v.subjectId==="string"&&UUID.test(v.subjectId)&&
  typeof v.expectedReceiptSha256==="string"&&HEX.test(v.expectedReceiptSha256);
};
export async function verifyRc28PendingEodForHumanReview(
 ownerAuthorization:string|null,leaderAuthorization:string|null,
 input:unknown,acquireClient:()=>Promise<Db>
){
 if(!valid(input)||typeof acquireClient!=="function")return deny("SIGNED_INTENT_INPUT_INVALID");
 let owner:string|null,leader:Awaited<ReturnType<typeof verifyVoxTeamLeaderBearer>>;
 try{
  [owner,leader]=await Promise.all([
   verifyVoxOwnerBearer(ownerAuthorization),verifyVoxTeamLeaderBearer(leaderAuthorization)
  ]);
 }catch{return deny("HUMAN_AAL2_VERIFICATION_UNAVAILABLE")}
 if(!owner||!leader||owner===leader.userId||leader.aal!=="aal2"||
    leader.expiresAtMs<=Date.now())return deny("DISTINCT_OWNER_AND_TL_AAL2_REQUIRED");
 // No caller may pass ownerId, teamLeaderId, publication flag or key signature.
 let proof;
 try{proof=await reconcileRc8PgSignedIntentOutcome({
  acquireClient,intentId:input.intentId,subjectId:input.subjectId,
  expectedReceiptSha256:input.expectedReceiptSha256
 })}catch{return deny("SIGNER_RECEIPT_RECONCILIATION_UNAVAILABLE")}
 const state=rc8SignedEodPublicationAuthorizationState(proof);
 if(proof.outcome!=="COMMITTED"||proof.ok!==true||
    proof.receiptSha256!==input.expectedReceiptSha256||
    state.publicationAuthorized!==false)
  return deny("SIGNED_INTENT_NOT_DURABLY_PENDING");
 // PostgreSQL reconciliation may wait on writer locks. Do not issue a
 // positive review after either human loses their current AAL2 authority
 // during that wait, even though publication remains strictly disabled.
 let currentOwner:string|null,currentLeader:Awaited<ReturnType<typeof verifyVoxTeamLeaderBearer>>;
 try{
  [currentOwner,currentLeader]=await Promise.all([
   verifyVoxOwnerBearer(ownerAuthorization),verifyVoxTeamLeaderBearer(leaderAuthorization)
  ]);
 }catch{return deny("HUMAN_AAL2_RECHECK_UNAVAILABLE")}
 if(currentOwner!==owner||!currentOwner||!currentLeader||
    currentLeader.userId!==leader.userId||currentOwner===currentLeader.userId||
    currentLeader.teamId!==leader.teamId||currentLeader.cityId!==leader.cityId||
    currentLeader.aal!=="aal2"||currentLeader.expiresAtMs<=Date.now())
  return deny("HUMAN_AAL2_REVOKED_DURING_RECONCILIATION");
 return Object.freeze({ok:true,state:"PENDING_RECEIPT_AWAITING_EXTERNAL_REVIEW",
  receiptSha256:proof.receiptSha256,approved:false,
  publicationAuthorized:false,providerMessagesSent:0,requiresIndependentReview:true});
}
