import {readFileSync} from "node:fs";
import {dirname,resolve} from "node:path";
import {fileURLToPath} from "node:url";
export const RC5_STAGING_PROJECT="uckafzuochmbvtiodmcl";
export const RC5_PROD_PROJECT="yqpgcsduqbxulrlzwzap";
export const RC5_SCHEMA="qf.vox.rc5.managed-staging-readonly.v1";
export const RC5_REVIEWED_LEDGER={count:86,version:"20261013144901"};
const EXPECTED_TABLES=["communication_consent_events","communication_conversations","communication_preferences",
 "communication_suppressions","profiles"];
const REQUIRED_EXTENSIONS=["pgcrypto","postgis","supabase_vault"];
const hold=(reasons,details={})=>Object.freeze({
 sourceOnly:true,managedMutationAllowed:false,productionMutationAllowed:false,
 decision:"HOLD",checksPassed:reasons.length===0,reasons:Object.freeze(reasons),...details
});
/** Live catalog snapshot observation, NEVER a DBA/PITR/rollout GO.
 * The expected_project_ref label in SQL cannot establish project identity.
 * Callers must supply the independently verified connector project ref.
 */
export function reviewRc5StagingPreflight(snapshot,{verifiedToolProjectRef}={}){
 const reasons=[];
 if(verifiedToolProjectRef!==RC5_STAGING_PROJECT)reasons.push("PROJECT_IDENTITY_NOT_ATTESTED");
 if(verifiedToolProjectRef===RC5_PROD_PROJECT)reasons.push("PRODUCTION_TARGET_PROHIBITED");
 if(!snapshot||typeof snapshot!=="object"||Array.isArray(snapshot))
  return hold([...reasons,"SNAPSHOT_MISSING"]);
 if(snapshot.schema!==RC5_SCHEMA||snapshot.expected_project_ref!==RC5_STAGING_PROJECT)
  reasons.push("SNAPSHOT_IDENTITY_SCHEMA_DRIFT");
 if(!Number.isInteger(snapshot.server_version_num)||snapshot.server_version_num<170000)
  reasons.push("PG17_REQUIRED");
 if(snapshot.migration_count!==RC5_REVIEWED_LEDGER.count||
    snapshot.migration_max_version!==RC5_REVIEWED_LEDGER.version)
  reasons.push("MANAGED_MIGRATION_LEDGER_DRIFT");
 if(snapshot.p06_recorded!==false)reasons.push("P06_REQUIRES_SEPARATE_APPROVED_RELEASE");
 if(snapshot.installed_vox_staff_tables!==0)reasons.push("STAFF_SCHEMA_ALREADY_CHANGED");
 if(!Number.isInteger(snapshot.verified_mfa_principals)||snapshot.verified_mfa_principals<2)
  reasons.push("OWNER_AND_DISTINCT_TL_AAL2_MISSING");
 if(snapshot.admin_policy_references!==59)reasons.push("ADMIN_POLICY_FANOUT_DRIFT");
 for(const name of REQUIRED_EXTENSIONS)
  if(snapshot.required_extension_status?.[name]!==true)reasons.push("EXTENSION_NOT_VERIFIED:"+name);
 const tbl=snapshot.relevant_table_security;
 if(!Array.isArray(tbl)||tbl.length!==EXPECTED_TABLES.length||
  EXPECTED_TABLES.some(name=>tbl.filter(t=>t?.table===name).length!==1))
   reasons.push("CONSENT_TABLE_CATALOG_INCOMPLETE");
 else for(const t of tbl){
  if(t.owner!=="postgres"||t.rls_enabled!==true||t.anon_select!==false||
    t.service_role_select!==true)
    reasons.push("PRIVILEGE_OR_OWNER_DRIFT:"+t.table);
 }
 if(!snapshot.database_time_utc)reasons.push("CAPTURE_TIME_MISSING");
 return hold([...new Set(reasons)],{
  snapshotMatchesKnownPreMigrationSchema:reasons.length===1&&reasons[0]==="OWNER_AND_DISTINCT_TL_AAL2_MISSING",
  finalManagedRecoveryCertified:false,
  independentHumanDbaAppsecSigned:false
 });
}
export function sourceSqlIsReadOnly(sql){
 const uncommented=String(sql).replace(/--[^\n]*/g,"").replace(/\/\*[\s\S]*?\*\//g,"");
 return /^\s*SELECT\s/i.test(uncommented)&&
  !/\b(insert|update|delete|truncate|alter|drop|create|grant|revoke|copy|call|do|execute)\s/gi.test(uncommented)
}
export function loadRc5ReadOnlySql(){
 const root=resolve(dirname(fileURLToPath(import.meta.url)),"../../..");
 const sql=readFileSync(resolve(root,"scripts/mvp/vox/rc5-live-staging-preflight.sql"),"utf8");
 if(!sourceSqlIsReadOnly(sql))throw new Error("UNSAFE_SQL");
 return sql;
}
