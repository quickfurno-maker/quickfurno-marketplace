import {readFileSync} from "node:fs";
import {createHash} from "node:crypto";
import {fileURLToPath} from "node:url";
import path from "node:path";
import {buildFinanceReviewManifest} from "./financePay4bSqlReview.mjs";
import {inspectPay4aMigrationInventory} from "./audit-finance-pay4a-migration.mjs";
import {inspectManagedMigrationObservation} from "./financePay4c0ManagedHistory.mjs";
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"../../..");
const ADVISOR="ops/finance/PAY4C1-SUPABASE-SECURITY-ADVISORS-20261022.json";
const MIGRATION="ops/finance/PAY4C0-READONLY-MANAGED-MIGRATION-EVIDENCE-20261022.json";
const sum=x=>createHash("sha256").update(x).digest("hex");
export function inspectPay4c1CertificationEvidence({root=ROOT,env={}}={}){
 let raw,advisors;
 const errors=[];
 try{
  raw=readFileSync(path.join(root,ADVISOR));
  advisors=JSON.parse(raw.toString("utf8"));
 }catch{errors.push("SECURITY_ADVISORS_MISSING");}
 const observation=inspectManagedMigrationObservation(path.join(root,MIGRATION));
 const legacy=inspectPay4aMigrationInventory({root});
 const candidates=buildFinanceReviewManifest({root});
 if(!observation.ok)errors.push("MIGRATION_LIST_OBSERVATION_UNVERIFIED");
 if(!legacy.ok)errors.push("HISTORICAL_QUARANTINE_HASH_MISMATCH");
 if(!candidates.checksPassed)errors.push("FINANCE_SQL_REVIEW_SOURCE_CHANGED");
 const results=advisors?.environments;
 if(advisors?.schema!=="qf.finance.pay4c1.security-advisors-observation.v1"||
  advisors?.managedSqlChangesPerformed!==false||advisors?.independentAppsecSigned!==false||
  !Array.isArray(results)||results.length!==2||
  results[0]?.name!=="QuickFurno Staging"||
  results[1]?.name!=="QuickFurno Production")
  errors.push("SECURITY_ADVISORS_INVALID");
 const lints=Array.isArray(results)?results.flatMap(x=>x.lints??[]):[];
 const unresolved=lints.filter(x=>x.severity==="ERROR"||x.severity==="WARN");
 if(unresolved.length<4)errors.push("EXPECTED_UNRESOLVED_ADVISORS_MISSING");
 const activated=Object.keys(env).filter(k=>/^FINANCE_V2_|^VOX_FINANCE_/.test(k)&&env[k]);
 if(activated.length)errors.push("FINANCIAL_FEATURE_FLAGS_ENABLED");
 return Object.freeze({schema:"qf.finance.pay4c1.readiness.v1",
  sourceEvidenceIntegrity:errors.length===0,errors,
  sourceBundleFingerprint:sum(JSON.stringify({
   advisorHash:raw?sum(raw):null,
   migrationObservationSha256:observation.sourceObservationDigest,
   candidates:candidates.hashes.map(x=>x.sha256),legacyHash:legacy.ledgerHash
  })),
  sqlCandidateCount:candidates.candidateCount,
  managedMigrationVersionsObserved:observation.observedCounts,
  advisorFindings:unresolved.length,advisorsMappedToFinance:false,
  remoteObjectAclCertified:false,independentDbaApproved:false,
  independentAppsecApproved:false,actualStagingBackupVerified:false,
  actualSignedStagingArtifactsPresent:false,actualRazorpayTestCertified:false,
  sourceOnly:true,releaseStatus:"HOLD",financialReleaseAuthorized:false,
  workerSchedulingAuthorized:false,refundExecutionAuthorized:false,
  nextHumanGates:["RECONCILE_LEGACY_MIGRATION","IDENTIFY_SECURITY_ADVISOR_OBJECTS",
   "INDEPENDENT_DBA_ACL_RLS_REVIEW","INDEPENDENT_APPSEC_MFA_REVIEW",
   "SIGNED_TEST_ONLY_STAGING_DEPLOY","RAZORPAY_PROVIDER_TEST_CERTIFICATION",
   "ACTUAL_BANK_RECONCILIATION","OWNER_GO_NO_GO"]});
}
