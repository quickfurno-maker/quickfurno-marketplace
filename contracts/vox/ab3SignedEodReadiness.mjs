/**
 * AB-3: cryptographic source seal verification prior to Core EOD readiness.
 * Proof is NOT official EOD; four independent source writer public keys
 * must come from protected server configuration, never caller/browser input.
 */
import {createPublicKey,verify} from "node:crypto";
import {attestAb2FourSourceReviewWindow} from "./ab2FourSourceReadiness.mjs";
const SOURCES=["CORE_WORK_LEDGER","CRM_AAROHI","SUPPORT_DESK","CORE_CONVERSATION"];
const FIELDS=["schema","source","staffId","teamId","cityId","businessDate",
 "eventCount","lastRevision","sourceSha256","issuedAtMs","expiresAtMs"];
const denied=reason=>Object.freeze({ok:false,reason,
 official:false,eligibleForOfficialSubmission:false,
 sourceCount:0,providerMessagesSent:0});
export function canonicalAb3EodSeal(payload){
 if(!payload||typeof payload!=="object"||Array.isArray(payload)||
  Object.keys(payload).sort().join("|")!==FIELDS.slice().sort().join("|"))
  throw Error("INVALID_AB3_EOD_SEAL");
 return JSON.stringify(FIELDS.map(k=>[k,payload[k]]));
}
export async function verifyAb3SignedEodReadiness({
 scope,businessDate,evidence,publicKeysBySource,
 verifyCurrentStaff,verifyDbSourceSeal,verifyExactSourceObjectGrants,
 now=Date.now()
}={}){
 if(!scope||!Array.isArray(evidence)||evidence.length!==4||
  !publicKeysBySource||typeof publicKeysBySource!=="object"||
  Object.keys(publicKeysBySource).sort().join("|")!==SOURCES.slice().sort().join("|")||
  !Number.isSafeInteger(now)||now<=0)
  return denied("FOUR_PINNED_SOURCE_KEYS_REQUIRED");
 const seals=[],seen=new Set();
 for(const row of evidence){
  if(!row||typeof row!=="object"||Array.isArray(row)||
   Object.keys(row).sort().join("|")!=="payload|signature"||
   !row.payload||!SOURCES.includes(row.payload.source)||
   seen.has(row.payload.source)||
   typeof row.signature!=="string"||
   !/^[A-Za-z0-9_-]{80,140}$/.test(row.signature)||
   !Number.isSafeInteger(row.payload.issuedAtMs)||
   !Number.isSafeInteger(row.payload.expiresAtMs)||
   row.payload.issuedAtMs>now+30000||
   row.payload.issuedAtMs<now-300000||
   row.payload.expiresAtMs<=now||
   row.payload.expiresAtMs>row.payload.issuedAtMs+300000)
   return denied("UNTRUSTED_SOURCE_SIGNATURE_OR_EXPIRY");
  let verified=false;
  try{
   const publicKey=publicKeysBySource[row.payload.source];
   if(typeof publicKey!=="string"||publicKey.length<70)throw Error("key");
   const signature=Buffer.from(row.signature,"base64url");
   verified=signature.length===64&&verify(null,
    Buffer.from(canonicalAb3EodSeal(row.payload)),
    createPublicKey(publicKey),signature);
  }catch{verified=false;}
  if(!verified)return denied("SOURCE_SIGNATURE_INVALID");
  seen.add(row.payload.source);
  seals.push({...row.payload,attributableStaffOnly:true,
   watermarkSignatureVerified:true,currentGrantProvenanceVerified:true});
 }
 if(seen.size!==4)return denied("MISSING_CANONICAL_SOURCE");
 const result=await attestAb2FourSourceReviewWindow({
  scope,businessDate,sourceSeals:seals,now,verifyCurrentStaff,
  verifyDbSourceSeal,verifyExactSourceObjectGrants
 });
 if(result.ok!==true)return denied("CURRENT_DB_OR_STAFF_PROOF_FAILED");
 return Object.freeze({...result,
  schema:"qf.vox.ab3.signed-four-source-review-readiness.v1",
  signatureVerifiedForAllFour:true,official:false,
  eligibleForOfficialSubmission:false,
  requiresIndependentTeamLeaderAal2:true,
  requiresAtomicCoreEodSubmission:true});
}
