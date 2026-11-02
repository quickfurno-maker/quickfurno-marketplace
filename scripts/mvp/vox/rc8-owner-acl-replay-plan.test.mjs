import test from "node:test";
import assert from "node:assert/strict";
import {createRc8OwnerAclReplayPlan} from "./rc8-owner-acl-replay-plan.mjs";
const t="vox_ab7j_staff_suspend_intents_candidate_v1";
const acl=["DELETE","INSERT","MAINTAIN","REFERENCES","SELECT","TRIGGER","TRUNCATE","UPDATE"]
 .map(x=>"postgres|postgres|"+x+"|false");
const a={owner:"postgres",acl_is_default:false,acl};
const b={owner:"postgres",acl_is_default:true,acl:[]};
const d={differingPaths:["$.relations."+t+".acl","$.relations."+t+".acl_is_default"]};
const base=()=>({source:{relations:{[t]:a}},restored:{relations:{[t]:b}},diff:d});
test("exact PostgreSQL owner ACL catalog diff generates only two statements",()=>{
 const plan=createRc8OwnerAclReplayPlan(base());
 assert.ok(plan);assert.equal(plan.owner,"postgres");
 assert.match(plan.sql,/^REVOKE ALL PRIVILEGES/);
 assert.match(plan.sql,/GRANT ALL PRIVILEGES/);
 assert.equal(plan.sql.split("\n").length,2);
 assert.doesNotMatch(plan.sql,/authenticated|anon|service_role/i);
});
test("unexpected ACL, owner, table or any extra diff fails closed",()=>{
 const v=base();
 const inputs=[
  {...v,diff:{differingPaths:[...d.differingPaths,"$.relations.other.acl"]}},
  {...v,source:{relations:{[t]:{...a,owner:"service_role"}}}},
  {...v,source:{relations:{[t]:{...a,acl:["postgres|anon|SELECT|false",...acl.slice(1)]}}}},
  {...v,source:{relations:{[t]:{...a,acl_is_default:true}}}},
  {...v,restored:{relations:{[t]:{...b,acl_is_default:false}}}},
  {...v,source:{relations:{[t]:{...a,acl:[]}}}},
  {...v,diff:{differingPaths:[d.differingPaths[0]]}},{}
 ];
 for(const x of inputs)assert.equal(createRc8OwnerAclReplayPlan(x),null);
});
