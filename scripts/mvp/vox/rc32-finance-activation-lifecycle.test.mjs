import test from "node:test";
import assert from "node:assert/strict";
import {activationLifecycleError} from "../../../lib/payments/vendorPackageOrderGuards.mjs";
import {classifyVendorPackageWebhookFailure} from "../../../lib/payments/vendorPackageProviderEventLedger.mjs";
const PAY="pay_ABCD1234";
const base={order_status:"created",activation_status:"not_activated",payment_status:"pending",provider_payment_id:null};
const activated={order_status:"completed",activation_status:"activated",payment_status:"paid",provider_payment_id:PAY};

test("payable unactivated orders and exact activated replay may reach Core",()=>{
 for(const ps of ["not_started","pending","failed"])
  assert.equal(activationLifecycleError({...base,payment_status:ps},PAY),null);
 assert.equal(activationLifecycleError(activated,PAY),null);
});
test("refund lifecycles are locked in every activation state",()=>{
 for(const row of [
  {...base,payment_status:"refund_pending"},{...base,payment_status:"refunded"},
  {...activated,payment_status:"refunded"},{...activated,payment_status:"refund_pending"},
  {...base,order_status:"refunded"},{...activated,order_status:"refunded"},
 ])assert.equal(activationLifecycleError(row,PAY),"PACKAGE_ORDER_REFUND_LOCKED");
});
test("closed, unknown, malformed or other-payment states fail closed",()=>{
 for(const row of [
  null,[],"x",{},{...base,order_status:"cancelled"},{...base,order_status:"expired"},
  {...base,payment_status:"paid"},{...base,payment_status:"cancelled"},{...base,activation_status:"unknown"},
  {...base,activation_status:null},{...activated,provider_payment_id:"pay_OTHER9999"},
  {...activated,provider_payment_id:null},{...activated,order_status:"created"},
  {...activated,payment_status:"pending"},
 ])assert.equal(activationLifecycleError(row,PAY),"PACKAGE_ORDER_LIFECYCLE_NOT_ACTIVATABLE");
 assert.equal(activationLifecycleError(activated,undefined),"PACKAGE_ORDER_LIFECYCLE_NOT_ACTIVATABLE");
});
test("lifecycle codes are quarantined, not retried forever",()=>{
 for(const code of ["PACKAGE_ORDER_REFUND_LOCKED","PACKAGE_ORDER_LIFECYCLE_NOT_ACTIVATABLE"])
  assert.equal(classifyVendorPackageWebhookFailure(code),"quarantine");
});
