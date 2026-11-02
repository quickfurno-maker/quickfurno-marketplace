// RC28 Finance. Genuine PostgREST RPC repository adapter to a REVIEW-ONLY
// durable PostgreSQL candidate. No connection or provider call is created here.
// Production webhook does NOT construct this until independent DBA/AppSec,
// event-id provenance and financial activation are signed off.
import {inspectProviderEventClaim,inspectProviderEventCompletion}
 from "./vendorPackageProviderEventLedger.mjs";
export const RC28_PROVIDER_LEDGER_RUNTIME_INSTALLED=false;
const key=e=>e.providerMode+"|"+e.eventId;
const good=e=>e&&e.ok===true&&typeof e.eventId==="string"&&
 typeof e.providerMode==="string"&&typeof e.bodySha256==="string";
const unwrap=response=>{
 if(!response||response.error||!response.data||Array.isArray(response.data))
  throw Error("RC28_EVENT_LEDGER_SQL_RECEIPT_UNAVAILABLE");
 return response.data;
};
export function createRc28VendorPackageEventRepository(callRpc){
 if(typeof callRpc!=="function")throw TypeError("RC28_TRUSTED_RPC_REQUIRED");
 // Lease numbers are held only in THIS request-scope instance; every complete
 // is fenced to the exact PG claim attempt and immutable envelope body.
 const claimed=new Map();
 return Object.freeze({
  async claim(envelope){
   if(!good(envelope))throw Error("RC28_EVENT_ENVELOPE_INVALID");
   const receipt=unwrap(await callRpc("qf_record_vendor_package_razorpay_event_v2",{
    p_event_id:envelope.eventId,p_provider_mode:envelope.providerMode,
    p_body_sha256:envelope.bodySha256,p_event_type:envelope.eventType,
    p_payment_id:envelope.paymentId,p_provider_order_id:envelope.providerOrderId
   }));
   const inspected=inspectProviderEventClaim(receipt,envelope);
   if(inspected.state==="invalid")throw Error("RC28_EVENT_CLAIM_RECEIPT_INVALID");
   if(inspected.state==="claimed")
    claimed.set(key(envelope),Object.freeze({attempt:inspected.attempt,body:envelope.bodySha256}));
   return receipt;
  },
  async complete(envelope,expected){
   if(!good(envelope)||!expected||typeof expected!=="object")
    throw Error("RC28_EVENT_COMPLETION_INPUT_INVALID");
   const lock=claimed.get(key(envelope));
   if(!lock||lock.body!==envelope.bodySha256)
    throw Error("RC28_EVENT_LEASE_NOT_CLAIMED");
   // An aborted RPC leaves this entry present, but retries after unknown
   // commit MUST be reconciled through PostgreSQL and never acknowledged here.
   const receipt=unwrap(await callRpc("qf_complete_vendor_package_razorpay_event_v2",{
    p_event_id:envelope.eventId,p_provider_mode:envelope.providerMode,
    p_body_sha256:envelope.bodySha256,p_attempt_count:lock.attempt,
    p_disposition:expected.disposition,
    p_outcome:expected.outcome??null,p_error_code:expected.errorCode??null
   }));
   if(!inspectProviderEventCompletion(receipt,envelope,expected))
    throw Error("RC28_EVENT_COMPLETION_RECEIPT_INVALID");
   claimed.delete(key(envelope));
   return receipt;
  }
 });
}
