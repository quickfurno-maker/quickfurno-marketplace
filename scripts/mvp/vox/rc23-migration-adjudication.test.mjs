import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {resolve,dirname} from "node:path";
import {fileURLToPath} from "node:url";
import {analyzeStagingMigrationDrift,buildRc23HistoryPacket} from "./rc23-migration-adjudication.mjs";
const root=resolve(dirname(fileURLToPath(import.meta.url)),"../../..");
test("real captured migration lineage produces read-only history review and no deploy plan",()=>{
 const packet=buildRc23HistoryPacket();
 assert.equal(packet.releaseGo,false);
 assert.equal(packet.managedWrites,false);
 assert.equal(packet.stagingOnly,31);
 assert.equal(packet.sourceOnly,107);
 assert.equal(packet.shared,55);
 assert.equal(packet.historicalMissing+packet.appendOnlyCandidates,107);
 assert.match(packet.snapshotSha256,/^[a-f0-9]{64}$/);
 assert.ok(packet.requirements.includes("HISTORIC_V1_RAZORPAY_SOURCE_REPLAY_ADJUDICATION"));
});
test("tampered drift snapshot cannot be used to create fake migration authority",()=>{
 const snapshot=JSON.parse(readFileSync(resolve(root,"docs/vox/VOX-MANAGED-STAGING-MIGRATION-DRIFT-READONLY-20261031.json"),"utf8"));
 const source={migrations:{count:162,aggregateSha256:"f".repeat(64)}};
 for(const other of [
  {...snapshot,managed_writes:true},
  {...snapshot,source_only_count:22},
  {...snapshot,staging_count:1},
  {...snapshot,source_only:[snapshot.source_only[0],...snapshot.source_only]},
  {...snapshot,staging_only:[snapshot.common_versions[0],...snapshot.staging_only]},
  {...snapshot,not_a_deploy_plan:false},
  {...snapshot,common_versions:[{...snapshot.common_versions[0],staging_name:"other"},...snapshot.common_versions.slice(1)]}
 ])assert.throws(()=>analyzeStagingMigrationDrift(other,source),/RC23_MIGRATION_HISTORY_EVIDENCE_INVALID/);
});
test("classification distinguishes historical replay from append-only versions",()=>{
 const data={schema:"qf.vox.staging-migration-drift/read-only-v1",
 managed_writes:false,not_a_deploy_plan:true,observation_date:"2026-10-31",
 source_sql_count:162,staging_count:1,staging_only_count:0,source_only_count:161,
 common_version_count:1,staging_only:[],
 common_versions:[{version:"20261013144901",staging_name:"baseline",source_filename:"20261013144901_baseline.sql"}],source_only:[]};
 let n=0;
 for(let i=0;i<161;i++){
  const version=(i===160?20261101000000:20260901000000+i).toString();
  data.source_only.push(version+"_source_"+i+".sql");
 }
 const result=analyzeStagingMigrationDrift(data,{migrations:{count:162,aggregateSha256:"a".repeat(64)}});
 assert.equal(result.historicalMissing,160);
 assert.equal(result.appendOnlyCandidates,1);
 assert.equal(result.releaseGo,false);
});
