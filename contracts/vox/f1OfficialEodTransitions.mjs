/**
 * F1-B reviewed four-source daily EOD command gate. Read proof never
 * becomes an official Staff performance total without a Core transaction
 * which rechecks source checksums/watermarks and Staff grants under lock.
 */
import {readCertifiedFourSourceEod} from "./f1CertifiedFourSourceEod.mjs";
const ID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[89ab][0-9a-f]{12}$/i;
const uuid=v=>typeof v==="string"&&
 /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
const denied=reason=>Object.freeze({ok:false,reason,official:false,
 providerMessagesSent:0});
export async function submitVerifiedFourSourceEod({
 db,scope,businessDate,secret,nonce,verifyCurrentScope,
 verifyExactObjectGrant,commitRecheckedSnapshot,now=Date.now()
}={}){
 if(!uuid(nonce)||typeof commitRecheckedSnapshot!=="function")
  return denied("SIGNED_ATOMIC_EOD_COMMIT_REQUIRED");
 const proof=await readCertifiedFourSourceEod({db,scope,businessDate,secret,
  verifyCurrentScope,verifyExactObjectGrant,now});
 if(!proof.ok)return denied(proof.reason);
 const sources=proof.sources;
 if(!Array.isArray(sources)||sources.length!==4||
  sources.some(s=>!Number.isSafeInteger(s.verifiedEventCount)||
   s.verifiedEventCount<0))
  return denied("SOURCES_NOT_ATOMICALLY_CERTIFIED");
 try{
  if((await verifyCurrentScope(scope))!==true)
   return denied("STAFF_REVOKED_BEFORE_COMMIT");
  // The transaction MUST verify the exact current same snapshot under
  // serializable row locks and validate independently signed watermarks.
  const receipt=await commitRecheckedSnapshot({
   actorId:scope.userId,teamId:scope.teamId,cityId:scope.cityId,
   businessDate,nonce,
   expectedCounts:Object.freeze(sources.map(s=>Object.freeze({
    source:s.source,count:s.verifiedEventCount}))),
   expectedTotal:proof.rollup.totalEvents
  });
  if(!receipt||Object.keys(receipt).sort().join("|")!==
   ["reportId","state","revision","eventCount","sourcesSealed",
    "staffGrantsRecheckedInTransaction","snapshotRecheckedInTransaction",
    "nonceConsumedInTransaction"].sort().join("|")||
   !uuid(receipt.reportId)||receipt.state!=="PENDING_REVIEW"||
   receipt.revision!==0||receipt.eventCount!==proof.rollup.totalEvents||
   receipt.sourcesSealed!==4||receipt.staffGrantsRecheckedInTransaction!==true||
   receipt.snapshotRecheckedInTransaction!==true||
   receipt.nonceConsumedInTransaction!==true)
   return denied("ATOMIC_EOD_SNAPSHOT_UNVERIFIED");
  return Object.freeze({ok:true,official:true,
   schema:"qf.vox.f1.official-eod-submission.v1",
   reportId:receipt.reportId,eventCount:receipt.eventCount,
   state:"PENDING_REVIEW",revision:0,
   externalMessagesSent:0,providerMessagesSent:0});
 }catch{return denied("CORE_EOD_TRANSACTION_UNAVAILABLE");}
}
export async function acknowledgeIndependentFourSourceEod({
 reviewer,reportId,expectedRevision=0,nonce,verifyCurrentLeader,
 decideInDatabase
}={}){
 if(!uuid(reportId)||!uuid(nonce)||!reviewer||
  !uuid(reviewer.userId)||!uuid(reviewer.teamId)||!uuid(reviewer.cityId)||
  reviewer.currentAal!=="aal2"||reviewer.role!=="team_leader"||
  expectedRevision!==0||typeof verifyCurrentLeader!=="function"||
  typeof decideInDatabase!=="function")
  return denied("INDEPENDENT_TL_AAL2_REQUIRED");
 try{
  if((await verifyCurrentLeader(reviewer))!==true)
   return denied("REVOKED_OR_UNVERIFIED_TEAM_LEADER");
  const r=await decideInDatabase({reviewerId:reviewer.userId,
   teamId:reviewer.teamId,cityId:reviewer.cityId,reportId,
   expectedRevision,nonce});
  if(!r||Object.keys(r).sort().join("|")!==
   ["reportId","state","revision","reviewerId","staffId",
    "sourceSealRechecked","independentReviewerRecheckedInTransaction",
    "nonceConsumedInTransaction"].sort().join("|")||
   r.reportId!==reportId||r.reviewerId!==reviewer.userId||
   !uuid(r.staffId)||r.staffId===reviewer.userId||
   r.revision!==1||r.state!=="ACKNOWLEDGED"||
   r.sourceSealRechecked!==true||
   r.independentReviewerRecheckedInTransaction!==true||
   r.nonceConsumedInTransaction!==true)
   return denied("DB_ATOMIC_INDEPENDENT_ACK_UNVERIFIED");
  return Object.freeze({ok:true,official:true,reportId,
   state:"ACKNOWLEDGED",revision:1,providerMessagesSent:0});
 }catch{return denied("DB_TL_ACK_UNAVAILABLE");}
}
