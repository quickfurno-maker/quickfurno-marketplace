#!/usr/bin/env node
// Source-only release gate. No network, no managed mutations, no fake signatures.
import assert from "node:assert/strict";
import {readFileSync,readdirSync} from "node:fs";
import {resolve,dirname} from "node:path";
import {fileURLToPath} from "node:url";
import {buildStep3b8ReviewPackage} from "./step3b8-review-package.mjs";
const root=resolve(dirname(fileURLToPath(import.meta.url)),"../..");
const file=p=>readFileSync(resolve(root,p),"utf8");
const queue=JSON.parse(file("ops/vox/certification/STEP3B8-REVIEW-QUEUE-20261023.json"));
const expected=buildStep3b8ReviewPackage();
const gate=queue.unresolved;
const report=file("docs/vox/VOX-PROD-READINESS-CERTIFICATION-20261023.md");
const runbook=file("docs/vox/STEP3B8-PROTECTED-STAGING-DEPLOYMENT-RUNBOOK-20261023.md");
const checks=[
 ["review queue reproducible",JSON.stringify(queue)===JSON.stringify(expected)],
 ["104 DBA items still unreviewed",queue.reviewerQueues.DBA.length===104&&queue.reviewerQueues.DBA.every(x=>x.reviewer===null)],
 ["69 AppSec items pending decisions",queue.reviewerQueues.AppSec.length===69&&queue.reviewerQueues.AppSec.every(x=>x.independentDecision==="PENDING")],
 ["DBA/APPSEC proof absent",!queue.independentDbaSigned&&!queue.independentAppsecSigned],
 ["source CI not forged",!queue.sourceCiPassed&&!queue.exactHeadGithubCiVerified],
 ["owner signoffs and actual AAL2 absent",!queue.ownerApprovedManagedStaging&&!queue.ownerAal2Verified],
 ["managed data installation not certified",!queue.managedSchemaInstalled],
 ["provider payments not certified",!queue.providerTestCertified&&!queue.realMoneyAuthorized],
 ["release remains HOLD",queue.releaseStatus==="HOLD"&&!queue.productionDeploymentAuthorized&&!queue.stagingDeploymentAuthorized],
 ["privileged Auth cannot be enabled",!queue.privilegedAuthAuthorized],
 ["104 SQL histories remain unresolved",gate.independentDbaReview===104],
 ["69 RLS policies remain unresolved",gate.independentAppsecPolicyReview===69],
 ["Core route and real E2E remain outstanding",gate.coreVoxOverviewReturned404AtLastStagingProbe&&gate.authenticatedEndToEndPending],
 ["global privileges and recovery outstanding",gate.globalRoleAclPitrRecovery],
 ["no implied no-data-loss audit",report.includes("NOT independently certified for no data loss")],
 ["no implied active agent integration",report.includes("Source contract testing is NOT live managed integration certification")],
 ["report notes no exact-head CI for Antigravity commit",report.includes("NO exact-head GitHub CI")],
 ["runbook prohibits unapproved DDL",runbook.includes("DO NOT APPLY unreviewed migrations")],
 ["runbook gates genuine MFA and production separately",runbook.includes("separate Production GO")],
 ["23 immutable VOX SQL source candidates",readdirSync(resolve(root,"ops/vox/sql-candidates")).filter(x=>x.endsWith(".sql")).length===23],
 ["seven quarantined SQL files unchanged",readdirSync(resolve(root,"ops/vox/quarantined-migrations/legacy-20261014")).filter(x=>x.endsWith(".sql")).length===7],
 ["no runnable step3b8 migration",!readdirSync(resolve(root,"supabase/migrations")).some(x=>/step3b8/i.test(x))]
];
for(const [name,good] of checks){assert.ok(good,name);console.log("PASS "+name);}
console.log("STEP3B8_SOURCE_HOLD "+checks.length+"/"+checks.length+" PASS");
