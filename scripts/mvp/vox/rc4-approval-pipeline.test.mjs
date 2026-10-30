import test from "node:test";
import assert from "node:assert/strict";
import {createHash,generateKeyPairSync,sign} from "node:crypto";
import {existsSync,readFileSync,readdirSync} from "node:fs";
import {dirname,join,resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {canonicalAb7kApprovalBytes} from "../../../contracts/vox/ab7kSignedApprovalVerifier.mjs";
import {
 RC4_HUMAN_APPROVED_REGISTRY_FINGERPRINTS,RC4_OFFICIAL_EOD_ENABLED,
 createRc4InMemoryNonceLedgerForTests,mintRc4VerifiedAuthContext,
 prepareRc4SignedApproval,rc4RegistryFingerprint,rc4ScopeTargetHash
} from "../../../contracts/vox/rc4ApprovalPipeline.mjs";

const root=resolve(dirname(fileURLToPath(import.meta.url)),"../../..");
const id=n=>"00000000-0000-4000-8000-"+String(n).padStart(12,"0");
const NOW=1_800_000_000_000;
const TYPE="EOD_OFFICIAL_RELEASE",SUBJECT=id(1),DIGEST="a".repeat(64);
const TEAM=id(20),CITY=id(30);

// Throwaway keys live only in this test process; nothing is written to disk.
function mkSigner(keyId,signerId,signerRole,over={}){
 const {publicKey,privateKey}=generateKeyPairSync("ed25519");
 const pem=publicKey.export({type:"spki",format:"pem"});
 const fp=createHash("sha256").update(publicKey.export({type:"spki",format:"der"})).digest("hex");
 return {privateKey,entry:{keyId,publicKeyPem:pem,publicKeyFingerprint:fp,signerId,signerRole,
  notBeforeMs:NOW-3_600_000,notAfterMs:NOW+3_600_000,...over}};
}
const owner=mkSigner("owner-key-01",id(2),"OWNER");
const tl=mkSigner("tl-key-0001",id(3),"TEAM_LEADER");
const registry=[owner.entry,tl.entry];
const APPROVED=[rc4RegistryFingerprint(registry)];
const NO_REVOCATIONS={keyIds:[],signerIds:[]};

const authBase=(userId,over={})=>({userId,sessionId:id(Number(userId.slice(-3))+500),
 jwtRole:"authenticated",aal:"aal2",aal2AtMs:NOW-60_000,sessionExpiresAtMs:NOW+3_600_000,
 profileRole:null,profileActive:true,staffRole:null,teamId:null,cityId:null,
 membershipRevokedAtMs:null,membershipExpiresAtMs:null,...over});
const ownerClaims=(over={})=>authBase(id(2),{profileRole:"admin",...over});
const tlClaims=(over={})=>authBase(id(3),{staffRole:"team_leader",teamId:TEAM,cityId:CITY,
 membershipExpiresAtMs:NOW+86_400_000,...over});
const ownerAuth=mintRc4VerifiedAuthContext(ownerClaims());
const tlAuth=mintRc4VerifiedAuthContext(tlClaims());

function payloadFor(s,over={}){
 const scope=rc4ScopeTargetHash({type:TYPE,subjectId:SUBJECT,teamId:TEAM,cityId:CITY});
 return {domain:"qf.vox.ab7k.signed-approval",version:"v1",type:TYPE,environment:"staging",
  keyId:s.entry.keyId,signerRole:s.entry.signerRole,signerId:s.entry.signerId,
  ownerId:id(2),teamLeaderId:id(3),subjectId:SUBJECT,digest:DIGEST,targetHash:scope,
  nonce:s===owner?id(11):id(12),issuedAtMs:NOW-1000,expiresAtMs:NOW+300_000,...over};
}
function envelope(s,over={},signWith=s){
 const payload=payloadFor(s,over);
 const bytes=canonicalAb7kApprovalBytes(payload);
 assert.ok(bytes,"test payload must be canonical");
 return {payload,signature:sign(null,bytes,signWith.privateKey).toString("base64url")};
}
const requestFor=(over={})=>({type:TYPE,subjectId:SUBJECT,digest:DIGEST,teamId:TEAM,cityId:CITY,
 ownerEnvelope:envelope(owner),teamLeaderEnvelope:envelope(tl),...over});
const run=(o={})=>prepareRc4SignedApproval({request:requestFor(),ownerAuth,teamLeaderAuth:tlAuth,
 registry,approvedRegistryFingerprints:APPROVED,revocations:NO_REVOCATIONS,
 ledger:createRc4InMemoryNonceLedgerForTests(),now:NOW,...o});
const assertDenied=(r,reason)=>{
 assert.equal(r.ok,false);assert.equal(r.reason,reason);
 assert.equal(r.approved,false);assert.equal(r.canAuthorize,false);
 assert.equal(r.preparationVerified,false);assert.equal(r.officialEodEnabled,false);
};

test("positive: genuine pair prepares, but never approves, authorizes or enables EOD",async()=>{
 const ledger=createRc4InMemoryNonceLedgerForTests();
 const r=await run({ledger});
 assert.equal(r.ok,true);assert.equal(r.preparationVerified,true);
 assert.equal(r.signatureVerified,true);
 assert.equal(r.approved,false);assert.equal(r.canAuthorize,false);
 assert.equal(r.officialEodEnabled,false);assert.equal(RC4_OFFICIAL_EOD_ENABLED,false);
 assert.equal(r.ownerId,id(2));assert.equal(r.teamLeaderId,id(3));
 assert.equal(ledger.size,3);
 assert.ok(r.blockers.includes("FEATURE_GATE_HARD_OFF"));
 assert.ok(r.blockers.includes("NONCE_LEDGER_NOT_DURABLE"));
 assert.ok(r.blockers.includes("HUMAN_OWNER_TL_ENROLMENT_CEREMONY"));
 assert.ok(Object.isFrozen(r));
});

test("no human-approved keys in source: default pins are EMPTY => deny, nothing claimed",async()=>{
 assert.deepEqual([...RC4_HUMAN_APPROVED_REGISTRY_FINGERPRINTS],[]);
 const ledger=createRc4InMemoryNonceLedgerForTests();
 const args={request:requestFor(),ownerAuth,teamLeaderAuth:tlAuth,registry,
  revocations:NO_REVOCATIONS,ledger,now:NOW};
 assertDenied(await prepareRc4SignedApproval(args),"KEY_ENROLMENT_NOT_HUMAN_APPROVED_DENY");
 // a different (attacker) registry is not pinned either
 const evil=mkSigner("owner-key-01",id(2),"OWNER");
 assertDenied(await run({registry:[evil.entry,tl.entry],ledger}),"KEY_ENROLMENT_NOT_HUMAN_APPROVED_DENY");
 assert.equal(ledger.claimCalls,0);
 for(const reg of [undefined,null,[],{},""])
  assertDenied(await run({registry:reg}),"SIGNER_REGISTRY_UNCONFIGURED_DENY");
});

test("verified auth context: only server-minted, AAL2, active, role-consistent contexts exist",()=>{
 assert.ok(ownerAuth&&tlAuth);
 assert.equal(ownerAuth.approverRole,"OWNER");assert.equal(tlAuth.approverRole,"TEAM_LEADER");
 assert.equal(mintRc4VerifiedAuthContext(ownerClaims({aal:"aal1"})),null);
 assert.equal(mintRc4VerifiedAuthContext(ownerClaims({aal:undefined})),null);
 assert.equal(mintRc4VerifiedAuthContext(ownerClaims({jwtRole:"service_role"})),null);
 assert.equal(mintRc4VerifiedAuthContext(ownerClaims({jwtRole:"anon"})),null);
 assert.equal(mintRc4VerifiedAuthContext(ownerClaims({profileActive:false})),null);
 assert.equal(mintRc4VerifiedAuthContext(tlClaims({membershipRevokedAtMs:NOW-1})),null);
 assert.equal(mintRc4VerifiedAuthContext(tlClaims({teamId:null})),null);
 assert.equal(mintRc4VerifiedAuthContext(tlClaims({staffRole:"agent"})),null);
 // a team leader who is also an admin profile is ambiguous => no context
 assert.equal(mintRc4VerifiedAuthContext(tlClaims({profileRole:"admin"})),null);
 assert.equal(mintRc4VerifiedAuthContext({...ownerClaims(),extra:1}),null);
 assert.equal(mintRc4VerifiedAuthContext(null),null);
});

test("request-body actor claims and unbranded/forged auth contexts are rejected",async()=>{
 for(const k of ["ownerId","actorId","signerId","role","teamLeaderId","aal","approved","userId"])
  assertDenied(await run({request:{...requestFor(),[k]:id(2)}}),"ACTOR_CLAIM_IN_REQUEST_DENIED");
 assertDenied(await run({request:{...requestFor(),foo:1}}),"REQUEST_SHAPE_DENIED");
 assertDenied(await run({request:null}),"REQUEST_SHAPE_DENIED");
 // a plain object that looks exactly like a minted context (e.g. parsed from JSON)
 const lookalike=JSON.parse(JSON.stringify(ownerAuth));
 assertDenied(await run({ownerAuth:lookalike}),"AUTH_CONTEXT_UNVERIFIED_DENIED");
 assertDenied(await run({teamLeaderAuth:{...tlAuth}}),"AUTH_CONTEXT_UNVERIFIED_DENIED");
 assertDenied(await run({ownerAuth:undefined}),"AUTH_CONTEXT_UNVERIFIED_DENIED");
});

test("wrong role: TL context in the Owner slot (and vice versa) is denied",async()=>{
 assertDenied(await run({ownerAuth:tlAuth}),"AUTH_ROLE_DENIED");
 assertDenied(await run({teamLeaderAuth:ownerAuth}),"AUTH_ROLE_DENIED");
 // envelopes swapped between slots
 const swapped=requestFor({ownerEnvelope:envelope(tl),teamLeaderEnvelope:envelope(owner)});
 const r=await run({request:swapped});
 assert.equal(r.ok,false);
 assert.ok(["SIGNER_ROLE_OR_SUBJECT_DENIED","KEY_NOT_ENROLLED_FOR_SIGNER_ROLE"].includes(r.reason),r.reason);
});

test("same signer / not independent: one person, one session, or dual-role keys are denied",async()=>{
 // same human authenticated twice in both slots
 const ownerAsTl=mintRc4VerifiedAuthContext(authBase(id(2),{profileRole:"admin",staffRole:"team_leader",
  teamId:TEAM,cityId:CITY,membershipExpiresAtMs:NOW+86_400_000}));
 assert.equal(ownerAsTl,null); // admin+TL ambiguity never mints
 // two contexts sharing one session id
 const sameSession=mintRc4VerifiedAuthContext(tlClaims({sessionId:ownerAuth.sessionId}));
 assertDenied(await run({teamLeaderAuth:sameSession}),"INDEPENDENCE_DENIED");
 // same user id on both contexts (forced via a TL-shaped context for the owner's id)
 const sameUser=mintRc4VerifiedAuthContext({...tlClaims(),userId:ownerAuth.userId});
 assertDenied(await run({teamLeaderAuth:sameUser}),"INDEPENDENCE_DENIED");
 // the Owner key signs both envelopes
 const bothOwner=requestFor({teamLeaderEnvelope:envelope(owner,{signerRole:"TEAM_LEADER",signerId:id(3)})});
 const r=await run({request:bothOwner});
 assert.equal(r.ok,false);
 // one human enrolled as both Owner and TL voids the registry entirely
 const dual=mkSigner("dual-role-key",id(2),"TEAM_LEADER");
 assertDenied(await run({registry:[owner.entry,dual.entry]}),"SIGNER_REGISTRY_UNCONFIGURED_DENY");
 // identical nonces are not two independent approvals
 const sameNonce=requestFor({teamLeaderEnvelope:envelope(tl,{nonce:id(11)})});
 assertDenied(await run({request:sameNonce}),"INDEPENDENCE_DENIED");
});

test("wrong team / city: context scope and signed scope must both match",async()=>{
 const ledger=createRc4InMemoryNonceLedgerForTests();
 // request names another team or city than the TL's verified membership
 assertDenied(await run({ledger,request:requestFor({teamId:id(21)})}),"TEAM_CITY_SCOPE_DENIED");
 assertDenied(await run({ledger,request:requestFor({cityId:id(31)})}),"TEAM_CITY_SCOPE_DENIED");
 // TL of another team/city authenticated for this request
 const otherTeam=mintRc4VerifiedAuthContext(tlClaims({teamId:id(21)}));
 assertDenied(await run({ledger,teamLeaderAuth:otherTeam}),"TEAM_CITY_SCOPE_DENIED");
 const otherCity=mintRc4VerifiedAuthContext(tlClaims({cityId:id(31)}));
 assertDenied(await run({ledger,teamLeaderAuth:otherCity}),"TEAM_CITY_SCOPE_DENIED");
 // contexts agree with the request, but the SIGNATURES were made for another scope
 const signedOther=rc4ScopeTargetHash({type:TYPE,subjectId:SUBJECT,teamId:id(21),cityId:CITY});
 const r=await run({ledger,request:requestFor({ownerEnvelope:envelope(owner,{targetHash:signedOther}),
  teamLeaderEnvelope:envelope(tl,{targetHash:signedOther})})});
 assertDenied(r,"SUBJECT_BINDING_DENIED");
 assert.equal(ledger.claimCalls,0);
 assert.notEqual(signedOther,rc4ScopeTargetHash({type:TYPE,subjectId:SUBJECT,teamId:TEAM,cityId:CITY}));
});

test("forged signatures are rejected with real Ed25519 verification",async()=>{
 const ledger=createRc4InMemoryNonceLedgerForTests();
 // TL's private key signs a payload claiming the Owner key id
 const forged=envelope(owner,{},tl);
 assertDenied(await run({ledger,request:requestFor({ownerEnvelope:forged})}),"SIGNATURE_INVALID");
 // one flipped bit in a genuine signature
 const good=envelope(tl),raw=Buffer.from(good.signature,"base64url");raw[7]^=1;
 assertDenied(await run({ledger,request:requestFor({
  teamLeaderEnvelope:{...good,signature:raw.toString("base64url")}})}),"SIGNATURE_INVALID");
 // tampered signed field (digest is pinned by caller; nonce is not)
 const tampered={...envelope(owner)};tampered.payload={...tampered.payload,nonce:id(99)};
 assertDenied(await run({ledger,request:requestFor({ownerEnvelope:tampered})}),"SIGNATURE_INVALID");
 // attacker generates their own key but claims a pinned key id
 const attacker=mkSigner("owner-key-01",id(2),"OWNER");
 assertDenied(await run({ledger,request:requestFor({ownerEnvelope:envelope(owner,{},attacker)})}),"SIGNATURE_INVALID");
 // digest-only / boolean "signatures"
 const p=payloadFor(owner);
 const digestOnly=createHash("sha256").update(canonicalAb7kApprovalBytes(p)).digest("base64url");
 assert.equal((await run({ledger,request:requestFor({ownerEnvelope:{payload:p,signature:digestOnly}})})).ok,false);
 assert.equal((await run({ledger,request:requestFor({ownerEnvelope:{payload:p,signature:true}})})).ok,false);
 assert.equal(ledger.claimCalls,0);assert.equal(ledger.size,0);
});

test("expired, not-yet-valid, over-long, stale-AAL2 and expired-session inputs are denied",async()=>{
 const ledger=createRc4InMemoryNonceLedgerForTests();
 const exp=envelope(tl,{issuedAtMs:NOW-600_000,expiresAtMs:NOW-1});
 assertDenied(await run({ledger,request:requestFor({teamLeaderEnvelope:exp})}),"EXPIRED");
 assertDenied(await run({ledger,now:NOW+400_000}),"EXPIRED");
 assertDenied(await run({ledger,request:requestFor({
  ownerEnvelope:envelope(owner,{issuedAtMs:NOW+60_000,expiresAtMs:NOW+120_000})})}),"NOT_YET_VALID");
 assertDenied(await run({ledger,request:requestFor({
  ownerEnvelope:envelope(owner,{expiresAtMs:NOW+16*60_000})})}),"LIFETIME_DENIED");
 const staleOwner=mintRc4VerifiedAuthContext(ownerClaims({aal2AtMs:NOW-16*60_000}));
 assertDenied(await run({ledger,ownerAuth:staleOwner}),"AUTH_AAL2_STALE_DENIED");
 const shortSession=mintRc4VerifiedAuthContext(tlClaims({sessionExpiresAtMs:NOW+1}));
 assertDenied(await run({ledger,teamLeaderAuth:shortSession,now:NOW+2}),"AUTH_SESSION_EXPIRED_DENIED");
 const shortMembership=mintRc4VerifiedAuthContext(tlClaims({membershipExpiresAtMs:NOW+1}));
 assertDenied(await run({ledger,teamLeaderAuth:shortMembership,now:NOW+2}),"AUTH_MEMBERSHIP_EXPIRED_DENIED");
 assert.equal(ledger.claimCalls,0);
 // key validity window
 const early=mkSigner("owner-key-01",id(2),"OWNER",{notBeforeMs:NOW+1000,notAfterMs:NOW+9000});
 const reg=[early.entry,tl.entry];
 assertDenied(await run({ledger,registry:reg,approvedRegistryFingerprints:[rc4RegistryFingerprint(reg)],
  request:requestFor({ownerEnvelope:envelope(early)})}),"KEY_OUTSIDE_VALIDITY_WINDOW");
});

test("replay: same pair twice, fresh nonces for same subject, and cross-ledger state",async()=>{
 const ledger=createRc4InMemoryNonceLedgerForTests();
 assert.equal((await run({ledger})).ok,true);
 assertDenied(await run({ledger}),"REPLAY_OR_LEDGER_DENIED");
 // fresh nonces + fresh valid signatures for the SAME subject: subject already consumed
 const fresh=requestFor({ownerEnvelope:envelope(owner,{nonce:id(41)}),
  teamLeaderEnvelope:envelope(tl,{nonce:id(42)})});
 assertDenied(await run({ledger,request:fresh}),"REPLAY_OR_LEDGER_DENIED");
 // reusing only the Owner nonce under a new subject is still a replay
 const subj2=id(2000);
 const scope2=rc4ScopeTargetHash({type:TYPE,subjectId:subj2,teamId:TEAM,cityId:CITY});
 const o2={subjectId:subj2,targetHash:scope2},sameOwnerNonce=requestFor({subjectId:subj2,
  ownerEnvelope:envelope(owner,o2),teamLeaderEnvelope:envelope(tl,{...o2,nonce:id(43)})});
 assertDenied(await run({ledger,request:sameOwnerNonce}),"REPLAY_OR_LEDGER_DENIED");
 assert.equal(ledger.size,3); // the denied attempts claimed nothing
 // a different subject with all-fresh nonces is allowed
 const ok2=requestFor({subjectId:subj2,
  ownerEnvelope:envelope(owner,{...o2,nonce:id(44)}),teamLeaderEnvelope:envelope(tl,{...o2,nonce:id(45)})});
 assert.equal((await run({ledger,request:ok2})).ok,true);
});

test("atomicity: ledger failure claims nothing and a later retry still succeeds; races yield one winner",async()=>{
 const broken=createRc4InMemoryNonceLedgerForTests({failWith:new Error("db down")});
 assertDenied(await run({ledger:broken}),"REPLAY_OR_LEDGER_DENIED");
 assert.equal(broken.size,0);
 assertDenied(await run({ledger:{claimAll:async()=>"true"}}),"REPLAY_OR_LEDGER_DENIED");
 assertDenied(await run({ledger:{}}),"LEDGER_REQUIRED_DENY");
 assertDenied(await run({ledger:undefined}),"LEDGER_REQUIRED_DENY");
 const ledger=createRc4InMemoryNonceLedgerForTests();
 const results=await Promise.all(Array.from({length:8},()=>run({ledger})));
 assert.equal(results.filter(r=>r.ok).length,1);
 assert.equal(ledger.size,3);
});

test("revocation: revoked key id, revoked signer, absent or malformed list all deny",async()=>{
 const ledger=createRc4InMemoryNonceLedgerForTests();
 assertDenied(await run({ledger,revocations:{keyIds:["owner-key-01"],signerIds:[]}}),"REVOKED_DENIED");
 assertDenied(await run({ledger,revocations:{keyIds:["tl-key-0001"],signerIds:[]}}),"REVOKED_DENIED");
 assertDenied(await run({ledger,revocations:{keyIds:[],signerIds:[id(3)]}}),"REVOKED_DENIED");
 for(const rv of [undefined,null,{},{keyIds:[]},{keyIds:[],signerIds:[1]},[]])
  assertDenied(await run({ledger,revocations:rv}),"REVOCATION_LIST_REQUIRED_DENY");
 // an unrelated revocation does not block
 assert.equal((await run({ledger,revocations:{keyIds:["other-key-01"],signerIds:[id(77)]}})).ok,true);
 assert.equal(ledger.size,3);
 // a key removed from the registry (revocation by removal) changes the pinned fingerprint
 assertDenied(await run({ledger:createRc4InMemoryNonceLedgerForTests(),registry:[tl.entry]}),
  "KEY_ENROLMENT_NOT_HUMAN_APPROVED_DENY");
});

test("registry fingerprint is order-independent and sensitive to every pinned field",()=>{
 const f=rc4RegistryFingerprint(registry);
 assert.match(f,/^[a-f0-9]{64}$/);
 assert.equal(rc4RegistryFingerprint([tl.entry,owner.entry]),f);
 assert.notEqual(rc4RegistryFingerprint([{...owner.entry,notAfterMs:owner.entry.notAfterMs+1},tl.entry]),f);
 assert.equal(rc4RegistryFingerprint([]),null);
});

test("source guards: pipeline is unwired, key-free and env-free; SQL overlay grants nothing",()=>{
 const src=readFileSync(resolve(root,"contracts/vox/rc4ApprovalPipeline.mjs"),"utf8");
 assert.doesNotMatch(src,/PRIVATE KEY|createPrivateKey|generateKeyPair|[^.\w]sign\(|process\.env|fetch\(|node:fs|node:http/);
 assert.match(src,/export const RC4_OFFICIAL_EOD_ENABLED=false;/);
 // no route, worker, service or other contract imports it
 const importers=[];
 const walk=d=>{for(const e of readdirSync(d,{withFileTypes:true})){
  if(["node_modules",".next",".git","docs"].includes(e.name))continue;
  const p=join(d,e.name);
  if(e.isDirectory())walk(p);
  else if(/\.(mjs|js|ts|tsx)$/.test(e.name)&&!/rc4-approval|rc4ApprovalPipeline/.test(e.name)&&
   /rc4ApprovalPipeline/.test(readFileSync(p,"utf8")))importers.push(p);}};
 for(const d of ["app","services","lib","contracts","workers","components"])
  if(existsSync(resolve(root,d)))walk(resolve(root,d));
 assert.deepEqual(importers,[]);
 const route=resolve(root,"app/api/vox/v1/official-eod-publish/route.ts");
 if(existsSync(route))
  assert.ok(readFileSync(route,"utf8").includes("const VERIFIED_APPROVAL_WRITER_INSTALLED=false as boolean;"));

 const dir=resolve(root,"ops/vox/rc4-approval-overlay");
 const ledgerSql=readFileSync(join(dir,"20261030020000_vox_rc4_approval_nonce_ledger_disposable.sql"),"utf8")
  .replace(/--[^\n]*/g,"");
 assert.match(ledgerSql,/qf_disposable_/);
 assert.doesNotMatch(ledgerSql,/\bgrant\b/i);
 assert.doesNotMatch(ledgerSql,/\b(anon|authenticated|service_role)\b/i);
 assert.match(ledgerSql,/enable always trigger rc4_ledger_no_mutation/i);
 assert.match(ledgerSql,/enable always trigger rc4_ledger_no_truncate/i);
 assert.match(ledgerSql,/security definer set search_path=''/i);
 assert.match(ledgerSql,/exception when unique_violation then\s+raise exception 'RC4_REPLAY_DENIED'/i);
 assert.match(ledgerSql,/revoke all on function public\.qf_vox_rc4_claim_approval_keys_v1\(text\[\],text,timestamptz\) from public/i);
 assert.doesNotMatch(ledgerSql,/auth\.|crypto_sign|ed25519/i);
 assert.ok(existsSync(join(dir,"verify_rc4_approval_ledger_disposable_only.sql")));
});
