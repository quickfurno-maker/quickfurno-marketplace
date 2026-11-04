import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const sql=readFileSync("supabase/migrations/20261104160000_vendor_owner_review_assignment_gate.sql","utf8");
const route=readFileSync("app/api/vox/v1/owner-vendor-verification-case/route.ts","utf8");
const executableRoute=route.replace(/\/\*[\s\S]*?\*\//g," ").replace(/^\s*\/\/.*$/gm,"");

test("B51 latest private verification case supersedes any historical approval",()=>{
  assert.match(sql,/c\.case_version=\(select max\(n\.case_version\)/);
  assert.match(sql,/c\.contact_status='verified'/);
  assert.match(sql,/c\.identity_status='verified'/);
  assert.match(sql,/c\.office_status='verified'/);
  assert.match(sql,/c\.category_status='verified'/);
  assert.match(sql,/c\.zone_status='verified'/);
  assert.match(sql,/consent\.revoked_at is null/);
  assert.match(sql,/identity_doc\.scan_status in \('clean','not_applicable'\)/);
  assert.match(sql,/office_doc\.scan_status='clean'/);
  assert.match(sql,/decision\.action='approve'/);
});

test("B52 Owner approval writes immutable audit and never vendor/credit mutations",()=>{
  assert.match(sql,/create or replace function public\.qf_owner_record_vendor_verification_decision/);
  assert.match(sql,/p_action is null or p_action not in/);
  assert.match(sql,/p_expected_case_version is null/);
  assert.match(sql,/c\.case_version is distinct from p_expected_case_version/);
  assert.match(sql,/p\.role='admin' and p\.is_active is true/);
  assert.match(sql,/a\.raw_app_meta_data->>'admin_role'='Superadmin'/);
  assert.match(sql,/pg_advisory_xact_lock/);
  assert.match(sql,/for update/);
  assert.match(sql,/update qf_vendor_private\.verification_cases/);
  assert.match(sql,/insert into qf_vendor_private\.verification_decisions/);
  assert.match(sql,/if p_action='approve'\s+and public\.qf_vendor_verification_case_ready/);
  assert.doesNotMatch(sql,/update public\.vendors|insert into public\.lead_assignments|update public\.vendor_credit/);
  assert.match(sql,/revoke all on function public\.qf_owner_record_vendor_verification_decision\(uuid,uuid,text,text\)\s+from public,anon,authenticated/);
});

test("B53 New lead assignments require verified case at the DB boundary",()=>{
  assert.match(sql,/create or replace function public\.qf_enforce_new_vendor_assignment_verification/);
  assert.match(sql,/if tg_op='INSERT' then/);
  assert.match(sql,/new\.vendor_id is distinct from old\.vendor_id/);
  assert.match(sql,/new\.lead_id is distinct from old\.lead_id/);
  assert.match(sql,/old\.lifecycle_status/);
  assert.match(sql,/public\.qf_vendor_verification_case_ready\(new\.vendor_id\) is not true/);
  assert.match(sql,/raise exception 'QF_VENDOR_ASSIGNMENT_VERIFICATION_REQUIRED'/);
  assert.match(sql,/before insert or update of vendor_id,lead_id,lifecycle_status\s+on public\.lead_assignments/);
  assert.doesNotMatch(sql,/update public\.lead_assignments|delete from public\.lead_assignments/);
});

test("B54 VOX Owner route is staging-OFF, bearer-AAL2, strict and no private documents",()=>{
  assert.match(route,/import "server-only"/);
  assert.match(route,/VOX_OWNER_VENDOR_CASE_REVIEW_ENABLED === "staging"/);
  assert.match(route,/verifyVoxOwnerBearer\(request\.headers\.get\("authorization"\)\)/);
  assert.match(route,/qf_vendor_owner_review_snapshot/);
  assert.match(route,/qf_owner_record_vendor_verification_decision/);
  assert.match(route,/keys\.join\(","\)!=="action,caseVersion,reasonCode,vendorId"/);
  assert.match(route,/p_reviewer_user_id:owner/);
  assert.match(route,/p_expected_case_version:body\.caseVersion/);
  assert.match(route,/private, no-store, max-age=0/);
  assert.match(route,/canViewPrivateDocuments:false/);
  assert.match(route,/requiresSeparateCoreVendorApproval:true/);
  assert.doesNotMatch(executableRoute,/\.storage\.|\.download\(|\.insert\(|\.update\(|\.delete\(|\.signInWithOtp\(/);
  for(const method of ["PUT","PATCH","DELETE"]) assert.ok(route.includes(`export function ${method}():Response`));
});

test("B55 SQL privacy and frontend cannot activate vendor by a case review",()=>{
  assert.match(sql,/grant execute on function public\.qf_vendor_owner_review_snapshot\(uuid\) to service_role/);
  assert.match(sql,/grant execute on function public\.qf_owner_record_vendor_verification_decision\(uuid,uuid,text,text\)\s+to service_role/);
  assert.doesNotMatch(sql,/grant execute on function public\.qf_owner_record_vendor_verification_decision.*to authenticated/);
  assert.doesNotMatch(route,/status:"Approved"|canActivateLeads:true|auth\.admin|NEXT_PUBLIC_SERVICE_ROLE/);
});
