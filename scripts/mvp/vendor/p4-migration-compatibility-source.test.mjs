import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {resolve,dirname} from "node:path";
import {fileURLToPath} from "node:url";
const root=resolve(dirname(fileURLToPath(import.meta.url)),"../../..");
const read=path=>readFileSync(resolve(root,path),"utf8");
const sql=name=>read("supabase/migrations/"+name);
const foundation=sql("20261104140000_vendor_private_otp_and_verification_foundation.sql");
const atomic=sql("20261104153000_vendor_atomic_pending_registration.sql");
const review=sql("20261104160000_vendor_owner_review_assignment_gate.sql");
const intake=sql("20261104163000_vendor_private_document_intake.sql");
const queue=sql("20261104170000_vox_owner_vendor_review_queue.sql");
const scan=sql("20261104173000_vendor_private_scan_quarantine.sql");
const preflight=read("ops/vendor/vendor-before-migration-readonly-preflight-20261105.sql");
const snapshot=JSON.parse(read("docs/vox/QF-P4-READONLY-STAGING-CATALOG-OBSERVATION-20261105.json"));

test("P4-C1 unique indexes on existing vendor/principal data require explicit preflight",()=>{
 for(const index of [
  "uq_qf_vendor_signup_auth_principal",
  "uq_qf_vendor_signup_mobile_10",
  "uq_qf_vendor_signup_owner_membership",
 ])assert.ok(atomic.includes(index),index);
 for(const check of [
  "vendors_with_noncanonical_10_digit_mobile",
  "duplicate_canonical_vendor_phone_groups",
  "active_vendor_owner_membership_mismatches",
  "vendor_and_client_shared_auth_principals",
  "pending_vendors_with_live_flags",
  "historical_assignment_vendor_population",
 ])assert.ok(preflight.includes(check),check);
 assert.match(preflight,/begin transaction isolation level repeatable read read only;/i);
 assert.match(preflight,/\brollback;/i);
 assert.doesNotMatch(preflight,/^\s*(?:insert|update|delete|truncate|alter|drop|grant|revoke)\b/im);
});

test("P4-C2 six private evidence tables all opt into RLS",()=>{
 const names=[
  "auth_otp_purpose_reservations","verification_cases","verification_consents",
  "verification_evidence","verification_decisions"
 ];
 for(const name of names){
  assert.match(foundation,new RegExp("create table if not exists qf_vendor_private\\."+name+"\\b","i"));
  assert.match(foundation,new RegExp("alter table qf_vendor_private\\."+name+" enable row level security","i"));
 }
 assert.match(scan,/create table if not exists qf_vendor_private\.verification_scan_receipts/i);
 assert.match(scan,/alter table qf_vendor_private\.verification_scan_receipts enable row level security/i);
 assert.match(foundation,/revoke all on schema qf_vendor_private from public, anon, authenticated;/i);
});

test("P4-C3 no direct browser grants are introduced by seven vendor SQL files",()=>{
 for(const code of [foundation,atomic,review,intake,queue,scan]){
  const grants=[...code.matchAll(/\bgrant\s+execute\b[^;]*;/gi)].map(x=>x[0]);
  for(const grant of grants){
   assert.doesNotMatch(grant,/\bto\s+(?:anon|authenticated|public)\b/i,grant);
  }
 }
 assert.match(atomic,/to service_role;/i);
 assert.match(review,/QF_VENDOR_OWNER_REVIEW_BROWSER_EXPOSED/);
});

test("P4-C4 assignment trigger checks new routes without rewriting historical lifecycles",()=>{
 assert.match(review,/if tg_op='INSERT' then/i);
 assert.match(review,/new\.vendor_id is distinct from old\.vendor_id/i);
 assert.match(review,/new\.lead_id is distinct from old\.lead_id/i);
 assert.match(review,/old\.lifecycle_status/i);
 assert.match(review,/QF_VENDOR_ASSIGNMENT_VERIFICATION_REQUIRED/i);
 assert.match(review,/on public\.lead_assignments for each row/i);
 assert.doesNotMatch(review,/delete\s+from\s+public\.lead_assignments/i);
});

test("P4-C5 intake and owner queues retain only service-role Core authority",()=>{
 assert.match(intake,/qf_vendor_begin_private_verification_case/);
 assert.match(intake,/qf_vendor_attach_private_evidence/);
 assert.match(queue,/qf_vox_owner_vendor_review_queue/);
 assert.match(review,/qf_owner_record_vendor_verification_decision/);
 assert.match(scan,/verification_scan_receipts_immutable/);
 assert.match(scan,/qf_vendor_record_private_scan/);
 assert.doesNotMatch(queue,/\bgrant\s+execute\b[^;]*\bto\s+authenticated/i);
});

test("P4-C6 observed Staging is missing seven migrations and source cannot authorize application",()=>{
 assert.equal(snapshot.scope,"QUICKFURNO_STAGING_ONLY_READ_ONLY");
 assert.equal(snapshot.signedProviderAttestation,false);
 assert.equal(snapshot.observations.appliedMigrationCount,86);
 assert.equal(snapshot.observations.sevenRequiredVersions.length,7);
 assert.ok(snapshot.observations.sevenRequiredVersions.every(v=>v.applied===false));
 assert.equal(snapshot.canApplyMigrations,false);
 assert.equal(snapshot.releaseDecision,"HOLD");
 assert.equal(snapshot.observations.verificationBucketCount,0);
});
