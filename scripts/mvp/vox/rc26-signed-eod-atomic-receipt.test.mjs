// RC26 Track C: atomic verified signed-EOD pending receipt, signer key
// registration/revocation validity, ambiguous-COMMIT nonce reconciliation and
// closed publication state. TEST ONLY: synthetic Ed25519 keys and an in-memory
// transactional stand-in for PostgreSQL. No network, Docker, env or secrets.
// Real-PG17 coverage lives in validate-vox-rc8-real-pg-signed-intent.mjs.
import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {resolve,dirname} from "node:path";
import {fileURLToPath} from "node:url";
import {createHash,generateKeyPairSync,randomUUID,sign} from "node:crypto";
import {mintRc4VerifiedAuthContext,rc4RegistryFingerprint,rc4ScopeTargetHash,
 RC4_OFFICIAL_EOD_ENABLED,RC4_HUMAN_APPROVED_REGISTRY_FINGERPRINTS}
 from "../../../contracts/vox/rc4ApprovalPipeline.mjs";
import {canonicalAb7kApprovalBytes} from "../../../contracts/vox/ab7kSignedApprovalVerifier.mjs";
import {executeRc8PgPendingSignedIntent,executeRc8PgPendingSignedIntentProduction,
 reconcileRc8PgSignedIntentOutcome,rc8SignedEodPublicationAuthorizationState,
 rc8SignedIntentReceiptSha256,RC8_APPROVAL_WRITER_INSTALLED,RC8_NATIVE_APPROVAL_GATE}
 from "./rc8-pg-signed-intent-writer.mjs";
const root=resolve(dirname(fileURLToPath(import.meta.url)),"../../..");
const read=p=>readFileSync(resolve(root,p),"utf8");
const id=n=>"00000000-0000-4000-8000-"+String(n).padStart(12,"0");
const OWNER=id(1),TL=id(2),TEAM=id(3),CITY=id(4),SUB=id(5),STAFF=id(90);
const TYPE="EOD_OFFICIAL_RELEASE",DIGEST="b".repeat(64);
const now=Date.now();
const TEST_ONLY_GATE={humanKeyCeremonyComplete:true,independentDbaAppsecApproved:true,
 dedicatedWriterRoleReviewed:true,managedRestoreCertified:true};
function signer(keyId,signerId,role){
 const pair=generateKeyPairSync("ed25519");
 return {pair,entry:{keyId,signerId,signerRole:role,
  publicKeyPem:pair.publicKey.export({type:"spki",format:"pem"}),
  publicKeyFingerprint:createHash("sha256").update(pair.publicKey.export({type:"spki",format:"der"})).digest("hex"),
  notBeforeMs:now-60000,notAfterMs:now+3600000}};
}
const owner=signer("owner-rc26-synthetic",OWNER,"OWNER");
const leader=signer("tl-rc26-synthetic",TL,"TEAM_LEADER");
const registry=[owner.entry,leader.entry],fingerprint=rc4RegistryFingerprint(registry);
const auth=(userId,values)=>mintRc4VerifiedAuthContext({userId,sessionId:id(userId===OWNER?80:81),
 jwtRole:"authenticated",aal:"aal2",aal2AtMs:now-1000,sessionExpiresAtMs:now+600000,
 profileRole:null,profileActive:true,staffRole:null,teamId:null,cityId:null,
 membershipRevokedAtMs:null,membershipExpiresAtMs:null,...values});
const ownerAuth=auth(OWNER,{profileRole:"admin"});
const teamLeaderAuth=auth(TL,{staffRole:"team_leader",teamId:TEAM,cityId:CITY,
 membershipExpiresAtMs:now+600000});
function envelope(s,nonce){
 const payload={domain:"qf.vox.ab7k.signed-approval",version:"v1",type:TYPE,
  environment:"staging",keyId:s.entry.keyId,signerRole:s.entry.signerRole,
  signerId:s.entry.signerId,ownerId:OWNER,teamLeaderId:TL,subjectId:SUB,digest:DIGEST,
  targetHash:rc4ScopeTargetHash({type:TYPE,subjectId:SUB,teamId:TEAM,cityId:CITY}),
  nonce:id(nonce),issuedAtMs:now-1000,expiresAtMs:now+540000};
 return {payload,signature:sign(null,canonicalAb7kApprovalBytes(payload),s.pair.privateKey).toString("base64url")};
}
const request=(o=7,t=8)=>({type:TYPE,subjectId:SUB,digest:DIGEST,teamId:TEAM,cityId:CITY,
 ownerEnvelope:envelope(owner,o),teamLeaderEnvelope:envelope(leader,t)});

/** Minimal transactional stand-in: uncommitted inserts vanish on ROLLBACK. */
function fakeDb({revoked=[],enrolmentEffective=true,registryRows=registry}={}){
 // locks: intent advisory locks held by open writer transactions.
 // stallCommit: the COMMIT response is lost BEFORE the server applies it; the
 // backend keeps its transaction (and lock) until db.landStalledCommit().
 const db={report:{},claims:new Map(),intents:new Map(),revoked:new Set(revoked),log:[],
  dropCommitResponse:false,stallCommit:false,landStalledCommit:null,locks:new Set(),releases:0,destroyedReleases:0};
 db.connect=async()=>{
  let pc=new Map(),pi=new Map(),held=new Set();
  const claims=()=>new Map([...db.claims,...pc]),intents=()=>new Map([...db.intents,...pi]);
  const rows=r=>({rows:r,rowCount:r.length});
  const end=()=>{for(const k of held)db.locks.delete(k);held=new Set();pc=new Map();pi=new Map();};
  return {release(destroy=false){db.releases++;if(destroy)db.destroyedReleases++;},async query(sql,v=[]){
   db.log.push(sql);
   if(sql.startsWith("BEGIN")){end();return rows([]);}
   if(sql==="ROLLBACK"){end();return rows([]);}
   if(sql==="COMMIT"){
    if(db.stallCommit){
     const [c,i,h]=[pc,pi,held];pc=new Map();pi=new Map();held=new Set();
     db.landStalledCommit=()=>{for(const [k,x] of c)db.claims.set(k,x);
      for(const [k,x] of i)db.intents.set(k,x);for(const k of h)db.locks.delete(k);};
     throw Error("SYNTHETIC_COMMIT_RESPONSE_LOST_BEFORE_APPLY");
    }
    for(const [k,x] of pc)db.claims.set(k,x);for(const [k,x] of pi)db.intents.set(k,x);
    end();if(db.dropCommitResponse)throw Error("SYNTHETIC_POST_COMMIT_TRANSPORT_DROP");
    return rows([]);}
   if(sql.startsWith("LOCK TABLE"))return rows([]);
   if(sql.includes("pg_advisory_xact_lock(")){db.locks.add(v[0]);held.add(v[0]);return rows([{}]);}
   if(sql.includes("pg_try_advisory_xact_lock_shared("))
    return rows([{writerFinished:!db.locks.has(v[0])}]);
   if(sql.includes("FROM public.profiles p JOIN auth.users"))return rows(v[0]===OWNER?[{id:OWNER}]:[]);
   if(sql.includes("FOR SHARE OF m,p,t,a"))return rows(v[0]===TL?[{auth_user_id:TL}]:[]);
   if(sql.includes("FOR SHARE OF m,t,p,a"))return rows(v[0]===STAFF?[{auth_user_id:STAFF}]:[]);
   if(sql.includes("vox_ab7f_four_source_eod_candidate_v1")){
    const r={id:SUB,staff_id:STAFF,team_id:TEAM,city_id:CITY,reviewer_id:TL,
     source_count:4,source_digest:DIGEST,
     state:"TL_ACKNOWLEDGED_AWAITING_OWNER_RELEASE",published:false,...db.report};
    if(db.report===null)return rows([]);
    // Reconciler's read-only report query uses camelCase aliases.
    if(sql.includes('AS "sourceDigest"'))return rows([{teamId:r.team_id,cityId:r.city_id,staffId:r.staff_id,
     reviewerId:r.reviewer_id,sourceCount:r.source_count,sourceDigest:r.source_digest,
     state:r.state,published:r.published}]);
    return rows([r]);}
   if(sql.includes('AS "revoked"'))
    return rows(registryRows.filter(r=>v.includes(r.signerId)).map(r=>({keyId:r.keyId,
     signerId:r.signerId,signerRole:r.signerRole,revoked:db.revoked.has(r.keyId)})));
   if(sql.includes("human_signer_registry_candidate_v1"))
    return rows(registryRows.map(r=>({...r,notBeforeMs:String(r.notBeforeMs),
     notAfterMs:String(r.notAfterMs),enrolmentEffective})));
   if(sql.includes("SELECT key_id FROM public.vox_rc8_signer_revocations"))
    return rows([...db.revoked].map(key_id=>({key_id})));
   if(sql.includes("INSERT INTO public.vox_rc8_approval_claims_candidate_v1")){
    if(claims().has(v[0]))return rows([]);
    pc.set(v[0],{claimKey:v[0],claimKind:v[1],intentId:v[2]});return rows([{claim_key:v[0]}]);}
   if(sql.includes("INSERT INTO public.vox_rc8_verified_intents_candidate_v1")){
    if([...intents().values()].some(i=>i.type===v[1]&&i.subjectId===v[2]))throw Object.assign(Error("unique"),{code:"23505"});
    pi.set(v[0],{id:v[0],type:v[1],subjectId:v[2],digest:v[3],teamId:v[4],cityId:v[5],
     ownerId:v[6],teamLeaderId:v[7],verifiedSignaturePair:true,state:"AWAITING_EXTERNAL_REVIEW"});
    return rows([{id:v[0]}]);}
   if(sql.includes("FROM public.vox_rc8_verified_intents_candidate_v1 WHERE id="))
    return rows(intents().has(v[0])?[intents().get(v[0])]:[]);
   if(sql.includes("FROM public.vox_rc8_approval_claims_candidate_v1 WHERE intent_id="))
    return rows([...claims().values()].filter(c=>c.intentId===v[0])
     .map(({claimKey,claimKind})=>({claimKey,claimKind})));
   if(sql.includes("WHERE type='EOD_OFFICIAL_RELEASE' AND subject_id="))
    return rows([...intents().values()].filter(i=>i.subjectId===v[0]).map(i=>({id:i.id})));
   if(sql.includes("m.team_id=$1::uuid AND m.is_active=true"))
    return rows([{auth_user_id:TL},{auth_user_id:STAFF}]);
   throw Error("UNEXPECTED_SQL "+sql.slice(0,60));
  }};
 };
 return db;
}
const args=(db,req=request())=>({acquireClient:db.connect,request:req,ownerAuth,
 teamLeaderAuth,now,approvedRegistryFingerprints:[fingerprint]});

test("source gates stay closed and production entry never opens a transaction",async()=>{
 assert.equal(RC8_APPROVAL_WRITER_INSTALLED,false);
 assert.equal(RC4_OFFICIAL_EOD_ENABLED,false);
 assert.equal(RC4_HUMAN_APPROVED_REGISTRY_FINGERPRINTS.length,0);
 assert.ok(Object.values(RC8_NATIVE_APPROVAL_GATE).every(v=>v===false));
 const db=fakeDb();
 const r=await executeRc8PgPendingSignedIntentProduction(args(db));
 assert.equal(r.reason,"NATIVE_RELEASE_GATE_CLOSED");
 assert.equal(db.log.length,0);
});

test("revocation table is SHARE-locked before the SERIALIZABLE snapshot",async()=>{
 const db=fakeDb();
 const r=await executeRc8PgPendingSignedIntent(args(db),TEST_ONLY_GATE);
 assert.equal(r.ok,true,r.reason);
 assert.match(db.log[0],/^BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE/);
 assert.equal(db.log[1],"LOCK TABLE public.vox_rc8_signer_revocations_candidate_v1 IN SHARE MODE");
});

test("atomic writer returns an auditable receipt recomputable from durable rows",async()=>{
 const db=fakeDb();
 const r=await executeRc8PgPendingSignedIntent(args(db),TEST_ONLY_GATE);
 assert.equal(r.ok,true,r.reason);
 assert.equal(r.approved,false);assert.equal(r.canAuthorize,false);
 assert.equal(r.officialEodEnabled,false);
 assert.match(r.receiptSha256,/^[a-f0-9]{64}$/);
 assert.equal(r.receipt.receiptSha256,r.receiptSha256);
 assert.equal(r.receipt.ownerKeyId,owner.entry.keyId);
 assert.equal(r.receipt.teamLeaderKeyId,leader.entry.keyId);
 assert.equal(r.receipt.registryFingerprint,fingerprint);
 assert.deepEqual(r.receipt.claims.map(c=>c.claimKind).sort(),["OWNER_NONCE","SUBJECT","TL_NONCE"]);
 assert.ok(Object.isFrozen(r.receipt));
 const stored=db.intents.get(r.intentId);
 const storedClaims=[...db.claims.values()].filter(c=>c.intentId===r.intentId);
 assert.equal(rc8SignedIntentReceiptSha256(stored,storedClaims),r.receiptSha256);
 // Changing any durable field changes the digest.
 assert.notEqual(rc8SignedIntentReceiptSha256({...stored,digest:"c".repeat(64)},storedClaims),r.receiptSha256);
 assert.equal(rc8SignedIntentReceiptSha256(stored,storedClaims.slice(0,2)),null);
 assert.equal(db.releases,1);
 assert.equal(db.destroyedReleases,0);
});

test("revoked pinned signer key denies before any nonce claim",async()=>{
 for(const key of [owner.entry.keyId,leader.entry.keyId]){
  const db=fakeDb({revoked:[key]});
  const r=await executeRc8PgPendingSignedIntent(args(db),TEST_ONLY_GATE);
  assert.equal(r.reason,"SIGNER_KEY_REVOKED");
  assert.equal(db.claims.size,0);assert.equal(db.intents.size,0);
  assert.ok(!db.log.some(s=>s.includes("INSERT INTO")));
 }
});

test("future-dated or unstamped key registration is not effective",async()=>{
 const db=fakeDb({enrolmentEffective:false});
 const r=await executeRc8PgPendingSignedIntent(args(db),TEST_ONLY_GATE);
 assert.equal(r.reason,"SIGNER_KEY_REGISTRATION_NOT_EFFECTIVE");
 assert.equal(db.claims.size,0);
});

test("pinned registry must bind exactly the current Owner and Team Leader",async()=>{
 const stranger=signer("tl-rc26-stranger",id(77),"TEAM_LEADER");
 const rows=[owner.entry,stranger.entry];
 const db=fakeDb({registryRows:rows});
 const r=await executeRc8PgPendingSignedIntent({...args(db),
  approvedRegistryFingerprints:[rc4RegistryFingerprint(rows)]},TEST_ONLY_GATE);
 assert.equal(r.reason,"SIGNER_REGISTRY_ACTOR_BINDING_DENIED");
 assert.equal(db.claims.size,0);
});

test("ambiguous COMMIT reconciles to the exact durable receipt, never re-claims",async()=>{
 const db=fakeDb();db.dropCommitResponse=true;
 const r=await executeRc8PgPendingSignedIntent(args(db),TEST_ONLY_GATE);
 assert.equal(r.reason,"COMMIT_OUTCOME_UNKNOWN");
 assert.equal(db.destroyedReleases,1,"unknown COMMIT discards backend");
 assert.equal(r.committed,null);assert.equal(r.requiresReconciliation,true);
 assert.match(r.receiptSha256,/^[a-f0-9]{64}$/);
 assert.equal(rc8SignedEodPublicationAuthorizationState(r).state,
  "COMMIT_OUTCOME_UNKNOWN_RECONCILE_REQUIRED");
 db.dropCommitResponse=false;
 const before=db.log.length;
 const rec=await reconcileRc8PgSignedIntentOutcome({acquireClient:db.connect,
  intentId:r.intentId,subjectId:SUB,expectedReceiptSha256:r.receiptSha256});
 assert.equal(rec.outcome,"COMMITTED");assert.equal(rec.receiptSha256,r.receiptSha256);
 assert.equal(rec.approved,false);assert.equal(rec.publicationAuthorized,false);
 const recSql=db.log.slice(before);
 assert.match(recSql[0],/READ ONLY/);
 assert.ok(!recSql.some(s=>/\b(?:INSERT|UPDATE|DELETE|COMMIT)\b/.test(s)));
 assert.equal(recSql.at(-1),"ROLLBACK");
 // A mismatching expected digest is never accepted as the same receipt.
 const wrong=await reconcileRc8PgSignedIntentOutcome({acquireClient:db.connect,
  intentId:r.intentId,subjectId:SUB,expectedReceiptSha256:"0".repeat(64)});
 assert.equal(wrong.outcome,"INCONSISTENT");
 assert.equal(rc8SignedEodPublicationAuthorizationState(wrong).state,"RECONCILIATION_INCONSISTENT_HOLD");
 // Replay of the same signed pair after reconciliation is still denied.
 const replay=await executeRc8PgPendingSignedIntent(args(db),TEST_ONLY_GATE);
 assert.equal(replay.ok,false);assert.equal(db.claims.size,3);assert.equal(db.intents.size,1);
});

test("RC32: durable receipt is not COMMITTED once the four-source report drifted",async()=>{
 const db=fakeDb();
 const r=await executeRc8PgPendingSignedIntent(args(db),TEST_ONLY_GATE);
 assert.equal(r.ok,true,r.reason);
 const rec=()=>reconcileRc8PgSignedIntentOutcome({acquireClient:db.connect,
  intentId:r.intentId,subjectId:SUB,expectedReceiptSha256:r.receiptSha256});
 assert.equal((await rec()).outcome,"COMMITTED");
 for(const drift of [{source_digest:"c".repeat(64)},{published:true},{source_count:3},
  {reviewer_id:OWNER},{staff_id:TL},{staff_id:OWNER},{staff_id:null},{staff_id:"not-a-uuid"},
  {team_id:id(99)},{city_id:id(99)},{state:"OWNER_RELEASED"},null]){
  db.report=drift;
  const x=await rec();
  assert.equal(x.outcome,"INCONSISTENT",JSON.stringify(drift));
  assert.equal(x.requiresIndependentReview,true);
  assert.equal(x.publicationAuthorized,false);
 }
 db.report={};
 assert.equal((await rec()).outcome,"COMMITTED");
});

test("RC34: signer key revoked after COMMIT is not COMMITTED",async()=>{
 const db=fakeDb();
 const r=await executeRc8PgPendingSignedIntent(args(db),TEST_ONLY_GATE);
 assert.equal(r.ok,true,r.reason);
 const rec=()=>reconcileRc8PgSignedIntentOutcome({acquireClient:db.connect,
  intentId:r.intentId,subjectId:SUB,expectedReceiptSha256:r.receiptSha256});
 assert.equal((await rec()).outcome,"COMMITTED");
 for(const key of [owner.entry.keyId,leader.entry.keyId]){
  db.revoked.add(key);
  const x=await rec();
  assert.equal(x.outcome,"INCONSISTENT",key);
  assert.equal(x.requiresIndependentReview,true);
  assert.equal(x.publicationAuthorized,false);
  db.revoked.delete(key);
 }
 assert.equal((await rec()).outcome,"COMMITTED");
});

test("RC27: in-flight writer after lost COMMIT is never reconciled as NOT_COMMITTED",async()=>{
 const db=fakeDb();db.stallCommit=true;
 const r=await executeRc8PgPendingSignedIntent(args(db),TEST_ONLY_GATE);
 assert.equal(r.reason,"COMMIT_OUTCOME_UNKNOWN");
 assert.equal(db.intents.size,0);assert.equal(db.claims.size,0);
 const rec=()=>reconcileRc8PgSignedIntentOutcome({acquireClient:db.connect,
  intentId:r.intentId,subjectId:SUB,expectedReceiptSha256:r.receiptSha256});
 // Pre-RC27 this read "no rows" and returned NOT_COMMITTED (fresh pair OK),
 // then the receipt became durable: a false rollback of consumed nonces.
 const early=await rec();
 assert.equal(early.outcome,"IN_FLIGHT");
 assert.equal(early.reason,"RECONCILIATION_WRITER_IN_FLIGHT");
 assert.equal(early.retryReconciliationLater,true);
 assert.equal(early.retryRequiresFreshSignedPair,undefined);
 assert.equal(early.approved,false);assert.equal(early.publicationAuthorized,false);
 const st=rc8SignedEodPublicationAuthorizationState(early);
 assert.equal(st.state,"COMMIT_OUTCOME_UNKNOWN_RECONCILE_REQUIRED");
 assert.equal(st.publicationAuthorized,false);assert.equal(st.canPublish,false);
 db.landStalledCommit();
 const late=await rec();
 assert.equal(late.outcome,"COMMITTED");assert.equal(late.receiptSha256,r.receiptSha256);
 assert.equal(rc8SignedEodPublicationAuthorizationState(late).publicationAuthorized,false);
 assert.equal(db.locks.size,0);
});

test("RC27: probe failure or malformed probe row is fail-closed, never NOT_COMMITTED",async()=>{
 for(const row of [[],[{writerFinished:"true"}],[{writerFinished:null}]]){
  const db=fakeDb();
  const base=await db.connect();
  const rec=await reconcileRc8PgSignedIntentOutcome({acquireClient:async()=>({
   release:base.release,query:async(sql,v)=>sql.includes("pg_try_advisory")?
    {rows:row,rowCount:row.length}:base.query(sql,v)}),
   intentId:randomUUID(),subjectId:SUB,expectedReceiptSha256:"a".repeat(64)});
  assert.equal(rec.outcome,"IN_FLIGHT");
 }
 const db=fakeDb();const base=await db.connect();
 const rec=await reconcileRc8PgSignedIntentOutcome({acquireClient:async()=>({
  release:base.release,query:async(sql,v)=>{if(sql.includes("pg_try_advisory"))throw Error("down");
   return base.query(sql,v);}}),
  intentId:randomUUID(),subjectId:SUB,expectedReceiptSha256:"a".repeat(64)});
 assert.equal(rec.outcome,null);assert.equal(rec.reason,"RECONCILIATION_UNAVAILABLE");
});

test("reconciliation of a rolled-back intent requires a fresh signed pair",async()=>{
 const db=fakeDb();
 const missing=randomUUID();
 const rec=await reconcileRc8PgSignedIntentOutcome({acquireClient:db.connect,
  intentId:missing,subjectId:SUB,expectedReceiptSha256:"a".repeat(64)});
 assert.equal(rec.outcome,"NOT_COMMITTED");
 assert.equal(rec.retryRequiresFreshSignedPair,true);
 assert.equal(rec.subjectClaimedByOtherIntent,false);
 assert.equal(rc8SignedEodPublicationAuthorizationState(rec).state,
  "NOT_COMMITTED_FRESH_SIGNED_PAIR_REQUIRED");
 // Partial durable state (claims without receipt) is a HOLD, not a rollback.
 db.claims.set("d".repeat(64),{claimKey:"d".repeat(64),claimKind:"OWNER_NONCE",intentId:missing});
 const partial=await reconcileRc8PgSignedIntentOutcome({acquireClient:db.connect,
  intentId:missing,subjectId:SUB,expectedReceiptSha256:"a".repeat(64)});
 assert.equal(partial.outcome,"INCONSISTENT");
 assert.equal(partial.requiresIndependentReview,true);
 for(const bad of [{},{acquireClient:db.connect,intentId:"x",subjectId:SUB,expectedReceiptSha256:"a".repeat(64)},
  {acquireClient:db.connect,intentId:missing,subjectId:SUB,expectedReceiptSha256:"bad"}])
  assert.equal((await reconcileRc8PgSignedIntentOutcome(bad)).reason,"RECONCILIATION_INPUT_INVALID");
});

test("publication state is closed for every outcome and rejects forged results",async()=>{
 const db=fakeDb();
 const ok=await executeRc8PgPendingSignedIntent(args(db),TEST_ONLY_GATE);
 const s=rc8SignedEodPublicationAuthorizationState(ok);
 assert.equal(s.state,"PENDING_RECEIPT_AWAITING_EXTERNAL_REVIEW");
 assert.equal(s.publicationAuthorized,false);assert.equal(s.canPublish,false);
 assert.equal(s.sourceAuthorized,false);assert.equal(s.receiptSha256,ok.receiptSha256);
 assert.ok(s.blockers.includes("RC8_APPROVAL_WRITER_NOT_INSTALLED"));
 const forged=rc8SignedEodPublicationAuthorizationState({...ok});
 assert.equal(forged.state,"UNVERIFIED_OUTCOME_DENIED");
 assert.equal(forged.publicationAuthorized,false);
 const denied=await executeRc8PgPendingSignedIntent(args(fakeDb({revoked:[owner.entry.keyId]})),TEST_ONLY_GATE);
 assert.equal(rc8SignedEodPublicationAuthorizationState(denied).state,"DENIED");
});

test("source order: readback precedes commit guards; PG17 harness covers RC26 cases",()=>{
 const src=read("scripts/mvp/vox/rc8-pg-signed-intent-writer.mjs");
 const begin=src.indexOf("BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE READ WRITE");
 const lock=src.indexOf("IN SHARE MODE");
 const firstSelect=src.indexOf("SELECT p.id FROM public.profiles");
 assert.ok(begin>0&&lock>begin&&firstSelect>lock);
 const receipt=src.indexOf("INTENT_RECEIPT_UNVERIFIED");
 const readback=src.indexOf("DURABLE_RECEIPT_READBACK_MISMATCH");
 const commit=src.indexOf('client.query("COMMIT")');
 assert.ok(receipt>0&&readback>receipt&&commit>readback);
 const recSrc=src.slice(src.indexOf("export async function reconcileRc8PgSignedIntentOutcome"));
 assert.doesNotMatch(recSrc,/client\.query\("COMMIT"\)|INSERT INTO|UPDATE public|DELETE FROM/);
 // RC27: writer holds its intent lock before any claim/receipt write; the
 // reconciler probes it under READ COMMITTED before reading durable rows.
 const intentLock=src.indexOf("client.query(INTENT_LOCK_SQL");
 assert.ok(intentLock>lock&&intentLock<src.indexOf("INSERT INTO \"+P+\"approval_claims"));
 assert.ok(recSrc.includes("READ COMMITTED READ ONLY")&&!recSrc.includes("REPEATABLE READ READ ONLY"));
 assert.ok(recSrc.indexOf("INTENT_LOCK_PROBE_SQL")<recSrc.indexOf("readDurableReceipt(client"));
 const pg=read("scripts/mvp/vox/validate-vox-rc8-real-pg-signed-intent.mjs");
 for(const label of ["EOD_UNKNOWN_RECONCILED_COMMITTED","RECONCILE_ABSENT_NOT_COMMITTED",
  "DIRECT_REVOCATION_INSERT_BLOCKED_DURING_WRITER","SIGNER_KEY_REVOKED_DENIED",
  "RC27_OPEN_WRITER_RECONCILES_IN_FLIGHT","RC27_ENDED_WRITER_RECONCILES_NOT_COMMITTED"])
  assert.ok(pg.includes(label),label);
});
