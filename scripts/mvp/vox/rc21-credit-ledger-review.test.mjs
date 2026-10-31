import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {resolve,dirname} from "node:path";
import {fileURLToPath} from "node:url";
import {reviewVendorPackageCreditLedger} from "../../../lib/payments/vendorPackageCreditLedgerReview.mjs";
const orderId="00000000-0000-4000-8000-000000000011";
const vendorId="00000000-0000-4000-8000-000000000012";
const lead=(n)=>"00000000-0000-4000-8000-"+String(n).padStart(12,"0");
const base={orderId,vendorId,creditsGranted:4,creditsRemaining:4,ledgerDebits:[]};
const debit=n=>({orderId,vendorId,leadId:lead(n),credits:1});
test("unconsumed, correlated ledger allows independent review but no refund or credit reversal",()=>{
 const r=reviewVendorPackageCreditLedger(base);
 assert.equal(r.ok,true);
 assert.equal(r.reversibleCreditsForHumanReview,4);
 assert.equal(r.refundAllowed,false);
 assert.equal(r.creditRevocationAllowed,false);
 assert.equal(r.requiresHumanReview,true);
});
test("exact one lead = one consumed credit, then human policy still required",()=>{
 for(const count of [1,2,4]){
  const r=reviewVendorPackageCreditLedger({...base,creditsRemaining:4-count,
    ledgerDebits:Array.from({length:count},(_,i)=>debit(i+1))});
  assert.equal(r.ok,false);
  assert.equal(r.reason,"CREDIT_LEDGER_CONSUMED_REQUIRES_POLICY");
  assert.equal(r.refundAllowed,false);
 }
});
test("duplicate charge for a lead and mismatched vendor/order or consumption deny",()=>{
 const bad=[
  {...base,creditsRemaining:2,ledgerDebits:[debit(1),debit(1)]},
  {...base,creditsRemaining:3,ledgerDebits:[debit(1),debit(2)]},
  {...base,creditsRemaining:3,ledgerDebits:[{...debit(1),vendorId:lead(15)}]},
  {...base,creditsRemaining:3,ledgerDebits:[{...debit(1),orderId:lead(15)}]},
  {...base,creditsRemaining:3,ledgerDebits:[{...debit(1),credits:2}]},
  {...base,creditsRemaining:3,ledgerDebits:[{...debit(1),leadId:"INVALID"}]},
  {...base,creditsRemaining:3,ledgerDebits:[{...debit(1),extra:true}]},
  {...base,creditsGranted:4,creditsRemaining:5},
  {...base,creditsGranted:4.5},
  {...base,ledgerDebits:Array.from({length:10001},()=>debit(1))},
  {...base,unknown:"proof"},null,[],{}
 ];
 for(const value of bad){
  const result=reviewVendorPackageCreditLedger(value);
  assert.equal(result.ok,false,JSON.stringify(value)?.slice(0,100));
  assert.equal(result.refundAllowed,false);
  assert.equal(result.creditRevocationAllowed,false);
 }
});
test("review helper has no provider/network/SQL/write authority",()=>{
 const src=readFileSync(resolve(dirname(fileURLToPath(import.meta.url)),
   "../../../lib/payments/vendorPackageCreditLedgerReview.mjs"),"utf8");
 assert.doesNotMatch(src,/\bfetch\s*\(|\.rpc\(|\.insert\(|\.update\(|createRefund\(|executeRefund\(/);
 assert.match(src,/refundAllowed:false/);
 assert.match(src,/creditRevocationAllowed:false/);
});
