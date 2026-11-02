// RC26-B Finance: durable Razorpay provider-event ledger fences.
// Pure, offline. Any fetch attempt fails the suite: no provider calls.
import test from "node:test";
import assert from "node:assert/strict";
import {createHash,createHmac} from "node:crypto";
import {
 PROVIDER_EVENT_MAX_ATTEMPTS,vendorPackageEventLedgerMode,vendorPackageEventLedgerConfigError,
 buildRazorpayProviderEventEnvelope as envelopeOf,inspectProviderEventClaim as claimOf,
 inspectProviderEventCompletion as completionOk,providerEventOutcomeAllowed,
 financeErrorCode,classifyVendorPackageWebhookFailure as classifyFailure,
} from "../../../lib/payments/vendorPackageProviderEventLedger.mjs";
import {classifyVendorPackageWebhookEvent as classifyEvent}
 from "../../../lib/payments/vendorPackageWebhookBoundary.mjs";
import {assessVendorPackageRefundEvidence as assessRefund}
 from "../../../lib/payments/vendorPackageRefundEvidence.mjs";
import {reconcileRefundAgainstCreditEvidence as reconcile}
 from "../../../lib/payments/vendorPackageRefundReconciliationReview.mjs";

let fetchCalls=0;
const realFetch=globalThis.fetch;
test.before(()=>{globalThis.fetch=async()=>{fetchCalls++;throw Error("PROVIDER_CALL_FORBIDDEN")}});
test.after(()=>{globalThis.fetch=realFetch;assert.equal(fetchCalls,0,"no provider calls")});

const sha=s=>createHash("sha256").update(s,"utf8").digest("hex");
const body=(event="payment.captured",pay="pay_ABC12345",order="order_XYZ12345")=>JSON.stringify({
 event,payload:{payment:{entity:{id:pay,order_id:order}},order:{entity:{id:order}}}});
const env=(over={})=>{
 const raw=over.raw??body(over.event);
 return envelopeOf({eventId:"evt_Abc12345",bodySha256:sha(raw),providerMode:"test",
  candidate:classifyEvent(JSON.parse(raw)),...over.fields});
};
const receipt=(e,over)=>({event_id:e.eventId,provider_mode:e.providerMode,...over});

test("ledger mode is off|enforce only; LIVE webhooks require enforce (hard-off otherwise)",()=>{
 for(const v of [undefined,null,""," off ","OFF"])assert.equal(vendorPackageEventLedgerMode(v),"off");
 assert.equal(vendorPackageEventLedgerMode(" Enforce "),"enforce");
 for(const v of ["on","true","1","enforced","disabled"])assert.equal(vendorPackageEventLedgerMode(v),null);
 assert.equal(vendorPackageEventLedgerConfigError("test","off"),null);
 assert.equal(vendorPackageEventLedgerConfigError("test","enforce"),null);
 assert.equal(vendorPackageEventLedgerConfigError("live","enforce"),null);
 assert.equal(vendorPackageEventLedgerConfigError("live","off"),"RAZORPAY_EVENT_LEDGER_REQUIRED_FOR_LIVE");
 assert.equal(vendorPackageEventLedgerConfigError("live",null),"RAZORPAY_EVENT_LEDGER_CONFIG_INVALID");
 for(const m of ["disabled","","LIVE",undefined])
  assert.equal(vendorPackageEventLedgerConfigError(m,"enforce"),"RAZORPAY_V2_MODE_REQUIRED");
});

test("envelope binds event id, body hash, mode and exact signed payment/order identity",()=>{
 const e=env();
 assert.equal(e.ok,true);
 assert.deepEqual({...e},{ok:true,eventId:"evt_Abc12345",bodySha256:sha(body()),providerMode:"test",
  eventType:"payment.captured",providerOrderId:"order_XYZ12345",paymentId:"pay_ABC12345"});
 assert.ok(Object.isFrozen(e));
 assert.equal(env({event:"payment.failed"}).eventType,"payment.failed");
 for(const eventId of [null,"","short","evt with space","x".repeat(65),"evt_'; drop"])
  assert.equal(env({fields:{eventId}}).reason,"RAZORPAY_WEBHOOK_EVENT_ID_INVALID");
 for(const bodySha256 of ["","ABC",sha("x").toUpperCase(),sha("x").slice(1)])
  assert.equal(env({fields:{bodySha256}}).reason,"PROVIDER_EVENT_ENVELOPE_INVALID");
 for(const providerMode of ["disabled","LIVE","",null])
  assert.equal(env({fields:{providerMode}}).reason,"RAZORPAY_V2_MODE_REQUIRED");
 // Unsigned/ignored/invalid boundary results never become a ledger envelope.
 for(const candidate of [classifyEvent({event:"refund.processed"}),classifyEvent({event:7}),
  {kind:"captured",paymentId:"order_X1234",providerOrderId:"order_XYZ12345"},
  {kind:"captured",paymentId:"pay_ABC12345",providerOrderId:"pay_ABC12345"},
  {kind:"refunded",paymentId:"pay_ABC12345",providerOrderId:"order_XYZ12345"},null,[]])
  assert.equal(env({fields:{candidate}}).ok,false,JSON.stringify(candidate));
 assert.equal(envelopeOf(null).ok,false);
});

test("signature authority: only HMAC-exact raw bytes may reach the ledger; drift is a different event",()=>{
 const secret="synthetic_test_only";
 const raw=body();
 const sig=createHmac("sha256",secret).update(raw).digest("hex");
 const reserialized=JSON.stringify(JSON.parse(raw),null,1);
 assert.notEqual(createHmac("sha256",secret).update(reserialized).digest("hex"),sig);
 // Same event id with different bytes yields a different hash: SQL returns conflict.
 assert.notEqual(env({raw:reserialized}).bodySha256,env({raw}).bodySha256);
 // Linked order identity drift is rejected before any envelope/lookup.
 const drift=JSON.parse(raw);drift.payload.order.entity.id="order_OTHER1234";
 assert.equal(classifyEvent(drift).kind,"invalid");
});

test("exact-once: only a valid 'claimed' receipt for THIS event proceeds; replays never reprocess",()=>{
 const e=env();
 assert.deepEqual({...claimOf(receipt(e,{status:"claimed",attempt_count:1}),e)},{state:"claimed",attempt:1});
 assert.equal(claimOf(receipt(e,{status:"claimed",attempt_count:PROVIDER_EVENT_MAX_ATTEMPTS}),e).state,"claimed");
 for(const attempt_count of [0,-1,1.5,"1",null,PROVIDER_EVENT_MAX_ATTEMPTS+1])
  assert.equal(claimOf(receipt(e,{status:"claimed",attempt_count}),e).state,"invalid");
 for(const outcome of ["activated","already_activated"])
  assert.deepEqual({...claimOf(receipt(e,{status:"replay",outcome}),e)},{state:"replay",outcome});
 assert.equal(claimOf(receipt(e,{status:"needs_reconciliation",last_error_code:"PROVIDER_EVENT_ATTEMPTS_EXHAUSTED"}),e).state,"needs_reconciliation");
 assert.equal(claimOf(receipt(e,{status:"needs_reconciliation",last_error_code:"bad"}),e).state,"invalid");
 assert.equal(claimOf(receipt(e,{status:"in_flight"}),e).state,"in_flight");
 assert.equal(claimOf(receipt(e,{status:"conflict"}),e).state,"conflict");
 assert.deepEqual({...claimOf(receipt(e,{status:"quarantined",last_error_code:"PACKAGE_ORDER_NOT_FOUND"}),e)},
  {state:"quarantined",code:"PACKAGE_ORDER_NOT_FOUND"});
 assert.equal(claimOf(receipt(e,{status:"quarantined",last_error_code:"bad code"}),e).state,"invalid");
 // Cross-event / cross-mode / unknown receipts fail closed.
 for(const r of [{...receipt(e,{status:"claimed",attempt_count:1}),event_id:"evt_Other1234"},
  {...receipt(e,{status:"claimed",attempt_count:1}),provider_mode:"live"},
  receipt(e,{status:"applied"}),receipt(e,{}),null,[],"claimed"])
  assert.equal(claimOf(r,e).state,"invalid",JSON.stringify(r));
 assert.equal(claimOf(receipt(e,{status:"claimed",attempt_count:1}),{ok:false}).state,"invalid");
});

test("out-of-order events: outcomes are bound to event type; failure cannot claim activation",()=>{
 const captured=env(),failed=env({event:"payment.failed"});
 // A replayed captured receipt cannot carry a failure outcome and vice versa.
 assert.equal(claimOf(receipt(captured,{status:"replay",outcome:"failed_recorded"}),captured).state,"invalid");
 assert.equal(claimOf(receipt(failed,{status:"replay",outcome:"activated"}),failed).state,"invalid");
 assert.equal(claimOf(receipt(failed,{status:"replay",outcome:"failure_ignored"}),failed).state,"replay");
 assert.equal(providerEventOutcomeAllowed("payment.failed","failure_ignored"),true);
 assert.equal(providerEventOutcomeAllowed("payment.failed","activated"),false);
 assert.equal(providerEventOutcomeAllowed("payment.captured","failed_recorded"),false);
 assert.equal(providerEventOutcomeAllowed("refund.processed","activated"),false);
 assert.equal(providerEventOutcomeAllowed("toString","activated"),false);
 // Late failure after capture is a separate event whose ignored outcome is legitimate.
 assert.ok(completionOk(receipt(failed,{status:"completed",outcome:"failure_ignored",error_code:null}),
  failed,{disposition:"completed",outcome:"failure_ignored"}));
 assert.equal(completionOk(receipt(failed,{status:"completed",outcome:"activated"}),
  failed,{disposition:"completed",outcome:"activated"}),false);
});

test("completion receipt must echo exact disposition, outcome/code, event and mode",()=>{
 const e=env();
 assert.ok(completionOk(receipt(e,{status:"completed",outcome:"activated",error_code:null}),
  e,{disposition:"completed",outcome:"activated"}));
 assert.ok(completionOk(receipt(e,{status:"retryable",outcome:null,error_code:"RAZORPAY_HTTP_UNCERTAIN"}),
  e,{disposition:"retryable",errorCode:"RAZORPAY_HTTP_UNCERTAIN"}));
 assert.ok(completionOk(receipt(e,{status:"quarantined",outcome:null,error_code:"PAYMENT_REFUNDED"}),
  e,{disposition:"quarantined",errorCode:"PAYMENT_REFUNDED"}));
 for(const [r,x] of [
  [receipt(e,{status:"completed",outcome:"already_activated"}),{disposition:"completed",outcome:"activated"}],
  [receipt(e,{status:"retryable",error_code:"OTHER_CODE"}),{disposition:"retryable",errorCode:"RAZORPAY_HTTP_UNCERTAIN"}],
  [receipt(e,{status:"retryable",error_code:"bad"}),{disposition:"retryable",errorCode:"bad"}],
  [receipt(e,{status:"completed",outcome:"activated"}),{disposition:"retryable",errorCode:"X_Y"}],
  [{...receipt(e,{status:"completed",outcome:"activated"}),provider_mode:"live"},{disposition:"completed",outcome:"activated"}],
  [receipt(e,{status:"processing"}),{disposition:"processing"}],
  [null,{disposition:"completed",outcome:"activated"}],
  [receipt(e,{status:"completed",outcome:"activated"}),null],
 ])assert.equal(completionOk(r,e,x),false,JSON.stringify([r,x]));
});

test("failure codes are extracted from AppError, PostgREST and Error; unknown stays UNKNOWN",()=>{
 assert.equal(financeErrorCode({code:"PACKAGE_ORDER_NOT_FOUND",message:"Package order not found."}),"PACKAGE_ORDER_NOT_FOUND");
 assert.equal(financeErrorCode({code:"P0001",message:"PACKAGE_ORDER_LEDGER_DRIFT"}),"PACKAGE_ORDER_LEDGER_DRIFT");
 assert.equal(financeErrorCode(Error("PAYMENT_AMOUNT_MISMATCH")),"PAYMENT_AMOUNT_MISMATCH");
 for(const e of [Error("network down"),{code:"P0001",message:"something happened"},null,undefined,"PAYMENT_REFUNDED",42])
  assert.equal(financeErrorCode(e),"UNKNOWN");
});

test("unknown settlement / transport / not-captured states stay retryable (never acknowledged)",()=>{
 for(const code of ["UNKNOWN","RAZORPAY_HTTP_UNCERTAIN","PAYMENT_NOT_CAPTURED",
  "PAYMENT_ACTIVATION_RECEIPT_INVALID","PROVIDER_EVENT_IN_FLIGHT","PROVIDER_EVENT_LEASE_LOST",
  "PROVIDER_EVENT_ACTIVATION_UNPROVEN","PACKAGE_CREDIT_GRANT_NOT_APPLIED","SETTLEMENT_UNKNOWN",
  "",null,undefined,"__proto__"])
  assert.equal(classifyFailure(code),"retryable",String(code));
 for(const code of ["PACKAGE_ORDER_NOT_FOUND","PACKAGE_ORDER_MODE_MISMATCH","PACKAGE_ORDER_REFUND_LOCKED",
  "PAYMENT_REFUNDED","PROVIDER_PAYMENT_ID_MISMATCH","PACKAGE_ORDER_LEDGER_DRIFT","PAYMENT_AMOUNT_MISMATCH"])
  assert.equal(classifyFailure(code),"quarantine",code);
});

const ORDER_ID="00000000-0000-4000-8000-000000000003";
const VENDOR_ID="00000000-0000-4000-8000-000000000001";
const refund=(over={})=>({localOrderId:ORDER_ID,paymentId:"pay_ABC12345",providerMode:"test",
 paymentCaptured:true,providerReconciled:true,ledgerReconciled:true,vendorAssignmentReconciled:true,
 paymentRefunded:false,refundPending:false,activationStatus:"activated",
 creditsGranted:10,creditsConsumed:0,creditsRemaining:10,...over});
const debit=i=>({orderId:ORDER_ID,vendorId:VENDOR_ID,leadId:"00000000-0000-4000-8000-0000000001"+String(i).padStart(2,"0"),credits:1});

test("refund: consumed credits, unknown settlement and in-flight refunds never authorize money",()=>{
 const clean=assessRefund(refund());
 assert.equal(clean.ok,true);assert.equal(clean.refundAllowed,false);assert.equal(clean.requiresHumanReview,true);
 assert.equal(assessRefund(refund({creditsConsumed:3,creditsRemaining:7})).reason,
  "REFUND_CONSUMED_CREDITS_REQUIRE_POLICY_DECISION");
 assert.equal(assessRefund(refund({creditsConsumed:3,creditsRemaining:6})).reason,"REFUND_CREDIT_LEDGER_INCONSISTENT");
 assert.equal(assessRefund(refund({providerReconciled:false})).reason,"REFUND_EVIDENCE_UNRECONCILED");
 assert.equal(assessRefund(refund({paymentCaptured:"unknown"})).reason,"REFUND_EVIDENCE_UNRECONCILED");
 assert.equal(assessRefund(refund({refundPending:true})).reason,"REFUND_ATTEMPT_IN_FLIGHT");
 assert.equal(assessRefund(refund({paymentRefunded:true})).reason,"REFUND_ALREADY_RECORDED");
 assert.equal(assessRefund(refund({refundPending:null})).reason,"REFUND_LIFECYCLE_UNVERIFIED");
 assert.equal(assessRefund(refund({activationStatus:"unknown"})).reason,"REFUND_LIFECYCLE_UNVERIFIED");
 const {creditsConsumed,...missing}=refund();void creditsConsumed;
 assert.equal(assessRefund(missing).reason,"REFUND_EVIDENCE_INCOMPLETE");
 // Joined review: consumed debits deny; clean match still requires human and no settlement certification.
 const ledger={orderId:ORDER_ID,vendorId:VENDOR_ID,creditsGranted:10,creditsRemaining:8,ledgerDebits:[debit(1),debit(2)]};
 const consumed=reconcile({vendorId:VENDOR_ID,creditLedger:ledger,
  refundEvidence:refund({creditsConsumed:2,creditsRemaining:8})});
 assert.equal(consumed.ok,false);assert.equal(consumed.refundAllowed,false);assert.equal(consumed.creditRevocationAllowed,false);
 const matched=reconcile({vendorId:VENDOR_ID,refundEvidence:refund(),
  creditLedger:{orderId:ORDER_ID,vendorId:VENDOR_ID,creditsGranted:10,creditsRemaining:10,ledgerDebits:[]}});
 assert.equal(matched.ok,true);assert.equal(matched.refundAllowed,false);
 assert.equal(matched.creditRevocationAllowed,false);assert.equal(matched.providerSettlementIndependentlyCertified,false);
 // Refund-state webhook failures are quarantined, never retried into credit activation.
 assert.equal(classifyFailure("PACKAGE_ORDER_REFUND_LOCKED"),"quarantine");
});
