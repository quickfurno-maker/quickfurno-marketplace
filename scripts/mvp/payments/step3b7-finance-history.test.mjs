import test from "node:test";
import assert from "node:assert/strict";
import {buildFinanceHistoryPreview as view} from "../../../lib/payments/step3b7FinanceHistoryPreview.mjs";
import {normalizeManualBankReference} from "../../../lib/payments/financeV2ManualReference.mjs";
const id=n=>"00000000-0000-4000-8000-"+String(n).padStart(12,"0");
const now=Date.parse("2026-10-23T08:00:00Z");
function fixture(){const user=id(1),vendor=id(2),team=id(3),city=id(4);
 const scope={userId:user,teamId:team,cityId:city,role:"vendor_success_agent",
 vendorIds:[vendor],verifiedDepartments:["vendor_success"],canReadContent:true};
 const grant={id:id(5),staff_user_id:user,team_id:team,city_id:city,
  vendor_id:vendor,requested_by:id(6),approved_by:id(7),
  approval_reference:id(8),expires_at:"2026-10-24T00:00:00Z"};
 const ctx={providerMode:"test",merchantAccountId:"merchant_test_synthetic",orderId:"order_test_synthetic"};
 const e=(n,kind,when,amount)=>({eventId:"evt_synthetic_"+n,kind,occurredAt:when,
  amountSubunits:amount,reference:kind+"_"+n,
  providerMode:ctx.providerMode,merchantAccountId:ctx.merchantAccountId,
  orderId:ctx.orderId,vendorId:vendor});
 return {scope,grant,revoked:false,vendorId:vendor,now,...ctx,
 events:[e(3,"capture","2026-10-23T07:00:00Z",10000),
         e(1,"order","2026-10-23T05:00:00Z",10000),
         e(2,"attempt","2026-10-23T06:00:00Z",10000),
         e(4,"refund","2026-10-23T07:30:00Z",1500)]};
}
test("Finance history uses existing Core Staff read-grant intersection and chronological immutable metadata",()=>{
 const v=view(fixture()); assert.deepEqual(v.entries.map(x=>x.kind),["order","attempt","capture","refund"]);
 assert.equal(v.entries[0].mode,"test");assert.equal(Object.isFrozen(v.entries[0]),true);
 assert.equal(v.paymentAuthorized,false);assert.equal(v.refundAuthorized,false);
 assert.equal(v.walletCreditAuthorized,false);assert.equal(v.bankSettlementVerified,false);
 assert.equal(v.actualProviderTestCertified,false);
});
test("Finance blocks revoked, cross-vendor, cross-team, expired, wrong department and self-granted access",()=>{
 const base=fixture();for(const p of [{revoked:true},{vendorId:id(20)},
  {scope:{...base.scope,teamId:id(12)}},{now:Date.parse("2026-10-25T00:00:00Z")},
  {scope:{...base.scope,verifiedDepartments:[]}},
  {grant:{...base.grant,requested_by:base.scope.userId}}]){
  assert.throws(()=>view({...base,...p}),/SCOPE_DENIED/);
 }
});
test("Finance rejects duplicate event identifiers, swapped mode/order/merchant and hidden payload",()=>{
 const b=fixture();
 for(const events of [
  [...b.events,b.events[0]],
  b.events.map((x,i)=>i===1?{...x,providerMode:"live"}:x),
  b.events.map((x,i)=>i===1?{...x,orderId:"cross_order"}:x),
  b.events.map((x,i)=>i===1?{...x,merchantAccountId:"other_merchant"}:x),
  b.events.map((x,i)=>i===1?{...x,rawBody:"secret"}:x)
 ])assert.throws(()=>view({...b,events}),/ISOLATION_DENIED/);
});
test("Finance rejects forged amount, unknown timeline action and unscoped staff",()=>{
 const b=fixture();for(const patch of [{kind:"wallet_write"},{amountSubunits:-1},{occurredAt:"never"}]){
 assert.throws(()=>view({...b,events:[{...b.events[0],...patch}]}),/EVENT_INVALID/);
 }
});
test("Finance UTR normalization remains bank-reference only, not verified settlement",()=>{
 const x=normalizeManualBankReference("upi"," abc123xy ");
 assert.equal(x.reference,"ABC123XY");assert.equal(x.needsBankStatementVerification,true);
 assert.throws(()=>normalizeManualBankReference("razorpay","abc123xy"),/RAIL_INVALID/);
});
