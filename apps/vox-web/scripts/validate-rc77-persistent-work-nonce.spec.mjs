import test from "node:test";
import assert from "node:assert/strict";
import {build} from "esbuild";
import {mkdtempSync,rmSync} from "node:fs";
import {dirname,join,resolve} from "node:path";
import {tmpdir} from "node:os";
import {fileURLToPath,pathToFileURL} from "node:url";
const file=resolve(dirname(fileURLToPath(import.meta.url)),"../lib/rc66PendingWorkTransition.ts");
const tmp=mkdtempSync(join(tmpdir(),"rc77-work-nonce-"));
const output=join(tmp,"nonce.mjs");
await build({entryPoints:[file],outfile:output,platform:"node",format:"esm",
 target:"node24",logLevel:"silent"});
const {readPendingWork,savePendingWork,clearPendingWork}=await import(pathToFileURL(output).href);
const id="11111111-1111-4111-8111-111111111111",nonce="22222222-2222-4222-8222-222222222222";
const record={itemId:id,nonce,action:"CLAIM",expectedRevision:0,reason:""};
const store=()=>{const m=new Map();return {getItem:k=>m.get(k)??null,setItem:(k,v)=>m.set(k,v)};};
test("browser silently ignoring original nonce save never authorizes a Core request",()=>{
 const lost={getItem:()=>null,setItem:()=>{}};
 assert.equal(savePendingWork(lost,record),false);
 assert.deepEqual(readPendingWork(lost),{available:true,records:[]});
});
test("valid original nonce is persisted and replay-safe, cleanup requires verified readback",()=>{
 const s=store();
 assert.equal(savePendingWork(s,record),true);
 assert.deepEqual(readPendingWork(s).records,[record]);
 assert.equal(savePendingWork(s,{...record,nonce:id}),false);
 assert.equal(clearPendingWork({...s,setItem:()=>{}},id,nonce),false);
 assert.deepEqual(readPendingWork(s).records,[record]);
 assert.equal(clearPendingWork(s,id,nonce),true);
 assert.deepEqual(readPendingWork(s).records,[]);
});
test("corrupt browser storage and a tampering store cannot authorize a work action",()=>{
 const s={getItem:()=>"{\"tampered\":true}",setItem:()=>{}};
 assert.equal(savePendingWork(s,record),false);
 const trick={getItem:()=>JSON.stringify([{...record,nonce:id}]),setItem:()=>{}};
 assert.equal(savePendingWork(trick,record),false);
 assert.equal(clearPendingWork(trick,id,nonce),false);
});
process.on("exit",()=>rmSync(tmp,{recursive:true,force:true}));
