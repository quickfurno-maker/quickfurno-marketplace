import test from "node:test";
import assert from "node:assert/strict";
import {build} from "esbuild";
import {mkdtempSync,rmSync,readFileSync,writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {resolve,join,dirname} from "node:path";
import {pathToFileURL,fileURLToPath} from "node:url";
import {computeRefundIdentityMac} from "../../../lib/payments/vendorPackageRefundIdentityBinding.mjs";
const root=resolve(dirname(fileURLToPath(import.meta.url)),"../../..");
const tmp=mkdtempSync(join(tmpdir(),"qf-vox-rc41-"));
async function compile(entry,name,wrapper=""){
 const outfile=join(tmp,name);
 let entryPoint=resolve(root,entry);
 if(wrapper){entryPoint=join(tmp,name+".entry.ts");
  writeFileSync(entryPoint,`export * from ${JSON.stringify(resolve(root,entry))};\n`+wrapper);}
 await build({entryPoints:[entryPoint],outfile,bundle:true,platform:"node",format:"esm",
  target:"node24",logLevel:"silent",plugins:[{name:"mocks",setup(b){
   b.onResolve({filter:/^server-only$/},()=>({path:"server-only",namespace:"mock"}));
   b.onResolve({filter:/^@\/lib\/supabase$/},()=>({path:"supabase",namespace:"mock"}));
   b.onResolve({filter:/^@\//},a=>b.resolve("./"+a.path.slice(2),{resolveDir:root,kind:a.kind}));
   b.onLoad({filter:/.*/,namespace:"mock"},a=>({loader:"js",contents:
    a.path==="supabase"?"export function adminClient(){return globalThis.__rc41.adminClient();}"+
     " export async function verifySupabaseBearerUser(t){return globalThis.__rc41.authUser(t);}":""}));
  }}]});
 return import(pathToFileURL(outfile).href+"?"+Math.random());
}
// Principals must be minted by the SAME module instance the bundle's adjudicator uses.
const svc=await compile("services/vox/financeRefundCaseReview.ts","svc.mjs",
 `export {issueVerifiedFinanceReviewer as issue} from ${JSON.stringify(resolve(root,"lib/payments/vendorPackageRefundReviewAuthority.mjs"))};`);
const route=await compile("app/api/vox/v1/finance/refund-intake/[providerMode]/[eventId]/route.ts","route.mjs");

const KEY="rc41-unit-hmac-key-0123456789abcdef!!";
const V="11111111-1111-4111-8111-111111111111",U="22222222-2222-4222-8222-222222222222";
const O="33333333-3333-4333-8333-333333333333",T="44444444-4444-4444-8444-444444444444";
const L=n=>`5555555${n}-5555-4555-8555-555555555555`;
const ROLE="test_only_finance_role",NOW=2_000_000;
const f={eventId:"evt_RC41UNIT0001",bodySha256:"a".repeat(64),providerMode:"test",eventType:"refund.processed",
 refundId:"rfnd_RC41UNIT01",paymentId:"pay_RC41UNIT01",providerOrderId:"order_RC41UNIT01"};
const mac=computeRefundIdentityMac(f,KEY);
const snapshot=(o={})=>({
 event:{event_id:f.eventId,provider_mode:"test",body_sha256:f.bodySha256,event_type:f.eventType,
  payment_id:f.paymentId,provider_order_id:f.providerOrderId,status:"quarantined",error_code:"REFUND_REVIEW_REQUIRED"},
 identity:{event_id:f.eventId,provider_mode:"test",body_sha256:f.bodySha256,event_type:f.eventType,
  refund_id:f.refundId,payment_id:f.paymentId,provider_order_id:f.providerOrderId,identity_mac:mac,mac_key_id:"k1"},
 order:{id:O,vendor_id:V,provider_order_id:f.providerOrderId,provider_payment_id:f.paymentId},
 ledger:{order_id:O,vendor_id:V,credits_granted:5,credits_remaining:2,
  debits:[0,1,2].map(i=>({order_id:O,vendor_id:V,lead_id:L(i),credits:1}))},...o});
const principal=(extra={})=>svc.issue({userId:U,staffRole:ROLE,aal:"aal2",
 expiresAtMs:NOW+60000,teamId:T,cityId:T,...extra},NOW);
const ENV={VOX_FINANCE_REFUND_CASE_REVIEW_ENABLED:"staging",VOX_FINANCE_READ_ENABLED:"staging",
 VOX_STAFF_READ_ENABLED:"staging",VOX_STAFF_GRANTS_ENABLED:"staging"};
function harness({snap=snapshot(),reviewers,key=KEY,roles=[ROLE],env=ENV}={}){
 if(roles===null)roles=undefined; // explicit "production default" (empty canonical set)
 const s={verifies:0,loads:0,args:null};
 const seq=reviewers??[principal(),principal()];
 const handle=svc.createRefundCaseReviewHandler({
  verifyReviewer:async()=>{const r=seq[Math.min(s.verifies,seq.length-1)];s.verifies++;return r},
  loadSnapshot:async(id,mode)=>{s.loads++;s.args=[id,mode];return snap},
  macKey:()=>key,approvedRoles:roles,now:()=>NOW,env});
 s.get=(mode="test",id=f.eventId,url=`https://local.test/api/vox/v1/finance/refund-intake/${mode}/${id}`)=>
  handle(new Request(url,{headers:{authorization:"Bearer x"}}),{providerMode:mode,eventId:id});
 return s;
}
const body=async r=>r.json();

test("default OFF: every literal gate is required and nothing runs before it",async()=>{
 for(const k of Object.keys(ENV)){
  const h=harness({env:{...ENV,[k]:"true"}});
  const r=await h.get();assert.equal(r.status,503);
  assert.equal((await body(r)).error,"REFUND_CASE_REVIEW_DISABLED");
  assert.equal(h.verifies,0);assert.equal(h.loads,0);
 }
 const h=harness({env:{}});assert.equal((await h.get()).status,503);assert.equal(h.verifies+h.loads,0);
});
test("query/hash/mode/event-id are strictly validated before auth or SQL",async()=>{
 for(const [mode,id,url] of [["test",f.eventId,`https://l.test/x/test/${f.eventId}?a=1`],
  ["test",f.eventId,`https://l.test/x/test/${f.eventId}#h`],["demo",f.eventId],["test","bad id"],["test","x"]]){
  const h=harness();const r=await h.get(mode,id,url);
  assert.equal(r.status,400);assert.equal(h.verifies+h.loads,0);
 }
});
test("no verified reviewer => 403 before any DB read",async()=>{
 const h=harness({reviewers:[null]});const r=await h.get();
 assert.equal(r.status,403);assert.equal((await body(r)).error,"FINANCE_REVIEWER_AAL2_ROLE_REQUIRED");assert.equal(h.loads,0);
});
test("verified case: read-only evidence, never authority, no secrets",async()=>{
 const h=harness();const r=await h.get();assert.equal(r.status,200);
 assert.match(r.headers.get("cache-control"),/no-store/);assert.equal(r.headers.get("vary"),"Authorization");
 const text=await r.text(),j=JSON.parse(text);
 assert.equal(j.ok,true);assert.equal(j.mode,"READ_ONLY");assert.equal(j.decision,"POLICY_APPROVAL_MISSING");
 for(const k of ["canRefund","canGrantCredits","canRevokeCredits","canCallProvider"])assert.equal(j[k],false,k);
 assert.equal(j.requiresHumanReview,true);
 assert.equal(j.evidence.refundId,f.refundId);assert.equal(j.evidence.consumedCredits,3);
 assert.equal(j.evidence.reviewerId,U);assert.equal(j.evidence.policyApprovalPresent,false);
 for(const leak of [KEY,mac,f.bodySha256])assert.equal(text.includes(leak),false);
 assert.deepEqual(h.args,[f.eventId,"test"]);assert.equal(h.verifies,2);assert.equal(h.loads,1);
});
test("canonical Finance role absent (default approved set) fails closed even for a verified AAL2 principal",async()=>{
 const h=harness({roles:null});const r=await h.get();
 assert.equal(r.status,403);const j=await body(r);
 assert.equal(j.reason,"FINANCE_REVIEW_ROLE_NOT_CANONICAL");assert.equal(j.canRefund,false);assert.equal("evidence" in j,false);
 const wrong=harness({roles:["other_role"]});assert.equal((await wrong.get()).status,403);
});
test("MAC, digest, mode, payment, order, vendor and event mismatches are denied without evidence",async()=>{
 const cases=[
  ["tampered mac",s=>{s.identity.identity_mac="c".repeat(64)},409,"REFUND_IDENTITY_MAC_INVALID"],
  ["tampered refund id",s=>{s.identity.refund_id="rfnd_OTHER12345"},409,"REFUND_IDENTITY_MAC_INVALID"],
  ["event digest differs",s=>{s.event.body_sha256="b".repeat(64)},409,"REFUND_IDENTITY_DIGEST_MISMATCH"],
  ["wrong key",null,409,"REFUND_IDENTITY_MAC_INVALID","other-key-0123456789abcdef0123456789"],
  ["order payment differs",s=>{s.order.provider_payment_id="pay_OTHER12345"},409,"REFUND_CASE_IDENTITY_MISMATCH"],
  ["order payment unbound",s=>{s.order.provider_payment_id=null},409,"REFUND_CASE_IDENTITY_MISMATCH"],
  ["order provider order differs",s=>{s.order.provider_order_id="order_OTHER12345"},409,"REFUND_CASE_IDENTITY_MISMATCH"],
  ["identity payment differs",s=>{s.identity.payment_id="pay_OTHER12345"},409,"REFUND_CASE_IDENTITY_MISMATCH"],
  ["identity for other event",s=>{s.identity.event_id="evt_OTHER12345"},409,"REFUND_CASE_IDENTITY_MISMATCH"],
  ["live row for test path",s=>{s.identity.provider_mode="live"},409,"REFUND_CASE_IDENTITY_MISMATCH"],
  ["ledger other vendor",s=>{s.ledger.vendor_id=U;s.ledger.debits.forEach(d=>d.vendor_id=U)},409,"LEDGER_VENDOR_MISMATCH"],
  ["ledger other order",s=>{s.ledger.order_id=T;s.ledger.debits.forEach(d=>d.order_id=T)},409,"LEDGER_ORDER_MISMATCH"],
  ["duplicate lead charge",s=>{s.ledger.debits[2].lead_id=L(0)},409,"CREDIT_LEDGER_DUPLICATE_LEAD_CHARGE"],
  ["consumption mismatch",s=>{s.ledger.debits.pop()},409,"CREDIT_LEDGER_CONSUMPTION_MISMATCH"],
  ["remaining exceeds grant",s=>{s.ledger.credits_remaining=9},409,"CREDIT_LEDGER_REVIEW_SOURCE_INVALID"],
  ["not quarantined",s=>{s.event.status="completed";s.event.error_code=null},409,"REFUND_CASE_NOT_REVIEWABLE"],
  ["not a refund event",s=>{s.event.event_type="payment.captured"},409,"REFUND_CASE_NOT_REVIEWABLE"]];
 for(const [label,mutate,status,want,key] of cases){
  const snap=snapshot();if(mutate)mutate(snap);
  const h=harness({snap,...(key?{key}:{})});const r=await h.get();const j=await r.json();
  assert.equal(r.status,status,label);assert.equal(j.ok,false,label);
  assert.equal(j.reason??j.error,want,label);assert.equal("evidence" in j,false,label);
  assert.equal(j.canRefund??false,false,label);
 }
});
test("malformed or extended snapshot shape, short key, missing case and loader failure fail closed",async()=>{
 for(const snap of [snapshot({extra:1}),snapshot({order:{...snapshot().order,provider_secret:"x"}}),
  snapshot({ledger:{...snapshot().ledger,debits:"no"}}),snapshot({event:null})]){
  assert.equal((await harness({snap}).get()).status,503);
 }
 assert.equal((await harness({key:"short"}).get()).status,503);
 const missing=harness({snap:null});assert.equal((await missing.get()).status,404);
 const boom=svc.createRefundCaseReviewHandler({verifyReviewer:async()=>principal(),macKey:()=>KEY,env:ENV,
  loadSnapshot:async()=>{throw new Error("pg down secret")}});
 const r=await boom(new Request("https://l.test/x"),{providerMode:"test",eventId:f.eventId});
 assert.equal(r.status,503);assert.equal(JSON.stringify(await r.json()).includes("secret"),false);
});
test("reviewer revoked or changed during the read cannot receive the result",async()=>{
 assert.equal((await harness({reviewers:[principal(),null]}).get()).status,403);
 const other=principal({userId:V});
 const r=await harness({reviewers:[principal(),other]}).get();
 assert.equal(r.status,403);assert.equal((await body(r)).error,"FINANCE_REVIEWER_REVOKED_DURING_READ");
});
test("an expired principal is rejected by the adjudicator",async()=>{
 const r=await harness({reviewers:[principal({expiresAtMs:NOW+1})]}).get();
 assert.equal(r.status,200);
 const late=svc.createRefundCaseReviewHandler({verifyReviewer:async()=>principal(),macKey:()=>KEY,env:ENV,
  approvedRoles:[ROLE],now:()=>NOW+60001,loadSnapshot:async()=>snapshot()});
 const x=await late(new Request("https://l.test/x"),{providerMode:"test",eventId:f.eventId});
 assert.equal(x.status,403);assert.equal((await x.json()).reason,"FINANCE_REVIEWER_SESSION_INVALID");
});

// ---- compiled real route (production wiring, mocked Auth/PostgREST) ----
const flagsOn=on=>{for(const k of Object.keys(ENV))on?process.env[k]="staging":delete process.env[k]};
// The REAL production verifier is bundled; only Supabase is mocked.
const rpcWorld=()=>{
 const w={rpc:[],authCalls:0,from:0};
 globalThis.__rc41={authUser:async()=>{w.authCalls++;return null},
  adminClient:()=>({from(){w.from++;throw new Error("no table access")},
   async rpc(name,args){w.rpc.push([name,args]);return {data:snapshot(),error:null}}})};
 return w;
};
const rurl=`https://local.test/api/vox/v1/finance/refund-intake/test/${f.eventId}`;
const JWT="Bearer "+"a".repeat(40)+"."+"b".repeat(40)+"."+"c".repeat(40);
const call=(url=rurl,mode="test",id=f.eventId,auth=JWT)=>
 route.GET(new Request(url,{headers:auth?{authorization:auth}:{}}),
 {params:Promise.resolve({providerMode:mode,eventId:id})});
test("compiled route: default OFF with no auth or RPC",async()=>{
 flagsOn(false);const w=rpcWorld();
 const r=await call();assert.equal(r.status,503);assert.equal(w.authCalls,0);assert.equal(w.rpc.length,0);
});
test("compiled route: no canonical Finance role => 403 before any Auth network call or database read",async()=>{
 flagsOn(true);process.env.QF_VOX_REFUND_IDENTITY_MAC_KEY=KEY;const w=rpcWorld();
 for(const auth of [JWT,null,"Bearer nope"]){
  const r=await call(rurl,"test",f.eventId,auth);
  assert.equal(r.status,403);assert.equal((await r.json()).error,"FINANCE_REVIEWER_AAL2_ROLE_REQUIRED");
 }
 assert.equal(w.authCalls,0);assert.equal(w.rpc.length,0);assert.equal(w.from,0);
});
test("compiled route: query and bad ids are refused before auth; mutation verbs are 405",async()=>{
 flagsOn(true);const w=rpcWorld();
 assert.equal((await call(rurl+"?refundId=1")).status,400);
 assert.equal((await call(rurl,"demo")).status,400);
 assert.equal((await call(rurl,"test","../x")).status,400);
 assert.equal(w.authCalls,0);assert.equal(w.rpc.length,0);
 for(const m of ["POST","PUT","PATCH","DELETE"])assert.equal(route[m]().status,405);
});
test("source: no write, provider, body, caller-principal or pg-pool path; SQL candidate is read-only and non-deployable",()=>{
 for(const p of ["services/vox/financeRefundCaseReview.ts","app/api/vox/v1/finance/refund-intake/[providerMode]/[eventId]/route.ts"]){
  const s=readFileSync(resolve(root,p),"utf8");
  assert.doesNotMatch(s,/\.insert\(|\.update\(|\.delete\(|\.upsert\(|razorpay|fetch\(|from\s+"pg"|new Pool|DATABASE_URL/i,p);
  assert.doesNotMatch(s,/request\.(json|text|formData|body)/,p);
  assert.doesNotMatch(s,/reviewerId\s*:\s*(body|params|u\.|request)/,p);
 }
 const sql=readFileSync(resolve(root,"ops/vox/rc41-review-candidates/20261101010000_vox_rc41_refund_case_snapshot_REVIEW_ONLY.sql"),"utf8");
 assert.match(sql,/STABLE SECURITY INVOKER/);assert.match(sql,/NON-DEPLOYABLE/);
 assert.doesNotMatch(sql.replace(/^--.*$/gm,""),/\b(INSERT|UPDATE|DELETE|TRUNCATE|ALTER|DROP)\b|CREATE TABLE/i);
 assert.match(sql,/REVOKE ALL ON FUNCTION[^;]*FROM PUBLIC/);assert.match(sql,/TO service_role/);
});
test("fixture cleanup",()=>{
 for(const k of [...Object.keys(ENV),"QF_VOX_REFUND_IDENTITY_MAC_KEY"])delete process.env[k];
 delete globalThis.__rc41;rmSync(tmp,{recursive:true,force:true});
});
