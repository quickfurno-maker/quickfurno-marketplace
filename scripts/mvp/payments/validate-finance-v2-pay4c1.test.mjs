import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {inspectPay4c1CertificationEvidence} from "./financePay4c1Certification.mjs";
import {buildPay4c1TestRunbook} from "../../../lib/payments/financePay4c1TestPlan.mjs";
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"../../..");
const src=x=>readFileSync(path.join(root,x),"utf8");
test("C1-A two separate PostgreSQL clients are required by isolated race fixture",()=>{
 const sh=src("scripts/mvp/payments/finance-pay4c1-two-clients.sh");
 const runner=src("scripts/mvp/payments/validate-finance-v2-pay3-pg17.ps1");
 assert.match(sh,/pid1=\$!/);assert.match(sh,/pid2=\$!/);
 assert.match(sh,/wait "\$pid1"/);assert.match(sh,/wait "\$pid2"/);
 assert.match(sh,/PAY4C1_TWO_PG_CLIENTS_EXACTLY_ONE_PASS/);
 assert.match(runner,/PAY4C1_REFUND_CAP_AFTER_REAL_CONCURRENCY/);
 assert.match(runner,/1\|7000/);
});
test("C1-B DBA read-only review SQL contains no mutations",()=>{
 const q=src("ops/finance/PAY4C1-DBA-READONLY-CATALOG-REVIEW.sql");
 assert.match(q,/pg_catalog\.pg_proc/);
 assert.match(q,/has_function_privilege/);
 assert.match(q,/relforcerowsecurity/);
 const withoutComments=q.split("\n").filter(x=>!x.trim().startsWith("--")).join("\n");
 assert.doesNotMatch(withoutComments,/\b(?:update|delete|insert|alter|create|drop|truncate|copy)\s+(?:table|from|into|function|view|database|schema|public)/i);
});
test("C1-C advisor findings are preserved, do not auto-certify AppSec",()=>{
 const r=inspectPay4c1CertificationEvidence({root});
 assert.equal(r.sourceEvidenceIntegrity,true,JSON.stringify(r.errors));
 assert.equal(r.sqlCandidateCount,12);
 assert.deepEqual(r.managedMigrationVersionsObserved,[86,86]);
 assert.equal(r.advisorFindings,4);
 assert.equal(r.advisorsMappedToFinance,false);
 assert.equal(r.independentAppsecApproved,false);
 assert.equal(r.remoteObjectAclCertified,false);
});
test("C1-C a finance feature flag on blocks source-level eligibility",()=>{
 const r=inspectPay4c1CertificationEvidence({root,env:{
  FINANCE_V2_PAY4A_CRON_ENABLED:"staging"
 }});
 assert.equal(r.sourceEvidenceIntegrity,false);
 assert.ok(r.errors.includes("FINANCIAL_FEATURE_FLAGS_ENABLED"));
 assert.equal(r.financialReleaseAuthorized,false);
});
test("C1-D deterministic provider TEST runbook never executes money even with claimed approvals",()=>{
 const x=buildPay4c1TestRunbook();
 assert.equal(x.orderedScenarios.length,9);
 assert.equal(x.canStartRealTest,false);
 assert.equal(x.performingProviderAction,false);
 assert.equal(x.canExecuteRefund,false);
 assert.ok(x.requiredBeforeTest.includes("independentDba"));
 const o=buildPay4c1TestRunbook(Object.fromEntries([
  "independentDba","independentAppsec","ownerStagingApproval",
  "stagingBackupRestored","ownerMfa","staffMfa","merchantTestModeVerified",
  "signedBuildVerified","webhookEndpointRestricted"
 ].map(k=>[k,true])));
 assert.equal(o.requiredBeforeTest.length,0);
 assert.equal(o.canStartRealTest,false);
});
test("C1-E source fingerprint is reproducible and never claims cryptographic signing",()=>{
 const a=inspectPay4c1CertificationEvidence({root});
 const b=inspectPay4c1CertificationEvidence({root});
 assert.match(a.sourceBundleFingerprint,/^[0-9a-f]{64}$/);
 assert.equal(a.sourceBundleFingerprint,b.sourceBundleFingerprint);
 assert.equal(a.actualSignedStagingArtifactsPresent,false);
 assert.equal(a.financialReleaseAuthorized,false);
 assert.equal(a.releaseStatus,"HOLD");
});
