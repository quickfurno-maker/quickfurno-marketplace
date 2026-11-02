import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {DEFAULT_EVIDENCE} from "./rc40-managed-ledger-reconciler.mjs";
import {createRc50SqlHandoff,runRc50Cli} from "./rc50-staging-sql-handoff.mjs";
const sha="1ec38493d1b293d88f830379eb33188ae67d650a";
const evidence=readFileSync(DEFAULT_EVIDENCE,"utf8");
test("source hashes of all three actually reviewed SQL candidates are complete and immutable input",()=>{
 const d=createRc50SqlHandoff({candidateSha:sha,evidenceText:evidence});
 assert.equal(d.reviewedSqlCandidates.length,3);
 assert.deepEqual(d.reviewedSqlCandidates.map(x=>x.lane),["CORE_CONVERSATION","BAD_LEAD_CREDIT_ONLY","EOD_READ_ONLY"]);
 for(const item of d.reviewedSqlCandidates){
  assert.match(item.sourceSha256,/^[a-f0-9]{64}$/);
  assert.ok(item.byteCount>1000);assert.equal(item.reviewOnly,true);
  assert.equal(item.installed,false);assert.equal(item.deployed,false);
 }
});
test("no source-only SHA can authorize a managed migration or a financial/EOD send",()=>{
 const d=createRc50SqlHandoff({candidateSha:sha,evidenceText:evidence});
 for(const key of ["releaseGo","stagingInstallPermitted","managedWrites","sqlApplied",
  "restoreCertified","independentReview"])assert.equal(d[key],false,key);
 assert.equal(d.outstandingManagedOriginalCount,31);
 assert.equal(d.outstandingSourceMigrationCount,107);
 assert.equal(d.nextRequiredActions.length,6);
});
test("tampered candidate bytes and missing original candidates fail closed",()=>{
 assert.throws(()=>createRc50SqlHandoff({candidateSha:sha,evidenceText:evidence,
  load:()=>Buffer.from("DROP TABLE public.vendors")}),/RC50_NOT_REVIEW_ONLY_SQL/);
 assert.throws(()=>createRc50SqlHandoff({candidateSha:sha,evidenceText:evidence,
  load:()=>Buffer.alloc(0)}),/RC50_SQL_BYTES_MISSING/);
});
test("command never marks ready: emits HOLD and returns blocking exit 2",()=>{
 const lines=[];const io={log:x=>lines.push(x),err:x=>lines.push(x)};
 assert.equal(runRc50Cli(["--candidate-sha",sha],io),2);
 assert.match(lines.at(-1),/releaseDecision=HOLD/);
 assert.equal(runRc50Cli([],io),1);
});
