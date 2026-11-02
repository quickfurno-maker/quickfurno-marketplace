import test from "node:test";
import assert from "node:assert/strict";
import {build} from "esbuild";
import {mkdtempSync,rmSync,readFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join,resolve,dirname} from "node:path";
import {fileURLToPath,pathToFileURL} from "node:url";
const root=resolve(dirname(fileURLToPath(import.meta.url)),"../../..");
const tmp=mkdtempSync(join(tmpdir(),"rc65-credit-auth-"));
const out=join(tmp,"recheck.mjs");
await build({entryPoints:[resolve(root,"services/vox/rc65PostCreditOwnerAuthority.ts")],
 outfile:out,bundle:true,platform:"node",format:"esm",target:"node24",logLevel:"silent"});
const {rc65PostCreditOwnerAuthority:check}=await import(pathToFileURL(out).href);
const ok={ok:true,data:{leadCreditsRestored:1,originalAssignmentId:"test",cashRefund:0}};
test("current Owner post-write retains the exact canonical receipt without extra mutation",async()=>{
 let calls=0;const result=await check(ok,"restore_credit",async()=>{calls++;return true;});
 assert.equal(result,ok);assert.equal(calls,1);
});
test("post-write MFA revoke, expiry, exception, timeout become UNKNOWN not a rollback",async()=>{
 for(const action of ["restore_credit","reject"]){
  for(const f of [async()=>false,async()=>{throw Error("private auth secret");},
   async()=>new Promise(()=>{})]){
   const t=Date.now(),r=await check(ok,action,f,25);
   assert.equal(r.ok,false);
   assert.equal(r.code,action==="restore_credit"?"CREDIT_OUTCOME_UNKNOWN":"REJECT_OUTCOME_UNKNOWN");
   assert.ok(Date.now()-t<1000);
   assert.equal(JSON.stringify(r).includes("private auth secret"),false);
  }
 }
});
test("failed canonical decision is preserved without extra Owner lookup",async()=>{
 let called=0;
 const original={ok:false,code:"CREDIT_ONLY_ATOMIC_NOT_APPROVED"};
 const result=await check(original,"restore_credit",async()=>{called++;return false;});
 assert.equal(result,original);assert.equal(called,0);
});
test("real admin compensation entry point checks Owner both before and after SQL",()=>{
 const src=readFileSync(resolve(root,"app/actions.ts"),"utf8");
 const s=src.split("export const adminApplyBadLeadRecovery = async (")[1]
  ?.split("export const adminAddVendorLeadReportComment")[0]??"";
 assert.match(s,/verifyVoxOwnerBearer\("Bearer " \+ session\.access_token\) !== actor/);
 assert.match(s,/rc65PostCreditOwnerAuthority\(result,action,/);
 assert.match(s,/\(\)=>rc44VerifiedBadLeadOwner\(actor\)/);
 assert.ok(s.indexOf("badLeadRecovery.applyBadLeadRecovery(")<
  s.indexOf("rc65PostCreditOwnerAuthority(result,action"));
 assert.match(s,/return verified/);
});
process.on("exit",()=>rmSync(tmp,{recursive:true,force:true}));
