// Finance: pure structural fence, after HMAC verification and before any Core
// order lookup, provider GET, payment activation or failure RPC.
// This does NOT authorize money movement; provider truth is fetched separately.
const obj=x=>x!==null&&typeof x==="object"&&!Array.isArray(x);
const REF=/^(?:pay|order)_[A-Za-z0-9]{4,64}$/;
export function classifyVendorPackageWebhookEvent(event){
 if(!obj(event)||typeof event.event!=="string")
  return Object.freeze({kind:"invalid",reason:"WEBHOOK_EVENT_INVALID"});
 if(event.event!=="payment.captured"&&event.event!=="payment.failed")
  return Object.freeze({kind:"ignored",reason:"WEBHOOK_EVENT_OUT_OF_SCOPE"});
 const entity=event.payload?.payment?.entity;
 const linkedOrder=event.payload?.order?.entity?.id;
 if(!obj(entity)||typeof entity.id!=="string"||!REF.test(entity.id)||
   !entity.id.startsWith("pay_")||
   typeof entity.order_id!=="string"||!REF.test(entity.order_id)||
   !entity.order_id.startsWith("order_")||
   (linkedOrder!==undefined&&linkedOrder!==entity.order_id))
  return Object.freeze({kind:"invalid",reason:"WEBHOOK_PAYMENT_IDENTITY_DRIFT"});
 return Object.freeze({kind:event.event==="payment.captured"?"captured":"failed",
  paymentId:entity.id,providerOrderId:entity.order_id});
}
