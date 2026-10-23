import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {resolve,dirname} from "node:path";
import {fileURLToPath} from "node:url";
import {auditPolicyEvidence} from "./step3b7-policy-inventory-audit.mjs";
const root=resolve(dirname(fileURLToPath(import.meta.url)),"../..");
const actual=JSON.parse(readFileSync(resolve(root,"ops/vox/certification/STEP3B7-STAGING-RLS-READONLY-20261023.json")));
test("69 concrete live policy metadata rows resolve 59 admin, 22 vendor and 12 overlapping",()=>{
 const v=auditPolicyEvidence(actual);
 assert.equal(v.distinctPolicies,69);assert.equal(v.adminReferences,59);
 assert.equal(v.vendorReferences,22);assert.equal(v.overlap,12);
 assert.equal(v.policies.length,69);
});
test("all named policies need independent reviewer and permit no managed policy action",()=>{
 const v=auditPolicyEvidence(actual);
 assert.ok(v.policies.every(p=>p.policyDecision==="PENDING_INDEPENDENT_APPSEC_AND_DOMAIN_OWNER"));
 assert.ok(v.policies.every(p=>!p.effectiveRlsNegativeTestPassed&&!p.managedPolicyChangeAuthorized&&!p.signedReviewer));
 assert.equal(v.actualManagedRlsCertified,false);assert.equal(v.releaseStatus,"HOLD");
});
test("real vendor policy matrix distinguishes SELECT historic reads from INSERT UPDATE ALL",()=>{
 const x=auditPolicyEvidence(actual);
 assert.ok(x.policies.some(x=>x.referencesVendor&&x.cmd==="INSERT"&&x.accessClass==="MUTATION_REVIEW"));
 assert.ok(x.policies.some(x=>x.referencesVendor&&x.cmd==="SELECT"&&x.accessClass==="FINANCE_HISTORY_REVIEW"));
 assert.ok(x.policies.some(x=>x.referencesVendor&&x.cmd==="SELECT"&&x.accessClass==="HISTORIC_VENDOR_READ_REVIEW"));
});
test("altered count, helper assignment, fabricated approval and duplicate names fail closed",()=>{
 for(const mutate of [
  x=>{x.policies.pop()},
  x=>{x.policies[0].has_admin=false},
  x=>{x.independentAppsecApproved=true},
  x=>{x.policies[1].policyname=x.policies[0].policyname;x.policies[1].tablename=x.policies[0].tablename;x.policies[1].schemaname=x.policies[0].schemaname;}
 ]){
  const x=structuredClone(actual);mutate(x);assert.throws(()=>auditPolicyEvidence(x));
 }
});
