import test from "node:test";
import assert from "node:assert/strict";
import {build} from "esbuild";
import {mkdtempSync,rmSync} from "node:fs";
import {join,dirname,resolve} from "node:path";
import {tmpdir} from "node:os";
import {fileURLToPath,pathToFileURL} from "node:url";
const root=resolve(dirname(fileURLToPath(import.meta.url)),"../../..");
const folder=mkdtempSync(join(tmpdir(),"rc78-work-"));
const out=join(folder,"work.mjs");
await build({entryPoints:[resolve(root,"apps/vox-web/lib/rc66PendingWorkTransition.ts")],outfile:out,platform:"node",format:"esm",target:"node24",logLevel:"silent"});
const {savePendingWork,clearPendingWork,readPendingWork}=await import(pathToFileURL(out).href);
const ids=["11111111-1111-4111-8111-111111111111","22222222-2222-4222-8222-222222222222","33333333-3333-4333-8333-333333333333"];
const make=i=>({itemId:ids[i],nonce:ids[i],action:"CLAIM",expectedRevision:0,reason:""});
const memory=()=>{const db=new Map();return {getItem:k=>db.get(k)??null,setItem:(k,v)=>db.set(k,v)};};
test("checkpoint must retain ALL previously pending Core work records, not only new nonce",()=>{
 const storage=memory();assert.equal(savePendingWork(storage,make(0)),true);
 const tamper={...storage,setItem:(key,value)=>{const changed=JSON.parse(value);changed[0]=make(2);storage.setItem(key,JSON.stringify(changed));}};
 assert.equal(savePendingWork(tamper,make(1)),false);
 assert.equal(readPendingWork(storage).records.some(x=>x.itemId===ids[0]),false);
});
test("clearing one verified Core receipt cannot silently alter a sibling pending nonce",()=>{
 const storage=memory();assert.equal(savePendingWork(storage,make(0)),true);assert.equal(savePendingWork(storage,make(1)),true);
 const tamper={...storage,setItem:(key,value)=>{const changed=JSON.parse(value);changed[0]=make(2);storage.setItem(key,JSON.stringify(changed));}};
 assert.equal(clearPendingWork(tamper,ids[0],ids[0]),false);
});
test("honest storage still supports parallel original nonces and exact receipt cleanup",()=>{
 const s=memory();assert.equal(savePendingWork(s,make(0)),true);assert.equal(savePendingWork(s,make(1)),true);
 assert.equal(clearPendingWork(s,ids[0],ids[0]),true);
 assert.deepEqual(readPendingWork(s).records,[make(1)]);
});
process.on("exit",()=>rmSync(folder,{recursive:true,force:true}));
