import test from "node:test";
import assert from "node:assert/strict";
import {createHash,generateKeyPairSync,sign} from "node:crypto";
import {readFileSync} from "node:fs";
import {dirname,resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {
 AB7K_APPROVAL_FIELDS,canonicalAb7kApprovalBytes,deriveAb7kTargetHash,
 loadAb7kSignerRegistryFromEnv,normalizeAb7kSignerRegistry,
 verifyAb7kSignedApproval,verifyAb7kIndependentApprovalPair
} from "../../../contracts/vox/ab7kSignedApprovalVerifier.mjs";

const root=resolve(dirname(fileURLToPath(import.meta.url)),"../../..");
const id=n=>"00000000-0000-4000-8000-"+String(n).padStart(12,"0");
const NOW=1_800_000_000_000;

// Throwaway keys exist ONLY in this test process. Nothing is written to disk.
function mkSigner(keyId,signerId,signerRole,over={}){
 const {publicKey,privateKey}=generateKeyPairSync("ed25519");
 const pem=publicKey.export({type:"spki",format:"pem"});
 const fp=createHash("sha256").update(publicKey.export({type:"spki",format:"der"})).digest("hex");
 return {privateKey,publicKey,entry:{keyId,publicKeyPem:pem,publicKeyFingerprint:fp,
  signerId,signerRole,notBeforeMs:NOW-3_600_000,notAfterMs:NOW+3_600_000,...over}};
}
const owner=mkSigner("owner-key-01",id(2),"OWNER");
const tl=mkSigner("tl-key-0001",id(3),"TEAM_LEADER");
const registry=[owner.entry,tl.entry];

const expected={type:"EOD_OFFICIAL_RELEASE",subjectId:id(1),digest:"a".repeat(64),
 targetHash:"b".repeat(64),ownerId:id(2),teamLeaderId:id(3)};
function payloadFor(s,over={}){
 return {domain:"qf.vox.ab7k.signed-approval",version:"v1",type:expected.type,
  environment:"staging",keyId:s.entry.keyId,signerRole:s.entry.signerRole,
  signerId:s.entry.signerId,ownerId:expected.ownerId,teamLeaderId:expected.teamLeaderId,
  subjectId:expected.subjectId,digest:expected.digest,targetHash:expected.targetHash,
  nonce:s===owner?id(11):id(12),issuedAtMs:NOW-1000,expiresAtMs:NOW+300_000,...over};
}
// Signs the REAL canonical bytes with the throwaway private key.
function envelope(s,over={},signWith=s){
 const payload=payloadFor(s,over);
 const bytes=canonicalAb7kApprovalBytes(payload);
 assert.ok(bytes,"test payload must be canonical");
 return {payload,signature:sign(null,bytes,signWith.privateKey).toString("base64url")};
}
// Signs arbitrary bytes for a payload (to build domain-confusion attacks).
const signRaw=(s,payload,bytes)=>({payload,
 signature:sign(null,Buffer.from(bytes),s.privateKey).toString("base64url")});
function store(durable=true){
 const seen=new Set();let claims=0;
 return {durable,get claims(){return claims},async claim(k){claims++;
  if(seen.has(k))return false;seen.add(k);return true;}};
}
const single=(o={})=>verifyAb7kSignedApproval({envelope:envelope(owner),registry,expected,
 signerRole:"OWNER",replayStore:store(),now:NOW,...o});
const pair=(o={})=>verifyAb7kIndependentApprovalPair({ownerEnvelope:envelope(owner),
 teamLeaderEnvelope:envelope(tl),registry,expected,replayStore:store(),now:NOW,...o});

test("canonical bytes match an independently written golden message",()=>{
 const p=payloadFor(owner);
 const golden="qf.vox.ab7k.signed-approval/v1\n"+
  "domain=qf.vox.ab7k.signed-approval\nversion=v1\ntype=EOD_OFFICIAL_RELEASE\n"+
  "environment=staging\nkeyId=owner-key-01\nsignerRole=OWNER\n"+
  `signerId=${id(2)}\nownerId=${id(2)}\nteamLeaderId=${id(3)}\nsubjectId=${id(1)}\n`+
  `digest=${"a".repeat(64)}\ntargetHash=${"b".repeat(64)}\nnonce=${id(11)}\n`+
  `issuedAtMs=${NOW-1000}\nexpiresAtMs=${NOW+300_000}\n`;
 assert.equal(canonicalAb7kApprovalBytes(p).toString("utf8"),golden);
 assert.equal(AB7K_APPROVAL_FIELDS.length,15);
});

test("positive: genuine Owner signature verifies but never approves/authorizes",async()=>{
 const r=await single();
 assert.equal(r.ok,true);assert.equal(r.signatureVerified,true);
 assert.equal(r.approved,false);assert.equal(r.canAuthorize,false);
 assert.ok(r.requires.includes("SERVER_VERIFIED_CURRENT_AAL2_OWNER_AND_TL"));
 assert.ok(r.requires.includes("AUTHORIZED_ATOMIC_DB_WRITER_REVALIDATING_ALL"));
 assert.ok(Object.isFrozen(r));
});
test("positive: independent Owner+TL pair verifies, still not an approval",async()=>{
 const r=await pair();
 assert.equal(r.ok,true);assert.equal(r.approved,false);assert.equal(r.canAuthorize,false);
 assert.equal(r.ownerId,id(2));assert.equal(r.teamLeaderId,id(3));
});
test("positive: operator-command type with derived target hash",async()=>{
 const targetHash=deriveAb7kTargetHash("OPERATOR_STOP",[id(40),7,"CONVERSATION_PAUSE_AI"]);
 assert.match(targetHash,/^[a-f0-9]{64}$/);
 assert.notEqual(targetHash,deriveAb7kTargetHash("OPERATOR_STOP",[id(40),8,"CONVERSATION_PAUSE_AI"]));
 assert.equal(deriveAb7kTargetHash("OPERATOR_STOP",["a\nb"]),null);
 const e={...expected,type:"OPERATOR_COMMAND",targetHash};
 const env=envelope(owner,{type:"OPERATOR_COMMAND",targetHash});
 const r=await verifyAb7kSignedApproval({envelope:env,registry,expected:e,
  signerRole:"OWNER",replayStore:store(),now:NOW});
 assert.equal(r.ok,true);
});

test("forged signature, tampered field and wrong signing key are rejected",async()=>{
 const good=envelope(owner);
 // signed by TL's private key but claiming the Owner keyId
 assert.equal((await single({envelope:envelope(owner,{},tl)})).reason,"SIGNATURE_INVALID");
 // flip one signature byte
 const raw=Buffer.from(good.signature,"base64url");raw[10]^=1;
 assert.equal((await single({envelope:{...good,signature:raw.toString("base64url")}})).reason,
  "SIGNATURE_INVALID");
 // tampering a signed field the caller does not independently pin: nonce, times
 for(const over of [{nonce:id(77)},{issuedAtMs:NOW-2000},{expiresAtMs:NOW+299_000}]){
  const e={payload:{...good.payload,...over},signature:good.signature};
  assert.equal((await single({envelope:e})).reason,"SIGNATURE_INVALID",JSON.stringify(over));
 }
 // garbage / truncated / non-canonical encodings
 for(const sig of ["","A".repeat(86),"!".repeat(86),good.signature.slice(1),good.signature+"A",null])
  assert.equal((await single({envelope:{...good,signature:sig}})).ok,false);
});

test("wrong subject, digest, target, Owner or TL are rejected before signature use",async()=>{
 for(const over of [{subjectId:id(90)},{digest:"c".repeat(64)},{targetHash:"c".repeat(64)},
   {ownerId:id(91)},{teamLeaderId:id(92)},{type:"OPERATOR_COMMAND"}]){
  const r=await single({envelope:envelope(owner,over)});
  assert.equal(r.ok,false,JSON.stringify(over));
  assert.ok(["SUBJECT_BINDING_DENIED","SIGNER_ROLE_OR_SUBJECT_DENIED"].includes(r.reason),r.reason);
 }
 // verifier-side expectation differs from what was signed
 for(const k of ["subjectId","ownerId","teamLeaderId"])
  assert.equal((await single({expected:{...expected,[k]:id(95)}})).ok,false);
 for(const k of ["digest","targetHash"])
  assert.equal((await single({expected:{...expected,[k]:"d".repeat(64)}})).ok,false);
});

test("wrong role and signer identity are rejected",async()=>{
 // TL envelope presented in the Owner slot
 assert.equal((await verifyAb7kSignedApproval({envelope:envelope(tl),registry,expected,
  signerRole:"OWNER",replayStore:store(),now:NOW})).ok,false);
 // TL key signs a payload that CLAIMS the OWNER role/identity
 const forged=envelope(owner,{keyId:tl.entry.keyId},tl);
 assert.equal((await single({envelope:forged})).reason,"KEY_NOT_ENROLLED_FOR_SIGNER_ROLE");
 // Owner key relabelled as team leader
 const relabel=envelope(owner,{signerRole:"TEAM_LEADER",signerId:id(3)});
 assert.equal((await verifyAb7kSignedApproval({envelope:relabel,registry,expected,
  signerRole:"TEAM_LEADER",replayStore:store(),now:NOW})).reason,"KEY_NOT_ENROLLED_FOR_SIGNER_ROLE");
 // signer is not the Owner named in the subject
 assert.equal((await single({envelope:envelope(owner,{signerId:id(55)})})).ok,false);
 // self-review: Owner == TL
 assert.equal((await single({expected:{...expected,teamLeaderId:id(2)}})).ok,false);
 const same=await pair({teamLeaderEnvelope:envelope(owner)});
 assert.equal(same.ok,false);
});

test("unknown key, empty/absent registry, outside window and tampered pins are DENY",async()=>{
 assert.equal((await single({envelope:envelope(owner,{keyId:"never-pinned-1"})})).reason,"UNKNOWN_KEY_ID");
 for(const reg of [undefined,null,[],{},"",[{}]])
  assert.equal((await single({registry:reg})).reason,"SIGNER_REGISTRY_UNCONFIGURED_DENY");
 const early=mkSigner("owner-key-01",id(2),"OWNER",{notBeforeMs:NOW+1000,notAfterMs:NOW+9000});
 assert.equal((await single({registry:[early.entry,tl.entry],envelope:envelope(early)})).reason,
  "KEY_OUTSIDE_VALIDITY_WINDOW");
 const old=mkSigner("owner-key-01",id(2),"OWNER",{notBeforeMs:NOW-9000,notAfterMs:NOW});
 assert.equal((await single({registry:[old.entry,tl.entry],envelope:envelope(old)})).reason,
  "KEY_OUTSIDE_VALIDITY_WINDOW");
 // a revoked key is simply absent from the registry
 assert.equal((await single({registry:[tl.entry]})).reason,"UNKNOWN_KEY_ID");
});

test("registry rejects private keys, non-Ed25519 keys, fingerprint mismatch, dup/dual-role",()=>{
 const priv=owner.privateKey.export({type:"pkcs8",format:"pem"});
 assert.equal(normalizeAb7kSignerRegistry([{...owner.entry,publicKeyPem:priv}]),null);
 const rsa=generateKeyPairSync("rsa",{modulusLength:2048}).publicKey.export({type:"spki",format:"pem"});
 assert.equal(normalizeAb7kSignerRegistry([{...owner.entry,publicKeyPem:rsa}]),null);
 const ec=generateKeyPairSync("ec",{namedCurve:"P-256"}).publicKey.export({type:"spki",format:"pem"});
 assert.equal(normalizeAb7kSignerRegistry([{...owner.entry,publicKeyPem:ec}]),null);
 assert.equal(normalizeAb7kSignerRegistry([{...owner.entry,publicKeyFingerprint:"0".repeat(64)}]),null);
 assert.equal(normalizeAb7kSignerRegistry([owner.entry,{...tl.entry,keyId:owner.entry.keyId}]),null);
 assert.equal(normalizeAb7kSignerRegistry([owner.entry,{...tl.entry,
  publicKeyPem:owner.entry.publicKeyPem,publicKeyFingerprint:owner.entry.publicKeyFingerprint}]),null);
 // the same human enrolled as both Owner and TL voids independence
 const dual=mkSigner("dual-role-key",id(2),"TEAM_LEADER");
 assert.equal(normalizeAb7kSignerRegistry([owner.entry,dual.entry]),null);
 assert.equal(normalizeAb7kSignerRegistry([{...owner.entry,extra:1}]),null);
 assert.ok(normalizeAb7kSignerRegistry(registry) instanceof Map);
});
test("env registry: empty/missing/invalid => null (DENY); valid JSON loads",()=>{
 assert.equal(loadAb7kSignerRegistryFromEnv({}),null);
 assert.equal(loadAb7kSignerRegistryFromEnv({VOX_AB7K_APPROVAL_SIGNER_REGISTRY_JSON:""}),null);
 assert.equal(loadAb7kSignerRegistryFromEnv({VOX_AB7K_APPROVAL_SIGNER_REGISTRY_JSON:"[]"}),null);
 assert.equal(loadAb7kSignerRegistryFromEnv({VOX_AB7K_APPROVAL_SIGNER_REGISTRY_JSON:"{bad"}),null);
 const ok=loadAb7kSignerRegistryFromEnv({VOX_AB7K_APPROVAL_SIGNER_REGISTRY_JSON:JSON.stringify(registry)});
 assert.equal(ok.size,2);
});

test("expired, not-yet-valid and over-long signatures are rejected",async()=>{
 assert.equal((await single({envelope:envelope(owner,{issuedAtMs:NOW-600_000,expiresAtMs:NOW})})).reason,"EXPIRED");
 assert.equal((await single({envelope:envelope(owner,{issuedAtMs:NOW-600_000,expiresAtMs:NOW-1})})).reason,"EXPIRED");
 assert.equal((await single({envelope:envelope(owner,{issuedAtMs:NOW+60_000,expiresAtMs:NOW+120_000})})).reason,"NOT_YET_VALID");
 assert.equal((await single({envelope:envelope(owner,{issuedAtMs:NOW-1000,expiresAtMs:NOW+16*60_000})})).reason,"LIFETIME_DENIED");
 assert.equal((await single({envelope:envelope(owner,{issuedAtMs:NOW-16*60_000,expiresAtMs:NOW+1000})})).reason,"LIFETIME_DENIED");
 // clock moves past expiry between sign and verify
 assert.equal((await single({now:NOW+400_000})).reason,"EXPIRED");
});

test("replay: same envelope twice is denied; failed verification does not burn the nonce",async()=>{
 const s=store(),env=envelope(owner);
 const args={envelope:env,registry,expected,signerRole:"OWNER",replayStore:s,now:NOW};
 assert.equal((await verifyAb7kSignedApproval(args)).ok,true);
 assert.equal((await verifyAb7kSignedApproval(args)).reason,"REPLAY_OR_STORE_DENIED");
 const s2=store();
 const bad=await verifyAb7kSignedApproval({...args,replayStore:s2,
  envelope:{...env,signature:envelope(owner,{nonce:id(88)}).signature}});
 assert.equal(bad.ok,false);assert.equal(s2.claims,0);
 assert.equal((await verifyAb7kSignedApproval({...args,replayStore:s2})).ok,true);
 // nonce reuse by a different envelope of the same type is also a replay
 const s3=store();
 await verifyAb7kSignedApproval({...args,replayStore:s3});
 const other=envelope(owner,{issuedAtMs:NOW-500});
 assert.equal((await verifyAb7kSignedApproval({...args,envelope:other,replayStore:s3})).reason,
  "REPLAY_OR_STORE_DENIED");
});
test("replay: missing, malformed or throwing store denies",async()=>{
 assert.equal((await single({replayStore:undefined})).reason,"REPLAY_STORE_REQUIRED");
 assert.equal((await single({replayStore:{}})).reason,"REPLAY_STORE_REQUIRED");
 assert.equal((await single({replayStore:{claim:async()=>{throw Error("db")}}})).reason,"REPLAY_OR_STORE_DENIED");
 assert.equal((await single({replayStore:{claim:async()=>"true"}})).reason,"REPLAY_OR_STORE_DENIED");
 const r=await single({replayStore:store(false)});
 assert.equal(r.ok,true);assert.equal(r.replayStoreDurable,false);
});
test("pair: one bad half claims nothing; replay of the pair is denied",async()=>{
 const s=store();
 const badTl=envelope(tl);badTl.payload={...badTl.payload,digest:"e".repeat(64)};
 assert.equal((await pair({replayStore:s,teamLeaderEnvelope:badTl})).ok,false);
 assert.equal(s.claims,0);
 const expiredTl=envelope(tl,{issuedAtMs:NOW-600_000,expiresAtMs:NOW-1});
 assert.equal((await pair({replayStore:s,teamLeaderEnvelope:expiredTl})).ok,false);
 assert.equal(s.claims,0);
 assert.equal((await pair({replayStore:s})).ok,true);
 assert.equal((await pair({replayStore:s})).reason,"REPLAY_OR_STORE_DENIED");
 // identical nonces for Owner and TL are not independent proof
 assert.equal((await pair({teamLeaderEnvelope:envelope(tl,{nonce:id(11)})})).reason,"INDEPENDENCE_DENIED");
});

test("domain/type/version separation: signatures do not transfer between contexts",async()=>{
 // Owner signs an OPERATOR_COMMAND payload; attacker relabels it as an EOD release.
 const opPayload=payloadFor(owner,{type:"OPERATOR_COMMAND"});
 const signedOp=signRaw(owner,opPayload,canonicalAb7kApprovalBytes(opPayload));
 const relabelled={payload:{...opPayload,type:"EOD_OFFICIAL_RELEASE"},signature:signedOp.signature};
 assert.equal((await single({envelope:relabelled})).reason,"SIGNATURE_INVALID");
 // Raw JSON.stringify bytes (the older attestation format) never verify here.
 const p=payloadFor(owner);
 assert.equal((await single({envelope:signRaw(owner,p,JSON.stringify(p))})).reason,"SIGNATURE_INVALID");
 // Same fields, missing domain header.
 const noHeader=canonicalAb7kApprovalBytes(p).toString("utf8").split("\n").slice(1).join("\n");
 assert.equal((await single({envelope:signRaw(owner,p,noHeader)})).reason,"SIGNATURE_INVALID");
 // Foreign domain / version / environment are rejected at the shape gate.
 const anySig=envelope(owner).signature;
 for(const over of [{domain:"qf.vox.first-tl-independent-attestation"},{version:"v2"},
   {environment:"production"},{type:"STAFF_SUSPEND"}])
  assert.equal((await single({envelope:{payload:{...payloadFor(owner),...over},
   signature:anySig}})).reason,"PAYLOAD_SHAPE_DENIED",JSON.stringify(over));
});
test("assert harness: canonical builder refuses invalid/extra/missing fields",()=>{
 const p=payloadFor(owner);
 assert.equal(canonicalAb7kApprovalBytes({...p,extra:"x"}),null);
 const {nonce,...missing}=p;void nonce;
 assert.equal(canonicalAb7kApprovalBytes(missing),null);
 assert.equal(canonicalAb7kApprovalBytes({...p,digest:"A".repeat(64)}),null);
 // The test UUID is numeric-only; inject an uppercase hex A explicitly.
 assert.equal(canonicalAb7kApprovalBytes({...p,subjectId:id(1).slice(0,-1)+"A"}),null);
 assert.equal(canonicalAb7kApprovalBytes({...p,keyId:"a\nb=c"}),null);
 assert.equal(canonicalAb7kApprovalBytes({...p,issuedAtMs:"1"}),null);
 assert.equal(canonicalAb7kApprovalBytes({...p,issuedAtMs:1.5}),null);
});

test("digest-only or boolean evidence is never accepted as a signature",async()=>{
 const p=payloadFor(owner);
 const digestOnly=createHash("sha256").update(canonicalAb7kApprovalBytes(p)).digest("base64url");
 assert.equal((await single({envelope:{payload:p,signature:digestOnly}})).ok,false);
 assert.equal((await single({envelope:{payload:p}})).ok,false);
 assert.equal((await single({envelope:{payload:p,signature:true,approved:true}})).ok,false);
 assert.equal((await single({envelope:null})).ok,false);
 assert.equal((await single({envelope:undefined})).ok,false);
});

test("source guard: verifier is not wired into any route/worker; routes stay hard-off",()=>{
 const src=readFileSync(resolve(root,"contracts/vox/ab7kSignedApprovalVerifier.mjs"),"utf8");
 assert.doesNotMatch(src,/PRIVATE KEY|createPrivateKey|generateKeyPair|[^.]sign\(/);
 assert.doesNotMatch(src,/process\.env\./);
 const route=readFileSync(resolve(root,"app/api/vox/v1/official-eod-publish/route.ts"),"utf8");
 assert.ok(route.includes("const VERIFIED_APPROVAL_WRITER_INSTALLED=false as boolean;"));
 assert.doesNotMatch(route,/ab7kSignedApprovalVerifier/);
 const svc=readFileSync(resolve(root,"services/jarvisOperatorCommandService.ts"),"utf8");
 assert.doesNotMatch(svc,/ab7kSignedApprovalVerifier/);
 const overlay=readFileSync(resolve(root,"ops/vox/identity-attestation-overlay/20261030010000_vox_ab7k_identity_attestation_fail_closed_overlay.sql"),"utf8");
 assert.match(overlay,/AB7K_VERIFIED_ATTESTATION_WRITER_NOT_INSTALLED/);
});
