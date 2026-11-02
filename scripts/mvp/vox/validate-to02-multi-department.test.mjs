import test from "node:test";
import assert from "node:assert/strict";
import {departmentPacks,prepareStaffCapabilityRequest,previewApprovedCapabilities} from "../../../contracts/vox/staffDepartmentPacks.mjs";

const id=(n)=>"00000000-0000-4000-8000-"+String(n).padStart(12,"0");
const now=1792070400000;
const admin={userId:id(1),verifiedByCore:true,aal:"aal2",profileRole:"admin",adminRole:"Superadmin",isActive:true};
const staff={userId:id(2),verifiedByCore:true,aal:"aal2",profileRole:null,principal:"vox_staff",adminRole:null,isActive:true};
const team={teamId:id(3),cityId:id(4),isActive:true,memberUserId:staff.userId};
const request={nonce:id(5),targetId:staff.userId,teamId:team.teamId,cityId:team.cityId,
 reason:"Assign client and vendor support within approved city",expiresAtMs:now+86400000,
 packs:["vendor_success","client_success"]};
const args={environment:"staging",admin,target:staff,team,request,nowMs:now};
const grant=pack=>({targetId:staff.userId,teamId:team.teamId,cityId:team.cityId,
 pack,requestedBy:admin.userId,reviewedBy:id(6),activatedBy:admin.userId,
 status:"ACTIVE",revokedAt:null,leaseUntilMs:now+86400000,revision:2});
test("four stable capability packs have no admin or Team Leader privileges",()=>{
 assert.deepEqual(departmentPacks.map(x=>x.key).sort(),["acquisition","client_success","service_support","vendor_success"]);
 assert.equal(departmentPacks.every(x=>!x.sourceKinds.includes("admin")),true);
});
test("one staff can request several capability packs without separate login",()=>{
 const value=prepareStaffCapabilityRequest(args);
 assert.equal(value.ok,true);
 assert.equal(value.targetId,staff.userId);
 assert.deepEqual(value.capabilities.map(x=>x.key),["client_success","vendor_success"]);
 assert.equal(value.mutationsAuthorized,false);
 assert.equal(value.requiresSeparateTeamLeaderReview,true);
 assert.equal(value.requiresAtomicCoreActivation,true);
 assert.equal(value.mayGrantAdmin,false);
});
test("default release denies non-staging requests",()=>{
 assert.equal(prepareStaffCapabilityRequest({...args,environment:"production"}).ok,false);
 assert.equal(prepareStaffCapabilityRequest({...args,environment:undefined}).ok,false);
});
test("only verified Core owner with AAL2 may prepare request",()=>{
 const bad=[{...admin,verifiedByCore:false},{...admin,aal:"aal1"},
  {...admin,adminRole:"Admin"},{...admin,profileRole:null},{...admin,isActive:false},
  {...admin,userId:"fake"}];
 for(const actor of bad)assert.equal(prepareStaffCapabilityRequest({...args,admin:actor}).ok,false);
});
test("neutral Core staff cannot receive Admin role through a capability pack",()=>{
 for(const target of [{...staff,profileRole:"admin"},{...staff,principal:"vendor"},
  {...staff,adminRole:"Superadmin"},{...staff,isActive:false},{...staff,userId:admin.userId}])
   assert.equal(prepareStaffCapabilityRequest({...args,target}).ok,false);
 for(const packs of [["admin"],["superadmin"],["team_leader"],["finance"],
    ["client_success","client_success"],[],["vendor_success","unknown"]])
   assert.equal(prepareStaffCapabilityRequest({...args,request:{...request,packs}}).ok,false);
});
test("every request binds exact target team and city",()=>{
 for(const modified of [{targetId:id(7)},{teamId:id(7)},{cityId:id(7)},{nonce:"invalid"}])
  assert.equal(prepareStaffCapabilityRequest({...args,request:{...request,...modified}}).ok,false);
 assert.equal(prepareStaffCapabilityRequest({...args,team:{...team,isActive:false}}).ok,false);
});
test("lease and audit reason must be well formed",()=>{
 for(const ms of [now-1,now+1000,now+31*86400000])
  assert.equal(prepareStaffCapabilityRequest({...args,request:{...request,expiresAtMs:ms}}).ok,false);
 for(const reason of ["short","", " ".repeat(20)])
  assert.equal(prepareStaffCapabilityRequest({...args,request:{...request,reason}}).ok,false);
});
test("approved capability projection is still not Core authority",()=>{
 const out=previewApprovedCapabilities({identity:staff,team,rows:[grant("vendor_success"),grant("client_success")],nowMs:now});
 assert.equal(out.ok,true);
 assert.deepEqual(out.packs.map(x=>x.key),["client_success","vendor_success"]);
 assert.equal(out.mayMutate,false);
 assert.equal(out.mayElevateToAdmin,false);
 assert.equal(out.requiresSeparateObjectScope,true);
});
test("inactive, different city and revoked grants are denied",()=>{
 for(const modified of [{teamId:id(8)},{cityId:id(8)},{targetId:id(8)},
  {revokedAt:now-1},{leaseUntilMs:now},{status:"PENDING"},{revision:1},
  {requestedBy:id(6)},{reviewedBy:admin.userId},
  {activatedBy:id(6)},{pack:"admin"}]){
  const p=previewApprovedCapabilities({identity:staff,team,rows:[{...grant("client_success"),...modified}],nowMs:now});
  assert.equal(p.ok,true);assert.equal(p.packs.length,0,JSON.stringify(modified));
 }
});
test("AAL1, non-neutral, disabled team and cross-member are denied",()=>{
 for(const identity of [{...staff,aal:"aal1"},{...staff,verifiedByCore:false},
  {...staff,profileRole:"admin"},{...staff,principal:"vendor"}])
  assert.equal(previewApprovedCapabilities({identity,team,rows:[],nowMs:now}).ok,false);
 for(const t of [{...team,isActive:false},{...team,memberUserId:id(8)}])
  assert.equal(previewApprovedCapabilities({identity:staff,team:t,rows:[],nowMs:now}).ok,false);
});
test("bounded and duplicate grants never multiply effective permissions",()=>{
 const g=grant("vendor_success");
 const q=previewApprovedCapabilities({identity:staff,team,rows:[g,g],nowMs:now});
 assert.equal(q.packs.length,1);
 assert.equal(previewApprovedCapabilities({identity:staff,team,rows:Array(5).fill(g),nowMs:now}).ok,false);
});
test("all legitimate departments require explicit core object and current staff access",()=>{
 for(const pack of departmentPacks)assert.ok(pack.sourceKinds.length>0);
 const p=prepareStaffCapabilityRequest({...args,request:{...request,packs:departmentPacks.map(x=>x.key)}});
 assert.equal(p.ok,true);
 assert.equal(p.capabilities.every(x=>x.requiresObjectGrant===true&&x.active===false),true);
});
