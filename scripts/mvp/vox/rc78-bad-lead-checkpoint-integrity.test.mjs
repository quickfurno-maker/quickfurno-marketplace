import test from "node:test";
import assert from "node:assert/strict";
import {build} from "esbuild";
import {mkdtempSync,rmSync} from "node:fs";
import {join,dirname,resolve} from "node:path";
import {tmpdir} from "node:os";
import {fileURLToPath,pathToFileURL} from "node:url";
const root=resolve(dirname(fileURLToPath(import.meta.url)),"../../..");
const folder=mkdtempSync(join(tmpdir(),"rc78-finance-"));
const out=join(folder,"finance.mjs");
await build({entryPoints:[resolve(root,"lib/vox/badLeadReviewCheckpoint.ts")],outfile:out,bundle:true,platform:"node",format:"esm",target:"node24",logLevel:"silent"});
const {markBadLeadPending,clearBadLeadPending,readBadLeadReviewCheckpoint}=await import(pathToFileURL(out).href);
const ids=["11111111-1111-4111-8111-111111111111","22222222-2222-4222-8222-222222222222","33333333-3333-4333-8333-333333333333"];
const memory=()=>{const m=new Map();return {getItem:k=>m.get(k)??null,setItem:(k,v)=>m.set(k,v)};};
test("no additional bad-lead status or credit decision when storage replaced a different pending original",()=>{
 const store=memory();assert.equal(markBadLeadPending(store,ids[0]),true);
 const tamper={...store,setItem:(k,v)=>{const arr=JSON.parse(v);const i=arr.indexOf(ids[0]);if(i>=0)arr[i]=ids[2];store.setItem(k,JSON.stringify(arr));}};
 assert.equal(markBadLeadPending(tamper,ids[1]),false);
});
test("no successful clear if a different original bad-lead checkpoint is lost",()=>{
 const store=memory();assert.equal(markBadLeadPending(store,ids[0]),true);assert.equal(markBadLeadPending(store,ids[1]),true);
 const tamper={...store,setItem:(k,v)=>{const arr=JSON.parse(v);const i=arr.indexOf(ids[1]);if(i>=0)arr[i]=ids[2];store.setItem(k,JSON.stringify(arr));}};
 assert.equal(clearBadLeadPending(tamper,ids[0]),false);
});
test("normal one LEAD credit review checkpoint remains unchanged and never grants money",()=>{
 const s=memory();assert.equal(markBadLeadPending(s,ids[0]),true);assert.equal(markBadLeadPending(s,ids[1]),true);
 assert.equal(clearBadLeadPending(s,ids[0]),true);assert.deepEqual([...readBadLeadReviewCheckpoint(s).locked],[ids[1]]);
});
process.on("exit",()=>rmSync(folder,{recursive:true,force:true}));
