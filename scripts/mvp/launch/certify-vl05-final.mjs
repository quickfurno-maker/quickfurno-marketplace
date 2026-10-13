// VL-05 deterministic acceptance contract tests + read-only evidence evaluator.
// No Supabase, Meta, Google, Razorpay, wallet, SSH, or production side effects.
import assert from "node:assert/strict";
import fs from "node:fs";
import { resolve } from "node:path";
import { assessVl05, REQUIRED_GATES, VL05_PROTOCOL } from "./vl05-acceptance.mjs";
const fixed = new Date("2026-10-13T00:00:00Z");
const sha = "0f4e484e533e819ffd19d312ce32ca76bfe78827";
const digest = "sha256:2ccd3dd737824cf07a279ba8c391cd27b996cd3935b432787d83a34125ebb58b";
const url="https://github.com/quickfurno-maker/quickfurno-marketplace/actions/runs/38314337238";
const pristine = () => ({
  protocol:VL05_PROTOCOL,environment:"staging",observedAt:fixed.toISOString(),
  coreMainSha:sha,signedCoreDigest:digest,
  gates:Object.fromEntries(REQUIRED_GATES.map(k=>[k,{status:"PASS",evidenceUrl:url,observedAt:fixed.toISOString()}])),
  canary:{
    synthetic:true,allowlisted:true,testVendorCount:2,
    authenticatedVendorCount:2,googleVerifiedOfficeCount:2,coreZoneResolvedCount:2,
    maxAssigneesPerLead:3,creditDebitsPerDeliveredVendor:1,
    duplicateAssignmentCount:0,replayedCreditMutationCount:0,
    actualProviderReceiptConfirmed:true,sandboxPaymentConfirmed:true,
    consentAndErasureConfirmed:true,agniOwnerReceiptConfirmed:true,
    stalePendingJobsClassified:45,pendingJobsExisting:45,noProductionSideEffects:true,
  },
});
let assertions=0;
function check(label, change, expected, checkFailure=null) {
 const input=pristine();
 if(change)change(input);
 const result=assessVl05(input,{now:fixed,coreMainSha:sha});
 assert.equal(result.verdict,expected,label);
 assert.equal(result.eligibleForProductionPromotion,false,"never authorize production");
 if(checkFailure)assert.ok(result.failures.includes(checkFailure),label+" fail code");
 assertions++;console.log("PASS",label);
}
check("fully evidenced synthetic requires human review",null,"EVIDENCE_READY_FOR_HUMAN_REVIEW");
check("absence of any evidence is HOLD",e=>{delete e.gates;},"HOLD","gate_core_auth_and_vendor_dashboard_not_certified");
check("stale source fails closed",e=>{e.observedAt="2026-10-11T00:00:00Z";},"HOLD","missing_or_stale_observation");
check("production environment is not staging",e=>{e.environment="production";},"HOLD","staging_evidence_only");
check("wrong source SHA rejected",e=>{e.coreMainSha="a".repeat(40);},"HOLD","unverified_core_main_sha");
check("missing signed OCI digest rejected",e=>{delete e.signedCoreDigest;},"HOLD","missing_exact_signed_digest");
check("unverified real provider gate rejected",e=>{e.gates.automation_workshop_durable_delivery_and_provider_receipt.status="UNKNOWN";},"HOLD","gate_automation_workshop_durable_delivery_and_provider_receipt_not_certified");
check("stale and unreferenced gate rejected",e=>{e.gates.agni_signed_incident_to_owner_receipt.evidenceUrl="";},"HOLD","gate_agni_signed_incident_to_owner_receipt_evidence_missing_or_stale");
check("vendor location missing",e=>{e.canary.googleVerifiedOfficeCount=0;},"HOLD","canary_vendor_identity_geo_not_proven");
check("more than three assignments is forbidden",e=>{e.canary.maxAssigneesPerLead=4;},"HOLD","assignment_credit_replay_invariant_unproven");
check("duplicate credit replay rejected",e=>{e.canary.replayedCreditMutationCount=1;},"HOLD","assignment_credit_replay_invariant_unproven");
check("unconfirmed captured sandbox payment rejected",e=>{e.canary.sandboxPaymentConfirmed=false;},"HOLD","required_live_provider_consent_owner_evidence_missing");
check("revocation/purge proof missing",e=>{e.canary.consentAndErasureConfirmed=false;},"HOLD","required_live_provider_consent_owner_evidence_missing");
check("stale staging pending jobs cannot be ignored",e=>{e.canary.stalePendingJobsClassified=0;},"HOLD","stale_pending_jobs_not_reconciled");
check("cannot authorize production effects",e=>{e.canary.noProductionSideEffects=false;},"HOLD","staging_effect_boundary_unverified");
check("missing canary cannot pass",e=>{e.canary={};},"HOLD","canary_vendor_identity_geo_not_proven");
assert.equal(assertions,16);
console.log("VL-05 standalone acceptance self-tests: 16/16 PASS");

if(process.argv.includes("--assess")) {
 const at=process.argv.indexOf("--assess");
 const file=process.argv[at+1];
 if(!file)throw Error("--assess needs a sanitized evidence JSON filepath");
 const actual=JSON.parse(fs.readFileSync(resolve(process.cwd(),file),"utf8").trimStart());
 const shaArg=process.argv.indexOf("--core-sha");
 if(shaArg<0 || !/^[0-9a-f]{40}$/.test(process.argv[shaArg+1]??"")) throw Error("--assess requires --core-sha with exact independently checked Core main SHA");
 const verdict=assessVl05(actual,{now:new Date(),coreMainSha:process.argv[shaArg+1]});
 console.log(JSON.stringify(verdict,null,2));
 if(verdict.verdict==="HOLD")process.exitCode=2;
}
