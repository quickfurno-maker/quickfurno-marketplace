#!/usr/bin/env node
// RC47 offline recovery handoff: enforce exact original SQL evidence before
// any managed-Staging migration proposal. NEVER connects to a managed DB,
// invents unavailable SQL, approves a release, or executes statements.
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {reconcileManagedLedger,DEFAULT_EVIDENCE} from "./rc40-managed-ledger-reconciler.mjs";
const SHA=/^[a-f0-9]{40}$/;
export function assessRc47Recovery({candidateSha,evidenceText,captureText}){
 if(!SHA.test(candidateSha||""))throw Error("RC47_CANDIDATE_SHA_REQUIRED");
 const {report,missing}=reconcileManagedLedger({candidateSha,evidenceText,captureText});
 const migrationComplete=report.status==="RECONCILED_COMPLETE"&&
  report.counts.managedMissing===0&&report.counts.sourceUnmatched===0;
 const status=migrationComplete?"MIGRATION_EVIDENCE_READY_FOR_INDEPENDENT_REVIEW":
  report.counts.managedMissing>0?"BLOCKED_ORIGINAL_SQL_MISSING":
  "BLOCKED_SOURCE_MIGRATIONS_UNMATCHED";
 // No caller-supplied boolean may impersonate independent actual restore,
 // DBA/AppSec approval, Staff MFA acceptance or managed authorization.
 return Object.freeze({
  schema:"qf.vox.rc47.managed-recovery-handoff.v1",
  candidateSha,reconciliationSha256:report.reconciliationSha256,
  evidenceSha256:report.sourceEvidenceSha256,
  status,
  releaseGo:false,managedWrites:false,connectsToManaged:false,
  sqlExecuted:false,approvalClaimed:false,restoreCertified:false,
  needsReadOnlyManagedCapture:report.counts.managedMissing>0,
  needsSourceReconciliation:report.counts.sourceUnmatched>0,
  outstandingManagedOriginalCount:report.counts.managedMissing,
  outstandingSourceMigrationCount:report.counts.sourceUnmatched,
  originalSqlRequired:missing.items.map(m=>({
   version:m.version,name:m.name,source:m.requiredInput,
   placeholderIsSql:false
  })),
  sourceOnlyStillUnmatched:report.unmatchedSourceFiles,
  counts:Object.freeze({...report.counts}),
  mandatoryRemainingGates:[
   "AUTHENTIC_INDEPENDENT_MANAGED_SQL_CAPTURE",
   "RECONCILE_ALL_MANAGED_ORIGINAL_SQL_AND_UNMATCHED_SOURCE_SQL",
   "ISOLATED_FULL_RESTORE_AUTH_VAULT_STORAGE_ROLES_POSTGIS",
   "INDEPENDENT_DBA_APPSEC_SIGNOFF",
   "OWNER_AND_TEAM_LEADER_STAFF_AAL2_REAL_SESSIONS",
   "STAGING_APPROVAL_AND_REAL_E2E_UAT"
  ],
  note:"Offline evidence only, not an installer, a restore result, or release permission."
 });
}
export function runRc47Handoff(args,io={log:console.log,err:console.error}){
 const options={};
 for(let i=0;i<args.length;i++){
  const k=args[i];
  if(!["--candidate-sha","--evidence","--capture"].includes(k)||
   options[k]!==undefined||!args[i+1]||args[i+1].startsWith("--")){
   io.err("RC47_USAGE: --candidate-sha <40hex> [--evidence path] [--capture path]");
   return 1;
  }
  options[k]=args[++i];
 }
 if(!options["--candidate-sha"]){io.err("RC47_CANDIDATE_SHA_REQUIRED");return 1;}
 try{
  const report=assessRc47Recovery({
   candidateSha:options["--candidate-sha"],
   evidenceText:readFileSync(resolve(options["--evidence"]||DEFAULT_EVIDENCE),"utf8"),
   ...(options["--capture"]?{captureText:readFileSync(resolve(options["--capture"]),"utf8")}:{})
  });
  io.log(JSON.stringify(report,null,2));
  io.log("RC47_MANAGED_RECOVERY="+report.status+" releaseDecision=HOLD");
  return report.status==="MIGRATION_EVIDENCE_READY_FOR_INDEPENDENT_REVIEW"?0:2;
 }catch(err){io.err(String(err?.message||err));return 1;}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))
 process.exitCode=runRc47Handoff(process.argv.slice(2));
