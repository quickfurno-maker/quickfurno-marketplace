// RC38 Finance: REVIEW-ONLY refund identity binding (ledger addendum v4).
// The webhook route has already verified the Razorpay HMAC and built the
// envelope. This module seals {event, body hash, refund id, payment id, order}
// with an application-held HMAC-SHA256 key and persists it through an injected
// bind RPC. The key never reaches PostgreSQL; PostgreSQL enforces uniqueness,
// immutability and one-payment-per-refund under a lock. No credit/refund/provider
// effect exists here.
import {createHmac,timingSafeEqual} from "node:crypto";
const obj=x=>x!==null&&typeof x==="object"&&!Array.isArray(x);
const EVENT_ID=/^[A-Za-z0-9_-]{8,64}$/;
const SHA256=/^[a-f0-9]{64}$/;
const PAY=/^pay_[A-Za-z0-9]{4,64}$/;
const ORDER=/^order_[A-Za-z0-9]{4,64}$/;
const REFUND=/^rfnd_[A-Za-z0-9]{4,64}$/;
const KEY_ID=/^[A-Za-z0-9_-]{1,32}$/;
const EVENTS=Object.freeze(["refund.created","refund.processed","refund.failed"]);
const DOMAIN="qf-vox-refund-identity-v4";
const fail=(reason,retrySafe=false)=>Object.freeze({ok:false,reason,retrySafe,
 creditMutation:false,refundAllowed:false});

const keyBytes=k=>{
 const b=typeof k==="string"?Buffer.from(k,"utf8"):Buffer.isBuffer(k)?k:null;
 return b&&b.length>=32?b:null;
};
const wellFormed=f=>obj(f)&&EVENT_ID.test(f.eventId)&&SHA256.test(f.bodySha256)&&
 (f.providerMode==="test"||f.providerMode==="live")&&EVENTS.includes(f.eventType)&&
 REFUND.test(f.refundId)&&PAY.test(f.paymentId)&&ORDER.test(f.providerOrderId);

/** Length-prefixed canonical form: no field can bleed into another. */
export function canonicalRefundIdentity(f){
 if(!wellFormed(f))return null;
 return [DOMAIN,f.providerMode,f.eventId,f.bodySha256,f.eventType,f.refundId,f.paymentId,f.providerOrderId]
  .map(s=>s.length+":"+s).join("|");
}

export function computeRefundIdentityMac(fields,key){
 const k=keyBytes(key),c=canonicalRefundIdentity(fields);
 if(!k||c===null)return null;
 return createHmac("sha256",k).update(c,"utf8").digest("hex");
}

export function verifyRefundIdentityMac(fields,mac,key){
 const want=computeRefundIdentityMac(fields,key);
 if(want===null||typeof mac!=="string"||!SHA256.test(mac))return false;
 return timingSafeEqual(Buffer.from(want,"hex"),Buffer.from(mac,"hex"));
}

const fieldsOf=envelope=>({eventId:envelope.eventId,bodySha256:envelope.bodySha256,
 providerMode:envelope.providerMode,eventType:envelope.eventType,refundId:envelope.refundId,
 paymentId:envelope.paymentId,providerOrderId:envelope.providerOrderId});

/**
 * Re-verify a durable row (as returned by qf_get_..._identity_v4 or any v4
 * receipt that carries the full identity) against the key. Detects tampering
 * with ANY bound field or the MAC itself.
 */
export function verifyDurableRefundIdentity(row,key){
 if(!obj(row))return false;
 return verifyRefundIdentityMac({eventId:row.event_id,bodySha256:row.body_sha256,
  providerMode:row.provider_mode,eventType:row.event_type,refundId:row.refund_id,
  paymentId:row.payment_id,providerOrderId:row.provider_order_id},row.identity_mac,key);
}

/**
 * options: {macKey (>=32 bytes), keyId}. bind(envelope) accepts only envelopes
 * built from an HMAC-verified refund webhook (envelope.refundId present).
 */
export function createRefundIdentityBinder(callRpc,options={}){
 if(typeof callRpc!=="function")throw TypeError("REFUND_IDENTITY_RPC_REQUIRED");
 const {macKey,keyId}=options??{};
 if(!keyBytes(macKey))throw TypeError("REFUND_IDENTITY_MAC_KEY_INVALID");
 if(typeof keyId!=="string"||!KEY_ID.test(keyId))throw TypeError("REFUND_IDENTITY_KEY_ID_INVALID");
 return Object.freeze({
  async bind(envelope){
   if(!obj(envelope)||envelope.ok!==true||!wellFormed(fieldsOf(envelope)))
    return fail("REFUND_IDENTITY_ENVELOPE_INVALID");
   const mac=computeRefundIdentityMac(fieldsOf(envelope),macKey);
   let response;
   try{
    response=await callRpc("qf_bind_vendor_package_refund_identity_v4",{
     p_event_id:envelope.eventId,p_provider_mode:envelope.providerMode,
     p_body_sha256:envelope.bodySha256,p_refund_id:envelope.refundId,
     p_payment_id:envelope.paymentId,p_identity_mac:mac,p_mac_key_id:keyId});
   }catch{return fail("REFUND_IDENTITY_UNCONFIRMED",true)}
   const r=response&&!response.error?response.data:null;
   if(!obj(r)||r.event_id!==envelope.eventId||r.provider_mode!==envelope.providerMode)
    return fail(response?.error?"REFUND_IDENTITY_REJECTED":"REFUND_IDENTITY_UNCONFIRMED",!response?.error);
   if(r.status==="identity_conflict")return fail("REFUND_IDENTITY_CONFLICT");
   if(r.status!=="bound"||r.refund_id!==envelope.refundId||r.payment_id!==envelope.paymentId||
      r.identity_mac!==mac||r.mac_key_id!==keyId)return fail("REFUND_IDENTITY_RECEIPT_INVALID");
   return Object.freeze({ok:true,reason:"REFUND_IDENTITY_BOUND",refundId:envelope.refundId,
    paymentId:envelope.paymentId,creditMutation:false,refundAllowed:false});
  }
 });
}
