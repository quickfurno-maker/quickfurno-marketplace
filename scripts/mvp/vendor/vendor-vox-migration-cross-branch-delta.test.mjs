import test from "node:test";
import assert from "node:assert/strict";
import {MIGRATIONS} from "./vendor-seven-migration-fingerprint.mjs";
import {compareMigrationTrees,collectMigrationTree,VENDOR_REF,VOX_REF} from "./vendor-vox-migration-cross-branch-delta.mjs";
const blob="a".repeat(40);
const old=Array.from({length:162},(_,i)=>({
 path:"supabase/migrations/202610"+String(i).padStart(8,"0")+"_historical_"+i+".sql",blob
}));
const seven=MIGRATIONS.map(([file])=>({path:"supabase/migrations/"+file,blob:"b".repeat(40)}));
test("exact 7 additive vendor migrations preserve all 162 historic VOX SQL blobs",()=>{
 const result=compareMigrationTrees([...old,...seven],old);
 assert.equal(result.status,"EXACT_SEVEN_ADDITIVE_SOURCE_FILES");
 assert.equal(result.vendorSqlCount,169);
 assert.equal(result.voxSqlCount,162);
 assert.deepEqual(result.vendorOnly,seven.map(x=>x.path).sort());
 assert.deepEqual(result.voxOnly,[]);
 assert.deepEqual(result.sharedChanged,[]);
 assert.equal(result.releaseDecision,"HOLD");
 assert.equal(result.canMerge,false);
 assert.equal(result.managedLedgerReconciled,false);
 assert.equal(result.historicRc22Rc40CertificationPassed,false);
});
test("historic mutation or alien SQL forces a source delta block",()=>{
 for(const vendor of [
  [...old.slice(0,1).map(x=>({...x,blob:"c".repeat(40)})),...old.slice(1),...seven],
  [...old,...seven.slice(1)],
  [...old,...seven,{path:"supabase/migrations/20261104180000_unreviewed.sql",blob}],
 ])assert.equal(compareMigrationTrees(vendor,old).status,"SOURCE_DELTA_BLOCKED");
 const voxExtra=[...old,{path:"supabase/migrations/20261103101010_rogue.sql",blob}];
 assert.ok(compareMigrationTrees([...old,...seven],voxExtra).sourceDeltaErrors.includes("VOX_ONLY_MIGRATIONS"));
});
test("duplicate, invalid and unreliable Git entries cannot silently pass",()=>{
 const dupe=compareMigrationTrees([...old,old[0],...seven],old);
 assert.equal(dupe.status,"SOURCE_DELTA_BLOCKED");
 assert.ok(dupe.sourceDeltaErrors.includes("VENDOR_DUPLICATE_SOURCE"));
 assert.equal(compareMigrationTrees([{path:"../../unsafe.sql",blob}],old).status,"SOURCE_DELTA_BLOCKED");
 assert.throws(()=>collectMigrationTree("main"),/REF_INVALID/);
});
test("pin complete exact source commits, never claim managed or release readiness",()=>{
 assert.match(VENDOR_REF,/^[0-9a-f]{40}$/);
 assert.match(VOX_REF,/^[0-9a-f]{40}$/);
 const r=compareMigrationTrees([...old,...seven],old);
 for(const required of ["HISTORIC_RC22_RC40_MANIFEST_AND_QUARANTINE_MISMATCH",
   "MANAGED_STAGING_LEDGER_AND_DB_CATALOG_UNOBSERVED",
   "INDEPENDENT_RECOVERY_AND_OWNER_STAGING_GO_MISSING"])assert.ok(r.blockedReasons.includes(required));
});
