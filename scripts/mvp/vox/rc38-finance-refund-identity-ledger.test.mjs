import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync,readdirSync,existsSync} from "node:fs";
import {resolve,dirname} from "node:path";
import {fileURLToPath} from "node:url";
import {buildRazorpayProviderEventEnvelope} from "../../../lib/payments/vendorPackageProviderEventLedger.mjs";
import {canonicalRefundIdentity,computeRefundIdentityMac,verifyRefundIdentityMac,
 verifyDurableRefundIdentity,createRefundIdentityBinder} from "../../../lib/payments/vendorPackageRefundIdentityBinding.mjs";
import {createRefundIntakeReviewer} from "../../../lib/payments/vendorPackageRefundIntakeReview.mjs";
import {FINANCE_REFUND_REVIEW_ROLES} from "../../../lib/payments/vendorPackageRefundReviewAuthority.mjs";
const root=resolve(dirname(fileURLToPath(import.meta.url)),"../../..");
const KEY="rc38-unit-hmac-key-0123456789abcdef!!";
const U="11111111-1111-4111-8111-111111111111";
const d="escalated_for_policy_decision";
const mk=(o={})=>buildRazorpayProviderEventEnvelope({eventId:o.eventId??"evt_RC38UNIT0001",providerMode:o.mode??"test",
 bodySha256:"a".repeat(64),candidate:{kind:"refund",eventName:o.type??"refund.processed",
 refundId:o.refundId??"rfnd_RC38UNIT01",paymentId:o.paymentId??"pay_RC38UNIT01",providerOrderId:o.orderId??"order_RC38UNIT01"}});
const fields=e=>({eventId:e.eventId,bodySha256:e.bodySha256,providerMode:e.providerMode,eventType:e.eventType,
 refundId:e.refundId,paymentId:e.paymentId,providerOrderId:e.providerOrderId});

test("MAC covers every bound field, is key-bound and rejects short keys/malformed input",()=>{
 const e=mk(),mac=computeRefundIdentityMac(fields(e),KEY);
 assert.match(mac,/^[a-f0-9]{64}$/);
 assert.equal(verifyRefundIdentityMac(fields(e),mac,KEY),true);
 for(const [k,v] of Object.entries({eventId:"evt_RC38UNIT0002",bodySha256:"b".repeat(64),providerMode:"live",
  eventType:"refund.failed",refundId:"rfnd_RC38UNIT02",paymentId:"pay_RC38UNIT02",providerOrderId:"order_RC38UNIT02"}))
  assert.equal(verifyRefundIdentityMac({...fields(e),[k]:v},mac,KEY),false,k);
 assert.equal(verifyRefundIdentityMac(fields(e),mac,KEY+"x"),false);
 assert.equal(computeRefundIdentityMac(fields(e),"short"),null);
 assert.equal(computeRefundIdentityMac({...fields(e),refundId:"rfnd_"},KEY),null);
 assert.equal(canonicalRefundIdentity({...fields(e),eventType:"payment.captured"}),null);
 assert.equal(verifyRefundIdentityMac(fields(e),mac.toUpperCase(),KEY),false);
 assert.equal(verifyRefundIdentityMac(fields(e),null,KEY),false);
 // Domain separation / length prefixes: shifting a boundary changes the MAC.
 assert.notEqual(canonicalRefundIdentity(fields(e)),canonicalRefundIdentity({...fields(e),refundId:"rfnd_RC38UNIT0"+"1"}).replace("rfnd","rfnx"));
});
test("binder: fixed RPC, key never sent, receipts must echo the exact identity and MAC",async()=>{
 const e=mk(),mac=computeRefundIdentityMac(fields(e),KEY),seen=[];
 const good=a=>({event_id:a.p_event_id,provider_mode:a.p_provider_mode,status:"bound",refund_id:a.p_refund_id,
  payment_id:a.p_payment_id,identity_mac:a.p_identity_mac,mac_key_id:a.p_mac_key_id});
 const run=async(patch,fn=good)=>createRefundIdentityBinder(async(n,a)=>{seen.push({n,a});
  const r=fn(a);return patch===null?{data:null,error:{message:"x"}}:{data:{...r,...patch}}},{macKey:KEY,keyId:"k1"}).bind(e);
 const ok=await run({});
 assert.equal(ok.ok,true);assert.equal(ok.refundAllowed,false);assert.equal(ok.creditMutation,false);
 assert.equal(seen[0].n,"qf_bind_vendor_package_refund_identity_v4");assert.equal(seen[0].a.p_identity_mac,mac);
 assert.equal(JSON.stringify(seen[0].a).includes(KEY),false);
 assert.deepEqual(Object.keys(seen[0].a).sort(),["p_body_sha256","p_event_id","p_identity_mac","p_mac_key_id","p_payment_id","p_provider_mode","p_refund_id"]);
 assert.equal((await run({status:"identity_conflict"})).reason,"REFUND_IDENTITY_CONFLICT");
 for(const bad of [{refund_id:"rfnd_OTHER12345"},{payment_id:"pay_OTHER12345"},{identity_mac:"c".repeat(64)},{mac_key_id:"k2"},{status:"x"},{event_id:"evt_OTHER12345"}])
  assert.match((await run(bad)).reason,/REFUND_IDENTITY_(RECEIPT_INVALID|UNCONFIRMED)/,JSON.stringify(bad));
 assert.equal((await run(null)).reason,"REFUND_IDENTITY_REJECTED");
 const thrown=await createRefundIdentityBinder(async()=>{throw Error("net")},{macKey:KEY,keyId:"k1"}).bind(e);
 assert.equal(thrown.reason,"REFUND_IDENTITY_UNCONFIRMED");assert.equal(thrown.retrySafe,true);
 for(const bad of [{...e,ok:false},{...e,refundId:undefined},{...e,eventType:"payment.captured"},null])
  assert.equal((await createRefundIdentityBinder(async()=>assert.fail("no rpc"),{macKey:KEY,keyId:"k1"}).bind(bad)).reason,"REFUND_IDENTITY_ENVELOPE_INVALID");
 assert.throws(()=>createRefundIdentityBinder(async()=>{},{macKey:"short",keyId:"k1"}));
 assert.throws(()=>createRefundIdentityBinder(async()=>{},{macKey:KEY,keyId:"bad id"}));
 assert.throws(()=>createRefundIdentityBinder(null,{macKey:KEY,keyId:"k1"}));
});
// In-memory model of the v4 SQL contract used only to drive the adapter.
const model=(tamper={})=>{
 const e=mk(),calls=[];
 const row={event_id:e.eventId,provider_mode:"test",body_sha256:e.bodySha256,event_type:e.eventType,refund_id:e.refundId,
  payment_id:e.paymentId,provider_order_id:e.providerOrderId,identity_mac:computeRefundIdentityMac(fields(e),KEY),mac_key_id:"k1",...tamper.row};
 const rpc=async(name,a)=>{calls.push(name);
  if(name==="qf_get_vendor_package_refund_identity_v4")return tamper.unbound?{data:null,error:{message:"REFUND_IDENTITY_UNBOUND"}}:{data:row};
  return {data:{event_id:e.eventId,provider_mode:"test",refund_id:row.refund_id,payment_id:row.payment_id,identity_mac:row.identity_mac,
   mac_key_id:"k1",status:tamper.status??"reviewed",decision:d,reviewable_credits:null,...tamper.receipt}};};
 return {e,calls,rpc};
};
test("identity-ledger reviewer: verifies the durable row before the write RPC and sends no caller identity",async()=>{
 const m=model(),sent=[];
 const r=createRefundIntakeReviewer(async(n,a)=>{sent.push([n,a]);return m.rpc(n,a)},{identityLedger:{macKey:KEY}});
 const out=await r.review({envelope:m.e,reviewerId:U,decision:d});
 assert.equal(out.ok,true);assert.equal(out.refundAllowed,false);assert.equal(out.creditMutation,false);
 assert.deepEqual(m.calls,["qf_get_vendor_package_refund_identity_v4","qf_review_vendor_package_refund_intake_v4"]);
 assert.equal(Object.hasOwn(sent[1][1],"p_refund_id"),false);assert.equal(Object.hasOwn(sent[1][1],"p_payment_id"),false);
});
test("identity-ledger reviewer: unbound, tampered, forged and conflicting identities never write or succeed",async()=>{
 const cases=[
  ["unbound",{unbound:true},"REFUND_REVIEW_IDENTITY_UNBOUND",1],
  ["tampered mac",{row:{identity_mac:"e".repeat(64)}},"REFUND_REVIEW_IDENTITY_INVALID",1],
  ["tampered payment",{row:{payment_id:"pay_OTHER12345"}},"REFUND_REVIEW_IDENTITY_INVALID",1],
  ["tampered body hash",{row:{body_sha256:"b".repeat(64)}},"REFUND_REVIEW_IDENTITY_INVALID",1],
  ["receipt other refund",{receipt:{refund_id:"rfnd_OTHER12345"}},"REFUND_REVIEW_IDENTITY_INVALID",2],
  ["receipt bad mac",{receipt:{identity_mac:"e".repeat(64)}},"REFUND_REVIEW_IDENTITY_INVALID",2],
  ["conflict",{status:"review_conflict"},"REFUND_REVIEW_CONFLICT",2]];
 for(const [label,t,reason,n] of cases){
  const m=model(t);
  const r=await createRefundIntakeReviewer(m.rpc,{identityLedger:{macKey:KEY}}).review({envelope:m.e,reviewerId:U,decision:d});
  assert.equal(r.ok,false,label);assert.equal(r.reason,reason,label);assert.equal(m.calls.length,n,label);
 }
 const m=model();
 const wrong=await createRefundIntakeReviewer(m.rpc,{identityLedger:{macKey:"z".repeat(40)}}).review({envelope:m.e,reviewerId:U,decision:d});
 assert.equal(wrong.reason,"REFUND_REVIEW_IDENTITY_INVALID");assert.equal(m.calls.length,1);
 const noRefund=model();
 assert.equal((await createRefundIntakeReviewer(noRefund.rpc,{identityLedger:{macKey:KEY}}).review(
  {envelope:{...noRefund.e,refundId:undefined},reviewerId:U,decision:d})).reason,"REFUND_REVIEW_REFUND_ID_REQUIRED");
 assert.equal(noRefund.calls.length,0);
 assert.equal(verifyDurableRefundIdentity(null,KEY),false);
 assert.throws(()=>createRefundIntakeReviewer(async()=>{},{identityLedger:{macKey:"short"}}));
 assert.throws(()=>createRefundIntakeReviewer(async()=>{},{identityLedger:{macKey:KEY},refundBound:true}));
});
test("backward-safe: default, v2 and RC37 refundBound adapters call exactly the same RPCs as before",async()=>{
 const e=mk(),names=[];
 const rpc=async(n,a)=>{names.push(n);return {data:{event_id:e.eventId,provider_mode:"test",refund_id:e.refundId,status:"reviewed",decision:d,reviewable_credits:null}}};
 assert.equal((await createRefundIntakeReviewer(rpc).review({envelope:e,reviewerId:U,decision:d})).ok,true);
 assert.equal((await createRefundIntakeReviewer(rpc,{refundBound:true}).review({envelope:e,reviewerId:U,decision:d})).ok,true);
 assert.deepEqual(names,["qf_review_vendor_package_refund_intake_v2","qf_review_vendor_package_refund_intake_v3"]);
});
test("gates stay OFF: no finance role invented, SQL is review-only and outside deployable migrations",()=>{
 assert.deepEqual([...FINANCE_REFUND_REVIEW_ROLES],[]);
 const auth=readFileSync(resolve(root,"lib/payments/vendorPackageRefundReviewAuthority.mjs"),"utf8");
 assert.match(auth,/createRefundIntakeReviewer\(callRpc,\{refundBound:true\}\)/,"service adapter default untouched");
 const name="rc38-review-only-refund-identity-ledger-v4.pg17.sql";
 const sql=readFileSync(resolve(root,"scripts/mvp/vox/fixtures",name),"utf8");
 for(const dir of ["supabase/migrations","migrations","db/migrations"]){
  const p=resolve(root,dir);
  if(existsSync(p))assert.equal(readdirSync(p).some(f=>/refund_identit|rc38/i.test(f)),false,dir);
 }
 assert.match(sql,/REVIEW-ONLY, NON-DEPLOYABLE/);
 assert.match(sql,/PRIMARY KEY \(provider_mode,refund_id\)/);
 assert.match(sql,/FOREIGN KEY \(provider_mode,refund_id,payment_id\)/);
 assert.match(sql,/pg_advisory_xact_lock\(hashtextextended\(p_provider_mode\|\|':'\|\|p_refund_id,0\)\)/);
 assert.match(sql,/FOR UPDATE;[\s\S]*pg_advisory_xact_lock/,"event row lock precedes advisory lock");
 assert.match(sql,/FORCE ROW LEVEL SECURITY/);
 assert.match(sql,/BEFORE TRUNCATE/);
 assert.match(sql,/REVOKE ALL ON FUNCTION[\s\S]*FROM PUBLIC/);
 assert.doesNotMatch(sql,/\bGRANT\b[^;]*\sTO (anon|authenticated|PUBLIC)\b/i);
 const code=sql.replace(/--.*$/gm,"");
 assert.doesNotMatch(code,/pgcrypto|hmac\(|current_setting|vendor_package_orders|wallet|razorpay_fetch/i);
 assert.doesNotMatch(code.replace(/BEFORE UPDATE OR DELETE/g,""),/\bUPDATE\s+public\.|\bDELETE\s+FROM/i,"ledger code never rewrites rows");
});
