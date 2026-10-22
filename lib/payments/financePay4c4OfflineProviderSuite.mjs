import {createHmac,timingSafeEqual} from "node:crypto";
import {deriveFinanceWorkerOutcome} from "./financeV2Pay3Final.mjs";
import {razorpayTestMatrix} from "./financePay4c0RazorpayFixtures.mjs";
// Deterministic OFFLINE adapter. No imported Razorpay SDK, network or user secrets.
const SECRET="PAY4C4_SYNTHETIC_SECRET_NOT_A_REAL_KEY";
const expected=Object.freeze({providerMode:"test",
 merchantAccountId:"merchant_synthetic",providerOrderId:"order_synthetic12345",
 providerPaymentId:"pay_synthetic12345",amountSubunits:10000,currency:"INR"});
const mac=body=>createHmac("sha256",SECRET).update(body).digest();
export function validateSyntheticWebhook(body,providedSignatureHex){
 if(typeof body!=="string"||typeof providedSignatureHex!=="string"||
    !/^[a-f0-9]{64}$/.test(providedSignatureHex))return false;
 return timingSafeEqual(mac(body),Buffer.from(providedSignatureHex,"hex"));
}
export function runPay4c4OfflineProviderSuite(){
 const rows=[];
 for(const fixture of razorpayTestMatrix){
  const event={event_type:fixture.event,provider_mode:"test",
   merchant_account_id:expected.merchantAccountId};
  const provider={id:expected.providerPaymentId,order_id:expected.providerOrderId,
   amount:expected.amountSubunits,currency:"INR",status:"captured",captured:true};
  if(fixture.provider==="authorized")Object.assign(provider,{status:"authorized",captured:false});
  if(fixture.provider==="failed")Object.assign(provider,{status:"failed",captured:false});
  if(fixture.provider==="wrong_order")provider.order_id="order_wrong12345";
  if(fixture.provider==="wrong_amount")provider.amount=10001;
  if(fixture.provider==="wrong_merchant")event.merchant_account_id="merchant_wrong";
  if(fixture.provider==="wrong_mode")event.provider_mode="live";
  const raw=JSON.stringify({id:"evt_synthetic_"+fixture.id,
   event:fixture.event,providerMode:event.provider_mode,
   merchant:event.merchant_account_id});
  const signed=mac(raw).toString("hex");
  const authentic=validateSyntheticWebhook(raw,signed);
  const outcome=fixture.provider==="offline"?
    {outcome:"RETRY",creditGrant:false}:
    deriveFinanceWorkerOutcome(event,provider,expected);
  const expectedOutcome=fixture.expected==="PROVIDER_CAPTURE_CONFIRMED"?
    "VERIFIED":fixture.expected;
  if(!authentic||outcome.outcome!==expectedOutcome||outcome.creditGrant!==false)
    throw Error("PAY4C4_TEST_FIXTURE_FAILED:"+fixture.id);
  rows.push(Object.freeze({caseId:fixture.id,outcome:outcome.outcome,
    syntheticWebhookAuthenticated:authentic,
    paymentOrWalletMutation:false,providerNetworkCall:false,
    refundSubmitted:false}));
 }
 return Object.freeze({schema:"qf.finance.pay4c4.offline-provider-proof.v1",
  testOnly:true,sandboxNetworkCalls:0,liveNetworkCalls:0,
  attemptedWalletCredits:0,refundsSubmitted:0,
  proofCases:Object.freeze(rows),passed:rows.length,
  actualRazorpayTestCertified:false,releaseStatus:"HOLD"});
}
