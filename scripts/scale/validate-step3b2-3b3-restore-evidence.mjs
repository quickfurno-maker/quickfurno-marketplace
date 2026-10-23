#!/usr/bin/env node
// Offline static audit of captured Step 3B-2/3B-3 evidence.
// Never connects to Supabase, never grants release authority.
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {fileURLToPath} from "node:url";
const root=resolve(fileURLToPath(new URL("../..",import.meta.url)));
const data=JSON.parse(readFileSync(resolve(root,"ops/vox/certification/STEP3B2-3B3-FRESH-RESTORE-SECURITY-EVIDENCE-20261023.json"),"utf8"));
const checks=[
 ["schema locked",data.schema==="qf.step3b2.step3b3.offline-recovery-security-evidence.v1"],
 ["expected fresh archive, not Oct16 baseline",data.archive.bytes===2010560&&data.archive.sha256==="E303BC25D904899459C56493F7D67B1960056DA4F4EAF78905B4F2F50AF75753"],
 ["bounded four schema backup",data.archive.scope.join(",")==="public,auth,storage,supabase_migrations"&&!data.archive.fullClusterBackup],
 ["offline restore no network/public ports",data.restore.networkMode==="none"&&data.restore.publishedPorts===0&&data.restore.restoreExitCode===0&&data.restore.disposableContainerStopped],
 ["restored count positive checks",data.inventory.migrations===86&&data.inventory.authUsers===2&&data.inventory.tables===178&&data.inventory.unvalidatedForeignKeys===0],
 ["RLS and foreign key coverage documented",data.inventory.rlsEnabled===166&&data.inventory.policies===74&&data.inventory.triggers===75&&data.inventory.foreignKeys===272],
 ["schema fingerprint evidence recorded",["migrationHistoryMd5","policiesMd5","triggerBindingsMd5","foreignKeyDefinitionsMd5"].every(k=>/^[a-f0-9]{32}$/.test(data.fingerprints[k]))],
 ["source environment remained unchanged",data.actualManagedSqlWrites===0&&!data.stagingMigrationApplied],
 ["legacy privileged account review unresolved",data.securityFindings.privilegedLegacySuperadminBackfillCandidates===1&&!data.securityFindings.appsecIndependentSignoff],
 ["independent DBA and AppSec are NOT approved",!data.restore.independentDbaApproved&&!data.securityFindings.dbIndependentSignoff],
 ["full recovery limitations remain explicit",!data.restore.roleAclReplayVerified&&!data.restore.fullClusterPitrCertified&&!data.restore.objectStorageBinaryRecoveryVerified&&!data.restore.imageDigestPinned],
 ["Owner MFA and production finance remain blocked",!data.ownerSuperadminGranted&&!data.mfaVerified&&!data.releaseAuthorized]
];
for(const [label,ok] of checks){assert.ok(ok,label);console.log("PASS "+label)}
console.log("STEP3B2_STEP3B3_STATIC_EVIDENCE_PASS "+checks.length+"/"+checks.length+" RELEASE_HOLD");
