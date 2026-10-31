#!/usr/bin/env node
// RC27 Track D: NON-EXECUTING validation of the RC26 migration handoff plan.
// Reads the pinned read-only snapshot, the RC26 plan and local SQL text only.
// No network, credentials, SQL execution, migration ledger writes or DDL.
// An optional reviewed evidence file is validated for shape; it can never turn
// the handoff into installation authority and approvals must stay null.
import {readFileSync,readdirSync,writeFileSync} from "node:fs";
import {resolve,dirname} from "node:path";
import {fileURLToPath} from "node:url";
import {createHash} from "node:crypto";
import {RC24_MANAGED_SNAPSHOT_SHA256} from "./rc23-migration-adjudication.mjs";
import {RC22_PINNED_SOURCE} from "./rc22-migration-release-packet.mjs";
import {RC26_SNAPSHOT_PATH,RC26_LEGACY_V1_PATH,assertPlanNonExecuting,assertReadOnlyProbe,
 buildRc26MigrationReleasePlan} from "./rc26-migration-release-plan.mjs";
const root=resolve(dirname(fileURLToPath(import.meta.url)),"../../..");
const sha=b=>createHash("sha256").update(b).digest("hex");
const freeze=x=>Object.freeze(x);
const fail=code=>{throw Error("RC27_"+code)};
export const RC27_ARTIFACT_PATH="docs/vox/VOX-RC27-MIGRATION-HANDOFF-VALIDATION-HOLD-20261031.json";
export const RC27_MIGRATIONS_DIR="supabase/migrations";

// Reviewed pins of the RC26 classification. Any drift needs a deliberate
// human re-review and pin update; it never silently re-classifies.
export const RC27_EXPECTED_HISTORY=freeze({
 stagingOnly:31,sourceOnly:107,
 stagingCounts:freeze({STAGING_BASELINE_SQUASH:1,RETIMESTAMPED_EXACT_NAME:21,REPEATED_STAGING_NAME_REAPPLY:4,
  RETIMESTAMPED_NORMALISED_NAME_CANDIDATE:3,STAGING_ONLY_NO_SOURCE_FILE:2}),
 sourceCounts:freeze({PRE_BASELINE_PRESUMED_SQUASHED_UNVERIFIED:68,RETIMESTAMPED_ON_STAGING_CANDIDATE:26,
  FINANCE_V1_REPLAY_HAZARD:1,HISTORICAL_GAP_NOT_IN_MANAGED_LEDGER:12})
});
// Which step must own each class. Staging RETIMESTAMPED_* rows are covered
// through their single source candidate in S03, not by version.
const STAGING_OWNER=freeze({STAGING_BASELINE_SQUASH:"S02_BASELINE_CONTENT_ADJUDICATION",
 REPEATED_STAGING_NAME_REAPPLY:"S04_REPEATED_AND_AMBIGUOUS_STAGING",
 AMBIGUOUS_SOURCE_CANDIDATES:"S04_REPEATED_AND_AMBIGUOUS_STAGING",
 STAGING_ONLY_NO_SOURCE_FILE:"S05_STAGING_ONLY_SOURCE_RECOVERY",
 RETIMESTAMPED_EXACT_NAME:"S03_RETIMESTAMPED_EQUIVALENCE",
 RETIMESTAMPED_NORMALISED_NAME_CANDIDATE:"S03_RETIMESTAMPED_EQUIVALENCE"});
const SOURCE_OWNER=freeze({PRE_BASELINE_PRESUMED_SQUASHED_UNVERIFIED:"S02_BASELINE_CONTENT_ADJUDICATION",
 RETIMESTAMPED_ON_STAGING_CANDIDATE:"S03_RETIMESTAMPED_EQUIVALENCE",
 FINANCE_V1_REPLAY_HAZARD:"S06_FINANCE_V1_DO_NOT_REPLAY",
 HISTORICAL_GAP_NOT_IN_MANAGED_LEDGER:"S07_HISTORICAL_GAP_ADJUDICATION",
 APPEND_ONLY_CANDIDATE:"S08_FUTURE_INSTALL_PACKET"});

const tally=list=>list.reduce((m,x)=>(m[x.class]=(m[x.class]||0)+1,m),{});
const sameCounts=(a,b)=>{
 const ka=Object.keys(a).sort(),kb=Object.keys(b).sort();
 return ka.length===kb.length&&ka.every((k,i)=>k===kb[i]&&a[k]===b[k]);
};

export function validateClassifiedHistory(plan,snapshot,expected=RC27_EXPECTED_HISTORY){
 if(!plan||!snapshot||!Array.isArray(plan.staging)||!Array.isArray(plan.source)||!Array.isArray(plan.steps))
  fail("HISTORY_INPUT_INVALID");
 if(snapshot.staging_only_count!==snapshot.staging_only?.length||snapshot.source_only_count!==snapshot.source_only?.length)
  fail("SNAPSHOT_DECLARED_COUNT_MISMATCH");
 if(plan.staging.length!==expected.stagingOnly||plan.source.length!==expected.sourceOnly||
    snapshot.staging_only.length!==expected.stagingOnly||snapshot.source_only.length!==expected.sourceOnly)
  fail("CLASSIFIED_HISTORY_COUNT_DRIFT");
 const sv=new Set(plan.staging.map(s=>s.version)),sf=new Set(plan.source.map(s=>s.file));
 if(sv.size!==plan.staging.length||sf.size!==plan.source.length)fail("CLASSIFIED_HISTORY_DUPLICATE");
 // Plan rows must be exactly the captured rows: nothing added, dropped or renamed.
 const snapStaging=new Map(snapshot.staging_only.map(e=>[e.version,e.name]));
 if(plan.staging.some(s=>snapStaging.get(s.version)!==s.name)||
    !snapshot.source_only.every(f=>sf.has(f)))fail("CLASSIFIED_HISTORY_NOT_SNAPSHOT");
 for(const s of plan.staging)if(!STAGING_OWNER[s.class])fail("UNKNOWN_STAGING_CLASS_"+s.version);
 for(const s of plan.source)if(!SOURCE_OWNER[s.class])fail("UNKNOWN_SOURCE_CLASS_"+s.file);
 const stagingCounts=tally(plan.staging),sourceCounts=tally(plan.source);
 if(!sameCounts(stagingCounts,expected.stagingCounts)||!sameCounts(sourceCounts,expected.sourceCounts)||
    !sameCounts(stagingCounts,plan.stagingCounts||{})||!sameCounts(sourceCounts,plan.sourceCounts||{}))
  fail("CLASSIFIED_HISTORY_TALLY_DRIFT");

 // Coverage: every source file lands in exactly one step, the owning one.
 const owners=new Map();
 for(const st of plan.steps)for(const t of st.targets){
  const list=owners.get(t)||[];list.push(st.id);owners.set(t,list);
 }
 for(const s of plan.source){
  const o=owners.get(s.file)||[];
  if(o.length!==1||o[0]!==SOURCE_OWNER[s.class])fail("SOURCE_COVERAGE_"+s.file);
 }
 for(const s of plan.staging){
  const via=s.class.startsWith("RETIMESTAMPED_")?s.sourceCandidates[0]:s.version;
  if(s.class.startsWith("RETIMESTAMPED_")&&s.sourceCandidates.length!==1)fail("STAGING_COVERAGE_"+s.version);
  const o=owners.get(via)||[];
  if(o.length!==1||o[0]!==STAGING_OWNER[s.class])fail("STAGING_COVERAGE_"+s.version);
 }
 const canonical=JSON.stringify({staging:plan.staging.map(s=>[s.version,s.name,s.class]),
  source:plan.source.map(s=>[s.file,s.class])});
 return freeze({stagingOnly:plan.staging.length,sourceOnly:plan.source.length,
  stagingCounts:freeze(stagingCounts),sourceCounts:freeze(sourceCounts),
  everyRowCoveredExactlyOnce:true,classificationSha256:sha(canonical)});
}

// Query grant / owner needs. Derived lexically from the probe text and
// compared to a reviewed allowlist. Unknown relations or functions fail closed.
const CATALOG_RELATIONS=freeze({"pg_proc":"pg_catalog.pg_proc","pg_namespace":"pg_catalog.pg_namespace",
 "information_schema.columns":"information_schema.columns"});
const DATA_RELATIONS=freeze({
 "supabase_migrations.schema_migrations":freeze({rls:false,note:"Managed ledger; SELECT only. Never INSERT/UPDATE/DELETE."}),
 "public.vendor_package_orders":freeze({rls:true,note:"RLS-protected financial table; aggregate count needs a DBA-approved read path, never service_role from tooling."})
});
const READ_ONLY_FUNCTIONS=new Set(["md5","pg_get_functiondef","has_function_privilege","count"]);
const SQL_KEYWORDS=new Set(["select","from","where","and","or","in","as","on","join","order","by","like",
 "filter","is","not","null","with","group","having","limit"]);
export function deriveProbeGrantNeeds(probe){
 if(!probe||typeof probe.id!=="string")fail("PROBE_INPUT_INVALID");
 assertReadOnlyProbe(probe.sql);
 const unquoted=probe.sql.replace(/'(?:[^']|'')*'/g,"''");
 const relations=[...unquoted.matchAll(/\b(?:from|join)\s+([a-z_][a-z0-9_]*(?:\.[a-z_][a-z0-9_]*)?)/gi)]
  .map(m=>m[1].toLowerCase());
 if(!relations.length)fail("PROBE_NO_RELATION_"+probe.id);
 const grants=[];
 for(const r of [...new Set(relations)].sort()){
  if(CATALOG_RELATIONS[r])grants.push(freeze({object:CATALOG_RELATIONS[r],privilege:"SELECT",
   source:"DEFAULT_PUBLIC_CATALOG_READ",rls:false}));
  else if(DATA_RELATIONS[r])grants.push(freeze({object:r,privilege:"SELECT",
   schemaUsage:r.split(".")[0],source:"EXPLICIT_GRANT_REQUIRED",...DATA_RELATIONS[r]}));
  else fail("PROBE_RELATION_NOT_REVIEWED_"+probe.id+"_"+r);
 }
 const functions=[...new Set([...unquoted.matchAll(/\b([a-z_][a-z0-9_]*)\s*\(/gi)]
  .map(m=>m[1].toLowerCase()).filter(f=>!SQL_KEYWORDS.has(f)))].sort();
 for(const f of functions)if(!READ_ONLY_FUNCTIONS.has(f))fail("PROBE_FUNCTION_NOT_REVIEWED_"+probe.id+"_"+f);
 const needsRlsDecision=grants.some(g=>g.rls);
 return freeze({probeId:probe.id,grants:freeze(grants),functions:freeze(functions),
  executingRole:"DEDICATED_READ_ONLY_ROLE_UNDER_DBA_AUTHORITY",
  forbiddenRoles:freeze(["service_role","postgres","supabase_admin","authenticated","anon"]),
  queryOwner:"QUALIFIED_DBA",dataOwner:needsRlsDecision?"FINANCE_DATA_OWNER":"MANAGED_PLATFORM_OWNER",
  rlsBypassDecisionRequired:needsRlsDecision,grantedByTooling:false,executedByTooling:false});
}
const STEP_OWNERS=freeze({
 S00_FRESH_READ_ONLY_RECAPTURE:["QUALIFIED_DBA"],
 S01_RECOVERY_PRECONDITIONS:["MANAGED_PLATFORM_OWNER","QUALIFIED_DBA"],
 S02_BASELINE_CONTENT_ADJUDICATION:["QUALIFIED_DBA"],
 S03_RETIMESTAMPED_EQUIVALENCE:["QUALIFIED_DBA"],
 S04_REPEATED_AND_AMBIGUOUS_STAGING:["QUALIFIED_DBA"],
 S05_STAGING_ONLY_SOURCE_RECOVERY:["QUALIFIED_DBA","CODE_OWNER"],
 S06_FINANCE_V1_DO_NOT_REPLAY:["FINANCE_OWNER","QUALIFIED_DBA","INDEPENDENT_APPSEC"],
 S07_HISTORICAL_GAP_ADJUDICATION:["QUALIFIED_DBA"],
 S08_FUTURE_INSTALL_PACKET:["QUALIFIED_DBA","INDEPENDENT_APPSEC","PRODUCT_OWNER"]
});
export function buildGrantAndOwnerNeeds(plan){
 const probes=plan.readOnlyProbes.map(deriveProbeGrantNeeds);
 const steps=plan.steps.map(st=>{
  if(!STEP_OWNERS[st.id])fail("STEP_OWNER_UNKNOWN_"+st.id);
  return freeze({stepId:st.id,owners:freeze(STEP_OWNERS[st.id].slice()),
   signatures:freeze(Object.fromEntries(STEP_OWNERS[st.id].map(o=>[o,null])))});
 });
 return freeze({probes:freeze(probes),steps:freeze(steps)});
}

// Deterministic reviewed dependency graph. Step edges are reviewed constants;
// probe edges are derived from step targets and probe conditionalOn text.
export const RC27_STEP_EDGES=freeze({
 S00_FRESH_READ_ONLY_RECAPTURE:freeze([]),
 S01_RECOVERY_PRECONDITIONS:freeze(["S00_FRESH_READ_ONLY_RECAPTURE"]),
 S02_BASELINE_CONTENT_ADJUDICATION:freeze(["S00_FRESH_READ_ONLY_RECAPTURE","S01_RECOVERY_PRECONDITIONS"]),
 S03_RETIMESTAMPED_EQUIVALENCE:freeze(["S00_FRESH_READ_ONLY_RECAPTURE"]),
 S04_REPEATED_AND_AMBIGUOUS_STAGING:freeze(["S00_FRESH_READ_ONLY_RECAPTURE"]),
 S05_STAGING_ONLY_SOURCE_RECOVERY:freeze(["S00_FRESH_READ_ONLY_RECAPTURE"]),
 S06_FINANCE_V1_DO_NOT_REPLAY:freeze(["S00_FRESH_READ_ONLY_RECAPTURE"]),
 S07_HISTORICAL_GAP_ADJUDICATION:freeze(["S00_FRESH_READ_ONLY_RECAPTURE","S02_BASELINE_CONTENT_ADJUDICATION",
  "S03_RETIMESTAMPED_EQUIVALENCE"]),
 S08_FUTURE_INSTALL_PACKET:freeze(["S01_RECOVERY_PRECONDITIONS","S02_BASELINE_CONTENT_ADJUDICATION",
  "S03_RETIMESTAMPED_EQUIVALENCE","S04_REPEATED_AND_AMBIGUOUS_STAGING","S05_STAGING_ONLY_SOURCE_RECOVERY",
  "S06_FINANCE_V1_DO_NOT_REPLAY","S07_HISTORICAL_GAP_ADJUDICATION"])
});
const PROBE_ID=/\bP\d\d_[A-Z0-9_]+\b/g;
export function buildDependencyGraph(plan,stepEdges=RC27_STEP_EDGES){
 const probeIds=new Set(plan.readOnlyProbes.map(p=>p.id));
 const stepIds=new Set(plan.steps.map(s=>s.id));
 const deps=new Map();
 for(const p of plan.readOnlyProbes)
  deps.set(p.id,[...new Set((p.conditionalOn||"").match(PROBE_ID)||[])].filter(x=>x!==p.id));
 for(const st of plan.steps){
  if(!stepEdges[st.id])fail("GRAPH_STEP_UNREVIEWED_"+st.id);
  deps.set(st.id,[...new Set([...stepEdges[st.id],...st.targets.filter(t=>probeIds.has(t))])]);
 }
 for(const k of Object.keys(stepEdges))if(!stepIds.has(k))fail("GRAPH_EDGE_FOR_MISSING_STEP_"+k);
 for(const [n,list] of deps)for(const d of list)if(!deps.has(d))fail("GRAPH_DANGLING_"+n+"_"+d);
 // Kahn with lexicographic tie-break: deterministic regardless of input order.
 const indeg=new Map([...deps.keys()].map(k=>[k,deps.get(k).length]));
 const ready=[...indeg].filter(([,v])=>v===0).map(([k])=>k).sort();
 const order=[];
 while(ready.length){
  const n=ready.shift();order.push(n);
  for(const [m,list] of [...deps].sort(([a],[b])=>a<b?-1:1))if(list.includes(n)){
   indeg.set(m,indeg.get(m)-1);
   if(indeg.get(m)===0){ready.push(m);ready.sort();}
  }
 }
 if(order.length!==deps.size)fail("GRAPH_CYCLE");
 // The future install packet must transitively depend on every other step.
 const reach=(n,seen=new Set())=>{for(const d of deps.get(n))if(!seen.has(d)){seen.add(d);reach(d,seen);}return seen;};
 const closure=reach("S08_FUTURE_INSTALL_PACKET");
 for(const s of stepIds)if(s!=="S08_FUTURE_INSTALL_PACKET"&&!closure.has(s))fail("GRAPH_INSTALL_NOT_GATED_BY_"+s);
 if(!closure.has("P01_MANAGED_LEDGER_RECAPTURE"))fail("GRAPH_INSTALL_NOT_GATED_BY_RECAPTURE");
 const nodes=[...deps.keys()].sort().map(id=>freeze({id,kind:probeIds.has(id)?"READ_ONLY_PROBE":"PLAN_STEP",
  dependsOn:freeze(deps.get(id).slice().sort())}));
 return freeze({nodes:freeze(nodes),topologicalOrder:freeze(order),executes:false,
  graphSha256:sha(JSON.stringify(nodes))});
}

// Fail-closed SQL provenance. Every file the plan names must exist locally,
// match the RC22 pinned aggregate, and no row may claim proven equivalence.
const SAFE_SQL_NAME=/^\d{14}_[a-z0-9_]+\.sql$/;
export function buildSqlProvenance(plan,{listSqlFiles,readSql}){
 const all=listSqlFiles().filter(n=>/^\d{14}_.+\.sql$/.test(n)).sort();
 if(all.length!==RC22_PINNED_SOURCE.count)fail("SQL_PROVENANCE_INVENTORY_DRIFT");
 const hashes=new Map();
 for(const n of all){
  if(!SAFE_SQL_NAME.test(n))fail("SQL_PROVENANCE_UNSAFE_NAME_"+n);
  const body=readSql(n);
  if(!Buffer.isBuffer(body)||body.length===0)fail("SQL_PROVENANCE_UNREADABLE_"+n);
  hashes.set(n,sha(body));
 }
 const aggregate=sha(Buffer.from(all.map(n=>n+" "+hashes.get(n)).join("\n")));
 if(aggregate!==RC22_PINNED_SOURCE.aggregateSha256||aggregate!==plan.sourceAggregateSha256)
  fail("SQL_PROVENANCE_AGGREGATE_DRIFT");
 const legacy=RC26_LEGACY_V1_PATH.split("/").at(-1);
 if(hashes.get(legacy)!==RC22_PINNED_SOURCE.legacySha256||plan.legacyV1Sha256!==RC22_PINNED_SOURCE.legacySha256)
  fail("SQL_PROVENANCE_LEGACY_V1_DRIFT");
 const source=plan.source.map(s=>{
  if(!hashes.has(s.file))fail("SQL_PROVENANCE_MISSING_"+s.file);
  return freeze({file:s.file,class:s.class,sha256:hashes.get(s.file),
   provenance:s.class==="FINANCE_V1_REPLAY_HAZARD"?"PINNED_DO_NOT_REPLAY":"LOCAL_SOURCE_PINNED_APPLY_STATE_UNPROVEN"});
 });
 const staging=plan.staging.map(s=>{
  for(const c of s.sourceCandidates)if(!hashes.has(c))fail("SQL_PROVENANCE_MISSING_"+c);
  const provenance=s.class==="STAGING_BASELINE_SQUASH"?"BASELINE_CONTENT_UNKNOWN":
   s.class==="STAGING_ONLY_NO_SOURCE_FILE"?"MANAGED_ONLY_SQL_UNRECOVERED":
   s.sourceCandidates.length===1?"NAME_MATCH_ONLY_EQUIVALENCE_UNPROVEN":"AMBIGUOUS_UNPROVEN";
  return freeze({version:s.version,name:s.name,class:s.class,provenance,
   candidates:freeze(s.sourceCandidates.map(c=>freeze({file:c,sha256:hashes.get(c)})))});
 });
 for(const st of plan.steps)for(const t of st.targets)
  if(t.endsWith(".sql")&&!hashes.has(t))fail("SQL_PROVENANCE_STEP_TARGET_MISSING_"+t);
 const rows=[...source,...staging];
 if(rows.some(r=>/PROVEN$/.test(r.provenance)&&!/UNPROVEN$/.test(r.provenance)))fail("SQL_PROVENANCE_CLAIMS_PROOF");
 return freeze({aggregateSha256:aggregate,fileCount:all.length,provenTooling:false,
  unresolved:freeze({managedOnly:staging.filter(s=>s.provenance==="MANAGED_ONLY_SQL_UNRECOVERED").map(s=>s.version),
   baseline:staging.filter(s=>s.provenance==="BASELINE_CONTENT_UNKNOWN").map(s=>s.version)}),
  source:freeze(source),staging:freeze(staging)});
}

// Rollback/recovery evidence. Every field starts null; approvals are always
// null in tooling output and a reviewed evidence file cannot set them.
const HEX64=freeze({test:v=>typeof v==="string"&&/^[a-f0-9]{64}$/.test(v)});
const ISO=v=>typeof v==="string"&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(v)&&!isNaN(Date.parse(v));
const intIn=(lo,hi)=>v=>Number.isInteger(v)&&v>=lo&&v<=hi;
export const RC27_RECOVERY_FIELDS=freeze({
 pitrRestorePointId:v=>typeof v==="string"&&/^[A-Za-z0-9._:-]{1,128}$/.test(v),
 pitrRestorePointCapturedAt:ISO,
 logicalSchemaDumpSha256:v=>HEX64.test(v),
 authSchemaDumpSha256:v=>HEX64.test(v),
 storageSchemaDumpSha256:v=>HEX64.test(v),
 roleAndGrantInventorySha256:v=>HEX64.test(v),
 managedLedgerRecaptureSha256:v=>HEX64.test(v),
 restoreDrillCompletedAt:ISO,
 restoreDrillSchemaDiffSha256:v=>HEX64.test(v),
 forwardFixPacketSha256:v=>HEX64.test(v),
 recoveryTimeObjectiveMinutes:intIn(1,10080),
 dataLossWindowMinutes:intIn(0,1440)
});
export const RC27_APPROVAL_ROLES=freeze(["dba","owner","appsec","finance","platform"]);
export const RC27_EVIDENCE_SCHEMA="qf.vox.rc27.migration-recovery-evidence.v1";
export function emptyRecoveryEvidence(planSha256){
 return freeze({schema:RC27_EVIDENCE_SCHEMA,planSha256,
  fields:freeze(Object.fromEntries(Object.keys(RC27_RECOVERY_FIELDS).map(k=>[k,null]))),
  approvals:freeze(Object.fromEntries(RC27_APPROVAL_ROLES.map(k=>[k,null])))});
}
export function validateRecoveryEvidence(evidence,planSha256){
 if(!evidence||evidence.schema!==RC27_EVIDENCE_SCHEMA||typeof evidence.fields!=="object"||
    evidence.fields===null||typeof evidence.approvals!=="object"||evidence.approvals===null)
  fail("EVIDENCE_SCHEMA_INVALID");
 if(evidence.planSha256!==planSha256)fail("EVIDENCE_PLAN_SHA_MISMATCH");
 const known=Object.keys(RC27_RECOVERY_FIELDS);
 for(const k of Object.keys(evidence.fields))if(!known.includes(k))fail("EVIDENCE_UNKNOWN_FIELD_"+k);
 for(const k of known)if(!(k in evidence.fields))fail("EVIDENCE_FIELD_ABSENT_"+k);
 for(const k of Object.keys(evidence.approvals))if(!RC27_APPROVAL_ROLES.includes(k))fail("EVIDENCE_UNKNOWN_APPROVAL_"+k);
 for(const k of RC27_APPROVAL_ROLES)
  if(!(k in evidence.approvals)||evidence.approvals[k]!==null)fail("EVIDENCE_APPROVAL_NOT_ACCEPTED_"+k);
 for(const k of known){
  const v=evidence.fields[k];
  if(v!==null&&!RC27_RECOVERY_FIELDS[k](v))fail("EVIDENCE_FIELD_MALFORMED_"+k);
 }
 const f=evidence.fields;
 // A recapture that differs from the pinned snapshot voids the whole plan.
 if(f.managedLedgerRecaptureSha256!==null&&f.managedLedgerRecaptureSha256!==RC24_MANAGED_SNAPSHOT_SHA256)
  fail("EVIDENCE_LEDGER_RECAPTURE_MISMATCH");
 if(f.pitrRestorePointCapturedAt&&f.restoreDrillCompletedAt&&
    Date.parse(f.restoreDrillCompletedAt)<Date.parse(f.pitrRestorePointCapturedAt))
  fail("EVIDENCE_DRILL_BEFORE_RESTORE_POINT");
 const present=known.filter(k=>f[k]!==null),missing=known.filter(k=>f[k]===null);
 return freeze({present:freeze(present),missing:freeze(missing),
  evidenceComplete:missing.length===0,approvalsPresent:false,
  // Complete evidence is still review input only.
  grantsInstallAuthority:false});
}

export function assertHandoffNonExecuting(h){
 if(!h||h.status!=="HOLD_EXTERNAL_EVIDENCE_REQUIRED"||h.releaseGo!==false||h.managedWrites!==false||
    h.migrationsApplied!==false||h.installationClaimedSafe!==false)fail("HANDOFF_CLAIMS_AUTHORITY_STATUS");
 if(Object.values(h.recovery?.approvals||{}).some(v=>v!==null)||h.recovery?.validation?.grantsInstallAuthority!==false)
  fail("HANDOFF_CLAIMS_AUTHORITY_APPROVAL");
 for(const p of h.grantAndOwnerNeeds?.probes||[])
  if(p.grantedByTooling!==false||p.executedByTooling!==false)fail("HANDOFF_CLAIMS_AUTHORITY_PROBE_"+p.probeId);
 for(const s of h.grantAndOwnerNeeds?.steps||[])
  if(Object.values(s.signatures).some(v=>v!==null))fail("HANDOFF_CLAIMS_AUTHORITY_SIGNATURE_"+s.stepId);
 if(h.dependencyGraph?.executes!==false||h.sqlProvenance?.provenTooling!==false)fail("HANDOFF_CLAIMS_AUTHORITY_PROOF");
 const {handoffSha256,...rest}=h;
 if(handoffSha256!==sha(JSON.stringify(rest)))fail("HANDOFF_CLAIMS_AUTHORITY_HASH");
 return true;
}

export function buildRc27HandoffValidation({plan,snapshot,io,evidence=null}){
 assertPlanNonExecuting(plan);
 const history=validateClassifiedHistory(plan,snapshot);
 const grantAndOwnerNeeds=buildGrantAndOwnerNeeds(plan);
 const dependencyGraph=buildDependencyGraph(plan);
 const sqlProvenance=buildSqlProvenance(plan,io);
 const ev=evidence??emptyRecoveryEvidence(plan.planSha256);
 const validation=validateRecoveryEvidence(ev,plan.planSha256);
 const body={schema:"qf.vox.rc27.migration-handoff-validation.v1",status:"HOLD_EXTERNAL_EVIDENCE_REQUIRED",
  releaseGo:false,managedWrites:false,migrationsApplied:false,installationClaimedSafe:false,
  planSha256:plan.planSha256,snapshotSha256:RC24_MANAGED_SNAPSHOT_SHA256,
  history,grantAndOwnerNeeds,dependencyGraph,sqlProvenance,
  recovery:{fields:ev.fields,approvals:ev.approvals,validation,
   rollbackStrategy:"PITR_RESTORE_POINT_PLUS_REVIEWED_FORWARD_FIX",downMigrationsAvailable:false},
  forbiddenOperations:plan.forbiddenOperations};
 const h=freeze({...body,handoffSha256:sha(JSON.stringify(body))});
 assertHandoffNonExecuting(h);
 return h;
}

export const localIo=freeze({
 listSqlFiles:()=>readdirSync(resolve(root,RC27_MIGRATIONS_DIR)),
 readSql:name=>{
  if(!SAFE_SQL_NAME.test(name))fail("SQL_PROVENANCE_UNSAFE_NAME_"+name);
  return readFileSync(resolve(root,RC27_MIGRATIONS_DIR,name));
 }
});
// Refuse to run anywhere managed credentials are loaded, so this validator
// can never be mistaken for, or composed into, an applying tool.
const MANAGED_ENV=["DATABASE_URL","SUPABASE_DB_URL","SUPABASE_SERVICE_ROLE_KEY","SUPABASE_ACCESS_TOKEN","PGPASSWORD"];
export function assertNoManagedCredentials(env=process.env){
 const present=MANAGED_ENV.filter(k=>typeof env[k]==="string"&&env[k].length>0);
 if(present.length)fail("MANAGED_CREDENTIALS_PRESENT_"+present.join("_"));
 return true;
}
export function buildRc27MigrationHandoffValidation({evidence=null}={}){
 const plan=buildRc26MigrationReleasePlan();
 const snapshot=JSON.parse(readFileSync(resolve(root,RC26_SNAPSHOT_PATH),"utf8"));
 return buildRc27HandoffValidation({plan,snapshot,io:localIo,evidence});
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{
  assertNoManagedCredentials();
  const i=process.argv.indexOf("--evidence");
  if(i!==-1&&!process.argv[i+1])fail("EVIDENCE_PATH_REQUIRED");
  const evidence=i===-1?null:JSON.parse(readFileSync(resolve(process.argv[i+1]),"utf8"));
  const h=buildRc27MigrationHandoffValidation({evidence});
  if(process.argv.includes("--template"))
   console.log(JSON.stringify(emptyRecoveryEvidence(h.planSha256),null,2));
  if(process.argv.includes("--write")){
   if(evidence)fail("WRITE_REFUSED_WITH_EVIDENCE");
   writeFileSync(resolve(root,RC27_ARTIFACT_PATH),JSON.stringify(h,null,2)+"\n");
  }
  console.log("VOX_RC27_MIGRATION_HANDOFF_VALIDATION_HOLD "+JSON.stringify({
   status:h.status,releaseGo:h.releaseGo,migrationsApplied:h.migrationsApplied,
   handoffSha256:h.handoffSha256,planSha256:h.planSha256,
   history:{staging:h.history.stagingOnly,source:h.history.sourceOnly},
   graphSha256:h.dependencyGraph.graphSha256,sqlAggregateSha256:h.sqlProvenance.aggregateSha256,
   unresolved:h.sqlProvenance.unresolved,evidenceMissing:h.recovery.validation.missing.length}));
 }catch(e){
  console.error("VOX_RC27_MIGRATION_HANDOFF_VALIDATION_FAIL "+e.message);
  process.exit(1);
 }
}
