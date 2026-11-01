import test from "node:test";
import assert from "node:assert/strict";
import {build} from "esbuild";
import {mkdtempSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {dirname,resolve,join} from "node:path";
import {fileURLToPath,pathToFileURL} from "node:url";
const root=resolve(dirname(fileURLToPath(import.meta.url)),"../../..");
const tmp=mkdtempSync(join(tmpdir(),"rc44-eod-reader-")),out=join(tmp,"reader.mjs");
await build({entryPoints:[resolve(root,"services/vox/rc44DedicatedEodReviewReader.ts")],
 outfile:out,bundle:true,platform:"node",format:"esm",target:"node24",logLevel:"silent",
 plugins:[{name:"reader-transport",setup(b){
  b.onResolve({filter:/^server-only$/},()=>({path:"server-only",namespace:"test"}));
  b.onResolve({filter:/^@supabase\/supabase-js$/},()=>({path:"supabase",namespace:"test"}));
  b.onResolve({filter:/^@supabase\/ssr$/},()=>({path:"ssr",namespace:"test"}));
  b.onLoad({filter:/.*/,namespace:"test"},a=>({loader:"js",contents:a.path==="supabase"?
   "export const createClient=(u,k,o)=>{globalThis.__rc44Create.push({u,k,o});return {rpc:(fn,args)=>globalThis.__rc44Rpc(fn,args)};}":""}));
 }}]});
const {createRc44DedicatedEodReviewReader:create}=await import(pathToFileURL(out).href);
const U="11111111-1111-4111-8111-111111111111",V="22222222-2222-4222-8222-222222222222";
const issuer=(payload)=>"a."+Buffer.from(JSON.stringify(payload)).toString("base64url")+".b";
const config=(payload)=>({supabaseUrl:"https://db.local.test",anonKey:"public-anon",
 readerJwt:issuer(payload),nowSeconds:Math.floor(Date.now()/1000)});
const good={role:"vox_rc41_eod_review_reader",exp:Math.floor(Date.now()/1000)+1800};
globalThis.__rc44Create=[];
globalThis.__rc44Rpc=async()=>({data:{proof:"sample"},error:null});
test("missing key, forged roles, service_role, expired or overlong tokens cannot construct a reader",()=>{
 for(const v of [
  {},{...good,role:"service_role"},{...good,role:"authenticated"},
  {...good,exp:999},{...good,exp:90000},{...good,aal:"aal2"},
  {...good,nbf:Math.floor(Date.now()/1000)+90},
  {...good,iat:Math.floor(Date.now()/1000)+300},
  {...good,nbf:"fake"},{...good,iat:"future"}]){
  const args=v.role?config(v):{supabaseUrl:"https://db.local.test",anonKey:"public-anon",readerJwt:null};
  assert.equal(create(args),null);
 }
 assert.equal(globalThis.__rc44Create.length,0);
});
test("dedicated PostgREST bearer never uses privileged service role key",async()=>{
 globalThis.__rc44Create.length=0;
 const fn=create(config(good));
 assert.equal(typeof fn,"function");
 assert.equal(globalThis.__rc44Create.length,1);
 const c=globalThis.__rc44Create[0];
 assert.equal(c.k,"public-anon");
 assert.match(c.o.global.headers.Authorization,/^Bearer /);
 const result=await fn("qf_vox_rc41_signed_eod_review_snapshot_v1",
  {p_intent_id:U,p_subject_id:V});
 // The real production source keeps the SQL reader hard OFF at the route.
 assert.deepEqual(result,{data:{proof:"sample"},error:null});
});
test("RPC scope only, rejects invalid identifiers and excludes all mutable routes",async()=>{
 const fn=create(config(good));
 await assert.rejects(fn("different_function",{p_intent_id:U,p_subject_id:V}));
 await assert.rejects(fn("qf_vox_rc41_signed_eod_review_snapshot_v1",
  {p_intent_id:"bad",p_subject_id:V}));
});
test("PostgREST failure returns redacted status without token or raw provider response",async()=>{
 const fn=create(config(good));
 globalThis.__rc44Rpc=async()=>({data:null,error:{message:"secret provider token"}});
 const v=await fn("qf_vox_rc41_signed_eod_review_snapshot_v1",
  {p_intent_id:U,p_subject_id:V});
 assert.equal(v.data,null);
 assert.equal(JSON.stringify(v).includes("secret"),false);
});
test("read-only PostgREST result is denied if JWT expires while request is in flight",async()=>{
 const start=Math.floor(Date.now()/1000);
 let clock=start;
 const fn=create({...config({...good,exp:start+15}),
  clockSeconds:()=>clock});
 globalThis.__rc44Rpc=async()=>{
  clock=start+16;
  return {data:{proof:"would_be_stale"},error:null};
 };
 const reply=await fn("qf_vox_rc41_signed_eod_review_snapshot_v1",
  {p_intent_id:U,p_subject_id:V});
 assert.deepEqual(reply,{data:null,error:{message:"EOD_REVIEW_READER_EXPIRED_DURING_READ"}});
 assert.doesNotMatch(JSON.stringify(reply),/would_be_stale/);
});
test("clock rollback after reader construction refuses RPC without network access",async()=>{
 const start=Math.floor(Date.now()/1000);let clock=start;
 let calls=0;globalThis.__rc44Rpc=async()=>{calls++;return {data:{proof:"unsafe"},error:null};};
 const fn=create({...config({...good,nbf:start-3,iat:start-4}),
  clockSeconds:()=>clock});
 assert.equal(typeof fn,"function");
 clock=start-10;
 await assert.rejects(fn("qf_vox_rc41_signed_eod_review_snapshot_v1",
  {p_intent_id:U,p_subject_id:V}),/EOD_REVIEW_READER_UNAVAILABLE/);
 assert.equal(calls,0);
});
process.on("exit",()=>rmSync(tmp,{recursive:true,force:true}));
