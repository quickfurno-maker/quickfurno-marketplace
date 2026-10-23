// Step3B6-A — source-only, deterministic 52+52 divergence register; no database/network.
import assert from "node:assert/strict";
import {readFileSync,writeFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {dirname,resolve} from "node:path";
const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),"../..");
export const RC1="06267c094e9aad9d55bbeef80ac955968c5b75be";
export function buildLedgerRegister(ledger){
 assert.equal(ledger.schema,"qf.vox.step3b1.readonly-migration-inventory.v1");
 assert.equal(ledger.authorizationToApplyMigrations,false);
 assert.equal(ledger.readOnly,true);
 const {stagingOnly,productionOnly,sharedStagingProduction}=ledger.comparison;
 assert.equal(ledger.stagingHistory.length,86);
 assert.equal(ledger.productionHistory.length,86);
 assert.equal(stagingOnly.length,52);
 assert.equal(productionOnly.length,52);
 assert.equal(sharedStagingProduction,34);
 const stage=new Map(ledger.stagingHistory.map(x=>[x.version,x]));
 const prod=new Map(ledger.productionHistory.map(x=>[x.version,x]));
 assert.equal(stage.size,86);assert.equal(prod.size,86);
 const local=new Set(ledger.runnableSourceVersions);
 assert.ok(stagingOnly.every(v=>stage.has(v)&&!prod.has(v)));
 assert.ok(productionOnly.every(v=>prod.has(v)&&!stage.has(v)));
 const records=[
 ...stagingOnly.map(v=>({version:v,environment:"STAGING_ONLY",name:stage.get(v).name,versionInRunnableSource:local.has(v),semanticEquivalence:"UNREVIEWED",decision:"PENDING_INDEPENDENT_DBA"})),
 ...productionOnly.map(v=>({version:v,environment:"PRODUCTION_ONLY",name:prod.get(v).name,versionInRunnableSource:local.has(v),semanticEquivalence:"UNREVIEWED",decision:"PENDING_INDEPENDENT_DBA"}))
 ].sort((a,b)=>a.version.localeCompare(b.version)||a.environment.localeCompare(b.environment));
 assert.equal(records.length,104);
 return {schema:"qf.step3b6.dba.divergence.v1",capturedEvidence:"2026-10-22",rc1Commit:RC1,
  counts:{staging:86,production:86,shared:34,stagingOnly:52,productionOnly:52,differenceRows:104},
  disclaimer:"Version and file-presence comparison only; no SQL semantics, ACL/PITR, migration equivalence or managed rollback certified",
  allReviewed:false,independentDbaApproved:false,managedLedgerRepairAuthorized:false,
  stagingMigrationAuthorized:false,productionMigrationAuthorized:false,releaseStatus:"HOLD",records};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const ledger=JSON.parse(readFileSync(resolve(ROOT,"ops/vox/certification/STEP3B1-LIVE-MIGRATION-LEDGER-20261022.json"),"utf8"));
 const out=resolve(ROOT,"ops/vox/certification/STEP3B6-DIVERGENCE-20261023.json");
 const manifest=buildLedgerRegister(ledger);
 writeFileSync(out,JSON.stringify(manifest,null,2)+"\n","utf8");
 console.log("STEP3B6_LEDGER_REGISTER_BUILT 104/104 REVIEW_PENDING "+out);
}
