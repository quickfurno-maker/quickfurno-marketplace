import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {dirname,resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {observedSnapshot,snapshotVerdict} from "./step3b20-current-cleanup-readiness.mjs";
const base=resolve(dirname(fileURLToPath(import.meta.url)),"../..");
const path=resolve(base,"ops/vox/sql-review/STEP3B20-STAGING-PREDELETE-READ_ONLY.sql");
const sql=readFileSync(path,"utf8");
test("S1 staging preflight is SELECT-only and never a managed migration",()=>{
 const active=sql.split("\n").filter(s=>!s.trim().startsWith("--")).join("\n");
 assert.match(sql,/SELECT ONLY/);
 assert.doesNotMatch(active,/\b(CREATE|ALTER|DROP|TRUNCATE|DELETE|INSERT|UPDATE|GRANT|REVOKE|CALL|DO|COPY|EXECUTE|PERFORM)\b/i);
});
test("S2 staging preflight inspects exact rows, fingerprints and canary",()=>{
 for(const part of ["test_vendors","test_leads","unrelated_vendors_to_preserve",
   "auth_users_to_preserve","test_linked_auth_users","test_immutable_events",
   "test_vendor_credit_logs","test_vendor_idset_drift_fingerprint",
   "test_lead_idset_drift_fingerprint","payment_rows","tgisinternal"])
   assert.ok(sql.includes(part),part);
});
test("S3 read-only query checks every protected no-delete trigger family",()=>{
 for(const key of ["lead_assignment_events","vendor_campaign_audience_members",
   "vendor_internal_notes","automation_action_requests","automation_jobs",
   "automation_execution_attempts","automation_transport_requests"])
  assert.ok(sql.includes("'"+key+"'"),key);
});
test("S4 observed evidence is HOLD and never claims live erase",()=>{
 assert.equal(snapshotVerdict.advisoryOnly,true);
 assert.equal(snapshotVerdict.decision,"HOLD");
 assert.equal(observedSnapshot.stagingLiveErasureCertified,false);
 assert.equal(observedSnapshot.managedProductionReadOnlyAccessApproved,false);
 assert.equal(observedSnapshot.fullRestoreRollbackPassed,false);
 assert.equal(observedSnapshot.independentAppsecReviewApproved,false);
 assert.equal(observedSnapshot.independentDbaReviewApproved,false);
});
test("S5 current gate reports concrete unapproved operations",()=>{
 for(const b of [
  "E:MANAGED_PRODUCTION_ACCESS_DENIED",
  "D:STAGING_AND_WORKER_FREEZE_PENDING",
  "B:FULL_SUPABASE_RECOVERY_UNCERTIFIED",
  "A:PROTECTED_HISTORY_EXCEPTION_NOT_REVIEWED:automationHistory",
  "E:PINNED_RELEASE_APPROVAL_MISSING"
 ]) assert.ok(snapshotVerdict.blockers.includes(b),b);
});
test("S6 no live mutation or elevated access code in evidence module",()=>{
 const js=readFileSync(resolve(base,"scripts/scale/step3b20-current-cleanup-readiness.mjs"),"utf8");
 assert.doesNotMatch(js,/from ["'](?:pg|postgres|@supabase\/supabase-js|node:child_process)["']/);
 assert.doesNotMatch(js,/supabase\.co|service_role|db_password/i);
 assert.doesNotMatch(js,/\b(?:DELETE FROM|ALTER TABLE|TRUNCATE TABLE)\b/i);
});
