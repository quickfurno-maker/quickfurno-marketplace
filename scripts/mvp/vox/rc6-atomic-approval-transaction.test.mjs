import test from "node:test";
import assert from "node:assert/strict";
import {createHash,generateKeyPairSync,sign} from "node:crypto";
import {mintRc4VerifiedAuthContext,rc4RegistryFingerprint,rc4ScopeTargetHash}
 from "../../../contracts/vox/rc4ApprovalPipeline.mjs";
import {canonicalAb7kApprovalBytes} from "../../../contracts/vox/ab7kSignedApprovalVerifier.mjs";
import {RC6_APPROVAL_RELEASE_GATE,commitRc6AtomicApprovalProduction,
 simulateRc6AtomicApprovalTransaction} from "./rc6-atomic-approval-transaction.mjs";
const id=n=>"00000000-0000-4000-8000-"+String(n).padStart(12,"0");
const NOW=1_800_000_000_000;
const USER=id(2),TL=id(3),TEAM=id(4),CITY=id(5),SUBJ=id(6);
const TYPE="EOD_OFFICIAL_RELEASE",DIGEST="a".repeat(64);
function signer(keyId,signerId,role){
 const pair=generateKeyPairSync("ed25519");
 const fingerprint=createHash("sha256").update(pair.publicKey.export({type:"spki",format:"der"})).digest("hex");
 return {pair,entry:{keyId,signerId,signerRole:role,publicKeyPem:pair.publicKey.export({type:"spki",format:"pem"}),
  publicKeyFingerprint:fingerprint,notBeforeMs:NOW-60_000,notAfterMs:NOW+3600_000}};
}
const owner=signer("owner-key-01",USER,"OWNER"),leader=signer("team-leader-01",TL,"TEAM_LEADER");
const registry=[owner.entry,leader.entry],fingerprints=[rc4RegistryFingerprint(registry)];
const auth=(userId,fields)=>mintRc4VerifiedAuthContext({userId,sessionId:id(userId===USER?50:51),
 jwtRole:"authenticated",aal:"aal2",aal2AtMs:NOW-1000,sessionExpiresAtMs:NOW+3600_000,
 profileRole:null,profileActive:true,staffRole:null,teamId:null,cityId:null,
 membershipRevokedAtMs:null,membershipExpiresAtMs:null,...fields});
const ownerAuth=auth(USER,{profileRole:"admin"});
const teamLeaderAuth=auth(TL,{staffRole:"team_leader",teamId:TEAM,cityId:CITY,
 membershipExpiresAtMs:NOW+3600_000});
function envelope(s,nonce){
 const payload={domain:"qf.vox.ab7k.signed-approval",version:"v1",type:TYPE,environment:"staging",
  keyId:s.entry.keyId,signerRole:s.entry.signerRole,signerId:s.entry.signerId,
  ownerId:USER,teamLeaderId:TL,subjectId:SUBJ,digest:DIGEST,
  targetHash:rc4ScopeTargetHash({type:TYPE,subjectId:SUBJ,teamId:TEAM,cityId:CITY}),
  nonce:id(nonce),issuedAtMs:NOW-1000,expiresAtMs:NOW+300_000};
 return {payload,signature:sign(null,canonicalAb7kApprovalBytes(payload),s.pair.privateKey).toString("base64url")};
}
const request=()=>({type:TYPE,subjectId:SUBJ,digest:DIGEST,teamId:TEAM,cityId:CITY,
 ownerEnvelope:envelope(owner,7),teamLeaderEnvelope:envelope(leader,8)});
const testGate={verifiedDbWriterInstalled:true,independentHumanKeysEnrolled:true,
 humanDbaAppsecReviewed:true}; // simulation only
function world(opts={}){
 const committed=new Set();
 const log={begun:0,rollback:0,commit:0,writes:0,claims:0};
 const beginTransaction=async()=>{
  log.begun++;const pending=new Set();let staged=null;
  return {
   async recheckCurrentActors(){return !opts.revoked;},
   async readCurrentRevocations(){return opts.revocations??{keyIds:[],signerIds:[]}},
   async claimAll({nonceKeys,subjectKey}){
    log.claims++;
    const keys=[...nonceKeys,subjectKey];
    if(new Set(keys).size!==3||keys.some(x=>committed.has(x)||pending.has(x)))return false;
    keys.forEach(k=>pending.add(k));return true;
   },
   async insertVerifiedIntent(row){
    if(opts.insertThrows)throw new Error("synthetic insert failure");
    log.writes++;staged={...row};
    if(opts.badReceipt)return {bad:true};
    return {...row};
   },
   async commit(){
    if(opts.commitThrows)throw new Error("unknown commit");
    pending.forEach(x=>committed.add(x));log.commit++;
   },
   async rollback(){staged=null;pending.clear();log.rollback++}
  };
 };
 return {log,committed,beginTransaction};
}
const args=(w,other={})=>({request:request(),ownerAuth,teamLeaderAuth,
 registry,beginTransaction:w.beginTransaction,now:NOW,
 approvedRegistryFingerprints:fingerprints,...other});
test("production gate cannot start transaction with injected keys or flags",async()=>{
 const w=world();
 assert.equal(Object.values(RC6_APPROVAL_RELEASE_GATE).every(x=>x===false),true);
 const r=await commitRc6AtomicApprovalProduction(args(w));
 assert.equal(r.reason,"APPROVAL_RELEASE_GATE_HARD_OFF");
 assert.equal(w.log.begun,0);
});
test("real Ed25519 pair + independent AAL2 -> one simulated atomic claim and receipt, never release",async()=>{
 const w=world();
 const r=await simulateRc6AtomicApprovalTransaction(args(w),testGate);
 assert.equal(r.ok,true);assert.equal(r.committed,true);assert.equal(r.approved,false);
 assert.equal(r.canAuthorize,false);assert.equal(r.officialEodEnabled,false);
 assert.equal(w.log.begun,1);assert.equal(w.log.claims,1);
 assert.equal(w.log.writes,1);assert.equal(w.log.commit,1);assert.equal(w.committed.size,3);
});
test("replay claims never create a second source row or partial nonce",async()=>{
 const w=world();
 assert.equal((await simulateRc6AtomicApprovalTransaction(args(w),testGate)).ok,true);
 const second=await simulateRc6AtomicApprovalTransaction(args(w),testGate);
 assert.equal(second.reason,"REPLAY_OR_LEDGER_DENIED");
 assert.equal(w.log.writes,1);assert.equal(w.log.commit,1);assert.equal(w.log.rollback,1);
 assert.equal(w.committed.size,3);
});
test("actor revocation before claim fails closed",async()=>{
 const w=world({revoked:true});
 const r=await simulateRc6AtomicApprovalTransaction(args(w),testGate);
 assert.equal(r.reason,"ACTORS_NOT_CURRENT");assert.equal(w.log.claims,0);
 assert.equal(w.log.rollback,1);
});
test("bad receipt and insert exception roll back both nonces and approval row",async()=>{
 for(const opts of [{badReceipt:true},{insertThrows:true}]){
  const w=world(opts);const r=await simulateRc6AtomicApprovalTransaction(args(w),testGate);
  assert.equal(r.ok,false);assert.equal(r.approved,false);
  assert.equal(w.committed.size,0);assert.equal(w.log.commit,0);
  assert.equal(w.log.rollback,1);
 }
});
test("tampered signature and revoked key never reach ledger claim",async()=>{
 for(const variant of ["sig","revoke"]){
  const w=world(variant==="revoke"?{revocations:{keyIds:["owner-key-01"],signerIds:[]}}:{});
  const req=request();
  if(variant==="sig")req.ownerEnvelope.signature="x";
  const r=await simulateRc6AtomicApprovalTransaction(args(w,{request:req}),testGate);
  assert.equal(r.ok,false);assert.equal(w.log.claims,0);assert.equal(w.committed.size,0);
  assert.equal(w.log.rollback,1);
 }
});
test("commit-unknown response never labels the transaction successful",async()=>{
 const w=world({commitThrows:true});
 const r=await simulateRc6AtomicApprovalTransaction(args(w),testGate);
 assert.equal(r.reason,"COMMIT_STATE_UNKNOWN");assert.equal(r.committed,false);
 assert.equal(w.log.rollback,0);
});
