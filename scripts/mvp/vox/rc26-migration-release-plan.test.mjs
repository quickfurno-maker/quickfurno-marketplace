import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {resolve,dirname} from "node:path";
import {fileURLToPath} from "node:url";
import {
 RC26_SNAPSHOT_PATH,RC26_LEGACY_V1_PATH,
 classifyCapturedHistory,scanLegacyRazorpayV1,assertReadOnlyProbe,buildReadOnlyProbes,
 buildReviewedInstallPlan,assertPlanNonExecuting,buildRc26MigrationReleasePlan
} from "./rc26-migration-release-plan.mjs";
const root=resolve(dirname(fileURLToPath(import.meta.url)),"../../..");
const snapshot=()=>JSON.parse(readFileSync(resolve(root,RC26_SNAPSHOT_PATH),"utf8"));
const legacy=()=>readFileSync(resolve(root,RC26_LEGACY_V1_PATH),"utf8");

test("captured 31 staging-only versions are classified, not assumed equivalent",()=>{
 const c=classifyCapturedHistory(snapshot());
 assert.equal(c.staging.length,31);
 assert.deepEqual({...c.stagingCounts},{
  STAGING_BASELINE_SQUASH:1,RETIMESTAMPED_EXACT_NAME:21,REPEATED_STAGING_NAME_REAPPLY:4,
  RETIMESTAMPED_NORMALISED_NAME_CANDIDATE:3,STAGING_ONLY_NO_SOURCE_FILE:2});
 assert.equal(c.baselineVersion,"20260722000100");
 const orphan=c.staging.filter(s=>s.class==="STAGING_ONLY_NO_SOURCE_FILE").map(s=>s.name);
 assert.deepEqual(orphan,["qf_phase2_staging_rls_initplan_parity",
  "vendor_profile_approval_atomic_v3_staging_20261013"]);
 const vl01=c.staging.find(s=>s.version==="20261012180214");
 assert.equal(vl01.class,"RETIMESTAMPED_NORMALISED_NAME_CANDIDATE");
 assert.deepEqual([...vl01.sourceCandidates],["20261012213000_vendor_assignment_update_authority_closeout.sql"]);
});

test("captured 107 source-only files split into baseline, retimestamped, gaps and Finance V1",()=>{
 const c=classifyCapturedHistory(snapshot());
 assert.equal(c.source.length,107);
 assert.deepEqual({...c.sourceCounts},{
  PRE_BASELINE_PRESUMED_SQUASHED_UNVERIFIED:68,RETIMESTAMPED_ON_STAGING_CANDIDATE:26,
  FINANCE_V1_REPLAY_HAZARD:1,HISTORICAL_GAP_NOT_IN_MANAGED_LEDGER:12});
 const v1=c.source.find(s=>s.class==="FINANCE_V1_REPLAY_HAZARD");
 assert.equal(v1.file,"20260912010000_qf_vendor_package_razorpay_testmode.sql");
 const reapplied=c.source.find(s=>s.file==="20261002090000_vendor_fair_opportunity_group_reconcile.sql");
 assert.deepEqual([...reapplied.stagingVersions],["20261002083321","20261002083346"]);
});

test("retimestamped staging applies that reorder source history are surfaced",()=>{
 const c=classifyCapturedHistory(snapshot());
 assert.equal(c.orderInversions.length,5);
 assert.ok(c.orderInversions.some(([a,b])=>a==="20261003083000_aarohi_phase2_scale_governance.sql"&&
  b==="20261003081046_aarohi_full_fk_index_closeout.sql"));
});

test("classification is order-independent and rejects writable or baseline-less evidence",()=>{
 const s=snapshot();
 const shuffled={...s,staging_only:s.staging_only.slice().reverse(),source_only:s.source_only.slice().reverse()};
 assert.deepEqual(JSON.stringify(classifyCapturedHistory(shuffled)),JSON.stringify(classifyCapturedHistory(s)));
 for(const bad of [{...s,managed_writes:true},{...s,not_a_deploy_plan:false},
  {...s,staging_only:s.staging_only.filter(e=>!e.name.startsWith("qf_mvp_staging_baseline_"))}])
  assert.throws(()=>classifyCapturedHistory(bad),/RC26_CAPTURED_HISTORY_INVALID/);
});

test("historical Razorpay V1 parser and NULL first-claim dangers are detected read-only",()=>{
 const scan=scanLegacyRazorpayV1(legacy());
 assert.equal(scan.replayParserHazard,true);
 assert.equal(scan.nullFirstClaimHazard,true);
 assert.equal(scan.wrappedInExplicitTransaction,true);
 assert.deepEqual([...scan.invalidSingleDollarFunctions],[
  "public.qf_claim_vendor_package_razorpay_order_v1",
  "public.qf_release_vendor_package_razorpay_order_claim_v1",
  "public.qf_mark_vendor_package_payment_failed_v1"]);
 // A hand "fix" of only the quoting must still flag the NULL claim defect.
 const quoted=legacy().replace(/\nas \$\r?\n/g,"\nas $$$$\n").replace(/\n\$;/g,"\n$$$$;");
 const fixed=scanLegacyRazorpayV1(quoted);
 assert.equal(fixed.replayParserHazard,false);
 assert.equal(fixed.nullFirstClaimHazard,true);
 assert.throws(()=>scanLegacyRazorpayV1("select 1"),/RC26_LEGACY_V1_SOURCE_NOT_RECOGNISED/);
});

test("DBA probes are SELECT-only and the guard rejects writes or stacked statements",()=>{
 const probes=buildReadOnlyProbes();
 assert.equal(probes.length,5);
 assert.ok(probes.every(p=>p.executedByTooling===false));
 for(const sql of [
  "update public.vendor_package_orders set provider_order_request_token = null",
  "select 1; delete from supabase_migrations.schema_migrations",
  "with x as (delete from t returning *) select * from x",
  "select set_config('role','service_role',false)",
  "insert into supabase_migrations.schema_migrations values ('1')",
  "select pg_read_file('/etc/passwd')"
 ])assert.throws(()=>assertReadOnlyProbe(sql),/RC26_PROBE_NOT_READ_ONLY/);
 assert.equal(assertReadOnlyProbe("select count(*) from t where status = 'update; drop'"),true);
});

test("real plan is deterministic HOLD, never executes, and carries no invented approvals",()=>{
 const a=buildRc26MigrationReleasePlan(),b=buildRc26MigrationReleasePlan();
 assert.equal(a.planSha256,b.planSha256);
 assert.match(a.planSha256,/^[a-f0-9]{64}$/);
 assert.equal(a.releaseGo,false);
 assert.equal(a.managedWrites,false);
 assert.equal(a.installationClaimedSafe,false);
 assert.equal(a.status,"HOLD_EXTERNAL_EVIDENCE_REQUIRED");
 assert.ok(a.steps.every(s=>s.executes===false&&Object.values(s.approvals).every(v=>v===null)));
 assert.ok(a.forbiddenOperations.includes("supabase db push --include-all"));
 const finance=a.steps.find(s=>s.id==="S06_FINANCE_V1_DO_NOT_REPLAY");
 assert.ok(finance.targets.includes("20260912010000_qf_vendor_package_razorpay_testmode.sql"));
 assert.equal(a.steps.find(s=>s.id==="S07_HISTORICAL_GAP_ADJUDICATION").targets.length,12);
 assert.equal(a.steps.find(s=>s.id==="S08_FUTURE_INSTALL_PACKET").rollback.strategy,
  "PITR_RESTORE_POINT_PLUS_REVIEWED_FORWARD_FIX");
 assert.equal(assertPlanNonExecuting(a),true);
});

test("a plan edited to fake authority, approvals, execution or a db push fails closed",()=>{
 const plan=buildRc26MigrationReleasePlan();
 const withStep=(i,patch)=>({...plan,steps:plan.steps.map((s,j)=>j===i?{...s,...patch}:s)});
 for(const forged of [
  {...plan,releaseGo:true},
  {...plan,installationClaimedSafe:true},
  {...plan,status:"GO"},
  withStep(0,{executes:true}),
  withStep(2,{approvals:{dba:"approved-by-someone",owner:null,appsec:null,finance:null}}),
  withStep(8,{requires:["run supabase db push --include-all"]}),
  {...plan,planSha256:"0".repeat(64)},
  {...plan,readOnlyProbes:[{...plan.readOnlyProbes[0],sql:"delete from x"}]}
 ])assert.throws(()=>assertPlanNonExecuting(forged),/RC26_PLAN_CLAIMS_AUTHORITY_|RC26_PROBE_NOT_READ_ONLY/);
 assert.throws(()=>buildReviewedInstallPlan(null,null,null),/RC26_PLAN_INPUT_INVALID/);
});
