// Pure guards for the transactional responses of the payment authority.
// A provider capture and a successful DB commit are two distinct facts.
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const obj=x=>x&&typeof x==="object"&&!Array.isArray(x);
export function inspectRazorpayActivationReceipt(receipt,expected){
 if(!obj(receipt)||!obj(expected)||!UUID.test(expected.orderId)||
    !Number.isSafeInteger(expected.creditsIncluded)||expected.creditsIncluded<=0||
    receipt.order_id!==expected.orderId)return "invalid";
 if(receipt.status==="already_applied")
   return receipt.credits_added===0?"already_applied":"invalid";
 if(receipt.status!=="applied"||receipt.credits_added!==expected.creditsIncluded||
    typeof receipt.vendor_package_id!=="string"||!UUID.test(receipt.vendor_package_id)||
    typeof receipt.expires_at!=="string"||!Number.isFinite(Date.parse(receipt.expires_at)))
   return "invalid";
 return "applied";
}
export function inspectRazorpayFailureReceipt(receipt,orderId){
 if(!obj(receipt)||!UUID.test(orderId)||receipt.order_id!==orderId)return "invalid";
 if(receipt.status==="marked_failed")return "marked_failed";
 if(receipt.status==="ignored_paid"||receipt.status==="ignored_refunded"||
    receipt.status==="ignored_activated")return "ignored";
 return "invalid";
}
