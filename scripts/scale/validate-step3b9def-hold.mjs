import assert from "node:assert/strict";
import {readFileSync,readdirSync} from "node:fs";
import {resolve,dirname} from "node:path";
import {fileURLToPath} from "node:url";
import {reconcileMetadata} from "./step3b9d-ledger-reconciliation.mjs";
import {effectiveRlsReview} from "./step3b9e-effective-rls-plan.mjs";
import {releasePreflight} from "./step3b9f-release-preflight.mjs";
const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),"../..");
const read=p=>readFileSync(resolve(ROOT,p),"utf8");
const dba=reconcileMetadata(),rls=effectiveRlsReview(),pre=releasePreflight();
const manualD=read("docs/vox/STEP3B9D-MANAGED-MIGRATION-LEDGER-RECOVERY-20261023.md");
const manualE=read("docs/vox/STEP3B9E-EFFECTIVE-RLS-REVIEW-20261023.md");
const manualF=read("docs/vox/STEP3B9F-RELEASE-CANDIDATE-AND-ROLLBACK-20261023.md");
const tests=[
["D: 72 absent from Git but present as managed statement arrays",dba.counts.missingGitButLedgerStatementsPresent===72],
["D: 7 version SHA mismatches remain unresolved",dba.counts.sharedSqlHashDifferent===7],
["D: one shared empty migration",dba.counts.sharedBothNoSql===1],
["D: no applied SQL replay permitted",dba.divergentVersions.every(x=>!x.authorizationToReplay)],
["D: no raw SQL leaked to evidence packet",dba.divergentVersions.every(x=>!x.rawSqlBodyExported)],
["E: 69 cases each require live PostgreSQL testing",rls.decisions.length===69&&rls.decisions.every(x=>!x.actualDatabaseTestRun)],
["E: 40 affected tables without certified OR/AND composition",rls.affectedTableGroups.length===40&&rls.affectedTableGroups.every(x=>!x.effectiveOrAndReproduced)],
["E: 37 write or ALL prioritized",rls.decisions.filter(x=>x.command!=="SELECT").length===37],
["E: no AppSec approval",!rls.independentAppsecSigned&&!rls.managedRlsChangesApproved],
["F: image digest is previous RC3 smoke only",pre.stagedSmokeEvidence.notActualStaffStagingDeployment],
["F: no signed release package",pre.signature===null&&!pre.signedReleasePackagePresent],
["F: no managed Staging authorization",!pre.managedStagingAuthorized],
["F: no real Owner MFA or Team Leader",!pre.realOwnerMfaVerified&&!pre.firstTeamLeaderOnboarded],
["F: Production go not authorized",!pre.productionAuthorized],
["F: money provider certification absent",!pre.razorpayTestCertified],
["F: policy + SQL reviews required before Owner signature",pre.missingProofs.some(x=>x.includes("104 individually"))],
["D: secret-safe recovery restrictions documented",manualD.includes("DO NOT put retrieved SQL into GitHub")],
["E: live effective RLS not falsely certified",manualE.includes("NOT an effective RLS certification")],
["F: rollback caveats and gate explicitly stated",manualF.includes("Production GO is separate")],
["No runnable 3B9D/E/F DB migrations",!readdirSync(resolve(ROOT,"supabase/migrations")).some(x=>/step3b9[d-f]/i.test(x))],
["All source-only release values remain HOLD",dba.releaseStatus==="HOLD"&&rls.releaseStatus==="HOLD"&&pre.releaseStatus==="HOLD"]
];
for(const [name,pass] of tests){assert.ok(pass,name);console.log("PASS "+name)}
console.log("STEP3B9DEF_RELEASE_HOLD "+tests.length+"/"+tests.length+" PASS");
