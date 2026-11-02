import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {inspect} from "./verify-to04g-migration-history.mjs";
const data=JSON.parse(readFileSync(new URL("../../../ops/vox/certification/TO04G-READONLY-MIGRATION-METADATA.json",import.meta.url),"utf8"));
test("actual Supabase migration manifest counts have named revision divergence",()=>{
 const a=inspect(data);assert.equal(a.ok,true);assert.equal(a.ready,false);
 assert.equal(a.counts.staging,86);
 assert.equal(a.counts.production,86);
 assert.equal(a.counts.sharedExactVersions,34);
 assert.equal(a.counts.sharedNames,62);
 assert.equal(a.counts.shiftedNameVersionPairs,28);
 assert.equal(a.counts.stagingOnlyNames,22);
 assert.equal(a.counts.productionOnlyNames,24);
 assert.equal(a.counts.duplicateNamesStaging,2);
 assert.equal(a.counts.duplicateNamesProduction,0);
});
test("shared SQL names do NOT make version IDs or source SQL content identical",()=>{
 assert.equal(data.sqlContentHashesVerified,false);
 assert.equal(data.isolatedRestoreVerified,false);
 assert.equal(data.dbReviewerAccepted,false);
 assert.equal(data.ready,false);
 assert.equal(inspect({...data,authorization:true}).ok,false);
});
test("tampered/incomplete migration list and inaccurate comparison fail closed",()=>{
 const short=structuredClone(data);short.environments.staging.migrations.pop();
 assert.equal(inspect(short).ok,false);
 const invalid=structuredClone(data);invalid.environments.production.migrations[0].version="999";
 assert.equal(inspect(invalid).ok,false);
 const changed=structuredClone(data);changed.comparison.sharedDistinctNames=99;
 assert.equal(inspect(changed).ok,false);
});
