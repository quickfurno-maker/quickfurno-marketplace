import test from "node:test";import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";import {dirname,resolve} from "node:path";
import {RC4_CONVERSATION_GATE,RC4_DENY_REASONS,RC4_DECISION_TTL_MS,canonicalJson,
 decisionDigest,prepareConversationDecision,commitConversationDecision,
 commitConversationDecisionProduction} from "../../../contracts/vox/rc4ConversationAuthorization.mjs";
// Executable in-memory model tests (node --test). Fakes model a transactional store with
// snapshot/rollback; they are NOT PG17 and prove contract logic only, not SQL behaviour.
const root=resolve(dirname(fileURLToPath(import.meta.url)),"../../..");
const U=n=>`00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const CONV=U(1),USER=U(2),TEAM=U(3),CITY=U(4),SUBJ=U(5),NONCE=U(6),EV1=U(7),EV2=U(8);
const HASH="a".repeat(64);
const OPEN={bindingSignedOff:true,consentWritersSerialized:true}; // test-only gate
const req=(o={})=>({action:"PAUSE_AI",conversationId:CONV,nonce:NONCE,revision:3,...o});

/** In-memory store. Committed state changes only on commit; rollback restores the snapshot. */
function world(over={}){
 const db={
  staff:{userId:USER,teamId:TEAM,cityId:CITY,active:true,revoked:false,profileRole:null,
   teamActive:true,expiresAtMs:Date.now()+3600e3,aal:"aal2",staffRole:"operations_manager",
   departments:["client_success"],conversationGrantIds:[CONV],...over.staff},
  conv:{id:CONV,tenantId:"quickfurno",channel:"whatsapp",destinationHash:HASH,subjectType:"client",
   subjectId:SUBJ,subjectTeamId:TEAM,subjectCityId:CITY,state:"OPEN",revision:3,...over.conv},
  fence:{eventCount:1,latestEventId:EV1,policyVersion:"v1"},
  nonces:new Set(),rows:[],lockedBy:null};
 const log={send:0,consent:[],begun:0,commits:0,rollbacks:0,order:[]};
 const consentWriter=()=>{ // models a D2-D style consent event append
  if(db.lockedBy)return "blocked";
  db.fence={eventCount:db.fence.eventCount+1,latestEventId:EV2,policyVersion:"v1"};return "applied";};
 const phase1={
  loadCurrentStaff:async()=>db.staff,
  loadCoreConversation:async()=>db.conv,
  authorizeConsent:async i=>{log.consent.push(i);
   if(over.consentThrows)throw new Error("db");
   return Object.hasOwn(over,"consent")?over.consent:{kind:"allow",scope:"transactional"};},
  readConsentFence:async()=>Object.hasOwn(over,"fence")?over.fence:{...db.fence},
  sendProviderMessage:()=>{log.send++;}};
 const begin=async()=>{
  log.begun++;
  const snap=structuredClone({fence:db.fence,nonces:[...db.nonces],rows:db.rows});
  let done=false;
  const tx={
   lockConsentDestination:async()=>{log.order.push("consent");if(!over.noSerialize)db.lockedBy="tx";},
   lockConversationForUpdate:async()=>{log.order.push("conv");return Object.hasOwn(over,"lockedConv")?over.lockedConv:db.conv;},
   lockStaffForUpdate:async()=>{log.order.push("staff");return Object.hasOwn(over,"lockedStaff")?over.lockedStaff:db.staff;},
   readConsentFence:async()=>{const f={...db.fence};over.afterFenceRead?.(consentWriter);return f;},
   authorizeConsentUnderLock:async()=>{
    if(over.txConsentThrows)throw new Error("consent authority unavailable");
    return Object.hasOwn(over,"txConsent")?over.txConsent:{kind:"allow",scope:"transactional"};
   },
   consumeNonce:async n=>{if(db.nonces.has(n))return false;db.nonces.add(n);return true;},
   insertSourceRow:async r=>{if(over.insertThrows)throw new Error("x");db.rows.push(r);},
   commit:async()=>{if(over.commitThrows)throw new Error("net");done=true;db.lockedBy=null;log.commits++;},
   rollback:async()=>{if(done)return;done=true;log.rollbacks++;
    db.fence=snap.fence;db.nonces=new Set(snap.nonces);db.rows=snap.rows;db.lockedBy=null;}};
  return tx;};
 return {db,log,phase1,begin,consentWriter};
}
const decide=async(over,r=req())=>{const w=world(over);
 const p=await prepareConversationDecision(r,w.phase1);return {w,p};};
const commit=async(over={},gate=OPEN)=>{const {w,p}=await decide(over);
 assert.equal(p.ok,true,p.reason);
 return {w,p,r:await commitConversationDecision(p.decision,w.begin,gate)};};

test("production gate is frozen closed and production commit never opens a transaction",async()=>{
 assert.equal(Object.isFrozen(RC4_CONVERSATION_GATE),true);
 assert.deepEqual({...RC4_CONVERSATION_GATE},{bindingSignedOff:false,consentWritersSerialized:false});
 const {w,p}=await decide({});
 const r=await commitConversationDecisionProduction(p.decision,w.begin);
 assert.equal(r.reason,"GATE_CLOSED");assert.equal(w.log.begun,0);assert.equal(w.db.rows.length,0);
 for(const g of [{bindingSignedOff:true,consentWritersSerialized:false},
  {bindingSignedOff:false,consentWritersSerialized:true},{bindingSignedOff:"true",consentWritersSerialized:true},
  null,undefined,{}])
  assert.equal((await commitConversationDecision(p.decision,w.begin,g)).reason,"GATE_CLOSED");
 assert.equal(w.log.begun,0);
});
test("happy path under a test-only open gate: ordered locks, one row, one commit, no send",async()=>{
 const {w,r,p}=await commit();
 assert.equal(r.ok,true);assert.equal(r.committed,true);assert.equal(r.providerMessagesSent,0);
 assert.deepEqual(w.log.order,["consent","conv","staff"]);
 assert.equal(w.db.rows.length,1);assert.equal(w.log.commits,1);assert.equal(w.log.rollbacks,0);
 assert.equal(w.db.rows[0].decisionDigest,p.decision.digest);assert.equal(w.log.send,0);
 // decision is bound to destination, channel, scope, subject, version fence and actor
 const b=p.decision.body;
 assert.deepEqual([b.destinationHash,b.channel,b.scope,b.subjectType,b.subjectId],
  [HASH,"whatsapp","transactional","client",SUBJ]);
 assert.equal(b.consentFence.policyVersion,"v1");assert.equal(b.actor.aal,"aal2");
 assert.deepEqual(w.log.consent,[{destinationHash:HASH,subjectType:"client",subjectId:SUBJ}]);
});
test("phase 1 rejects self-asserted consent, actor, hash, team and unknown actions",async()=>{
 for(const extra of [{consent:true},{optIn:true},{destinationHash:HASH},{teamId:TEAM},{actorId:USER},
  {channel:"whatsapp"},{scope:"marketing"}])
  assert.equal((await decide({},req(extra))).p.reason,"REQUEST_SHAPE_INVALID",Object.keys(extra)[0]);
 for(const bad of [{action:"RESUME"},{action:"SEND"},{action:undefined},{revision:0},{nonce:"x"}])
  assert.equal((await decide({},req(bad))).p.reason,"REQUEST_SHAPE_INVALID",JSON.stringify(bad));
 assert.equal((await decide({},null)).p.reason,"REQUEST_SHAPE_INVALID");
});
test("consent: anything but exactly allow/transactional denies; fence must be well formed",async()=>{
 for(const consent of [{kind:"deny",code:"CONSENT_SUPPRESSED",retryable:false},{kind:"invalid"},
  {kind:"allow"},{kind:"allow",scope:"marketing"},{kind:"allow",scope:"transactional",extra:1},
  null,undefined,"allow",true])
  assert.equal((await decide({consent})).p.reason,"CONSENT_NOT_ALLOWED",JSON.stringify(consent));
 assert.equal((await decide({consent:{kind:"unavailable"}})).p.reason,"CONSENT_AUTHORITY_UNAVAILABLE");
 assert.equal((await decide({consentThrows:true})).p.reason,"CONSENT_AUTHORITY_UNAVAILABLE");
 for(const fence of [null,{},{eventCount:1,latestEventId:null,policyVersion:"v1"},
  {eventCount:0,latestEventId:EV1,policyVersion:null},{eventCount:-1,latestEventId:null,policyVersion:null},
  {eventCount:1,latestEventId:EV1,policyVersion:"bad version"},
  {eventCount:1,latestEventId:EV1,policyVersion:"v1",allowed:true}])
  assert.equal((await decide({fence})).p.reason,"CONSENT_FENCE_INVALID",JSON.stringify(fence));
});
test("actor boundary: role/department/AAL/revoked/expired/team/city/grant all deny in phase 1",async()=>{
 const cases=[[{staff:{staffRole:"support_agent"}},"STAFF_ROLE_OR_DEPARTMENT_MISMATCH"],
  [{staff:{departments:["service_support"]}},"STAFF_ROLE_OR_DEPARTMENT_MISMATCH"],
  [{staff:{aal:"aal1"}},"STAFF_AAL2_REQUIRED"],[{staff:{profileRole:"admin"}},"STAFF_NOT_CURRENT"],
  [{staff:{revoked:true}},"STAFF_NOT_CURRENT"],[{staff:{active:false}},"STAFF_NOT_CURRENT"],
  [{staff:{teamActive:false}},"STAFF_NOT_CURRENT"],[{staff:{expiresAtMs:Date.now()-1}},"STAFF_NOT_CURRENT"],
  [{staff:{conversationGrantIds:[U(99)]}},"OBJECT_GRANT_MISSING"],
  [{staff:{teamId:U(79)}},"TEAM_OR_CITY_MISMATCH"],[{conv:{subjectCityId:U(78)}},"TEAM_OR_CITY_MISMATCH"],
  [{conv:{channel:"sms"}},"CHANNEL_UNSUPPORTED"],[{conv:{state:"HUMAN"}},"CONVERSATION_STALE_OR_INELIGIBLE"],
  [{conv:{revision:4}},"CONVERSATION_STALE_OR_INELIGIBLE"],[{conv:{id:U(55)}},"CONVERSATION_NOT_FOUND_OR_FORGED"]];
 for(const [o,reason] of cases){const {w,p}=await decide(o);
  assert.equal(p.reason,reason,JSON.stringify(o));assert.equal(w.log.begun,0);}
});
test("RC5: fresh transaction-locked canonical consent denial never consumes a nonce",async()=>{
 for(const txConsent of [{kind:"deny"}, {kind:"allow",scope:"marketing"},
   {kind:"allow",scope:"transactional",source:"request"}, null, undefined]){
  const {w,p}=await decide({txConsent});
  const r=await commitConversationDecision(p.decision,w.begin,OPEN);
  assert.equal(r.reason,"CONSENT_NOT_ALLOWED");
  assert.equal(w.db.nonces.size,0);assert.equal(w.db.rows.length,0);
  assert.equal(w.log.commits,0);assert.equal(w.log.rollbacks,1);
 }
 const {w,p}=await decide({txConsentThrows:true});
 const r=await commitConversationDecision(p.decision,w.begin,OPEN);
 assert.equal(r.reason,"TX_FAILED_ROLLED_BACK");
 assert.equal(w.db.nonces.size,0);assert.equal(w.db.rows.length,0);
});
test("TOCTOU 1: consent event between phase 1 and the transaction denies and rolls back",async()=>{
 const {w,p}=await decide({});
 w.consentWriter(); // suppression/withdrawal arrives after the decision was minted
 const r=await commitConversationDecision(p.decision,w.begin,OPEN);
 assert.equal(r.reason,"CONSENT_CHANGED_AFTER_DECISION");
 assert.equal(w.db.rows.length,0);assert.equal(w.db.nonces.size,0);
 assert.equal(w.log.commits,0);assert.equal(w.log.rollbacks,1);
});
test("TOCTOU 2: with destination lock a consent writer racing the tx is blocked until after commit",async()=>{
 let writerResult;
 const {w,r}=await commit({afterFenceRead:wr=>{writerResult=wr();}});
 assert.equal(r.ok,true);assert.equal(writerResult,"blocked");
 assert.equal(w.db.fence.eventCount,1); // writer did not slip in before commit
 assert.equal(w.consentWriter(),"applied"); // and may proceed only afterwards
});
test("TOCTOU 3 (documented residual): without writer-side serialization the race is real, hence the gate",async()=>{
 let writerResult;
 const {w,r}=await commit({noSerialize:true,afterFenceRead:wr=>{writerResult=wr();}});
 // A consent event landed after the in-tx fence read, yet the tx committed.
 assert.equal(writerResult,"applied");assert.equal(r.committed,true);assert.equal(w.db.fence.eventCount,2);
 // Therefore the only safe production state is the closed gate; this test pins that dependency.
 assert.equal(RC4_CONVERSATION_GATE.consentWritersSerialized,false);
});
test("actor or conversation changed between phase 1 and tx: deny, nothing persists",async()=>{
 const cases=[[{lockedStaff:{userId:USER,teamId:U(60),cityId:CITY,staffRole:"operations_manager"}},"DECISION_ACTOR_MISMATCH"],
  [{lockedStaff:null},"DECISION_ACTOR_MISMATCH"],
  [{lockedStaff:{...world().db.staff,revoked:true}},"STAFF_NOT_CURRENT"],
  [{lockedStaff:{...world().db.staff,aal:"aal1"}},"STAFF_AAL2_REQUIRED"],
  [{lockedStaff:{...world().db.staff,conversationGrantIds:[]}},"OBJECT_GRANT_MISSING"],
  [{lockedStaff:{...world().db.staff,expiresAtMs:Date.now()-1}},"STAFF_NOT_CURRENT"],
  [{lockedConv:{...world().db.conv,revision:4}},"CORE_CHANGED_AFTER_DECISION"],
  [{lockedConv:{...world().db.conv,destinationHash:"b".repeat(64)}},"CORE_CHANGED_AFTER_DECISION"],
  [{lockedConv:{...world().db.conv,subjectId:U(90)}},"CORE_CHANGED_AFTER_DECISION"],
  [{lockedConv:{...world().db.conv,state:"HUMAN"}},"CONVERSATION_STALE_OR_INELIGIBLE"],
  [{lockedConv:{...world().db.conv,subjectTeamId:U(61)}},"TEAM_OR_CITY_MISMATCH"],
  [{lockedConv:null},"CONVERSATION_NOT_FOUND_OR_FORGED"]];
 for(const [o,reason] of cases){
  const w=world(o);const p=await prepareConversationDecision(req(),{...w.phase1,
   loadCurrentStaff:async()=>world().db.staff,loadCoreConversation:async()=>world().db.conv});
  assert.equal(p.ok,true,reason);
  const r=await commitConversationDecision(p.decision,w.begin,OPEN);
  assert.equal(r.reason,reason);assert.equal(w.db.rows.length,0);assert.equal(w.db.nonces.size,0);
  assert.equal(w.log.commits,0);assert.equal(w.log.rollbacks,1);}
});
test("replay: second commit of the same decision denies, one row total",async()=>{
 const {w,p}=await commit();
 const again=await commitConversationDecision(p.decision,w.begin,OPEN);
 assert.equal(again.reason,"NONCE_REPLAY");assert.equal(w.db.rows.length,1);assert.equal(w.log.commits,1);
 // a fresh decision reusing the same nonce is also rejected
 const p2=await prepareConversationDecision(req(),w.phase1);
 assert.equal((await commitConversationDecision(p2.decision,w.begin,OPEN)).reason,"NONCE_REPLAY");
 assert.equal(w.db.rows.length,1);
});
test("forged, cloned, mutated or expired decisions are rejected before any tx",async()=>{
 const {w,p}=await decide({});
 const d=p.decision;
 const clone=JSON.parse(JSON.stringify(d));
 assert.equal((await commitConversationDecision(clone,w.begin,OPEN)).reason,"DECISION_FORGED");
 const selfMinted={body:{...d.body,actor:{...d.body.actor,userId:U(42)}}};
 selfMinted.digest=decisionDigest(selfMinted.body);
 assert.equal((await commitConversationDecision(selfMinted,w.begin,OPEN)).reason,"DECISION_FORGED");
 for(const v of [null,undefined,{},"x",{ok:true},{body:d.body,digest:"0".repeat(64)}])
  assert.equal((await commitConversationDecision(v,w.begin,OPEN)).reason,"DECISION_FORGED");
 assert.throws(()=>{"use strict";d.body.actor.userId=U(43);});
 assert.throws(()=>{"use strict";d.body.consentFence.eventCount=0;});
 const late=await commitConversationDecision(d,w.begin,OPEN,undefined,
  ()=>d.body.issuedAtMs+RC4_DECISION_TTL_MS);
 assert.equal(late.reason,"DECISION_EXPIRED");assert.equal(w.log.begun,0);
});
test("malformed transaction adapter attempts rollback before reporting invalid interface",async()=>{
 const {p}=await decide({});
 let rolledBack=0,claimed=0;
 const incomplete={rollback:async()=>{rolledBack++},commit:async()=>{claimed++}};
 const r=await commitConversationDecision(p.decision,async()=>incomplete,OPEN);
 assert.equal(r.reason,"TX_INTERFACE_INVALID");
 assert.equal(rolledBack,1);
 assert.equal(claimed,0);
 const withoutRollback=await commitConversationDecision(p.decision,async()=>({}),OPEN);
 assert.equal(withoutRollback.reason,"TX_INTERFACE_INVALID");
});
test("the D2-D consent RPC already serializes on the matching destination key",()=>{
 const sql=readFileSync(resolve(root,"supabase/migrations/20260712000300_communication_consent_command_writer_rpc.sql"),"utf8");
 assert.match(sql,/pg_advisory_xact_lock\(hashtextextended\('dst\|'\s*\|\|\s*p_destination_hash\s*\|\|\s*'\|'\s*\|\|\s*p_channel,\s*0\)\)/);
 // This is only a D2-D source proof. Other suppression/preference mutation
 // writers and the future VOX SQL transaction still need end-to-end verification.
 assert.equal(RC4_CONVERSATION_GATE.consentWritersSerialized,false);
});
test("failure paths roll back exactly once: insert throws, commit throws, bad tx interface",async()=>{
 let {w,p}=await decide({insertThrows:true});
 let r=await commitConversationDecision(p.decision,w.begin,OPEN);
 assert.equal(r.reason,"TX_FAILED_ROLLED_BACK");assert.equal(w.log.rollbacks,1);
 assert.equal(w.db.nonces.size,0);assert.equal(w.db.rows.length,0);
 ({w,p}=await decide({commitThrows:true}));
 r=await commitConversationDecision(p.decision,w.begin,OPEN);
 assert.equal(r.reason,"COMMIT_STATE_UNKNOWN");assert.equal(r.committed,false);
 assert.equal(w.log.rollbacks,0); // after a failed commit we never pretend to roll back
 ({w,p}=await decide({}));
 assert.equal((await commitConversationDecision(p.decision,async()=>({}),OPEN)).reason,"TX_INTERFACE_INVALID");
 assert.equal((await commitConversationDecision(p.decision,async()=>{throw new Error("x");},OPEN)).reason,"TX_FAILED_ROLLED_BACK");
 assert.equal((await commitConversationDecision(p.decision,null,OPEN)).reason,"TX_INTERFACE_INVALID");
});
test("every deny is closed-set and never sends or commits",async()=>{
 const rs=[(await decide({consent:null})).p,(await decide({staff:{aal:"x"}})).p];
 const {w,p}=await decide({});w.consentWriter();
 rs.push(await commitConversationDecision(p.decision,w.begin,OPEN),
  await commitConversationDecisionProduction(p.decision,w.begin));
 for(const x of rs){assert.equal(x.ok,false);assert.ok(RC4_DENY_REASONS.includes(x.reason),x.reason);
  assert.equal(x.committed,false);assert.equal(x.providerMessagesSent,0);}
});
test("canonicalJson is key-order independent and rejects non-finite values",()=>{
 assert.equal(canonicalJson({b:1,a:[2,{d:1,c:2}]}),canonicalJson({a:[2,{c:2,d:1}],b:1}));
 assert.throws(()=>canonicalJson({a:NaN}));
 assert.notEqual(decisionDigest({a:1}),decisionDigest({a:2}));
});
test("module is source-only: no network/env/db/provider code, imports only node:crypto and ab7k binding",()=>{
 const src=readFileSync(resolve(root,"contracts/vox/rc4ConversationAuthorization.mjs"),"utf8");
 const code=src.replace(/\/\*[\s\S]*?\*\//g,"").replace(/\/\/[^\n]*/g,"");
 for(const bad of [/\bfetch\b/,/supabase/i,/process\.env/,/communication_suppressions/,
  /communication_preferences/,/communication_consent_events/,/\.send\(/,/sendProviderMessage/,/require\(/])
  assert.equal(bad.test(code),false,String(bad));
 const imports=[...code.matchAll(/^import .* from "([^"]+)"/gm)].map(m=>m[1]).sort();
 assert.deepEqual(imports,["./ab7kCoreConversationConsentBinding.mjs","node:crypto"]);
});
test("the SQL block is untouched and the track adds no SQL",()=>{
 const sql=readFileSync(resolve(root,"ops/vox/sql-candidates/20261018020000_vox_ab7b_nonwork_native_source_candidate.sql"),"utf8");
 assert.match(sql.replace(/--[^\n]*/g,""),/constraint vox_ab7b_core_conversation_blocked check\(source<>'CORE_CONVERSATION'\)/);
});
