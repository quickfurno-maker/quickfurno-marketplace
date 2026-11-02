import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {resolve,dirname} from "node:path";
import {fileURLToPath} from "node:url";
import {classifyVendorPackageWebhookEvent as classify} from "../../../lib/payments/vendorPackageWebhookBoundary.mjs";
const payment={id:"pay_TEST01234567",order_id:"order_TEST01234567"};
const envelope=event=>({event,payload:{payment:{entity:payment},order:{entity:{id:payment.order_id}}}});
const root=resolve(dirname(fileURLToPath(import.meta.url)),"../../..");
test("known signed events resolve exact correlated provider identifiers",()=>{
 for(const [event,kind] of [["payment.captured","captured"],["payment.failed","failed"]]){
  const r=classify(envelope(event));
  assert.equal(r.kind,kind);
  assert.equal(r.paymentId,payment.id);
  assert.equal(r.providerOrderId,payment.order_id);
 }
});
test("unknown event types are ignored before order lookup",()=>{
 for(const input of [{event:"refund.processed"}, {event:"payment.authorized"},{event:"order.paid"}, {event:"refund.processed",payload:{payment:{entity:{id:"bogus"}}}}])
  assert.equal(classify(input).kind,"ignored");
});
test("malformed or order-drift captured/failed events deny before Core",()=>{
 const invalid=[null,[],{}, {event:7}, {event:"payment.captured"},
  {...envelope("payment.failed"),payload:{payment:{entity:{...payment,id:"custom"}}}},
  {...envelope("payment.captured"),payload:{payment:{entity:{...payment,order_id:"bad"}}}},
  {...envelope("payment.captured"),payload:{...envelope("payment.captured").payload,order:{entity:{id:"order_WRONG1234"}}}},
  {...envelope("payment.failed"),payload:{payment:{entity:{...payment,id:"pay_"}}}},
 ];
 for(const v of invalid)assert.equal(classify(v).kind,"invalid",JSON.stringify(v));
});
test("after HMAC, Core must classify before any order lookup or provider fetch",()=>{
 const s=readFileSync(resolve(root,"services/vendorPackagePaymentService.ts"),"utf8");
 const fn=s.slice(s.indexOf("export async function handleVendorPackageRazorpayWebhook("));
 const signature=fn.indexOf("verifyWebhookSignature(");
 const guard=fn.indexOf("classifyVendorPackageWebhookEvent(event)");
 const lookup=fn.indexOf("loadOrderByProviderOrderId(candidate.providerOrderId)");
 const fetch=fn.indexOf('"/payments/" + encodeURIComponent(candidate.paymentId)');
 assert.ok(signature>=0&&guard>signature&&lookup>guard&&fetch>lookup);
 assert.match(fn,/RAZORPAY_WEBHOOK_IDENTITY_INVALID/);
 assert.match(fn,/candidate.kind === "ignored"\) return ok\(\{ status: "ignored" \}\)/);
});
