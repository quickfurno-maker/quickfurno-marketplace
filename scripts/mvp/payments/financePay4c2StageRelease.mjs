import {createHash} from "node:crypto";
import {readFileSync} from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {inspectPay4c1CertificationEvidence} from "./financePay4c1Certification.mjs";
import {inspectFinanceMfaSource} from "./financePay4c2IdentityPreflight.mjs";
import {reconcileFinanceMigrationForReview} from "./financePay4c2MigrationReview.mjs";
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"../../..");
const files=[
 "app/api/webhooks/razorpay/vendor-package/route.ts",
 "services/financeV2WebhookJournal.ts","services/financeV2InboxWorker.ts",
 "app/api/internal/finance-pay4a-canary/route.ts",
 "app/api/vox/v1/finance-case/route.ts",
 "app/api/vox/v1/finance-case-review/route.ts",
 "app/api/vox/v1/finance-orders/route.ts",
 "apps/vox-web/app/finance/page.tsx",
 "docs/finance/PAY4C1-FINAL-INTERNAL-CERTIFICATION-20261022.md"
];
const flags=["FINANCE_V2_PAY3_WEBHOOK_RECEIPT_ENABLED",
 "FINANCE_V2_PAY3_INBOX_WORKER_ENABLED","FINANCE_V2_PAY4A_CRON_ENABLED",
 "FINANCE_V2_PAY4A_CASE_WRITES_ENABLED","FINANCE_V2_PAY4B_ORDER_SEARCH_ENABLED",
 "VOX_FINANCE_PAY4A_CASE_UI_ENABLED","VOX_FINANCE_PAY4B_SEARCH_UI_ENABLED"];
const sha=buf=>createHash("sha256").update(buf).digest("hex");
export function buildPay4c2StagingReleasePreflight({root=ROOT,env={}}={}){
 const dba=reconcileFinanceMigrationForReview({root});
 const identity=inspectFinanceMfaSource({root});
 const last=inspectPay4c1CertificationEvidence({root,env});
 const issues=[...dba.findings,...identity.errors,...last.errors];
 const digest=[];
 for(const file of files){
  try{digest.push({path:file,sha256:sha(readFileSync(path.join(root,file)))});}
  catch{issues.push("MISSING_RELEASE_SOURCE:"+file);}
 }
 const active=flags.filter(x=>env[x]!==undefined&&env[x]!=="");
 if(active.length)issues.push("PAYMENT_FEATURE_ENABLED_BEFORE_APPROVAL");
 const sourceFingerprint=sha(JSON.stringify(digest));
 return Object.freeze({schema:"qf.finance.pay4c2.stage-preflight.v1",
  sourceValidationOk:issues.length===0,issues,
  sourceFingerprint,sourceEntries:digest,
  staticCandidateDigest:last.sourceBundleFingerprint,
  unexpectedEnabledFlags:active,
  realSigningComplete:false,releaseArtifactDigestVerified:false,
  actualDbBackupVerified:false,realStagingIdentityVerified:false,
  independentlyReviewedAcl:false,
  providerTestMerchantConfirmed:false,realWebhookCanariesPassed:false,
  monitoringAndEmergencyStopCertified:false,
  externalApprovalsPresent:false,
  installMigrations:false,runWorker:false,realProviderWritesAllowed:false,
  productionEnabled:false,releaseStatus:"HOLD",
  sequence:Object.freeze([
   "DBA_APPROVE_LIVE_MIGRATION_TRUTH_AND_BACKUP",
   "APPSEC_REVIEW_SECURITY_ADVISOR_OBJECTS_AND_MFA",
   "OWNER_AUTHORIZE_TEST_ONLY_SIGNED_STAGING_RELEASE",
   "CHECK_REMOTE_ACL_AND_RLS_AFTER_APPROVED_INSTALL",
   "VERIFY_TEST_MODE_PROVIDER_CHECKOUT_WEBHOOK_REFUND",
   "CLOSE_BANK_AND_CONSUMED_CREDIT_HUMAN_RECONCILIATION",
   "OWNER_PRODUCTION_GO_NO_GO"
  ])});
}
