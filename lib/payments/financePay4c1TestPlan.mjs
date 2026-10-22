import {razorpayTestMatrix} from "./financePay4c0RazorpayFixtures.mjs";
// PAY-4C1 TEST-only execution runbook. Building it never contacts a provider.
const MUST=["independentDba","independentAppsec","ownerStagingApproval",
 "stagingBackupRestored","ownerMfa","staffMfa","merchantTestModeVerified",
 "signedBuildVerified","webhookEndpointRestricted"];
export function buildPay4c1TestRunbook(review={}){
 const unmet=MUST.filter(k=>review[k]!==true);
 return Object.freeze({schema:"qf.finance.pay4c1.provider-test-runbook.v1",
  orderedScenarios:Object.freeze(razorpayTestMatrix.map((s,i)=>Object.freeze({
   ordinal:i+1,id:s.id,event:s.event,expected:s.expected,
   testOnly:true,noProduction:true,expectedCreditWrite:0
  }))),
  requiredBeforeTest:Object.freeze(unmet),
  furtherCases:["WEBHOOK_DUPLICATE_EVENT_ID","REPLAY_DIFFERENT_PAYLOAD_HASH",
   "CHECKOUT_SIGNATURE_TAMPER","REFUND_PARTIAL_EXCEEDS_CAPTURE",
   "REFUND_ALREADY_SUBMITTED","BANK_THREE_WAY_MISMATCH",
   "STAGING_WORKER_LEASE_EXPIRY","CREDIT_CONSUMED_OWNER_REVIEW"],
  canStartRealTest:false,performingProviderAction:false,
  canExecuteRefund:false,financialReleaseAuthorized:false,
  noCredentialsIncluded:true});
}
