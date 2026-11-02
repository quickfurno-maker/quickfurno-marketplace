import test from "node:test";
import assert from "node:assert/strict";
import {canonicalSqlDigest} from "./rc35-migration-inventory-reconcile.mjs";
import {reviewSqlTokens,lexicalReview} from "./rc57-private-lexical-reconciliation.mjs";
const a="-- note\nCREATE TABLE Example (id UUID PRIMARY KEY);";
const b="create /* ignored */ table example(id uuid primary key);";
const unchanged="SELECT 'Case Sensitive', $$MiXeD body $$, \"MixedCase\";";
test("comment and whitespace variation on unquoted SQL can be compared without claiming semantic equality",()=>{
 assert.equal(reviewSqlTokens(a),reviewSqlTokens(b));
 const r=lexicalReview([a],[
  {file:"source.sql",sql:b,digest:canonicalSqlDigest(b)}
 ],{minTokens:32});
 assert.equal(r.independentAliasApproved,false);
 assert.equal(r.releaseGo,false);
});
test("literal and quoted identifier content is preserved, not erased by normalization",()=>{
 const tokens=reviewSqlTokens(unchanged);
 assert.match(tokens,/Case Sensitive/);
 assert.match(tokens,/MiXeD body/);
 assert.match(tokens,/MixedCase/);
 assert.notEqual(reviewSqlTokens("SELECT 'one';"),reviewSqlTokens("SELECT 'two';"));
});
test("private SQL syntax and forged source digests fail closed",()=>{
 assert.throws(()=>reviewSqlTokens("SELECT 'unterminated"),/RC57_UNTERMINATED_QUOTE/);
 assert.throws(()=>reviewSqlTokens("SELECT /* unfinished"),/RC57_UNTERMINATED_COMMENT/);
 assert.throws(()=>lexicalReview([a],[{file:"source.sql",sql:b,digest:"0".repeat(64)}]),/RC57_SOURCE_DIGEST_UNTRUSTED/);
});
