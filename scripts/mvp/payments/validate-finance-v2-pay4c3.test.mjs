import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {reviewPay4c3OperationalClearance} from "./financePay4c3OperationalClearance.mjs";
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"../../..");
const file=p=>readFileSync(path.join(root,p),"utf8");
test("C3-A original history remains quarantined and source does not imply installed finance tables",()=>{
 const x=reviewPay4c3OperationalClearance({root});
 assert.equal(x.observationIntegrity,true,x.issues.join(","));
 assert.equal(x.gates.A.remoteFinanceSchemaPresent,false);
 assert.equal(x.gates.A.legacyMigrationReconciled,false);
 assert.equal(x.stagingSqlApplyAuthorized,false);
});
test("C3-B no verified AAL2 and no independent team leader bootstrap can be inferred",()=>{
 const x=reviewPay4c3OperationalClearance({root,attestations:{
  ownerMfa:true,staffMfa:true,independentDba:true,independentAppsec:true
 }});
 assert.equal(x.gates.B.ownerAal2Verified,false);
 assert.equal(x.gates.B.staffAal2Verified,false);
 assert.equal(x.gates.B.independentStaffReviewerVerified,false);
});
test("C3-C core security definer findings remain unresolved without breaking public view",()=>{
 const x=reviewPay4c3OperationalClearance({root});
 assert.equal(x.gates.C.existingCoreDefinerObjectsStillNeedReview,true);
 assert.equal(x.gates.C.appsecSignoff,false);
 const snapshot=JSON.parse(file("ops/finance/PAY4C3-LIVE-INTERNAL-READONLY-AUDIT-20261022.json"));
 assert.equal(snapshot.coreRlsObservations.view,"public.vendor_public_v");
 assert.equal(snapshot.coreRlsObservations.publicReadRequiredForVendorDiscovery,true);
 assert.equal(snapshot.coreRlsObservations.authenticatedCanDirectlyUpdateProfilesRole,false);
});
test("C3-D fingerprint reproducible; forged signatures never activate release",()=>{
 const a=reviewPay4c3OperationalClearance({root});
 const b=reviewPay4c3OperationalClearance({root,attestations:{signedBuildVerified:true,ownerStagingApproval:true}});
 assert.match(a.gates.D.sourceFingerprint,/^[0-9a-f]{64}$/);
 assert.equal(a.gates.D.sourceFingerprint,b.gates.D.sourceFingerprint);
 assert.equal(a.gates.D.actualSignedArtifact,false);
 assert.equal(b.productionGo,false);assert.equal(b.releaseStatus,"HOLD");
});
test("C3-E genuine Razorpay TEST cases and bank proof are not simulated into certification",()=>{
 const x=reviewPay4c3OperationalClearance({root,attestations:{
  merchantTestModeVerified:true,independentDba:true,independentAppsec:true
 }});
 assert.equal(x.gates.E.syntheticProviderScenarios,9);
 assert.equal(x.gates.E.actualRazorpayTestTransactions,0);
 assert.equal(x.gates.E.authenticBankSettlementProof,false);
 assert.equal(x.financialWritesEnabled,false);
});
test("C3-F two independent PostgreSQL claimant processes + exact-one row assertion wired",()=>{
 const script=file("scripts/mvp/payments/finance-pay4c3-two-inbox-claimants.sh");
 const runner=file("scripts/mvp/payments/validate-finance-v2-pay3-pg17.ps1");
 assert.match(script,/p1=\$!/);assert.match(script,/p2=\$!/);
 assert.match(script,/wait "\$p1"/);assert.match(script,/wait "\$p2"/);
 assert.match(runner,/PAY4C3_REAL_TWO_CLIENT_INBOX_EXCLUSIVE_LEASE/);
 assert.match(runner,/PAY4C3_EXACTLY_ONE_LEASE_ATTEMPT/);
});
test("C3-A/C reviewer catalog review SQL is read-only and bounded to metadata",()=>{
 const sql=file("ops/finance/PAY4C3-PREDEPLOY-READONLY-VERIFY.sql");
 const active=sql.split("\n").filter(x=>!x.trim().startsWith("--")).join("\n");
 assert.match(active,/pg_catalog\.pg_proc/);
 assert.match(active,/pg_catalog\.pg_policies/);
 assert.match(active,/has_column_privilege/);
 assert.doesNotMatch(active,/\b(?:insert|update|delete|alter|drop|truncate|create|grant|revoke|copy)\s+(?:table|function|from|into|view|database|schema|on|public)/i);
});
test("C3 financial flags fail operational observation precheck",()=>{
 const x=reviewPay4c3OperationalClearance({root,flags:{FINANCE_V2_PAY3_INBOX_WORKER_ENABLED:"staging"}});
 assert.equal(x.observationIntegrity,false);
 assert.ok(x.issues.includes("STAGING_SOURCE_PRECHECK_FAILED"));
 assert.equal(x.financialWritesEnabled,false);
});
