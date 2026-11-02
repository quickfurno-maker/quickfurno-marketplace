import test from "node:test";
import assert from "node:assert/strict";
import {getAuthenticatedDomainWork} from "../../../contracts/vox/ab3DomainHttp.mjs";
const id=n=>"00000000-0000-4000-8000-"+String(n).padStart(12,"0");
const request=new Request("https://core.quickfurno.invalid/api/vox/v1/ab3-domain-work");
const scope={userId:id(1),teamId:id(2),cityId:id(3),
 role:"acquisition_agent",currentAal:"aal2",canReadContent:true,
 canMutate:false,verifiedDepartments:["acquisition"]};
const row=(kind,n)=>({workItemId:id(n),kind,state:"ASSIGNED",
 revision:3,updatedAt:"2026-10-17T15:00:00Z",
 assignedToMe:true,canClaim:false,canTransition:false});
const source={ok:true,schema:"qf.vox.work.queue.preview.v1",
 mode:"READ_ONLY",actionsEnabled:false,boundedWindow:true,
 completeness:"BOUNDED_NOT_TOTAL",items:[row("prospect",4),row("vendor",5)]};
const res=(s=source,status=200)=>Response.json(s,{status,headers:{
 "cache-control":"private, no-store, max-age=0"}});
function options(){
 let readers=0,checks=0,scopes=0;
 return {get readers(){return readers},get checks(){return checks},get scopes(){return scopes},
  args:{request,scope,enabled:true,
  readProtectedWork:async()=>{readers++;return res()},
  verifyCurrentScope:async()=>{scopes++;return true},
  verifyCurrentWorkObject:async()=>{checks++;return true}}};
}
test("AB3 actual Core queue composer returns only acquisition canonical metadata",async()=>{
 const x=options(),r=await getAuthenticatedDomainWork(x.args);
 assert.equal(r.ok,true);assert.equal(x.readers,1);
 assert.equal(x.checks,1);assert.equal(x.scopes,3);
 assert.equal(r.items.length,1);assert.equal(r.items[0].kind,"prospect");
 assert.equal(r.nextPageAuthorized,false);assert.equal(r.actionsEnabled,false);
});
test("AB3 disabled route does not read protected source",async()=>{
 const x=options(),r=await getAuthenticatedDomainWork({...x.args,enabled:false});
 assert.equal(r.ok,false);assert.equal(x.readers,0);
});
test("AB3 denies unsupported methods, browser filters and other departments",async()=>{
 for(const [field,payload] of [
  ["request",new Request(request.url+"?team_id="+id(88))],
  ["request",new Request(request.url,{method:"POST"})],
  ["scope",{...scope,verifiedDepartments:["vendor_success"]}],
  ["scope",{...scope,role:"team_leader"}],
  ["scope",{...scope,currentAal:"aal1"}]
 ]){
  const x=options(),r=await getAuthenticatedDomainWork({...x.args,[field]:payload});
  assert.equal(r.ok,false);assert.equal(x.readers,0);
 }
});
test("AB3 object grant denial, current MFA revocation, and partial source denies all",async()=>{
 const bads=[
  {verifyCurrentWorkObject:async()=>false},
  {verifyCurrentScope:async()=>false},
  {readProtectedWork:async()=>res({ok:false},403)},
  {readProtectedWork:async()=>res({...source,actionsEnabled:true})},
  {readProtectedWork:async()=>Response.json(source,{headers:{
   "cache-control":"public, max-age=120"}})}
 ];
 for(const patch of bads){
  const x=options(),r=await getAuthenticatedDomainWork({...x.args,...patch});
  assert.equal(r.ok,false);assert.deepEqual(r.items,[]);
 }
});
test("AB3 vendor-only Staff sees vendor work, no prospect case",async()=>{
 const x=options(),r=await getAuthenticatedDomainWork({...x.args,
  scope:{...scope,role:"vendor_success_agent",verifiedDepartments:["vendor_success"]}});
 assert.equal(r.ok,true);assert.deepEqual(r.items.map(v=>v.kind),["vendor"]);
});
test("AB3 fails closed on forged queue content and oversized response",async()=>{
 for(const patch of [
  {items:[{...row("prospect",4),revision:-1}]},
  {items:new Array(200).fill(row("prospect",4))},
  {items:[{...row("prospect",4),phone:"+919999999999"}]}
 ]){
  const x=options(),r=await getAuthenticatedDomainWork({...x.args,
   readProtectedWork:async()=>res({...source,...patch})});
  if("phone" in (patch.items[0]||{})) {
   assert.equal(r.ok,true);assert.equal(JSON.stringify(r).includes("phone"),false);
  }else assert.equal(r.ok,false);
 }
});
