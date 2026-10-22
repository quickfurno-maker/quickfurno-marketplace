import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {inspectManagedMigrationObservation} from "./financePay4c0ManagedHistory.mjs";
import {evaluatePay4c0StagePacket} from "./financePay4c0StageGate.mjs";
import {classifyFinanceReview,securityReviewChecklist} from "../../../contracts/vox/financePay4c0SecurityReview.mjs";
import {razorpayTestMatrix,certificationMatrixReadiness} from "../../../lib/payments/financePay4c0RazorpayFixtures.mjs";
import {deriveFinanceWorkerOutcome,processFinanceInboxBatch} from "../../../lib/payments/financeV2Pay3Final.mjs";
import {reviewBankRefundEvidence,reviewConsumedCreditsForRefund} from "../../../lib/payments/financePay4c0Evidence.mjs";
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"../../..");
const uu=n=>"10000000-0000-4000-8000-"+String(n).padStart(12,"0");
test("C0-A observed 86+86 remote migration lists, not SQL grant verification",()=>{
 const a=inspectManagedMigrationObservation(path.join(root,
 "ops/finance/PAY4C0-READONLY-MANAGED-MIGRATION-EVIDENCE-20261022.json"));
 assert.equal(a.ok,true);assert.deepEqual(a.observedCounts,[86,86]);
 assert.equal(a.actualRemoteSqlHashVerified,false);assert.equal(a.deploy,false);
});
test("C0-B reviewed auth checklist denies financial mutation independently of roles",()=>{
 assert.ok(securityReviewChecklist.length>=7);
 const empty=classifyFinanceReview({});
 assert.equal(empty.sourceReviewReady,false);
 const all=classifyFinanceReview({ownerAal2:true,staffAal2:true,
  financeGrantVerified:true,vendorScopeVerified:true,reviewerIndependent:true,
  appsecSignatureVerified:true});
 assert.equal(all.sourceReviewReady,true);
 assert.equal(all.financialActionAllowed,false);assert.equal(all.stagingApproval,false);
});
const expected={providerMode:"test",merchantAccountId:"rzp_test_review",providerOrderId:"order_123456",
 providerPaymentId:"pay_123456",amountSubunits:10000,currency:"INR"};
const capture={id:"pay_123456",order_id:"order_123456",amount:10000,currency:"INR",
 status:"captured",captured:true};
test("C0-C nine provider TEST scenario fixtures are deterministic and credit-free",()=>{
 assert.equal(razorpayTestMatrix.length,9);
 for(const scenario of razorpayTestMatrix){
  if(scenario.provider==="offline")continue;
  const event={event_type:scenario.event,provider_mode:"test",merchant_account_id:"rzp_test_review"};
  const payment={...capture};
  if(scenario.provider==="authorized")Object.assign(payment,{status:"authorized",captured:false});
  if(scenario.provider==="failed")Object.assign(payment,{status:"failed",captured:false});
  if(scenario.provider==="wrong_order")payment.order_id="order_wrong";
  if(scenario.provider==="wrong_amount")payment.amount=10001;
  if(scenario.provider==="wrong_merchant")event.merchant_account_id="unknown";
  if(scenario.provider==="wrong_mode")event.provider_mode="live";
  const result=deriveFinanceWorkerOutcome(event,payment,expected);
  assert.equal(scenario.expected==="PROVIDER_CAPTURE_CONFIRMED"?"VERIFIED":scenario.expected,
   result.outcome,scenario.id);
  assert.equal(result.creditGrant,false);
 }
 assert.equal(certificationMatrixReadiness().executeSandboxPayment,false);
});
test("C0-C provider GET outage is retry, cannot activate credits",async()=>{
 const finish=[],result=await processFinanceInboxBatch({
  claim:async()=>[{job_id:"job1",event_id:"event1",token:"token1"}],
  load:async()=>({event:{event_type:"payment.captured",provider_mode:"test",
   merchant_account_id:"rzp_test_review"},expected}),
  providerRead:async()=>{throw Error("NO_NETWORK")},
  finish:async(...args)=>(finish.push(args),true)
 });
 assert.equal(finish[0][2],"RETRY");assert.equal(result[0].creditGrant,false);
});
test("C0-D bank 3-way amount match is never bank authenticity or paid authority",()=>{
 const pkt={caseId:uu(1),requesterId:uu(2),reviewerId:uu(3),
  bankStatementSha256:"a".repeat(64),providerStatementSha256:"b".repeat(64),
  reviewerAal2:true,providerNetSubunits:1000,bankNetSubunits:1000,
  ledgerNetSubunits:1000,bankOwnershipEvidenceConfirmed:true};
 const x=reviewBankRefundEvidence(pkt);
 assert.equal(x.ok,true);assert.equal(x.bankVerified,false);
 assert.equal(x.refundReleaseAllowed,false);
 assert.equal(reviewBankRefundEvidence({...pkt,bankNetSubunits:999}).ok,false);
 assert.equal(reviewBankRefundEvidence({...pkt,reviewerId:uu(2)}).ok,false);
});
test("C0-D consumed vendor credits always need human policy without auto clawback",()=>{
 const x=reviewConsumedCreditsForRefund({purchased:100,consumed:25,remaining:75,
  independentPolicyApproved:true});
 assert.equal(x.requiresHumanPolicy,true);assert.equal(x.refundExecutionAllowed,false);
 assert.equal(x.automaticClawbackAllowed,false);
});
test("C0-E release packet hard HOLD irrespective of asserted signoffs",()=>{
 const x=evaluatePay4c0StagePacket({root});
 assert.equal(x.assessmentReadyForIndependentReview,true);
 assert.equal(x.releaseStatus,"HOLD");assert.equal(x.deployApproved,false);
 const signed=evaluatePay4c0StagePacket({root,review:{independentDba:true,independentAppsec:true,
  ownerMfa:true,staffMfa:true,stagingBackup:true,sourceSignature:true,
  stagingDeploySignature:true}});
 assert.equal(signed.deployApproved,false);assert.equal(signed.signedDeploymentCreated,false);
 assert.equal(evaluatePay4c0StagePacket({root,flags:{FINANCE_V2_PAY4A_CRON_ENABLED:"staging"}})
 .assessmentReadyForIndependentReview,false);
});
