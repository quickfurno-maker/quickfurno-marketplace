#!/usr/bin/env node
// RC38 d-db: deterministic OFFLINE staged-migration dry-run with rollback/recovery transition
// candidates. Built only from RC37 digest-verified evidence (managed ledger export + real SQL
// bytes on disk + verified aliases). It opens no connection, executes no SQL, writes no ledger and
// never promotes quarantined/pinned/review-only SQL. `releaseGo` is always false; the output is
// input for an independent DBA decision, not authorization. No timestamps are hashed.
//
// Stages are emitted ONLY when evidence is complete and no protected SQL is present. Rollback and
// recovery transitions are emitted per stage ONLY from an externally reviewed manifest whose
// forward digest equals the recomputed source digest; this module never invents down-SQL.
import {readFileSync,writeFileSync,readdirSync,statSync} from "node:fs";
import {resolve,join,dirname} from "node:path";
import {createHash} from "node:crypto";
import {fileURLToPath} from "node:url";
import {buildEvidencePackage} from "./rc37-migration-evidence-package.mjs";
import {canonicalSqlDigest} from "./rc35-migration-inventory-reconcile.mjs";
import {pendingClass} from "./d-db-release-preflight.mjs";

export const RC38_SCHEMA="qf.vox.rc38.staged-migration-dryrun.v1";
const here=dirname(fileURLToPath(import.meta.url));
const repoRoot=resolve(here,"../../..");
const DIGEST_RE=/^[0-9a-f]{64}$/;
const VERSION_RE=/^\d{14}$/;
const SQL_RE=/\.sql$/i;
const SECRET_RE=/postgres(?:ql)?:\/\/[^\s"'@]*:[^\s"'@]+@|eyJ[\w-]{20,}\.[\w-]{10,}\.|sk_(?:live|test)_\w{8,}|service_role/i;
const sha=b=>createHash("sha256").update(b).digest("hex");
const cmp=(a,b)=>a<b?-1:a>b?1:0;
const bad=code=>{throw Error("RC38_"+code)};

// Repo roots whose every SQL file is quarantined/pinned/review-only. Matched by digest so a copied
// or renamed protected file cannot pose as an append candidate.
export const PROTECTED_ROOTS=Object.freeze([
 "ops/vox/quarantined-migrations","ops/vox/sql-candidates","ops/vox/identity-attestation-overlay",
 "ops/vox/rc4-approval-overlay","ops/vox/rc7-review-candidates","ops/vox/rc17-review-candidates",
 "ops/vox/rc32-review-candidates","ops/vox/rc37-review-candidates","ops/security/sql-candidates"
]);

function walkSql(dir){
 let st;try{st=statSync(dir);}catch{return [];}
 if(!st.isDirectory())return [];
 return readdirSync(dir,{withFileTypes:true}).sort((a,b)=>cmp(a.name,b.name)).flatMap(d=>
  d.isDirectory()?walkSql(join(dir,d.name)):SQL_RE.test(d.name)?[join(dir,d.name)]:[]);
}
export function protectedDigestIndex(root=repoRoot,roots=PROTECTED_ROOTS){
 const idx=new Map();
 for(const r of roots)for(const f of walkSql(join(root,r))){
  const d=canonicalSqlDigest(readFileSync(f));
  idx.set(d,[...(idx.get(d)||[]),r+"/"+f.slice(join(root,r).length+1).replace(/\\/g,"/")]);
 }
 return idx;
}

// Reviewed rollback manifest: [{version,forwardSha256,rollbackSha256,transactional,reviewedBy,basis}].
export function validateRollbackManifest(input,appendCandidates){
 const list=input===undefined?[]:Array.isArray(input)?input:input?.rollbacks;
 if(!Array.isArray(list))bad("ROLLBACK_MANIFEST_SHAPE");
 const byV=new Map(appendCandidates.map(c=>[c.version,c]));
 const seen=new Set(),out=new Map();
 for(const r of list){
  if(!r||!VERSION_RE.test(r.version||""))bad("ROLLBACK_ENTRY_INVALID");
  for(const k of ["reviewedBy","basis"])if(typeof r[k]!=="string"||!r[k].trim())bad("ROLLBACK_ATTESTATION_MISSING");
  if(typeof r.transactional!=="boolean")bad("ROLLBACK_TRANSACTIONAL_FLAG_MISSING");
  if(seen.has(r.version))bad("ROLLBACK_DUPLICATE");
  seen.add(r.version);
  const c=byV.get(r.version);
  if(!c)bad("ROLLBACK_VERSION_NOT_A_CANDIDATE");
  if(!DIGEST_RE.test(r.forwardSha256||"")||!DIGEST_RE.test(r.rollbackSha256||""))bad("DIGEST_MALFORMED");
  if(r.forwardSha256!==c.sha256)bad("ROLLBACK_FORWARD_DIGEST_MISMATCH");
  if(r.rollbackSha256===r.forwardSha256)bad("ROLLBACK_DIGEST_EQUALS_FORWARD");
  out.set(r.version,{rollbackSha256:r.rollbackSha256,transactional:r.transactional,
   reviewedBy:r.reviewedBy.trim(),basis:r.basis.trim()});
 }
 return out;
}

const stateOf=entries=>{
 const rows=[...entries].sort((a,b)=>cmp(a.version,b.version)||cmp(a.sha256,b.sha256)).map(e=>e.version+":"+e.sha256);
 return {versions:rows.length,stateSha256:sha(rows.join("\n"))};
};

export function buildStagedDryRun({managedText,sourceDir,aliasInput,rollbackInput,repoRootDir=repoRoot,protectedRoots=PROTECTED_ROOTS}){
 if(typeof rollbackInput==="string"&&SECRET_RE.test(rollbackInput))bad("SECRET_IN_INPUT");
 const evidence=buildEvidencePackage({managedText,sourceDir,aliasInput});
 const rec=evidence.reconciliation;
 const srcByFile=new Map(evidence.source.map(s=>[s.file,s]));
 const idx=protectedDigestIndex(repoRootDir,protectedRoots);

 const blocked=[];
 const block=(code,subject,detail,requiredExternalInput)=>
  blocked.push({code,subject,detail:detail||"",requiredExternalInput:requiredExternalInput||null});

 // Protected SQL (path- or digest-identified) is never staged.
 const protectedHits=evidence.source.filter(s=>idx.has(s.canonicalSha256)||pendingClass(sourceDir.replace(/\\/g,"/")+"/"+s.file));
 for(const s of protectedHits)
  block("PROTECTED_SQL_NOT_STAGEABLE",s.file,(idx.get(s.canonicalSha256)||["pending path"]).join(","),"none: protected SQL stays review-only; use its own reviewed promotion process");
 const protectedFiles=new Set(protectedHits.map(s=>s.file));

 for(const b of rec.blockers)block("RECONCILIATION_"+b.code,b.subject,b.detail,
  {MANAGED_ONLY_NO_SOURCE_SQL:"managed ledger statements for the managed-only version",
   BASELINE_CONTENT_UNPROVEN:"read-only catalog diff of baseline vs source",
   SOURCE_HISTORICAL_GAP_UNPROVEN:"read-only proof the gap file is present/absent in managed",
   SOURCE_PRE_BASELINE_UNPROVEN:"read-only proof the pre-baseline file is covered by the baseline",
   AMBIGUOUS_ALIAS:"DBA alias attestation with both digests",
   DIGEST_UNAVAILABLE:"statements digest on both sides"}[b.code]||"DBA review of reconciliation blocker");
 for(const b of evidence.evidenceBlockers)block("EVIDENCE_"+b.code,b.subject,b.detail,
  "real reviewed managed ledger export containing statements (schema_migrations.statements)");

 const append=rec.sourceOnly.filter(s=>s.class==="SOURCE_ONLY_APPEND_CANDIDATE")
  .map(s=>({file:s.file,version:s.version,sha256:srcByFile.get(s.file).canonicalSha256}))
  .sort((a,b)=>cmp(a.version,b.version)||cmp(a.file,b.file));
 const dupVersion=new Set(append.filter((c,i)=>i&&append[i-1].version===c.version).map(c=>c.version));
 for(const v of dupVersion)block("APPEND_VERSION_COLLISION",v,"two append candidates share a version","DBA decision on version renumbering");
 const rollbacks=validateRollbackManifest(rollbackInput&&typeof rollbackInput==="string"?JSON.parse(rollbackInput):rollbackInput,append);

 const hardBlocked=blocked.length>0;
 const accepted=rec.managedEntries.filter(e=>e.accepted);
 const baseState=stateOf(accepted.map(e=>({version:e.version,
  sha256:evidence.managed.find(m=>m.version===e.version).statementsSha256})));

 const stages=[];
 let stagesBuilt=false;
 if(!hardBlocked){
  stagesBuilt=true;
  const applied=accepted.map(e=>({version:e.version,sha256:evidence.managed.find(m=>m.version===e.version).statementsSha256}));
  let prev=stateOf(applied);
  append.forEach((c,i)=>{
   applied.push({version:c.version,sha256:c.sha256});
   const next=stateOf(applied);
   const rb=rollbacks.get(c.version);
   const rbReason=rb?null:"ROLLBACK_REVIEW_MISSING";
   const stage={
    order:i+1,file:c.file,version:c.version,forwardSha256:c.sha256,
    fromState:prev,toState:next,
    forward:{status:"DRY_RUN_ONLY",executes:false},
    rollback:rb?{status:"REVIEWED_CANDIDATE",rollbackSha256:rb.rollbackSha256,reviewedBy:rb.reviewedBy,basis:rb.basis,toState:prev}
     :{status:"BLOCKED",blockedBy:rbReason},
    recovery:rb?{status:rb.transactional?"RETRY_OR_ROLLBACK_FROM_PRIOR_STATE":"BLOCKED",
      onFailure:rb.transactional?{resumeState:prev,note:"stage attested transactional: failure leaves prior state"}:null,
      blockedBy:rb.transactional?null:"STAGE_NOT_ATTESTED_TRANSACTIONAL"}
     :{status:"BLOCKED",blockedBy:"ROLLBACK_REVIEW_MISSING"}
   };
   if(!rb)block("ROLLBACK_REVIEW_MISSING",c.file,"no reviewed rollback for stage "+(i+1),
    "reviewed rollback SQL digest + transactional attestation for "+c.version);
   else if(!rb.transactional)block("STAGE_NOT_ATTESTED_TRANSACTIONAL",c.file,"recovery unproven","DBA attestation of atomic apply or a reviewed partial-failure recovery for "+c.version);
   stages.push(stage);prev=next;
  });
 }else{
  for(const c of append)if(!protectedFiles.has(c.file))
   block("STAGE_HELD_BY_EVIDENCE_BLOCKERS",c.file,"append candidate cannot be staged until evidence blockers clear",null);
 }
 blocked.sort((a,b)=>cmp(a.code,b.code)||cmp(a.subject,b.subject)||cmp(a.detail,b.detail));

 const dryRun=simulate(baseState,stages);
 const externalInputsRequired=[...new Map(blocked.filter(b=>b.requiredExternalInput).map(b=>[b.requiredExternalInput,
  {input:b.requiredExternalInput,forBlockers:blocked.filter(x=>x.requiredExternalInput===b.requiredExternalInput).map(x=>x.code+":"+x.subject)}])).values()]
  .sort((a,b)=>cmp(a.input,b.input));
 externalInputsRequired.push({input:"independent DBA/AppSec/owner release decision (never produced by this tool)",forBlockers:["ALWAYS"]});

 const allClear=stagesBuilt&&!blocked.length;
 const body={
  schema:RC38_SCHEMA,
  releaseGo:false,
  planStatus:!stagesBuilt?"NO_GO_BLOCKED":allClear?"CANDIDATE_READY_FOR_INDEPENDENT_DBA_DECISION":"CANDIDATE_PENDING_EXTERNAL_REVIEW",
  connectsToManaged:false,executesSql:false,managedWrites:false,promotesProtectedSql:false,
  requiresIndependentDbaDecision:true,
  evidencePackageSha256:evidence.packageSha256,
  evidenceComplete:evidence.evidenceComplete,
  baseState,
  counts:{verifiedApplied:accepted.length,appendCandidates:append.length,stages:stages.length,
   protectedSourceFiles:protectedHits.length,blockedReasons:blocked.length},
  stages,
  heldCandidates:stagesBuilt?[]:append.filter(c=>!protectedFiles.has(c.file)),
  dryRun,
  blockedReasons:blocked,
  externalInputsRequired
 };
 return Object.freeze({...body,planSha256:sha(JSON.stringify(body))});
}

// In-memory simulation only: forward chain, per-stage failure injection, rollback chain.
function simulate(base,stages){
 if(!stages.length)return {forward:{finalState:base,stagesApplied:0},failureInjection:[],rollback:{fullRollbackPossible:false,reason:stages.length?null:"NO_STAGES"},chainConsistent:true};
 let cur=base,consistent=true;
 for(const s of stages){
  if(s.fromState.stateSha256!==cur.stateSha256)consistent=false;
  cur=s.toState;
 }
 const failureInjection=stages.map(s=>({failAtStage:s.order,
  outcome:s.recovery.status==="BLOCKED"?"RECOVERY_BLOCKED":"STATE_REMAINS_PRIOR",
  resultingState:s.recovery.status==="BLOCKED"?null:s.fromState,
  blockedBy:s.recovery.blockedBy||null}));
 const reviewedTail=[];
 for(let i=stages.length-1;i>=0;i--){if(stages[i].rollback.status!=="REVIEWED_CANDIDATE")break;reviewedTail.push(stages[i].order);}
 const full=reviewedTail.length===stages.length;
 let rbState=cur,rbOk=full;
 if(full)for(let i=stages.length-1;i>=0;i--){
  if(stages[i].toState.stateSha256!==rbState.stateSha256)rbOk=false;
  rbState=stages[i].rollback.toState;
 }
 return {forward:{finalState:cur,stagesApplied:stages.length},failureInjection,
  rollback:{fullRollbackPossible:full&&rbOk,reviewedTailStages:reviewedTail.sort((a,b)=>a-b),
   returnsToBase:full&&rbOk&&rbState.stateSha256===base.stateSha256,
   reason:full?null:"ROLLBACK_REVIEW_INCOMPLETE"},
  chainConsistent:consistent};
}

const USAGE="usage: rc38-migration-staged-dryrun.mjs (--sample | --managed <ledger.json> --source-dir <dir> [--aliases <f>] [--rollbacks <f>]) [--out <plan.json>]";
export function runCli(argv,io={log:console.log,err:console.error}){
 const arg=n=>{const i=argv.indexOf(n);return i>=0?argv[i+1]:undefined};
 const sample=argv.includes("--sample");
 const fx=join(here,"fixtures/rc37-migration-evidence");
 const mp=sample?join(fx,"managed.json"):arg("--managed");
 const sd=sample?join(fx,"source"):arg("--source-dir");
 const ap=sample?join(fx,"aliases.json"):arg("--aliases");
 const rp=sample?undefined:arg("--rollbacks");
 const out=arg("--out");
 if(!mp||!sd){io.err(USAGE);return 1;}
 try{
  const rbText=rp?readFileSync(resolve(rp),"utf8"):undefined;
  const plan=buildStagedDryRun({managedText:readFileSync(resolve(mp),"utf8"),sourceDir:resolve(sd),
   aliasInput:ap?JSON.parse(readFileSync(resolve(ap),"utf8")):undefined,rollbackInput:rbText});
  const text=JSON.stringify(plan,null,2)+"\n";
  if(out)writeFileSync(resolve(out),text);else io.log(text.trimEnd());
  return plan.planStatus==="CANDIDATE_READY_FOR_INDEPENDENT_DBA_DECISION"?0:2; // never a GO
 }catch(e){io.err(String(e.message||e));return 1;}
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))
 process.exitCode=runCli(process.argv.slice(2));
