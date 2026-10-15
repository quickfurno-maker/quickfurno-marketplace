import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {checkVoxPr300MigrationHold,MANIFEST} from "./verify-pr300-managed-migration-hold.mjs";
const base=JSON.parse(readFileSync(new URL("../../../"+MANIFEST,import.meta.url),"utf8"));
const copy=()=>structuredClone(base);
test("exact seven auto-discoverable managed VOX SQL files are accounted for",()=>{
 const r=checkVoxPr300MigrationHold(copy());
 assert.deepEqual({ok:r.ok,releaseAllowed:r.releaseAllowed,managed:r.managedMigrationCount,candidates:r.unappliedCandidateCount},
  {ok:true,releaseAllowed:false,managed:7,candidates:3});
 assert.equal(r.latestStageAndProductionVoxTablesPresent,0);
});
test("changing any legacy or candidate SQL byte invalidates its source trust record",()=>{
 const r=checkVoxPr300MigrationHold(copy(),path=>{
  const bytes=readFileSync(new URL("../../../"+path,import.meta.url));
  return path===base.legacyManagedMigrations[0].path?
   Buffer.concat([bytes,Buffer.from("\n--tamper\n")]):bytes;
 });
 assert.equal(r.ok,false);assert.match(r.error,/SOURCE_SQL_CHANGED_REVIEW_REQUIRED/);
});
test("cannot silently omit an auto-apply migration, duplicate a candidate or forge approval",()=>{
 const absent=copy();absent.legacyManagedMigrations.pop();
 assert.equal(checkVoxPr300MigrationHold(absent).ok,false);
 const duplicate=copy();duplicate.proposedSqlCandidates[1]=duplicate.proposedSqlCandidates[0];
 assert.equal(checkVoxPr300MigrationHold(duplicate).ok,false);
 const forged=copy();for(const k of Object.keys(forged.approvals))forged.approvals[k]=true;
 assert.equal(checkVoxPr300MigrationHold(forged).releaseAllowed,false);
 const enabled=copy();enabled.deployment.managedMigrationAutoApplyPermitted=true;
 assert.equal(checkVoxPr300MigrationHold(enabled).ok,false);
});
test("real staging and production history cannot be described as a DB restore",()=>{
 assert.equal(base.approvals.original86LedgerSqlBytesReconciled,false);
 assert.equal(base.approvals.originalStagingBackupRestoredInIsolation,false);
 for(const site of ["staging","production"]){
  assert.equal(base.databaseReadiness[site].missingVoxTables,13);
  assert.equal(base.databaseReadiness[site].voxMigrationVersionsApplied,0);
 }
});
