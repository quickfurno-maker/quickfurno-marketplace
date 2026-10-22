import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {inspectFinanceMfaSource} from "./financePay4c2IdentityPreflight.mjs";
import {reconcileFinanceMigrationForReview} from "./financePay4c2MigrationReview.mjs";
import {buildPay4c2StagingReleasePreflight} from "./financePay4c2StageRelease.mjs";
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"../../..");
test("C2-A records quarantined legacy mismatch and cannot silently repair",()=>{
 const x=reconcileFinanceMigrationForReview({root});
 assert.equal(x.sourceIntegrityOk,true,JSON.stringify(x.findings));
 assert.equal(x.quarantineShaMatches,true);
 assert.equal(x.oldValidatorStatus,"BLOCKED_EXPECTS_QUARANTINED_SQL_IN_RUNNABLE_TREE");
 assert.equal(x.migrationDeploymentAuthorized,false);
 assert.equal(x.copyQuarantinedSqlAllowed,false);
});
test("C2-A moving quarantined SQL into runnable tree creates an explicit failure",()=>{
 const x=reconcileFinanceMigrationForReview({root,exists:p=>
  p.includes("supabase/migrations/20261014010000")?true:!p.includes("badtest")});
 assert.equal(x.sourceIntegrityOk,false);
 assert.ok(x.findings.includes("UNAPPROVED_SQL_MOVED_INTO_MIGRATIONS"));
});
test("C2-B existing auth, AAL2, Finance grant and independent reviewer code gates",()=>{
 const x=inspectFinanceMfaSource({root});
 assert.equal(x.sourceGuardsVerified,true,JSON.stringify(x.errors));
 assert.equal(x.genuineStagingOwnerSessionVerified,false);
 assert.equal(x.genuineStagingStaffSessionVerified,false);
 assert.equal(x.independentReviewerBootstrapVerified,false);
 assert.equal(x.canGrantOrApprove,false);
});
test("C2-C release fingerprint stable and no permission to deploy",()=>{
 const a=buildPay4c2StagingReleasePreflight({root});
 const b=buildPay4c2StagingReleasePreflight({root});
 assert.equal(a.sourceValidationOk,true,JSON.stringify(a.issues));
 assert.equal(a.sourceFingerprint,b.sourceFingerprint);
 assert.equal(a.sourceEntries.length,9);
 assert.equal(a.realSigningComplete,false);
 assert.equal(a.installMigrations,false);
 assert.equal(a.runWorker,false);
 assert.equal(a.releaseStatus,"HOLD");
});
test("C2-C enabling any finance flag makes preflight fail",()=>{
 const a=buildPay4c2StagingReleasePreflight({root,env:{
  FINANCE_V2_PAY3_INBOX_WORKER_ENABLED:"staging"
 }});
 assert.equal(a.sourceValidationOk,false);
 assert.ok(a.issues.includes("PAYMENT_FEATURE_ENABLED_BEFORE_APPROVAL"));
 assert.equal(a.realProviderWritesAllowed,false);
});
