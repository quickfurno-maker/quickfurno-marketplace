import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {assembleManagedLedger} from "./vo12-managed-ledger-capture.mjs";
import {parseEvidence,renderStatements}
 from "./rc40-managed-ledger-reconciler.mjs";
import {canonicalSqlDigest} from "./rc35-migration-inventory-reconcile.mjs";
const evidenceText=readFileSync(new URL("../../../docs/vox/VOX-RC40-SOURCE-SQL-DIGESTS-20261101.json",import.meta.url),"utf8");
const evidence=parseEvidence(evidenceText);
const sha="fef3eb4b9ebcb0a3a97f34f5a1155b9ce5f1886b";
const sample=evidence.managedOnly.slice(0,2).map((m,i)=>({
 version:m.version,name:m.name,statements:["select "+(i+1)]}));
const make=(records=sample)=>assembleManagedLedger({
 evidenceText,records,candidateSha:sha,
 capturedBy:"Authorized connected staging read-only history"
});
test("VO12 raw authentic-source fields become deterministic RC40 capture, never release GO",()=>{
 const {capture,coverage}=make();
 assert.equal(capture.schema,"qf.vox.rc40.managed-ledger-capture.v1");
 assert.equal(capture.entries.length,2);
 assert.equal(capture.readOnly,true);
 assert.equal(capture.provenanceVerified,false);
 assert.equal(coverage.releaseGo,false);
 assert.equal(coverage.expected,31);
 assert.equal(coverage.recorded,2);
 assert.equal(coverage.missing.length,29);
 assert.equal(coverage.sqlExecuted,false);
 assert.equal(coverage.managedWrites,false);
 assert.equal(coverage.statementCount,2);
 const first=capture.entries[0];
 assert.equal(first.statementsSha256,canonicalSqlDigest(renderStatements(first.statements)));
 assert.equal(first.bytes,renderStatements(first.statements).length);
 assert.equal(first.aliasOf,null);
});
test("VO12 never converts duplicate SQL hashes into independent approvals",()=>{
 const dup=sample.map(x=>({...x,statements:["select 1"]}));
 const {coverage}=make(dup);
 assert.equal(coverage.uniqueDigests,1);
 assert.deepEqual(coverage.duplicateDigests,[[dup[0].version,dup[1].version]]);
 assert.equal(coverage.releaseGo,false);
});
test("VO12 rejects foreign managed versions, duplicate versions and renamed sources",()=>{
 for(const records of [[sample[0],sample[0]],
  [{...sample[0],version:"20270101000000"}],
  [{...sample[0],name:"forged-migration-name"}],
  [{...sample[0],version:"invalid"}],
  [{...sample[0],statements:[]}]]){
  assert.throws(()=>make(records),/VO12_/);
 }
});
test("VO12 missing SHA, untrusted capture actor, invalid SQL and credential exposure fail",()=>{
 assert.throws(()=>assembleManagedLedger({evidenceText,records:sample,
  candidateSha:"bad",capturedBy:"independent Supabase capture"}),/VO12_CANDIDATE_SHA_INVALID/);
 assert.throws(()=>assembleManagedLedger({evidenceText,records:sample,
  candidateSha:sha,capturedBy:"x"}),/VO12_CAPTURE_ORIGIN_REQUIRED/);
 assert.throws(()=>make([{...sample[0],statements:[""]}]),/VO12_INVALID_STATEMENTS/);
 assert.throws(()=>make([{...sample[0],statements:[
  "SUPABASE_SERVICE_ROLE_KEY=sk_live_not_for_test987654321"
 ]}]),/VO12_POTENTIAL_SECRET_REQUIRES_PRIVATE_REVIEW/);
});
test("VO12 never trusts invented evidence digests",()=>{
 const fake=JSON.parse(evidenceText);
 fake.managedOnly[0].name="forged";
 assert.throws(()=>assembleManagedLedger({
  evidenceText:JSON.stringify(fake),records:sample,candidateSha:sha,
  capturedBy:"Authorized connected staging read-only history"
 }),/RC40R_EVIDENCE_TAMPERED/);
});
test("VO12 read only and forbids managed SQL execution interfaces",()=>{
 const source=readFileSync(new URL("./vo12-managed-ledger-capture.mjs",import.meta.url),"utf8");
 assert.doesNotMatch(source,/supabase\.db\.push|db\.execute|pg\.query\(/);
 assert.match(source,/flag:"wx"/);
 assert.match(source,/provenanceVerified:false/);
 assert.match(source,/releaseGo:false/);
});
