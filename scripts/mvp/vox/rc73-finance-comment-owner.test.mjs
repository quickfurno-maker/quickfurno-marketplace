import test from "node:test";
import assert from "node:assert/strict";
import {build} from "esbuild";
import {mkdtempSync,rmSync,readFileSync} from "node:fs";
import {join,resolve,dirname} from "node:path";
import {tmpdir} from "node:os";
import {fileURLToPath,pathToFileURL} from "node:url";
const root=resolve(dirname(fileURLToPath(import.meta.url)),"../../..");
const temp=mkdtempSync(join(tmpdir(),"rc73-comment-aal2-"));
const out=join(temp,"check.mjs");
await build({entryPoints:[resolve(root,"services/vox/rc73PostCommentOwnerAuthority.ts")],
 outfile:out,bundle:true,platform:"node",format:"esm",target:"node24",logLevel:"silent"});
const {rc73PostCommentOwnerAuthority:verify}=await import(pathToFileURL(out).href);
const written={ok:true,data:{commentId:"test-comment-id"}};
test("comment already committed requires fresh Owner authority before success",async()=>{
 let count=0;
 const r=await verify(written,async()=>{count++;return true;});
 assert.equal(r,written);assert.equal(count,1);
});
test("post-write revoked, thrown, timed-out Owner returns unknown; never claims rollback or credit",async()=>{
 for(const check of [async()=>false,async()=>{throw Error("PRIVATE_SESSION");},
   async()=>new Promise(()=>{})]){
  const r=await verify(written,check,25);
  assert.deepEqual(Object.keys(r).sort(),["code","error","ok"]);
  assert.equal(r.ok,false);assert.equal(r.code,"COMMENT_OUTCOME_UNKNOWN");
  assert.doesNotMatch(JSON.stringify(r),/PRIVATE_SESSION|leadCreditsRestored|cashRefund/);
 }
});
test("a failed original comment write does not invoke an unnecessary post-check",async()=>{
 let called=0;const denied={ok:false,error:"forbidden"};
 assert.equal(await verify(denied,async()=>{called++;return true;}),denied);
 assert.equal(called,0);
});
test("real server action binds same verified Owner actor pre/post SQL, not a role cookie",()=>{
 const src=readFileSync(resolve(root,"app/actions.ts"),"utf8");
 const body=src.split("export const adminAddVendorLeadReportComment = async")[1]?.split("export const adminListPackageOrdersAuditOnly")[0]??"";
 const first=body.indexOf("rc44VerifiedBadLeadOwner(actor)");
 const writer=body.indexOf("audit.addVendorLeadReportComment");
 assert.ok(first>=0&&first<writer);
 assert.ok(body.indexOf("user.id!==actor")<writer);
 assert.ok(body.indexOf("rc73PostCommentOwnerAuthority(result,()=>rc44VerifiedBadLeadOwner(actor))")>writer);
 assert.ok(body.indexOf('if(verified.ok)revalidatePath("/admin/leads")')>writer);
 assert.doesNotMatch(body,/adminApplyBadLeadRecovery|razorpay|providerMessage/);
});
process.on("exit",()=>rmSync(temp,{recursive:true,force:true}));
