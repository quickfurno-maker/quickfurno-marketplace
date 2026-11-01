import test from "node:test";import assert from "node:assert/strict";
import {build} from "esbuild";
import {mkdtempSync,rmSync} from "node:fs";import {tmpdir} from "node:os";
import {join,resolve,dirname} from "node:path";import {fileURLToPath,pathToFileURL} from "node:url";
const root=resolve(dirname(fileURLToPath(import.meta.url)),"../../..");
const dir=mkdtempSync(join(tmpdir(),"vox-rc42-core-"));
const outfile=join(dir,"handler.mjs");
await build({entryPoints:[resolve(root,"services/vox/rc42AtomicConversationHandler.ts")],
 outfile,bundle:true,format:"esm",platform:"node",target:"node24",logLevel:"silent",
 plugins:[{name:"server-only",setup(b){b.onResolve({filter:/^server-only$/},
 ()=>({path:"server-only",namespace:"mock"}));b.onLoad({filter:/.*/,namespace:"mock"},
 ()=>({contents:"",loader:"js"}));}}]});
const {createRc42AtomicConversationHandler:create}=await import(pathToFileURL(outfile).href);
const C="11111111-1111-4111-8111-111111111111",N="22222222-2222-4222-8222-222222222222";
const U="33333333-3333-4333-8333-333333333333";
const cmd={conversationId:C,nonce:N,expectedRevision:4,action:"TAKEOVER"};
const actor={userId:U,teamId:U,cityId:U,aal:"aal2",expiresAtMs:2000000};
const receipt={nonce:N,conversation_id:C,action:"TAKEOVER",previous_revision:4,
 new_revision:5,state:"HUMAN",replayed:false,consent_scope:"transactional",
 consent_policy_version:"qf-consent-v1",
 consent_reason:"transactional_no_consent_objection",
 event_id:"44444444-4444-4444-8444-444444444444",
 receipt_sha256:"a".repeat(64),provider_messages_sent:0};
const request=(body=cmd)=>new Request("https://local.test/api/vox/v1/core/conversation-operator",{
 method:"POST",headers:{"authorization":"Bearer test","content-type":"application/json"},
 body:JSON.stringify(body)});
function deps(opts={}){const calls=[];return {calls,...{
 enabled:()=>true,installed:()=>true,now:()=>1000000,
 verify:async()=>actor,rpc:async(fn,args)=>{calls.push({fn,args});return {data:[receipt],error:null};}
 },...opts};}
test("missing reviewed install holds BEFORE any auth or RPC",async()=>{
 let called=0;const d=deps({installed:()=>false,verify:async()=>{called++;return actor;}});
 const r=await create(d)(request());assert.equal(r.status,503);assert.equal(called,0);assert.equal(d.calls.length,0);
});
test("invalid keys, nonce and overlarge commands never reach authentication",async()=>{
 let called=0;const d=deps({verify:async()=>{called++;return actor;}});
 for(const invalid of [{...cmd,actorId:U},{...cmd,nonce:"bad"},{...cmd,expectedRevision:-1},
  {...cmd,action:"SEND_PROVIDER"}]){
  const r=await create(d)(request(invalid));assert.equal(r.status,400);
 }
 assert.equal(called,0);assert.equal(d.calls.length,0);
});
test("AAL1, expired or missing verified Staff never reaches SQL",async()=>{
 for(const a of [null,{...actor,aal:"aal1"},{...actor,expiresAtMs:0}]){
  const d=deps({verify:async()=>a});const r=await create(d)(request());
  assert.equal(r.status,403);assert.equal(d.calls.length,0);
 }
});
test("authoritative Staff principal and consent-bound atomic RPC, zero provider send",async()=>{
 const d=deps(),r=await create(d)(request());
 assert.equal(r.status,200);const b=await r.json();
 assert.equal(b.ok,true);assert.equal(b.providerMessagesSent,0);
 assert.equal(b.newRevision,5);assert.equal(d.calls.length,1);
 assert.equal(d.calls[0].fn,"qf_vox_rc41_core_conversation_operator_atomic_candidate_v1");
 assert.equal(d.calls[0].args.p_actor,U);
 assert.equal(d.calls[0].args.p_conversation,C);
 assert.equal(d.calls[0].args.p_action,"TAKEOVER");
 assert.equal(d.calls[0].args.p_aal,"aal2");
});
test("AAL2 expiry during atomic SQL read does not certify the returned receipt",async()=>{
 let now=1000000;
 const d=deps({now:()=>now,
  rpc:async()=>{now=2000001;return {data:[receipt],error:null};}});
 const res=await create(d)(request());
 assert.equal(res.status,403);
 const body=await res.json();
 assert.equal(body.error,"STAFF_AAL2_EXPIRED_DURING_RPC");
 assert.equal(body.providerMessagesSent,0);
 assert.equal(body.committed,false);
});
test("post-RPC current Staff scope must still match the verified original actor",async()=>{
 for(const stale of [null,{...actor,aal:"aal1"},
  {...actor,userId:C},{...actor,teamId:C},{...actor,cityId:C},
  {...actor,expiresAtMs:0}]){
  let checks=0;
  const d=deps({verify:async()=>++checks===1?actor:stale});
  const r=await create(d)(request());
  assert.equal(r.status,403);assert.equal(d.calls.length,1);
  assert.equal(checks,2);
  assert.equal((await r.json()).error,"STAFF_SCOPE_REVOKED_DURING_RPC");
 }
});
test("post-RPC independent Auth failure never certifies an atomic receipt",async()=>{
 let checks=0;
 const d=deps({verify:async()=>{if(++checks===2)throw Error("auth unavailable");return actor;}});
 const r=await create(d)(request());
 assert.equal(r.status,503);assert.equal(d.calls.length,1);assert.equal(checks,2);
 assert.equal((await r.json()).error,"STAFF_AUTH_RECHECK_UNAVAILABLE");
});
test("timed-out atomic HTTP result is UNKNOWN, never false rollback or new-nonce permission",async()=>{
 const d=deps({rpcTimeoutMs:30,rpc:async()=>new Promise(()=>{})});
 const r=await create(d)(request());
 assert.equal(r.status,504);
 const out=await r.json();
 assert.equal(out.ok,false);assert.equal(out.committed,null);
 assert.equal(out.commitState,"unknown");
 assert.equal(out.retrySameNonceOnly,true);
 assert.equal(out.providerMessagesSent,0);
 assert.equal(out.error,"ATOMIC_RPC_OUTCOME_UNKNOWN");
});
test("wrong nonce, revision, missing receipt or provider messages never certify",async()=>{
 for(const altered of [{...receipt,nonce:U},{...receipt,new_revision:7},
  {...receipt,provider_messages_sent:1},{...receipt,receipt_sha256:"b"},
  {...receipt,state:"PUBLISHED"},
  {...receipt,event_id:"forged"},
  {...receipt,consent_policy_version:"unknown"},
  {...receipt,consent_reason:"unapproved_scope"}
 ]){
  const d=deps({rpc:async()=>({data:[altered],error:null})});
  assert.equal((await create(d)(request())).status,503);
 }
 const d=deps({rpc:async()=>({data:[],error:null})});
 assert.equal((await create(d)(request())).status,503);
});
test("RPC transport failure remains unavailable; no fallback",async()=>{
 const d=deps({rpc:async()=>{throw Error("unavailable");}});
 const r=await create(d)(request());assert.equal(r.status,503);
 const b=await r.json();assert.equal(b.committed,false);assert.equal(b.providerMessagesSent,0);
});
process.on("exit",()=>rmSync(dir,{recursive:true,force:true}));
