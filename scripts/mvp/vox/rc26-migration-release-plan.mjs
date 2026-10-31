#!/usr/bin/env node
// RC26 Track D: deterministic PLAN-ONLY migration release engineering handoff.
// Reads pinned, previously captured READ-ONLY evidence and local SQL text only.
// No network, credentials, SQL execution, migration ledger writes or DDL.
// Output is review input for a qualified DBA, never installation authority.
import {readFileSync,writeFileSync} from "node:fs";
import {resolve,dirname} from "node:path";
import {fileURLToPath} from "node:url";
import {createHash} from "node:crypto";
import {RC24_MANAGED_SNAPSHOT_SHA256,buildRc23HistoryPacket} from "./rc23-migration-adjudication.mjs";
import {RC22_PINNED_SOURCE} from "./rc22-migration-release-packet.mjs";
const root=resolve(dirname(fileURLToPath(import.meta.url)),"../../..");
const sha=b=>createHash("sha256").update(b).digest("hex");
export const RC26_SNAPSHOT_PATH="docs/vox/VOX-MANAGED-STAGING-MIGRATION-DRIFT-READONLY-20261031.json";
export const RC26_LEGACY_V1_PATH="supabase/migrations/20260912010000_qf_vendor_package_razorpay_testmode.sql";
export const RC26_ARTIFACT_PATH="docs/vox/VOX-RC26-MIGRATION-RELEASE-PLAN-HOLD-20261031.json";
const BASELINE_NAME=/^qf_mvp_staging_baseline_[0-9a-f]{8}$/;

// Commands that would mutate a managed ledger or replay history. The plan may
// name them only inside forbiddenOperations, never inside a step.
export const RC26_FORBIDDEN_OPERATIONS=Object.freeze([
 "supabase db push",
 "supabase db push --include-all",
 "supabase migration repair",
 "supabase db reset --linked",
 "apply_migration (managed connector)",
 "direct INSERT/UPDATE/DELETE on supabase_migrations.schema_migrations",
 "in-place edit of historical supabase/migrations/*.sql"
]);

const stem=file=>file.slice(15,-4);
// Staging was sometimes applied through connectors with a staging suffix or a
// ticket prefix. Normalisation only proposes a candidate; it is never equality.
const normalise=n=>n.replace(/_staging(?:_\d{8})?$/,"");
const boundarySuffix=(a,b)=>a===b||a.endsWith("_"+b)||b.endsWith("_"+a);
const tokens=n=>n.split("_").filter(Boolean).length;

export function classifyCapturedHistory(snapshot){
 const bad=()=>{throw Error("RC26_CAPTURED_HISTORY_INVALID")};
 if(!snapshot||snapshot.schema!=="qf.vox.staging-migration-drift/read-only-v1"||
    snapshot.managed_writes!==false||snapshot.not_a_deploy_plan!==true||
    !Array.isArray(snapshot.staging_only)||!Array.isArray(snapshot.source_only)||
    !Array.isArray(snapshot.common_versions))return bad();
 const stagingOnly=snapshot.staging_only.slice().sort((a,b)=>a.version<b.version?-1:1);
 const sourceOnly=snapshot.source_only.slice().sort();
 const latest=[...stagingOnly,...snapshot.common_versions].map(e=>e.version).sort().at(-1);
 const baselines=stagingOnly.filter(e=>BASELINE_NAME.test(e.name));
 if(baselines.length!==1)return bad();
 const baselineVersion=baselines[0].version;
 const nameCount=new Map();
 for(const e of stagingOnly)nameCount.set(e.name,(nameCount.get(e.name)||0)+1);

 const sourceMatches=new Map();
 const staging=stagingOnly.map(e=>{
  if(e===baselines[0])return Object.freeze({version:e.version,name:e.name,
   class:"STAGING_BASELINE_SQUASH",sourceCandidates:Object.freeze([]),
   dbaQuestion:"Which source files does the baseline physically contain? Requires catalog diff, not version inference."});
  const exact=sourceOnly.filter(f=>stem(f)===e.name);
  const norm=normalise(e.name);
  const loose=exact.length?[]:sourceOnly.filter(f=>tokens(norm)>=3&&tokens(stem(f))>=3&&
   boundarySuffix(norm,stem(f)));
  const candidates=exact.length?exact:loose;
  let cls;
  if(candidates.length>1)cls="AMBIGUOUS_SOURCE_CANDIDATES";
  else if(candidates.length===0)cls="STAGING_ONLY_NO_SOURCE_FILE";
  else if(nameCount.get(e.name)>1)cls="REPEATED_STAGING_NAME_REAPPLY";
  else cls=exact.length?"RETIMESTAMPED_EXACT_NAME":"RETIMESTAMPED_NORMALISED_NAME_CANDIDATE";
  if(candidates.length===1){
   const list=sourceMatches.get(candidates[0])||[];
   list.push(e.version);sourceMatches.set(candidates[0],list);
  }
  return Object.freeze({version:e.version,name:e.name,class:cls,
   sourceCandidates:Object.freeze(candidates.slice()),
   dbaQuestion:cls==="STAGING_ONLY_NO_SOURCE_FILE"
    ?"Managed-only change with no source file: recover its SQL from the managed ledger statements before any release."
    :"Compare managed applied statements/function hashes to the candidate source SQL; a name match proves nothing."});
 });

 const source=sourceOnly.map(f=>{
  const version=f.slice(0,14);
  let cls;
  if(f===RC26_LEGACY_V1_PATH.split("/").at(-1))cls="FINANCE_V1_REPLAY_HAZARD";
  else if(sourceMatches.has(f))cls="RETIMESTAMPED_ON_STAGING_CANDIDATE";
  else if(version<baselineVersion)cls="PRE_BASELINE_PRESUMED_SQUASHED_UNVERIFIED";
  else if(version<=latest)cls="HISTORICAL_GAP_NOT_IN_MANAGED_LEDGER";
  else cls="APPEND_ONLY_CANDIDATE";
  return Object.freeze({file:f,version,class:cls,
   stagingVersions:Object.freeze((sourceMatches.get(f)||[]).slice())});
 });

 // Retimestamped applies may change relative order versus source. Any
 // inversion means source replay order was not what staging executed.
 const pairs=staging.filter(s=>s.sourceCandidates.length===1)
  .map(s=>({sv:s.version,src:s.sourceCandidates[0]}));
 const orderInversions=[];
 for(let i=0;i<pairs.length;i++)for(let j=i+1;j<pairs.length;j++)
  if(pairs[i].src>pairs[j].src)orderInversions.push(Object.freeze([pairs[i].src,pairs[j].src]));

 const tally=list=>Object.freeze(list.reduce((m,x)=>(m[x.class]=(m[x.class]||0)+1,m),{}));
 return Object.freeze({baselineVersion,latestManagedVersion:latest,
  staging:Object.freeze(staging),source:Object.freeze(source),
  stagingCounts:tally(staging),sourceCounts:tally(source),
  orderInversions:Object.freeze(orderInversions)});
}

// Static, read-only lexical scan of the historical Razorpay V1 SQL. It does
// not parse or run SQL; the disposable PG17 proof is validate-vox-rc21-*.
export function scanLegacyRazorpayV1(sqlText){
 if(typeof sqlText!=="string"||!sqlText.includes("qf_claim_vendor_package_razorpay_order_v1"))
  throw Error("RC26_LEGACY_V1_SOURCE_NOT_RECOGNISED");
 const text=sqlText.replace(/\r\n/g,"\n");
 const fn=[...text.matchAll(/create or replace function (public\.[a-z0-9_]+)\(/g)];
 const functions=fn.map((m,i)=>{
  const body=text.slice(m.index,i+1<fn.length?fn[i+1].index:text.length);
  const opener=body.match(/\nas (\$[A-Za-z_]*\$|\$)\n/);
  return Object.freeze({name:m[1],quote:opener?opener[1]:null,
   invalidSingleDollarQuote:!!opener&&opener[1]==="$"});
 });
 const claim=text.match(/create or replace function public\.qf_claim_vendor_package_razorpay_order_v1\([\s\S]*?\n\$\$?;/);
 // The second unconditional check rejects a NULL stored token (first claim),
 // because NULL IS DISTINCT FROM <token> is true in PostgreSQL.
 const nullFirstClaimDenied=!!claim&&
  /\n\s*if v_order\.provider_order_request_token is distinct from p_request_token then\s*\n\s*raise exception 'PROVIDER_ORDER_REQUEST_TOKEN_MISMATCH'/.test(claim[0])&&
  !/provider_order_request_token is null\s*then[\s\S]{0,200}update public\.vendor_package_orders/.test(claim[0]);
 const transactional=/^begin;\s*$/m.test(text)&&/^commit;\s*$/m.test(text);
 const invalid=functions.filter(f=>f.invalidSingleDollarQuote).map(f=>f.name);
 return Object.freeze({
  sha256:sha(sqlText),functions:Object.freeze(functions),
  invalidSingleDollarFunctions:Object.freeze(invalid),
  replayParserHazard:invalid.length>0,
  nullFirstClaimHazard:nullFirstClaimDenied,
  wrappedInExplicitTransaction:transactional,
  dangers:Object.freeze([
   ...(invalid.length?["REPLAY_ABORTS_AT_SYNTAX_ERROR_SINGLE_DOLLAR_QUOTE"]:[]),
   ...(nullFirstClaimDenied?["FIRST_CLAIM_ALWAYS_MISMATCH_IF_PARSER_HAND_FIXED"]:[]),
   "IN_PLACE_SOURCE_FIX_CHANGES_PINNED_SHA_AND_HIDES_HISTORY",
   "PARTIAL_PRIOR_APPLY_STATE_MUST_BE_PROVEN_ABSENT_READ_ONLY"
  ])
 });
}

// Read-only catalog probes for a DBA to run under their own authority. This
// tool never runs them. Each probe is validated as single SELECT/WITH text.
const WRITE_WORDS=/\b(insert|update|delete|merge|alter|drop|create|grant|revoke|truncate|copy|call|do|execute|set|reset|begin|commit|rollback|vacuum|analyze|refresh|lock|comment|security|cluster|reindex|listen|notify|prepare|savepoint|import)\b/i;
export function assertReadOnlyProbe(sql){
 if(typeof sql!=="string")throw Error("RC26_PROBE_NOT_READ_ONLY");
 const body=sql.trim().replace(/;$/,"");
 const unquoted=body.replace(/'(?:[^']|'')*'/g,"''");
 if(!/^(select|with)\b/i.test(body)||unquoted.includes(";")||WRITE_WORDS.test(unquoted)||
    /\bpg_(?:read|write|ls)_|\blo_|\bdblink|\bpg_terminate|\bpg_cancel|\bset_config|\bnextval|\bsetval/i.test(unquoted))
  throw Error("RC26_PROBE_NOT_READ_ONLY");
 return true;
}
export function buildReadOnlyProbes(){
 const probes=[
  {id:"P01_MANAGED_LEDGER_RECAPTURE",purpose:"Recapture version/name ledger and compare to pinned snapshot before any decision.",
   sql:"select version, name from supabase_migrations.schema_migrations order by version"},
  {id:"P02_V1_FUNCTION_PRESENCE_AND_HASH",purpose:"Prove whether any V1 Razorpay function exists and with which definition.",
   sql:"select p.oid::regprocedure::text as signature, md5(pg_get_functiondef(p.oid)) as def_md5 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname like 'qf\\_%razorpay%' order by 1"},
  {id:"P03_V1_COLUMNS_PRESENT",purpose:"Detect partial prior apply of the V1 column expansion.",
   sql:"select column_name, data_type from information_schema.columns where table_schema = 'public' and table_name = 'vendor_package_orders' and column_name in ('provider_amount_subunits','provider_receipt','provider_order_request_token','provider_order_requested_at') order by 1"},
  {id:"P04_V1_NULL_CLAIM_EXPOSURE",purpose:"Only if P03 shows the token column: count unbound created orders that a V1 first claim would reject.",
   conditionalOn:"P03_V1_COLUMNS_PRESENT includes provider_order_request_token",
   sql:"select count(*) filter (where provider_order_request_token is null) as null_token_unbound, count(*) filter (where provider_order_request_token is not null) as token_held_unbound from public.vendor_package_orders where provider_order_id is null and order_status = 'created'"},
  {id:"P05_V1_EXECUTE_GRANTS",purpose:"Confirm no client role could reach any V1 function.",
   sql:"select p.oid::regprocedure::text as signature, has_function_privilege('anon', p.oid, 'EXECUTE') as anon_exec, has_function_privilege('authenticated', p.oid, 'EXECUTE') as auth_exec from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname like 'qf\\_%razorpay%' order by 1"}
 ];
 for(const p of probes)assertReadOnlyProbe(p.sql);
 return Object.freeze(probes.map(p=>Object.freeze({...p,executedByTooling:false})));
}

const NO_APPROVAL=Object.freeze({dba:null,owner:null,appsec:null,finance:null});
const step=(id,kind,targets,requires,rollback)=>Object.freeze({id,kind,mode:"PLAN_ONLY",executes:false,
 targets:Object.freeze(targets.slice().sort()),requires:Object.freeze(requires),
 approvals:NO_APPROVAL,rollback:Object.freeze(rollback)});
const READ_ONLY_RB={strategy:"NONE_REQUIRED_READ_ONLY",note:"Step performs no writes."};
const DEFERRED_RB={strategy:"PITR_RESTORE_POINT_PLUS_REVIEWED_FORWARD_FIX",
 note:"Supabase migrations have no down scripts. Any future install needs a recorded PITR point, logical dump and a separately reviewed forward-fix; none exists in this plan."};

export function buildReviewedInstallPlan(classification,v1Scan,probes){
 if(!classification||!v1Scan||!Array.isArray(probes))throw Error("RC26_PLAN_INPUT_INVALID");
 const by=(list,cls,key)=>list.filter(x=>x.class===cls).map(x=>x[key]);
 const s=classification.staging,f=classification.source;
 const steps=[
  step("S00_FRESH_READ_ONLY_RECAPTURE","EVIDENCE",["P01_MANAGED_LEDGER_RECAPTURE"],
   ["Recaptured ledger must equal pinned snapshot sha256 "+RC24_MANAGED_SNAPSHOT_SHA256+" or this plan is void"],READ_ONLY_RB),
  step("S01_RECOVERY_PRECONDITIONS","EVIDENCE",["PITR_RESTORE_POINT","LOGICAL_SCHEMA_AUTH_STORAGE_DUMP","ROLE_AND_GRANT_INVENTORY"],
   ["Evidence from managed platform owner; not producible by this tool"],READ_ONLY_RB),
  step("S02_BASELINE_CONTENT_ADJUDICATION","DBA_REVIEW",
   [...by(s,"STAGING_BASELINE_SQUASH","version"),...by(f,"PRE_BASELINE_PRESUMED_SQUASHED_UNVERIFIED","file")],
   ["Catalog object diff baseline vs pre-baseline source; version ordering is not evidence"],READ_ONLY_RB),
  step("S03_RETIMESTAMPED_EQUIVALENCE","DBA_REVIEW",
   [...by(f,"RETIMESTAMPED_ON_STAGING_CANDIDATE","file")],
   ["Applied statement or function-definition hash comparison per pair",
    "Order inversions recorded: "+classification.orderInversions.length],READ_ONLY_RB),
  step("S04_REPEATED_AND_AMBIGUOUS_STAGING","DBA_REVIEW",
   [...by(s,"REPEATED_STAGING_NAME_REAPPLY","version"),...by(s,"AMBIGUOUS_SOURCE_CANDIDATES","version")],
   ["Determine which reapply is authoritative and whether the earlier one partially applied"],READ_ONLY_RB),
  step("S05_STAGING_ONLY_SOURCE_RECOVERY","DBA_REVIEW",
   [...by(s,"STAGING_ONLY_NO_SOURCE_FILE","version")],
   ["Recover SQL into reviewed source before any release; never re-derive by guess"],READ_ONLY_RB),
  step("S06_FINANCE_V1_DO_NOT_REPLAY","FINANCE_HOLD",
   [...by(f,"FINANCE_V1_REPLAY_HAZARD","file"),"P02_V1_FUNCTION_PRESENCE_AND_HASH","P03_V1_COLUMNS_PRESENT",
    "P04_V1_NULL_CLAIM_EXPOSURE","P05_V1_EXECUTE_GRANTS"],
   ["Historical V1 must not be replayed or hand-fixed in place",
    "V2 review candidate stays uninstalled until Finance+DBA+AppSec adjudication",
    ...v1Scan.dangers],READ_ONLY_RB),
  step("S07_HISTORICAL_GAP_ADJUDICATION","DBA_REVIEW",
   [...by(f,"HISTORICAL_GAP_NOT_IN_MANAGED_LEDGER","file")],
   ["Per file: prove objects absent/present read-only; out-of-order replay is forbidden"],READ_ONLY_RB),
  step("S08_FUTURE_INSTALL_PACKET","DEFERRED",
   [...by(f,"APPEND_ONLY_CANDIDATE","file")],
   ["Separate reviewed packet per migration after S00-S07 close with real external signatures"],DEFERRED_RB)
 ];
 const body={schema:"qf.vox.rc26.migration-release-plan.v1",status:"HOLD_EXTERNAL_EVIDENCE_REQUIRED",
  releaseGo:false,managedWrites:false,installationClaimedSafe:false,
  snapshotSha256:RC24_MANAGED_SNAPSHOT_SHA256,sourceAggregateSha256:RC22_PINNED_SOURCE.aggregateSha256,
  legacyV1Sha256:v1Scan.sha256,
  baselineVersion:classification.baselineVersion,latestManagedVersion:classification.latestManagedVersion,
  stagingCounts:classification.stagingCounts,sourceCounts:classification.sourceCounts,
  orderInversions:classification.orderInversions,
  staging:classification.staging,source:classification.source,
  legacyV1:{replayParserHazard:v1Scan.replayParserHazard,nullFirstClaimHazard:v1Scan.nullFirstClaimHazard,
   invalidSingleDollarFunctions:v1Scan.invalidSingleDollarFunctions,
   wrappedInExplicitTransaction:v1Scan.wrappedInExplicitTransaction},
  readOnlyProbes:probes,steps,forbiddenOperations:RC26_FORBIDDEN_OPERATIONS,
  externalBlockers:[
   "QUALIFIED_DBA_ADJUDICATION_NOT_PRESENT",
   "FRESH_READ_ONLY_MANAGED_LEDGER_RECAPTURE_NOT_PRESENT",
   "PITR_AND_LOGICAL_DUMP_EVIDENCE_NOT_PRESENT",
   "FINANCE_V1_V2_ADJUDICATION_NOT_PRESENT",
   "INDEPENDENT_APPSEC_AND_OWNER_STAGING_GO_NOT_PRESENT"
  ]};
 const canonical=JSON.stringify(body);
 const plan=Object.freeze({...body,planSha256:sha(canonical)});
 assertPlanNonExecuting(plan);
 return plan;
}

// Fails closed if a plan was edited to look like authority.
export function assertPlanNonExecuting(plan){
 const fail=r=>{throw Error("RC26_PLAN_CLAIMS_AUTHORITY_"+r)};
 if(!plan||plan.releaseGo!==false||plan.managedWrites!==false||plan.installationClaimedSafe!==false||
    plan.status!=="HOLD_EXTERNAL_EVIDENCE_REQUIRED")fail("STATUS");
 for(const st of plan.steps||[]){
  if(st.executes!==false||st.mode!=="PLAN_ONLY")fail("EXECUTES_"+st.id);
  if(Object.values(st.approvals||{}).some(v=>v!==null))fail("APPROVAL_"+st.id);
  const text=JSON.stringify(st).toLowerCase();
  if(/db push|migration repair|db reset|apply_migration|schema_migrations/.test(text))fail("COMMAND_"+st.id);
 }
 for(const p of plan.readOnlyProbes||[]){
  if(p.executedByTooling!==false)fail("PROBE_EXECUTED_"+p.id);
  assertReadOnlyProbe(p.sql);
 }
 const {planSha256,...rest}=plan;
 if(planSha256!==sha(JSON.stringify(rest)))fail("PLAN_HASH");
 return true;
}

export function buildRc26MigrationReleasePlan(){
 // Re-verifies snapshot sha pin, 162-file source pin, legacy and V2 pins.
 const history=buildRc23HistoryPacket();
 const snapshot=JSON.parse(readFileSync(resolve(root,RC26_SNAPSHOT_PATH),"utf8"));
 const classification=classifyCapturedHistory(snapshot);
 if(classification.latestManagedVersion!==history.latestManagedVersion)
  throw Error("RC26_RC23_LINEAGE_DISAGREEMENT");
 const v1=scanLegacyRazorpayV1(readFileSync(resolve(root,RC26_LEGACY_V1_PATH),"utf8"));
 if(v1.sha256!==RC22_PINNED_SOURCE.legacySha256)throw Error("RC26_LEGACY_V1_SHA_DRIFT");
 return buildReviewedInstallPlan(classification,v1,buildReadOnlyProbes());
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const plan=buildRc26MigrationReleasePlan();
 if(process.argv.includes("--write"))
  writeFileSync(resolve(root,RC26_ARTIFACT_PATH),JSON.stringify(plan,null,2)+"\n");
 console.log("VOX_RC26_MIGRATION_RELEASE_PLAN_HOLD "+JSON.stringify({
  status:plan.status,releaseGo:plan.releaseGo,planSha256:plan.planSha256,
  stagingCounts:plan.stagingCounts,sourceCounts:plan.sourceCounts,
  orderInversions:plan.orderInversions.length,legacyV1:plan.legacyV1}));
}
