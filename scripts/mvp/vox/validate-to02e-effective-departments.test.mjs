import test from "node:test";
import assert from "node:assert/strict";
import {restrictScopedStaffByDepartment as restrict} from "../../../contracts/vox/effectiveDepartments.mjs";
const id=n=>"00000000-0000-4000-8000-"+String(n).padStart(12,"0");
const now=1792080000000;
const future=new Date(now+86400000).toISOString();
const scoped={userId:id(1),teamId:id(2),cityId:id(3),role:"operations_manager",
 prospectIds:[id(10)],vendorIds:[id(11)],supportThreadIds:[id(12)],
 conversationIds:[id(13)],canReadContent:true,canMutate:false};
const mk=n=>{
 const rid=id(20+n),capid=id(40+n),reviewer=id(70+n);
 const department=["acquisition","vendor_success","service_support","client_success"][n];
 return {
  grant:{id:capid,request_id:rid,auth_user_id:scoped.userId,team_id:scoped.teamId,
   city_id:scoped.cityId,department,granted_by:id(100),expires_at:future,revoked_at:null,revision:2},
  request:{id:rid,target_staff_id:scoped.userId,team_id:scoped.teamId,city_id:scoped.cityId,
   department,requested_by:id(100),decided_by:reviewer,decision_reference:"VALID_REVIEW_REF",
   state:"APPROVED",revision:1,expires_at:future},
  decision:{request_id:rid,reviewer_id:reviewer,decision:"APPROVED",decision_reference:"VALID_REVIEW_REF"},
  activation:{request_id:rid,capability_id:capid,activated_by:id(100)}
 };
};
function input(packs=[0,1,2,3]){
 const x=packs.map(mk);
 return {scoped,capabilities:x.map(y=>y.grant),requests:x.map(y=>y.request),
  decisions:x.map(y=>y.decision),activations:x.map(y=>y.activation),now};
}
test("one staff can hold several approved packs but never gains new subject IDs",()=>{
 const r=restrict(input());assert.ok(r);
 assert.deepEqual(r.prospectIds,scoped.prospectIds);
 assert.deepEqual(r.vendorIds,scoped.vendorIds);
 assert.deepEqual(r.supportThreadIds,scoped.supportThreadIds);
 assert.deepEqual(r.conversationIds,[]);assert.equal(r.canMutate,false);
});
test("no grant, preview only; no external inbox without separate consent proof",()=>{
 const r=restrict(input([]));assert.ok(r);
 for(const key of ["prospectIds","vendorIds","supportThreadIds","conversationIds"])
  assert.deepEqual(r[key],[]);
});
test("pack intersections work independently",()=>{
 const acquisition=restrict(input([0]));
 assert.deepEqual(acquisition.prospectIds,scoped.prospectIds);
 assert.deepEqual(acquisition.vendorIds,[]);
 const vendor=restrict(input([1]));
 assert.deepEqual(vendor.prospectIds,[]);
 assert.deepEqual(vendor.vendorIds,scoped.vendorIds);
 assert.deepEqual(vendor.supportThreadIds,[]);
 const support=restrict(input([2]));
 assert.deepEqual(support.vendorIds,scoped.vendorIds);
 assert.deepEqual(support.supportThreadIds,scoped.supportThreadIds);
 const client=restrict(input([3]));
 assert.deepEqual(client.prospectIds,[]);
 assert.deepEqual(client.conversationIds,[]);
});
test("team leader, auditor remain metadata-only despite incorrectly assigned packs",()=>{
 for(const role of ["team_leader","auditor"]){
  const data=input();data.scoped={...scoped,role};
  const r=restrict(data);assert.ok(r);
  assert.equal(r.canReadContent,false);
  for(const key of ["prospectIds","vendorIds","supportThreadIds","conversationIds"])
   assert.deepEqual(r[key],[]);
 }
});
test("tampered, stale and cross-boundary grants and approvals fail entire result",()=>{
 const changes=[
  ["grant","team_id",id(999)],["grant","city_id",id(999)],
  ["grant","auth_user_id",id(999)],["grant","revoked_at",new Date(now-1000).toISOString()],
  ["grant","expires_at",new Date(now-1000).toISOString()],
  ["grant","revision",3],["grant","department","admin"],
  ["grant","granted_by",id(999)],["request","state","PENDING"],
  ["request","target_staff_id",id(999)],["request","decided_by",id(100)],
  ["request","expires_at",new Date(now-1000).toISOString()],
  ["decision","decision","REJECTED"],["decision","reviewer_id",id(999)],
  ["activation","activated_by",id(999)],["activation","request_id",id(999)]
 ];
 for(const [key,field,value] of changes){
  const data=input([0]);const arr={grant:"capabilities",request:"requests",
   decision:"decisions",activation:"activations"}[key];
  data[arr][0]={...data[arr][0],[field]:value};
  assert.equal(restrict(data),null,key+"."+field);
 }
});
test("missing/doubled proof, malformed datasets, large sets fail closed",()=>{
 for(const field of ["requests","decisions","activations"]){
  const x=input([0]);x[field]=[];assert.equal(restrict(x),null);
 }
 const a=input([0]);a.capabilities.push(a.capabilities[0]);assert.equal(restrict(a),null);
 assert.equal(restrict({...input(),scoped:{...scoped,userId:"invalid"}}),null);
 assert.equal(restrict({...input(),scoped:{...scoped,prospectIds:["bad"]}}),null);
 assert.equal(restrict({...input(),now:0}),null);
 assert.equal(restrict({...input(),capabilities:Array(17).fill(mk(0).grant)}),null);
});
