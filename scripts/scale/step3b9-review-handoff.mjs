// Step 3B-9A/B/C: pure reviewer handoff; NEVER treats an AI evaluation as human authorization.
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFileSync,writeFileSync} from "node:fs";
import {resolve,dirname} from "node:path";
import {fileURLToPath} from "node:url";
const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),"../..");
const LOAD=p=>JSON.parse(readFileSync(resolve(ROOT,p),"utf8"));
const DIGEST=p=>createHash("sha256").update(readFileSync(resolve(ROOT,p))).digest("hex").toUpperCase();
const SOURCE="ops/vox/certification/STEP3B8-REVIEW-QUEUE-20261023.json";
const LEDGER="ops/vox/certification/STEP3B6-DIVERGENCE-20261023.json";
const POLICY="ops/vox/certification/STEP3B7-POLICY-DECISION-MATRIX-20261023.json";
const STAGING_ID="uckafzuochmbvtiodmcl";
export function makeHandoff(src=LOAD(SOURCE),ledger=LOAD(LEDGER),policy=LOAD(POLICY)){
 assert.equal(src.schema,"qf.vox.step3b8.internal-review.v1");
 assert.equal(src.releaseStatus,"HOLD");
 assert.equal(src.independentDbaSigned,false);
 assert.equal(src.independentAppsecSigned,false);
 assert.equal(src.ownerApprovedManagedStaging,false);
 assert.equal(src.productionDeploymentAuthorized,false);
 assert.equal(src.privilegedAuthAuthorized,false);
 assert.equal(src.sourceCiPassed,false); // report deliberately does not substitute CI pass for signoff
 assert.equal(src.evidenceSha256.ledger,DIGEST(LEDGER));
 assert.equal(src.evidenceSha256.policyMatrix,DIGEST(POLICY));
 assert.equal(ledger.records.length,104);
 assert.equal(policy.policies.length,69);
 assert.equal(src.reviewerQueues.DBA.length,104);
 assert.equal(src.reviewerQueues.AppSec.length,69);
 const lmap=new Map(ledger.records.map(x=>[x.environment+":"+x.version,x]));
 const dba=src.reviewerQueues.DBA.map((x,i)=>{
  assert.deepEqual(Object.keys(x).sort(),["version","environment","name","semanticEquivalence","decision","reviewer","sqlEquivalenceEvidence","rolesAclPitrEvidence"].sort(),"Unexpected DBA approval field");
  const l=lmap.get(x.environment+":"+x.version);
  assert.ok(l,"DBA register missing item "+i);
  assert.equal(x.semanticEquivalence,"UNREVIEWED");
  assert.equal(x.decision,"PENDING_INDEPENDENT_DBA");
  assert.equal(x.reviewer,null);
  assert.equal(x.sqlEquivalenceEvidence,null);
  assert.equal(x.rolesAclPitrEvidence,null);
  return {id:x.environment+":"+x.version,version:x.version,name:x.name,
    environment:x.environment,sourceFilePresent:!!l.versionInRunnableSource,
    priority:l.versionInRunnableSource?"VERIFY_SQL_SEMANTICS":"LOCATE_HISTORICAL_MIGRATION_SOURCE",
    reviewer:null,decision:"PENDING_INDEPENDENT_DBA",equivalenceProof:null,
    permissionRoleAclProof:null,dependencyAnalysis:null,rollbackPitrStorageProof:null,
    independentSignature:null};
 });
 const pmap=new Map(policy.policies.map(x=>[x.id,x]));
 const appsec=src.reviewerQueues.AppSec.map((x,i)=>{
  assert.deepEqual(Object.keys(x).sort(),["id","cmd","roles","permissive","accessClass","referencesAdmin","referencesVendor","independentDecision","effectivePolicySimulation","businessHistoricalReadDecision","reviewer"].sort(),"Unexpected AppSec approval field");
  const p=pmap.get(x.id);
  assert.ok(p,"AppSec register missing item "+i);
  assert.equal(p.policyDecision,"PENDING_INDEPENDENT_APPSEC_AND_DOMAIN_OWNER");
  assert.equal(p.signedReviewer,null);
  assert.equal(p.managedPolicyChangeAuthorized,false);
  assert.equal(x.independentDecision,"PENDING");
  assert.equal(x.reviewer,null);
  assert.equal(x.effectivePolicySimulation,"NOT_RUN");
  assert.equal(x.businessHistoricalReadDecision,"PENDING");
  const isWrite=x.cmd!=="SELECT";
  return {id:x.id,operation:x.cmd,roles:x.roles,permissive:x.permissive,
    adminHelper:x.referencesAdmin,vendorHelper:x.referencesVendor,
    priority:isWrite?"P0_REVIEW_WRITE_OR_ALL":"P1_REVIEW_READ_OR_HISTORY",
    requiredCases:[
      "inactive-admin-denied","revoked-department-denied","cross-tenant-denied",
      ...(x.referencesVendor?["suspended-vendor-deny-new-work","historical-read-policy-explicit"]:[]),
      "permissive-OR-restrictive-AND-effective-evidence","service-role-bypass-not-relied-upon"],
    reviewer:null,domainOwner:null,decision:"PENDING_INDEPENDENT_APPSEC",
    measuredEffectiveRls:null,activeGuardDecision:null,historicalReadDecision:null,
    independentSignature:null};
 });
 const nAbsent=dba.filter(x=>!x.sourceFilePresent).length;
 const nWrites=appsec.filter(x=>x.operation!=="SELECT").length;
 assert.equal(nAbsent,72);
 assert.equal(nWrites,37);
 return {
  schema:"qf.vox.step3b9.independent-review-handoff.v1",
  immutableSourceBaseSha:"e52a30553225628a0f611933a313ab0337f92f62",
  exactNewReleaseSha:null, // set ONLY after signed artifacts and new immutable commit
  evidence:{sourceSha256:DIGEST(SOURCE),ledgerSha256:DIGEST(LEDGER),policySha256:DIGEST(POLICY),
    sourceEnvironment:"QuickFurno Staging",stagingProjectId:STAGING_ID,
    lastReadOnlyInventory:"2026-10-23",lastSeenMigrationVersions:86,
    lastSeenVoxTables:0,lastSeenFinanceTables:0,lastSeenVerifiedMfaFactors:0,
    lastSeenCoreVoxOverviewStatus:404},
  dba:{counts:{total:104,missingRunnableSource:nAbsent,runnableSourcePresent:32},
    requestedReviewerRole:"independent qualified DBA",status:"PENDING",decisions:dba,
    globalRolesAclDefaultPrivilegesPitrVerified:false,physicalStorageAndAuthRecoveryVerified:false,
    independentlyApproved:false,signature:null},
  appsec:{counts:{total:69,writeOrAll:nWrites,readOnly:32,adminReferences:59,vendorReferences:22,overlap:12},
    requestedReviewerRole:"independent qualified AppSec",status:"PENDING",decisions:appsec,
    effectivePolicySimulationVerified:false,independentlyApproved:false,signature:null},
  owner:{subject:"Staging ONLY, exact SHA release authorization request",ownerIdentity:"Core Superadmin",
    targetEnvironment:"STAGING",targetProject:STAGING_ID,approvedReleaseSha:null,
    exactImageDigest:null,dbBackupDigest:null,independentDbaEvidence:null,independentAppsecEvidence:null,
    actualOwnerAal2Enrollment:null,requested:false,approved:false,ownerSigned:null,approvalTime:null,
    note:"Creation of this request is NOT Owner authorization or an MFA enrollment"},
  gates:{reviewDba:"PENDING",reviewAppsec:"PENDING",ownerAuthorization:"NOT_REQUESTED",
    protectedStagingDdlAllowed:false,privilegedAuthAllowed:false,realRazorpayProviderActionsAllowed:false,
    outboundProviderMessagesAllowed:false,publicDnsAllowed:false,productionAllowed:false},
  releaseStatus:"HOLD"
 };
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const packet=makeHandoff();
 const dst=resolve(ROOT,"ops/vox/certification/STEP3B9-INDEPENDENT-REVIEW-HANDOFF-20261023.json");
 writeFileSync(dst,JSON.stringify(packet,null,2)+"\n");
 console.log("STEP3B9_REVIEW_HANDOFF DBA=104 missingSources=72 AppSec=69 writePolicies=37 Owner=PENDING release=HOLD");
}
