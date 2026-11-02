import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {normalizeScopedAarohiTask} from "../../../contracts/vox/aarohiTaskInput.mjs";
const root=new URL("../../../",import.meta.url);
const read=p=>readFileSync(new URL(p,root),"utf8");
const sql=read("ops/vox/sql-candidates/20261018050000_vox_ab7b_aarohi_task_atomic_candidate.sql");
const route=read("app/api/vox/v1/aarohi-task/route.ts");
const actor="00000000-0000-4000-8000-000000000001";
const prospect="00000000-0000-4000-8000-000000000011";
const nonce="00000000-0000-4000-8000-000000000050";
const scope={userId:actor,teamId:"00000000-0000-4000-8000-000000000005",
 cityId:"00000000-0000-4000-8000-000000000004",
 role:"acquisition_agent",canReadContent:true,prospectIds:[prospect]};
const now=Date.UTC(2026,9,18);
const input={prospectId:prospect,nonce,priority:"NORMAL",dueAt:new Date(now+86400000).toISOString()};
test("narrow Aarohi task accepts only current acquisition Staff with assigned prospect",()=>{
 assert.equal(normalizeScopedAarohiTask(input,scope,now)?.prospectId,prospect);
 for(const role of ["support_agent","operations_manager","auditor","team_leader"])
  assert.equal(normalizeScopedAarohiTask(input,{...scope,role},now),null);
 assert.equal(normalizeScopedAarohiTask(input,{...scope,prospectIds:[]},now),null);
 assert.equal(normalizeScopedAarohiTask(input,{...scope,canReadContent:false},now),null);
});
test("forged actor, team, role, outbound content and unknown fields rejected",()=>{
 for(const key of ["actorId","teamId","cityId","message","phone","externalProvider","reason","taskType"]){
  assert.equal(normalizeScopedAarohiTask({...input,[key]:"forged"},scope,now),null,key);
 }
 assert.equal(normalizeScopedAarohiTask({...input,priority:"URGENT"},scope,now),null);
 assert.equal(normalizeScopedAarohiTask({...input,nonce:"bad"},scope,now),null);
});
test("due date is bounded and receipt cannot be user-provided",()=>{
 assert.equal(normalizeScopedAarohiTask({...input,dueAt:new Date(now+299999).toISOString()},scope,now),null);
 assert.equal(normalizeScopedAarohiTask({...input,dueAt:new Date(now+31*86400000).toISOString()},scope,now),null);
 assert.equal(normalizeScopedAarohiTask({...input,dueAt:"invalid"},scope,now),null);
});
test("feature flag default deny, AAL2 scoped principal, exact receipt, no fallback",()=>{
 for(const s of ["VOX_AAROHI_INTERNAL_TASKS_ENABLED","VOX_AAROHI_ATOMIC_AUDIT_ENABLED",
  "VOX_DEPARTMENT_ENFORCEMENT_ENABLED","getVerifiedScopedStaff","normalizeScopedAarohiTask",
  "qf_vox_ab7b_aarohi_task_atomic_candidate_v1","source_event_id!==receipt.task_id",
  "provider_messages_sent!==0"]) assert.ok(route.includes(s),s);
 assert.ok(!route.includes("createAarohiTask("));
 assert.ok(!route.includes(".from(\"aarohi_tasks\")"));
});
test("native original Aarohi tables and immutable source share one SQL function",()=>{
 for(const s of ["for update","public.aarohi_prospects","public.aarohi_tasks",
  "public.aarohi_events","public.vox_ab7b_native_source_actions_candidate_v1",
  "v_task,'CRM_AAROHI'","p_nonce","AB7B_AAROHI_PROSPECT_DENIED",
  "AB7B_AAROHI_STAFF_NOT_CURRENT","from public,anon,authenticated"])
  assert.ok(sql.toLowerCase().includes(s.toLowerCase()),s);
 assert.ok(!sql.includes("http"));
 assert.ok(!sql.includes("whatsapp"));
});
