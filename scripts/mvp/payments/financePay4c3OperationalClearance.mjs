import {readFileSync} from "node:fs";
import {createHash} from "node:crypto";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {buildPay4c2StagingReleasePreflight} from "./financePay4c2StageRelease.mjs";
import {buildPay4c1TestRunbook} from "../../../lib/payments/financePay4c1TestPlan.mjs";
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"../../..");
const OBS="ops/finance/PAY4C3-LIVE-INTERNAL-READONLY-AUDIT-20261022.json";
const sha=x=>createHash("sha256").update(x).digest("hex");
const has=(a,x)=>Array.isArray(a)&&a.includes(x);
export function reviewPay4c3OperationalClearance({root=ROOT,flags={},attestations={}}={}){
 const issues=[],stage=buildPay4c2StagingReleasePreflight({root,env:flags});
 const provider=buildPay4c1TestRunbook(attestations);
 let snapshot=null;
 try{snapshot=JSON.parse(readFileSync(path.join(root,OBS),"utf8"));}
 catch{issues.push("LIVE_OBSERVATION_NOT_AVAILABLE");}
 const envs=snapshot?.environments;
 if(snapshot?.schema!=="qf.finance.pay4c3.live-readonly-observation.v1"||
    !Array.isArray(envs)||envs.length!==2||
    envs[0]?.name!=="QuickFurno Staging"||
    envs[1]?.name!=="QuickFurno Production"||
    snapshot.managedWritesPerformed!==false)
  issues.push("INVALID_AUDIT_OBSERVATION");
 const required=["security_definer_view","authenticated_security_definer_function_executable"];
 for(const env of envs??[]){
  if(!Number.isInteger(env.authUsers)||env.authUsers<0||
   !Number.isInteger(env.verifiedMfa)||env.verifiedMfa<0||
   !Number.isInteger(env.financeTables)||env.financeTables<0||
   !Number.isInteger(env.voxTables)||env.voxTables<0||
   !required.every(name=>has(env.findingNames,name)))
    issues.push("OBSERVATION_SCHEMA_DRIFT:"+env.name);
 }
 if(!stage.sourceValidationOk)issues.push("STAGING_SOURCE_PRECHECK_FAILED");
 // A boolean from a caller cannot substitute for independently reviewed evidence.
 const gates=Object.freeze({
  A:{sourceCandidateIntegrity:stage.sourceValidationOk,remoteFinanceSchemaPresent:
    (envs?.[0]?.financeTables??0)>0,legacyMigrationReconciled:false,dbApproval:false},
  B:{sourceIdentityGuardsChecked:stage.sourceValidationOk,
    ownerAal2Verified:false,staffAal2Verified:false,independentStaffReviewerVerified:false},
  C:{existingCoreDefinerObjectsStillNeedReview:true,
    publicVendorDiscoverabilityRegressionTestPending:true,appsecSignoff:false},
  D:{sourceFingerprint:stage.sourceFingerprint,actualSignedArtifact:false,
    databaseBackupRestoredInManagedStaging:false,stagingDeploymentApproved:false},
  E:{syntheticProviderScenarios:provider.orderedScenarios.length,
    actualRazorpayTestTransactions:0,realRefundsExecuted:0,
    authenticBankSettlementProof:false},
  F:{isolatedPostgresqlMultiClientTestsRequired:true,
    exactHeadGitHubCICertificationPending:true}
 });
 const unresolved=Object.freeze([
  "LIVE_SCHEMA_0_FINANCE_AND_VOX", "VERIFIED_OWNER_STAFF_MFA_ABSENT",
  "LEGACY_VOX_MIGRATION_VALIDATOR_ENOENT",
  "LIVE_CORE_SECURITY_DEFINER_VIEW_AND_FUNCTION_REVIEW",
  "INDEPENDENT_DBA_APPSEC_SIGNOFF_ABSENT",
  "SIGNED_STAGING_BUILD_AND_BACKUP_NOT_CERTIFIED",
  "REAL_RAZORPAY_TEST_AND_BANK_PROOF_NOT_CERTIFIED"
 ]);
 return Object.freeze({schema:"qf.finance.pay4c3.internal-clearance.v1",
  observationIntegrity:issues.length===0,issues,
  observationSha256:snapshot?sha(JSON.stringify(snapshot)):null,
  gates,unresolved, sourceOnly:true,productionGo:false,
  stagingSqlApplyAuthorized:false,stagingWorkerEnabled:false,
  razorpayTestCallsAuthorized:false,financialWritesEnabled:false,
  releaseStatus:"HOLD"});
}
