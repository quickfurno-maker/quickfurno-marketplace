// RC39 Finance: staged refund identity intake. Real adapter tests plus the REAL
// compiled vendorPackagePaymentService over a fake PostgREST transport. Two
// bundles: (A) untouched source, proving every gate is OFF; (B) a test-only
// bundle whose onLoad transform flips the hard-false constants, proving the
// wiring itself (quarantine first, then HMAC identity). No network, no provider,
// no managed DB, no real keys.
import test from "node:test";
import assert from "node:assert/strict";
import {createHmac} from "node:crypto";
import {build} from "esbuild";
import {mkdirSync,readFileSync} from "node:fs";
import {resolve,dirname} from "node:path";
import {fileURLToPath,pathToFileURL} from "node:url";
import {buildRazorpayProviderEventEnvelope} from "../../../lib/payments/vendorPackageProviderEventLedger.mjs";
import {computeRefundIdentityMac} from "../../../lib/payments/vendorPackageRefundIdentityBinding.mjs";
import {RC39_REFUND_IDENTITY_INTAKE_RELEASED,REFUND_IDENTITY_INTAKE_ENV_FLAG,refundIdentityIntakeFlagOn,
 createStagedRefundIdentityIntake} from "../../../lib/payments/vendorPackageRefundIdentityIntake.mjs";

const root=resolve(dirname(fileURLToPath(import.meta.url)),"../../..");
mkdirSync(resolve(root,"test-results"),{recursive:true});
const KEY="rc39-unit-hmac-key-0123456789abcdef!!",KEY_ID="k1",SECRET="whsec_rc39_test_only";
const state={rpcs:[],impl:null};
globalThis.__rc39={state};
const stubs={
 supabase:`export const adminClient=()=>({from:()=>{throw Error("no table access")},
  rpc:async(n,a)=>{const s=globalThis.__rc39.state;s.rpcs.push({n,a});return s.impl(n,a)}});`,
 access:`export const requireVendorAccess=async()=>({ok:false,code:"UNAUTHORIZED",error:"x"});`,
};
const FLIPS=[
 [/vendorPackageProviderEventRepository\.mjs$/,"RC28_PROVIDER_LEDGER_RUNTIME_INSTALLED=false","RC28_PROVIDER_LEDGER_RUNTIME_INSTALLED=true"],
 [/vendorPackageRefundIdentityIntake\.mjs$/,"RC39_REFUND_IDENTITY_INTAKE_RELEASED=false","RC39_REFUND_IDENTITY_INTAKE_RELEASED=true"],
 [/vendorPackagePaymentService\.ts$/,"RC39_REFUND_IDENTITY_SQL_APPROVED = false","RC39_REFUND_IDENTITY_SQL_APPROVED = true"],
];
async function compile(name,flip){
 const outfile=resolve(root,"test-results/"+name+".mjs");
 await build({entryPoints:[resolve(root,"services/vendorPackagePaymentService.ts")],bundle:true,
  platform:"node",target:"node20",format:"esm",outfile,logLevel:"silent",
  plugins:[{name:"rc39",setup(b){
   b.onResolve({filter:/lib\/supabase$/},()=>({path:"supabase",namespace:"rc39"}));
   b.onResolve({filter:/\/vendorAccessService$/},()=>({path:"access",namespace:"rc39"}));
   b.onLoad({filter:/.*/,namespace:"rc39"},a=>({contents:stubs[a.path],loader:"js"}));
   if(flip)b.onLoad({filter:/\.(mjs|ts)$/,namespace:"file"},a=>{
    const hit=FLIPS.find(([re])=>re.test(a.path.replace(/\\/g,"/")));
    if(!hit)return null;
    let src=readFileSync(a.path,"utf8");
    if(!src.includes(hit[1]))throw Error("flip anchor missing in "+a.path);
    return {contents:src.replace(hit[1],hit[2]),loader:a.path.endsWith(".ts")?"ts":"js",resolveDir:dirname(a.path)};
   });
  }}]});
 return import(pathToFileURL(outfile).href+"?"+name);
}
const closedSvc=await compile("rc39-closed",false);
const openSvc=await compile("rc39-open",true);

const body=(type="refund.processed")=>JSON.stringify({event:type,payload:{
 refund:{entity:{id:"rfnd_RC39ABCDE",payment_id:"pay_RC39ABCDE"}},
 payment:{entity:{id:"pay_RC39ABCDE",order_id:"order_RC39ABCDE"}}}});
const sign=raw=>createHmac("sha256",SECRET).update(raw).digest("hex");
const EVT="evt_RC39ABCDE";
const env0={...process.env};
function setup({mode="test",ledger="enforce",flag="on",key=KEY,keyId=KEY_ID,impl}={}){
 Object.assign(process.env,{RAZORPAY_VENDOR_PACKAGE_MODE:mode,
  RAZORPAY_TEST_KEY_ID:"rzp_test_rc39",RAZORPAY_TEST_KEY_SECRET:"s",RAZORPAY_TEST_WEBHOOK_SECRET:SECRET,
  RAZORPAY_LIVE_KEY_ID:"rzp_live_rc39",RAZORPAY_LIVE_KEY_SECRET:"s",RAZORPAY_LIVE_WEBHOOK_SECRET:SECRET});
 const set=(k,v)=>v===null?delete process.env[k]:process.env[k]=v;
 set("RAZORPAY_VENDOR_PACKAGE_EVENT_LEDGER_MODE",ledger);
 set(REFUND_IDENTITY_INTAKE_ENV_FLAG,flag);
 set("QF_VOX_REFUND_IDENTITY_MAC_KEY",key);
 set("QF_VOX_REFUND_IDENTITY_MAC_KEY_ID",keyId);
 state.rpcs=[];state.impl=impl??fakeDb();
}
test.afterEach(()=>{for(const k of Object.keys(process.env))if(!(k in env0))delete process.env[k];Object.assign(process.env,env0)});
const run=(svc,raw=body(),evt=EVT)=>svc.handleVendorPackageRazorpayWebhook(raw,sign(raw),evt);
const names=()=>state.rpcs.map(r=>r.n);

// In-memory model of the v2 ledger + v4 identity RPC contracts.
function fakeDb({bind}={}){
 const events=new Map();
 return async(n,a)=>{
  if(n==="qf_record_vendor_package_razorpay_event_v2"){
   const k=a.p_provider_mode+"|"+a.p_event_id,prior=events.get(k);
   if(prior&&prior.body!==a.p_body_sha256)return {data:{event_id:a.p_event_id,provider_mode:a.p_provider_mode,status:"conflict"}};
   if(prior?.quarantined)return {data:{event_id:a.p_event_id,provider_mode:a.p_provider_mode,status:"quarantined",last_error_code:"REFUND_REVIEW_REQUIRED"}};
   events.set(k,{body:a.p_body_sha256});
   return {data:{event_id:a.p_event_id,provider_mode:a.p_provider_mode,status:"claimed",attempt_count:1}};
  }
  if(n==="qf_complete_vendor_package_razorpay_event_v2"){
   events.get(a.p_provider_mode+"|"+a.p_event_id).quarantined=a.p_disposition==="quarantined";
   return {data:{event_id:a.p_event_id,provider_mode:a.p_provider_mode,status:a.p_disposition,error_code:a.p_error_code}};
  }
  if(n==="qf_bind_vendor_package_refund_identity_v4")
   return bind?bind(a):{data:{event_id:a.p_event_id,provider_mode:a.p_provider_mode,status:"bound",refund_id:a.p_refund_id,
    payment_id:a.p_payment_id,identity_mac:a.p_identity_mac,mac_key_id:a.p_mac_key_id}};
  throw Error("unexpected rpc "+n);
 };
}

test("source constants: staged intake and ledger runtime are hard-false",()=>{
 assert.equal(RC39_REFUND_IDENTITY_INTAKE_RELEASED,false);
 const svc=readFileSync(resolve(root,"services/vendorPackagePaymentService.ts"),"utf8");
 assert.match(svc,/RC39_REFUND_IDENTITY_SQL_APPROVED = false as boolean/);
 assert.doesNotMatch(svc,/released\s*:/,"service never passes a release override");
});

test("compiled service, source as shipped: refund stays OFF (no RPC) with every env gate open",async()=>{
 for(const opts of [{},{ledger:null},{mode:"live"},{flag:null}]){
  setup(opts);
  const r=await run(closedSvc);
  assert.equal(r.ok,false);
  assert.ok(["REFUND_INTAKE_LEDGER_REQUIRED","RAZORPAY_EVENT_LEDGER_REQUIRED_FOR_LIVE","RAZORPAY_EVENT_LEDGER_REPOSITORY_UNAVAILABLE"].includes(r.code),r.code);
  assert.equal(state.rpcs.length,0);
 }
});

test("compiled service, gates opened by test transform: quarantine first, then HMAC identity, ACK, no effects",async()=>{
 setup();
 const r=await run(openSvc);
 assert.deepEqual(r,{ok:true,data:{status:"quarantined"}});
 assert.deepEqual(names(),["qf_record_vendor_package_razorpay_event_v2","qf_complete_vendor_package_razorpay_event_v2",
  "qf_bind_vendor_package_refund_identity_v4"]);
 const sent=state.rpcs[2].a;
 const raw=body(),envl=buildRazorpayProviderEventEnvelope({eventId:EVT,providerMode:"test",
  bodySha256:state.rpcs[0].a.p_body_sha256,candidate:{kind:"refund",eventName:"refund.processed",refundId:"rfnd_RC39ABCDE",
  paymentId:"pay_RC39ABCDE",providerOrderId:"order_RC39ABCDE"}});
 assert.equal(sent.p_identity_mac,computeRefundIdentityMac(envl,KEY));
 assert.equal(JSON.stringify(state.rpcs).includes(KEY),false,"MAC key never leaves the app");
 assert.equal(state.rpcs.some(x=>/credit|activate|refund_issue|wallet|order_v/.test(x.n)),false);
 void raw;
});

test("compiled service open: env flag off, missing/short key or key id each fail closed with no identity RPC",async()=>{
 for(const [label,opts] of [["flag off",{flag:null}],["flag wrong",{flag:"true"}],["no key",{key:null}],
  ["short key",{key:"short"}],["bad key id",{keyId:"bad id"}]]){
  setup(opts);
  const r=await run(openSvc);
  // Closed gate falls through to the plain v2 quarantine flow: ACK, but never an identity bind.
  assert.deepEqual(r,{ok:true,data:{status:"quarantined"}},label);
  assert.equal(names().includes("qf_bind_vendor_package_refund_identity_v4"),false,label);
 }
});

test("compiled service open: identity failures are never ACKed (retry/reject), quarantine stays durable",async()=>{
 const cases=[
  ["conflict",()=>({data:{event_id:EVT,provider_mode:"test",status:"identity_conflict"}}),"REFUND_IDENTITY_CONFLICT"],
  ["rpc error",()=>({data:null,error:{message:"x"}}),"REFUND_IDENTITY_REJECTED"],
  ["forged receipt",a=>({data:{event_id:a.p_event_id,provider_mode:a.p_provider_mode,status:"bound",refund_id:"rfnd_OTHER12345",
   payment_id:a.p_payment_id,identity_mac:a.p_identity_mac,mac_key_id:a.p_mac_key_id}}),"REFUND_IDENTITY_RECEIPT_INVALID"],
  ["thrown",()=>{throw Error("net")},"REFUND_IDENTITY_UNCONFIRMED"]];
 for(const [label,bind,code] of cases){
  setup({impl:fakeDb({bind})});
  const r=await run(openSvc);
  assert.equal(r.ok,false,label);assert.equal(r.code,code,label);
 }
 // Redelivery after a failed bind re-enters through the replayed quarantine and then binds.
 const db=fakeDb({bind:()=>{throw Error("net")}});
 setup({impl:db});
 assert.equal((await run(openSvc)).ok,false);
 state.impl=async(n,a)=>n==="qf_bind_vendor_package_refund_identity_v4"?fakeDb()(n,a):db(n,a);
 assert.deepEqual(await run(openSvc),{ok:true,data:{status:"quarantined"}});
});

test("compiled service open: bad signature, TEST/LIVE mismatch and non-refund events never reach identity binding",async()=>{
 setup();
 const raw=body();
 assert.equal((await openSvc.handleVendorPackageRazorpayWebhook(raw,"0".repeat(64),EVT)).code,"PAYMENT_SIGNATURE_INVALID");
 assert.equal(state.rpcs.length,0);
 setup();
 await run(openSvc,JSON.stringify({event:"payment.captured",payload:{payment:{entity:{id:"pay_RC39ABCDE",order_id:"order_RC39ABCDE"}}}}));
 assert.equal(names().includes("qf_bind_vendor_package_refund_identity_v4"),false);
});

test("adapter: gates evaluated before any I/O; foreign mode and reshaped envelopes touch nothing",async()=>{
 const e=buildRazorpayProviderEventEnvelope({eventId:EVT,providerMode:"test",bodySha256:"a".repeat(64),
  candidate:{kind:"refund",eventName:"refund.created",refundId:"rfnd_RC39ABCDE",paymentId:"pay_RC39ABCDE",providerOrderId:"order_RC39ABCDE"}});
 const calls=[];
 const repository={claim:async x=>{calls.push("claim");throw Error("no")},complete:async()=>{calls.push("complete")}};
 const callRpc=async n=>{calls.push(n);return {data:null}};
 const base={repository,callRpc,macKey:KEY,keyId:KEY_ID,providerMode:"test",env:{[REFUND_IDENTITY_INTAKE_ENV_FLAG]:"on"},sqlApproved:true};
 for(const [label,deps,reason] of [
  ["not released",{},"REFUND_IDENTITY_INTAKE_NOT_RELEASED"],
  ["flag off",{released:true,env:{}},"REFUND_IDENTITY_INTAKE_FLAG_OFF"],
  ["sql not approved",{released:true,sqlApproved:false},"REFUND_IDENTITY_SQL_NOT_APPROVED"],
  ["no mode",{released:true,providerMode:undefined},"REFUND_IDENTITY_MODE_REQUIRED"],
  ["no repo",{released:true,repository:null},"REFUND_IDENTITY_DEPENDENCY_MISSING"],
  ["short key",{released:true,macKey:"short"},"REFUND_IDENTITY_KEY_MISSING"]]){
  const r=await createStagedRefundIdentityIntake({...base,...deps}).process(e);
  assert.equal(r.handled,false,label);assert.equal(r.reason,reason,label);
 }
 assert.equal(refundIdentityIntakeFlagOn({[REFUND_IDENTITY_INTAKE_ENV_FLAG]:"ON"}),false);
 assert.equal(refundIdentityIntakeFlagOn(null),false);
 assert.equal(calls.length,0);
 const open=createStagedRefundIdentityIntake({...base,released:true});
 assert.equal((await open.process({...e,providerMode:"live"})).code,"REFUND_IDENTITY_ENVELOPE_INVALID");
 assert.equal((await open.process({...e,extra:1})).code,"REFUND_IDENTITY_ENVELOPE_INVALID");
 const live=createStagedRefundIdentityIntake({...base,released:true,providerMode:"live"});
 assert.equal((await live.process(e)).code,"REFUND_IDENTITY_MODE_MISMATCH");
 assert.equal(calls.length,0);
 // Uncertain v2 quarantine: no identity bind, retry classification.
 const out=await open.process(e);
 assert.equal(out.ack,false);assert.equal(out.refundAllowed,false);assert.equal(out.creditMutation,false);
 assert.equal(calls.includes("qf_bind_vendor_package_refund_identity_v4"),false);
});
