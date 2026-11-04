import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const src=path=>readFileSync(path,"utf8");
const sql=src("supabase/migrations/20261104170000_vox_owner_vendor_review_queue.sql");
const route=src("app/api/vox/v1/owner-vendor-verification-queue/route.ts");
const ui=src("components/vox/OwnerVendorVerificationDashboard.tsx");
const preflight=src("ops/vendor/vendor-launch-readonly-preflight-20261104.sql");
const strip=s=>s.replace(/\/\*[\s\S]*?\*\//g," ").replace(/^\s*\/\/.*$/gm," ");

test("B7-1 query uses latest pending Core case, bounded 20, no PII data fields",()=>{
 assert.match(sql,/create or replace function public\.qf_vox_owner_vendor_review_queue/);
 assert.match(sql,/c\.case_version=\(\s*select max\(latest\.case_version\)/);
 assert.match(sql,/c\.state in \('pending','documents_requested','under_review','needs_correction'\)/);
 assert.match(sql,/v\.status='Pending'/);
 assert.match(sql,/v\.is_active=false and v\.accepting_leads=false/);
 assert.match(sql,/limit 20/);
 assert.match(sql,/order by c\.created_at asc,c\.vendor_id asc/);
 assert.match(sql,/pendingScanCount/);
 assert.match(sql,/rejectedScanCount/);
 assert.match(sql,/consent\.revoked_at is null/);
 assert.doesNotMatch(sql,/jsonb_build_object\([\s\S]*?'(?:phone|email|gstNumber|privateStorageKey|aadhaar|businessName|ownerName)'/);
});
test("B7-2 Core private queue RPC is service-only and default execution revoked",()=>{
 assert.match(sql,/revoke all on function public\.qf_vox_owner_vendor_review_queue\(\)\s+from public,anon,authenticated/);
 assert.match(sql,/grant execute on function public\.qf_vox_owner_vendor_review_queue\(\)\s+to service_role/);
 assert.match(sql,/has_function_privilege\('anon'/);
});
test("B7-3 VOX Owner route AAL2, no query filters, no updates, default OFF",()=>{
 assert.match(route,/VOX_OWNER_VENDOR_CASE_REVIEW_ENABLED==="staging"/);
 assert.match(route,/VOX_OWNER_VENDOR_QUEUE_ENABLED==="staging"/);
 assert.match(route,/verifyVoxOwnerBearer\(authorization\)/);
 assert.match(route,/if\(url\.search\|\|url\.hash\)/);
 assert.match(route,/qf_vox_owner_vendor_review_queue/);
 assert.match(route,/data\.length>20/);
 assert.match(route,/OWNER_QUEUE_UNTRUSTED/);
 assert.match(route,/OWNER_SESSION_REVOKED/);
 assert.match(route,/canApprove:false,canViewPrivateDocuments:false,canActivateLeads:false/);
 for(const method of ["POST","PUT","PATCH","DELETE"])
   assert.match(route,new RegExp(`export function ${method}\\(\\):Response\\{return reply\\(\\{ok:false,code:"METHOD_NOT_ALLOWED"`));
 assert.doesNotMatch(strip(route),/\.insert\(|\.update\(|\.delete\(|\.storage\.|getPublicUrl/);
});
test("B7-4 existing Owner panel selects real pending vendors; no private or staff UI",()=>{
 assert.match(ui,/owner-vendor-verification-queue/);
 assert.match(ui,/Load review queue/);
 assert.match(ui,/queue\.map\(/);
 assert.match(ui,/setVendorId\(item\.vendorId\)/);
 assert.match(ui,/void load\(item\.vendorId\)/);
 assert.match(ui,/caseVersion:caseData\.caseVersion/);
 assert.doesNotMatch(strip(ui),/\bfetch\(["']https:\/\/|NEXT_PUBLIC_SERVICE_ROLE|\.storage\.|\.sendSms\(/);
});
test("B7-5 approved preflight is read-only, bounded and never dumps identities",()=>{
 assert.match(preflight,/begin transaction isolation level repeatable read read only/);
 assert.match(preflight,/set local statement_timeout='20s'/);
 assert.match(preflight,/canonical_vendor_phone_duplicate_groups/);
 assert.match(preflight,/verified_vendor_auth_owner_collisions/);
 assert.match(preflight,/cross_client_vendor_principal_collisions/);
 assert.match(preflight,/pending_vendor_mistakenly_active/);
 assert.match(preflight,/private_queue_browser_execute/);
 assert.match(preflight,/storage_bucket_schema_present/);
 assert.match(preflight,/rollback;/);
 assert.doesNotMatch(strip(preflight),/\b(insert|update|delete|truncate|alter|drop|create|grant|revoke)\s+(?:into|from|table|view|function|schema|policy|on|role)\b/i);
});
