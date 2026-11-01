import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {assessRc47Recovery,runRc47Handoff} from "./rc47-managed-recovery-handoff.mjs";
import {DEFAULT_EVIDENCE} from "./rc40-managed-ledger-reconciler.mjs";
const sha="5df66b612870f2c9451be2280cd7287c65f19df0";
const evidence=readFileSync(DEFAULT_EVIDENCE,"utf8");
test("real checked-in evidence blocks without authentic original managed SQL",()=>{
 const v=assessRc47Recovery({candidateSha:sha,evidenceText:evidence});
 assert.equal(v.status,"BLOCKED_ORIGINAL_SQL_MISSING");
 assert.equal(v.counts.managedMissing,31);
 assert.equal(v.counts.sourceUnmatched,107);
 assert.equal(v.originalSqlRequired.length,31);
 assert.equal(v.sourceOnlyStillUnmatched.length,107);
 assert.equal(v.originalSqlRequired.every(x=>x.placeholderIsSql===false),true);
});
test("never represents offline evidence as independent restore or release approval",()=>{
 const v=assessRc47Recovery({candidateSha:sha,evidenceText:evidence});
 for(const k of ["releaseGo","managedWrites","connectsToManaged",
  "sqlExecuted","approvalClaimed","restoreCertified"])assert.equal(v[k],false,k);
 assert.equal(v.mandatoryRemainingGates.length,6);
 assert.equal(Object.keys(v).some(k=>/password|secret|databaseurl/i.test(k)),false);
});
test("forged candidate sha and tampered source evidence reject without soft pass",()=>{
 assert.throws(()=>assessRc47Recovery({candidateSha:"a",evidenceText:evidence}),
  /RC47_CANDIDATE_SHA_REQUIRED/);
 const v=JSON.parse(evidence);v.entries[0].canonicalSha256="f".repeat(64);
 assert.throws(()=>assessRc47Recovery({candidateSha:sha,evidenceText:JSON.stringify(v)}),
  /RC40R_EVIDENCE_TAMPERED/);
});
test("CLI makes blocking status executable, without creating files",()=>{
 let lines=[];const io={log:x=>lines.push(x),err:x=>lines.push(x)};
 assert.equal(runRc47Handoff(["--candidate-sha",sha],io),2);
 assert.match(lines.at(-1),/releaseDecision=HOLD/);
 assert.equal(runRc47Handoff([],io),1);
});
