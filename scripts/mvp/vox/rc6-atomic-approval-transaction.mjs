/**
 * VOX FINAL-1 / Track C: fail-closed atomic approval transaction protocol.
 * SOURCE-ONLY. A passing simulation is not a database writer, an Owner/TL
 * enrolment or approval. No live route imports this module.
 *
 * The durable ledger claim and attested-intent INSERT MUST be on one DB
 * transaction handle. A separate prepare->commit RPC loses rollback atomicity.
 */
import {prepareRc4SignedApproval,RC4_HUMAN_APPROVED_REGISTRY_FINGERPRINTS}
 from "../../../contracts/vox/rc4ApprovalPipeline.mjs";

export const RC6_APPROVAL_RELEASE_GATE=Object.freeze({
 verifiedDbWriterInstalled:false,independentHumanKeysEnrolled:false,
 humanDbaAppsecReviewed:false
});
const denied=reason=>Object.freeze({ok:false,reason,sourceOnly:true,
 committed:false,approved:false,canAuthorize:false,officialEodEnabled:false});
const METHODS=["recheckCurrentActors","readCurrentRevocations",
 "claimAll","insertVerifiedIntent","commit","rollback"];
const opened=g=>g?.verifiedDbWriterInstalled===true&&
 g?.independentHumanKeysEnrolled===true&&g?.humanDbaAppsecReviewed===true;
const sameReceipt=(r,request,prep)=>!!r&&Object.keys(r).sort().join("|")===
 "cityId|digest|nonceCount|ownerId|subjectId|teamId|teamLeaderId|type"&&
 r.type===request.type&&r.subjectId===request.subjectId&&
 r.digest===request.digest&&r.teamId===request.teamId&&
 r.cityId===request.cityId&&r.ownerId===prep.ownerId&&
 r.teamLeaderId===prep.teamLeaderId&&r.nonceCount===2;

/**
 * TEST/CONTRACT ONLY. Caller-supplied gate+fingerprints are never accepted by
 * the production wrapper. Only a reviewed native, DB-verified writer may use
 * these method shapes after an independent release decision.
 */
export async function simulateRc6AtomicApprovalTransaction({
 request,ownerAuth,teamLeaderAuth,registry,beginTransaction,now=Date.now(),
 approvedRegistryFingerprints=RC4_HUMAN_APPROVED_REGISTRY_FINGERPRINTS
}={},gate=RC6_APPROVAL_RELEASE_GATE){
 if(!opened(gate))return denied("APPROVAL_RELEASE_GATE_HARD_OFF");
 if(typeof beginTransaction!=="function")return denied("TRANSACTION_REQUIRED");
 let tx,settled=false;
 try{
  tx=await beginTransaction();
  if(!tx||METHODS.some(k=>typeof tx[k]!=="function")){
   try{if(typeof tx?.rollback==="function")await tx.rollback();}catch{}
   return denied("TRANSACTION_INTERFACE_INVALID");
  }
  const rollback=async reason=>{
   if(!settled){settled=true;try{await tx.rollback();}catch{}}
   return denied(reason);
  };
  try{
   // Trusted source MUST re-read current human memberships, AAL2 and key
   // revocations inside the same transaction before any nonce claim.
   const active=await tx.recheckCurrentActors({ownerAuth,teamLeaderAuth});
   if(active!==true)return await rollback("ACTORS_NOT_CURRENT");
   const revocations=await tx.readCurrentRevocations();
   const prep=await prepareRc4SignedApproval({request,ownerAuth,teamLeaderAuth,
    registry,approvedRegistryFingerprints,revocations,now,
    ledger:{durable:true,claimAll:args=>tx.claimAll(args)}});
   if(!prep.ok)return await rollback(prep.reason);
   const receipt=await tx.insertVerifiedIntent({
    type:request.type,subjectId:request.subjectId,digest:request.digest,
    teamId:request.teamId,cityId:request.cityId,
    ownerId:prep.ownerId,teamLeaderId:prep.teamLeaderId,nonceCount:2});
   if(!sameReceipt(receipt,request,prep))
     return await rollback("ATOMIC_RECEIPT_UNVERIFIED");
   settled=true;
   try{await tx.commit();}catch{return denied("COMMIT_STATE_UNKNOWN");}
   // Even in the simulation: no signed production activation or official EOD.
   return Object.freeze({ok:true,sourceOnly:true,committed:true,
     approved:false,canAuthorize:false,officialEodEnabled:false,
     ownerId:prep.ownerId,teamLeaderId:prep.teamLeaderId});
  }catch{return await rollback("TX_FAILED_ROLLED_BACK");}
 }catch{return denied("TX_BEGIN_FAILED");}
}
export function commitRc6AtomicApprovalProduction(options){
 return simulateRc6AtomicApprovalTransaction({
  ...options,approvedRegistryFingerprints:RC4_HUMAN_APPROVED_REGISTRY_FINGERPRINTS
 },RC6_APPROVAL_RELEASE_GATE);
}
