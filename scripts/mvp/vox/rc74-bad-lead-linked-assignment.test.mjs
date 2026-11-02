import test from "node:test";
import assert from "node:assert/strict";
import {build} from "esbuild";
import {mkdtempSync,rmSync} from "node:fs";
import {join,dirname,resolve} from "node:path";
import {tmpdir} from "node:os";
import {fileURLToPath,pathToFileURL} from "node:url";
const root=resolve(dirname(fileURLToPath(import.meta.url)),"../../..");
const folder=mkdtempSync(join(tmpdir(),"rc74-audit-linked-"));
const output=join(folder,"audit.mjs");
const R="11111111-1111-4111-8111-111111111111";
const A="22222222-2222-4222-8222-222222222222";
let mode="success",calls=[];
globalThis.__rc74AuditFactory=()=>({
 from(table){let upd;
  const chain={
   update(payload){upd=payload;calls.push({table,step:"update",payload});return chain;},
   eq(field,value){calls.push({table,step:"filter",field,value});return chain;},
   select(columns){calls.push({table,step:"select",columns});return chain;},
   async single(){
    if(table==="bad_lead_reports")return {data:{id:R,lead_assignment_id:mode==="unassigned"?null:A},error:null};
    if(table==="lead_assignments")return mode==="success"?
      {data:{id:A},error:null}:mode==="missing"?
      {data:null,error:{message:"row not found"}}:
      {data:{id:R},error:null};
    throw Error("unexpected table");
   }
  };return chain;
 }
});
await build({entryPoints:[resolve(root,"services/adminAuditService.ts")],
 outfile:output,bundle:true,platform:"node",format:"esm",target:"node24",logLevel:"silent",
 plugins:[{name:"rc74-isolate-supabase",setup(b){
  b.onResolve({filter:/^\.\.\/lib\/(supabase|errors)$/},a=>({path:a.path,namespace:"rc74"}));
  b.onLoad({filter:/.*/,namespace:"rc74"},a=>({loader:"js",contents:
   a.path.endsWith("supabase")?
    "export const adminClient=()=>globalThis.__rc74AuditFactory();":
    "export const appError=code=>new Error(code);export const fail=e=>({ok:false,error:String(e.message||e)});export const ok=data=>({ok:true,data});export const isMissingRelationError=()=>false;"
  }));
 }}]});
const {updateVendorLeadReportStatus:write}=await import(pathToFileURL(output).href);
test("Valid status confirms both original report and linked assignment flag",async()=>{
 mode="success";calls=[];
 const r=await write(R,{status:"Valid"},"owner-verified");
 assert.equal(r.ok,true);
 assert.ok(calls.some(c=>c.table==="lead_assignments"&&c.step==="update"&&c.payload.is_bad_lead_reported===true));
 assert.ok(calls.some(c=>c.table==="lead_assignments"&&c.step==="select"&&c.columns==="id"));
 assert.ok(calls.some(c=>c.table==="lead_assignments"&&c.step==="filter"&&c.value===A));
 assert.doesNotMatch(JSON.stringify(calls),/wallet|refund|razorpay|money_credit/i);
});
test("missing or mismatched linked assignment must never yield successful Valid review",async()=>{
 for(const m of ["missing","wrong"]){
  mode=m;calls=[];
  const r=await write(R,{status:"Valid"},"owner-verified");
  assert.equal(r.ok,false,m);
  assert.ok(calls.some(c=>c.table==="bad_lead_reports"&&c.step==="update"));
  assert.ok(calls.some(c=>c.table==="lead_assignments"&&c.step==="update"));
 }
});
test("legacy Valid review refuses a report without original assignment BEFORE its status is mutated",async()=>{
 mode="unassigned";calls=[];
 const r=await write(R,{status:"Valid"},"owner-verified");
 assert.equal(r.ok,false);
 assert.equal(calls.filter(x=>x.table==="bad_lead_reports"&&x.step==="update").length,0);
 assert.equal(calls.filter(x=>x.table==="lead_assignments").length,0);
});
test("non-Valid review does not touch assignment at all",async()=>{
 mode="missing";calls=[];
 const r=await write(R,{status:"Invalid"},"owner-verified");
 assert.equal(r.ok,true);
 assert.equal(calls.filter(c=>c.table==="lead_assignments").length,0);
});
process.on("exit",()=>{rmSync(folder,{recursive:true,force:true});delete globalThis.__rc74AuditFactory;});
