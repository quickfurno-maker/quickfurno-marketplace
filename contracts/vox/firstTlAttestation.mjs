// VOX TO-04D: offline signature validation for the ONE initial Team Leader.
// This does NOT establish a Staff identity or activate a permission.
// The caller MUST obtain the trusted reviewer key from independently governed
// server configuration; never from an HTTP request or attached attestation.
import {createHash,createPublicKey,verify} from "node:crypto";
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const uuid=x=>typeof x==="string"&&UUID.test(x);
const obj=x=>x!==null&&typeof x==="object"&&!Array.isArray(x);
const FIELDS=["schema","ownerId","candidateId","teamId","cityId","reviewerId",
 "nonce","issuedAt","expiresAt","decision","rationaleHash"];
const deny=reason=>Object.freeze({valid:false,reason,bootstrapAuthorized:false});
export function verifyIndependentTlAttestation({packet,trust,expected,now=Date.now()}={}){
 if(!obj(packet)||!obj(packet.payload)||!obj(trust)||!obj(expected)||
    !Number.isSafeInteger(now)||now<=0)return deny("INVALID_EVIDENCE");
 const p=packet.payload;
 if(Object.keys(p).sort().join("|")!==[...FIELDS].sort().join("|")||
    Object.keys(packet).sort().join("|")!=="payload|signatureBase64Url")
  return deny("UNEXPECTED_ATTESTATION_FIELDS");
 if(p.schema!=="qf.vox.first-tl-independent-attestation.v1"||
   p.decision!=="APPROVE_TEAM_LEADER_NOMINATION"||
   ![p.ownerId,p.candidateId,p.teamId,p.cityId,p.reviewerId,p.nonce].every(uuid)||
   new Set([p.ownerId,p.candidateId,p.reviewerId]).size!==3||
   p.ownerId!==expected.ownerId||p.candidateId!==expected.candidateId||
   p.teamId!==expected.teamId||p.cityId!==expected.cityId||
   p.nonce!==expected.nonce||p.reviewerId!==trust.reviewerId)
  return deny("SCOPE_OR_INDEPENDENCE_DENIED");
 const issued=Date.parse(p.issuedAt),expires=Date.parse(p.expiresAt);
 if(typeof p.issuedAt!=="string"||typeof p.expiresAt!=="string"||
    !Number.isFinite(issued)||!Number.isFinite(expires)||
    issued>now+60000||issued<now-86400000||
    expires<=now||expires-issued>86400000||
    typeof p.rationaleHash!=="string"||!/^[0-9a-f]{64}$/.test(p.rationaleHash))
  return deny("STALE_OR_INVALID_ATTESTATION");
 if(typeof packet.signatureBase64Url!=="string"||
    !/^[A-Za-z0-9_-]{86}$/.test(packet.signatureBase64Url))
  return deny("MISSING_SIGNATURE");
 if(trust.enabled!==true||trust.keySource!=="INDEPENDENT_APPROVED_SERVER_REGISTRY"||
    typeof trust.publicKeyPem!=="string"||
    typeof trust.publicKeyFingerprint!=="string"||
    !/^[a-f0-9]{64}$/.test(trust.publicKeyFingerprint))
  return deny("INDEPENDENT_TRUST_KEY_MISSING");
 try{
  const key=createPublicKey(trust.publicKeyPem);
  if(key.asymmetricKeyType!=="ed25519")return deny("WRONG_SIGNATURE_ALGORITHM");
  const fp=createHash("sha256").update(key.export({format:"der",type:"spki"})).digest("hex");
  if(fp!==trust.publicKeyFingerprint)return deny("REVIEWER_KEY_FINGERPRINT_MISMATCH");
  const signature=Buffer.from(packet.signatureBase64Url,"base64url");
  if(signature.length!==64)return deny("INVALID_SIGNATURE_LENGTH");
  const canonical=JSON.stringify(Object.fromEntries(FIELDS.map(k=>[k,p[k]])));
  if(!verify(null,Buffer.from(canonical,"utf8"),key,signature))
   return deny("INVALID_INDEPENDENT_SIGNATURE");
  return Object.freeze({valid:true,reason:"VERIFIED_SIGNATURE_NOT_APPROVAL",
    reviewerId:p.reviewerId,nonce:p.nonce,teamId:p.teamId,cityId:p.cityId,
    candidateId:p.candidateId,bootstrapAuthorized:false,
    requiresRealSupabaseAal2:true,requiresCandidateHumanVerification:true,
    requiresIndependentDbaApprovedNonceConsumption:true,
    requiresDurableCoreAudit:true,requiresProtectedStagingReview:true});
 }catch{return deny("INVALID_TRUST_MATERIAL");}
}
export {FIELDS as CANONICAL_ATTESTATION_FIELDS};
