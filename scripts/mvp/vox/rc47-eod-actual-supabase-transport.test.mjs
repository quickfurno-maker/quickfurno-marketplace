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
globalThis.fetch=async(url,options={})=>{
 const headers=new Headers(options.headers);
 calls.push({url:String(url),headers,method:options.method,body:options.body});
 return new Response(JSON.stringify({state:"PENDING_RECEIPT_AWAITING_EXTERNAL_REVIEW"}),{
  status:200,headers:{"content-type":"application/json"}});
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
});
test("transport never offers another RPC function or direct privileged table API",async()=>{
 calls.length=0;
 const rpc=create({url:"https://db.local.test",anonKey:"anon-only",bearer:"reader"});
 const result=await rpc("other_function",{p_intent_id:U,p_subject_id:V});
 assert.equal(result.data,null);
 assert.equal(result.error.message,"EOD_REVIEW_FUNCTION_DENIED");
 assert.equal(calls.length,0);
});
process.on("exit",()=>{
 globalThis.fetch=oldFetch;
 rmSync(tmp,{recursive:true,force:true});
});
