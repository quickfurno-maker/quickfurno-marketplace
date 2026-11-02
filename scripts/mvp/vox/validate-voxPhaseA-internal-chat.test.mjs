import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {canReadWriteTeamInternalChat as allowed} from "../../../contracts/vox/teamChatEligibility.mjs";
const u=n=>"00000000-0000-4000-8000-"+String(n).padStart(12,"0");
const tl={userId:u(1),teamId:u(2),cityId:u(3),
 role:"team_leader",canReadContent:false,canMutate:false,
 verifiedDepartments:[]};
const staff={...tl,role:"support_agent",canReadContent:true,
 verifiedDepartments:["service_support"]};
test("current restricted Team Leader can use ONLY separate flag",()=>{
 assert.equal(allowed({scope:tl,teamLeaderEnabled:false}),false);
 assert.equal(allowed({scope:tl,teamLeaderEnabled:true}),true);
 assert.equal(allowed({scope:{...tl,canReadContent:true},teamLeaderEnabled:true}),false);
});
test("global subject content remains denied to Team Leader",()=>{
 assert.equal(tl.canReadContent,false);
 assert.deepEqual(tl.verifiedDepartments,[]);
 assert.equal(allowed({scope:{...tl,role:"auditor"},teamLeaderEnabled:true}),false);
});
test("normal scoped Staff chat unaffected by independent TL flag",()=>{
 assert.equal(allowed({scope:staff,teamLeaderEnabled:false}),true);
 assert.equal(allowed({scope:staff,teamLeaderEnabled:true}),true);
});
test("unverified, expired or malformed scope cannot enter internal team room",()=>{
 for(const s of [
  null,{...tl,canMutate:true},{...tl,userId:"wrong"},
  {...tl,teamId:"foreign"},{...tl,cityId:null},
  {...tl,verifiedDepartments:null},
  {...staff,canReadContent:false},
  {...staff,role:"client_external"}
 ])assert.equal(allowed({scope:s,teamLeaderEnabled:true}),false);
});
test("only genuine existing HTTP route uses dedicated flag; no external dispatch",()=>{
 const src=readFileSync(new URL("../../../app/api/vox/v1/staff-chat/route.ts",import.meta.url),"utf8");
 assert.match(src,/VOX_TL_INTERNAL_CHAT_ENABLED/);
 assert.match(src,/getVerifiedScopedStaff/);
 assert.match(src,/qf_vox_staff_team_chat_send_candidate_v1/);
 assert.match(src,/staffPrivilegesChanged:false/);
 assert.doesNotMatch(src,/sendWhatsApp|whatsapp\.send|createUser/);
});
