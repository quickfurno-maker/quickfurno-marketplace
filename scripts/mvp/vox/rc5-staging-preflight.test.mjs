import test from "node:test";
import assert from "node:assert/strict";
import {loadRc5ReadOnlySql,reviewRc5StagingPreflight,RC5_STAGING_PROJECT,RC5_PROD_PROJECT,
 RC5_SCHEMA,sourceSqlIsReadOnly} from "./rc5-staging-preflight.mjs";
const tables=["communication_consent_events","communication_conversations","communication_preferences",
 "communication_suppressions","profiles"];
const baseline=()=>({
 schema:RC5_SCHEMA,expected_project_ref:RC5_STAGING_PROJECT,database_time_utc:"2026-10-30 10:00:00",
 server_version_num:170006,migration_count:86,migration_max_version:"20261013144901",
 p06_recorded:false,installed_vox_staff_tables:0,verified_mfa_principals:1,
 admin_policy_references:59,required_extension_status:{pgcrypto:true,postgis:true,supabase_vault:true},
 relevant_table_security:tables.map(table=>({table,owner:"postgres",rls_enabled:true,force_rls:false,
 anon_select:false,authenticated_select:table==="profiles",service_role_select:true}))
});
const verify=b=>reviewRc5StagingPreflight(b,{verifiedToolProjectRef:RC5_STAGING_PROJECT});
test("the actual known pre-migration metadata is verified but remains release HOLD for real MFA",()=>{
 const r=verify(baseline());
 assert.equal(r.decision,"HOLD");
 assert.equal(r.managedMutationAllowed,false);
 assert.deepEqual(r.reasons,["OWNER_AND_DISTINCT_TL_AAL2_MISSING"]);
 assert.equal(r.snapshotMatchesKnownPreMigrationSchema,true);
});
test("even a second real MFA principal cannot turn a catalog snapshot into a managed recovery GO",()=>{
 const b=baseline();b.verified_mfa_principals=2;
 const r=verify(b);assert.equal(r.checksPassed,true);
 assert.equal(r.decision,"HOLD");
 assert.equal(r.finalManagedRecoveryCertified,false);
 assert.equal(r.independentHumanDbaAppsecSigned,false);
});
test("wrong connector project and fake project label are rejected independently",()=>{
 const b=baseline();
 const r=reviewRc5StagingPreflight(b,{verifiedToolProjectRef:RC5_PROD_PROJECT});
 assert.ok(r.reasons.includes("PROJECT_IDENTITY_NOT_ATTESTED"));
 assert.ok(r.reasons.includes("PRODUCTION_TARGET_PROHIBITED"));
 b.expected_project_ref=RC5_PROD_PROJECT;
 assert.ok(verify(b).reasons.includes("SNAPSHOT_IDENTITY_SCHEMA_DRIFT"));
});
test("migration, P0-6 and exposed Staff table drifts cannot be confused with a safe baseline",()=>{
 const b=baseline();b.migration_count=87;b.p06_recorded=true;b.installed_vox_staff_tables=1;
 const r=verify(b);
 assert.ok(r.reasons.includes("MANAGED_MIGRATION_LEDGER_DRIFT"));
 assert.ok(r.reasons.includes("P06_REQUIRES_SEPARATE_APPROVED_RELEASE"));
 assert.ok(r.reasons.includes("STAFF_SCHEMA_ALREADY_CHANGED"));
});
test("role privileges and extension omissions fail closed",()=>{
 const b=baseline();b.relevant_table_security[2].anon_select=true;
 b.required_extension_status.supabase_vault=false;
 const r=verify(b);
 assert.ok(r.reasons.includes("PRIVILEGE_OR_OWNER_DRIFT:communication_preferences"));
 assert.ok(r.reasons.includes("EXTENSION_NOT_VERIFIED:supabase_vault"));
});
test("no missing or duplicated protected metadata can pass verification",()=>{
 for(const b of [null,undefined,{},[],{...baseline(),relevant_table_security:[]}])
  assert.equal(verify(b).checksPassed,false);
 const b=baseline();b.relevant_table_security.push({...b.relevant_table_security[0]});
 assert.ok(verify(b).reasons.includes("CONSENT_TABLE_CATALOG_INCOMPLETE"));
});
test("the captured SQL is read-only and all mutation statements are rejected",()=>{
 const sql=loadRc5ReadOnlySql();
 assert.match(sql,/uckafzuochmbvtiodmcl/);
 assert.match(sql,/pg_policies/);
 assert.equal(sourceSqlIsReadOnly(sql),true);
 for(const mutation of ["UPDATE public.profiles SET role='admin';",
   "SELECT 1; DROP TABLE public.profiles;","CREATE TABLE public.t(id int);",
   "DELETE FROM auth.users;","DO $$ BEGIN NULL; END $$;"])
  assert.equal(sourceSqlIsReadOnly(mutation),false,mutation);
});
