// VOX-L5: verify the CRYPTOGRAPHIC consistency of reviewer packets.
// DOES NOT verify a real person's identity, external registry provenance,
// independence or grant release authority. Trusted root keys must be
// provisioned through approved offline human process, not source or browser.
import {createPublicKey,verify as edVerify} from "node:crypto";
const SHA=/^[a-f0-9]{64}$/i,ID=/^[a-z0-9][a-z0-9._:-]{7,99}$/i;
const GATES=["DBA","APPSEC","FIRST_TEAM_LEADER"];
const exact=(v,keys)=>v!==null&&typeof v==="object"&&!Array.isArray(v)&&
 Object.keys(v).sort().join("|")===[...keys].sort().join("|");
const blocked=reason=>Object.freeze({ok:false,reason,
 cryptographicPacketsVerified:0,
 independentHumanIdentitiesVerified:false,reviewersEngaged:false,
 protectedStagingPermitted:false,productionPermitted:false});
export function verifyIndependentReviewerPackets({
 sourceSha,ownerRef,packets,registry,now=Date.now()
}={}){
 if(typeof sourceSha!=="string"||!SHA.test(sourceSha)||
  typeof ownerRef!=="string"||!ID.test(ownerRef)||
  !Number.isSafeInteger(now)||now<=0||
  !Array.isArray(packets)||packets.length!==3||
  !Array.isArray(registry)||registry.length!==3)
  return blocked("TRUSTED_SIGNER_REGISTRY_AND_THREE_PACKETS_REQUIRED");
 const seenKeys=new Set(),keys=new Map();
 for(const r of registry){
  if(!exact(r,["gate","reviewerRef","publicKeyPem"])||
   !GATES.includes(r.gate)||!ID.test(r.reviewerRef)||r.reviewerRef===ownerRef||
   typeof r.publicKeyPem!=="string"||r.publicKeyPem.length<80||
   r.publicKeyPem.length>2048||keys.has(r.gate)||seenKeys.has(r.reviewerRef))
   return blocked("REGISTRY_ROLE_OR_INDEPENDENCE_METADATA_INVALID");
  try{
   const pk=createPublicKey(r.publicKeyPem);
   if(pk.asymmetricKeyType!=="ed25519")return blocked("ED25519_SIGNER_ONLY");
  }catch{return blocked("REVIEWER_KEY_INVALID");}
  seenKeys.add(r.reviewerRef);keys.set(r.gate,r);
 }
 const verifiedGates=new Set(),nonces=new Set(),evidence=[];
 for(const item of packets){
  if(!exact(item,["payload","signature"])||
   !exact(item.payload,["schema","gate","environment","sourceSha",
     "reviewerRef","ownerRef","decision","issuedAt","expiresAt","nonce"])||
   item.payload.schema!=="qf.vox.independent-review.attestation.v1"||
   item.payload.environment!=="staging"||
   !GATES.includes(item.payload.gate)||verifiedGates.has(item.payload.gate)||
   item.payload.sourceSha!==sourceSha||item.payload.ownerRef!==ownerRef||
   item.payload.reviewerRef!==keys.get(item.payload.gate)?.reviewerRef||
   item.payload.decision!=="APPROVED"||
   typeof item.payload.nonce!=="string"||!SHA.test(item.payload.nonce)||
   nonces.has(item.payload.nonce)||
   typeof item.payload.issuedAt!=="string"||
   typeof item.payload.expiresAt!=="string"||
   !Number.isFinite(Date.parse(item.payload.issuedAt))||
   !Number.isFinite(Date.parse(item.payload.expiresAt))||
   Date.parse(item.payload.issuedAt)>now+30000||
   Date.parse(item.payload.issuedAt)<now-86400000||
   Date.parse(item.payload.expiresAt)<=now||
   Date.parse(item.payload.expiresAt)>now+86400000||
   typeof item.signature!=="string"||!/^[a-zA-Z0-9_-]{86}$/.test(item.signature))
   return blocked("REVIEW_PACKET_SUBJECT_OR_LIFETIME_DENIED");
  let good=false;
  try{
   const signature=Buffer.from(item.signature,"base64url");
   const input=Buffer.from(JSON.stringify(item.payload),"utf8");
   good=signature.length===64&&edVerify(null,input,
    createPublicKey(keys.get(item.payload.gate).publicKeyPem),signature);
  }catch{}
  if(!good)return blocked("INDEPENDENT_REVIEW_SIGNATURE_INVALID");
  verifiedGates.add(item.payload.gate);nonces.add(item.payload.nonce);
  evidence.push(Object.freeze({gate:item.payload.gate,signatureShapeVerified:true}));
 }
 return Object.freeze({
  ok:true,schema:"qf.vox.reviewer.cryptographic-packets.v1",
  sourceSha,cryptographicPacketsVerified:evidence.length,
  gates:Object.freeze(evidence),
  // Cryptography alone cannot show genuine human independence, a trusted
  // registry, a real AAL2 Staff factor, reviewed SQL or signed deployment.
  independentHumanIdentitiesVerified:false,reviewersEngaged:false,
  trustedRegistryProvenanceExternallyVerified:false,
  firstTeamLeaderOnboarded:false,protectedStagingPermitted:false,
  productionPermitted:false,requiresHumanOutOfBandKeyVerification:true
 });
}
