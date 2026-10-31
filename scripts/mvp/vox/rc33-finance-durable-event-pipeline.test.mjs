// RC33 Finance: real RC28 repository + real processor over a PG-shaped in-memory
// transport mirroring the review-only PG17 candidate RPCs. No DB/provider calls.
import test from "node:test";
import assert from "node:assert/strict";
import {buildRazorpayProviderEventEnvelope as envelopeOf} from "../../../lib/payments/vendorPackageProviderEventLedger.mjs";
import {processVendorPackageProviderEvent as processEvent,providerEventHttpStatus as httpStatus}
 from "../../../lib/payments/vendorPackageProviderEventProcessing.mjs";
import {createRc28VendorPackageEventRepository as makeRepo,RC28_PROVIDER_LEDGER_RUNTIME_INSTALLED}
 from "../../../lib/payments/vendorPackageProviderEventRepository.mjs";

function pg({commitThenAbort=0}={}){
 const rows=new Map();let aborts=commitThenAbort;
 const rpc=async(name,a)=>{
  const k=a.p_provider_mode+"|"+a.p_event_id;
  const base={event_id:a.p_event_id,provider_mode:a.p_provider_mode};
  if(name==="qf_record_vendor_package_razorpay_event_v2"){
   let r=rows.get(k);
   if(!r){r={body:a.p_body_sha256,status:"available",n:0};rows.set(k,r)}
   if(r.body!==a.p_body_sha256)return {data:{...base,status:"conflict"}};
   if(r.status==="completed")return {data:{...base,status:"replay",outcome:r.outcome}};
   if(r.status==="quarantined")return {data:{...base,status:"quarantined",last_error_code:r.code}};
   if(r.status==="claimed")return {data:{...base,status:"in_flight"}};
   if(r.n>=25)return {data:{...base,status:"needs_reconciliation",last_error_code:"PROVIDER_EVENT_ATTEMPTS_EXHAUSTED"}};
   r.status="claimed";r.n++;
   return {data:{...base,status:"claimed",attempt_count:r.n}};
  }
  const r=rows.get(k);
  if(!r||r.status!=="claimed"||r.n!==a.p_attempt_count)
   return {error:{code:"42501",message:"PROVIDER_EVENT_COMPLETION_FENCE_DENIED"}};
  r.status=a.p_disposition;r.outcome=a.p_outcome;r.code=a.p_error_code;
  if(aborts>0){aborts--;throw Error("socket hang up after COMMIT")}
  return {data:{...base,status:a.p_disposition,outcome:a.p_outcome,error_code:a.p_error_code}};
 };
 return {rows,rpc};
}
const cand=kind=>({kind,paymentId:"pay_RC33ABC123",providerOrderId:"order_RC33ABC123"});
const env=(kind="captured",mode="test")=>envelopeOf({eventId:"evt_RC33ABC123",bodySha256:"b".repeat(64),providerMode:mode,candidate:cand(kind)});

test("ledger runtime stays uninstalled",()=>assert.equal(RC28_PROVIDER_LEDGER_RUNTIME_INSTALLED,false));

test("unknown COMMIT on completion is non-2xx; redelivery replays without re-running Core",async()=>{
 const db=pg({commitThenAbort:1});let core=0;
 const first=await processEvent({envelope:env(),repository:makeRepo(db.rpc),handle:async()=>{core++;return "activated"}});
 assert.equal(first.ack,false);assert.equal(first.code,"PROVIDER_EVENT_COMPLETION_UNCONFIRMED");
 assert.equal(httpStatus(first),503);
 const second=await processEvent({envelope:env(),repository:makeRepo(db.rpc),
  handle:async()=>{throw Error("CORE_MUST_NOT_RERUN")}});
 assert.deepEqual({ack:second.ack,status:second.status,replay:second.replay},{ack:true,status:"activated",replay:true});
 assert.equal(core,1);
});

test("partial refund quarantines once and identical replay never re-runs Core",async()=>{
 const db=pg();let core=0;
 const handle=async()=>{core++;throw Error("PAYMENT_REFUNDED")};
 const a=await processEvent({envelope:env(),repository:makeRepo(db.rpc),handle});
 const b=await processEvent({envelope:env(),repository:makeRepo(db.rpc),handle});
 assert.deepEqual([a.status,a.code,a.ack],["quarantined","PAYMENT_REFUNDED",true]);
 assert.deepEqual([b.status,b.code,b.ack],["quarantined","PAYMENT_REFUNDED",true]);
 assert.equal(core,1);
});

test("TEST and LIVE ledgers are independent; drifted body replay is a 409 conflict",async()=>{
 const db=pg();let core=0;const handle=async()=>{core++;return "activated"};
 await processEvent({envelope:env("captured","test"),repository:makeRepo(db.rpc),handle});
 await processEvent({envelope:env("captured","live"),repository:makeRepo(db.rpc),handle});
 assert.equal(core,2);
 const drift=envelopeOf({eventId:"evt_RC33ABC123",bodySha256:"c".repeat(64),providerMode:"test",candidate:cand("captured")});
 const r=await processEvent({envelope:drift,repository:makeRepo(db.rpc),handle});
 assert.equal(r.ack,false);assert.equal(httpStatus(r),409);assert.equal(core,2);
});

test("uncertain payment is never acknowledged through 25 attempts, then needs reconciliation",async()=>{
 const db=pg();let core=0;
 const handle=async()=>{core++;throw Error("PAYMENT_NOT_CAPTURED")};
 let last;
 for(let i=0;i<26;i++){
  last=await processEvent({envelope:env(),repository:makeRepo(db.rpc),handle});
  assert.equal(last.ack,false);assert.equal(httpStatus(last),503);
 }
 assert.equal(last.code,"PROVIDER_EVENT_ATTEMPTS_EXHAUSTED");
 assert.equal(core,25);
});
