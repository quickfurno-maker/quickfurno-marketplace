import test from "node:test";
import assert from "node:assert/strict";
import {build} from "esbuild";
import {mkdtempSync,rmSync,readFileSync} from "node:fs";
import {resolve,join,dirname} from "node:path";
import {tmpdir} from "node:os";
import {fileURLToPath,pathToFileURL} from "node:url";
const root=resolve(dirname(fileURLToPath(import.meta.url)),"../../..");
const dir=mkdtempSync(join(tmpdir(),"rc68-recommend-"));
const path=join(dir,"owner.mjs");
await build({entryPoints:[resolve(root,"services/vox/rc68PostRecommendationOwnerAuthority.ts")],
 outfile:path,bundle:true,platform:"node",format:"esm",target:"node24",logLevel:"silent"});
const {rc68PostRecommendationOwnerAuthority:check}=await import(pathToFileURL(path).href);
const receipt={ok:true,data:{reportId:"sample",recommendation:"restore_credit"}};
test("exact successful metadata receipt requires reverified original Owner",async()=>{
 let checks=0;
 const r=await check(receipt,async()=>{checks++;return true;});
 assert.equal(r,receipt);assert.equal(checks,1);
});
test("post-receipt revoked Owner, exception and timeout are UNKNOWN without leaking authority data",async()=>{
 for(const verify of [async()=>false,async()=>{throw Error("private token");},async()=>new Promise(()=>{})]){
  const started=Date.now();
  const r=await check(receipt,verify,25);
  assert.equal(r.ok,false);assert.equal(r.code,"RECOMMEND_OUTCOME_UNKNOWN");
  assert.equal(JSON.stringify(r).includes("private token"),false);
  assert.ok(Date.now()-started<1000);
 }
});
test("failed recommendation preserves exact original failure and does not reverify",async()=>{
 let count=0;
 const failed={ok:false,code:"RECOMMEND_OUTCOME_UNKNOWN"};
 assert.equal(await check(failed,async()=>{count++;return true;}),failed);
 assert.equal(count,0);
});
test("both real Owner recommendation actions verify current AAL2 before and after metadata write",()=>{
 const s=readFileSync(resolve(root,"app/actions.ts"),"utf8");
 for(const text of [s.split("export const adminRecommendBadLeadRecovery = async (")[1]?.split("export const adminGenerateBadLeadRecoveryRecommendation")[0]??"",
   s.split("export const adminGenerateBadLeadRecoveryRecommendation = async (")[1]?.split("export const adminApplyBadLeadRecovery")[0]??""]){
  const writer=text.indexOf("badLeadRecovery.");
  assert.ok(writer>text.indexOf("rc44VerifiedBadLeadOwner(actor)"));
  assert.ok(text.indexOf("rc68PostRecommendationOwnerAuthority(receipt,")>writer);
  assert.match(text,/\(\)=>rc44VerifiedBadLeadOwner\(actor\)/);
 }
});
process.on("exit",()=>rmSync(dir,{recursive:true,force:true}));
