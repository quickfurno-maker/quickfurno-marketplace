import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {resolve,dirname} from "node:path";
import {fileURLToPath} from "node:url";
import {computeRefundIdentityMac} from "../../../lib/payments/vendorPackageRefundIdentityBinding.mjs";
import {issueVerifiedFinanceReviewer,FINANCE_REFUND_REVIEW_ROLES} from "../../../lib/payments/vendorPackageRefundReviewAuthority.mjs";
import {adjudicateConsumedCreditRefundEvidence as adjudicate} from "../../../lib/payments/vendorPackageConsumedCreditRefundAdjudication.mjs";
const root=resolve(dirname(fileURLToPath(import.meta.url)),"../../..");
const KEY="rc40-unit-hmac-key-0123456789abcdef!!";
const V="11111111-1111-4111-8111-111111111111",V2="22222222-2222-4222-8222-222222222222";
const O="33333333-3333-4333-8333-333333333333",O2="44444444-4444-4444-8444-444444444444";
const L=n=>`5555555${n}-5555-4555-8555-555555555555`;
const ROLE="test_only_finance_role",NOW=1_000_000;
const f={eventId:"evt_RC40UNIT0001",bodySha256:"a".repeat(64),providerMode:"test",eventType:"refund.processed",
 refundId:"rfnd_RC40UNIT01",paymentId:"pay_RC40UNIT01",providerOrderId:"order_RC40UNIT01"};
const row=(o={})=>({event_id:f.eventId,body_sha256:f.bodySha256,provider_mode:f.providerMode,event_type:f.eventType,
 refund_id:f.refundId,payment_id:f.paymentId,provider_order_id:f.providerOrderId,
 identity_mac:computeRefundIdentityMac(f,KEY),...o});
const reviewer=()=>issueVerifiedFinanceReviewer({userId:V2,staffRole:ROLE,aal:"aal2",expiresAtMs:NOW+60000,teamId:O,cityId:O2},NOW);
const debits=n=>Array.from({length:n},(_,i)=>({orderId:O,vendorId:V,leadId:L(i),credits:1}));
const mk=(o={})=>({identityRow:row(),macKey:KEY,
 expected:{orderId:O,vendorId:V,providerOrderId:f.providerOrderId,providerMode:"test",bodySha256:f.bodySha256},
 requesterVendorId:V,ledger:{orderId:O,vendorId:V,creditsGranted:5,creditsRemaining:2,ledgerDebits:debits(3)},
 reviewer:reviewer(),approvedRoles:[ROLE],now:NOW,...o});
const NEVER={refundAllowed:false,creditGrantAllowed:false,creditRevocationAllowed:false,providerCallAllowed:false,requiresHumanReview:true};
const assertNever=r=>{assert.equal(r.ok,false);for(const [k,v] of Object.entries(NEVER))assert.equal(r[k],v,k)};

test("fully verified consumed case yields bounded evidence and POLICY_APPROVAL_MISSING, never authority",()=>{
 const r=adjudicate(mk());
 assertNever(r);
 assert.equal(r.decision,"POLICY_APPROVAL_MISSING");assert.equal(r.reason,"POLICY_APPROVAL_MISSING");
 assert.equal(r.evidence.consumedCredits,3);assert.equal(r.evidence.verifiedDebitCount,3);
 assert.equal(r.evidence.reviewerId,V2);assert.equal(r.evidence.policyApprovalPresent,false);
 const s=JSON.stringify(r);
 assert.equal(s.includes(KEY),false);assert.equal(s.includes("a".repeat(64)),false);
 assert.equal(s.includes(row().identity_mac),false);
 assert.ok(Object.isFrozen(r)&&Object.isFrozen(r.evidence));
});
test("unconsumed ledger is still only POLICY_APPROVAL_MISSING with zero consumed",()=>{
 const r=adjudicate(mk({ledger:{orderId:O,vendorId:V,creditsGranted:5,creditsRemaining:5,ledgerDebits:[]}}));
 assertNever(r);assert.equal(r.decision,"POLICY_APPROVAL_MISSING");assert.equal(r.evidence.consumedCredits,0);
});
test("default (empty) finance role set fails closed even for a verified AAL2 principal",()=>{
 assert.equal(FINANCE_REFUND_REVIEW_ROLES.length,0);
 const {approvedRoles,...rest}=mk();
 const r=adjudicate(rest);assertNever(r);assert.equal(r.reason,"FINANCE_REVIEW_ROLE_NOT_CANONICAL");assert.equal(r.evidence,null);
});
test("tampered MAC / identity field / wrong key / digest mismatch are denied",()=>{
 for(const [patch,reason] of [[{identity_mac:"c".repeat(64)},"REFUND_IDENTITY_MAC_INVALID"],
  [{refund_id:"rfnd_OTHER12345"},"REFUND_IDENTITY_MAC_INVALID"],[{payment_id:"pay_OTHER12345"},"REFUND_IDENTITY_MAC_INVALID"],
  [{provider_mode:"live"},"REFUND_IDENTITY_MAC_INVALID"],[{identity_mac:null},"REFUND_IDENTITY_MAC_INVALID"]]){
  const r=adjudicate(mk({identityRow:row(patch)}));assertNever(r);assert.equal(r.reason,reason,JSON.stringify(patch));assert.equal(r.evidence,null);
 }
 assert.equal(adjudicate(mk({macKey:KEY+"x"})).reason,"REFUND_IDENTITY_MAC_INVALID");
 assert.equal(adjudicate(mk({macKey:"short"})).reason,"REFUND_IDENTITY_MAC_INVALID");
 const m=mk();m.expected.bodySha256="b".repeat(64);
 assert.equal(adjudicate(m).reason,"REFUND_IDENTITY_DIGEST_MISMATCH");
});
test("provider mode and provider order mismatches are denied",()=>{
 const m=mk();m.expected.providerMode="live";
 assert.equal(adjudicate(m).reason,"PROVIDER_MODE_MISMATCH");
 const o=mk();o.expected.providerOrderId="order_OTHER12345";
 assert.equal(adjudicate(o).reason,"PROVIDER_ORDER_MISMATCH");
 // A validly MAC'd LIVE identity cannot be used against a test-mode expectation.
 const lf={...f,providerMode:"live"};
 const live=mk({identityRow:row({provider_mode:"live",identity_mac:computeRefundIdentityMac(lf,KEY)})});
 assert.equal(adjudicate(live).reason,"PROVIDER_MODE_MISMATCH");
});
test("cross-vendor IDOR and ledger/order mismatches are denied without evidence",()=>{
 const idor=adjudicate(mk({requesterVendorId:V2}));assertNever(idor);
 assert.equal(idor.reason,"VENDOR_SCOPE_MISMATCH");assert.equal(idor.evidence,null);
 const lv=mk();lv.ledger={...lv.ledger,vendorId:V2,ledgerDebits:debits(3).map(d=>({...d,vendorId:V2}))};
 assert.equal(adjudicate(lv).reason,"LEDGER_VENDOR_MISMATCH");
 const lo=mk();lo.ledger={...lo.ledger,orderId:O2,ledgerDebits:debits(3).map(d=>({...d,orderId:O2}))};
 assert.equal(adjudicate(lo).reason,"LEDGER_ORDER_MISMATCH");
 const xr=mk();xr.ledger={...xr.ledger,ledgerDebits:[{orderId:O,vendorId:V2,leadId:L(0),credits:1},...debits(3).slice(1)]};
 assert.equal(adjudicate(xr).reason,"CREDIT_LEDGER_DEBIT_SOURCE_INVALID");
});
test("duplicate lead credit charge, consumption mismatch and malformed ledgers are denied",()=>{
 const dup=mk();dup.ledger={...dup.ledger,ledgerDebits:[...debits(2),{orderId:O,vendorId:V,leadId:L(0),credits:1}]};
 const r=adjudicate(dup);assertNever(r);assert.equal(r.reason,"CREDIT_LEDGER_DUPLICATE_LEAD_CHARGE");assert.equal(r.evidence,null);
 const mm=mk();mm.ledger={...mm.ledger,ledgerDebits:debits(2)};
 assert.equal(adjudicate(mm).reason,"CREDIT_LEDGER_CONSUMPTION_MISMATCH");
 const bad=mk();bad.ledger={...bad.ledger,creditsRemaining:9};
 assert.equal(adjudicate(bad).reason,"CREDIT_LEDGER_REVIEW_SOURCE_INVALID");
 const extra=mk();extra.ledger={...extra.ledger,note:"x"};
 assert.equal(adjudicate(extra).reason,"CREDIT_LEDGER_REVIEW_INPUT_INVALID");
});
test("reviewer must be an issued, unexpired AAL2 principal with an approved role",()=>{
 const forged={userId:V2,staffRole:ROLE,aal:"aal2",expiresAtMs:NOW+60000,teamId:O,cityId:O2};
 assert.equal(adjudicate(mk({reviewer:forged})).reason,"FINANCE_REVIEWER_NOT_VERIFIED");
 assert.equal(issueVerifiedFinanceReviewer({...forged,aal:"aal1"},NOW),null);
 assert.equal(adjudicate(mk({reviewer:null})).reason,"FINANCE_REVIEWER_NOT_VERIFIED");
 assert.equal(adjudicate(mk({now:NOW+60001})).reason,"FINANCE_REVIEWER_SESSION_INVALID");
 assert.equal(adjudicate(mk({approvedRoles:["other_role"]})).reason,"FINANCE_REVIEW_ROLE_FORBIDDEN");
});
test("strict input shape: unknown keys, caller reviewerId and bad types are rejected",()=>{
 for(const bad of [null,[],"x",{},{...mk(),reviewerId:V2},{...mk(),requesterVendorId:"nope"},
  {...mk(),expected:{...mk().expected,extra:1}},{...mk(),identityRow:null},{...mk(),now:1.5}])
  assert.equal(adjudicate(bad).reason,"ADJUDICATION_INPUT_INVALID");
});
test("pure: inputs are deeply unchanged (even when frozen) and repeated calls are deterministic",()=>{
 const m=mk(),before=JSON.stringify(m);
 const freeze=o=>{if(o&&typeof o==="object"&&!Object.isFrozen(o)){Object.freeze(o);Object.values(o).forEach(freeze)}};
 const rv=m.reviewer;freeze(m.identityRow);freeze(m.expected);freeze(m.ledger);
 const a=adjudicate(m),b=adjudicate(m);
 assert.deepEqual(a,b);assert.equal(JSON.stringify(m),before);assert.equal(m.reviewer,rv);
});
test("source-level: only the three Finance libs are imported; no I/O, provider, env or secrets",()=>{
 const src=readFileSync(resolve(root,"lib/payments/vendorPackageConsumedCreditRefundAdjudication.mjs"),"utf8");
 const imports=[...src.matchAll(/^import .* from "([^"]+)"/gm)].map(m=>m[1]).sort();
 assert.deepEqual(imports,["./vendorPackageCreditLedgerReview.mjs","./vendorPackageRefundIdentityBinding.mjs","./vendorPackageRefundReviewAuthority.mjs"]);
 const code=src.replace(/^\s*\/\/.*$/gm,"");
 for(const bad of [/\bfetch\b/,/callRpc/,/supabase/i,/process\.env/,/\bawait\b|\basync\b/,/node:fs|node:http|node:net/,/razorpay/i,/\.refunds?\./,/writeFile|\.from\(|\.rpc\(/])
  assert.doesNotMatch(code,bad,String(bad));
 const dts=readFileSync(resolve(root,"lib/payments/vendorPackageConsumedCreditRefundAdjudication.d.mts"),"utf8");
 assert.match(dts,/ok: false/);assert.doesNotMatch(dts,/refundAllowed: true|ok: true/);
});
