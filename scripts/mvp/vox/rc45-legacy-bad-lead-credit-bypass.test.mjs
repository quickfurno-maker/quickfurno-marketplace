import test from "node:test";
import assert from "node:assert/strict";
import {build} from "esbuild";
import {mkdtempSync,rmSync,readFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {resolve,join,dirname} from "node:path";
import {fileURLToPath,pathToFileURL} from "node:url";
const root=resolve(dirname(fileURLToPath(import.meta.url)),"../../..");
const src=resolve(root,"services/vendorCreditWalletService.ts");
const tmp=mkdtempSync(join(tmpdir(),"rc45-credit-bypass-")),out=join(tmp,"wallet.mjs");
await build({entryPoints:[src],outfile:out,bundle:true,platform:"node",
 format:"esm",target:"node24",logLevel:"silent",
 plugins:[{name:"wallet-stubs",setup(b){
  b.onResolve({filter:/^\.\.\/lib\/supabase$/},()=>({path:"supabase",namespace:"stub"}));
  b.onResolve({filter:/^\.\.\/lib\/errors$/},()=>({path:"errors",namespace:"stub"}));
  b.onLoad({filter:/.*/,namespace:"stub"},a=>({loader:"js",contents:
   a.path==="supabase"?
    "export const adminClient=()=>({rpc:(...args)=>globalThis.__rc45WalletRpc(...args)});":
    "export const ok=data=>({ok:true,data}); export const fail=e=>({ok:false,error:String(e)}); export const appError=c=>new Error(c);"
  }));
 }}]});
const {refundCreditForInvalidLead:legacy,applyVendorCreditDelta:apply,
 grantVendorCredits:grant,grantCreditsForConfirmedPackagePurchase:packageGrant}
 =await import(pathToFileURL(out).href);
let calls=[];
globalThis.__rc45WalletRpc=async(...args)=>{calls.push(args);
 return {data:{status:"applied",vendor_id:"vendor",credits_before:3,credits_after:4,delta:1},error:null};};
const reset=()=>{calls=[];};
test("deprecated invalid lead helper must not grant credit even with a unique reference",async()=>{
 reset();const r=await legacy({vendorId:"vendor",referenceId:"assignment",
 reason:"approved",updatedBy:"admin"});
 assert.equal(r.ok,false);assert.match(r.error,/UNAUTHORIZED/);assert.equal(calls.length,0);
});
test("generic legacy delta path cannot bypass assignment-wide uniqueness",async()=>{
 reset();const r=await apply({vendorId:"vendor",delta:1,
 changeType:"invalid_lead_refund",referenceType:"invalid_lead_refund",referenceId:"report"});
 assert.equal(r.ok,false);assert.match(r.error,/UNAUTHORIZED/);assert.equal(calls.length,0);
});
test("generic positive legacy grant cannot bypass source policy",async()=>{
 reset();const r=await grant({vendorId:"vendor",amount:1,changeType:"invalid_lead_refund",
 referenceId:"report-two"});
 assert.equal(r.ok,false);assert.equal(calls.length,0);
});
test("unrelated genuine purchased package credits retain their existing transport",async()=>{
 reset();const r=await packageGrant({vendorId:"vendor",creditsPurchased:1,referenceId:"provider-paid-order"});
 assert.equal(r.ok,true);assert.equal(calls.length,1);
 assert.equal(calls[0][0],"qf_apply_vendor_credit_delta");
 assert.equal(calls[0][1].p_change_type,"package_purchase");
});
test("all legacy bad-lead credit entry points remain guarded in checked-in source",()=>{
 const s=readFileSync(src,"utf8");
 assert.match(s,/if \(input\.changeType === "invalid_lead_refund"\)/);
 assert.match(s,/return fail\(appError\("UNAUTHORIZED"\)\)/);
 assert.doesNotMatch(s,/referenceType: "invalid_lead_refund"/);
});
process.on("exit",()=>rmSync(tmp,{recursive:true,force:true}));
