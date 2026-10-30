import test from "node:test";import assert from "node:assert/strict";
import {readFileSync,readdirSync} from "node:fs";
import {fileURLToPath} from "node:url";import {dirname,resolve} from "node:path";
import {inspectAb7kFullVoxSources} from "../../../contracts/vox/ab7kFullMigrationManifest.mjs";
// Issue #444: CORE_CONVERSATION must stay BLOCKED at the source writer until a
// canonical consent source AND a canonical staff_role are bound by a reviewed decision.
const root=resolve(dirname(fileURLToPath(import.meta.url)),"../../..");
const read=p=>readFileSync(resolve(root,p),"utf8");
const stripComments=s=>s.replace(/--[^\n]*/g,"");
const SQL_PATH="ops/vox/sql-candidates/20261018020000_vox_ab7b_nonwork_native_source_candidate.sql";
const sql=stripComments(read(SQL_PATH));
const canonicalRoles=(()=>{
 const m=/staff_role in \(([^)]*)\)/.exec(stripComments(read(
  "ops/vox/quarantined-migrations/legacy-20261014/20261014050000_vox_v1_team_leader_review_policy.sql")));
 assert.ok(m,"canonical staff_role CHECK not found");
 return m[1].split(",").map(x=>x.trim().replace(/'/g,""));
})();
test("canonical staff_role set is the six reviewed roles",()=>{
 assert.deepEqual([...canonicalRoles].sort(),["acquisition_agent","auditor",
  "operations_manager","support_agent","team_leader","vendor_success_agent"]);
});
test("AB7B SQL no longer references the nonexistent consent relation or role",()=>{
 assert.equal(/vox_ab7b_current_consent_candidate_v1/i.test(sql),false);
 assert.equal(/client_success_agent/i.test(sql),false);
 assert.equal(/'client_success'/i.test(sql),false);
 assert.equal(/AB7B_CONVERSATION_CONSENT_REQUIRED/.test(sql),false);
});
test("AB7B SQL only maps source roles that exist in the canonical CHECK",()=>{
 const fn=/qf_vox_ab7b_native_source_guard_candidate_v1\(\)[\s\S]*?\$\$;/.exec(sql)[0];
 const roles=[...fn.matchAll(/then '([a-z_]+_agent)'/g)].map(m=>m[1]);
 assert.deepEqual(roles.sort(),["acquisition_agent","support_agent"]);
 for(const r of roles)assert.ok(canonicalRoles.includes(r),r);
});
test("CORE_CONVERSATION is blocked in guard BEFORE any staff lookup, and by table CHECK",()=>{
 const fn=/qf_vox_ab7b_native_source_guard_candidate_v1\(\)[\s\S]*?\$\$;/.exec(sql)[0];
 const block=fn.indexOf("AB7B_CORE_CONVERSATION_BLOCKED");
 assert.ok(block>0);
 assert.ok(block<fn.indexOf("select m.auth_user_id"),"block must precede staff lookup");
 assert.match(fn,/new\.source not in \('CRM_AAROHI','SUPPORT_DESK'\)/);
 assert.match(sql,/constraint vox_ab7b_core_conversation_blocked check\(source<>'CORE_CONVERSATION'\)/);
});
test("role grant, RLS and privileges are not weakened",()=>{
 assert.match(sql,/enable row level security/);assert.match(sql,/force row level security/);
 assert.match(sql,/revoke all on public\.vox_ab7b_native_source_actions_candidate_v1\s+from public,anon,authenticated/);
 assert.match(sql,/grant select,insert on public\.vox_ab7b_native_source_actions_candidate_v1\s+to service_role/);
 const grantees=[...sql.matchAll(/\bgrant\b[^;]*?\bto\s+([a-z_,]+)\s*;/gi)].map(m=>m[1]);
 assert.deepEqual(grantees,["service_role"]);
 for(const needle of ["m.revoked_at is null","m.expires_at>clock_timestamp()",
  "g.revoked_at is null","c.revoked_at is null","t.city_id=new.city_id","p.role is null"])
  assert.ok(sql.includes(needle),needle);
});
test("no AB7B PG17 fixture fabricates the consent relation or the non-canonical role",()=>{
 const dir=resolve(root,"scripts/mvp/vox");
 const files=readdirSync(dir).filter(n=>/^validate-voxAB7B-.*\.ps1$/.test(n));
 assert.ok(files.length>=4);
 for(const f of files){
  const t=read("scripts/mvp/vox/"+f);
  assert.equal(/vox_ab7b_current_consent_candidate_v1\s*\(/i.test(t.replace(/Denied[^\n]*\n/g,"")),false,f);
  assert.equal(/'client_success_agent'/.test(t),false,f);
 }
});
test("canonical consent evidence is destination-hash + channel + scope, not per-conversation",()=>{
 const conv=read("supabase/migrations/20260918120000_whatsapp_conversational_jarvis_foundation.sql");
 const body=/create table public\.communication_conversations \(([\s\S]*?)\n\);/.exec(conv)[1];
 assert.equal(/consent|opt_?in|allowed/i.test(body.replace(/jarvis_enabled/g,"")),false,
  "conversation row carries no consent column");
 assert.match(body,/destination_hash text not null/);
 const supp=read("supabase/migrations/20260709000100_messaging_channel_provider_foundation.sql");
 assert.match(supp,/scope in \('marketing', 'transactional', 'global'\)/);
 const svc=read("services/outboundConsentEnforcementService.ts");
 assert.match(svc,/NEVER reads communication_suppressions or communication_preferences directly/);
});
test("manifest inventory keeps 7+23 ordered files (digest pin is regenerated separately)",()=>{
 const a=inspectAb7kFullVoxSources(root);
 assert.equal(a.ok,true,a.reason);assert.equal(a.totalFiles,30);
 const i=n=>a.files.findIndex(x=>x.path.endsWith(n));
 assert.equal(i("20261018020000_vox_ab7b_nonwork_native_source_candidate.sql"),20);
 assert.equal(a.canApply,false);assert.equal(a.releaseReady,false);
});
