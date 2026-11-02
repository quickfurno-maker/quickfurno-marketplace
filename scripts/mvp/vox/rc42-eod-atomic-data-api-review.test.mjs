import test from "node:test";import assert from "node:assert/strict";
import {build} from "esbuild";import {mkdtempSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";import {resolve,dirname,join} from "node:path";
import {fileURLToPath,pathToFileURL} from "node:url";
const root=resolve(dirname(fileURLToPath(import.meta.url)),"../../..");
const tmp=mkdtempSync(join(tmpdir(),"rc42-eod-review-")),out=join(tmp,"handler.mjs");
await build({entryPoints:[resolve(root,"services/vox/rc42SignedEodDataApiReviewHandler.ts")],
 outfile:out,bundle:true,platform:"node",format:"esm",target:"node24",logLevel:"silent",
 plugins:[{name:"server-only",setup(b){b.onResolve({filter:/^server-only$/},
 ()=>({path:"server-only",namespace:"mock"}));b.onLoad({filter:/.*/,namespace:"mock"},
 ()=>({contents:"",loader:"js"}));}}]});
const {createRc42SignedEodDataApiReviewHandler:create}=await import(pathToFileURL(out).href);
const U="11111111-1111-4111-8111-111111111111",S="22222222-2222-4222-8222-222222222222";
const H="a".repeat(64);
const url="https://local.test/api/vox/v1/eod-atomic-review?intentId="+U+"&subjectId="+S+"&expectedReceiptSha256="+H;
const request=(opts={})=>new Request(opts.url??url,{headers:{
 authorization:opts.owner??"Bearer owner",
 "x-vox-team-leader-authorization":opts.leader??"Bearer leader"
}});
const proof={ok:true,state:"PENDING_RECEIPT_AWAITING_EXTERNAL_REVIEW",receiptSha256:H,
 approved:false,publicationAuthorized:false,providerMessagesSent:0};
function deps(opts={}){const calls=[];const rpc=async()=>({data:null,error:null});
 return {calls,...{enabled:()=>true,installed:()=>true,rpc:()=>rpc,
  review:async(...args)=>{calls.push(args);return proof;}},...opts};
}
test("uninstalled reviewed SQL or default-OFF has no read or auth",async()=>{
 const d=deps({installed:()=>false});const r=await create(d)(request());
 assert.equal(r.status,503);assert.equal(d.calls.length,0);
 const e=deps({enabled:()=>false});assert.equal((await create(e)(request())).status,503);
 assert.equal(e.calls.length,0);
});
test("exact query, distinct Owner/TL credentials required",async()=>{
 const d=deps();
 for(const u of [url+"&actorId="+U,url+"&intentId="+U,
  url.replace("intentId="+U,"intentId=bad")]){
  assert.equal((await create(d)(request({url:u}))).status,400);
 }
 assert.equal((await create(d)(request({leader:"Bearer owner"}))).status,403);
 assert.equal(d.calls.length,0);
});
test("missing reviewed Data API reader fails closed before two-human review",async()=>{
 const d=deps({rpc:()=>null});const r=await create(d)(request());
 assert.equal(r.status,503);assert.equal(d.calls.length,0);
});
test("reader construction failure never leaks credentials or starts a review",async()=>{
 let reviews=0;
 const d=deps({rpc:()=>{throw Error("sensitive_reader_factory_error");},
  review:async()=>{reviews++;return proof;}});
 const r=await create(d)(request());
 assert.equal(r.status,503);
 const b=await r.json();
 assert.equal(b.error,"REVIEWED_DATA_API_READER_UNAVAILABLE");
 assert.equal(b.publicationAuthorized,false);
 assert.equal(b.providerMessagesSent,0);
 assert.equal(JSON.stringify(b).includes("sensitive_reader_factory_error"),false);
 assert.equal(reviews,0);
});
test("signed receipt preview never grants official EOD publication",async()=>{
 const d=deps();const r=await create(d)(request());assert.equal(r.status,200);
 const b=await r.json();assert.equal(b.ok,true);
 assert.equal(b.approved,false);assert.equal(b.publicationAuthorized,false);
 assert.equal(b.providerMessagesSent,0);assert.equal(b.mode,"READ_ONLY");
 assert.equal(d.calls.length,1);assert.equal(d.calls[0][0],"Bearer owner");
 assert.equal(d.calls[0][1],"Bearer leader");
});
test("forged, revoked, mutated or mismatched receipt never passes",async()=>{
 for(const bad of [
  {...proof,ok:false,reason:"SIGNER_REVOKED"},
  {...proof,receiptSha256:"b".repeat(64)},
  {...proof,approved:true},
  {...proof,publicationAuthorized:true},
  {...proof,providerMessagesSent:1},
  {...proof,state:"PUBLISHED"}
 ]){
  const d=deps({review:async()=>bad});assert.equal((await create(d)(request())).status,409);
 }
});
test("hung independent Owner and Team Leader review times out with zero approval",async()=>{
 const d=deps({reviewTimeoutMs:25,
  review:async()=>new Promise(()=>{})});
 const start=Date.now();
 const r=await create(d)(request());
 assert.equal(r.status,503);
 assert.ok(Date.now()-start<1000);
 const body=await r.json();
 assert.equal(body.ok,false);
 assert.equal(body.error,"EOD_REVIEW_TIMEOUT");
 assert.equal(body.approved,false);
 assert.equal(body.publicationAuthorized,false);
 assert.equal(body.providerMessagesSent,0);
});
test("RPC or signer verification exceptions are fail-closed",async()=>{
 const d=deps({review:async()=>{throw Error("revoked");}});
 const r=await create(d)(request());assert.equal(r.status,503);
 const b=await r.json();assert.equal(b.approved,false);
});
process.on("exit",()=>rmSync(tmp,{recursive:true,force:true}));
