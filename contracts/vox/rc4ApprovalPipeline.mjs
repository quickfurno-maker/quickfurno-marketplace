/** RC4 Track B signed Owner + Team Leader approval PREPARATION pipeline.
 *
 * PREPARATION ONLY. Every result has approved:false, canAuthorize:false and
 * officialEodEnabled:false. Nothing here writes an approval row, publishes an
 * EOD report, sends a message or calls a provider. It composes, without
 * modifying, the RC3 Ed25519 verifier (ab7kSignedApprovalVerifier.mjs) with:
 *  - actors taken ONLY from branded, server-minted verified Core-auth contexts
 *    (never from request-body claims: JSON cannot carry a WeakSet brand);
 *  - AAL2 recency, live session, and current Owner / Team Leader membership;
 *  - scope binding: team + city are folded into the signed targetHash, so a
 *    signature for one team/city cannot be replayed for another;
 *  - a second, out-of-band pin: the registry fingerprint must be listed in
 *    RC4_HUMAN_APPROVED_REGISTRY_FINGERPRINTS (EMPTY in source => default DENY);
 *  - explicit revocation lists (fail closed when not supplied);
 *  - ONE atomic ledger claim of both nonces + the subject (all-or-nothing).
 *
 * This module never reads env, files or the network, and never holds a private
 * key. It is not imported by any route, worker or service.
 */
import {createHash} from "node:crypto";
import {AB7K_APPROVAL_TYPES,AB7K_MAX_LIFETIME_MS,deriveAb7kTargetHash,
 normalizeAb7kSignerRegistry,verifyAb7kIndependentApprovalPair
} from "./ab7kSignedApprovalVerifier.mjs";

export const RC4_OFFICIAL_EOD_ENABLED=false;
/** Human-reviewed registry fingerprints. Intentionally empty: no signer has been
 * enrolled by a human, so no registry can pass until a reviewed commit adds one. */
export const RC4_HUMAN_APPROVED_REGISTRY_FINGERPRINTS=Object.freeze([]);
export const RC4_BLOCKERS=Object.freeze(["FEATURE_GATE_HARD_OFF",
 "AUTHORIZED_ATOMIC_DB_WRITER_NOT_INSTALLED","DB_SIDE_ED25519_VERIFICATION_ABSENT",
 "INDEPENDENT_DBA_APPSEC_REVIEW","HUMAN_OWNER_TL_ENROLMENT_CEREMONY"]);

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const HEX64=/^[a-f0-9]{64}$/;
const MAX_SKEW_MS=30*1000;
const isObject=x=>x!==null&&typeof x==="object"&&!Array.isArray(x);
const exactKeys=(v,keys)=>isObject(v)&&Object.keys(v).sort().join("|")===[...keys].sort().join("|");
const uuid=v=>typeof v==="string"&&UUID.test(v);
const posInt=x=>Number.isSafeInteger(x)&&x>0;
const deny=reason=>Object.freeze({ok:false,reason,preparationVerified:false,
 signatureVerified:false,approved:false,canAuthorize:false,officialEodEnabled:false});

// ---- verified Core-auth context -------------------------------------------
const BRANDED=new WeakSet();
const AUTH_KEYS=["userId","sessionId","jwtRole","aal","aal2AtMs","sessionExpiresAtMs",
 "profileRole","profileActive","staffRole","teamId","cityId","membershipRevokedAtMs",
 "membershipExpiresAtMs"];

/** Mints the only auth object the pipeline accepts. MUST be called solely by the
 * server-side Core-auth adapter after it has verified the JWT and re-read the
 * profile/membership rows. Returns null for any inconsistent or weak input. */
export function mintRc4VerifiedAuthContext(c){
 if(!exactKeys(c,AUTH_KEYS)||!uuid(c.userId)||!uuid(c.sessionId)||
    c.jwtRole!=="authenticated"||c.aal!=="aal2"||!posInt(c.aal2AtMs)||
    !posInt(c.sessionExpiresAtMs)||c.sessionExpiresAtMs<=c.aal2AtMs||
    c.profileActive!==true||c.membershipRevokedAtMs!==null)return null;
 let approverRole=null;
 if(c.profileRole==="admin"&&c.staffRole===null&&c.teamId===null&&c.cityId===null&&
    c.membershipExpiresAtMs===null)approverRole="OWNER";
 else if(c.profileRole===null&&c.staffRole==="team_leader"&&uuid(c.teamId)&&
    uuid(c.cityId)&&posInt(c.membershipExpiresAtMs))approverRole="TEAM_LEADER";
 if(!approverRole)return null;
 const ctx=Object.freeze({...c,approverRole});
 BRANDED.add(ctx);
 return ctx;
}

function checkAuth(a,role,now){
 if(!isObject(a)||!BRANDED.has(a))return "AUTH_CONTEXT_UNVERIFIED_DENIED";
 if(a.approverRole!==role)return "AUTH_ROLE_DENIED";
 if(a.sessionExpiresAtMs<=now)return "AUTH_SESSION_EXPIRED_DENIED";
 if(a.aal2AtMs>now+MAX_SKEW_MS||now-a.aal2AtMs>AB7K_MAX_LIFETIME_MS)return "AUTH_AAL2_STALE_DENIED";
 if(role==="TEAM_LEADER"&&a.membershipExpiresAtMs<=now)return "AUTH_MEMBERSHIP_EXPIRED_DENIED";
 return null;
}

// ---- helpers --------------------------------------------------------------
/** Order-independent fingerprint of a NORMALIZED registry (null if invalid). */
export function rc4RegistryFingerprint(registry){
 const reg=normalizeAb7kSignerRegistry(registry instanceof Map?[...registry.values()]
  .map(({key,...rest})=>rest):registry);
 if(!reg)return null;
 const lines=[...reg.values()].map(e=>[e.keyId,e.signerId,e.signerRole,
  e.publicKeyFingerprint,e.notBeforeMs,e.notAfterMs].join("|")).sort();
 return createHash("sha256").update("qf.vox.rc4.registry/v1\n"+lines.join("\n"),"utf8").digest("hex");
}
/** Scope-binding target hash; signers sign this, the server re-derives it. */
export function rc4ScopeTargetHash({type,subjectId,teamId,cityId}){
 return deriveAb7kTargetHash("RC4_SCOPE",[type,subjectId,teamId,cityId]);
}
const subjectKey=(type,subjectId)=>createHash("sha256")
 .update(`qf.vox.rc4.approval/v1/subject|${type}|${subjectId}`,"utf8").digest("hex");

const REQUEST_KEYS=["type","subjectId","digest","teamId","cityId","ownerEnvelope","teamLeaderEnvelope"];
const ACTOR_HINT=/^(actor|owner|team_?leader|signer|user|role|admin|operator|aal|approved|can)/i;

/** Revocations are explicit input: {keyIds:[...],signerIds:[...]}; absent => DENY. */
function revokedReason(rev,envelopes,auths){
 const keyIds=new Set(rev.keyIds),signerIds=new Set(rev.signerIds);
 for(const e of envelopes){
  const p=isObject(e)?e.payload:null;
  if(isObject(p)&&(keyIds.has(p.keyId)||signerIds.has(p.signerId)))return "REVOKED_DENIED";
 }
 return auths.some(a=>signerIds.has(a.userId))?"REVOKED_DENIED":null;
}
const revOk=r=>isObject(r)&&Array.isArray(r.keyIds)&&Array.isArray(r.signerIds)&&
 [...r.keyIds,...r.signerIds].every(x=>typeof x==="string");

/** Prepare (verify + atomically claim) one Owner+TL signed approval pair. */
export async function prepareRc4SignedApproval({request,ownerAuth,teamLeaderAuth,registry,
 approvedRegistryFingerprints=RC4_HUMAN_APPROVED_REGISTRY_FINGERPRINTS,revocations,ledger,
 now=Date.now()}={}){
 if(!isObject(request))return deny("REQUEST_SHAPE_DENIED");
 if(!exactKeys(request,REQUEST_KEYS))
  return deny(Object.keys(request).some(k=>!REQUEST_KEYS.includes(k)&&ACTOR_HINT.test(k))
   ?"ACTOR_CLAIM_IN_REQUEST_DENIED":"REQUEST_SHAPE_DENIED");
 const {type,subjectId,digest,teamId,cityId,ownerEnvelope,teamLeaderEnvelope}=request;
 if(!AB7K_APPROVAL_TYPES.includes(type)||!uuid(subjectId)||typeof digest!=="string"||
    !HEX64.test(digest)||!uuid(teamId)||!uuid(cityId)||!Number.isSafeInteger(now)||now<=0)
  return deny("REQUEST_FIELDS_DENIED");

 const oa=checkAuth(ownerAuth,"OWNER",now);if(oa)return deny(oa);
 const ta=checkAuth(teamLeaderAuth,"TEAM_LEADER",now);if(ta)return deny(ta);
 if(ownerAuth.userId===teamLeaderAuth.userId||ownerAuth.sessionId===teamLeaderAuth.sessionId)
  return deny("INDEPENDENCE_DENIED");
 if(teamLeaderAuth.teamId!==teamId||teamLeaderAuth.cityId!==cityId)
  return deny("TEAM_CITY_SCOPE_DENIED");

 const reg=normalizeAb7kSignerRegistry(registry instanceof Map?[...registry.values()]
  .map(({key,...rest})=>rest):registry);
 if(!reg)return deny("SIGNER_REGISTRY_UNCONFIGURED_DENY");
 const fp=rc4RegistryFingerprint(registry);
 if(!Array.isArray(approvedRegistryFingerprints)||!approvedRegistryFingerprints.includes(fp))
  return deny("KEY_ENROLMENT_NOT_HUMAN_APPROVED_DENY");
 if(!revOk(revocations))return deny("REVOCATION_LIST_REQUIRED_DENY");
 const rv=revokedReason(revocations,[ownerEnvelope,teamLeaderEnvelope],[ownerAuth,teamLeaderAuth]);
 if(rv)return deny(rv);
 if(!isObject(ledger)||typeof ledger.claimAll!=="function")return deny("LEDGER_REQUIRED_DENY");

 const expected={type,subjectId,digest,targetHash:rc4ScopeTargetHash({type,subjectId,teamId,cityId}),
  ownerId:ownerAuth.userId,teamLeaderId:teamLeaderAuth.userId};
 // Collect (do not persist) the verifier's replay keys; persistence is the single
 // atomic claimAll below, so a half-claimed pair is impossible.
 const keys=[];
 const collector={claim:async k=>{keys.push(k);return true;}};
 const v=await verifyAb7kIndependentApprovalPair({ownerEnvelope,teamLeaderEnvelope,registry:reg,
  expected,replayStore:collector,now});
 if(!v.ok)return deny(v.reason);
 if(keys.length!==2||new Set(keys).size!==2)return deny("INDEPENDENCE_DENIED");
 const expiresAtMs=Math.min(ownerEnvelope.payload.expiresAtMs,teamLeaderEnvelope.payload.expiresAtMs);
 let claimed=false;
 try{claimed=(await ledger.claimAll({nonceKeys:keys,subjectKey:subjectKey(type,subjectId),
  expiresAtMs}))===true;}catch{claimed=false;}
 if(!claimed)return deny("REPLAY_OR_LEDGER_DENIED");
 const ledgerDurable=ledger.durable===true;
 return Object.freeze({ok:true,preparationVerified:true,signatureVerified:true,
  approved:false,canAuthorize:false,officialEodEnabled:false,type,subjectId,
  ownerId:v.ownerId,teamLeaderId:v.teamLeaderId,ledgerDurable,
  blockers:Object.freeze(ledgerDurable?[...RC4_BLOCKERS]:[...RC4_BLOCKERS,"NONCE_LEDGER_NOT_DURABLE"])});
}

/** Non-durable reference ledger for tests: all-or-nothing, synchronous check+set. */
export function createRc4InMemoryNonceLedgerForTests({failWith=null}={}){
 const seen=new Set();let claimCalls=0;
 return {durable:false,get claimCalls(){return claimCalls},get size(){return seen.size},
  async claimAll({nonceKeys,subjectKey:sk,expiresAtMs}){
   claimCalls++;
   if(failWith)throw failWith;
   if(!Array.isArray(nonceKeys)||nonceKeys.length!==2||!HEX64.test(sk)||!posInt(expiresAtMs))return false;
   const all=[...nonceKeys,sk];
   if(new Set(all).size!==3||all.some(k=>typeof k!=="string"||seen.has(k)))return false;
   for(const k of all)seen.add(k);
   return true;
  }};
}
