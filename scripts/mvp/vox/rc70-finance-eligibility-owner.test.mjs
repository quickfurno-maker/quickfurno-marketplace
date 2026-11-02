import test from "node:test";
import assert from "node:assert/strict";
import {build} from "esbuild";
import {mkdtempSync,rmSync,readFileSync} from "node:fs";
import {resolve,join,dirname} from "node:path";
import {tmpdir} from "node:os";
import {fileURLToPath,pathToFileURL} from "node:url";
const root=resolve(dirname(fileURLToPath(import.meta.url)),"../../..");
const dir=mkdtempSync(join(tmpdir(),"rc70-finance-eligibility-"));
const target=join(dir,"owner.mjs");
await build({entryPoints:[resolve(root,"services/vox/rc70PostEligibilityOwnerAuthority.ts")],
 outfile:target,bundle:true,platform:"node",format:"esm",target:"node24",logLevel:"silent"});
const {rc70PostEligibilityOwnerAuthority:check}=await import(pathToFileURL(target).href);
const receipt={ok:true,data:{reportId:"synthetic",status:"Valid"}};
test("successful eligibility metadata write requires a second current Owner AAL2",async()=>{
 let invoked=0;
 const value=await check(receipt,async()=>{invoked++;return true;});
 assert.equal(value,receipt);assert.equal(invoked,1);
});
test("revoked, thrown or hung post-write Owner check returns UNKNOWN, never credit or money confirmation",async()=>{
 for(const verify of [async()=>false,async()=>{throw Error("private bearer token");},
  async()=>new Promise(()=>{})]){
  const started=Date.now();
  const r=await check(receipt,verify,25);
  assert.equal(r.ok,false);
  assert.equal(r.code,"ELIGIBILITY_OUTCOME_UNKNOWN");
  assert.equal(JSON.stringify(r).includes("private bearer token"),false);
  assert.equal(JSON.stringify(r).includes("leadCreditsRestored"),false);
  assert.ok(Date.now()-started<1000);
 }
});
test("failed metadata writer preserves original failure with no post-check",async()=>{
 let n=0;const failed={ok:false,error:"validation"};
 assert.equal(await check(failed,async()=>{n++;return true;}),failed);
 assert.equal(n,0);
});
test("actual admin Valid status path checks Owner before and after writer, no direct credits",()=>{
 const src=readFileSync(resolve(root,"app/actions.ts"),"utf8");
 const body=src.split("export const adminUpdateVendorLeadReportStatus = async")[1]
  ?.split("export const adminRecommendBadLeadRecovery")[0]??"";
 const writer=body.indexOf("audit.updateVendorLeadReportStatus");
 assert.ok(body.indexOf('input?.status==="Valid"')>=0);
 assert.ok(writer>body.indexOf("rc44VerifiedBadLeadOwner(actor)"));
 assert.ok(body.indexOf("rc70PostEligibilityOwnerAuthority(result,()=>rc44VerifiedBadLeadOwner(actor))")>writer);
 assert.ok(body.indexOf('if(verified.ok)revalidatePath("/admin/leads")')>writer);
 assert.equal(body.includes("adminApplyBadLeadRecovery"),false);
 assert.equal(body.includes("razorpay"),false);
});
process.on("exit",()=>rmSync(dir,{recursive:true,force:true}));
