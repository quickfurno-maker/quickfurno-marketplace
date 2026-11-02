import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync,readdirSync} from "node:fs";
import {createHash} from "node:crypto";
import {resolve,dirname} from "node:path";
import {fileURLToPath} from "node:url";
import {EXPECTED_LIVE_MIGRATION_COUNT,POST_G1_EXTENSION_RECORDS,
 ACTIVE_POST_G1_EXTENSION_RECORDS,QUARANTINED_VOX_EXTENSIONS,
 extendLegacyFilenames,extendLegacyVersions} from "../staging/live-migration-ledger.mjs";
import {CURRENT_MIGRATION_TREE} from "./currentMigrationTruth.mjs";
const root=resolve(dirname(fileURLToPath(import.meta.url)),"../../..");
const sqls=()=>readdirSync(resolve(root,"supabase/migrations")).filter(x=>x.endsWith(".sql")).sort();
const sha=s=>createHash("sha256").update(s.replace(/\r\n?/g,"\n")).digest("hex");
test("the historic 51 extension pins survive, with exactly seven quarantined and 44 active",()=>{
 assert.equal(POST_G1_EXTENSION_RECORDS.length,51);
 assert.equal(QUARANTINED_VOX_EXTENSIONS.length,7);
 assert.equal(ACTIVE_POST_G1_EXTENSION_RECORDS.length,44);
 assert.equal(EXPECTED_LIVE_MIGRATION_COUNT,162);
 assert.equal(CURRENT_MIGRATION_TREE.ok,true,JSON.stringify(CURRENT_MIGRATION_TREE.checks.filter(c=>!c.ok)));
 assert.equal(sqls().length,162);
});
test("all seven immutable VOX SQL archives match original ledger without being live",()=>{
 for(const record of QUARANTINED_VOX_EXTENSIONS){
  const archived=resolve(root,"ops/vox/quarantined-migrations/legacy-20261014",record.filename);
  assert.equal(record.version.startsWith("20261014"),true);
  assert.equal(sqls().includes(record.filename),false);
  assert.equal(sha(readFileSync(archived,"utf8")),record.canonicalSha256);
 }
});
test("active extension projections omit only reviewed quarantine versions, not other authorities",()=>{
 const archivedVersions=new Set(QUARANTINED_VOX_EXTENSIONS.map(r=>r.version));
 const liveVersions=extendLegacyVersions([]);
 const liveNames=extendLegacyFilenames([]);
 assert.equal(liveVersions.length,44);
 assert.equal(liveNames.length,44);
 for(const q of QUARANTINED_VOX_EXTENSIONS){
  assert.equal(liveVersions.includes(q.version),false);
  assert.equal(liveNames.includes(q.filename),false);
 }
 for(const a of ACTIVE_POST_G1_EXTENSION_RECORDS){
  assert.equal(archivedVersions.has(a.version),false);
  assert.equal(liveVersions.includes(a.version),true);
  assert.equal(liveNames.includes(a.filename),true);
 }
});
test("any unreviewed old VOX migration is prohibited in active directory",()=>{
 assert.equal(sqls().some(f=>/^20261014\d{6}_vox.*\.sql$/.test(f)),false);
});
