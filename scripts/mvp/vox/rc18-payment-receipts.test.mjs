import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {resolve,dirname} from "node:path";
import {fileURLToPath} from "node:url";
import {inspectRazorpayActivationReceipt,inspectRazorpayFailureReceipt} from "../../../lib/payments/vendorPackagePaymentReceipts.mjs";
const id=n=>"00000000-0000-4000-8000-"+String(n).padStart(12,"0");
const orderId=id(4),packageId=id(7),expected={orderId,creditsIncluded:10};
const success={status:"applied",order_id:orderId,credits_added:10,vendor_package_id:packageId,expires_at:"2026-12-01T00:00:00.000Z"};
test("activation proof binds order, amount, vendor package, expiry",()=>{
 assert.equal(inspectRazorpayActivationReceipt(success,expected),"applied");
 for(const bad of [
  null,{},[],{...success,order_id:id(1)},{...success,credits_added:0},
  {...success,credits_added:"10"},{...success,vendor_package_id:""},
  {...success,expires_at:"invalid"},{...success,status:"captured"},
  {...success,status:"already_applied",credits_added:10}
 ])assert.equal(inspectRazorpayActivationReceipt(bad,expected),"invalid");
 assert.equal(inspectRazorpayActivationReceipt({status:"already_applied",order_id:orderId,credits_added:0},expected),"already_applied");
});
test("ignored callbacks cannot be reported as failed",()=>{
 for(const status of ["ignored_paid","ignored_refunded","ignored_activated","ignored_closed"])
  assert.equal(inspectRazorpayFailureReceipt({status,order_id:orderId},orderId),"ignored");
 assert.equal(inspectRazorpayFailureReceipt({status:"marked_failed",order_id:orderId},orderId),"marked_failed");
 for(const bad of [null,{},[],{status:"marked_failed",order_id:id(12)},
  {status:"invented",order_id:orderId},{status:"marked_failed"}])
  assert.equal(inspectRazorpayFailureReceipt(bad,orderId),"invalid");
});
test("Core uses receipt validation for both checkout and webhook",()=>{
 const root=resolve(dirname(fileURLToPath(import.meta.url)),"../../..");
 const source=readFileSync(resolve(root,"services/vendorPackagePaymentService.ts"),"utf8");
 assert.match(source,/inspectRazorpayActivationReceipt\(data, \{/);
 assert.match(source,/inspectRazorpayFailureReceipt\(data, order\.id\)/);
 assert.match(source,/PAYMENT_ACTIVATION_RECEIPT_INVALID/);
 assert.match(source,/PAYMENT_FAILURE_RECEIPT_INVALID/);
 assert.match(source,/activation === "already_applied" \? "already_activated" : "activated"/);
 assert.match(source,/recorded === "marked_failed" \? "failed_recorded" : "failure_ignored"/);
 assert.equal((source.match(/activateCapturedPayment\(order, /g)||[]).length,2);
});
