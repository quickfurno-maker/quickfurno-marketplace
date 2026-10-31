// RC31 Finance: executed integration. Real RC28 repository adapter over an
// in-memory PostgREST-shaped transport that mirrors the PG17 candidate RPCs,
// real processor, real assertCapturedPayment. No provider/DB calls.
import test from "node:test";
import assert from "node:assert/strict";
import {buildRazorpayProviderEventEnvelope as envelopeOf} from "../../../lib/payments/vendorPackageProviderEventLedger.mjs";
import {processVendorPackageProviderEvent as processEvent,providerEventHttpStatus as httpStatus}
 from "../../../lib/payments/vendorPackageProviderEventProcessing.mjs";
import {createRc28VendorPackageEventRepository as makeRepo,RC28_PROVIDER_LEDGER_RUNTIME_INSTALLED}
 from "../../../lib/payments/vendorPackageProviderEventRepository.mjs";
import {build} from "esbuild";
import {mkdirSync} from "node:fs";
import {resolve,dirname} from "node:path";
import {fileURLToPath,pathToFileURL} from "node:url";
// Node 20 CI has no native .ts loader. Exercise the real payment authority
// through an esbuild-compiled source module on both Node 20 and Node 24.
const root=resolve(dirname(fileURLToPath(import.meta.url)),"../../..");
const compiled=resolve(root,"test-results/rc31-finance-payment-authority.mjs");
mkdirSync(resolve(root,"test-results"),{recursive:true});
await build({entryPoints:[resolve(root,"lib/payments/vendorPackageRazorpay.ts")],
 bundle:true,platform:"node",target:"node20",format:"esm",outfile:compiled,logLevel:"silent"});
const {assertCapturedPayment}=await import(pathToFileURL(compiled).href);

const realFetch=globalThis.fetch;let fetchCalls=0;
test.before(()=>{globalThis.fetch=async()=>{fetchCalls++;throw Error("PROVIDER_CALL_FORBIDDEN")}});
test.after(()=>{globalThis.fetch=realFetch;assert.equal(fetchCalls,0)});

// Mirrors the qf_record/complete_vendor_package_razorpay_event_v2 state machine.
function pgTransport(){
 const rows=new Map();
 const rpc=async(name,a)=>{
  const k=a.p_provider_mode+"|"+a.p_event_id;
  if(name==="qf_record_vendor_package_razorpay_event_v2"){
   let r=rows.get(k);
   if(!r){r={body:a.p_body_sha256,status:"available",attempts:0,outcome:null,code:null};rows.set(k,r)}
   const base={event_id:a.p_event_id,provider_mode:a.p_provider_mode};
   if(r.body!==a.p_body_sha256)return {data:{...base,status:"conflict"}};
   if(r.status==="completed")return {data:{...base,status:"replay",outcome:r.outcome}};
   if(r.status==="quarantined")return {data:{...base,status:"quarantined",last_error_code:r.code}};
   if(r.status==="claimed")return {data:{...base,status:"in_flight"}};
   r.status="claimed";r.attempts++;r.code=null;
   return {data:{...base,status:"claimed",attempt_count:r.attempts}};
  }
  const r=rows.get(k);
  if(!r||r.status!=="claimed"||r.attempts!==a.p_attempt_count)
   return {error:{code:"42501",message:"PROVIDER_EVENT_COMPLETION_FENCE_DENIED"}};
  r.status=a.p_disposition;r.outcome=a.p_outcome;r.code=a.p_error_code;
  return {data:{event_id:a.p_event_id,provider_mode:a.p_provider_mode,status:a.p_disposition,
   outcome:a.p_outcome,error_code:a.p_error_code}};
 };
 return {rows,rpc};
}
const candidate={kind:"captured",paymentId:"pay_ABC12345",providerOrderId:"order_XYZ12345"};
const envelope=()=>envelopeOf({eventId:"evt_Abc12345",bodySha256:"a".repeat(64),providerMode:"test",candidate});
const base={id:"pay_ABC12345",order_id:"order_XYZ12345",amount:250000,currency:"INR",status:"captured",captured:true};
const expected={paymentId:"pay_ABC12345",providerOrderId:"order_XYZ12345",amount:250000,currency:"INR"};
const message=f=>{try{f();return null}catch(e){return e.message}};

test("ledger stays hard-off",()=>assert.equal(RC28_PROVIDER_LEDGER_RUNTIME_INSTALLED,false));

test("assertCapturedPayment: refunded/partially refunded capture is PAYMENT_REFUNDED",()=>{
 assert.equal(message(()=>assertCapturedPayment(base,expected)),null);
 assert.equal(message(()=>assertCapturedPayment({...base,status:"refunded"},expected)),"PAYMENT_REFUNDED");
 assert.equal(message(()=>assertCapturedPayment({...base,amount_refunded:100,refund_status:"partial"},expected)),"PAYMENT_REFUNDED");
 assert.equal(message(()=>assertCapturedPayment({...base,amount_refunded:0,refund_status:null},expected)),null);
 assert.equal(message(()=>assertCapturedPayment({...base,status:"authorized",captured:false},expected)),"PAYMENT_NOT_CAPTURED");
 assert.equal(message(()=>assertCapturedPayment({...base,amount_refunded:"x"},expected)),"PAYMENT_REFUNDED");
 assert.equal(message(()=>assertCapturedPayment({...base,amount_refunded:"0"},expected)),"PAYMENT_REFUNDED");
 assert.equal(message(()=>assertCapturedPayment({...base,amount_refunded:-1},expected)),"PAYMENT_REFUNDED");
 assert.equal(message(()=>assertCapturedPayment({...base,refund_status:"unexpected"},expected)),"PAYMENT_REFUNDED");
 // identity mismatches still win over refund state
 assert.equal(message(()=>assertCapturedPayment({...base,status:"refunded",amount:1},expected)),"PAYMENT_AMOUNT_MISMATCH");
});

test("durable: refunded capture is quarantined once, acked 200, never re-run",async()=>{
 const pg=pgTransport();let activations=0;
 const run=()=>processEvent({envelope:envelope(),repository:makeRepo(pg.rpc),
  handle:async()=>{assertCapturedPayment({...base,status:"refunded"},expected);activations++;return "activated"}});
 const first=await run();
 assert.deepEqual({ack:first.ack,status:first.status,code:first.code},{ack:true,status:"quarantined",code:"PAYMENT_REFUNDED"});
 assert.equal(httpStatus(first),200);
 const again=await run();
 assert.equal(again.ack,true);assert.equal(again.code,"PAYMENT_REFUNDED");
 assert.equal(activations,0);
 assert.equal(pg.rows.get("test|evt_Abc12345").status,"quarantined");
});

test("durable: not-yet-captured stays retryable (503), later capture activates once",async()=>{
 const pg=pgTransport();let activations=0;
 const handle=payment=>async()=>{assertCapturedPayment(payment,expected);activations++;return "activated"};
 const r1=await processEvent({envelope:envelope(),repository:makeRepo(pg.rpc),handle:handle({...base,status:"authorized",captured:false})});
 assert.equal(httpStatus(r1),503);assert.equal(r1.code,"PAYMENT_NOT_CAPTURED");
 const r2=await processEvent({envelope:envelope(),repository:makeRepo(pg.rpc),handle:handle(base)});
 assert.equal(r2.status,"activated");assert.equal(httpStatus(r2),200);
 const r3=await processEvent({envelope:envelope(),repository:makeRepo(pg.rpc),handle:handle(base)});
 assert.equal(r3.replay,true);assert.equal(activations,1);
});
