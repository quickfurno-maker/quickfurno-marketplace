import test from "node:test";
import assert from "node:assert/strict";
import {processFinanceInboxBatch,deriveFinanceWorkerOutcome} from "../../../lib/payments/financeV2Pay3Final.mjs";
import {evaluateConsumedCreditRefundSafety} from "../../../lib/payments/financeV2Casework.mjs";
const expected={providerMode:"test",merchantAccountId:"rzp_test_review",
 providerOrderId:"order_123456",providerPaymentId:"pay_123456",
 amountSubunits:10000,currency:"INR"};
const captured={id:"pay_123456",order_id:"order_123456",amount:10000,
 currency:"INR",status:"captured",captured:true};
const event={event_type:"payment.captured",provider_mode:"test",merchant_account_id:"rzp_test_review"};
test("PAY4B4 10 contending simulated audit-only workers never double-process a job",async()=>{
 const queue=Array.from({length:10},(_,i)=>({job_id:"job_"+i,event_id:"event_"+i,token:"tok_"+i}));
 const claimed=new Set(),done=new Set(),results=[];
 const claim=async limit=>{
  const jobs=queue.filter(x=>!claimed.has(x.job_id)).slice(0,limit);
  jobs.forEach(x=>claimed.add(x.job_id));return jobs;
 };
 const finish=async (id,token,outcome,reason)=>{
  assert.ok(queue.some(x=>x.job_id===id&&x.token===token));
  assert.equal(outcome,"VERIFIED");assert.equal(reason,"PROVIDER_CAPTURE_CHECKED");
  assert.equal(done.has(id),false,"double finished");
  done.add(id);return true;
 };
 await Promise.all(Array.from({length:10},async()=>{
  const r=await processFinanceInboxBatch({claim,max:3,
   load:async()=>({event,expected}),providerRead:async()=>captured,finish});
  results.push(...r);
 }));
 assert.equal(done.size,10);assert.equal(results.length,10);
 assert.ok(results.every(x=>x.creditGrant===false));
});
test("PAY4B4 out-of-order and failure variants do not authorize credit",()=>{
 const failed={...event,event_type:"payment.failed"};
 assert.equal(deriveFinanceWorkerOutcome(failed,{...captured,status:"failed"},expected).outcome,"VERIFIED");
 assert.equal(deriveFinanceWorkerOutcome(failed,captured,expected).outcome,"RETRY");
 assert.equal(deriveFinanceWorkerOutcome({...event,provider_mode:"live"},captured,expected).outcome,"DEAD_LETTER");
 assert.equal(deriveFinanceWorkerOutcome(event,{...captured,order_id:"order_wrong"},expected).creditGrant,false);
});
test("PAY4B4 consumed-credit dispute never triggers automatic reversal",()=>{
 for(const used of [0,1,50,100]){
  const outcome=evaluateConsumedCreditRefundSafety({orderId:"10000000-0000-4000-8000-000000000001",
   creditsPurchased:100,creditsConsumed:used,creditsRemaining:100-used});
  assert.equal(outcome.automaticCreditClawbackAllowed,false);
  assert.equal(outcome.automaticProviderRefundAllowed,false);
  if(used>0)assert.equal(outcome.disposition,"OWNER_POLICY_REQUIRED");
 }
});
