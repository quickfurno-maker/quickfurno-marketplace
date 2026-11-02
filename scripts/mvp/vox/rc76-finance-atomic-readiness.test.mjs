import test from "node:test";
import assert from "node:assert/strict";
import {build} from "esbuild";
import {mkdtempSync,rmSync,readFileSync} from "node:fs";
import {dirname,resolve,join} from "node:path";
import {tmpdir} from "node:os";
import {fileURLToPath,pathToFileURL} from "node:url";
const root=resolve(dirname(fileURLToPath(import.meta.url)),"../../..");
const folder=mkdtempSync(join(tmpdir(),"rc76-atomic-"));
const out=join(folder,"service.mjs");
const R="11111111-1111-4111-8111-111111111111",A="22222222-2222-4222-8222-222222222222";
let mode="ok",calls=[];
globalThis.__rc76FinanceDb=()=>({
 async rpc(name,args){
  calls.push({op:"rpc",name,args});
  if(mode==="missing")return {data:null,error:{code:"PGRST202"}};
  if(mode==="mismatch")return {data:{ok:true,schema:"qf.vox.rc75.badlead.status.review.v1",
    reportId:R,status:"Valid",assignmentFlagged:true,leadCreditsIssued:1,providerMessagesSent:0},error:null};
  return {data:{ok:true,schema:"qf.vox.rc75.badlead.status.review.v1",
   reportId:args.p_report_id,status:args.p_status,
   assignmentFlagged:args.p_status==="Valid",leadCreditsIssued:0,providerMessagesSent:0},error:null};
 },
 from(table){calls.push({op:"legacy",table});throw Error("LEGACY_TWO_WRITE_FORBIDDEN");}
});
await build({entryPoints:[resolve(root,"services/adminAuditService.ts")],
 outfile:out,bundle:true,platform:"node",format:"esm",target:"node24",logLevel:"silent",
 plugins:[{name:"isolate-db",setup(b){
  b.onResolve({filter:/^\.\.\/lib\/(supabase|errors)$/},x=>({path:x.path,namespace:"rc76"}));
  b.onLoad({filter:/.*/,namespace:"rc76"},x=>({loader:"js",contents:
   x.path.endsWith("supabase")?"export const adminClient=()=>globalThis.__rc76FinanceDb();":
    'export const appError=x=>new Error(x);export const fail=e=>({ok:false,error:e.message||String(e)});export const ok=data=>({ok:true,data});export const isMissingRelationError=()=>false;'
  }));
 }}]});
const {updateVendorLeadReportStatus:review}=await import(pathToFileURL(out).href);
const saved={atomic:process.env.VOX_BAD_LEAD_ATOMIC_REVIEW_ENABLED,
 portal:process.env.VOX_STAFF_PORTAL_ENABLED,view:process.env.VOX_STAFF_VIEW_MODE};
function gate(){
 process.env.VOX_BAD_LEAD_ATOMIC_REVIEW_ENABLED="staging";
 process.env.VOX_STAFF_PORTAL_ENABLED="staging";
 process.env.VOX_STAFF_VIEW_MODE="owner";
 calls=[];mode="ok";
}
test("only explicit protected Staging atomic mode selects checked single Core RPC",async()=>{
 gate();
 const r=await review(R,{status:"Valid",adminNotes:" reviewed "},A);
 assert.equal(r.ok,true);assert.equal(calls.length,1);
 assert.deepEqual(calls[0],{op:"rpc",name:"qf_vox_rc75_bad_lead_status_atomic_candidate_v1",
 args:{p_report_id:R,p_status:"Valid",p_admin_notes:"reviewed",p_reviewed_by:A}});
 assert.doesNotMatch(JSON.stringify(calls),/refund|wallet|cash|providerMessages/i);
});
test("missing SQL function, forged credit receipt and misconfigured environment cannot fall back to legacy two-write",async()=>{
 for(const m of ["missing","mismatch"]){
  gate();mode=m;
  const r=await review(R,{status:"Valid"},A);
  assert.equal(r.ok,false);assert.equal(calls.length,1);
  assert.equal(calls[0].op,"rpc");
 }
 for(const change of [
  ()=>{delete process.env.VOX_STAFF_PORTAL_ENABLED},
  ()=>{process.env.VOX_STAFF_VIEW_MODE="scoped"},
  ()=>{process.env.VOX_BAD_LEAD_ATOMIC_REVIEW_ENABLED="live"}
 ]){
  gate();change();
  const r=await review(R,{status:"Valid"},A);
  assert.equal(r.ok,false);assert.equal(calls.length,0);
 }
});
test("real status action requires current Owner AAL2 pre/post for ALL atomic-mode statuses",()=>{
 const source=readFileSync(resolve(root,"app/actions.ts"),"utf8");
 const action=source.split("export const adminUpdateVendorLeadReportStatus = async")[1]?.split("export const adminRecommendBadLeadRecovery")[0]??"";
 assert.match(action,/process.env.VOX_BAD_LEAD_ATOMIC_REVIEW_ENABLED==="staging"/);
 assert.match(action,/rc44VerifiedBadLeadOwner\(actor\)/);
 assert.match(action,/rc70PostEligibilityOwnerAuthority\(result,\(\)=>rc44VerifiedBadLeadOwner\(actor\)\)/);
});
process.on("exit",()=>{
 rmSync(folder,{recursive:true,force:true});
 for(const [k,key] of [["atomic","VOX_BAD_LEAD_ATOMIC_REVIEW_ENABLED"],["portal","VOX_STAFF_PORTAL_ENABLED"],["view","VOX_STAFF_VIEW_MODE"]]){
  if(saved[k]===undefined)delete process.env[key];else process.env[key]=saved[k];
 }
 delete globalThis.__rc76FinanceDb;
});
