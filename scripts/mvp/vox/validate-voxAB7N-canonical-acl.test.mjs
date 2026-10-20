import test from "node:test";import assert from "node:assert/strict";
import {inspectAb7nCanonicalCoreAcls as check,ab7nCanonicalCoreNames as names}
 from "../../../contracts/vox/ab7nCanonicalCoreAclBaseline.mjs";
const now=Date.now();
const spec=()=>({environment:"staging",projectRef:"uckafzuochmbvtiodmcl",
 now,readAtMs:now-100,rows:names.map(relname=>({
 relname,owner:"postgres",rls:true,forceRls:false,
 anonSelect:false,anonInsert:false,authSelect:relname==="profiles",
 authInsert:false,authUpdate:false,authDelete:false,serviceSelect:true}))});
test("AB7N actual 5 Core table managed grants have exact read-only baseline, no install power",()=>{
 const x=check(spec());assert.equal(x.ok,true,x.reason);
 assert.equal(x.canApplyMigrations,false);assert.equal(x.forceRlsOnLegacyCoreTables,false);
});
test("AB7N schema, anon leak, browser write, excessive profile read and stale checks fail",()=>{
 for(const patch of [
 {readAtMs:now-61000},{projectRef:"production"},
 {rows:spec().rows.slice(1)},
 {rows:spec().rows.map((r,i)=>i===0?{...r,authInsert:true}:r)},
 {rows:spec().rows.map((r,i)=>i===1?{...r,anonSelect:true}:r)},
 {rows:spec().rows.map((r,i)=>i===4?{...r,authSelect:false}:r)},
 {rows:spec().rows.map((r,i)=>i===2?{...r,forceRls:true}:r)}
 ]){const x=check({...spec(),...patch});assert.equal(x.ok,false,x.reason);}
});
