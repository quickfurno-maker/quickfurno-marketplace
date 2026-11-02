import test from "node:test";
import assert from "node:assert/strict";
import {build} from "esbuild";
import {mkdtempSync,rmSync,readFileSync} from "node:fs";
import {resolve,join} from "node:path";
import {tmpdir} from "node:os";
import {pathToFileURL} from "node:url";
const root=resolve(import.meta.dirname,".."),tmp=mkdtempSync(join(tmpdir(),"vox-rc66-work-")),out=join(tmp,"helper.mjs");
await build({entryPoints:[resolve(root,"lib/rc66PendingWorkTransition.ts")],
 outfile:out,bundle:true,platform:"node",format:"esm",target:"node24",logLevel:"silent"});
const {readPendingWork:read,savePendingWork:save,clearPendingWork:clear,PENDING_WORK_KEY:KEY}=await import(pathToFileURL(out).href);
const ID="11111111-1111-4111-8111-111111111111",N="22222222-2222-4222-8222-222222222222";
const record={itemId:ID,nonce:N,action:"BLOCK",expectedRevision:5,reason:"Waiting for documents"};
const mem=()=>{const m=new Map();return {getItem:k=>m.get(k)??null,setItem:(k,v)=>m.set(k,v),m};};
test("same-tab work nonce and exact command survive refresh; only matching nonce clears",()=>{
 const s=mem();assert.equal(save(s,record),true);
 assert.deepEqual(read(s).records,[record]);
 assert.equal(save(s,{...record,nonce:"33333333-3333-4333-8333-333333333333"}),false);
 assert.equal(clear(s,ID,"33333333-3333-4333-8333-333333333333"),false);
 assert.deepEqual(read(s).records,[record]);
 assert.equal(clear(s,ID,N),true);
 assert.deepEqual(read(s).records,[]);
});
test("parallel work items retained without overwriting one another",()=>{
 const s=mem(),other={...record,itemId:"33333333-3333-4333-8333-333333333333"};
 assert.equal(save(s,record),true);assert.equal(save(s,other),true);
 assert.equal(read(s).records.length,2);assert.equal(clear(s,ID,N),true);
 assert.deepEqual(read(s).records,[other]);
});
test("tampering, invalid command, oversized data or denied storage prevents another Core call",()=>{
 const bad=[{...record,nonce:"bad"},{...record,reason:"x"},
 {...record,expectedRevision:-1},{...record,action:"SEND_PROVIDER"},
 {...record,actor:"forged"}, {...record,action:"CLAIM"}];
 for(const x of bad)assert.equal(save(mem(),x),false);
 for(const raw of ["{","x".repeat(18001),'[{}]',JSON.stringify([record,record])]){
  const s=mem();s.setItem(KEY,raw);
  assert.equal(read(s).available,false);
  assert.equal(save(s,record),false);
 }
 assert.equal(read(null).available,false);
 assert.equal(save(null,record),false);
 const denied={getItem(){throw Error("denied")},setItem(){throw Error("denied")}};
 assert.equal(read(denied).available,false);
 assert.equal(save(denied,record),false);
});
test("real Staff UI checkpoints before HTTP and locks uncertain commands, validates exact receipt",()=>{
 const ui=readFileSync(resolve(root,"app/team/work-queue/WorkActionControl.tsx"),"utf8");
 for(const term of ["readPendingWork(tabStore())","savePendingWork(tabStore()",
 "clearPendingWork(tabStore(),itemId,pending.current.nonce)",
 "disabled={busy||uncertain||!recoveryReady}",
 "setUncertain(true)","isVerifiedWorkReceipt(body,{action,itemId,nonce:pending.current.nonce,expectedRevision:revision})"]){
  assert.ok(ui.includes(term),term);
 }
 assert.ok(ui.indexOf("savePendingWork(tabStore()")<ui.indexOf('fetch("/api/work-transitions"'));
 assert.ok(ui.indexOf("clearPendingWork(tabStore()")>ui.indexOf("result.json()"));
});
process.on("exit",()=>rmSync(tmp,{recursive:true,force:true}));
