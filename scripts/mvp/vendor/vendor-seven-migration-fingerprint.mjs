#!/usr/bin/env node
/**
 * The seven new vendor migrations have NOT been installed on managed Staging.
 * This offline source-only packet pins the exact PR #484 reviewed source bytes.
 * Neither this tool nor a successful check is migration authorization.
 */
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const SOURCE_PARENT_SHA = "b177f5289a10a0736e5ddd5e206304eb49e44ba1";
export const MIGRATIONS = Object.freeze([
  ["20261104090000_vendor_registration_consent_receipt.sql", "d633187e5084591056c4a87687297fd9ca385a9e1a8d03ff8ae4df6d9e2c9e19"],
  ["20261104140000_vendor_private_otp_and_verification_foundation.sql", "cb5a4e1f74c6cbc6a6f4a89464c4d7235956b2ae9b71c3bd79bf39ed70581f48"],
  ["20261104153000_vendor_atomic_pending_registration.sql", "2f62663edc5f64122f771f8c141019933b7f4eba1680a8a62a8af9c150972596"],
  ["20261104160000_vendor_owner_review_assignment_gate.sql", "177c8f11ffeee951040e04bdb1a75e0391308ba022e00cdbd979a675a352e89e"],
  ["20261104163000_vendor_private_document_intake.sql", "dd4914f154e75e361ad862a17a702b9e72f3252e22e3c0a041616507ef3fd7d2"],
  ["20261104170000_vox_owner_vendor_review_queue.sql", "47dd11398806729bb93609857cf037cb3123cc0faaf703383a4885f287fe7012"],
  ["20261104173000_vendor_private_scan_quarantine.sql", "da53a260e9a15b39c24701e480f3d52759965406c8fbbebc2ac383767f481a68"],
]);
const sha256=bytes=>createHash("sha256").update(bytes).digest("hex");
const root=resolve(dirname(fileURLToPath(import.meta.url)),"../../..");
const dir="supabase/migrations";

export function evaluateMigrationSources({listNames,readBytes}) {
  const expected=MIGRATIONS.map(([name])=>name);
  const actual=listNames.filter(n=>/^20261104\d{6}_.+\.sql$/.test(n)).sort();
  const errors=[];
  if(JSON.stringify(actual)!==JSON.stringify(expected))
    errors.push("SEVEN_SOURCE_FILES_MISSING_EXTRA_OR_REORDERED");
  const rows=MIGRATIONS.map(([file,pinnedSha256])=>{
    let observedSha256=null;
    try {const bytes=readBytes(file);observedSha256=sha256(bytes);}
    catch {errors.push("MISSING_SOURCE:"+file);}
    if(observedSha256!==null&&observedSha256!==pinnedSha256)
      errors.push("SOURCE_SHA_CHANGED:"+file);
    return {version:file.slice(0,14),file,expectedSha256:pinnedSha256,
      observedSha256,sourceMatch:observedSha256===pinnedSha256};
  });
  return {
    schema:"qf.vendor.seven-migration-source-fingerprints.v1",
    pinnedSourceCommit:SOURCE_PARENT_SHA,
    sourceVerdict:errors.length===0?"SOURCE_EXACT":"SOURCE_BLOCKED",
    releaseDecision:"HOLD",canApplyStaging:false,canApplyProduction:false,
    connectsToManaged:false,executesSql:false,updatesLedger:false,
    migrationSourceCount:rows.length,
    reviewRequired:["INDEPENDENT_STAGING_LEDGER_CAPTURE",
      "LEGACY_SCHEMA_AND_GRANT_COMPATIBILITY",
      "HISTORIC_VOX_RC22_TO_RC40_GOVERNANCE_RECONCILIATION",
      "MANAGED_BACKUP_ISOLATED_RESTORE_AND_SIGNED_ROLLBACK",
      "DBA_APPSEC_OWNER_STAGING_GO"],
    blockedReasons:[...errors,
      "NO_MANAGED_STAGING_LEDGER_OR_CATALOG_EVIDENCE",
      "NO_MANAGED_RECOVERY_ATTESTATION",
      "NO_OWNER_STAGING_AUTHORIZATION"],
    migrations:rows
  };
}
export function collectMigrationSources(directory=resolve(root,dir)) {
  return evaluateMigrationSources({
    listNames:readdirSync(directory),
    readBytes:file=>readFileSync(resolve(directory,file))
  });
}
const isMain=process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url);
if(isMain){
  const result=collectMigrationSources();
  process.stdout.write(JSON.stringify(result,null,2)+"\n");
  if(result.sourceVerdict!=="SOURCE_EXACT")process.exitCode=1;
}
