import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {resolve,dirname} from "node:path";
import {fileURLToPath} from "node:url";
import {RC24_MANAGED_SNAPSHOT_SHA256} from "./rc23-migration-adjudication.mjs";
import {RC26_SNAPSHOT_PATH,buildRc26MigrationReleasePlan} from "./rc26-migration-release-plan.mjs";
import {
 RC27_STEP_EDGES,RC27_RECOVERY_FIELDS,localIo,
 validateClassifiedHistory,deriveProbeGrantNeeds,buildGrantAndOwnerNeeds,buildDependencyGraph,
 buildSqlProvenance,emptyRecoveryEvidence,validateRecoveryEvidence,assertHandoffNonExecuting,
 assertNoManagedCredentials,buildRc27HandoffValidation,buildRc27MigrationHandoffValidation
} from "./rc27-migration-handoff-validation.mjs";
const here=dirname(fileURLToPath(import.meta.url));
const root=resolve(here,"../../..");
const snapshot=()=>JSON.parse(readFileSync(resolve(root,RC26_SNAPSHOT_PATH),"utf8"));
const plan=buildRc26MigrationReleasePlan();
const clone=x=>JSON.parse(JSON.stringify(x));
const fullEvidence=()=>{
 const e=clone(emptyRecoveryEvidence(plan.planSha256));
 Object.assign(e.fields,{pitrRestorePointId:"pitr-2026-10-31T00:00Z",pitrRestorePointCapturedAt:"2026-10-31T00:00:00Z",
  logicalSchemaDumpSha256:"a".repeat(64),authSchemaDumpSha256:"b".repeat(64),storageSchemaDumpSha256:"c".repeat(64),
  roleAndGrantInventorySha256:"d".repeat(64),managedLedgerRecaptureSha256:RC24_MANAGED_SNAPSHOT_SHA256,
  restoreDrillCompletedAt:"2026-10-31T02:00:00Z",restoreDrillSchemaDiffSha256:"e".repeat(64),
  forwardFixPacketSha256:"f".repeat(64),recoveryTimeObjectiveMinutes:120,dataLossWindowMinutes:5});
 return e;
};

test("31 staging-only and 107 source-only rows are pinned, snapshot-exact and covered exactly once",()=>{
 const h=validateClassifiedHistory(plan,snapshot());
 assert.equal(h.stagingOnly,31);
 assert.equal(h.sourceOnly,107);
 assert.equal(h.everyRowCoveredExactlyOnce,true);
 assert.match(h.classificationSha256,/^[a-f0-9]{64}$/);
 assert.equal(validateClassifiedHistory(plan,snapshot()).classificationSha256,h.classificationSha256);
});

test("classified history drift, re-classification, dropped rows or double coverage fail closed",()=>{
 const s=snapshot();
 const p=clone(plan);
 const cases=[
  [{...p,staging:p.staging.slice(1)},s],
  [{...p,source:p.source.map((x,i)=>i===0?{...x,class:"APPEND_ONLY_CANDIDATE"}:x)},s],
  [{...p,staging:p.staging.map((x,i)=>i===1?{...x,name:"renamed"}:x)},s],
  [{...p,source:p.source.map((x,i)=>i===0?{...x,class:"INVENTED"}:x)},s],
  [p,{...s,staging_only_count:30}],
  [{...p,steps:p.steps.map(st=>st.id==="S07_HISTORICAL_GAP_ADJUDICATION"
   ?{...st,targets:[...st.targets,p.source.find(x=>x.class==="FINANCE_V1_REPLAY_HAZARD").file]}:st)},s],
  [{...p,steps:p.steps.map(st=>st.id==="S05_STAGING_ONLY_SOURCE_RECOVERY"?{...st,targets:[]}:st)},s]
 ];
 for(const [pp,ss] of cases)assert.throws(()=>validateClassifiedHistory(pp,ss),/^Error: RC27_/);
});

test("probe grant and owner needs are derived, SELECT-only and never granted by tooling",()=>{
 const needs=buildGrantAndOwnerNeeds(plan);
 assert.equal(needs.probes.length,5);
 const p01=needs.probes.find(p=>p.probeId==="P01_MANAGED_LEDGER_RECAPTURE");
 assert.deepEqual(p01.grants.map(g=>[g.object,g.privilege,g.source]),
  [["supabase_migrations.schema_migrations","SELECT","EXPLICIT_GRANT_REQUIRED"]]);
 const p04=needs.probes.find(p=>p.probeId==="P04_V1_NULL_CLAIM_EXPOSURE");
 assert.equal(p04.rlsBypassDecisionRequired,true);
 assert.equal(p04.dataOwner,"FINANCE_DATA_OWNER");
 assert.deepEqual([...needs.probes.find(p=>p.probeId==="P05_V1_EXECUTE_GRANTS").functions],["has_function_privilege"]);
 for(const p of needs.probes){
  assert.equal(p.grantedByTooling,false);
  assert.equal(p.executedByTooling,false);
  assert.ok(p.grants.every(g=>g.privilege==="SELECT"));
  assert.ok(p.forbiddenRoles.includes("service_role"));
 }
 for(const s of needs.steps)assert.ok(s.owners.length>0&&Object.values(s.signatures).every(v=>v===null));
 assert.deepEqual([...needs.steps.find(s=>s.stepId==="S06_FINANCE_V1_DO_NOT_REPLAY").owners],
  ["FINANCE_OWNER","QUALIFIED_DBA","INDEPENDENT_APPSEC"]);
});

test("unreviewed relations, functions or write SQL in a probe fail closed",()=>{
 for(const sql of [
  "select * from auth.users",
  "select * from vendor_package_orders",
  "select pg_sleep(10) from pg_proc",
  "select current_setting('x') from pg_proc",
  "delete from public.vendor_package_orders"
 ])assert.throws(()=>deriveProbeGrantNeeds({id:"PX",sql}),/RC27_PROBE_|RC26_PROBE_NOT_READ_ONLY/);
});

test("installation dependency graph is deterministic, acyclic and gates install behind every step",()=>{
 const g=buildDependencyGraph(plan);
 assert.equal(g.executes,false);
 assert.equal(g.nodes.length,plan.steps.length+plan.readOnlyProbes.length);
 assert.equal(g.topologicalOrder.at(-1),"S08_FUTURE_INSTALL_PACKET");
 const pos=id=>g.topologicalOrder.indexOf(id);
 assert.ok(pos("P01_MANAGED_LEDGER_RECAPTURE")<pos("S00_FRESH_READ_ONLY_RECAPTURE"));
 assert.ok(pos("P03_V1_COLUMNS_PRESENT")<pos("P04_V1_NULL_CLAIM_EXPOSURE"));
 assert.ok(pos("P04_V1_NULL_CLAIM_EXPOSURE")<pos("S06_FINANCE_V1_DO_NOT_REPLAY"));
 assert.ok(pos("S02_BASELINE_CONTENT_ADJUDICATION")<pos("S07_HISTORICAL_GAP_ADJUDICATION"));
 const shuffled={...plan,steps:plan.steps.slice().reverse(),readOnlyProbes:plan.readOnlyProbes.slice().reverse()};
 assert.equal(buildDependencyGraph(shuffled).graphSha256,g.graphSha256);
 assert.deepEqual([...buildDependencyGraph(shuffled).topologicalOrder],[...g.topologicalOrder]);
});

test("graph cycles, dangling edges, unreviewed steps or an ungated install fail closed",()=>{
 const cyc={...RC27_STEP_EDGES,S00_FRESH_READ_ONLY_RECAPTURE:["S08_FUTURE_INSTALL_PACKET"]};
 assert.throws(()=>buildDependencyGraph(plan,cyc),/RC27_GRAPH_CYCLE/);
 const dangling={...RC27_STEP_EDGES,S03_RETIMESTAMPED_EQUIVALENCE:["S99_NOPE"]};
 assert.throws(()=>buildDependencyGraph(plan,dangling),/RC27_GRAPH_DANGLING/);
 const ungated={...RC27_STEP_EDGES,S08_FUTURE_INSTALL_PACKET:["S07_HISTORICAL_GAP_ADJUDICATION"]};
 assert.throws(()=>buildDependencyGraph(plan,ungated),/RC27_GRAPH_INSTALL_NOT_GATED_BY_/);
 const extra={...plan,steps:[...plan.steps,{...plan.steps[0],id:"S09_UNREVIEWED"}]};
 assert.throws(()=>buildDependencyGraph(extra),/RC27_GRAPH_STEP_UNREVIEWED_S09/);
});

test("SQL provenance binds every named file to the RC22 pin and never claims equivalence",()=>{
 const p=buildSqlProvenance(plan,localIo);
 assert.equal(p.fileCount,162);
 assert.equal(p.provenTooling,false);
 assert.equal(p.source.length,107);
 assert.ok(p.source.every(s=>/^[a-f0-9]{64}$/.test(s.sha256)));
 assert.equal(p.source.find(s=>s.class==="FINANCE_V1_REPLAY_HAZARD").provenance,"PINNED_DO_NOT_REPLAY");
 assert.deepEqual([...p.unresolved.managedOnly].length,2);
 assert.deepEqual([...p.unresolved.baseline],["20260722000100"]);
 assert.ok(p.staging.filter(s=>s.class==="RETIMESTAMPED_EXACT_NAME")
  .every(s=>s.provenance==="NAME_MATCH_ONLY_EQUIVALENCE_UNPROVEN"));
});

test("tampered, missing, extra or unsafely named SQL fails provenance closed",()=>{
 const tamper=name=>({listSqlFiles:localIo.listSqlFiles,
  readSql:n=>n===name?Buffer.from("-- edited\n"):localIo.readSql(n)});
 assert.throws(()=>buildSqlProvenance(plan,tamper(plan.source[5].file)),/RC27_SQL_PROVENANCE_AGGREGATE_DRIFT/);
 const files=localIo.listSqlFiles();
 assert.throws(()=>buildSqlProvenance(plan,{...localIo,listSqlFiles:()=>files.slice(1)}),/RC27_SQL_PROVENANCE_INVENTORY_DRIFT/);
 assert.throws(()=>buildSqlProvenance(plan,{...localIo,
  listSqlFiles:()=>[...files.filter(f=>/^\d{14}_/.test(f)).slice(1),"20990101000000_../../etc.sql"]}),
  /RC27_SQL_PROVENANCE_UNSAFE_NAME_/);
 assert.throws(()=>buildSqlProvenance(plan,{...localIo,readSql:()=>Buffer.alloc(0)}),/RC27_SQL_PROVENANCE_UNREADABLE_/);
 assert.throws(()=>localIo.readSql("../../package.json"),/RC27_SQL_PROVENANCE_UNSAFE_NAME_/);
});

test("rollback/recovery evidence template has every field null and all approvals null",()=>{
 const e=emptyRecoveryEvidence(plan.planSha256);
 assert.deepEqual(Object.keys(e.fields),Object.keys(RC27_RECOVERY_FIELDS));
 assert.ok(Object.values(e.fields).every(v=>v===null));
 assert.deepEqual({...e.approvals},{dba:null,owner:null,appsec:null,finance:null,platform:null});
 const v=validateRecoveryEvidence(e,plan.planSha256);
 assert.equal(v.evidenceComplete,false);
 assert.equal(v.missing.length,Object.keys(RC27_RECOVERY_FIELDS).length);
 assert.equal(v.grantsInstallAuthority,false);
});

test("complete reviewed evidence is accepted as review input yet grants no authority",()=>{
 const v=validateRecoveryEvidence(fullEvidence(),plan.planSha256);
 assert.equal(v.evidenceComplete,true);
 assert.equal(v.grantsInstallAuthority,false);
 assert.equal(v.approvalsPresent,false);
 const h=buildRc27MigrationHandoffValidation({evidence:fullEvidence()});
 assert.equal(h.status,"HOLD_EXTERNAL_EVIDENCE_REQUIRED");
 assert.equal(h.releaseGo,false);
 assert.equal(h.migrationsApplied,false);
});

test("evidence with approvals, unknown or malformed fields, stale plan or ledger mismatch fails closed",()=>{
 const mut=f=>{const e=fullEvidence();f(e);return e;};
 for(const [e,re] of [
  [mut(e=>{e.approvals.dba="dba@example"}),/RC27_EVIDENCE_APPROVAL_NOT_ACCEPTED_dba/],
  [mut(e=>{e.approvals.owner=true}),/RC27_EVIDENCE_APPROVAL_NOT_ACCEPTED_owner/],
  [mut(e=>{delete e.approvals.finance}),/RC27_EVIDENCE_APPROVAL_NOT_ACCEPTED_finance/],
  [mut(e=>{e.approvals.ceo=null}),/RC27_EVIDENCE_UNKNOWN_APPROVAL_ceo/],
  [mut(e=>{e.fields.releaseGo=true}),/RC27_EVIDENCE_UNKNOWN_FIELD_releaseGo/],
  [mut(e=>{delete e.fields.pitrRestorePointId}),/RC27_EVIDENCE_FIELD_ABSENT_pitrRestorePointId/],
  [mut(e=>{e.fields.logicalSchemaDumpSha256="xyz"}),/RC27_EVIDENCE_FIELD_MALFORMED_logicalSchemaDumpSha256/],
  [mut(e=>{e.fields.recoveryTimeObjectiveMinutes=0}),/RC27_EVIDENCE_FIELD_MALFORMED_recoveryTimeObjectiveMinutes/],
  [mut(e=>{e.fields.pitrRestorePointCapturedAt="yesterday"}),/RC27_EVIDENCE_FIELD_MALFORMED_pitrRestorePointCapturedAt/],
  [mut(e=>{e.fields.managedLedgerRecaptureSha256="0".repeat(64)}),/RC27_EVIDENCE_LEDGER_RECAPTURE_MISMATCH/],
  [mut(e=>{e.fields.restoreDrillCompletedAt="2026-10-30T00:00:00Z"}),/RC27_EVIDENCE_DRILL_BEFORE_RESTORE_POINT/],
  [mut(e=>{e.planSha256="0".repeat(64)}),/RC27_EVIDENCE_PLAN_SHA_MISMATCH/],
  [mut(e=>{e.schema="other"}),/RC27_EVIDENCE_SCHEMA_INVALID/]
 ])assert.throws(()=>validateRecoveryEvidence(e,plan.planSha256),re);
});

test("real handoff is deterministic HOLD and a forged handoff fails closed",()=>{
 const a=buildRc27MigrationHandoffValidation(),b=buildRc27MigrationHandoffValidation();
 assert.equal(a.handoffSha256,b.handoffSha256);
 assert.equal(assertHandoffNonExecuting(a),true);
 assert.equal(a.recovery.downMigrationsAvailable,false);
 assert.ok(a.forbiddenOperations.includes("supabase db push"));
 const forged=[
  {...a,releaseGo:true},{...a,migrationsApplied:true},{...a,status:"GO"},
  {...a,recovery:{...a.recovery,approvals:{...a.recovery.approvals,dba:"x"}}},
  {...a,grantAndOwnerNeeds:{...a.grantAndOwnerNeeds,probes:[{...a.grantAndOwnerNeeds.probes[0],grantedByTooling:true}]}},
  {...a,grantAndOwnerNeeds:{...a.grantAndOwnerNeeds,steps:[{...a.grantAndOwnerNeeds.steps[0],
   signatures:{QUALIFIED_DBA:"signed"}}]}},
  {...a,sqlProvenance:{...a.sqlProvenance,provenTooling:true}},
  {...a,dependencyGraph:{...a.dependencyGraph,executes:true}},
  {...a,handoffSha256:"0".repeat(64)}
 ];
 for(const f of forged)assert.throws(()=>assertHandoffNonExecuting(f),/RC27_HANDOFF_CLAIMS_AUTHORITY_/);
 assert.throws(()=>buildRc27HandoffValidation({plan:{...plan,releaseGo:true},snapshot:snapshot(),io:localIo}),
  /RC26_PLAN_CLAIMS_AUTHORITY_/);
});

test("validator refuses managed credentials and its source cannot connect, execute or apply",()=>{
 assert.throws(()=>assertNoManagedCredentials({DATABASE_URL:"postgres://x"}),/RC27_MANAGED_CREDENTIALS_PRESENT_DATABASE_URL/);
 assert.throws(()=>assertNoManagedCredentials({SUPABASE_SERVICE_ROLE_KEY:"k"}),/RC27_MANAGED_CREDENTIALS_PRESENT_/);
 assert.equal(assertNoManagedCredentials({}),true);
 const src=readFileSync(resolve(here,"rc27-migration-handoff-validation.mjs"),"utf8");
 for(const banned of [/from\s+["'](?:pg|postgres|@supabase\/[^"']+|node:child_process|node:net|node:http|node:https)["']/,
  /\bfetch\s*\(/,/\bspawn|\bexecSync|\bexecFile/,/\.query\s*\(/,/apply_migration\s*\(/])
  assert.doesNotMatch(src,banned);
});
