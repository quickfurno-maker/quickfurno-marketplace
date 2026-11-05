/**
 * Phase 4: compares independently captured READ-ONLY Staging observations with
 * seven immutable vendor SQL source pins. NO network, SQL, credentials, writes,
 * storage or deployment. A snapshot never acts as managed staging attestation.
 */
import {readFileSync,readdirSync} from "node:fs";
import {resolve,dirname,join} from "node:path";
import {fileURLToPath} from "node:url";
import {MIGRATIONS} from "../vendor/vendor-seven-migration-fingerprint.mjs";
import {validatePinnedVendorPendingFiles} from "../vox/rc-launch-vendor-pending-source-addendum.mjs";
const root=resolve(dirname(fileURLToPath(import.meta.url)),"../../..");
export const sourceVersions=Object.freeze(MIGRATIONS.map(([f])=>f.slice(0,14)));
export function evaluateStagingCatalogObservation(snapshot){
 if(!snapshot||snapshot.schema!=="qf.launch.p4.staging-catalog-observation.v1"||
    snapshot.scope!=="QUICKFURNO_STAGING_ONLY_READ_ONLY"||
    snapshot.readOnly!==true||snapshot.signedProviderAttestation!==false||
    snapshot.releaseDecision!=="HOLD"||snapshot.canDeploy!==false||
    snapshot.canApplyMigrations!==false||
    !Array.isArray(snapshot.managementActionsPerformed)||
    snapshot.managementActionsPerformed.length!==0)
  throw Error("P4_UNTRUSTED_STAGING_OBSERVATION");
 const o=snapshot.observations;
 if(!o||!Array.isArray(o.sevenRequiredVersions)||o.sevenRequiredVersions.length!==7||
    !Number.isSafeInteger(o.appliedMigrationCount)||o.appliedMigrationCount<0||
    !/^\d{14}$/.test(o.latestAppliedMigrationVersion)||!Number.isSafeInteger(o.verificationBucketCount)||
    !Number.isSafeInteger(o.vendorPrivateOrVoxFunctions)||!Number.isSafeInteger(o.vendorVerificationRelatedTables))
  throw Error("P4_INVALID_STAGING_CATALOG");
 const versions=o.sevenRequiredVersions.map(x=>x?.version);
 if(new Set(versions).size!==7||
    JSON.stringify(versions)!==JSON.stringify(sourceVersions)||
    o.sevenRequiredVersions.some(x=>typeof x.applied!=="boolean"))
  throw Error("P4_SOURCE_VERSION_SET_DRIFT");
 const missing=o.sevenRequiredVersions.filter(x=>!x.applied).map(x=>x.version);
 const blockers=[
  ...missing.map(x=>"STAGING_SQL_NOT_IN_APPLIED_LEDGER:"+x),
  ...(o.verificationBucketCount<1?["STAGING_PRIVATE_VENDOR_BUCKET_NOT_OBSERVED"]:[]),
  ...(o.vendorPrivateOrVoxFunctions<1?["STAGING_VENDOR_PRIVATE_AND_OWNER_RPC_NOT_OBSERVED"]:[]),
  "NO_SIGNED_STAGING_BACKUP_ISOLATED_RESTORE",
  "NO_APPROVED_MANAGED_MIGRATION_INSTALL",
  "NO_AUTHENTICATED_OWNER_AAL2_BROWSER_UAT",
  "NO_CERTIFIED_CLAMAV_EICAR_AND_SCAN_RECEIPTS",
  "NO_SIGNED_WHATSAPP_DELIVERY_OR_GOOGLE_PLACES",
  "NO_DEPLOYED_WEB_CORE_IMAGE_ATTESTATION",
  "NO_SEPARATE_OWNER_STAGING_GO",
 ];
 return Object.freeze({
  schema:"qf.launch.p4.staging-preflight-reconciliation.v1",
  observedDate:snapshot.observedDate,
  observationIsSigned:false,
  observedAppliedMigrationCount:o.appliedMigrationCount,
  observedLatestAppliedVersion:o.latestAppliedMigrationVersion,
  totalRequiredVendorVersions:7,
  stagedVendorVersionsPresent:7-missing.length,
  vendorVersionAbsences:Object.freeze(missing),
  bucketObserved:o.verificationBucketCount>0,
  ownerVendorRpcObserved:o.vendorPrivateOrVoxFunctions>0,
  liveDatabaseModified:false,
  certifiedManagedSchema:false,certifiedRestore:false,
  canInstall:false,canDeploy:false,canActivate:false,
  releaseDecision:"HOLD",blockers:Object.freeze(blockers)
 });
}
export function runP4LocalSnapshot(){
 const dir=resolve(root,"supabase/migrations");
 validatePinnedVendorPendingFiles({
  names:readdirSync(dir).filter(x=>/^\d{14}_.+\.sql$/.test(x)),sourceDir:dir,
 });
 const obs=JSON.parse(readFileSync(resolve(root,
  "docs/vox/QF-P4-READONLY-STAGING-CATALOG-OBSERVATION-20261105.json"),"utf8"));
 return evaluateStagingCatalogObservation(obs);
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const r=runP4LocalSnapshot();
 process.stdout.write(JSON.stringify(r,null,2)+"\n");
 process.exitCode=2; // readiness not certified, even though source report is valid
}
