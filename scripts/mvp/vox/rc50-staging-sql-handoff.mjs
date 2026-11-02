#!/usr/bin/env node
// Offline, source-authentic SQL handoff. NOT a migration generator, installer,
// provenance attestation, restore proof or human release approval.
import {createHash} from "node:crypto";
import {readFileSync} from "node:fs";
import {dirname,resolve,join} from "node:path";
import {fileURLToPath} from "node:url";
import {assessRc47Recovery} from "./rc47-managed-recovery-handoff.mjs";
import {DEFAULT_EVIDENCE} from "./rc40-managed-ledger-reconciler.mjs";
const root=resolve(dirname(fileURLToPath(import.meta.url)),"../../..");
const candidates=Object.freeze([
 {lane:"CORE_CONVERSATION",file:"ops/vox/rc41-review-candidates/20261101010000_vox_rc41_core_conversation_operator_atomic_candidate.sql",installedConstant:"RC42_ATOMIC_CONVERSATION_RPC_INSTALLED"},
 {lane:"BAD_LEAD_CREDIT_ONLY",file:"ops/vox/rc42-review-candidates/20261101020000_vox_rc42_bad_lead_credit_only_atomic_REVIEW_ONLY.sql",installedConstant:"RC43_BAD_LEAD_ATOMIC_RPC_INSTALLED"},
 {lane:"EOD_READ_ONLY",file:"ops/vox/rc41-review-candidates/20261101010000_vox_rc41_signed_eod_review_snapshot_rpc_review_only.sql",installedConstant:"RC42_EOD_ATOMIC_DATA_API_READER_INSTALLED"}
]);
export function createRc50SqlHandoff({candidateSha,evidenceText,captureText,load=path=>readFileSync(join(root,path))}){
 const migration=assessRc47Recovery({candidateSha,evidenceText,captureText});
 const reviewed=candidates.map(c=>{
  if(!c.file.startsWith("ops/vox/")||c.file.includes("..")||c.file.startsWith("supabase/migrations/"))
   throw Error("RC50_REVIEW_PATH_DENIED");
  const bytes=load(c.file);
  if(!Buffer.isBuffer(bytes)||!bytes.length)throw Error("RC50_SQL_BYTES_MISSING:"+c.lane);
  const sql=bytes.toString("utf8");
  if(!/\b(create\s+or\s+replace\s+function|create\s+table)\b/i.test(sql)||
    !/REVIEW|CANDIDATE|UNINSTALLED/i.test(sql.slice(0,1100)))
   throw Error("RC50_NOT_REVIEW_ONLY_SQL:"+c.lane);
  return Object.freeze({lane:c.lane,sourcePath:c.file,sourceSha256:createHash("sha256").update(bytes).digest("hex"),
   byteCount:bytes.length,reviewOnly:true,installed:false,
   deployed:false,ownerApproval:false,installedConstant:c.installedConstant});
 });
 return Object.freeze({schema:"qf.vox.rc50.staging-sql-handoff.v1",candidateSha,
  migrationEvidenceStatus:migration.status,
  outstandingManagedOriginalCount:migration.outstandingManagedOriginalCount,
  outstandingSourceMigrationCount:migration.outstandingSourceMigrationCount,
  reviewedSqlCandidates:reviewed,releaseGo:false,stagingInstallPermitted:false,
  managedWrites:false,sqlApplied:false,restoreCertified:false,independentReview:false,
  nextRequiredActions:[
   "CAPTURE_AUTHENTIC_MANAGED_ORIGINAL_SQL_WITH_READ_ONLY_OPERATOR",
   "RECONCILE_MISSING_AND_UNMATCHED_SQL_TO_EXACT_SOURCE",
   "ISOLATED_FULL_AUTH_VAULT_STORAGE_POSTGIS_ROLES_RESTORE",
   "INDEPENDENT_DBA_AND_APPSEC_REVIEW",
   "APPROVED_MANAGED_STAGING_INSTALL_AND_ROLLBACK",
   "REAL_OWNER_TL_STAFF_AAL2_AND_E2E_UAT"
  ],note:"Reviewed SQL source hashes only; never apply these statements or enable operational flags from this report."});
}
export function runRc50Cli(argv,io={log:console.log,err:console.error}){
 if(argv.length!==2||argv[0]!=="--candidate-sha"||!/^[a-f0-9]{40}$/.test(argv[1]??"")){
  io.err("RC50_USAGE: --candidate-sha <exact 40-hex PR head>");return 1;
 }
 try{
  const doc=createRc50SqlHandoff({candidateSha:argv[1],
   evidenceText:readFileSync(DEFAULT_EVIDENCE,"utf8")});
  io.log(JSON.stringify(doc,null,2));
  io.log("RC50_STAGING_SQL_HANDOFF=HOLD releaseDecision=HOLD");return 2;
 }catch(e){io.err(String(e?.message??e));return 1;}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))
 process.exitCode=runRc50Cli(process.argv.slice(2));
