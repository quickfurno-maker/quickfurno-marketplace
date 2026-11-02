import test from "node:test";
import assert from "node:assert/strict";
import {build} from "esbuild";
import {mkdtempSync,rmSync,readFileSync} from "node:fs";
import {dirname,resolve,join} from "node:path";
import {tmpdir} from "node:os";
import {fileURLToPath,pathToFileURL} from "node:url";
const root=resolve(dirname(fileURLToPath(import.meta.url)),"../../..");
const tmp=mkdtempSync(join(tmpdir(),"rc77-atomic-timeout-"));
const out=join(tmp,"bounded.mjs");
await build({entryPoints:[resolve(root,"services/vox/rc77BoundedAtomicBadLeadReview.ts")],
 outfile:out,bundle:true,platform:"node",format:"esm",target:"node24",logLevel:"silent"});
const {rc77BoundedAtomicBadLeadReview:bounded}=await import(pathToFileURL(out).href);
test("single atomic success returns unchanged genuine receipt",async()=>{
 let writes=0;const receipt={data:{schema:"qf.vox.rc75.badlead.status.review.v1"},error:null};
 const r=await bounded(()=>{writes++;return Promise.resolve(receipt)},25);
 assert.deepEqual(r,{completed:true,reply:receipt});assert.equal(writes,1);
});
test("no response, thrown or rejected writer must report UNKNOWN without second RPC",async()=>{
 for(const writer of [()=>new Promise(()=>{}),async()=>{throw Error("DO_NOT_LEAK")}]) {
  let calls=0;
  const reply=await bounded(()=>{calls++;return writer()},25);
  assert.deepEqual(reply,{completed:false});
  assert.equal(calls,1);
  assert.doesNotMatch(JSON.stringify(reply),/DO_NOT_LEAK|refund|credit/);
 }
});
test("real admin service reports uncertain original Core status and never falls back to partial writes",()=>{
 const src=readFileSync(resolve(root,"services/adminAuditService.ts"),"utf8");
 const part=src.split("const atomicMode=process.env.VOX_BAD_LEAD_ATOMIC_REVIEW_ENABLED;")[1]?.split("const { data: report")[0]??"";
 assert.match(part,/rc77BoundedAtomicBadLeadReview\(\(\)=>db\.rpc/);
 assert.match(part,/if\(!attempt.completed\|\|attempt.reply.error\|\|/);
 assert.match(part,/code:"ATOMIC_REVIEW_OUTCOME_UNKNOWN"/);
 assert.match(part,/Reconcile the original report and assignment in Core/);
 assert.doesNotMatch(part,/adminApplyBadLeadRecovery|cashRefund|restore_credit_and_replace/);
});
process.on("exit",()=>rmSync(tmp,{recursive:true,force:true}));
