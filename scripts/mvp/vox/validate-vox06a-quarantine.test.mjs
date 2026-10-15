import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync,readdirSync,existsSync} from "node:fs";
import {resolve} from "node:path";
import {createHash} from "node:crypto";
const root=resolve(import.meta.dirname,"../../..");
const read=p=>readFileSync(resolve(root,p));
const manifest=JSON.parse(read("ops/vox/certification/VOX-PR300-MANAGED-SQL-RELEASE-HOLD.json"));
test("seven legacy SQL files preserved at identical Git blob hashes, outside deployment discovery",()=>{
 assert.equal(manifest.schema,"qf.vox.release.migration.quarantine.v2");
 assert.equal(manifest.legacyManagedMigrations.length,7);
 for(const row of manifest.legacyManagedMigrations){
  assert.match(row.path,/^ops\/vox\/quarantined-migrations\/legacy-20261014\//);
  const bytes=read(row.path);
  assert.equal(createHash("sha1").update("blob "+bytes.length+"\0").update(bytes).digest("hex"),row.gitBlobSha);
  assert.equal(existsSync(resolve(root,"supabase/migrations",row.path.split("/").at(-1))),false);
 }
 const actual=readdirSync(resolve(root,"supabase/migrations")).filter(x=>/vox.*\.sql$/i.test(x));
 assert.deepEqual(actual,[]);
});
test("old staging migration ledger remains historical evidence and never asserts applied",()=>{
 const ledger=JSON.parse(read("supabase/staging-history/qf-post-g1-migration-ledger-20260929.json"));
 const rows=ledger.records.filter(x=>/^202610140[1-7]0000$/.test(x.version)&&x.name.includes("vox"));
 assert.equal(rows.length,7);
 for(const row of rows){
  assert.match(row.path,/^supabase\/migrations\//); // original evidence is immutable
  assert.equal(row.exactVersionPresence.staging,false);
  assert.equal(row.exactVersionPresence.production,false);
 }
});
test("staging preflight validates original ledger signatures from quarantined immutable bytes",()=>{
 const src=read("scripts/mvp/vox/validate-vox15-staging-preflight.mjs").toString();
 assert.match(src,/const sourcePrefix="ops\/vox\/quarantined-migrations\/legacy-20261014\/"/);
 assert.match(src,/read\(sourcePrefix\+f\)/);
});
