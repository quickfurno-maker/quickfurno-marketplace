import test from "node:test";
import assert from "node:assert/strict";
import {reconcileRazorpayProviderPayment as reconcile,deriveFinanceWorkerOutcome as derive,
 processFinanceInboxBatch} from "../../../lib/payments/financeV2Pay3Final.mjs";
const expected={providerMode:"test",merchantAccountId:"rzp_test_demo",providerOrderId:"order_12345",
 providerPaymentId:"pay_12345",amountSubunits:9999,currency:"INR"};
const provider={id:"pay_12345",order_id:"order_12345",amount:9999,currency:"INR",status:"captured",captured:true};
const event={event_type:"payment.captured",provider_mode:"test",merchant_account_id:"rzp_test_demo"};
test("PAY3A captured provider truth still never issues credits",()=>{
 const x=reconcile({expected,provider,mode:"test",merchantAccountId:"rzp_test_demo"});
 assert.equal(x.state,"PROVIDER_CAPTURE_CONFIRMED");assert.equal(x.safeToActivate,false);
 assert.equal(derive(event,provider,expected).creditGrant,false);
});
test("PAY3A exact merchant/mode/order/payment/currency/amount required",()=>{
 for(const patch of [{amount:10000},{currency:"USD"},{order_id:"order_other"},{id:"pay_wrong"}])
  assert.throws(()=>reconcile({expected,provider:{...provider,...patch},mode:"test",merchantAccountId:"rzp_test_demo"}),/MISMATCH/);
 assert.throws(()=>reconcile({expected,provider,mode:"live",merchantAccountId:"rzp_test_demo"}),/CONTEXT_INVALID/);
 assert.equal(derive({...event,provider_mode:"live"},provider,expected).outcome,"DEAD_LETTER");
});
test("PAY3A unavailable capture is retry, not confirmation",()=>{
 const r=derive(event,{...provider,status:"authorized",captured:false},expected);
 assert.equal(r.outcome,"RETRY");
});
test("PAY3A worker uses claims, provider read, fence and never credits",async()=>{
 const calls=[],jobs=[{job_id:"j",event_id:"e",token:"l"}];
 const done=await processFinanceInboxBatch({
  claim:async limit=>(assert.equal(limit,5),jobs),
  load:async eid=>(assert.equal(eid,"e"),{event,expected}),
  providerRead:async (id,mode)=>(assert.equal(id,"pay_12345"),assert.equal(mode,"test"),provider),
  finish:async (...args)=>(calls.push(args),true)
 });
 assert.deepEqual(calls,[["j","l","VERIFIED","PROVIDER_CAPTURE_CHECKED"]]);
 assert.deepEqual(done.map(x=>x.creditGrant),[false]);
});
test("PAY3A worker unavailable provider is retry, no wallet action",async()=>{
 const seen=[];
 const result=await processFinanceInboxBatch({
  claim:async()=>[{job_id:"j",event_id:"e",token:"l"}],
  load:async()=>({event,expected}),
  providerRead:async()=>{throw Error("offline")},
  finish:async (...p)=>(seen.push(p),false)
 });
 assert.equal(seen[0][2],"RETRY");assert.equal(result[0].accepted,false);
 assert.equal(result[0].creditGrant,false);
});
