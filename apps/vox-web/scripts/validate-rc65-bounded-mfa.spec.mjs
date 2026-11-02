import test from "node:test";
import assert from "node:assert/strict";
import {build} from "esbuild";
import {readFileSync,mkdtempSync,rmSync} from "node:fs";
import {resolve,join} from "node:path";
import {tmpdir} from "node:os";
import {pathToFileURL} from "node:url";
const root=resolve(import.meta.dirname,"..");
const temp=mkdtempSync(join(tmpdir(),"vox-rc65-mfa-"));
const out=join(temp,"helper.mjs");
await build({entryPoints:[resolve(root,"lib/rc65BoundedStaffMfa.ts")],outfile:out,
 bundle:true,platform:"node",format:"esm",target:"node24",logLevel:"silent"});
const {rc65BoundedStaffMfa:check}=await import(pathToFileURL(out).href);
test("genuine Staff token passes; absent token is a verified no-session result",async()=>{
 const good=await check(async()=>"test-mfa-token");
 assert.deepEqual(good,{completed:true,token:"test-mfa-token"});
 assert.deepEqual(await check(async()=>null),{completed:true,token:null});
});
test("hung GoTrue is bounded before Core mutation; throw or forged token fails closed",async()=>{
 const start=Date.now();
 assert.deepEqual(await check(async()=>new Promise(()=>{}),25),
  {completed:false,token:null});
 assert.ok(Date.now()-start<1000);
 assert.deepEqual(await check(async()=>{throw Error("secret");},25),
  {completed:false,token:null});
 assert.deepEqual(await check(async()=>({token:"forged"}),25),
  {completed:false,token:null});
});
test("actual conversation writer and discovery both use bounded preflight BEFORE Core fetch",()=>{
 const src=readFileSync(resolve(root,"lib/conversationControl.ts"),"utf8");
 assert.equal((src.match(/rc65BoundedStaffMfa\(verifiedMfaSession\)/g)??[]).length,2);
 assert.equal((src.match(/STAFF_AUTH_PREFLIGHT_TIMEOUT/g)??[]).length,2);
 for(const fn of ["submitConversationControl","fetchConversationCandidates"]){
  const scoped=src.split("export async function "+fn+"(")[1]??"";
  const before=scoped.split("fetch(base+")[0];
  assert.match(before,/rc65BoundedStaffMfa\(verifiedMfaSession\)/);
  assert.match(before,/if\(!staff.completed\)return/);
 }
});
process.on("exit",()=>rmSync(temp,{recursive:true,force:true}));
