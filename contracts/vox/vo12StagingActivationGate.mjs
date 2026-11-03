// VO12 real managed-Staging metadata diagnostic, read-only, source-limited.
// A DB object count or one verified MFA factor can NEVER certify live AAL2
// principals, schema recoverability, DBA/AppSec approval or deployment.
// The caller must obtain counts from an authenticated read-only catalog
// independently. This pure function never connects to managed Supabase.
export const VO12_INVENTORY_SCHEMA="qf.vox.vo12.staging-inventory.v1";
export const VO12_GATE_SCHEMA="qf.vox.vo12.staging-gate.v1";
const count=v=>Number.isSafeInteger(v)&&v>=0&&v<=1000000;
const fail=reason=>Object.freeze({ok:false,reason,releaseGo:false});
const exact=(x,fields)=>Object.keys(x).sort().join("|")===[...fields].sort().join("|");
export function assessCurrentStagingGate(snapshot){
 if(!snapshot||typeof snapshot!=="object"||Array.isArray(snapshot)||
    !exact(snapshot,["schema","environment","source","observedOn",
      "migrationTotal","voxNamedMigrations","voxTables","voxFunctions",
      "authUsers","voxStaffUsers","verifiedTotpFactors","readOnly"])||
    snapshot.schema!==VO12_INVENTORY_SCHEMA||
    snapshot.environment!=="staging"||
    snapshot.source!=="CONNECTED_SUPABASE_READ_ONLY"||
    snapshot.readOnly!==true||
    typeof snapshot.observedOn!=="string"||
    !/^20\d\d-\d\d-\d\d$/.test(snapshot.observedOn)||
    !["migrationTotal","voxNamedMigrations","voxTables","voxFunctions",
       "authUsers","voxStaffUsers","verifiedTotpFactors"].every(k=>count(snapshot[k]))||
    snapshot.voxNamedMigrations>snapshot.migrationTotal||
    snapshot.voxStaffUsers>snapshot.authUsers)
  return fail("STAGING_SNAPSHOT_UNTRUSTED");
 const blockers=[];
 const add=(code)=>blockers.push(code);
 if(snapshot.voxNamedMigrations===0)add("NO_VOX_MANAGED_MIGRATIONS");
 if(snapshot.voxTables===0)add("NO_VOX_MANAGED_TABLES");
 if(snapshot.voxFunctions===0)add("NO_VOX_MANAGED_FUNCTIONS");
 if(snapshot.voxStaffUsers<2)add("MISSING_SEPARATE_TL_AND_STAFF_PRINCIPALS");
 if(snapshot.verifiedTotpFactors<3)add("THREE_PRINCIPAL_TOTP_FACTORS_NOT_EVIDENCED");
 // Counts are not identity, AAL, role-scope or recovery proofs, even when
 // every count is nonzero. Block until real per-principal sessions exist.
 add("REAL_OWNER_TL_STAFF_AAL2_AUTHORIZATION_NOT_CERTIFIED");
 add("AUTHENTIC_MIGRATION_SQL_AND_ISOLATED_RESTORE_NOT_CERTIFIED");
 add("INDEPENDENT_DBA_APPSEC_APPROVAL_MISSING");
 add("PROTECTED_STAGING_E2E_UAT_AND_OWNER_GO_MISSING");
 return Object.freeze({
  ok:true,schema:VO12_GATE_SCHEMA,mode:"READ_ONLY_HOLD",
  observedOn:snapshot.observedOn,sourceVerified:false,
  observed:Object.freeze({
   migrations:snapshot.migrationTotal,voxMigrations:snapshot.voxNamedMigrations,
   voxTables:snapshot.voxTables,voxFunctions:snapshot.voxFunctions,
   authUsers:snapshot.authUsers,voxStaffUsers:snapshot.voxStaffUsers,
   verifiedTotpFactors:snapshot.verifiedTotpFactors
  }),blockers:Object.freeze(blockers),releaseGo:false,
  canInstallManagedSql:false,canInviteStaff:false,
  canActivateFinance:false,canEnableProviderMessages:false,
  canEnableOfficialEod:false,productionReady:false,
  note:"Read-only counts are not an independent Auth proof, migration parity or release approval."
 });
}
