// 3B-8B/C/D: source-only immutable reviewer dossier; no managed database, Auth or provider access.
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFileSync,writeFileSync} from "node:fs";
import {resolve,dirname} from "node:path";
import {fileURLToPath} from "node:url";
const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),"../..");
const read=p=>readFileSync(resolve(ROOT,p));
const json=p=>JSON.parse(read(p).toString("utf8"));
const SHA=b=>createHash("sha256").update(b).digest("hex").toUpperCase();
const LEDGER="ops/vox/certification/STEP3B6-DIVERGENCE-20261023.json";
const MATRIX="ops/vox/certification/STEP3B7-POLICY-DECISION-MATRIX-20261023.json";
const PHASE22="supabase/migrations/20261006113720_phase22_identity_portability.sql";
const PINNED="6F53E1781E4D2BD277645ED17B2EB635BE70F1D2C4DF7525CD176DFB0C2F28BA";
export function buildStep3b8ReviewPackage(ledger=json(LEDGER),policy=json(MATRIX)){
 assert.equal(ledger.schema,"qf.step3b6.dba.divergence.v1");
 assert.equal(ledger.counts.staging,86);assert.equal(ledger.counts.production,86);
 assert.equal(ledger.counts.shared,34);assert.equal(ledger.counts.stagingOnly,52);
 assert.equal(ledger.counts.productionOnly,52);assert.equal(ledger.counts.differenceRows,104);
 assert.equal(ledger.records.length,104);
 const versions=new Set(),envs={STAGING_ONLY:0,PRODUCTION_ONLY:0};
 for(const row of ledger.records){
  assert.ok(/^[0-9]{14}$/.test(row.version));
  assert.ok(["STAGING_ONLY","PRODUCTION_ONLY"].includes(row.environment));
  assert.ok(!versions.has(row.environment+":"+row.version));
  versions.add(row.environment+":"+row.version);envs[row.environment]++;
  assert.equal(row.semanticEquivalence,"UNREVIEWED");
  assert.equal(row.decision,"PENDING_INDEPENDENT_DBA");
 }
 assert.equal(envs.STAGING_ONLY,52);assert.equal(envs.PRODUCTION_ONLY,52);
 assert.equal(ledger.independentDbaApproved,false);
 assert.equal(policy.schema,"qf.step3b7.rls.policy-review.v1");
 assert.equal(policy.distinctPolicies,69);assert.equal(policy.adminReferences,59);
 assert.equal(policy.vendorReferences,22);assert.equal(policy.overlap,12);
 assert.equal(policy.policies.length,69);
 const ids=new Set();let admin=0,vendor=0,overlap=0;
 for(const row of policy.policies){
  assert.ok(!ids.has(row.id));ids.add(row.id);
  assert.equal(row.policyDecision,"PENDING_INDEPENDENT_APPSEC_AND_DOMAIN_OWNER");
  assert.equal(row.managedPolicyChangeAuthorized,false);assert.equal(row.effectiveRlsNegativeTestPassed,false);
  assert.equal(row.signedReviewer,null);
  if(row.referencesAdmin)admin++;
  if(row.referencesVendor)vendor++;
  if(row.referencesAdmin&&row.referencesVendor)overlap++;
 }
 assert.equal(admin,59);assert.equal(vendor,22);assert.equal(overlap,12);
 assert.equal(policy.signedIndependentAppsec,false);
 assert.equal(SHA(read(PHASE22)),PINNED);
 const unresolved={
  independentDbaReview:104,independentAppsecPolicyReview:69,
  globalRoleAclPitrRecovery:true,
  managedVoxAndFinanceSchemasAbsentAtLastReadonlyCheck:true,
  realOwnerAal2AndTeamLeaderPending:true,
  coreVoxOverviewReturned404AtLastStagingProbe:true,
  authenticatedEndToEndPending:true,
  razorpayTestProviderCertificationPending:true,
  publicIngressDnsAndProductionApprovalPending:true
 };
 return {
  schema:"qf.vox.step3b8.internal-review.v1",sourceOnly:true,
  parentCommit:"30319c2e0a465ffd33a48aba073215df9af370c9",
  protectedSource:{"phase22":{path:PHASE22,sha256:PINNED}},
  evidenceSha256:{ledger:SHA(read(LEDGER)),policyMatrix:SHA(read(MATRIX))},
  reviewerQueues:{
   DBA:ledger.records.map(({version,environment,name,semanticEquivalence,decision})=>({version,environment,name,semanticEquivalence,decision,reviewer:null,sqlEquivalenceEvidence:null,rolesAclPitrEvidence:null})),
   AppSec:policy.policies.map(({id,cmd,roles,permissive,accessClass,referencesAdmin,referencesVendor})=>({id,cmd,roles,permissive,accessClass,referencesAdmin,referencesVendor,independentDecision:"PENDING",effectivePolicySimulation:"NOT_RUN",businessHistoricalReadDecision:"PENDING",reviewer:null}))
  },
  unresolved,sourceCiPassed:false,exactHeadGithubCiVerified:false,
  independentDbaSigned:false,independentAppsecSigned:false,
  ownerApprovedManagedStaging:false,ownerAal2Verified:false,
  managedSchemaInstalled:false,providerTestCertified:false,
  stagingDeploymentAuthorized:false,productionDeploymentAuthorized:false,
  privilegedAuthAuthorized:false,realMoneyAuthorized:false,
  releaseStatus:"HOLD",interpretation:"Review queues generated from frozen evidence, not independent certification or approval"
 };
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const result=buildStep3b8ReviewPackage();
 const target=resolve(ROOT,"ops/vox/certification/STEP3B8-REVIEW-QUEUE-20261023.json");
 writeFileSync(target,JSON.stringify(result,null,2)+"\n");
 console.log("STEP3B8_REVIEW_QUEUE DBA=104 AppSec=69, independent decisions=0, release=HOLD");
}
