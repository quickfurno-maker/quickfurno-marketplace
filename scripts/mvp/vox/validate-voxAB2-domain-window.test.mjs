import test from "node:test";
import assert from "node:assert/strict";
import {projectVerifiedDomainWindow as project}
 from "../../../contracts/vox/ab2ScopedDomainWindow.mjs";
const id=n=>"00000000-0000-4000-8000-"+String(n).padStart(12,"0");
const scope={userId:id(1),teamId:id(2),cityId:id(3),currentAal:"aal2",
 canReadContent:true,canMutate:false,verifiedDepartments:["acquisition"]};
const item={id:id(4),kind:"prospect",revision:2,state:"ASSIGNED",
 updatedAt:"2026-10-17T12:30:00Z",canChange:false,canSend:false};
const source={ok:true,mode:"READ_ONLY",actionsEnabled:false,items:[item]};
const params=()=>({scope,source,department:"acquisition",
 verifyCurrentScope:async()=>true,verifySource:async()=>true,
 verifyExactObjectGrant:async()=>true});
test("AB2 acquisition-only has its own bounded work lane, not Riya access",async()=>{
 const r=await project(params());assert.equal(r.ok,true);
 assert.equal(r.items.length,1);assert.equal(r.totalKnown,false);
 assert.equal(r.nextPageAuthorized,false);assert.equal(r.canSend,false);
 assert.equal(JSON.stringify(r).includes("phone"),false);
});
test("AB2 denies vendor, client and cross-team items in acquisition window",async()=>{
 for(const kind of ["vendor","client","support_thread"]){
  const r=await project({...params(),source:{...source,items:[{...item,kind}]}});
  assert.equal(r.ok,false);assert.equal(r.items.length,0);
 }
});
test("AB2 cannot gain scope by changing a client-supplied department",async()=>{
 for(const department of ["client_success","vendor_success","service_support","admin"]){
  const r=await project({...params(),department});
  assert.equal(r.ok,false);assert.equal(r.items.length,0);
 }
});
test("AB2 rejects stale grants, source verification and revoked object",async()=>{
 for(const key of ["verifyCurrentScope","verifySource","verifyExactObjectGrant"]){
  const r=await project({...params(),[key]:async()=>false});
  assert.equal(r.ok,false);
 }
});
test("AB2 bracketed scope prevents revocation after object check",async()=>{
 let reads=0;
 const r=await project({...params(),
  verifyCurrentScope:async()=>++reads===1});
 assert.equal(reads,2);assert.equal(r.ok,false);
});
test("AB2 rejects forged capability, duplicate and unbounded data",async()=>{
 for(const patch of [
  {scope:{...scope,currentAal:"aal1"}},
  {scope:{...scope,verifiedDepartments:[]}},
  {source:{...source,items:[item,item]}},
  {source:{...source,items:[{...item,canSend:true}]}},
  {maxItems:26}
 ]){
  const r=await project({...params(),...patch});assert.equal(r.ok,false);
 }
});
