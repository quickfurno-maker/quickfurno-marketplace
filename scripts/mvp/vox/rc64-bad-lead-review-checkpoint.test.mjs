import test from "node:test";
import assert from "node:assert/strict";
import {build} from "esbuild";
import {mkdtempSync,rmSync,readFileSync} from "node:fs";
import {resolve,join,dirname} from "node:path";
import {tmpdir} from "node:os";
import {fileURLToPath,pathToFileURL} from "node:url";
const root=resolve(dirname(fileURLToPath(import.meta.url)),"../../..");
const temp=mkdtempSync(join(tmpdir(),"rc64-finance-"));
const outfile=join(temp,"checkpoint.mjs");
await build({entryPoints:[resolve(root,"lib/vox/badLeadReviewCheckpoint.ts")],
 outfile,bundle:true,platform:"node",format:"esm",target:"node24",logLevel:"silent"});
const {BAD_LEAD_REVIEW_CHECKPOINT_KEY:KEY,readBadLeadReviewCheckpoint:read,
 markBadLeadPending:mark,clearBadLeadPending:clear}=await import(pathToFileURL(outfile).href);
const A="11111111-1111-4111-8111-111111111111";
const B="22222222-2222-4222-8222-222222222222";
const storage=()=>{const m=new Map();return {
 getItem:k=>m.get(k)??null,setItem:(k,v)=>m.set(k,v),m
}};
test("in-flight decisions are stored before HTTP, survive same-tab refresh and clear only after confirmation",()=>{
 const s=storage();assert.equal(mark(s,A),true);
 assert.equal(mark(s,B),true);
 assert.equal(read(s).available,true);
 assert.deepEqual([...read(s).locked].sort(),[A,B]);
 assert.equal(clear(s,A),true);assert.deepEqual([...read(s).locked],[B]);
 assert.equal(clear(s,B),true);assert.equal(read(s).locked.size,0);
});
test("tampered, oversized or unavailable storage fails closed",()=>{
 for(const invalid of ['{','["not-uuid"]','["'+A+'","'+A+'"]',
  JSON.stringify(Array.from({length:65},()=>A)),"x".repeat(4001)]){
  const s=storage();s.setItem(KEY,invalid);assert.equal(read(s).available,false);
  assert.equal(mark(s,B),false);assert.equal(clear(s,B),false);
 }
 assert.equal(read(null).available,false);assert.equal(mark(null,A),false);
 assert.equal(clear(null,A),false);
 const blocked={getItem(){throw Error("restricted")},setItem(){throw Error("restricted")}};
 assert.equal(read(blocked).available,false);assert.equal(mark(blocked,A),false);
});
test("real operator records checkpoint ahead of network and blocks unresolved decisions",()=>{
 const ui=readFileSync(resolve(root,"components/admin/LeadMatchingAuditPanels.tsx"),"utf8");
 for(const marker of ["readBadLeadReviewCheckpoint(badLeadSessionStore())",
  "markBadLeadPending(badLeadSessionStore(),report.id)",
  "clearBadLeadPending(badLeadSessionStore(),report.id)",
  "if(!recoveryReady||!recoveryStorageAvailable)",
  "recoveryNeedsReview.current.add(report.id)",
  "action===\"reject\"&&result.code===\"REJECT_OUTCOME_UNKNOWN\""])
  assert.ok(ui.includes(marker),marker);
 assert.ok(ui.indexOf("markBadLeadPending(badLeadSessionStore(),report.id)")<
  ui.indexOf("adminApplyBadLeadRecovery(report.id,action)"),"checkpoint before RPC");
 assert.ok(ui.indexOf("clearBadLeadPending(badLeadSessionStore(),report.id)")>
  ui.indexOf("adminApplyBadLeadRecovery(report.id,action)"),"clear only after verified response");
});
process.on("exit",()=>rmSync(temp,{recursive:true,force:true}));
