import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync,readdirSync} from "node:fs";
import {assessInternalCandidateEvidence} from "../../../contracts/vox/l10InternalCandidateGate.mjs";
const root=new URL("../../../",import.meta.url);
const read=path=>readFileSync(new URL(path,root),"utf8");
const evidence={coreTypes:true,webBuild:true,scopeNegative:true,
 riyaEvidence:true,eodProvenance:true,outboxReplay:true,
 isolatedPg17:true,releaseHold:true};
test("even perfect SELF-REPORTED internal QA never grants staging or production",()=>{
 const r=assessInternalCandidateEvidence(evidence);
 assert.equal(r.ok,true);assert.equal(r.reviewerHandoffEligible,true);
 assert.equal(r.protectedStagingPermitted,false);assert.equal(r.productionPermitted,false);
 assert.equal(r.reviewersEngaged,false);assert.equal(r.providerMessagesSent,0);
});
test("absent or malformed evidence refuses candidate certification",()=>{
 assert.equal(assessInternalCandidateEvidence({...evidence,isolatedPg17:false}).ok,false);
 assert.equal(assessInternalCandidateEvidence({...evidence,releaseHold:"yes"}).ok,false);
 assert.equal(assessInternalCandidateEvidence({...evidence,approvedByAI:true}).ok,false);
 assert.equal(assessInternalCandidateEvidence(null).ok,false);
});
test("actual Core Staff verifier retains neutral role and AAL2",()=>{
 const s=read("services/vox/verifiedScopedStaff.ts");
 assert.match(s,/jwt\.aal\s*!==\s*"aal2"/);
 assert.match(s,/isNeutralVoxStaffPrincipal/);
 assert.match(s,/restrictScopedStaffByDepartment/);
});
test("actual Riya/EOD handlers remain read-only with independent stage flags",()=>{
 const riya=read("app/api/vox/v1/riya-client-cases/route.ts");
 const eod=read("app/api/vox/v1/eod-source-status/route.ts");
 for(const [s,flag] of [[riya,"VOX_RIYA_CLIENT_CASE_READ_ENABLED"],
 [eod,"VOX_EOD_SOURCE_READINESS_ENABLED"]]){
  assert.ok(s.includes(flag));assert.match(s,/getVerifiedScopedStaff/);
  assert.match(s,/export function POST\(\)/);
  assert.doesNotMatch(s,/sendWhatsapp\(|sendMessageToProvider\(/);
 }
 assert.match(riya,/vox_staff_object_scopes_v1/);
 assert.match(eod,/projectActualStaffSourceStatus/);
});
test("actual private AGNI metric handler denies feature OFF and requires signing",()=>{
 const s=read("app/api/internal/agni/owner-outbox-metrics/route.ts");
 assert.match(s,/VOX_AGNI_OUTBOX_METRICS_ENABLED/);
 assert.match(s,/VOX_STAFF_GRANTS_ENABLED/);
 assert.match(s,/verifyQfjScaleWebRequest/);
 assert.match(s,/signCoreOutboxMetricEnvelope/);
 assert.match(s,/export function GET\(\).*405/);
});
test("notification SQL remains isolated from managed migrations and external providers",()=>{
 const names=["20261016040000_vox08n_transactional_work_notification_outbox_candidate.sql",
 "20261016050000_vox08r_internal_outbox_metrics_candidate.sql"];
 const managed=readdirSync(new URL("supabase/migrations/",root));
 for(const name of names){
  assert.equal(managed.includes(name),false);
  const sql=read("ops/vox/sql-candidates/"+name);
  assert.match(sql,/SOURCE.ONLY|UNAPPROVED SOURCE CANDIDATE/);
  assert.match(sql,/service_role/i);
 }
 assert.match(read("contracts/vox/notificationOutboxWorker.mjs"),/INTERNAL_ONLY|internal/i);
});
test("independent reviewer crypto explicitly has no human approval authority",()=>{
 const s=read("contracts/vox/independentReviewerSignatures.mjs");
 assert.match(s,/independentHumanIdentitiesVerified:false/);
 assert.match(s,/protectedStagingPermitted:false/);
 assert.match(s,/requiresHumanOutOfBandKeyVerification:true/);
});
test("current integrated CI uses no deploy permissions or protected credentials",()=>{
 const s=read(".github/workflows/vox-l6-integrated-core-web-candidate.yml");
 assert.match(s,/permissions:\s*\n\s*contents:\s*read/);
 assert.doesNotMatch(s,/deployments:\s*write|id-token:\s*write|workflow_dispatch|supabase db push/);
});