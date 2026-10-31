// RC27-B Finance: provider-event processing orchestration + hard-OFF route gate.
// Offline. Any fetch attempt fails the suite: no provider calls, no DB.
import test from "node:test";
import assert from "node:assert/strict";
import {createHash,createHmac,timingSafeEqual} from "node:crypto";
import {readFileSync} from "node:fs";
import {resolve,dirname} from "node:path";
import {fileURLToPath} from "node:url";
import {PROVIDER_EVENT_MAX_ATTEMPTS,buildRazorpayProviderEventEnvelope as envelopeOf}
 from "../../../lib/payments/vendorPackageProviderEventLedger.mjs";
import {classifyVendorPackageWebhookEvent as classifyEvent}
 from "../../../lib/payments/vendorPackageWebhookBoundary.mjs";
import {resolveVendorPackageEventLedgerGate as gate,processVendorPackageProviderEvent as processEvent,
 providerEventHttpStatus as httpStatus,isProviderEventRepository}
 from "../../../lib/payments/vendorPackageProviderEventProcessing.mjs";

const root=resolve(dirname(fileURLToPath(import.meta.url)),"../../..");
let fetchCalls=0;
const realFetch=globalThis.fetch;
test.before(()=>{globalThis.fetch=async()=>{fetchCalls++;throw Error("PROVIDER_CALL_FORBIDDEN")}});
test.after(()=>{globalThis.fetch=realFetch;assert.equal(fetchCalls,0,"no provider calls")});

const SECRET="whsec_local_test_only";
const sha=s=>createHash("sha256").update(s,"utf8").digest("hex");
const sign=raw=>createHmac("sha256",SECRET).update(raw).digest("hex");
const verify=(raw,sig)=>{const a=Buffer.from(sign(raw)),b=Buffer.from(sig);return a.length===b.length&&timingSafeEqual(a,b)};
const body=(event="payment.captured",pay="pay_ABC12345",order="order_XYZ12345")=>JSON.stringify({
 event,payload:{payment:{entity:{id:pay,order_id:order}},order:{entity:{id:order}}}});

// Mirrors the route/service order: HMAC -> parse -> classify -> envelope.
function pipeline(raw,sig,{eventId="evt_Abc12345",providerMode="test"}={}){
 if(!verify(raw,sig))return {code:"PAYMENT_SIGNATURE_INVALID"};
 const candidate=classifyEvent(JSON.parse(raw));
 if(candidate.kind!=="captured"&&candidate.kind!=="failed")return {code:candidate.reason};
 return {envelope:envelopeOf({eventId,bodySha256:sha(raw),providerMode,candidate})};
}

// In-memory model of qf_record/complete_vendor_package_razorpay_event_v2.
function memoryRepository({failClaim=false,failComplete=false,lieComplete=false,startAttempt=0}={}){
 const rows=new Map();const calls={claim:0,complete:0};
 const key=e=>e.providerMode+":"+e.eventId;
 return {rows,calls,
  async claim(e){
   calls.claim++;
   if(failClaim)throw Error("connection reset");
   const base={event_id:e.eventId,provider_mode:e.providerMode};
   let r=rows.get(key(e));
   if(!r){r={hash:e.bodySha256,state:"open",attempts:startAttempt};rows.set(key(e),r)}
   if(r.hash!==e.bodySha256)return {...base,status:"conflict"};
   if(r.state==="completed")return {...base,status:"replay",outcome:r.outcome};
   if(r.state==="quarantined")return {...base,status:"quarantined",last_error_code:r.code};
   if(r.state==="claimed")return {...base,status:"in_flight"};
   r.state="claimed";r.attempts++;
   return {...base,status:"claimed",attempt_count:r.attempts};
  },
  async complete(e,x){
   calls.complete++;
   if(failComplete)throw Error("timeout");
   const r=rows.get(key(e));
   if(x.disposition==="completed"){r.state="completed";r.outcome=x.outcome}
   else if(x.disposition==="quarantined"){r.state="quarantined";r.code=x.errorCode}
   else r.state="open";
   const out={event_id:e.eventId,provider_mode:e.providerMode,status:x.disposition,
    outcome:x.outcome,error_code:x.errorCode};
   return lieComplete?{...out,status:"completed",outcome:"activated"}:out;
  }};
}
const handler=(result)=>{const h=async()=>{h.calls++;if(result instanceof Error)throw result;return result};h.calls=0;return h};
const finance=code=>Object.assign(Error(code),{code});

test("route gate: TEST+off keeps legacy path; every other state fails closed",()=>{
 for(const v of [undefined,null,""," off ","OFF"])
  assert.deepEqual({...gate({providerMode:"test",ledgerModeValue:v})},{action:"legacy"});
 const deny=(input,code)=>assert.deepEqual({...gate(input)},{action:"deny",code});
 deny({providerMode:"live",ledgerModeValue:undefined},"RAZORPAY_EVENT_LEDGER_REQUIRED_FOR_LIVE");
 deny({providerMode:"live",ledgerModeValue:"off"},"RAZORPAY_EVENT_LEDGER_REQUIRED_FOR_LIVE");
 deny({providerMode:"test",ledgerModeValue:"on"},"RAZORPAY_EVENT_LEDGER_CONFIG_INVALID");
 deny({providerMode:"disabled",ledgerModeValue:"enforce"},"RAZORPAY_V2_MODE_REQUIRED");
 deny(null,"RAZORPAY_EVENT_LEDGER_CONFIG_INVALID");
 // Enforce without a durable repository (the only source state today) denies.
 for(const providerMode of ["test","live"]){
  deny({providerMode,ledgerModeValue:"enforce"},"RAZORPAY_EVENT_LEDGER_REPOSITORY_UNAVAILABLE");
  deny({providerMode,ledgerModeValue:"enforce",repository:{claim(){}}},"RAZORPAY_EVENT_LEDGER_REPOSITORY_UNAVAILABLE");
 }
 const repo=memoryRepository();
 const g=gate({providerMode:"test",ledgerModeValue:"enforce",repository:repo});
 assert.equal(g.action,"ledger");assert.equal(g.repository,repo);
 assert.equal(isProviderEventRepository(repo),true);
});

test("signed capture: first delivery runs handler once, redelivery replays without Core",async()=>{
 const raw=body();const {envelope}=pipeline(raw,sign(raw));
 const repo=memoryRepository();const h=handler("activated");
 const first=await processEvent({envelope,repository:repo,handle:h});
 assert.deepEqual({...first},{ack:true,retry:false,status:"activated",code:null});
 assert.equal(httpStatus(first),200);
 const again=await processEvent({envelope,repository:repo,handle:h});
 assert.equal(again.replay,true);assert.equal(again.status,"activated");assert.equal(httpStatus(again),200);
 assert.equal(h.calls,1,"replay never re-enters order lookup / provider GET / Core RPC");
});

test("bad HMAC, tampered body and ignored events never reach the ledger",async()=>{
 const raw=body();
 assert.equal(pipeline(raw,sign(raw+" ")).code,"PAYMENT_SIGNATURE_INVALID");
 assert.equal(pipeline(body("payment.captured","pay_OTHER1234"),sign(raw)).code,"PAYMENT_SIGNATURE_INVALID");
 const refund=body("refund.processed");
 assert.equal(pipeline(refund,sign(refund)).code,"WEBHOOK_EVENT_OUT_OF_SCOPE");
 const repo=memoryRepository();const h=handler("activated");
 const r=await processEvent({envelope:envelopeOf({eventId:null,bodySha256:sha(raw),providerMode:"test",
  candidate:classifyEvent(JSON.parse(raw))}),repository:repo,handle:h});
 assert.deepEqual({...r},{ack:false,retry:false,status:"rejected",code:"RAZORPAY_WEBHOOK_EVENT_ID_INVALID"});
 assert.equal(repo.calls.claim,0);assert.equal(h.calls,0);
});

test("TEST and LIVE ledgers are separate keys; same id with different body is a conflict",async()=>{
 const raw=body();const repo=memoryRepository();const h=handler("activated");
 await processEvent({envelope:pipeline(raw,sign(raw)).envelope,repository:repo,handle:h});
 const live=await processEvent({envelope:pipeline(raw,sign(raw),{providerMode:"live"}).envelope,repository:repo,handle:h});
 assert.equal(live.status,"activated");assert.equal(live.replay,undefined);assert.equal(h.calls,2);
 const drift=body("payment.captured","pay_DRIFT1234");
 const c=await processEvent({envelope:pipeline(drift,sign(drift)).envelope,repository:repo,handle:h});
 assert.equal(c.code,"PROVIDER_EVENT_CONFLICT");assert.equal(httpStatus(c),409);assert.equal(h.calls,2);
});

test("retry classification: transport/unknown retry, deterministic finance codes quarantine",async()=>{
 const raw=body();const {envelope}=pipeline(raw,sign(raw));
 const repo=memoryRepository();
 const r1=await processEvent({envelope,repository:repo,handle:handler(Error("ECONNRESET"))});
 assert.deepEqual({...r1},{ack:false,retry:true,status:"retry",code:"UNKNOWN"});
 assert.equal(httpStatus(r1),503);
 const r2=await processEvent({envelope,repository:repo,handle:handler(finance("PAYMENT_NOT_CAPTURED"))});
 assert.equal(r2.retry,true);assert.equal(r2.code,"PAYMENT_NOT_CAPTURED");
 const q=await processEvent({envelope,repository:repo,handle:handler(finance("PAYMENT_AMOUNT_MISMATCH"))});
 assert.deepEqual({...q},{ack:true,retry:false,status:"quarantined",code:"PAYMENT_AMOUNT_MISMATCH"});
 const h=handler("activated");
 const after=await processEvent({envelope,repository:repo,handle:h});
 assert.equal(after.status,"quarantined");assert.equal(h.calls,0,"quarantine is sticky until human reconciliation");
 // Disallowed outcome for the event type is never recorded as completed.
 const f=body("payment.failed");const fr=memoryRepository();
 const bad=await processEvent({envelope:pipeline(f,sign(f)).envelope,repository:fr,handle:handler("activated")});
 assert.equal(bad.code,"PROVIDER_EVENT_OUTCOME_INVALID");assert.equal(bad.retry,true);
});

test("attempt budget exhaustion quarantines; in-flight claims ask provider to retry",async()=>{
 const raw=body();const {envelope}=pipeline(raw,sign(raw));
 const repo=memoryRepository({startAttempt:PROVIDER_EVENT_MAX_ATTEMPTS-1});
 const r=await processEvent({envelope,repository:repo,handle:handler(Error("boom"))});
 assert.equal(r.status,"quarantined");assert.equal(r.code,"PROVIDER_EVENT_ATTEMPTS_EXHAUSTED");
 const inflight=memoryRepository();const h=handler("activated");
 inflight.rows.set("test:"+envelope.eventId,{hash:envelope.bodySha256,state:"claimed",attempts:1});
 const busy=await processEvent({envelope,repository:inflight,handle:h});
 assert.equal(busy.code,"PROVIDER_EVENT_IN_FLIGHT");assert.equal(httpStatus(busy),503);assert.equal(h.calls,0);
});

test("ledger unavailable / unconfirmed completion is never acknowledged",async()=>{
 const raw=body();const {envelope}=pipeline(raw,sign(raw));
 const h=handler("activated");
 const down=await processEvent({envelope,repository:memoryRepository({failClaim:true}),handle:h});
 assert.equal(down.code,"PROVIDER_EVENT_LEDGER_UNAVAILABLE");assert.equal(h.calls,0);
 const lost=await processEvent({envelope,repository:memoryRepository({failComplete:true}),handle:h});
 assert.equal(lost.code,"PROVIDER_EVENT_COMPLETION_UNCONFIRMED");assert.equal(lost.ack,false);
 const lie=await processEvent({envelope,repository:memoryRepository({lieComplete:true}),handle:handler(finance("PAYMENT_REFUNDED"))});
 assert.equal(lie.code,"PROVIDER_EVENT_COMPLETION_UNCONFIRMED");assert.equal(lie.ack,false);
 const none=await processEvent({envelope,repository:undefined,handle:h});
 assert.equal(none.code,"RAZORPAY_EVENT_LEDGER_REPOSITORY_UNAVAILABLE");assert.equal(none.retry,true);
 const badReceipt=await processEvent({envelope,repository:{claim:async()=>({event_id:"evt_Other123",provider_mode:"test",status:"claimed",attempt_count:1}),complete:async()=>null},handle:h});
 assert.equal(badReceipt.code,"PROVIDER_EVENT_LEDGER_RECEIPT_INVALID");
});

test("service wiring: gate runs after HMAC/classify and before any order lookup or provider GET",()=>{
 const src=readFileSync(resolve(root,"services/vendorPackagePaymentService.ts"),"utf8");
 const fn=src.slice(src.indexOf("export async function handleVendorPackageRazorpayWebhook"));
 const at=s=>{const i=fn.indexOf(s);assert.ok(i>0,s);return i};
 const g=at("resolveVendorPackageEventLedgerGate(");
 assert.ok(at("verifyWebhookSignature(")<g);
 assert.ok(at("classifyVendorPackageWebhookEvent(event)")<g);
 assert.ok(g<at("loadOrderByProviderOrderId("));
 assert.ok(g<at("razorpayFetch<"));
 assert.ok(g<at("markPaymentFailed("));
 assert.match(fn,/ledgerModeValue: process\.env\.RAZORPAY_VENDOR_PACKAGE_EVENT_LEDGER_MODE,\s*\}\);/,
  "no repository is passed: enforce stays fail-closed");
 assert.match(fn,/if \(ledgerGate\.action !== "legacy"\) \{\s*throw paymentError\(/);
 const route=readFileSync(resolve(root,"app/api/webhooks/razorpay/vendor-package/route.ts"),"utf8");
 assert.match(route,/x-razorpay-signature/);
 assert.match(route,/readBoundedRazorpayWebhookBody\(request\)/);
 assert.match(route,/PAYMENT_SIGNATURE_INVALID" \? 401 : 500/);
 const lib=readFileSync(resolve(root,"lib/payments/vendorPackageProviderEventProcessing.mjs"),"utf8");
 assert.doesNotMatch(lib,/fetch\(|adminClient|supabase\.|\.rpc\(|process\.env/);
});
