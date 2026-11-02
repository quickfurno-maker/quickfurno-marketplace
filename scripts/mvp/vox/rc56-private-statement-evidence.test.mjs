import test from "node:test";
import assert from "node:assert/strict";
import {canonicalSqlDigest} from "./rc35-migration-inventory-reconcile.mjs";
import {exactStatementEvidence} from "./rc56-private-statement-evidence.mjs";
const S="CREATE TABLE a_very_specific_example_name (id uuid PRIMARY KEY, version_number integer NOT NULL);";
const src=[{file:"one.sql",sql:"-- header\n"+S+"\n",digest:canonicalSqlDigest("-- header\n"+S+"\n")},
 {file:"two.sql",sql:"CREATE TABLE some_other_table (id uuid PRIMARY KEY);",
  digest:canonicalSqlDigest("CREATE TABLE some_other_table (id uuid PRIMARY KEY);")}];
test("long exact statement fragments can be counted without exposing original SQL or approving an alias",()=>{
 const r=exactStatementEvidence([S+";","SELECT 1;"],src);
 assert.equal(r.sourceFilesChecked,2);assert.equal(r.baselineStatementCount,2);
 assert.deepEqual(r.evidence,[{sourceFile:"one.sql",exactStatementFragments:1}]);
 assert.equal(r.independentAliasApproved,false);assert.equal(r.releaseGo,false);
 assert.doesNotMatch(JSON.stringify(r),/PRIMARY KEY|NOT NULL/);
});
test("forged, modified or duplicate source evidence cannot be counted",()=>{
 assert.throws(()=>exactStatementEvidence([S],[{...src[0],sql:"tampered"}]),/RC56_SOURCE_DIGEST_UNTRUSTED/);
 assert.throws(()=>exactStatementEvidence([S],[src[0],src[0]]),/RC56_SOURCE_DIGEST_UNTRUSTED/);
 assert.throws(()=>exactStatementEvidence(["SELECT 1"],src,{minBytes:3}),/RC56_STATEMENT_INPUT_UNTRUSTED/);
});
