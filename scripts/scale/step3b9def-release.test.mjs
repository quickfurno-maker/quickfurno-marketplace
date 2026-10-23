import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {resolve,dirname} from "node:path";
import {fileURLToPath} from "node:url";
import {reconcileMetadata} from "./step3b9d-ledger-reconciliation.mjs";
import {effectiveRlsReview} from "./step3b9e-effective-rls-plan.mjs";
import {releasePreflight} from "./step3b9f-release-preflight.mjs";
const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),"../..");
const data=x=>JSON.parse(readFileSync(resolve(ROOT,"ops/vox/certification/"+x),"utf8"));
test("D: all 72 missing current-Git migration files have statement arrays in managed ledgers, not yet recovered",()=>{
 const x=reconcileMetadata();
 assert.equal(x.counts.missingGitButLedgerStatementsPresent,72);
 assert.equal(x.counts.missingGitAndLedgerStatements,0);
 assert.equal(x.sqlRecoveryCompleted,false);
 assert.ok(x.divergentVersions.every(v=>v.independentDbaSigned===false&&v.authorizationToReplay===false&&v.rawSqlBodyExported===false));
});
test("D: seven shared versions have different applied SQL fingerprints and one is blank both sides",()=>{
 const x=reconcileMetadata();
 assert.equal(x.counts.sharedVersions,34);assert.equal(x.counts.sharedSqlHashDifferent,7);
 assert.equal(x.counts.sharedSqlHashMatch,26);assert.equal(x.counts.sharedBothNoSql,1);
 assert.ok(x.sharedVersions.every(v=>v.independentSemanticEquivalence==="UNREVIEWED"&&!v.explicitlyApproved));
});
test("D: forged or missing migration ledger fingerprint metadata fails closed",()=>{
 const s=data("STEP3B9D-STAGING-LEDGER-FINGERPRINTS-20261023.json");
 const p=data("STEP3B9D-PRODUCTION-LEDGER-FINGERPRINTS-20261023.json");
 const l=data("STEP3B6-DIVERGENCE-20261023.json");
 const h=data("STEP3B9D-GIT-HISTORY-PROVENANCE-20261023.json");
 const a=structuredClone(s);a.rows.pop();assert.throws(()=>reconcileMetadata(l,a,p,h));
 const b=structuredClone(s);b.rows[1].version=b.rows[0].version;assert.throws(()=>reconcileMetadata(l,b,p,h));
 const c=structuredClone(s);c.rows[1].sql_ledger_sha256="fake";assert.throws(()=>reconcileMetadata(l,c,p,h));
});
test("E: 69 named policies on 40 tables, 37 write-or-ALL, no actual RLS session proof",()=>{
 const x=effectiveRlsReview();
 assert.equal(x.decisions.length,69);assert.equal(x.affectedTableGroups.length,40);
 assert.equal(x.decisions.filter(v=>v.priority.startsWith("P0")).length,37);
 assert.ok(x.decisions.every(v=>v.actualDatabaseTestRun===false&&v.reviewer===null));
 assert.ok(x.affectedTableGroups.every(v=>v.allTablePoliciesEnumerated===false&&v.effectiveOrAndReproduced===false));
 assert.equal(x.independentAppsecSigned,false);
});
test("E: missing or duplicate policy ID is rejected",()=>{
 const s=data("STEP3B7-STAGING-RLS-READONLY-20261023.json");
 const m=data("STEP3B7-POLICY-DECISION-MATRIX-20261023.json");
 const a=structuredClone(s);a.policies[0].policyname=a.policies[1].policyname;
 assert.throws(()=>effectiveRlsReview(a,m));
 const b=structuredClone(s);b.policies.pop();
 assert.throws(()=>effectiveRlsReview(b,m));
});
test("F: unsigned release package and actual managed release gates are fail-closed",()=>{
 const x=releasePreflight();
 assert.equal(x.candidateHeadCommit,null);
 assert.equal(x.signature,null);assert.equal(x.productionAuthorized,false);
 assert.equal(x.managedStagingAuthorized,false);
 assert.equal(x.realOwnerMfaVerified,false);
 assert.equal(x.independentDbaApproval,false);
 assert.equal(x.independentAppsecApproval,false);
 assert.equal(x.actualIntegratedStagingCertified,false);
 assert.equal(x.releaseStatus,"HOLD");
 assert.equal(Object.keys(x.evidenceSha256).length,13);
});
