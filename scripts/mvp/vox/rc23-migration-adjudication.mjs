// Deterministic DBA classification of previously captured READ-ONLY history.
// No Supabase network access, credentials, SQL execution, or deployment.
import {readFileSync,readdirSync} from "node:fs";
import {resolve,dirname} from "node:path";
import {fileURLToPath} from "node:url";
import {createHash} from "node:crypto";
import {buildRc22MigrationPacket} from "./rc22-migration-release-packet.mjs";
const root=resolve(dirname(fileURLToPath(import.meta.url)),"../../..");
export function analyzeStagingMigrationDrift(snapshot,source){
 const bad=()=>{throw Error("RC23_MIGRATION_HISTORY_EVIDENCE_INVALID")};
 if(!snapshot||typeof snapshot!=="object"||!source||
   snapshot.schema!=="qf.vox.staging-migration-drift/read-only-v1"||
   snapshot.managed_writes!==false||snapshot.not_a_deploy_plan!==true||
   !Array.isArray(snapshot.staging_only)||!Array.isArray(snapshot.source_only)||
   !Array.isArray(snapshot.common_versions)||source.migrations.count!==162||
   snapshot.source_sql_count!==source.migrations.count)return bad();
 const matches=snapshot.common_versions,st=snapshot.staging_only,fs=snapshot.source_only;
 if(matches.length!==snapshot.common_version_count||st.length!==snapshot.staging_only_count||
    fs.length!==snapshot.source_only_count||matches.length+st.length!==snapshot.staging_count||
    matches.length+fs.length!==snapshot.source_sql_count)return bad();
 const version=v=>typeof v==="string"&&/^\d{14}$/.test(v);
 const name=n=>typeof n==="string"&&/^\d{14}_[A-Za-z0-9_.-]+\.sql$/.test(n);
 const seen=new Set(),observe=v=>{if(!version(v)||seen.has(v))return bad();seen.add(v)};
 for(const e of st){
  if(!e||!version(e.version)||typeof e.name!=="string"||
     e.name.length>160||!e.name||e.name.includes("/"))return bad();
  observe(e.version);
 }
 for(const e of matches){
  if(!e||!version(e.version)||!name(e.source_filename)||
     e.source_filename.slice(0,14)!==e.version||
     e.source_filename!==e.version+"_"+e.staging_name+".sql")return bad();
  observe(e.version);
 }
 for(const f of fs){
  if(!name(f)||seen.has(f.slice(0,14)))return bad();
  seen.add(f.slice(0,14));
 }
 const latest=[...st,...matches].map(x=>x.version).sort().at(-1);
 if(!version(latest))return bad();
 const historical=fs.filter(n=>n.slice(0,14)<=latest);
 const appendOnly=fs.filter(n=>n.slice(0,14)>latest);
 // A changed snapshot is evidence for a fresh live audit, not migration GO.
 const snapshotHash=createHash("sha256").update(JSON.stringify(snapshot)).digest("hex");
 return Object.freeze({
  schema:"qf.vox.rc23.migration-review-hold.v1",releaseGo:false,managedWrites:false,
  evidenceDate:snapshot.observation_date,latestManagedVersion:latest,
  sourceCount:source.migrations.count,sourceSha256:source.migrations.aggregateSha256,
  stagingOnly:st.length,sourceOnly:fs.length,shared:matches.length,
  historicalMissing:historical.length,appendOnlyCandidates:appendOnly.length,
  historicalFileNames:Object.freeze(historical),
  appendOnlyFileNames:Object.freeze(appendOnly),
  snapshotSha256:snapshotHash,
  requirements:Object.freeze([
   "QUALIFIED_DBA_CLASSIFY_BASELINE_AND_STAGING_ONLY_VERSIONS",
   "HISTORIC_V1_RAZORPAY_SOURCE_REPLAY_ADJUDICATION",
   "MANAGED_BACKUP_RESTORE_ROLES_AUTH_STORAGE_VAULT_PITR",
   "INDEPENDENT_APPSEC_AND_OWNER_STAGING_APPROVAL"
  ])
 });
}
// A snapshot is evidence, not authority. Pin the exact observed read-only
// capture and reconcile its full filename set against current SHA-pinned SQL.
export const RC24_MANAGED_SNAPSHOT_SHA256=
 "c43c8f0d36889cf94881ffb279e2ece8653f392103b6d07741388c229509723e";
export function verifyRc24CapturedSource(snapshot,localNames){
 const fail=()=>{throw Error("RC24_CAPTURE_OR_LOCAL_SOURCE_DRIFT")};
 if(!snapshot||!Array.isArray(localNames)||localNames.length!==162)return fail();
 const listed=[
  ...snapshot.source_only,
  ...snapshot.common_versions.map(e=>e.source_filename)
 ].sort();
 const actual=localNames.slice().sort();
 if(listed.length!==actual.length||listed.some((v,i)=>v!==actual[i]))return fail();
 if(new Set(actual.map(n=>n.slice(0,14))).size!==162)return fail();
 return true;
}
export function buildRc23HistoryPacket(){
 const raw=readFileSync(resolve(root,
  "docs/vox/VOX-MANAGED-STAGING-MIGRATION-DRIFT-READONLY-20261031.json"));
 if(createHash("sha256").update(raw).digest("hex")!==RC24_MANAGED_SNAPSHOT_SHA256)
  throw Error("RC24_MANAGED_STAGING_CAPTURE_SHA256_DRIFT");
 const snapshot=JSON.parse(raw.toString("utf8"));
 const source=buildRc22MigrationPacket();
 const localNames=readdirSync(resolve(root,"supabase/migrations"))
  .filter(n=>/^\d{14}_.+\.sql$/.test(n));
 verifyRc24CapturedSource(snapshot,localNames);
 return analyzeStagingMigrationDrift(snapshot,source);
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))
 console.log("VOX_RC23_MIGRATION_HISTORY_HOLD "+JSON.stringify(buildRc23HistoryPacket()));
