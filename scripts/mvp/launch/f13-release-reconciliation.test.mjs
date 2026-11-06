import test from "node:test";
import assert from "node:assert/strict";
import {EXPECTED,EXPECTED_MIGRATIONS,reconcileF13} from "./f13-release-reconciliation.mjs";
import snapshot from "../../../docs/launch/qf-f13-release-reconciliation-20261106.json" with {type:"json"};
const green={...snapshot, migrationSourceShaVerified:true,managedBackupAndRestoreVerified:true,
rollbackManifestVerified:true,stagingSignedImageDigestVerified:true,
originalF1F5F6ChecksReconciled:true,integrationReviewApproved:true,
metaCallbackDashboardVerified:true,supabaseHookDashboardVerified:true,
clientTokenAuthorityVerified:true,vendorTokenAuthorityVerified:true,
twoSendersConfiguredIndependently:true,vendorQuality:"GREEN",
signedCallbackReceiptVerified:true,ownerStageGo:true};
test("F13-01 observed ten migration versions exist in Staging registry",()=>assert.equal(reconcileF13(snapshot).migrationVersionsRegistered,true));
test("F13-02 actual evidence remains HOLD despite installed versions",()=>assert.equal(reconcileF13(snapshot).releaseVerdict,"HOLD"));
test("F13-03 missing migration is caught",()=>assert.ok(reconcileF13({...green,registeredMigrationVersions:green.registeredMigrationVersions.slice(1)}).blockers.includes("STAGING_MIGRATION_VERSIONS_NOT_EXACT")));
test("F13-04 duplicate migration version is rejected",()=>assert.ok(reconcileF13({...green,registeredMigrationVersions:[...EXPECTED_MIGRATIONS.slice(0,9),EXPECTED_MIGRATIONS[0]]}).blockers.includes("STAGING_MIGRATION_VERSIONS_NOT_EXACT")));
test("F13-05 bad project is rejected",()=>assert.ok(reconcileF13({...green,supabaseProject:"production"}).blockers.includes("WRONG_STAGING_PROJECT")));
test("F13-06 wrong source SHA rejected",()=>assert.ok(reconcileF13({...green,reviewedSourceHead:"unknown"}).blockers.includes("SOURCE_HEAD_UNVERIFIED")));
test("F13-07 40-commit delta cannot change silently",()=>assert.ok(reconcileF13({...green,commitCountAhead:41}).blockers.includes("RELEASE_SPAN_DRIFT_UNREVIEWED")));
test("F13-08 registered versions do not imply SQL source checksum",()=>assert.ok(reconcileF13({...green,migrationSourceShaVerified:false}).blockers.includes("MIGRATION_SQL_CHECKSUMS_UNVERIFIED")));
test("F13-09 backup without restore drill insufficient",()=>assert.ok(reconcileF13({...green,managedBackupAndRestoreVerified:false}).blockers.includes("MANAGED_BACKUP_RESTORE_UNVERIFIED")));
test("F13-10 rollback manifest mandatory",()=>assert.ok(reconcileF13({...green,rollbackManifestVerified:false}).blockers.includes("EXACT_ROLLBACK_MANIFEST_UNVERIFIED")));
test("F13-11 signed digest mandatory",()=>assert.ok(reconcileF13({...green,stagingSignedImageDigestVerified:false}).blockers.includes("SIGNED_IMAGE_DIGEST_UNVERIFIED")));
test("F13-12 original protected CI requires reconciliation",()=>assert.ok(reconcileF13({...green,originalF1F5F6ChecksReconciled:false}).blockers.includes("INHERITED_PROTECTED_CI_UNRESOLVED")));
test("F13-13 real provider dashboard callback proof required",()=>assert.ok(reconcileF13({...green,metaCallbackDashboardVerified:false}).blockers.includes("META_REGISTERED_CALLBACK_UNVERIFIED")));
test("F13-14 Auth Hook URI cannot be inferred from HTTP 405",()=>assert.ok(reconcileF13({...green,supabaseHookDashboardVerified:false}).blockers.includes("SUPABASE_AUTH_HOOK_URI_UNVERIFIED")));
test("F13-15 token authority is distinct for vendor and client",()=>assert.ok(reconcileF13({...green,vendorTokenAuthorityVerified:false}).blockers.includes("VENDOR_TOKEN_AUTHORITY_UNVERIFIED")));
test("F13-16 RED vendor quality blocks",()=>assert.ok(reconcileF13({...green,vendorQuality:"RED"}).blockers.includes("VENDOR_QUALITY_NOT_GREEN")));
test("F13-17 sender isolation must be deployed not merely in source",()=>assert.ok(reconcileF13({...green,twoSendersConfiguredIndependently:false}).blockers.includes("TWO_SENDERS_NOT_INSTALLED")));
test("F13-18 side-effect flags OFF must be independently verified",()=>assert.ok(reconcileF13({...green,outboundOff:false}).blockers.includes("SIDE_EFFECT_FLAGS_NOT_ALL_OFF")));
test("F13-19 deferred ClamAV must fail-closed",()=>assert.ok(reconcileF13({...green,scanDependentApprovalsBlocked:false}).blockers.includes("DEFERRED_SCAN_FAIL_CLOSED_UNVERIFIED")));
test("F13-20 even forged all-green evidence never authorizes deployment or OTP",()=>{const r=reconcileF13(green);assert.equal(r.blockers.length,0);assert.equal(r.releaseVerdict,"HOLD");assert.equal(r.mayDeployStaging,false);assert.equal(r.maySendOtp,false);});
test("F13-21 malformed evidence never authorizes",()=>{for(const e of [null,[],4,"ok",false]){const r=reconcileF13(e);assert.equal(r.mayDeployProduction,false);assert.equal(r.releaseVerdict,"HOLD");}});
test("F13-22 client and vendor sender IDs differ",()=>{assert.notEqual(EXPECTED.client.waba,EXPECTED.vendor.waba);assert.notEqual(EXPECTED.client.phone,EXPECTED.vendor.phone);});
test("F13-23 credentials and OTP not present in attestation",()=>{const s=JSON.stringify(snapshot);for(const word of ["access_token","app_secret","sms_hook_secret","otp_code","bearer "]) assert.ok(!s.toLowerCase().includes(word));});
