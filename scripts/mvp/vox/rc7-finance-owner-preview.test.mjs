import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {resolve,dirname} from "node:path";
import {fileURLToPath} from "node:url";
import {projectRc7OwnerFinanceOrders} from "../../../contracts/vox/rc7FinanceReadModel.mjs";
const root=resolve(dirname(fileURLToPath(import.meta.url)),"../../..");
const route=readFileSync(resolve(root,"app/api/vox/v1/finance/route.ts"),"utf8");
const id="11111111-1111-4111-8111-111111111111";
const vendor="22222222-2222-4222-8222-222222222222";
const row={id,vendor_id:vendor,package_price:"7999.00",package_currency:"INR",
 credits_included:5,order_status:"completed",payment_status:"paid",
 activation_status:"activated",created_at:"2026-10-30T09:00:00Z",
 provider_payment_id:"pay_secret",provider_order_id:"order_secret",phone:"9898989898"};
test("bounded Owner-only Finance projection never exposes provider IDs or PII",()=>{
 const result=projectRc7OwnerFinanceOrders([row]);
 assert.equal(result.length,1);assert.equal(result[0].orderId,id);
 assert.equal(result[0].recordedOrderAmount,7999);
 assert.equal(result[0].vendorRef,"VENDOR-22222222");
 const text=JSON.stringify(result);
 for(const forbidden of ["pay_secret","order_secret","9898989898","provider","phone"])
  assert.equal(text.includes(forbidden),false,forbidden);
});
test("unclean financial state, unsupported currency or excessive count fail closed",()=>{
 for(const key of ["id","vendor_id","package_currency","payment_status","activation_status","order_status","created_at"]){
  assert.equal(projectRc7OwnerFinanceOrders([{...row,[key]:"invalid"}]),null,key);
 }
 for(const price of ["NaN","Infinity","-1","12.123","1e9",Number.POSITIVE_INFINITY]){
  assert.equal(projectRc7OwnerFinanceOrders([{...row,package_price:price}]),null,String(price));
 }
 assert.equal(projectRc7OwnerFinanceOrders(Array(22).fill(row)),null);
});
test("null or zero recorded price is not a fabricated paid amount",()=>{
 assert.equal(projectRc7OwnerFinanceOrders([{...row,package_price:null}])[0].recordedOrderAmount,null);
 assert.equal(projectRc7OwnerFinanceOrders([{...row,package_price:"0.00"}])[0].recordedOrderAmount,0);
});
test("source route is gated, Owner AAL2 revalidated and read-only",()=>{
 for(const gate of ["VOX_FINANCE_READ_ENABLED","VOX_STAFF_READ_ENABLED","VOX_STAFF_GRANTS_ENABLED"])
  assert.ok(route.includes('process.env.'+gate+'!=="staging"'),gate);
 assert.match(route,/verifyVoxOwnerBearer/);
 assert.equal((route.match(/await verifyVoxOwnerBearer/g)||[]).length,2);
 assert.match(route,/no-store/);assert.match(route,/vary":"Authorization"/);
 assert.match(route,/\.limit\(21\)/);assert.match(route,/data\.length>20/);
 assert.match(route,/canRefund:false/);assert.match(route,/hasProviderConfirmation:false/);
 assert.doesNotMatch(route,/\.insert\(|\.update\(|\.delete\(|\.rpc\(|razorpayFetch|RAZORPAY_LIVE/);
 for(const method of ["POST","PUT","PATCH","DELETE"])
  assert.ok(route.includes('function '+method+'()'));
});
