import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {assessCurrentStagingGate,VO12_INVENTORY_SCHEMA}
 from "../../../contracts/vox/vo12StagingActivationGate.mjs";
const snapshot={schema:VO12_INVENTORY_SCHEMA,environment:"staging",
 source:"CONNECTED_SUPABASE_READ_ONLY",observedOn:"2026-11-03",
 migrationTotal:86,voxNamedMigrations:0,voxTables:0,voxFunctions:0,
 authUsers:2,voxStaffUsers:0,verifiedTotpFactors:1,readOnly:true};
test("VO12 current real Staging metadata blocks noninstalled VOX and missing principals",()=>{
 const r=assessCurrentStagingGate(snapshot);
 assert.equal(r.ok,true);assert.equal(r.releaseGo,false);
 assert.equal(r.observed.migrations,86);
 assert.equal(r.observed.voxTables,0);
 assert.ok(r.blockers.includes("NO_VOX_MANAGED_MIGRATIONS"));
 assert.ok(r.blockers.includes("NO_VOX_MANAGED_TABLES"));
 assert.ok(r.blockers.includes("NO_VOX_MANAGED_FUNCTIONS"));
 assert.ok(r.blockers.includes("MISSING_SEPARATE_TL_AND_STAFF_PRINCIPALS"));
 assert.ok(r.blockers.includes("THREE_PRINCIPAL_TOTP_FACTORS_NOT_EVIDENCED"));
 assert.equal(r.canInstallManagedSql,false);
 assert.equal(r.productionReady,false);
});
test("VO12 even apparently green counts are not sufficient for AAL2, restore or independent GO",()=>{
 const r=assessCurrentStagingGate({...snapshot,
  voxNamedMigrations:300,voxTables:50,voxFunctions:20,
  migrationTotal:500,authUsers:10,voxStaffUsers:5,verifiedTotpFactors:9});
 assert.equal(r.ok,true);assert.equal(r.releaseGo,false);
 assert.ok(r.blockers.includes("REAL_OWNER_TL_STAFF_AAL2_AUTHORIZATION_NOT_CERTIFIED"));
 assert.ok(r.blockers.includes("AUTHENTIC_MIGRATION_SQL_AND_ISOLATED_RESTORE_NOT_CERTIFIED"));
 assert.ok(r.blockers.includes("INDEPENDENT_DBA_APPSEC_APPROVAL_MISSING"));
 assert.equal(r.canEnableOfficialEod,false);
 assert.equal(r.canEnableProviderMessages,false);
});
test("VO12 rejects forged release switches, unknown sources and impossible counts",()=>{
 for(const bad of [{...snapshot,releaseGo:true},
  {...snapshot,source:"CLAIMED_LOCAL_SCAN"},
  {...snapshot,readOnly:false},
  {...snapshot,voxNamedMigrations:87},
  {...snapshot,voxStaffUsers:3},
  {...snapshot,verifiedTotpFactors:-1},
  {...snapshot,authUsers:"2"},
  {...snapshot,observedOn:"yesterday"}]){
  const r=assessCurrentStagingGate(bad);
  assert.equal(r.ok,false);
  assert.equal(r.releaseGo,false);
 }
});
test("VO12 gate tool is offline and cannot write database or authorize deployment",()=>{
 const source=readFileSync(new URL("./vo12-managed-staging-activation.mjs",import.meta.url),"utf8");
 assert.match(source,/VO12_MANAGED_CREDENTIAL_PRESENT_REFUSED/);
 assert.match(source,/VO12_MANAGED_STAGING=HOLD/);
 assert.doesNotMatch(source,/fetch\(|db\.query\(|execSync\(/);
});
