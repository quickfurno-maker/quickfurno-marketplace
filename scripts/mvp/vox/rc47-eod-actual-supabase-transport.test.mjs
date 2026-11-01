import test from "node:test";
import assert from "node:assert/strict";
import {build} from "esbuild";
import {mkdtempSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {resolve,join,dirname} from "node:path";
import {fileURLToPath,pathToFileURL} from "node:url";
// Actual installed @supabase/supabase-js network stack, mock only the wire.
// No real provider, managed project, bearer secrets, or database connection.
const root=resolve(dirname(fileURLToPath(import.meta.url)),"../../..");
// Supabase's realtime client checks for WebSocket at construction on Node 20.
// This is an HTTP-only reader: provide a TEST-ONLY forbidden transport so CI
// can exercise the real HTTP path without ever opening a realtime socket.
const originalWebSocket=globalThis.WebSocket;
let realtimeAttempts=0;
globalThis.WebSocket=class ForbiddenRealtimeSocket {
 constructor(){realtimeAttempts++;throw Error("RC47_REALTIME_CONNECTION_FORBIDDEN");}
};
const tmp=mkdtempSync(join(tmpdir(),"rc47-eod-transport-"));
await build({entryPoints:[resolve(root,"lib/supabase.ts")],
 outfile:join(tmp,"transport.mjs"),bundle:true,platform:"node",format:"esm",
 target:"node24",logLevel:"silent",plugins:[{
 name:"no-server-ssr",setup(b){
  b.onResolve({filter:/^@supabase\/ssr$/},()=>({path:"ssr",namespace:"stub"}));
  b.onResolve({filter:/^next\/headers$/},()=>({path:"headers",namespace:"stub"}));
  b.onLoad({filter:/.*/,namespace:"stub"},()=>({contents:
   "export const createServerClient=()=>{throw Error('not allowed');};export const cookies=()=>{throw Error('not allowed');};",loader:"js"}));
 }}]});
const {createVoxEodSnapshotReaderTransport:create}=await import(pathToFileURL(join(tmp,"transport.mjs")).href);
const F="qf_vox_rc41_signed_eod_review_snapshot_v1";
const U="11111111-1111-4111-8111-111111111111";
const V="22222222-2222-4222-8222-222222222222";
const oldFetch=globalThis.fetch;
const calls=[];
let wireStatus=200;
let wireHang=false;
globalThis.fetch=async(url,options={})=>{
 const headers=new Headers(options.headers);
 calls.push({url:String(url),headers,method:options.method,body:options.body,
  signal:options.signal});
 if(wireHang)return new Promise((resolve,reject)=>{
  const signal=options.signal;
  if(!signal)return reject(Error("EOD_MISSING_ABORT_SIGNAL"));
  if(signal.aborted)return reject(signal.reason);
  signal.addEventListener("abort",()=>reject(signal.reason),{once:true});
 });
 return new Response(wireStatus===200?
  JSON.stringify({state:"PENDING_RECEIPT_AWAITING_EXTERNAL_REVIEW"}):
  JSON.stringify({code:"PGRST301",message:"JWT invalid"}),{
  status:wireStatus,headers:{"content-type":"application/json"}});
};
test("real supabase-js sends dedicated Authorization bearer, NOT the anon fallback bearer",async()=>{
 calls.length=0;
 const rpc=create({url:"https://db.local.test",anonKey:"anon-test-public-only",bearer:"dedicated-reader-test"});
 const result=await rpc(F,{p_intent_id:U,p_subject_id:V});
 assert.equal(result.error,null);assert.equal(calls.length,1);
 const request=calls[0];
 assert.equal(request.method,"POST");
 assert.equal(request.url,"https://db.local.test/rest/v1/rpc/"+F);
 assert.equal(request.headers.get("authorization"),"Bearer dedicated-reader-test");
 assert.equal(request.headers.get("apikey"),"anon-test-public-only");
 assert.doesNotMatch(JSON.stringify(result),/service_role|access_token/);
 assert.deepEqual(JSON.parse(request.body),{p_intent_id:U,p_subject_id:V});
 assert.equal(request.signal instanceof AbortSignal,true);
 assert.equal(realtimeAttempts,0);
});
test("missing or unsafe EOD reviewer bearer never sends network traffic",async()=>{
 for(const bearer of ["","  ","anon-public","broken\r\nheader","contains space"]){
  calls.length=0;
  const rpc=create({url:"https://db.local.test",anonKey:"anon-public",bearer});
  const result=await rpc(F,{p_intent_id:U,p_subject_id:V});
  assert.equal(result.data,null);
  assert.equal(result.error.message,"EOD_REVIEW_BEARER_INVALID");
  assert.equal(calls.length,0);
 }
});
test("malformed intent or subject IDs never issue a reviewed EOD request",async()=>{
 calls.length=0;
 const rpc=create({url:"https://db.local.test",anonKey:"anon-key",bearer:"dedicated-reader-test"});
 for(const args of [null,{},
  {p_intent_id:"bad",p_subject_id:V},
  {p_intent_id:U,p_subject_id:"not-uuid"},
  {p_intent_id:U,p_subject_id:""}]){
  const result=await rpc(F,args);
  assert.equal(result.data,null);
  assert.equal(result.error.message,"EOD_REVIEW_ARGUMENTS_INVALID");
 }
 assert.equal(calls.length,0);
 assert.equal(realtimeAttempts,0);
});
test("transport never offers another RPC function or direct privileged table API",async()=>{
 calls.length=0;
 const rpc=create({url:"https://db.local.test",anonKey:"anon-only",bearer:"reader"});
 const result=await rpc("other_function",{p_intent_id:U,p_subject_id:V});
 assert.equal(result.data,null);
 assert.equal(result.error.message,"EOD_REVIEW_FUNCTION_DENIED");
 assert.equal(calls.length,0);
 assert.equal(realtimeAttempts,0);
});
test("real PostgREST denied reader JWT never claims data or retries with privileged credentials",async()=>{
 calls.length=0;wireStatus=403;
 try{
  const rpc=create({url:"https://db.local.test",anonKey:"anon-key",bearer:"rejected-dedicated-reader"});
  const result=await rpc(F,{p_intent_id:U,p_subject_id:V});
  assert.equal(result.data,null);
  assert.notEqual(result.error,null);
  assert.equal(calls.length,1);
  assert.equal(calls[0].headers.get("authorization"),"Bearer rejected-dedicated-reader");
  assert.equal(calls[0].headers.get("apikey"),"anon-key");
  assert.doesNotMatch(JSON.stringify(result),/rejected-dedicated-reader|service_role/);
  assert.equal(realtimeAttempts,0);
 }finally{wireStatus=200;}
});
test("rate-limited or unavailable EOD reader never retries or exposes privileged data",async()=>{
 for(const status of [429,503]){
  calls.length=0;wireStatus=status;
  try{
   const rpc=create({url:"https://db.local.test",anonKey:"anon-key",bearer:"dedicated-reader-test"});
   const result=await rpc(F,{p_intent_id:U,p_subject_id:V});
   assert.equal(result.data,null);assert.notEqual(result.error,null);
   assert.equal(calls.length,1);
   assert.equal(calls[0].headers.get("authorization"),"Bearer dedicated-reader-test");
   assert.equal(realtimeAttempts,0);
  }finally{wireStatus=200;}
 }
});
test("real EOD PostgREST HTTP request aborts at bounded timeout without fallback",async()=>{
 calls.length=0;wireHang=true;
 // Node 20's AbortSignal.timeout() owns an unref'ed timer. Standalone mock
 // fetch has no socket to keep the event loop alive, so retain a TEST-ONLY
 // timer until the real SDK's AbortSignal fires. Production stays unchanged.
 const keepAlive=setTimeout(()=>{},6000);
 try{
  const rpc=create({url:"https://db.local.test",anonKey:"anon-only",bearer:"dedicated-reader-test"});
  const started=Date.now();
  const result=await rpc(F,{p_intent_id:U,p_subject_id:V});
  assert.notEqual(result.error,null);
  assert.equal(result.data,null);
  assert.equal(calls.length,1);
  assert.ok(Date.now()-started<8000,"request must terminate within a bounded window");
  assert.equal(calls[0].headers.get("authorization"),"Bearer dedicated-reader-test");
  assert.equal(realtimeAttempts,0);
 }finally{wireHang=false;clearTimeout(keepAlive);}
});
process.on("exit",()=>{
 globalThis.fetch=oldFetch;
 globalThis.WebSocket=originalWebSocket;
 rmSync(tmp,{recursive:true,force:true});
});
