// RC34 Finance: amount/precision integrity at the webhook activation fence.
// Compiled real vendorPackagePaymentService + vendorPackageRazorpay over a fake
// PostgREST transport and fake provider fetch. No network, no live provider,
// no managed DB, no credits granted anywhere. Ledger stays hard-off in source.
//
// Defect: SQL derives the expected charge as round(numeric price*100) (exact,
// half-up) while TS used Math.round(float*100) (1.005 -> 100 vs SQL 101), and
// activateCapturedPayment fell back to the package price when the stored
// provider amount was null and never compared the stored amount with the
// package snapshot before trusting it as the expected capture amount.
import test from "node:test";
import assert from "node:assert/strict";
import {createHmac} from "node:crypto";
import {build} from "esbuild";
import {mkdirSync} from "node:fs";
import {resolve,dirname} from "node:path";
import {fileURLToPath,pathToFileURL} from "node:url";
import {classifyVendorPackageWebhookFailure} from "../../../lib/payments/vendorPackageProviderEventLedger.mjs";

const root=resolve(dirname(fileURLToPath(import.meta.url)),"../../..");
const outfile=resolve(root,"test-results/rc34-finance-service.mjs");
const razorOut=resolve(root,"test-results/rc34-finance-razorpay.mjs");
mkdirSync(resolve(root,"test-results"),{recursive:true});
const state={order:null,orders:null,rpcs:[],rpcImpl:null,fetches:[]};
globalThis.__rc34={state};
const stubs={
 "supabase":`export const adminClient=()=>({
  from:()=>{const q={select:()=>q,eq:()=>q,maybeSingle:async()=>{const s=globalThis.__rc34.state;
   const o=s.orders?s.orders.shift()??s.order:s.order;return {data:o&&{...o},error:null}}};return q},
  rpc:async(n,a)=>{const s=globalThis.__rc34.state;s.rpcs.push({n,a});return s.rpcImpl(n,a)}});`,
 "access":`export const requireVendorAccess=async()=>({ok:false,code:"UNAUTHORIZED",error:"x"});`,
};
const plugins=[{name:"rc34-stubs",setup(b){
 b.onResolve({filter:/lib\/supabase$/},()=>({path:"supabase",namespace:"rc34"}));
 b.onResolve({filter:/\/vendorAccessService$/},()=>({path:"access",namespace:"rc34"}));
 b.onLoad({filter:/.*/,namespace:"rc34"},a=>({contents:stubs[a.path],loader:"js"}));
}}];
const common={bundle:true,platform:"node",target:"node20",format:"esm",logLevel:"silent",plugins};
await build({...common,entryPoints:[resolve(root,"services/vendorPackagePaymentService.ts")],outfile});
await build({...common,entryPoints:[resolve(root,"lib/payments/vendorPackageRazorpay.ts")],outfile:razorOut});
const svc=await import(pathToFileURL(outfile).href);
const rz=await import(pathToFileURL(razorOut).href);

const SECRET="whsec_rc34_test_only";
const ORDER_ID="11111111-1111-4111-8111-111111111111";
const baseOrder=(o={})=>({id:ORDER_ID,vendor_id:"v1",package_id:"p1",package_name:"Pack",package_price:2500,
 package_currency:"INR",credits_included:10,validity_days:30,order_status:"created",payment_status:"pending",
 payment_provider:"razorpay",payment_method:null,provider_order_id:"order_RC34ABC123",provider_payment_id:null,
 provider_amount_subunits:250000,provider_receipt:"x",provider_mode:"test",activation_status:"not_activated",...o});
const payment=(o={})=>({id:"pay_RC34ABC123",order_id:"order_RC34ABC123",amount:250000,currency:"INR",
 status:"captured",captured:true,...o});
const body=()=>JSON.stringify({event:"payment.captured",payload:{payment:{entity:{id:"pay_RC34ABC123",order_id:"order_RC34ABC123"}}}});
const sign=raw=>createHmac("sha256",SECRET).update(raw).digest("hex");
const receipt={status:"applied",order_id:ORDER_ID,credits_added:10,
 vendor_package_id:"22222222-2222-4222-8222-222222222222",expires_at:"2027-01-01T00:00:00Z"};

const realFetch=globalThis.fetch;
const env={...process.env};
function setup({pay=payment(),order=baseOrder(),orders=null}={}){
 Object.assign(process.env,{RAZORPAY_VENDOR_PACKAGE_MODE:"test",
  RAZORPAY_TEST_KEY_ID:"rzp_test_rc34",RAZORPAY_TEST_KEY_SECRET:"s",RAZORPAY_TEST_WEBHOOK_SECRET:SECRET});
 delete process.env.RAZORPAY_VENDOR_PACKAGE_EVENT_LEDGER_MODE;
 Object.assign(state,{order,orders,rpcs:[],fetches:[],rpcImpl:async()=>({data:receipt})});
 globalThis.fetch=async u=>{state.fetches.push(String(u));return new Response(JSON.stringify(pay),{status:200})};
}
test.afterEach(()=>{globalThis.fetch=realFetch;for(const k of Object.keys(process.env))if(!(k in env))delete process.env[k];Object.assign(process.env,env)});
const run=()=>{const raw=body();return svc.handleVendorPackageRazorpayWebhook(raw,sign(raw),"evt_RC34ABC123")};
const activations=()=>state.rpcs.filter(r=>r.n==="qf_activate_vendor_package_order_v2");

test("inrToSubunits: whole-paise prices are exact; sub-paise/float-divergent prices fail closed",()=>{
 for(const [price,paise] of [[2500,250000],[19.99,1999],[0.29,29],[1.1,110],[4999.95,499995],["1499.00",149900],["10.000",1000],[1000000000.29,100000000029]])
  assert.equal(rz.inrToSubunits(price),paise,String(price));
 // 1.005: SQL round(100.5)=101, JS float gave 100. Must now refuse, not diverge.
 for(const price of [1.005,2500.004,0.001,99.999,2.675,1000000000.005,"1.0000000001"])
  assert.throws(()=>rz.inrToSubunits(price),/PACKAGE_PRICE_INVALID/,String(price));
 for(const price of [0,-1,NaN,Infinity,null,undefined,"abc"])
  assert.throws(()=>rz.inrToSubunits(price),/PACKAGE_PRICE_INVALID/,String(price));
});

test("sub-paise package price never reaches provider GET or activation RPC and is quarantine-classified",async()=>{
 setup({order:baseOrder({package_price:1.005,provider_amount_subunits:100})});
 const r=await run();
 assert.equal(r.ok,false);assert.equal(r.code,"PACKAGE_ORDER_SNAPSHOT_INVALID");
 assert.equal(activations().length,0);
 assert.equal(classifyVendorPackageWebhookFailure("PACKAGE_ORDER_SNAPSHOT_INVALID"),"quarantine");
});

test("stored provider amount drifted from package price: a matching tiny capture cannot mint credits",async()=>{
 // Provider really captured 100 paise against an order row whose stored amount
 // was tampered/drifted to 100 while the package price is 2500.
 setup({order:baseOrder({provider_amount_subunits:100}),pay:payment({amount:100})});
 const r=await run();
 assert.equal(r.ok,false);assert.equal(r.code,"PACKAGE_ORDER_AMOUNT_DRIFT");
 assert.equal(activations().length,0);
 assert.equal(classifyVendorPackageWebhookFailure("PACKAGE_ORDER_AMOUNT_DRIFT"),"quarantine");
});

test("missing stored amount is not silently replaced by the package price",async()=>{
 for(const missing of [null,undefined]){
  setup({order:baseOrder({provider_amount_subunits:missing})});
  const r=await run();
  assert.equal(r.ok,false);assert.equal(r.code,"PACKAGE_ORDER_NOT_BOUND");
  assert.equal(activations().length,0);
 }
});

test("amount or price drift during the provider GET window is refused before Core",async()=>{
 setup({orders:[baseOrder(),baseOrder({provider_amount_subunits:100})]});
 let r=await run();
 assert.equal(r.ok,false);assert.equal(r.code,"PACKAGE_ORDER_AMOUNT_DRIFT");
 assert.equal(activations().length,0);
 setup({orders:[baseOrder(),baseOrder({package_price:1})]});
 r=await run();
 assert.equal(r.ok,false);assert.equal(r.code,"PACKAGE_ORDER_AMOUNT_DRIFT");
 assert.equal(activations().length,0);
});

test("regression: consistent order and exact capture still activate once and replay idempotently",async()=>{
 setup();
 assert.deepEqual(await run(),{ok:true,data:{status:"activated"}});
 assert.equal(activations().length,1);
 setup({rpc:null,order:baseOrder({activation_status:"activated",order_status:"completed",payment_status:"paid",provider_payment_id:"pay_RC34ABC123"})});
 state.rpcImpl=async()=>({data:{status:"already_applied",order_id:ORDER_ID,credits_added:0}});
 assert.deepEqual(await run(),{ok:true,data:{status:"already_activated"}});
 // provider amount mismatch against the verified stored amount is still refused
 setup({pay:payment({amount:249999})});
 const r=await run();
 assert.equal(r.ok,false);assert.equal(r.code,"PAYMENT_AMOUNT_MISMATCH");
 assert.equal(activations().length,0);
});
