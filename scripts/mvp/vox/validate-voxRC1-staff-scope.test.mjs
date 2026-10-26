import test from "node:test";import assert from "node:assert/strict";
import {unchangedAuthorizedStaffScope as queue,unchangedNotificationScope as notice}
 from "../../../contracts/vox/rc1CurrentStaffScope.mjs";
const scope=()=>({userId:"u",teamId:"t",cityId:"c",role:"support_agent",
 canReadContent:true,canMutate:false,verifiedDepartments:["client_success"],
 prospectIds:["p"],vendorIds:["v"],supportThreadIds:["s"],conversationIds:["c"]});
test("RC1 permissions must be identical across original and fresh Core/Auth read",()=>{
 assert.equal(queue(scope(),scope()),true);assert.equal(notice(scope(),scope()),true);
 for(const change of [{teamId:"different"},{canReadContent:false},{role:"auditor"},
  {verifiedDepartments:[]},{prospectIds:[]},{vendorIds:["v","new"]},
  {supportThreadIds:["s","s"]},{conversationIds:["q"]}]){
  assert.equal(queue(scope(),{...scope(),...change}),false,JSON.stringify(change));
  assert.equal(notice(scope(),{...scope(),...change}),false,JSON.stringify(change));
 }
});
test("RC1 missing refreshed Auth never authorizes notifications or work",()=>{
 assert.equal(queue(scope(),null),false);assert.equal(notice(scope(),null),false);
 assert.equal(queue(null,scope()),false);assert.equal(notice(null,scope()),false);
});
