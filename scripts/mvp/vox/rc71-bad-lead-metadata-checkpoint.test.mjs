import test from "node:test";
import assert from "node:assert/strict";
import {build} from "esbuild";
import {mkdtempSync,rmSync,readFileSync} from "node:fs";
import {resolve,dirname,join} from "node:path";
import {tmpdir} from "node:os";
import {pathToFileURL,fileURLToPath} from "node:url";
const root=resolve(dirname(fileURLToPath(import.meta.url)),"../../..");
const tmp=mkdtempSync(join(tmpdir(),"rc71-finance-meta-"));
const out=join(tmp,"pending.mjs");
await build({entryPoints:[resolve(root,"lib/vox/badLeadReviewCheckpoint.ts")],
 outfile:out,bundle:true,platform:"node",format:"esm",target:"node24",logLevel:"silent"});
const {readBadLeadReviewCheckpoint:read,markBadLeadPending:mark,
 clearBadLeadPending:clear}=await import(pathToFileURL(out).href);
const ID="11111111-1111-4111-8111-111111111111";
test("persistent readback is mandatory; ignored browser storage writes cannot authorize Core metadata",()=>{
 const s={getItem:()=>null,setItem:()=>{}};
 assert.equal(mark(s,ID),false);
 const m=new Map(),persist={getItem:k=>m.get(k)??null,setItem:(k,v)=>m.set(k,v)};
 assert.equal(mark(persist,ID),true);
 assert.equal(read(persist).locked.has(ID),true);
 assert.equal(clear({...persist,setItem:()=>{}},ID),false);
 assert.equal(read(persist).locked.has(ID),true);
 assert.equal(clear(persist,ID),true);
 assert.equal(read(persist).locked.size,0);
 assert.equal(clear(persist,ID),false);
});
test("actual bad lead status and recommendation metadata share original-report fail-closed checkpoint",()=>{
 const src=readFileSync(resolve(root,"components/admin/LeadMatchingAuditPanels.tsx"),"utf8");
 const fn=src.split("function runGovernedMetadata(")[1]?.split("function updateStatus(")[0]??"";
 assert.ok(fn.indexOf("markBadLeadPending(badLeadSessionStore(),report.id)")>=0);
 assert.ok(fn.indexOf("markBadLeadPending(badLeadSessionStore(),report.id)")<fn.indexOf("await write()"));
 assert.ok(fn.indexOf("clearBadLeadPending(badLeadSessionStore(),report.id)")>fn.indexOf("await write()"));
 assert.ok(fn.indexOf("if(!result.ok)")<fn.indexOf("clearBadLeadPending(badLeadSessionStore(),report.id)"));
 assert.match(fn,/recoveryNeedsReview.current.add\(report.id\)/);
 assert.match(src,/runGovernedMetadata\(report,`Report marked \$\{status\}`/);
 assert.match(src,/runGovernedMetadata\(report,"Recovery recommendation generated"/);
 assert.match(fn,/never issue a second decision blindly/);
});
process.on("exit",()=>rmSync(tmp,{recursive:true,force:true}));
