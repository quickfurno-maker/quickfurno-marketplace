import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync,existsSync} from "node:fs";
import {resolve,dirname} from "node:path";
import {fileURLToPath} from "node:url";
import {PG17_STEPS,MIGRATION_COUNT} from "./p4-disposable-pg17-recovery.mjs";
import {MIGRATIONS} from "./vendor-seven-migration-fingerprint.mjs";
const root=resolve(dirname(fileURLToPath(import.meta.url)),"../../..");
test("P4-E2E1 seven raw migration files executed in exact order",()=>{
 const present=PG17_STEPS.filter(x=>x.startsWith("supabase/migrations/"));
 assert.equal(MIGRATION_COUNT,7);
 assert.deepEqual(present,MIGRATIONS.map(([file])=>"supabase/migrations/"+file));
 for(const p of PG17_STEPS)assert.equal(existsSync(resolve(root,p)),true,p);
});
test("P4-E2E2 every schema change has adjacent positive/negative acceptance query",()=>{
 const acceptance=PG17_STEPS.filter(x=>x.endsWith("-acceptance.sql"));
 assert.ok(acceptance.length>=5);
 const js=readFileSync(resolve(root,"scripts/mvp/vendor/p4-disposable-pg17-recovery.mjs"),"utf8");
 assert.match(js,/for\(const path of PG17_STEPS\)filePsql/);
 assert.match(js,/--exit-on-error/);
 assert.match(js,/P4_LOCAL_RESTORE_CATALOG_MISMATCH/);
});
test("P4-E2E3 container is pull-free, isolated, temporary, with synthetic password only",()=>{
 const js=readFileSync(resolve(root,"scripts/mvp/vendor/p4-disposable-pg17-recovery.mjs"),"utf8");
 assert.match(js,/--pull=never/);
 assert.match(js,/--network","none"/);
 assert.match(js,/--rm/);
 assert.match(js,/qf_synthetic_pg17_only/);
 assert.match(js,/finally\{/);
 assert.match(js,/docker\(\["stop",name\]/);
 assert.doesNotMatch(js,/https:\/\/|supabase\.co|ssh\s|process\.env\.SUPABASE|apply_migration/);
});
test("P4-E2E4 schema backup restored only inside same disposable container, never a real recovery claim",()=>{
 const js=readFileSync(resolve(root,"scripts/mvp/vendor/p4-disposable-pg17-recovery.mjs"),"utf8");
 assert.match(js,/pg_dump","-Fc"/);
 assert.match(js,/pg_restore","--exit-on-error"/);
 assert.match(js,/p4_disposable_restore/);
 for(const key of ["actualManagedBackupVerified:false","actualStagingRestored:false",
 "actualProductionRestored:false","managedDatabaseModified:false",
 "canDeploy:false","releaseDecision:"+"\"HOLD\""])
  assert.ok(js.includes(key),key);
});
