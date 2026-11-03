import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {projectVerifiedTlTaskHistory} from "../../../contracts/vox/virtualOfficeTlTaskHistory.mjs";
const id=n=>String(n).padStart(8,"0")+"-0000-4000-8000-000000000001";
const now=Date.parse("2026-11-03T12:00:00Z");
const members=[{staffId:id(1),teamId:id(11),cityId:id(12),
 role:"acquisition_agent",verifiedNeutralStaff:true},
 {staffId:id(2),teamId:id(11),cityId:id(12),
 role:"support_agent",verifiedNeutralStaff:true}];
const opts={leaderId:id(99),teamId:id(11),cityId:id(12),
 serverNowMs:now,rosterVerified:true,rowSourceVerified:true};
const record=(n=1,staffId=id(1))=>{
 const end=now-n*60000;
 return {closed_by_event_nonce:id(300+n),staff_id:staffId,
  team_id:id(11),city_id:id(12),work_item_id:id(80),
  started_at:new Date(end-20000).toISOString(),
  ended_at:new Date(end).toISOString(),
  elapsed_ms:20000,state_revision:n,closing_action:"TASK_STOP"};
};
test("VO10 TL sees real team-only reference intervals without source identity",()=>{
 const r=projectVerifiedTlTaskHistory(members,[record(1),record(2,id(2))],opts);
 assert.equal(r.ok,true,r.reason);assert.equal(r.entries.length,2);
 assert.equal(r.entries[0].staffRef,"STAFF-00000001");
 assert.equal(r.entries[1].staffRef,"STAFF-00000002");
 assert.equal(r.entries[0].workRef,"WORK-00000080");
 assert.equal(r.completeHistory,false);assert.equal(r.officialEod,false);
 assert.equal(r.attendanceVerified,false);assert.equal(r.payrollVerified,false);
 assert.equal(r.livePresence,false);assert.equal(r.providerMessagesSent,0);
 assert.equal("staffId" in r.entries[0],false);
 assert.equal("closed_by_event_nonce" in r.entries[0],false);
});
test("VO10 TL rejects foreign Staff, cross team/city, revoked role and unverified source",()=>{
 for(const src of [{...opts,rosterVerified:false},{...opts,rowSourceVerified:false}]){
  assert.equal(projectVerifiedTlTaskHistory(members,[record(1)],src).ok,false);
 }
 for(const x of [
  [{...members[0],role:"team_leader"}],
  [{...members[0],teamId:id(999)}],
  [{...members[0],verifiedNeutralStaff:false}],
  [{...members[0],staffId:opts.leaderId}]
 ]){
  assert.equal(projectVerifiedTlTaskHistory(x,[],opts).ok,false);
 }
 assert.equal(projectVerifiedTlTaskHistory(members,[record(1,id(888))],opts).ok,false);
 assert.equal(projectVerifiedTlTaskHistory(members,[{...record(1),city_id:id(99)}],opts).ok,false);
});
test("VO10 TL enforces immutable timestamps, original nonce and per-Staff revision",()=>{
 assert.equal(projectVerifiedTlTaskHistory(members,[record(1),record(1)],opts).ok,false);
 assert.equal(projectVerifiedTlTaskHistory(members,[
  record(1),{...record(2),state_revision:1}
 ],opts).ok,false);
 for(const bad of [{...record(1),elapsed_ms:999999},
  {...record(1),ended_at:new Date(now+30000).toISOString()},
  {...record(1),closing_action:"PAYROLL_WRITE"},
  {...record(1),privatePhone:"+919999999999"}]){
  assert.equal(projectVerifiedTlTaskHistory(members,[bad],opts).ok,false);
 }
 assert.equal(projectVerifiedTlTaskHistory(members,[record(2),record(1)],opts).ok,false);
});
test("VO10 TL bounded 21st interval only signals hasMore",()=>{
 const rows=Array.from({length:21},(_,i)=>record(i+1));
 const r=projectVerifiedTlTaskHistory(members,rows,opts);
 assert.equal(r.ok,true,r.reason);assert.equal(r.hasMore,true);
 assert.equal(r.entries.length,20);
 assert.equal(projectVerifiedTlTaskHistory(members,[...rows,record(22)],opts).ok,false);
});
test("VO10 TL Core and Web are independently AAL2 scoped, hard-disabled, no Staff selector",()=>{
 const core=readFileSync(new URL("../../../app/api/vox/v1/team-task-history/route.ts",import.meta.url),"utf8");
 const bff=readFileSync(new URL("../../../apps/vox-web/lib/teamTaskHistory.ts",import.meta.url),"utf8");
 const page=readFileSync(new URL("../../../apps/vox-web/app/team/shifts/page.tsx",import.meta.url),"utf8");
 assert.match(core,/VO10_MANAGED_TL_TASK_HISTORY_CERTIFIED=false as const/);
 assert.match(core,/getVerifiedScopedStaff\(auth\)/);
 assert.match(core,/latest!\.teamId!==tl!\.teamId/);
 assert.match(core,/\.eq\("team_id",tl!\.teamId\)/);
 assert.match(core,/\.eq\("city_id",tl!\.cityId\)/);
 assert.match(core,/TEAM_TASK_SCOPE_CHANGED/);
 assert.match(core,/new URL\(request\.url\)\.search/);
 assert.doesNotMatch(core,/request\.json\(\)|request\.text\(\)/);
 assert.match(bff,/verifiedMfaSession\(\)/);
 assert.match(bff,/x\.sourceVerified!==true/);
 assert.match(bff,/x\.completeHistory!==false/);
 assert.match(page,/fetchTeamTaskHistory\(\)/);
});
