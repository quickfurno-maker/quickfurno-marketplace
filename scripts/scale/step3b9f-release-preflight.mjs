// 3B9F: prepare checksums & launch gating. Never generate a signature or enable services.
import assert from "node:assert/strict";
import {readFileSync,writeFileSync} from "node:fs";
import {createHash} from "node:crypto";
import {resolve,dirname} from "node:path";
import {fileURLToPath} from "node:url";
const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),"../..");
const paths=[
"ops/vox/certification/STEP3B6-DIVERGENCE-20261023.json",
"ops/vox/certification/STEP3B7-POLICY-DECISION-MATRIX-20261023.json",
"ops/vox/certification/STEP3B8-REVIEW-QUEUE-20261023.json",
"ops/vox/certification/STEP3B9-INDEPENDENT-REVIEW-HANDOFF-20261023.json",
"ops/vox/certification/STEP3B9D-GIT-HISTORY-PROVENANCE-20261023.json",
"ops/vox/certification/STEP3B9E-EFFECTIVE-RLS-REVIEW-20261023.json",
"supabase/migrations/20261006113720_phase22_identity_portability.sql",
"docs/vox/STEP3B9-DBA-INDEPENDENT-REVIEW-REQUEST-20261023.md",
"docs/vox/STEP3B9-APPSEC-INDEPENDENT-REVIEW-REQUEST-20261023.md",
"docs/vox/STEP3B9-OWNER-STAGING-AUTHORIZATION-REQUEST-20261023.md",
"ops/vox/certification/STEP3B9D-STAGING-LEDGER-FINGERPRINTS-20261023.json",
"ops/vox/certification/STEP3B9D-PRODUCTION-LEDGER-FINGERPRINTS-20261023.json",
"ops/vox/certification/STEP3B9D-LEDGER-RECONCILIATION-20261023.json"];
const DATA=x=>readFileSync(resolve(ROOT,x));
const SHA=x=>createHash("sha256").update(DATA(x)).digest("hex").toUpperCase();
export function releasePreflight(){
 const review=JSON.parse(DATA(paths[3]).toString("utf8"));
 const history=JSON.parse(DATA(paths[4]).toString("utf8"));
 const rls=JSON.parse(DATA(paths[5]).toString("utf8"));
 const comparison=JSON.parse(DATA(paths[12]).toString("utf8"));
 assert.equal(review.releaseStatus,"HOLD");
 assert.equal(history.counts.amongPreviouslyNotRunnableStillMissing,72);
 assert.equal(rls.decisions.filter(x=>x.actualDatabaseTestRun).length,0);
 assert.equal(comparison.counts.missingGitButLedgerStatementsPresent,72);
 assert.equal(comparison.counts.sharedSqlHashDifferent,7);
 assert.equal(comparison.counts.sharedBothNoSql,1);
 assert.equal(comparison.sqlRecoveryCompleted,false);
 assert.equal(comparison.independentDbaApproval,false);
 assert.equal(review.owner.approved,false);
 assert.equal(review.dba.independentlyApproved,false);
 assert.equal(review.appsec.independentlyApproved,false);
 assert.equal(SHA(paths[6]),"6F53E1781E4D2BD277645ED17B2EB635BE70F1D2C4DF7525CD176DFB0C2F28BA");
 return {schema:"qf.vox.step3b9f.release-preflight.v1",
  parentReviewedCommit:"0b17ec8d432d641fcf6a5d04f5abc867fa770044",
  candidateHeadCommit:null,
  signedReleasePackagePresent:false,
  evidenceSha256:Object.fromEntries(paths.map(x=>[x,SHA(x)])),
  stagedSmokeEvidence:{preexistingBuildSourceCommit:"12eb177f18794384075805898fb42a02e7943bc5",
   standaloneImageManifestDigest:"sha256:cf5c24ce1dab1a8ef76dddd4b7668725a04af9ea077d13ea242a175c38b6267f",
   lastPrivateUrl:"http://127.0.0.1:3318/",lastPrivateHomeHttpCode:200,
   managedCoreVoxOverviewLastStatus:404,publicRouteLive:false,
   syntheticLoginDisabled:true,notActualStaffStagingDeployment:true},
  missingProofs:["104 individually approved migration semantics incl 72 SQL bodies recoverable from ledger arrays but not yet exported/verified and 7 shared-version hash divergences",
   "global roles ACL storage objects auth and PITR restore tested",
   "69 independently reviewed effective policies and role grants",
   "inactive admin and suspended vendor effective behavior certified",
   "real owner AAL2 verified and approved first team leader",
   "exact images signed, current backup digest pinned, Owner Stage-only written GO",
   "version-aligned Core VOX route returns expected authenticated statuses",
   "Staff Vendor Agent Finance authenticated E2E tests",
   "real Razorpay TEST network certification",
   "WAF/TLS public DNS review and separate Production GO"],
  signature:null,independentDbaApproval:false,independentAppsecApproval:false,
  ownerStagingApproval:false,realOwnerMfaVerified:false,firstTeamLeaderOnboarded:false,
  actualIntegratedStagingCertified:false,razorpayTestCertified:false,
  productionAuthorized:false,managedStagingAuthorized:false,releaseStatus:"HOLD"};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const packet=releasePreflight();
 writeFileSync(resolve(ROOT,"ops/vox/certification/STEP3B9F-UNSIGNED-RELEASE-PREFLIGHT-20261023.json"),JSON.stringify(packet,null,2)+"\n");
 console.log("STEP3B9F_PRESIGNED_PREFLIGHT evidence_files="+Object.keys(packet.evidenceSha256).length+" sig=NONE staging=HOLD production=HOLD");
}
