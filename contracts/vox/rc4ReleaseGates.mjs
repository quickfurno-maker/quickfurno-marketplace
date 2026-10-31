import {createPublicKey,verify} from "node:crypto";
import {RC4_PINS} from "./rc4ReleasePins.mjs";
// RC4 Track E GO/HOLD gates. Evaluates evidence ABOUT a plan; it never applies anything.
// Signoffs are Ed25519 envelopes verified against PINNED public keys, so a JSON field that merely says
// "approved" or "aal2" is worthless. Verdicts are FAIL | HOLD | GO_ELIGIBLE_FOR_HUMAN_DECISION and
// canApply / migrationReady are constant false: applying is a separate human act outside this code.
const HEX64=/^[a-f0-9]{64}$/;
const FORBIDDEN_REQUEST_KEYS=/^(force|forcego|go|goeligible|apply|execute|push|repair|merge|promote|dburl|linked|skipgates|bypass|override|goverride|canapply|migrationready|verdict)$/i;
const TRUTHY=new Set(["true","1","on","yes","enabled"]);

export function canonicalJson(v){
 const c=x=>Array.isArray(x)?x.map(c):x&&typeof x==="object"?
  Object.fromEntries(Object.keys(x).sort().map(k=>[k,c(x[k])])):x;
 return JSON.stringify(c(v));
}

const gate=(id,status,code,detail)=>Object.freeze({id,status,code,...(detail?{detail}:{})});
const ms=v=>typeof v==="string"&&!Number.isNaN(Date.parse(v))?Date.parse(v):null;

/**
 * Verify a signed envelope {keyId,payload,signature(base64)} for one role+purpose on one plan.
 * Returns {ok:true,payload} or {ok:false,status,code}. `seen` is a Set of nonces for replay detection.
 */
export function verifyEnvelope({envelope,role,purpose,plan,pins,nowMs,seen}){
 const bad=(code,status="HOLD")=>({ok:false,status,code});
 if(!envelope)return bad("EVIDENCE_MISSING");
 const {keyId,payload,signature}=envelope;
 if(!payload||typeof payload!=="object"||typeof keyId!=="string"||typeof signature!=="string")return bad("ENVELOPE_MALFORMED","FAIL");
 if(!pins.signerKeys.length)return bad("NO_PINNED_SIGNER_KEYS");
 const key=pins.signerKeys.find(k=>k.keyId===keyId);
 if(!key)return bad("UNPINNED_KEY","FAIL");
 if(payload.role!==role||key.role!==role)return bad("ROLE_MISMATCH","FAIL");
 if(payload.purpose!==purpose)return bad("PURPOSE_MISMATCH","FAIL");
 if(key.signerId!==payload.signerId)return bad("SIGNER_KEY_MISMATCH","FAIL");
 if(payload.signerKind!=="HUMAN"||payload.aiGenerated===true)return bad("NOT_A_HUMAN_SIGNER","FAIL");
 if(payload.planDigest!==plan.planDigest)return bad("PLAN_DIGEST_MISMATCH","FAIL");
 let ok=false;
 try{
  const sig=Buffer.from(signature,"base64");
  ok=sig.length===64&&verify(null,Buffer.from(canonicalJson(payload)),createPublicKey(key.publicKeyPem),sig);
 }catch{ok=false}
 if(!ok)return bad("BAD_SIGNATURE","FAIL");
 const iat=ms(payload.issuedAt),exp=ms(payload.expiresAt);
 if(iat===null||exp===null||iat>nowMs||exp<=nowMs||exp-iat>pins.maxEnvelopeLifetimeMs)return bad("ENVELOPE_NOT_CURRENT","FAIL");
 if(typeof payload.nonce!=="string"||payload.nonce.length<16||seen.has(payload.nonce))return bad("NONCE_INVALID_OR_REPLAYED","FAIL");
 seen.add(payload.nonce);
 return {ok:true,payload};
}

const fresh=(iso,nowMs,maxAge)=>{const t=ms(iso);return t!==null&&t<=nowMs&&nowMs-t<=maxAge};

export function evaluateRc4Release({plan,evidence={},pins=RC4_PINS,nowMs=Date.now(),options={}}={}){
 const gates=[];
 const push=g=>{gates.push(g);return g};
 const finish=()=>{
  const verdict=gates.some(g=>g.status==="FAIL")?"FAIL":gates.some(g=>g.status==="HOLD")?"HOLD":"GO_ELIGIBLE_FOR_HUMAN_DECISION";
  return Object.freeze({schema:"qf.vox.rc4.release-gates.v1",verdict,goEligible:verdict==="GO_ELIGIBLE_FOR_HUMAN_DECISION",
   canApply:false,migrationReady:false,executesSql:false,planDigest:plan?.planDigest??null,gates:Object.freeze(gates)});
 };
 // Refuse any attempt to force, skip, apply or pre-declare the outcome.
 const asked=[...Object.keys(options||{}),...Object.keys(evidence||{})].filter(k=>FORBIDDEN_REQUEST_KEYS.test(k));
 if(asked.length){push(gate("FORCED_UNSAFE_REQUEST","FAIL","FORCED_OR_SPOOFED_REQUEST_REJECTED",asked.join(",")));return finish()}
 if(!plan||plan.schema!=="qf.vox.rc4.release-plan.v1"||typeof plan.planDigest!=="string"){
  push(gate("PLAN_CONSISTENT","FAIL","PLAN_INVALID"));return finish()}
 if(plan.canApply!==false||plan.migrationReady!==false||plan.executesSql!==false){
  push(gate("PLAN_CONSISTENT","FAIL","PLAN_CLAIMS_EXECUTION"));return finish()}

 push(plan.planStatus==="CONSISTENT"?gate("PLAN_CONSISTENT","PASS","OK")
  :gate("PLAN_CONSISTENT",plan.planStatus==="FAIL"?"FAIL":"HOLD",plan.planStatus==="FAIL"?"PLAN_HAS_BLOCKING_FINDINGS":"PLAN_HAS_OPEN_PINS",
   plan.findings.map(f=>f.code).join(",")));
 push(plan.ledgerState==="MATCH"?gate("LEDGER_MATCHES_PIN","PASS","OK")
  :gate("LEDGER_MATCHES_PIN",plan.ledgerState==="BLOCKED"?"FAIL":"HOLD","LEDGER_"+plan.ledgerState));

 const seen=new Set(evidence.usedNonces||[]);
 const ver=(env,role,purpose)=>verifyEnvelope({envelope:env,role,purpose,plan,pins,nowMs,seen});
 const authors=new Set(evidence.authorIds||[]);
 const fromV=(id,v,extra)=>v.ok?(extra?extra(v.payload):gate(id,"PASS","OK")):gate(id,v.status,v.code);

 // Independent DBA and AppSec: distinct people, neither the Owner nor an author of this change.
 const dba=ver(evidence.dba,"DBA","RC4_SIGNOFF"),app=ver(evidence.appsec,"APPSEC","RC4_SIGNOFF");
 const indep=(id,v)=>fromV(id,v,p=>
  p.signerId===pins.ownerId||authors.has(p.signerId)||(dba.ok&&app.ok&&dba.payload.signerId===app.payload.signerId)
   ?gate(id,"FAIL","INDEPENDENCE_VIOLATION"):gate(id,"PASS","OK"));
 push(indep("DBA_SIGNOFF",dba));push(indep("APPSEC_SIGNOFF",app));

 // Backup + restore rehearsal + rollback, attested by the DBA.
 const bk=ver(evidence.backup,"DBA","BACKUP_RESTORE");
 const backupGate=fromV("BACKUP_RESTORE",bk,p=>
  p.projectRef===pins.stagingProjectRef&&p.includesOwner===true&&p.includesAcl===true&&p.includesRoles===true&&
  p.restoreRehearsalPassed===true&&HEX64.test(p.restoreCompareDigest)&&HEX64.test(p.backupArtifactSha256)&&
  fresh(p.takenAt,nowMs,pins.maxBackupAgeMs)
   ?gate("BACKUP_RESTORE","PASS","OK"):gate("BACKUP_RESTORE","FAIL","BACKUP_ATTESTATION_INCOMPLETE_OR_STALE"));
 push(backupGate);
 push(fromV("ROLLBACK_PLAN",bk,p=>HEX64.test(p.rollbackPlanSha256)&&p.rollbackRehearsed===true
  ?gate("ROLLBACK_PLAN","PASS","OK"):gate("ROLLBACK_PLAN","FAIL","ROLLBACK_NOT_REHEARSED_OR_UNBOUND")));

 // Owner and Team Leader AAL2: pinned key + fresh MFA time, and they must be different people.
 const own=ver(evidence.owner,"OWNER","OWNER_AAL2"),tl=ver(evidence.teamLeader,"TEAM_LEADER","TEAM_LEADER_AAL2");
 const aal=(id,v,isOwner)=>fromV(id,v,p=>{
  if(isOwner&&pins.ownerId===null)return gate(id,"HOLD","OWNER_NOT_PINNED");
  if(isOwner&&p.signerId!==pins.ownerId)return gate(id,"FAIL","OWNER_MISMATCH");
  if(!isOwner&&(p.signerId===pins.ownerId||authors.has(p.signerId)))return gate(id,"FAIL","INDEPENDENCE_VIOLATION");
  if(p.aal!=="aal2"||!fresh(p.mfaVerifiedAt,nowMs,pins.maxAal2AgeMs))return gate(id,"FAIL","AAL2_MISSING_OR_STALE");
  return gate(id,"PASS","OK");
 });
 push(aal("OWNER_AAL2",own,true));push(aal("TEAM_LEADER_AAL2",tl,false));

 // Signed image built from exactly the pinned RC3 source.
 push(fromV("SIGNED_IMAGE",ver(evidence.image,"RELEASE_SIGNER","SIGNED_IMAGE"),p=>
  /^sha256:[a-f0-9]{64}$/.test(p.imageDigest)&&p.sourceSha===pins.rc3BaseSha&&plan.headSha===pins.rc3BaseSha
   ?gate("SIGNED_IMAGE","PASS","OK"):gate("SIGNED_IMAGE","FAIL","IMAGE_NOT_BOUND_TO_PINNED_SOURCE")));

 // Feature flags: required flags present and off; no VOX_*_ENABLED may be on.
 const flags=evidence.flags;
 if(!flags||typeof flags!=="object")push(gate("FEATURE_FLAGS_OFF","HOLD","FLAG_STATE_MISSING"));
 else{
  const off=v=>v===false||v==="false"||v==="0"||v==="off";
  const on=Object.entries(flags).filter(([k,v])=>/^VOX_.*_ENABLED$/.test(k)&&(v===true||v===1||TRUTHY.has(String(v).toLowerCase())));
  const missing=pins.requiredFlagsOff.filter(k=>!(k in flags));
  const notOff=pins.requiredFlagsOff.filter(k=>k in flags&&!off(flags[k]));
  push(on.length||notOff.length?gate("FEATURE_FLAGS_OFF","FAIL","FLAG_ENABLED_OR_AMBIGUOUS",[...on.map(e=>e[0]),...notOff].join(","))
   :missing.length?gate("FEATURE_FLAGS_OFF","HOLD","REQUIRED_FLAG_NOT_REPORTED",missing.join(","))
   :gate("FEATURE_FLAGS_OFF","PASS","OK"));
 }
 push(pins.goEnabled===true?gate("GO_SWITCH","PASS","OK")
  :gate("GO_SWITCH","HOLD","GO_RESERVED_FOR_REVIEWED_CODE_CHANGE_AND_HUMAN_OWNER"));
 return finish();
}
