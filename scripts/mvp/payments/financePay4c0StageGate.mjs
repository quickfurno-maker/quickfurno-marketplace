import path from "node:path";
import {fileURLToPath} from "node:url";
import {inspectManagedMigrationObservation} from "./financePay4c0ManagedHistory.mjs";
import {financeSourceManifest} from "./financePay4bSqlReview.mjs";
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"../../..");
const OBS="ops/finance/PAY4C0-READONLY-MANAGED-MIGRATION-EVIDENCE-20261022.json";
const gated=[
 "FINANCE_V2_PAY3_WEBHOOK_RECEIPT_ENABLED","FINANCE_V2_PAY3_INBOX_WORKER_ENABLED",
 "FINANCE_V2_PAY4A_CRON_ENABLED","FINANCE_V2_PAY4A_CASE_WRITES_ENABLED",
 "FINANCE_V2_PAY4B_ORDER_SEARCH_ENABLED","VOX_FINANCE_PAY4A_CASE_UI_ENABLED",
 "VOX_FINANCE_PAY4B_SEARCH_UI_ENABLED"
];
export function evaluatePay4c0StagePacket({root=ROOT,flags={},review={}}={}){
 const migration=inspectManagedMigrationObservation(path.join(root,OBS));
 const enabled=gated.filter(k=>flags[k]!==undefined&&flags[k]!=="");
 const signoffs=[
  "independentDba","independentAppsec","ownerMfa","staffMfa",
  "stagingBackup","sourceSignature","stagingDeploySignature"
 ];
 const missing=signoffs.filter(k=>review[k]!==true);
 return Object.freeze({schema:"qf.finance.pay4c0.staging-packet.v1",
  sourceInventoryOk:financeSourceManifest.checksPassed,
  observedMigrationListOk:migration.ok,
  observedStagingMigrationCount:86,observedProductionMigrationCount:86,
  sqlCandidateCount:financeSourceManifest.candidateCount,
  activeForbiddenFlags:enabled,missingExternalSignoffs:missing,
  assessmentReadyForIndependentReview:enabled.length===0&&migration.ok,
  releaseStatus:"HOLD",signedDeploymentCreated:false,
  deployApproved:false,workerSchedulingApproved:false,providerTestAuthorized:false,
  vendorCreditOrRefundAuthorized:false,productionAuthorized:false,
  rollbackCertified:false});
}
