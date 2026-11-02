import test from "node:test";
import assert from "node:assert/strict";
import {canonicalSqlDigest} from "./rc35-migration-inventory-reconcile.mjs";
import {rankHumanCandidates} from "./rc73-private-mismatch-triage.mjs";
const statement="CREATE TABLE vendor_fairness_workflow (assignment_id uuid not null, vendor_id uuid not null, active boolean default true);";
const name="vendor_fairness_workflow";
const source=[
 {file:"20261001000000_vendor_fairness_workflow.sql",sql:statement,
   canonicalSha256:canonicalSqlDigest(statement)},
 {file:"20261001000001_customer_list.sql",
   sql:"CREATE INDEX customer_index ON customers (id)",
   canonicalSha256:canonicalSqlDigest("CREATE INDEX customer_index ON customers (id)")}
];
test("only source filename and bounded aggregate scores emerge, no private SQL snippet",()=>{
 const r=rankHumanCandidates({name,sql:statement},source);
 assert.equal(r.length,1);assert.equal(r[0].sourceFile,source[0].file);
 assert.equal(r[0].sqlTokenSimilarityPercent,100);
 assert.equal(r[0].exactOrderedTokenSequence,true);
 assert.ok(r[0].nameTokenSimilarityPercent>80);
 assert.equal(JSON.stringify(r).includes("CREATE TABLE"),false);
 assert.equal(JSON.stringify(r).includes("vendor_id uuid"),false);
 assert.deepEqual(Object.keys(r[0]).sort(),[
  "exactOrderedTokenSequence","nameTokenSimilarityPercent","sourceFile","sqlTokenSimilarityPercent","weightedReviewScore"
 ]);
});
test("tampered source SQL is refused, and empty or invalid inputs fail closed",()=>{
 assert.throws(()=>rankHumanCandidates({name,sql:statement},
  [{...source[0],sql:source[1].sql}]),/RC73_PRIVATE_REVIEW_INVALID/);
 assert.throws(()=>rankHumanCandidates({name,sql:statement},
  [source[0],source[0]]),/RC73_PRIVATE_REVIEW_INVALID/);
 assert.throws(()=>rankHumanCandidates({name,sql:"x".repeat(250001)},source),
  /RC73_PRIVATE_REVIEW_INVALID/);
 assert.throws(()=>rankHumanCandidates({name,sql:statement},null),/RC73_PRIVATE_REVIEW_INVALID/);
});
