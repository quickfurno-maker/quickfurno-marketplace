import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { MIGRATIONS, SOURCE_PARENT_SHA, collectMigrationSources, evaluateMigrationSources } from "./vendor-seven-migration-fingerprint.mjs";

const dir=resolve(import.meta.dirname,"../../../supabase/migrations");
const read=file=>readFileSync(resolve(dir,file));
const files=MIGRATIONS.map(([file])=>file);

test("seven reviewed SQL bytes match pinned, independent exact-source hashes",()=>{
 const result=collectMigrationSources();
 assert.equal(result.sourceVerdict,"SOURCE_EXACT");
 assert.equal(result.migrationSourceCount,7);
 assert.equal(result.pinnedSourceCommit,SOURCE_PARENT_SHA);
 assert.ok(result.migrations.every(x=>x.sourceMatch===true));
 assert.deepEqual(result.migrations.map(x=>x.version),files.map(f=>f.slice(0,14)));
 assert.equal(result.releaseDecision,"HOLD");
 for(const field of ["canApplyStaging","canApplyProduction","connectsToManaged","executesSql","updatesLedger"])
  assert.equal(result[field],false,field);
 assert.ok(result.blockedReasons.includes("NO_MANAGED_STAGING_LEDGER_OR_CATALOG_EVIDENCE"));
 assert.ok(result.reviewRequired.includes("HISTORIC_VOX_RC22_TO_RC40_GOVERNANCE_RECONCILIATION"));
});
test("one changed byte blocks reviewed SQL fingerprints without rewriting pin",()=>{
 const result=evaluateMigrationSources({
  listNames:files,
  readBytes:file=>file===files[0]?Buffer.concat([read(file),Buffer.from("\n--modified\n")]):read(file)
 });
 assert.equal(result.sourceVerdict,"SOURCE_BLOCKED");
 assert.ok(result.blockedReasons.some(x=>x==="SOURCE_SHA_CHANGED:"+files[0]));
 assert.equal(result.canApplyStaging,false);
});
test("missing, duplicate or unreviewed migration file blocks source identity",()=>{
 const missing=evaluateMigrationSources({listNames:files.slice(1),readBytes:read});
 const extra=evaluateMigrationSources({listNames:[...files,"20261104180000_unreviewed.sql"],readBytes:read});
 const unreadable=evaluateMigrationSources({listNames:files,readBytes:()=>{throw Error("missing");}});
 for(const result of [missing,extra,unreadable]){
  assert.equal(result.sourceVerdict,"SOURCE_BLOCKED");
  assert.equal(result.releaseDecision,"HOLD");
  assert.ok(result.blockedReasons.length>=4);
 }
});
test("fingerprint packet must not mutate SQL, migration ledger or claim staging is ready",()=>{
 const src=readFileSync(resolve(import.meta.dirname,"vendor-seven-migration-fingerprint.mjs"),"utf8");
 assert.doesNotMatch(src,/child_process|spawnSync|execSync|writeFileSync|fetch\(|supabase db push/);
 const packet=collectMigrationSources();
 assert.equal(packet.blockedReasons.includes("NO_MANAGED_RECOVERY_ATTESTATION"),true);
 assert.equal(packet.canApplyProduction,false);
});
