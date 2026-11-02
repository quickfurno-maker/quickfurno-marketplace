import test from "node:test";
import assert from "node:assert/strict";
import {build} from "esbuild";
import {mkdtempSync,rmSync,readFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {resolve,join,dirname} from "node:path";
import {fileURLToPath,pathToFileURL} from "node:url";
const root=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const dir=mkdtempSync(join(tmpdir(),"rc69-work-ui-")),out=join(dir,"receipt.mjs");
await build({entryPoints:[resolve(root,"lib/rc69VerifiedWorkReceipt.ts")],
 bundle:true,outfile:out,platform:"node",format:"esm",target:"node24",logLevel:"silent"});
const {isVerifiedWorkReceipt:verify}=await import(pathToFileURL(out).href);
const ITEM="11111111-1111-4111-8111-111111111111";
const NONCE="22222222-2222-4222-8222-222222222222";
const ACTIONS={CLAIM:"ASSIGNED",START:"IN_PROGRESS",WAIT_EXTERNAL:"WAITING_EXTERNAL",
 REQUEST_APPROVAL:"WAITING_APPROVAL",BLOCK:"BLOCKED",RESUME:"IN_PROGRESS",COMPLETE:"DONE"};
const receipt=(state="ASSIGNED",extra={})=>({ok:true,status:200,
 schema:"qf.vox.work.transaction.receipt.v1",workItemId:ITEM,nonce:NONCE,
 newState:state,revision:6,providerMessagesSent:0,
 affectsVendorLeadMatching:false,...extra});
const command=action=>({action,itemId:ITEM,nonce:NONCE,expectedRevision:5});
test("each of seven actual Staff actions accepts its exact verified Core/BFF success receipt",()=>{
 for(const [action,newState] of Object.entries(ACTIONS)){
  assert.equal(verify(receipt(newState),command(action)),true,action);
 }
});
test("forged success cannot clear a protected same-tab original nonce",()=>{
 const malformed=[
  {ok:true},{...receipt(),schema:"not-core"},
  receipt("ASSIGNED",{providerMessagesSent:1}),
  receipt("ASSIGNED",{affectsVendorLeadMatching:true}),
  receipt("ASSIGNED",{workItemId:"other"}),
  receipt("ASSIGNED",{nonce:"33333333-3333-4333-8333-333333333333"}),
  receipt("ASSIGNED",{revision:5}),
  receipt("ASSIGNED",{revision:7}),
  receipt("ASSIGNED",{status:503}),
  receipt("DONE"),receipt("ASSIGNED",{secret:"provider"}),
  receipt("ASSIGNED",{ok:false}),
  receipt("ASSIGNED",{revision:6.2}),
  receipt("ASSIGNED",{newState:null}),
 ];
 for(const bad of malformed)assert.equal(verify(bad,command("CLAIM")),false);
 assert.equal(verify(null,command("CLAIM")),false);
 assert.equal(verify([],command("CLAIM")),false);
 assert.equal(verify(receipt(),{...command("CLAIM"),expectedRevision:-1}),false);
 assert.equal(verify(receipt(),{...command("CLAIM"),action:"SEND_PROVIDER"}),false);
});
test("the actual WorkActionControl verifies receipt before clearing the exact nonce",()=>{
 const ui=readFileSync(resolve(root,"app/team/work-queue/WorkActionControl.tsx"),"utf8");
 assert.match(ui,/isVerifiedWorkReceipt\(body,\{action,itemId,nonce:pending\.current\.nonce,expectedRevision:revision\}\)/);
 assert.ok(ui.indexOf("isVerifiedWorkReceipt(body")<ui.indexOf("clearPendingWork(tabStore()"));
 assert.ok(ui.indexOf("savePendingWork(tabStore()")<ui.indexOf('fetch("/api/work-transitions"'));
 assert.match(ui,/setUncertain\(true\)/);
});
process.on("exit",()=>rmSync(dir,{recursive:true,force:true}));
