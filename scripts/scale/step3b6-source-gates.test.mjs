import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {resolve,dirname} from "node:path";
import {buildLedgerRegister} from "./step3b6-ledger-register.mjs";
import {buildStep3b6HashBill} from "./step3b6-release-bill.mjs";
import {planOwnerTransition,simulateTransitionFailure} from "../owner-superadmin-transition-plan.mjs";
const root=resolve(dirname(fileURLToPath(import.meta.url)),"../..");
const baseline=JSON.parse(readFileSync(resolve(root,"ops/vox/certification/STEP3B1-LIVE-MIGRATION-LEDGER-20261022.json"),"utf8"));
test("A source register has 104 unreviewed differences and explicit HOLD",()=>{
 const m=buildLedgerRegister(baseline);
 assert.equal(m.records.length,104); assert.equal(m.counts.shared,34);
 assert.equal(m.allReviewed,false); assert.equal(m.stagingMigrationAuthorized,false);
 assert.ok(m.records.every(x=>x.semanticEquivalence==="UNREVIEWED"));
});
test("A duplicate ledger version fails closed",()=>{
 const x=structuredClone(baseline); x.stagingHistory[1].version=x.stagingHistory[0].version;
 assert.throws(()=>buildLedgerRegister(x),/Expected values to be strictly equal/);
});
test("A altered divergence count fails closed",()=>{
 const x=structuredClone(baseline); x.comparison.stagingOnly.pop();
 assert.throws(()=>buildLedgerRegister(x));
});
test("A unauthorised migration flag fails closed",()=>{
 const x=structuredClone(baseline); x.authorizationToApplyMigrations=true;
 assert.throws(()=>buildLedgerRegister(x));
});
test("C no synthetic Owner evidence authorizes an actual grant",()=>{
 for(const input of [{},{project:"uckafzuochmbvtiodmcl"}, {phase22InstalledInManagedStaging:true}]){
  const x=planOwnerTransition(input); assert.equal(x.authorizedToExecute,false);assert.equal(x.actualManagedMutation,false);
 }
});
test("C partial failure reports compensation, never automatic rollback",()=>{
 const e=simulateTransitionFailure({faultAt:"ENROLL_AND_VERIFY_REAL_AAL2",completedSteps:["PREPARE_DURABLE_CORE_ROLE_TRANSITION"]});
 assert.equal(e.stopAndEscalate,true);
 assert.ok(e.requiredCompensation.includes("REVOKE_SESSIONS"));
 assert.equal(e.automaticRollbackExecuted,false);
});
test("D source bill reproducible and never release-authorizing",()=>{
 const x=buildStep3b6HashBill();const y=buildStep3b6HashBill();
 assert.equal(x.sourceDigest,y.sourceDigest); assert.equal(x.files.length,15);
 assert.equal(x.independentDbaApproved,false); assert.equal(x.independentAppsecApproved,false);
 assert.equal(x.ownerAuthorizedStaging,false); assert.equal(x.managedMigrationAuthorized,false);
});
test("D failure before privilege mutation does not promise compensation occurred",()=>{
 const e=simulateTransitionFailure({faultAt:"VERIFY_INDEPENDENT_DBA_AND_APPSEC_DECISIONS",completedSteps:[]});
 assert.equal(e.automaticRollbackExecuted,false);assert.equal(e.liveMutation,false);
});
