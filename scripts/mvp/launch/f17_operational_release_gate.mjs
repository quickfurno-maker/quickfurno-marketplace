/**
 * F17 fail-closed operational release gate.
 * Input: sanitized observations gathered OUTSIDE CI from actual systems.
 * Never connects to providers, sends messages, deploys, updates DB or reads secrets.
 * Successful smoke/CI alone cannot issue Owner GO.
 */
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";

const CLIENT={waba:"27861262223494153",phone:"1333595106493545"};
const VENDOR={waba:"1569174604351612",phone:"1088396637681784"};
const PROJECT="uckafzuochmbvtiodmcl";
const OLD_IMAGE="qf-core-staging:09b9d7a4";
export const REQUIRED_REAL_EVIDENCE=Object.freeze([
 "F17_ROTATE_EXPOSED_STAGING_KEYS",
 "F17_PROTECTED_RELEASE_CHECKS_OR_APPROVED_INTEGRATION_REVIEW",
 "F17_MANAGED_CURRENT_DB_AUTH_STORAGE_RECOVERY",
 "F17_TEN_SQL_MIGRATION_CONTENT_PARITY",
 "F17_SIGNED_IMMUTABLE_CANDIDATE",
 "F17_CORE_SEPARATE_SENDER_RUNTIME_SECRETS",
 "F17_REGISTERED_VENDOR_META_CALLBACK",
 "F17_REGISTERED_SUPABASE_AUTH_HOOK_URL",
 "F17_SIGNED_CALLBACK_STAGING_NEGATIVE_E2E",
 "F17_OWNER_DEPLOYMENT_APPROVAL",
]);
const record=(e,k)=>e && typeof e==="object" && !Array.isArray(e) ? e[k] : undefined;
export function evaluateF17(e) {
 const fail=[];
 const add=(pass,code)=>{if(!pass)fail.push(code);};
 if(!e || typeof e!=="object" || Array.isArray(e)){
  return {schema:"quickfurno.f17.release-gate.v1",releaseVerdict:"HOLD",
    mayDeployStaging:false,maySendOtp:false,mayDeployProduction:false,
    blockers:["F17_MISSING_OR_MALFORMED_EVIDENCE"],externalProviderActionsPerformed:false};
 }
 const g=e.github||{},s=e.stagingCore||{},m=e.meta||{},db=e.database||{},h=e.hooks||{},a=e.artifacts||{},owner=e.owner||{},sec=e.security||{};
 add(g.f10CrossPhaseRecertPassed===true&&g.f14CIpassed===true&&g.f16CIpassed===true,"F17_CROSS_PHASE_CI_INCOMPLETE");
 add(g.originalProtectedF1F5F6F7Green===true || g.reviewedIntegrationOverrideAccepted===true,
  "F17_PROTECTED_RELEASE_CHECKS_OR_APPROVED_INTEGRATION_REVIEW");
 add(g.approvedReleaseHead&&/^[0-9a-f]{40}$/.test(g.approvedReleaseHead)&&
     g.approvedReleaseHead===a.candidateSourceSha,"F17_APPROVED_RELEASE_HEAD_NOT_PINNED");
 add(s.currentImage!==OLD_IMAGE && s.imageAttested===true && s.sourceSha===g.approvedReleaseHead,
   "F17_LIVE_CORE_STILL_OLD_OR_UNATTESTED");
 add(s.senderClassification==="RIYA_CLIENT"&&s.vendorPairExact===true&&
     s.clientTokenPresent===true&&s.vendorTokenPresent===true&&s.signingSecretsPresent===true,
  "F17_CORE_SEPARATE_SENDER_RUNTIME_SECRETS");
 add(m.client?.waba===CLIENT.waba&&m.client?.phone===CLIENT.phone&&
    m.client?.status==="CONNECTED"&&m.client?.tokenAuthorityVerified===true,
    "F17_CLIENT_META_ACCOUNT_AUTHORITY");
 add(m.vendor?.waba===VENDOR.waba&&m.vendor?.phone===VENDOR.phone&&
    m.vendor?.status==="CONNECTED"&&m.vendor?.tokenAuthorityVerified===true,
    "F17_VENDOR_META_ACCOUNT_AUTHORITY");
 // Meta RED is NOT a permanent veto for future explicitly bounded testing.
 // But this evaluator never grants real OTP or deploy from a quality rating.
 add(m.vendor?.quality==="GREEN"||m.vendor?.quality==="RED",
    "F17_VENDOR_META_QUALITY_UNVERIFIED");
 add(m.vendor?.registeredCallbackVerified===true &&
     m.vendor?.registeredCallbackHost==="staging-core.quickfurno.in" &&
     m.vendor?.registeredCallbackPath==="/api/webhooks/whatsapp/meta",
     "F17_REGISTERED_VENDOR_META_CALLBACK");
 add(h.supabaseAuthHookRegistered===true &&
     h.supabaseAuthHookUrl==="https://staging-core.quickfurno.in/api/auth/hooks/supabase-send-sms" &&
     h.supabaseAuthHookEnabled===true,
     "F17_REGISTERED_SUPABASE_AUTH_HOOK_URL");
 add(h.signedCallbacksNegativeE2ePassed===true&&h.verifiedSource==="actual-staging",
     "F17_SIGNED_CALLBACK_STAGING_NEGATIVE_E2E");
 add(db.projectId===PROJECT && db.migrationsRegistered===10,
     "F17_STAGING_MIGRATION_VERSIONS");
 add(db.sqlContentParityVerified===true,
     "F17_TEN_SQL_MIGRATION_CONTENT_PARITY");
 add(db.freshDbAuthStorageSnapshotVerified===true&&db.restoreOnIsolatedDatabasePassed===true&&
     db.storageObjectBytesVerified===true,
     "F17_MANAGED_CURRENT_DB_AUTH_STORAGE_RECOVERY");
 add(db.providerRowsAreDormant===true&&db.recordedLoginOtpMessages===0,
     "F17_PROVIDER_DORMANCY_BEFORE_DEPLOY");
 add(a.oldCoreRollbackImageArchiveVerified===true&&a.oldComposeAndEnvSnapshotsVerified===true,
     "F17_ROLLBACK_INCOMPLETE");
 add(a.signedImmutableImageVerified===true&&a.candidateSha256&&
     /^sha256:[0-9a-f]{64}$/.test(a.candidateSha256),
     "F17_SIGNED_IMMUTABLE_CANDIDATE");
 add(sec.exposedStagingKeysRotatedAndRevoked===true &&
     sec.oldTokensInvalidatedVerified===true,
     "F17_ROTATE_EXPOSED_STAGING_KEYS");
 add(owner.stagingChangeApproved===true&&owner.rollbackOperatorConfirmed===true,
     "F17_OWNER_DEPLOYMENT_APPROVAL");
 add(sec.clamavActivationDeferred===true && sec.scanDependentApprovalAndCreditsFailClosed===true,
     "F17_DEFERRED_DOCUMENT_SCAN_SAFETY");
 // Intentionally never deploy directly. A real operator-reviewed runbook owns GO.
 return {schema:"quickfurno.f17.release-gate.v1",releaseVerdict:"HOLD",
  mayDeployStaging:false,maySendOtp:false,mayDeployProduction:false,
  externalProviderActionsPerformed:false,allRequiredFactsSatisfied:fail.length===0,
  blockers:fail};
}
if(process.argv[1] && fileURLToPath(import.meta.url)===process.argv[1]){
 try{
  const data=JSON.parse(readFileSync(process.argv[2],"utf8"));
  console.log(JSON.stringify(evaluateF17(data)));
 } catch {
  console.log(JSON.stringify(evaluateF17(null)));
  process.exitCode=1;
 }
}
