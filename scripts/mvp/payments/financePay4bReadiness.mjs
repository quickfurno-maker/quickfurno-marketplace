import {createHash} from "node:crypto";
import {financeSourceManifest,buildFinanceReviewManifest} from "./financePay4bSqlReview.mjs";
import {inspectPay4aMigrationInventory} from "./audit-finance-pay4a-migration.mjs";
import {fileURLToPath} from "node:url";
import path from "node:path";
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"../../..");
const sensitiveFlags=[
 "FINANCE_V2_PAY3_WEBHOOK_RECEIPT_ENABLED",
 "FINANCE_V2_PAY3_INBOX_WORKER_ENABLED",
 "FINANCE_V2_PAY4A_CRON_ENABLED",
 "FINANCE_V2_PAY4A_CASE_WRITES_ENABLED",
 "FINANCE_V2_PAY4B_ORDER_SEARCH_ENABLED",
 "VOX_FINANCE_PAY4A_CASE_UI_ENABLED",
 "VOX_FINANCE_PAY4B_SEARCH_UI_ENABLED"
];
export function inspectPay4bSourceReadiness({root=ROOT,env={}}={}){
 const migration=inspectPay4aMigrationInventory({root});
 const inventory=buildFinanceReviewManifest({root});
 const notDisabled=sensitiveFlags.filter(f=>env[f]!==undefined&&env[f]!=="");
 const hash=createHash("sha256").update(JSON.stringify(inventory.hashes)).digest("hex");
 const issues=[...migration.issues,...inventory.issues];
 if(notDisabled.length)issues.push("FINANCE_MUTATION_FEATURE_FLAG_PRESENT");
 return Object.freeze({schema:"qf.finance.pay4b.readiness.v1",sourceIntegrityOk:issues.length===0,
  sourceDigest:hash,sqlCandidates:inventory.candidateCount,
  flaggedNames:notDisabled,issues,releaseStatus:"HOLD",
  productionAllowed:false,stagingMigrationAllowed:false,providerTESTAuthorized:false,
  financialExecutionAllowed:false,workerScheduled:false,
  requiresRealRemoteMigrationEvidence:true,requiresExternalAppSec:true,
  requiresExternalDBA:true,requiresOwnerGoNoGo:true,
  migrationLegacyQuarantineRecorded: migration.quarantinedHash===migration.ledgerHash,
  backupScope:"ISOLATED_PG17_ONLY",sourceOnly:true});
}
export const sourceReadiness=inspectPay4bSourceReadiness();
