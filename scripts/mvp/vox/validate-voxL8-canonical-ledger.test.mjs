import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {inspectCanonicalSqlCandidate} from "../../../contracts/vox/l8CanonicalSqlInventory.mjs";
import {assessHistoricalLedgerDiff} from "../../../contracts/vox/l8MigrationLedgerEvidence.mjs";
const root=new URL("../../../",import.meta.url);
test("the exactly nine ordered canonical candidate files exist and hash deterministically",()=>{
 const p=inspectCanonicalSqlCandidate({rootUrl:root});
 assert.equal(p.ok,true);assert.equal(p.sqlCandidates,9);
 assert.equal(new Set(p.files.map(x=>x.version)).size,9);
 assert.equal(p.alternativeTo02cBranchesIncluded,false);
 assert.equal(p.approved,false);assert.equal(p.stagingPermitted,false);
 assert.equal(inspectCanonicalSqlCandidate({rootUrl:root,expectedHashes:
  p.files.map(x=>x.sha256)}).ok,true);
});
test("reject missing or changed source bytes even if filenames are unchanged",()=>{
 const baseline=inspectCanonicalSqlCandidate({rootUrl:root});
 assert.equal(inspectCanonicalSqlCandidate({rootUrl:root,expectedHashes:
  baseline.files.map((x,i)=>i===4?"0".repeat(64):x.sha256)}).ok,false);
 assert.equal(inspectCanonicalSqlCandidate({rootUrl:root,readSource:()=>{throw Error("missing")}}).ok,false);
});
const diff={protocol:"qf.vox.readonly-migration-version-name-diff.v1",
 release_authorized:false,
 counts:{stage:86,prod:86,shared_versions:34,stage_only_versions:52,
 prod_only_versions:52,shared_names_unique:62,stage_only_names:22,prod_only_names:24},
 shared_name_different_version:[{name:"qf_city_activation",
 stage_version:"20260926045741",prod_version:"20260912021527"}],
 shared_version_different_name:[],stage_only_names:[],prod_only_names:[]};
test("historical first-party shape yields explicit independent-DBA hold",()=>{
 const r=assessHistoricalLedgerDiff(diff);
 assert.equal(r.ok,true);assert.equal(r.stageOnlyVersions,52);
 assert.equal(r.prodOnlyVersions,52);assert.equal(r.sharedVersions,34);
 assert.equal(r.sqlBodyParityProven,false);
 assert.equal(r.protectedStagingPermitted,false);
});
test("ledger malformed counts, duplicate versions or fake approval refused",()=>{
 assert.equal(assessHistoricalLedgerDiff({...diff,
 counts:{...diff.counts,shared_versions:35}}).ok,false);
 assert.equal(assessHistoricalLedgerDiff({...diff,release_authorized:true}).ok,false);
 assert.equal(assessHistoricalLedgerDiff({...diff,
 shared_name_different_version:[{name:"qf_city_activation",
 stage_version:"20260926045741",prod_version:"20260926045741"}]}).ok,false);
});
test("existing L6 source staged migrations stay isolated even though replay passed",()=>{
 const sql=readFileSync(new URL("ops/vox/sql-candidates/20261016050000_vox08r_internal_outbox_metrics_candidate.sql",root),"utf8");
 assert.match(sql,/SOURCE.ONLY|UNAPPROVED SOURCE CANDIDATE/);
});
