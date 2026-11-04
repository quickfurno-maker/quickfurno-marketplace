/** Exact-release attestation verification. Pure, offline; never executes a DB change.
 * Requires detached Ed25519 signatures over an identical canonical payload by
 * separate, pre-trusted independent DBA and AppSec reviewers + SRE.
 */
import {createPublicKey, verify} from "node:crypto";
const ROLES=Object.freeze(["DBA","APPSEC","SRE"]);
const REF=Object.freeze({
 staging:"uckafzuochmbvtiodmcl",
 production:"yqpgcsduqbxulrlzwzap"
});
export const SHAS=Object.freeze({
 staging:"720165400e7b8807cafec19d81af9b9c606fd234a1d3b95fd6b285d996fbd1a5",
 production:"679457e1fefb79fbb2996f11e3bad6077fce476c430fa3996f82565066bf516f"
});
export const FINGERPRINTS=Object.freeze({
 staging:{vendors:"b3437e2ec13bcc794f77783eab598749",leads:"de829b5d5c1f5e2109407805454bcbf7"},
 production:{vendors:"767228fc486c378f500df83af36da4b6",leads:"fccc2594dd5ce49bc12c590f6f9f2dff"}
});
export function canonical(v){
 if(v===null||typeof v==="boolean"||typeof v==="number"||typeof v==="string")return JSON.stringify(v);
 if(Array.isArray(v))return "["+v.map(canonical).join(",")+"]";
 if(v&&Object.getPrototypeOf(v)===Object.prototype){
  return "{"+Object.keys(v).sort().map(k=>JSON.stringify(k)+":"+canonical(v[k])).join(",")+"}";
 }
 throw Error("UNSUPPORTED_ATTESTATION_TYPE");
}
const sha40=v=>typeof v==="string"&&/^[0-9a-f]{40}$/i.test(v);
const sha64=v=>typeof v==="string"&&/^[0-9a-f]{64}$/i.test(v);
const safeUtc=v=>typeof v==="string"&&!Number.isNaN(Date.parse(v))&&/Z$/.test(v);
export function evaluateSignedRelease(envelope,trust,asOf,observedProcedureSha256){
 const blockers=[];
 const deny=x=>{if(!blockers.includes(x))blockers.push(x);};
 const p=envelope?.payload;
 if(!p||!["staging","production"].includes(p.environment))deny("TARGET_INVALID");
 else {
  if(p.projectRef!==REF[p.environment])deny("PROJECT_MISMATCH");
  if(p.backupSha256?.toLowerCase()!==SHAS[p.environment])deny("BACKUP_PIN_MISMATCH");
  for(const k of ["vendors","leads"]){
   if(p.fingerprints?.[k]!==FINGERPRINTS[p.environment][k])deny("IDSET_MISMATCH:"+k);
  }
  if(p.environment==="production"&&p.stagingCertified!==true)deny("STAGING_NOT_CERTIFIED");
 }
 if(!sha40(p?.candidateCommit))deny("COMMIT_NOT_PINNED");
 // A signed release must bind the exact reviewed managed procedure bytes,
 // not only source commit + backup + private ID allowlist.
 if(!sha64(p?.procedureSha256))deny("EXECUTABLE_SQL_NOT_PINNED");
 // This digest must be computed by the operator from the ACTUAL managed
 // executable artifact bytes; accepting it from the signed payload itself
 // would provide no independent execution-time identity check.
 if(!sha64(observedProcedureSha256)||
    p?.procedureSha256?.toLowerCase()!==observedProcedureSha256?.toLowerCase())
  deny("REVIEWED_SQL_DOES_NOT_MATCH_EXECUTION_ARTIFACT");
 if(p?.environment==="production"&&!sha64(p?.stagingPostflightEvidenceSha256))
  deny("STAGING_POSTFLIGHT_EVIDENCE_NOT_PINNED");
 if(!sha64(p?.encryptedAllowlistSha256))deny("PRIVATE_IDSET_HASH_REQUIRED");
 if(!sha64(p?.recoveryEvidenceSha256))deny("RECOVERY_EVIDENCE_NOT_HASHED");
 if(!sha64(p?.freezeEvidenceSha256))deny("FREEZE_EVIDENCE_NOT_HASHED");
 for(const required of ["fullRestoreVerified","immutableHistoryExceptionReviewed",
   "authOwnerExclusionVerified","providerFreezeVerified","legalRetentionDispositionReviewed",
   "rollbackRehearsalPassed"]){
  if(p?.controls?.[required]!==true)deny("CONTROL_UNPROVEN:"+required);
 }
 if(!safeUtc(p?.expiresAt)||!safeUtc(p?.issuedAt)||!safeUtc(asOf)||
    Date.parse(p?.expiresAt)<=Date.parse(asOf)||Date.parse(p?.issuedAt)>Date.parse(asOf)||
    Date.parse(p?.expiresAt)-Date.parse(p?.issuedAt)>30*60*1000){
   deny("STALE_OR_INVALID_APPROVAL_WINDOW");
 }
 if(!Array.isArray(envelope?.signatures)||envelope.signatures.length!==ROLES.length){
   deny("THREE_INDEPENDENT_SIGNATURES_REQUIRED");
 }else{
  const roles=new Set(),keys=new Set(),identities=new Set();
  for(const entry of envelope.signatures){
   if(!ROLES.includes(entry?.role)||roles.has(entry.role)){deny("ROLE_DUPLICATED_OR_UNKNOWN");continue}
   roles.add(entry.role);
   if(typeof entry?.keyId!=="string"||keys.has(entry.keyId)||!trust?.[entry.role]?.[entry.keyId]){
    deny("REVIEWER_TRUST_OR_KEY_COLLISION");continue;
   }
   keys.add(entry.keyId);
   const signer=trust[entry.role][entry.keyId];
   if(!signer?.independent||!signer?.identity||identities.has(signer.identity)){
    deny("REVIEWER_NOT_INDEPENDENT");continue;
   }
   identities.add(signer.identity);
   try{
    const signed=Buffer.from(canonical(p));
    if(!verify(null,signed,createPublicKey(signer.publicKey),
      Buffer.from(entry.signature??"","base64")))deny("INVALID_SIGNATURE:"+entry.role);
   }catch{deny("INVALID_SIGNATURE:"+entry.role)}
  }
  if(roles.size!==3||keys.size!==3||identities.size!==3)deny("INCOMPLETE_INDEPENDENT_REVIEW");
 }
 return Object.freeze({
  decision:blockers.length?"HOLD":"SIGNED_REVIEW_EVIDENCE_PRESENT_MANUAL_CHANGE_REQUIRED",
  executable:false, blockers:Object.freeze(blockers)
 });
}
