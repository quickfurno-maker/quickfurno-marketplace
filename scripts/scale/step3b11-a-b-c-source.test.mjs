import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync,readdirSync} from "node:fs";
import {resolve,dirname} from "node:path";
import {fileURLToPath} from "node:url";
const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),"../..");
const data=p=>JSON.parse(readFileSync(resolve(ROOT,p),"utf8"));
const txt=p=>readFileSync(resolve(ROOT,p),"utf8");
const a=data("ops/vox/certification/STEP3B11A-SEVEN-VERSION-DBA-TRIAGE-20261024.json");
const c=data("ops/vox/certification/STEP3B11C-UNSIGNED-STACK-CHECKPOINT-20261024.json");
const b=txt("ops/vox/sql-review/STEP3B11B-HELPER-STATUS-GUARDS-REVIEW_ONLY.sql");
const pg=txt("scripts/scale/step3b11b-pg17-rls-isolated.sql");
const workflow=txt(".github/workflows/finance-v2-pay3-hold.yml");
test("A: seven disputed shared-version fingerprints explicitly tracked, no DBA approvals",()=>{
 assert.equal(a.issues.length,7);
 assert.deepEqual(a.issues.map(x=>x.version).sort(),[
 "20260801152049","20260905000000","20260906000000","20260910060000",
 "20260918120000","20260921054654","20260921055639"
 ]);
 assert.ok(a.issues.every(x=>x.staging.sha256!==x.production.sha256&&
 x.semanticEquivalence==="UNREVIEWED"&&x.reviewer===null&&!x.approvedForManagedChange));
 assert.equal(a.divergentLedgerOccurrences,104);
 assert.equal(a.noCurrentGitSourceButManagedLedgerStatements,72);
 assert.equal(a.releaseStatus,"HOLD");
});
test("B: proposed Admin and Vendor functions require positive status guards",()=>{
 assert.match(b,/p\.is_active IS TRUE/);
 assert.match(b,/v\.status = 'Approved'/);
 assert.match(b,/v\.is_active IS TRUE/);
 assert.match(b,/p_vendor_id uuid/);
 assert.match(b,/owns_vendor_historical/);
 assert.match(b,/REVOKE ALL ON FUNCTION/);
 assert.doesNotMatch(b,/\bCREATE POLICY\b/i);
});
test("B: real scratch RLS test covers inactive, active, suspended, cross-vendor and historical gates",()=>{
 for(const phrase of ["legacy_inactive_admin_insert_allowed","inactive admin retained access",
 "active admin blocked","suspended vendor sees new work","suspended vendor historical-read exception unavailable",
 "approved vendor own new work denied","cross-vendor data leaked"]){
  assert.ok(pg.includes(phrase),phrase);
 }
 assert.match(pg,/\i ops\/vox\/sql-review\/STEP3B11B-HELPER-STATUS-GUARDS-REVIEW_ONLY.sql/);
 assert.match(pg,/GRANT EXECUTE ON FUNCTION public\.owns_vendor_historical\(uuid\) TO authenticated/);
});
test("C: PR draft chain contiguous; no claimed release approval",()=>{
 assert.deepEqual(c.draftStack.map(x=>x.pr),[402,403,404,405,406]);
 for(let i=1;i<c.draftStack.length;i++)assert.equal(c.draftStack[i].baseSha,c.draftStack[i-1].sha);
 assert.equal(c.pinnedSourceBase,c.draftStack.at(-1).sha);
 for(const field of ["exactNewHeadCiVerified","independentDbaSigned","independentAppsecSigned",
  "ownerApprovedStaging","verifiedOwnerMfa","teamLeaderBootstrapApproved",
  "stagingSchemasDeployed","realIntegratedStagingCertified","realRazorpayTestCertified",
  "productionGo","managedStagingAllowed","publicIngressAllowed","realMoneyAllowed","outboundMessagesAllowed"]){
  assert.equal(c[field],false,field);
 }
 assert.equal(c.newCandidateGitHead,null);assert.equal(c.releaseStatus,"HOLD");
});
test("C: no executable Step3B11 migration added",()=>{
 assert.ok(!readdirSync(resolve(ROOT,"supabase/migrations")).some(x=>/step3b11/i.test(x)));
});
test("Continuous CI runs source gate and documents strict HOLD",()=>{
 assert.match(workflow,/step3b11-a-b-c-source\.test\.mjs/);
 assert.match(txt("docs/vox/STEP3B11-A-B-C-INTERNAL-SECURITY-REMEDIATION-20261024.md"),/Managed Staging, Production.*HOLD/);
});
