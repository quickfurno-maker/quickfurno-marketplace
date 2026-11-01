#!/usr/bin/env node
// RC38 d-db: fail-closed OFFLINE Staging pre-deployment gate over rc38-staged-dryrun.
// It reads local files only: opens no connection, runs no SQL, reads no env/secrets, deploys nothing,
// touches no payment path. The verdict is APPROVED_FOR_STAGING_PREDEPLOY only when ALL of these hold:
//   1. the recomputed RC38 dry-run plan is CANDIDATE_READY with zero blocked reasons and a full rollback chain;
//   2. the local worktree HEAD equals --expected-sha (HEAD is read from .git files, never from a flag);
//   3. an externally supplied migration digest manifest equals the recomputed forward/rollback digests;
//   4. Auth, Vault and Storage recovery evidence (pinned Staging, fresh, isolated restore drill, equal digests);
//   5. independent DBA, AppSec and Owner-GO Ed25519 signatures, verified against a trusted key registry whose
//      sha256 the operator pins out-of-band, all bound to one binding digest of 1-4.
// Anything else yields NO_GO_BLOCKED plus actionable blockedReasons JSON. Approval authorizes nothing by itself:
// `deploys` is always false and a human performs any deploy separately.
import {readFileSync,writeFileSync,existsSync,statSync} from "node:fs";
import {resolve,dirname,sep,isAbsolute} from "node:path";
import {createHash,createPublicKey,verify as edVerify} from "node:crypto";
import {fileURLToPath} from "node:url";
import {buildStagedDryRun} from "./rc38-migration-staged-dryrun.mjs";
import {AUTHORIZED_STAGING_REF,PROHIBITED_REFS,canonicalJson} from "./ab7k-evidence-lib.mjs";

export const GATE_SCHEMA="qf.vox.rc38.staging-predeploy-gate.v1";
export const APPROVAL_SCHEMA="qf.vox.rc38.predeploy-approvals.v1";
export const KEYS_SCHEMA="qf.vox.rc38.trusted-approver-keys.v1";
export const RECOVERY_SCHEMA="qf.vox.rc38.recovery-evidence.v1";
export const MIGRATION_DIGESTS_SCHEMA="qf.vox.rc38.migration-digests.v1";
export const APPROVAL_DOMAIN="qf.vox.rc38.predeploy-approval.v1";
export const REQUIRED_ROLES=Object.freeze({dba:"APPROVE",appsec:"APPROVE",owner:"GO"});
export const RECOVERY_COMPONENTS=Object.freeze(["auth","vault","storage"]);
const MAX_EVIDENCE_AGE_MS=72*3600e3;
const MAX_APPROVAL_WINDOW_MS=72*3600e3;
const here=dirname(fileURLToPath(import.meta.url));
const repoRoot=resolve(here,"../../..");
const HEX64=/^[0-9a-f]{64}$/,SHA40=/^[0-9a-f]{40}$/,VERSION=/^\d{14}$/;
const SECRET_RE=/postgres(?:ql)?:\/\/[^\s"'@]*:[^\s"'@]+@|eyJ[\w-]{20,}\.[\w-]{10,}\.|sk_(?:live|test)_\w{8,}|service_role|PRIVATE KEY-----/i;
const sha=b=>createHash("sha256").update(b).digest("hex");
const isObj=x=>x!==null&&typeof x==="object"&&!Array.isArray(x);
const ms=s=>typeof s==="string"&&/^\d{4}-\d{2}-\d{2}T/.test(s)?Date.parse(s):NaN;
const cmp=(a,b)=>a<b?-1:a>b?1:0;

// Local-only HEAD resolution (worktree `.git` file or directory, loose or packed ref). No child process.
export function resolveHeadSha(root=repoRoot){
 let gd=resolve(root,".git");
 if(!existsSync(gd))return null;
 if(statSync(gd).isFile()){
  const m=readFileSync(gd,"utf8").match(/^gitdir:\s*(.+)$/m);
  if(!m)return null;
  gd=isAbsolute(m[1].trim())?m[1].trim():resolve(root,m[1].trim());
 }
 const read=p=>existsSync(p)?readFileSync(p,"utf8").trim():null;
 const head=read(resolve(gd,"HEAD"));
 if(!head)return null;
 if(SHA40.test(head))return head;
 const ref=head.match(/^ref:\s*(\S+)$/)?.[1];
 if(!ref)return null;
 let common=gd;
 const cd=read(resolve(gd,"commondir"));
 if(cd)common=isAbsolute(cd)?cd:resolve(gd,cd);
 for(const base of [gd,common]){
  const v=read(resolve(base,ref));
  if(v&&SHA40.test(v))return v;
 }
 const packed=read(resolve(common,"packed-refs"));
 const hit=packed?.split(/\r?\n/).find(l=>l.endsWith(" "+ref));
 const v=hit?.split(" ")[0];
 return v&&SHA40.test(v)?v:null;
}

export const approvalMessage=a=>Buffer.from(APPROVAL_DOMAIN+"\n"+canonicalJson({role:a.role,reviewerId:a.reviewerId,
 keyId:a.keyId,decision:a.decision,issuedAt:a.issuedAt,expiresAt:a.expiresAt,bindingSha256:a.bindingSha256}));

function migrationRows(plan){
 return plan.stages.map(s=>({version:s.version,forwardSha256:s.forwardSha256,
  rollbackSha256:s.rollback?.rollbackSha256??null}));
}

// ---------------------------------------------------------------- component checks (all push blockers; none throws)
function checkPlan(plan,add){
 if(plan.planStatus!=="CANDIDATE_READY_FOR_INDEPENDENT_DBA_DECISION")
  add("PLAN_NOT_READY","rc38-staged-dryrun","planStatus="+plan.planStatus+"; blockedReasons="+plan.blockedReasons.length,
   "clear every RC38 blocked reason (run rc38-migration-staged-dryrun.mjs and fix its blockedReasons first)");
 for(const b of plan.blockedReasons)
  add("PLAN_BLOCKER_"+b.code,b.subject,b.detail,b.requiredExternalInput);
 if(!plan.stages.length)add("PLAN_HAS_NO_STAGES","rc38-staged-dryrun","nothing to deploy","at least one verified append candidate");
 const d=plan.dryRun;
 if(d?.chainConsistent!==true)add("PLAN_STATE_CHAIN_INCONSISTENT","dryRun.chainConsistent","stage fromState/toState chain broken","regenerate the plan from digest-verified evidence");
 if(d?.rollback?.fullRollbackPossible!==true||d?.rollback?.returnsToBase!==true)
  add("PLAN_ROLLBACK_INCOMPLETE","dryRun.rollback","full reviewed rollback to base state is not proven","reviewed rollback manifest covering every stage");
}

function checkHead(headSha,expected,add){
 if(!SHA40.test(expected||""))add("EXPECTED_SHA_INVALID","--expected-sha","must be a full lowercase 40-hex commit sha","the exact reviewed commit sha");
 if(!SHA40.test(headSha||""))add("HEAD_SHA_UNRESOLVABLE","worktree HEAD","could not read a 40-hex HEAD from local .git","run from the isolated worktree checked out at the reviewed commit");
 else if(SHA40.test(expected||"")&&headSha!==expected)
  add("HEAD_SHA_MISMATCH","worktree HEAD","head "+headSha+" != expected "+expected,"check out the reviewed commit, or re-review and re-sign for the new sha");
}

function checkMigrationDigests(m,plan,add){
 if(!isObj(m)||m.schema!==MIGRATION_DIGESTS_SCHEMA||!Array.isArray(m.migrations)){
  add("MIGRATION_DIGESTS_MISSING","--migration-digests","absent or schema != "+MIGRATION_DIGESTS_SCHEMA,
   "migration digest manifest {schema,migrations:[{version,forwardSha256,rollbackSha256}]} produced by the independent DBA");
  return;
 }
 const want=migrationRows(plan),got=m.migrations;
 const shape=got.every(r=>isObj(r)&&VERSION.test(r.version||"")&&HEX64.test(r.forwardSha256||"")&&HEX64.test(r.rollbackSha256||""));
 if(!shape){add("MIGRATION_DIGESTS_MALFORMED","--migration-digests","every row needs 14-digit version and 64-hex forward/rollback digests","corrected DBA digest manifest");return;}
 const key=r=>r.version+":"+r.forwardSha256+":"+r.rollbackSha256;
 const g=new Set(got.map(key)),w=new Set(want.map(key));
 if(g.size!==got.length)add("MIGRATION_DIGESTS_DUPLICATE","--migration-digests","duplicate rows","deduplicated DBA digest manifest");
 for(const k of w)if(!g.has(k))add("MIGRATION_DIGEST_NOT_ATTESTED",k.split(":")[0],"recomputed digest pair has no matching attested row","DBA digest attestation for this version");
 for(const k of g)if(!w.has(k))add("MIGRATION_DIGEST_UNEXPECTED",k.split(":")[0],"attested row does not match the recomputed plan (drift or substitution)","re-attest against the current plan");
}

function checkComponent(name,c,ev,now,add){
 const sub="recovery."+name;
 if(!isObj(c)){add("RECOVERY_"+name.toUpperCase()+"_MISSING",sub,"component evidence absent","managed Staging "+name+" backup + isolated restore drill evidence");return;}
 const bad=(code,detail,need)=>add("RECOVERY_"+name.toUpperCase()+"_"+code,sub,detail,need||"corrected "+name+" recovery evidence");
 if(c.projectRef!==AUTHORIZED_STAGING_REF)bad("PROJECT_NOT_STAGING","projectRef must equal the pinned Staging ref");
 const cap=ms(c.capturedAt);
 if(!Number.isFinite(cap))bad("CAPTURED_AT_INVALID","capturedAt absent or not ISO-8601");
 else if(cap>now)bad("CAPTURED_IN_FUTURE","capturedAt is in the future");
 else if(now-cap>MAX_EVIDENCE_AGE_MS)bad("EVIDENCE_STALE","evidence older than 72h","fresh capture within 72h");
 if(c.readOnly!==true)bad("NOT_READ_ONLY_CAPTURE","readOnly must be true");
 const b=c.backup;
 const arts=isObj(b)&&Array.isArray(b.artifacts)?b.artifacts:[];
 if(!isObj(b)||b.present!==true)bad("BACKUP_ABSENT","backup.present must be true");
 else{
  const taken=ms(b.takenAt);
  if(!Number.isFinite(taken)||taken>now||(Number.isFinite(cap)&&taken>cap))bad("BACKUP_TIME_INVALID","backup.takenAt invalid or after capture");
  else if(now-taken>MAX_EVIDENCE_AGE_MS)bad("BACKUP_STALE","backup older than 72h","backup taken within 72h");
  if(!arts.length||!arts.every(a=>isObj(a)&&a.name&&HEX64.test(a.sha256||"")&&Number.isInteger(a.bytes)&&a.bytes>0))
   bad("BACKUP_ARTIFACTS_INVALID","artifacts need name, 64-hex sha256 and positive bytes");
  else if(new Set(arts.map(a=>a.sha256)).size!==arts.length)bad("BACKUP_ARTIFACT_DUPLICATE_DIGEST","duplicate artifact digest");
 }
 const r=c.restoreDrill;
 if(!isObj(r)||r.executed!==true)bad("RESTORE_DRILL_NOT_EXECUTED","restoreDrill.executed must be true","isolated restore drill of the "+name+" backup");
 else{
  if(typeof r.targetProjectRef!=="string"||!r.targetProjectRef||r.targetProjectRef===AUTHORIZED_STAGING_REF||PROHIBITED_REFS.includes(r.targetProjectRef))
   bad("RESTORE_DRILL_NOT_ISOLATED","drill target must be a throwaway project that is not Staging/Production/Jarvis");
  const done=ms(r.completedAt);
  if(!Number.isFinite(done)||done>now||(Number.isFinite(cap)&&done>cap))bad("RESTORE_DRILL_TIME_INVALID","completedAt invalid or after capture");
  if(!Array.isArray(r.errors)||r.errors.length)bad("RESTORE_DRILL_ERRORS","restoreDrill.errors must be an empty array");
  if(!HEX64.test(r.sourceDigest||"")||!HEX64.test(r.restoredDigest||""))bad("RESTORE_DIGESTS_MISSING","sourceDigest/restoredDigest must be 64-hex");
  else if(r.sourceDigest!==r.restoredDigest)bad("RESTORE_DIGEST_MISMATCH","restored digest differs from source");
 }
 if(name==="vault"){
  if(c.keyRecoveryVerified!==true)bad("KEY_RECOVERY_UNVERIFIED","keyRecoveryVerified must be true","Vault root-key custody/recovery drill result");
  if(c.secretValuesIncluded!==false)bad("SECRET_VALUES_IN_EVIDENCE","secretValuesIncluded must be false (digests only)");
 }
 if(name==="storage"){
  const s=c.objectManifestSourceSha256,t=c.objectManifestRestoredSha256;
  if(!HEX64.test(s||"")||!HEX64.test(t||""))bad("OBJECT_MANIFEST_MISSING","object manifest digests must be 64-hex","storage object+bucket-policy manifest digests before/after restore");
  else if(s!==t)bad("OBJECT_MANIFEST_MISMATCH","restored object manifest differs from source");
 }
 if(name==="auth"&&c.usersRowsExported!==false)bad("AUTH_ROWS_EXPORTED","usersRowsExported must be false (catalog digests only, no identities)");
}

function checkRecovery(ev,now,add){
 if(!isObj(ev)||ev.schema!==RECOVERY_SCHEMA){
  add("RECOVERY_EVIDENCE_MISSING","--recovery","absent or schema != "+RECOVERY_SCHEMA,"Auth, Vault and Storage recovery evidence from a managed Staging read-only capture");
  return;
 }
 for(const n of RECOVERY_COMPONENTS)checkComponent(n,ev.components?.[n],ev,now,add);
 if(typeof ev.capturedBy!=="string"||!ev.capturedBy.trim())add("RECOVERY_CAPTURED_BY_MISSING","recovery.capturedBy","operator id required for independence check","operator id");
}

// Optional RC40 source-SQL/managed-ledger reconciliation report. Supplying it makes an incomplete,
// tampered or differently-pinned report a blocker; omitting it changes nothing. It never grants approval.
export const RECONCILE_SCHEMA="qf.vox.rc40.managed-ledger-reconciliation.v1";
function checkReconciliation(text,expectedSha,add){
 const sub="--source-sql-reconciliation";
 let r;try{r=JSON.parse(text);}catch{add("SOURCE_SQL_RECONCILIATION_MALFORMED",sub,"not valid JSON","valid RC40 reconciliation report");return null;}
 if(!isObj(r)||r.schema!==RECONCILE_SCHEMA||!HEX64.test(r.reconciliationSha256||"")){add("SOURCE_SQL_RECONCILIATION_MALFORMED",sub,"schema != "+RECONCILE_SCHEMA,"valid RC40 reconciliation report");return null;}
 const {reconciliationSha256,...body}=r;
 if(sha(JSON.stringify(body))!==reconciliationSha256){add("SOURCE_SQL_RECONCILIATION_TAMPERED",sub,"report digest mismatch","re-run rc40-managed-ledger-reconciler.mjs");return null;}
 if(r.releaseGo!==false||r.approvalClaimed!==false||r.executesSql!==false||r.managedWrites!==false)
  add("SOURCE_SQL_RECONCILIATION_UNSAFE_FLAGS",sub,"report claims release/approval/execution","regenerated offline report");
 if(r.candidateSha!==expectedSha)add("SOURCE_SQL_RECONCILIATION_SHA_MISMATCH",sub,"report pinned "+r.candidateSha+" != expected "+expectedSha,"reconciliation re-run for the reviewed commit");
 if(r.status!=="RECONCILED_COMPLETE"||r.counts?.managedMissing!==0||r.counts?.sourceUnmatched!==0)
  add("SOURCE_SQL_RECONCILIATION_INCOMPLETE",sub,"status="+r.status+" managedMissing="+r.counts?.managedMissing+" sourceUnmatched="+r.counts?.sourceUnmatched,
   "independent managed ledger capture for every missing-original-SQL version (see qf.vox.rc40.missing-original-sql.v1)");
 return reconciliationSha256;
}

// Trusted key registry: public keys only, sha256 of the file bytes pinned out-of-band by the operator.
function loadKeys(text,pinned,add){
 if(!HEX64.test(pinned||"")){add("TRUSTED_KEYS_PIN_MISSING","--trusted-keys-sha256","64-hex pin of the registry file is required","registry sha256 recorded out-of-band by the owner");return null;}
 if(typeof text!=="string"){add("TRUSTED_KEYS_MISSING","--trusted-keys","registry file absent","trusted approver public-key registry");return null;}
 if(sha(text)!==pinned){add("TRUSTED_KEYS_PIN_MISMATCH","--trusted-keys","registry sha256 differs from the pin","registry matching the pinned digest (or a re-pinned, owner-reviewed registry)");return null;}
 let reg;try{reg=JSON.parse(text);}catch{add("TRUSTED_KEYS_MALFORMED","--trusted-keys","not valid JSON","valid registry");return null;}
 if(!isObj(reg)||reg.schema!==KEYS_SCHEMA||!Array.isArray(reg.keys)){add("TRUSTED_KEYS_MALFORMED","--trusted-keys","schema != "+KEYS_SCHEMA,"valid registry");return null;}
 const byId=new Map();
 for(const k of reg.keys){
  try{
   if(!isObj(k)||!k.keyId||!k.reviewerId||!Object.hasOwn(REQUIRED_ROLES,k.role)||byId.has(k.keyId))throw 0;
   const pk=createPublicKey(k.publicKeyPem);
   if(pk.asymmetricKeyType!=="ed25519")throw 0;
   byId.set(k.keyId,{role:k.role,reviewerId:k.reviewerId,key:pk});
  }catch{add("TRUSTED_KEY_INVALID",String(k?.keyId??"?"),"key must be unique, ed25519 public PEM, role dba|appsec|owner","corrected registry entry");}
 }
 return byId;
}

function checkApprovals(doc,keys,binding,evidenceTimes,operators,now,add){
 if(!isObj(doc)||doc.schema!==APPROVAL_SCHEMA||!Array.isArray(doc.approvals)){
  add("APPROVALS_MISSING","--approvals","absent or schema != "+APPROVAL_SCHEMA,"signed DBA, AppSec and Owner-GO approvals bound to bindingSha256 "+binding);
  return;
 }
 if(!keys){add("APPROVALS_UNVERIFIABLE","--trusted-keys","no verified key registry, signatures cannot be checked","pinned trusted key registry");return;}
 if(!operators.size)add("OPERATORS_NOT_DECLARED","--operators","preparer/operator ids required so self-approval can be rejected","comma-separated operator ids");
 const ok=new Map(),reviewers=new Set(),keyIds=new Set();
 doc.approvals.forEach((a,i)=>{
  const sub=`approvals[${i}]`+(isObj(a)&&a.role?":"+a.role:"");
  const bad=(code,detail)=>add("APPROVAL_"+code,sub,detail,"valid signed "+(a?.role||"role")+" approval");
  if(!isObj(a)||!Object.hasOwn(REQUIRED_ROLES,a.role))return bad("UNKNOWN_ROLE","role must be dba|appsec|owner");
  if(a.decision!==REQUIRED_ROLES[a.role])return bad("DECISION_NOT_AFFIRMATIVE","decision must be "+REQUIRED_ROLES[a.role]);
  if(a.bindingSha256!==binding)return bad("BINDING_MISMATCH","signed binding differs from this gate's bindingSha256 (evidence, plan or sha changed)");
  const k=keys.get(a.keyId);
  if(!k)return bad("KEY_NOT_TRUSTED","keyId not in the pinned registry");
  if(k.role!==a.role||k.reviewerId!==a.reviewerId)return bad("KEY_ROLE_OR_IDENTITY_MISMATCH","registry binds this key to "+k.role+"/"+k.reviewerId);
  const iss=ms(a.issuedAt),exp=ms(a.expiresAt);
  if(!Number.isFinite(iss)||!Number.isFinite(exp)||iss>now)return bad("TIME_INVALID","issuedAt/expiresAt invalid or issued in the future");
  if(exp<=now)return bad("EXPIRED","approval expired");
  if(exp-iss>MAX_APPROVAL_WINDOW_MS||exp<=iss)return bad("WINDOW_TOO_LONG","validity window must be >0 and <=72h");
  if(evidenceTimes.some(t=>iss<t))return bad("PREDATES_EVIDENCE","approval issued before the evidence it covers was captured");
  if(operators.has(a.reviewerId))return bad("SELF_APPROVAL","reviewer is a declared operator");
  let valid=false;
  try{valid=typeof a.signature==="string"&&edVerify(null,approvalMessage(a),k.key,Buffer.from(a.signature,"base64"));}catch{valid=false;}
  if(!valid)return bad("SIGNATURE_INVALID","Ed25519 signature does not verify");
  if(ok.has(a.role))return bad("DUPLICATE_ROLE","more than one approval for role");
  if(reviewers.has(a.reviewerId)||keyIds.has(a.keyId))return bad("NOT_INDEPENDENT","reviewer or key already used for another role");
  reviewers.add(a.reviewerId);keyIds.add(a.keyId);ok.set(a.role,a);
 });
 for(const r of Object.keys(REQUIRED_ROLES))
  if(!ok.has(r))add("APPROVAL_ROLE_UNSATISFIED","role:"+r,"no valid independent "+r+" approval","signed "+r+" "+REQUIRED_ROLES[r]+" bound to bindingSha256 "+binding);
}

// ---------------------------------------------------------------- gate
export function evaluatePredeployGate(i){
 const blocked=[];
 const add=(code,subject,detail,need)=>blocked.push({code,subject,detail:detail||"",requiredExternalInput:need||null});
 const now=Number.isFinite(i.now)?i.now:Date.now();
 for(const [n,t] of Object.entries({rollbacks:i.rollbackText,recovery:i.recoveryText,approvals:i.approvalsText,migrationDigests:i.migrationDigestsText,aliases:i.aliasText,sourceSqlReconciliation:i.sourceSqlReconciliationText}))
  if(typeof t==="string"&&SECRET_RE.test(t))add("SECRET_IN_INPUT",n,"input contains secret-shaped content; refusing to process","remove credentials/keys from the file and rotate any that were exposed");
 const parse=(t,code,subject)=>{if(typeof t!=="string")return undefined;try{return JSON.parse(t);}catch{add(code,subject,"not valid JSON","valid JSON file");return undefined;}};
 let plan=null;
 try{
  if(typeof i.managedText!=="string"||!i.sourceDir)throw Error("RC38_EVIDENCE_INPUTS_MISSING");
  plan=buildStagedDryRun({managedText:i.managedText,sourceDir:i.sourceDir,aliasInput:parse(i.aliasText,"ALIASES_MALFORMED","--aliases"),
   rollbackInput:i.rollbackText,repoRootDir:i.repoRootDir??repoRoot});
 }catch(e){add("PLAN_BUILD_FAILED","rc38-staged-dryrun",String(e.message||e),"valid managed ledger export, source dir and rollback manifest");}
 if(plan)checkPlan(plan,add);
 checkHead(i.headSha,i.expectedSha,add);
 if(plan)checkMigrationDigests(parse(i.migrationDigestsText,"MIGRATION_DIGESTS_MALFORMED","--migration-digests"),plan,add);
 else add("MIGRATION_DIGESTS_UNCHECKED","--migration-digests","no plan to compare against",null);
 const reconSha=typeof i.sourceSqlReconciliationText==="string"?checkReconciliation(i.sourceSqlReconciliationText,i.expectedSha,add):null;
 const recovery=parse(i.recoveryText,"RECOVERY_MALFORMED","--recovery");
 checkRecovery(recovery,now,add);

 const migrations=plan?migrationRows(plan):[];
 const binding=sha(canonicalJson({schema:GATE_SCHEMA,expectedSha:i.expectedSha??null,headSha:i.headSha??null,
  planSha256:plan?.planSha256??null,evidencePackageSha256:plan?.evidencePackageSha256??null,migrations,
  recoverySha256:recovery?sha(canonicalJson(recovery)):null,
  ...(typeof i.sourceSqlReconciliationText==="string"?{sourceSqlReconciliationSha256:reconSha}:{})}));
 const evTimes=RECOVERY_COMPONENTS.flatMap(n=>[ms(recovery?.components?.[n]?.capturedAt)]).filter(Number.isFinite);
 const operators=new Set(String(i.operators??"").split(",").map(s=>s.trim()).filter(Boolean));
 if(typeof recovery?.capturedBy==="string")operators.add(recovery.capturedBy.trim());
 const keys=loadKeys(i.trustedKeysText,i.trustedKeysSha256,add);
 checkApprovals(parse(i.approvalsText,"APPROVALS_MALFORMED","--approvals"),keys,binding,evTimes,operators,now,add);

 blocked.sort((a,b)=>cmp(a.code,b.code)||cmp(a.subject,b.subject)||cmp(a.detail,b.detail));
 const approved=blocked.length===0;
 const need=[...new Map(blocked.filter(b=>b.requiredExternalInput).map(b=>[b.requiredExternalInput,
  {input:b.requiredExternalInput,forBlockers:blocked.filter(x=>x.requiredExternalInput===b.requiredExternalInput).map(x=>x.code+":"+x.subject)}])).values()]
  .sort((a,b)=>cmp(a.input,b.input));
 const body={
  schema:GATE_SCHEMA,
  verdict:approved?"APPROVED_FOR_STAGING_PREDEPLOY":"NO_GO_BLOCKED",
  stagingProjectRef:AUTHORIZED_STAGING_REF,
  deploys:false,connectsToManaged:false,executesSql:false,managedWrites:false,paymentMutation:false,readsSecrets:false,
  expectedSha:i.expectedSha??null,headSha:i.headSha??null,
  planStatus:plan?.planStatus??null,planSha256:plan?.planSha256??null,
  migrations,bindingSha256:binding,
  rolesRequired:Object.keys(REQUIRED_ROLES),
  counts:{blockedReasons:blocked.length},
  blockedReasons:blocked,externalInputsRequired:need,
  note:"Approval is a pre-deployment readiness verdict only. It never deploys; a human executes any Staging deploy separately."
 };
 return Object.freeze({...body,gateSha256:sha(JSON.stringify(body))});
}

// ---------------------------------------------------------------- CLI
const VALUE_FLAGS=new Set(["managed","source-dir","aliases","rollbacks","expected-sha","migration-digests","recovery","approvals","trusted-keys","trusted-keys-sha256","operators","out","source-sql-reconciliation"]);
const DANGEROUS=/^(apply|execute|deploy|push|repair|merge|promote|force|go|yes|db-url|linked|skip-gates|bypass|override|sql|migrate|install|head-sha|now)$/i;
const USAGE="usage: rc38-staging-predeploy-gate.mjs --managed <ledger.json> --source-dir <dir> [--aliases f] --rollbacks f --expected-sha <40hex> --migration-digests f --recovery f --approvals f --trusted-keys f --trusted-keys-sha256 <64hex> --operators a,b [--source-sql-reconciliation rc40-report.json] [--out gate.json]";
export function parseArgs(argv){
 const opt={};
 for(let k=0;k<argv.length;k++){
  const t=argv[k];
  if(!t.startsWith("--"))return {error:"UNEXPECTED_ARGUMENT"};
  const n=t.slice(2);
  if(DANGEROUS.test(n))return {error:"FORBIDDEN_FLAG_--"+n};
  if(!VALUE_FLAGS.has(n)||k+1>=argv.length||argv[k+1].startsWith("--"))return {error:"UNKNOWN_OR_VALUELESS_FLAG_--"+n};
  opt[n]=argv[++k];
 }
 return {opt};
}
const readText=p=>p?readFileSync(resolve(p),"utf8").replace(/^﻿/,""):undefined;
function writeReport(out,text){
 const abs=resolve(out),low=abs.toLowerCase();
 const banned=["supabase","ops","contracts","db"].map(d=>resolve(repoRoot,d).toLowerCase()+sep);
 if(!low.endsWith(".json")||banned.some(b=>low.startsWith(b)))throw Error("OUTPUT_PATH_NOT_ALLOWED");
 writeFileSync(abs,text,{flag:"wx"}); // never overwrites
}
// Exit codes: 0 approved, 2 blocked (JSON on stdout/--out), 1 usage or I/O error.
export function runCli(argv,io={log:console.log,err:console.error},{now=Date.now(),headSha=resolveHeadSha()}={}){
 const p=parseArgs(argv);
 if(p.error||!p.opt["managed"]||!p.opt["source-dir"]){io.err("RC38_GATE_USAGE "+(p.error??"missing --managed/--source-dir")+"\n"+USAGE);return 1;}
 const o=p.opt;
 try{
  const g=evaluatePredeployGate({now,headSha,expectedSha:o["expected-sha"],managedText:readText(o.managed),sourceDir:resolve(o["source-dir"]),
   aliasText:readText(o.aliases),rollbackText:readText(o.rollbacks),migrationDigestsText:readText(o["migration-digests"]),
   recoveryText:readText(o.recovery),approvalsText:readText(o.approvals),trustedKeysText:readText(o["trusted-keys"]),
   trustedKeysSha256:o["trusted-keys-sha256"],operators:o.operators,
   sourceSqlReconciliationText:readText(o["source-sql-reconciliation"])});
  const text=JSON.stringify(g,null,2)+"\n";
  if(o.out)writeReport(o.out,text);else io.log(text.trimEnd());
  return g.verdict==="APPROVED_FOR_STAGING_PREDEPLOY"?0:2;
 }catch(e){io.err("RC38_GATE_ERROR "+String(e.message||e));return 1;}
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))
 process.exitCode=runCli(process.argv.slice(2));
