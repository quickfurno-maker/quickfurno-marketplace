import test from "node:test";
import assert from "node:assert/strict";
import {indexInternalReleaseEvidence,requiredSuites}
 from "../../../contracts/vox/l10ImmutableEvidencePack.mjs";
const now=Date.now();
const heads={core:"a".repeat(40),jarvis:"b".repeat(40),agni:"c".repeat(40)};
const results=requiredSuites.map((suite,i)=>({suite,status:"PASS",
 environment:"ISOLATED",executedAtMs:now-1000,
 evidenceSha256:String(i+1).repeat(64)}));
const archive={hashSha256:"d".repeat(64),
 scope:"PUBLIC_AUTH_STORAGE_MIGRATION_HISTORY_NOT_FULL",
 verifiedOfflineRestore:true};
const probe=x=>indexInternalReleaseEvidence({heads,results,archive,now,...x});
test("complete digest-index only permits review handoff, no live staging",()=>{
 const r=probe();assert.equal(r.ok,true);
 assert.equal(r.evidence.length,7);assert.equal(r.reviewerHandoffEligible,true);
 assert.equal(r.fullConsistentManagedBackupProven,false);
 assert.equal(r.protectedStagingPermitted,false);assert.equal(r.productionPermitted,false);
});
test("reject missing CI suite, duplicate or fake deployment success",()=>{
 assert.equal(probe({results:results.slice(1)}).ok,false);
 assert.equal(probe({results:[results[0],...results.slice(0,6)]}).ok,false);
 assert.equal(probe({results:[{...results[0],environment:"PRODUCTION"},...results.slice(1)]}).ok,false);
});
test("reject stale/future timestamps and fabricated hash lengths",()=>{
 assert.equal(probe({results:[{...results[0],executedAtMs:now-9*86400000},...results.slice(1)]}).ok,false);
 assert.equal(probe({heads:{...heads,agni:"not_commit"}}).ok,false);
 assert.equal(probe({archive:{...archive,hashSha256:"bad"}}).ok,false);
});
test("four-schema archive cannot be relabelled full logical managed backup",()=>{
 assert.equal(probe({archive:{...archive,scope:"FULL_MANAGED_BACKUP"}}).ok,false);
 assert.equal(probe({archive:{...archive,verifiedOfflineRestore:false}}).ok,false);
});
