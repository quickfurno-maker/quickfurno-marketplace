/**
 * F13 source-only Staging predeployment reconciliation.
 * Reads sanitized evidence only: NO network, credentials, disk writes or release side effects.
 * Every result is advisory; a green fixture must never authorize a deploy or an OTP.
 */
export const EXPECTED_MIGRATIONS = Object.freeze([
  "20261104090000",
  "20261104140000",
  "20261104153000",
  "20261104160000",
  "20261104163000",
  "20261104170000",
  "20261104173000",
  "20261106113825",
  "20261106114301",
  "20261106120124",
]);
export const EXPECTED = Object.freeze({
  baseImageRevision:"09b9d7a484c07fdc60009cbde1332dd4834ae3af",
  proposedHead:"56aa7959285f4f2b19fbf3e3c90a0fa38bb2ba50",
  stagingProject:"uckafzuochmbvtiodmcl",
  coreHost:"staging-core.quickfurno.in",
  client:{waba:"27861262223494153",phone:"1333595106493545"},
  vendor:{waba:"1569174604351612",phone:"1088396637681784"},
});
const isRecord=x=>x!==null&&typeof x==="object"&&!Array.isArray(x);
const distinct=a=>new Set(a).size===a.length;
export function reconcileF13(evidence={}){
  const e=isRecord(evidence)?evidence:{};
  const failures=[];
  const check=(ok,code)=>{if(!ok)failures.push(code);};
  check(e.source==="read-only-observations", "EVIDENCE_SOURCE_UNVERIFIED");
  check(e.supabaseProject===EXPECTED.stagingProject,"WRONG_STAGING_PROJECT");
  check(e.stagingBaseRevision===EXPECTED.baseImageRevision,"BASE_IMAGE_REVISION_UNVERIFIED");
  check(e.reviewedSourceHead===EXPECTED.proposedHead,"SOURCE_HEAD_UNVERIFIED");
  check(e.commitCountAhead===40,"RELEASE_SPAN_DRIFT_UNREVIEWED");
  check(e.coreHost===EXPECTED.coreHost,"CORE_HOST_UNVERIFIED");
  const registered=Array.isArray(e.registeredMigrationVersions)?
    e.registeredMigrationVersions.filter(v=>typeof v==="string"):[];
  check(registered.length===10&&distinct(registered)&&
    EXPECTED_MIGRATIONS.every(v=>registered.includes(v)), "STAGING_MIGRATION_VERSIONS_NOT_EXACT");
  check(e.migrationSourceShaVerified===true,"MIGRATION_SQL_CHECKSUMS_UNVERIFIED");
  check(e.managedBackupAndRestoreVerified===true,"MANAGED_BACKUP_RESTORE_UNVERIFIED");
  check(e.rollbackManifestVerified===true,"EXACT_ROLLBACK_MANIFEST_UNVERIFIED");
  check(e.stagingSignedImageDigestVerified===true,"SIGNED_IMAGE_DIGEST_UNVERIFIED");
  check(e.originalF1F5F6ChecksReconciled===true,"INHERITED_PROTECTED_CI_UNRESOLVED");
  check(e.integrationReviewApproved===true,"INTEGRATION_REVIEW_NOT_APPROVED");
  check(e.metaCallbackDashboardVerified===true,"META_REGISTERED_CALLBACK_UNVERIFIED");
  check(e.supabaseHookDashboardVerified===true,"SUPABASE_AUTH_HOOK_URI_UNVERIFIED");
  check(e.clientTokenAuthorityVerified===true,"CLIENT_TOKEN_AUTHORITY_UNVERIFIED");
  check(e.vendorTokenAuthorityVerified===true,"VENDOR_TOKEN_AUTHORITY_UNVERIFIED");
  check(e.twoSendersConfiguredIndependently===true,"TWO_SENDERS_NOT_INSTALLED");
  check(e.vendorQuality==="GREEN","VENDOR_QUALITY_NOT_GREEN");
  check(e.signedCallbackReceiptVerified===true,"SIGNED_CALLBACK_RECEIPT_UNVERIFIED");
  check(e.ownerStageGo===true,"OWNER_STAGING_GO_UNRECORDED");
  check(e.oldCoreStillLive===true,"NO_MUTATION_ASSERTION_UNVERIFIED");
  check(e.outboundOff===true&&e.webhooksOff===true&&e.otpCanaryOff===true,
    "SIDE_EFFECT_FLAGS_NOT_ALL_OFF");
  check(e.clamavDeferred===true&&e.scanDependentApprovalsBlocked===true,
    "DEFERRED_SCAN_FAIL_CLOSED_UNVERIFIED");
  return Object.freeze({
    schema:"quickfurno.f13.staging-release-reconciliation.v1",
    mode:"SOURCE_ONLY_READ_ONLY",
    migrationVersionCount:registered.length,
    migrationVersionsRegistered:registered.length===10&&distinct(registered)&&
      EXPECTED_MIGRATIONS.every(v=>registered.includes(v)),
    codeCommitsAhead:e.commitCountAhead===40?40:null,
    blockers:Object.freeze([...new Set(failures)]),
    releaseVerdict:"HOLD",
    mayDeployStaging:false,
    maySendOtp:false,
    mayDeployProduction:false,
    mayApproveVendor:false,
  });
}
if(process.argv[1]?.endsWith("f13-release-reconciliation.mjs") && process.argv.includes("--stdin")){
  let body="";
  for await(const part of process.stdin){
    body+=part;
    if(body.length>12000)throw Error("F13_SANITIZED_EVIDENCE_TOO_LARGE");
  }
  let e;
  try{e=JSON.parse(body)}catch{e={}}
  console.log(JSON.stringify(reconcileF13(e)));
}
