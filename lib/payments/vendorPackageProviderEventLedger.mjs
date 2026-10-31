// RC26 Finance V2: durable Razorpay provider-event idempotency/recovery fences.
// Pure. No DB/provider access and no credit authority. Runs ONLY after HMAC
// verification and classifyVendorPackageWebhookEvent; the SQL ledger
// (qf_record/complete_vendor_package_razorpay_event_v2) is the durable authority.
import {isRefundIntakeEventType,REFUND_REVIEW_REQUIRED_CODE} from "./vendorPackageRefundIntake.mjs";
const obj=x=>x!==null&&typeof x==="object"&&!Array.isArray(x);
const EVENT_ID=/^[A-Za-z0-9_-]{8,64}$/;
const SHA256=/^[a-f0-9]{64}$/;
const CODE=/^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+$/;
const STORED_CODE=/^[A-Z][A-Z0-9_]{2,80}$/;
const PAY=/^pay_[A-Za-z0-9]{4,64}$/;
const ORDER=/^order_[A-Za-z0-9]{4,64}$/;
const REFUND=/^rfnd_[A-Za-z0-9]{4,64}$/;
const EVENT_TYPE=Object.freeze({captured:"payment.captured",failed:"payment.failed"});
const OUTCOMES=Object.freeze({
 "payment.captured":Object.freeze(["activated","already_activated"]),
 "payment.failed":Object.freeze(["failed_recorded","failure_ignored"]),
});
export const PROVIDER_EVENT_MAX_ATTEMPTS=25;

/** Unset means "off". Anything other than off/enforce is a config error. */
export function vendorPackageEventLedgerMode(value){
 const v=(value??"").trim().toLowerCase();
 if(v===""||v==="off")return "off";
 if(v==="enforce")return "enforce";
 return null;
}

/** LIVE webhooks never run without the durable ledger. */
export function vendorPackageEventLedgerConfigError(providerMode,ledgerMode){
 if(providerMode!=="test"&&providerMode!=="live")return "RAZORPAY_V2_MODE_REQUIRED";
 if(ledgerMode!=="off"&&ledgerMode!=="enforce")return "RAZORPAY_EVENT_LEDGER_CONFIG_INVALID";
 if(providerMode==="live"&&ledgerMode!=="enforce")return "RAZORPAY_EVENT_LEDGER_REQUIRED_FOR_LIVE";
 return null;
}

export function buildRazorpayProviderEventEnvelope(input){
 const deny=reason=>Object.freeze({ok:false,reason});
 if(!obj(input))return deny("PROVIDER_EVENT_ENVELOPE_INVALID");
 const {eventId,bodySha256,providerMode,candidate}=input;
 if(typeof eventId!=="string"||!EVENT_ID.test(eventId))return deny("RAZORPAY_WEBHOOK_EVENT_ID_INVALID");
 if(typeof bodySha256!=="string"||!SHA256.test(bodySha256))return deny("PROVIDER_EVENT_ENVELOPE_INVALID");
 if(providerMode!=="test"&&providerMode!=="live")return deny("RAZORPAY_V2_MODE_REQUIRED");
 const refund=obj(candidate)&&candidate.kind==="refund"&&isRefundIntakeEventType(candidate.eventName)&&
  typeof candidate.refundId==="string"&&REFUND.test(candidate.refundId);
 if(!obj(candidate)||(!refund&&!Object.hasOwn(EVENT_TYPE,candidate.kind))||
    typeof candidate.paymentId!=="string"||!PAY.test(candidate.paymentId)||
    typeof candidate.providerOrderId!=="string"||!ORDER.test(candidate.providerOrderId))
  return deny("PROVIDER_EVENT_ENVELOPE_INVALID");
 return Object.freeze({ok:true,eventId,bodySha256,providerMode,
  eventType:refund?candidate.eventName:EVENT_TYPE[candidate.kind],providerOrderId:candidate.providerOrderId,
  paymentId:candidate.paymentId});
}

const sameEvent=(r,e)=>r.event_id===e.eventId&&r.provider_mode===e.providerMode;

/** Only "claimed" may proceed to order lookup, provider GET and Core RPCs. */
export function inspectProviderEventClaim(receipt,envelope){
 if(!obj(receipt)||!obj(envelope)||envelope.ok!==true||!sameEvent(receipt,envelope))
  return Object.freeze({state:"invalid"});
 switch(receipt.status){
  case "claimed":
   return Number.isSafeInteger(receipt.attempt_count)&&receipt.attempt_count>=1&&
    receipt.attempt_count<=PROVIDER_EVENT_MAX_ATTEMPTS
    ?Object.freeze({state:"claimed",attempt:receipt.attempt_count})
    :Object.freeze({state:"invalid"});
  case "replay":
   return providerEventOutcomeAllowed(envelope.eventType,receipt.outcome)
    ?Object.freeze({state:"replay",outcome:receipt.outcome})
    :Object.freeze({state:"invalid"});
  case "quarantined":
   return (!isRefundIntakeEventType(envelope.eventType)||
    receipt.last_error_code===REFUND_REVIEW_REQUIRED_CODE)&&
    typeof receipt.last_error_code==="string"&&STORED_CODE.test(receipt.last_error_code)
    ?Object.freeze({state:"quarantined",code:receipt.last_error_code})
    :Object.freeze({state:"invalid"});
  case "needs_reconciliation":
   return receipt.last_error_code==="PROVIDER_EVENT_ATTEMPTS_EXHAUSTED"
    ?Object.freeze({state:"needs_reconciliation",code:receipt.last_error_code})
    :Object.freeze({state:"invalid"});
  case "in_flight":return Object.freeze({state:"in_flight"});
  case "conflict":return Object.freeze({state:"conflict"});
  default:return Object.freeze({state:"invalid"});
 }
}

export function inspectProviderEventCompletion(receipt,envelope,expected){
 if(!obj(receipt)||!obj(envelope)||envelope.ok!==true||!obj(expected)||
    !sameEvent(receipt,envelope)||receipt.status!==expected.disposition)return false;
 if(expected.disposition==="completed")
  return providerEventOutcomeAllowed(envelope.eventType,expected.outcome)&&receipt.outcome===expected.outcome;
 return (expected.disposition==="retryable"||expected.disposition==="quarantined")&&
  typeof expected.errorCode==="string"&&STORED_CODE.test(expected.errorCode)&&
  receipt.error_code===expected.errorCode;
}

export function providerEventOutcomeAllowed(eventType,outcome){
 return Object.hasOwn(OUTCOMES,eventType)&&OUTCOMES[eventType].includes(outcome);
}

/** Bare finance code from AppError / PostgREST (P0001 + message) / Error. */
export function financeErrorCode(error){
 if(!obj(error)&&!(error instanceof Error))return "UNKNOWN";
 if(typeof error.code==="string"&&CODE.test(error.code))return error.code;
 if(typeof error.message==="string"&&CODE.test(error.message.trim()))return error.message.trim();
 return "UNKNOWN";
}

// Deterministic failures that a provider redelivery cannot fix. They are
// recorded durably as quarantined for human reconciliation; nothing here
// grants or revokes credits. Everything else (transport, DB, provider
// uncertainty, not-yet-captured, unknown codes) stays retryable.
const QUARANTINE=new Set([
 "PACKAGE_ORDER_NOT_FOUND","PACKAGE_ORDER_MODE_MISMATCH","PACKAGE_ORDER_PROVIDER_MISMATCH",
 "PACKAGE_ORDER_NOT_BOUND","PACKAGE_ORDER_REFUND_LOCKED","PACKAGE_ORDER_PAYMENT_ID_DRIFT",
 "PAYMENT_ID_MISMATCH","PAYMENT_ORDER_MISMATCH","PAYMENT_AMOUNT_MISMATCH",
 "PAYMENT_CURRENCY_MISMATCH","PROVIDER_PAYMENT_ID_MISMATCH","PAYMENT_REFUNDED",
 "PACKAGE_ORDER_LIFECYCLE_NOT_ACTIVATABLE","PACKAGE_PAYMENT_LEDGER_NOT_ACTIVATABLE",
 "PACKAGE_ORDER_LEDGER_DRIFT","PACKAGE_ORDER_AMOUNT_DRIFT","PACKAGE_ORDER_SNAPSHOT_INVALID",
 "PAYMENT_FAILURE_LEDGER_UNVERIFIED","REFUND_REVIEW_REQUIRED",
]);
export function classifyVendorPackageWebhookFailure(code){
 return typeof code==="string"&&QUARANTINE.has(code)?"quarantine":"retryable";
}
