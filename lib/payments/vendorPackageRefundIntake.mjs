// RC35 Finance: refund webhook INTAKE classification only. After HMAC
// verification a refund event is recorded durably as quarantined
// (REFUND_REVIEW_REQUIRED) and acknowledged. It never calls Core, never reads
// provider truth, never mutates credits and never issues or revokes money.
const obj=x=>x!==null&&typeof x==="object"&&!Array.isArray(x);
const PAY=/^pay_[A-Za-z0-9]{4,64}$/;
const ORDER=/^order_[A-Za-z0-9]{4,64}$/;
const REFUND=/^rfnd_[A-Za-z0-9]{4,64}$/;
export const REFUND_INTAKE_EVENTS=Object.freeze(["refund.created","refund.processed","refund.failed"]);
export const REFUND_REVIEW_REQUIRED_CODE="REFUND_REVIEW_REQUIRED";
export const isRefundIntakeEventType=t=>typeof t==="string"&&REFUND_INTAKE_EVENTS.includes(t);

/** Pure structural fence; "none" means the event is not a refund event. */
export function classifyVendorPackageRefundIntake(event){
 if(!obj(event)||!isRefundIntakeEventType(event.event))return Object.freeze({kind:"none"});
 const refund=event.payload?.refund?.entity,payment=event.payload?.payment?.entity;
 if(!obj(refund)||typeof refund.id!=="string"||!REFUND.test(refund.id)||
    typeof refund.payment_id!=="string"||!PAY.test(refund.payment_id)||
    !obj(payment)||payment.id!==refund.payment_id||
    typeof payment.order_id!=="string"||!ORDER.test(payment.order_id))
  return Object.freeze({kind:"invalid",reason:"WEBHOOK_REFUND_IDENTITY_INVALID"});
 return Object.freeze({kind:"refund",eventName:event.event,refundId:refund.id,
  paymentId:refund.payment_id,providerOrderId:payment.order_id});
}
