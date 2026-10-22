import test from "node:test";import assert from "node:assert/strict";
import {createHmac,createHash} from "node:crypto";
import {prepareVerifiedRazorpayFinanceEvent as prep}
 from "../../../lib/payments/financeV2ProviderEvent.mjs";
const secret="sandbox-only-never-real";
const raw=JSON.stringify({event:"payment.captured",payload:{payment:{entity:{id:"pay_x",order_id:"order_x"}}}});
const signed=createHmac("sha256",secret).update(raw).digest("hex");
const input=()=>({rawBody:raw,signature:signed,webhookSecret:secret,
 eventId:"evt_synthetic_1",providerMode:"test",merchantAccountId:"sandbox-merchant"});
test("PAY2 immutable verified event receipt keeps only whitelist metadata, never raw secrets",()=>{
 const x=prep(input());
 assert.equal(x.event_type,"payment.captured");
 assert.equal(x.payload_sha256,createHash("sha256").update(raw).digest("hex"));
 assert.equal(x.signature_verified,true);assert.equal(Object.isFrozen(x),true);
 assert.equal(JSON.stringify(x).includes("pay_x"),false);
 assert.equal(JSON.stringify(x).includes(secret),false);
});
test("PAY2 rejects tampered body and missing event header, before any DB write",()=>{
 assert.throws(()=>prep({...input(),rawBody:raw+"x"}),/SIGNATURE_INVALID/);
 assert.throws(()=>prep({...input(),eventId:""}),/ID_INVALID/);
 assert.throws(()=>prep({...input(),providerMode:"wrong"}),/CONTEXT_MISSING/);
});
test("PAY2 allows authenticated refund event shape without executing a refund",()=>{
 const refund=JSON.stringify({event:"refund.processed"});
 const x=prep({...input(),rawBody:refund,signature:createHmac("sha256",secret).update(refund).digest("hex"),eventId:"evt_refund_1"});
 assert.equal(x.event_type,"refund.processed");
 assert.deepEqual(Object.keys(x).sort(),["provider","provider_mode","merchant_account_id","provider_event_id","event_type","payload_sha256","signature_verified"].sort());
});
