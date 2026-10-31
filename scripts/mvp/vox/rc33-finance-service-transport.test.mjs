// RC33 Finance: compiled real vendorPackagePaymentService webhook handler over a
// fake PostgREST transport and fake provider fetch. No network, no live
// provider, no managed DB. The durable ledger stays hard-off in source, so this
// proves the only reachable runtime (TEST + ledger off) never acknowledges an
// uncertain, refunded or unverifiable payment, and that LIVE/enforce fail closed.
import test from "node:test";
import assert from "node:assert/strict";
import {createHmac} from "node:crypto";
import {build} from "esbuild";
import {mkdirSync} from "node:fs";
import {resolve,dirname} from "node:path";
import {fileURLToPath,pathToFileURL} from "node:url";
import {RC28_PROVIDER_LEDGER_RUNTIME_INSTALLED} from "../../../lib/payments/vendorPackageProviderEventRepository.mjs";

const root=resolve(dirname(fileURLToPath(import.meta.url)),"../../..");
const outfile=resolve(root,"test-results/rc33-finance-service.mjs");
mkdirSync(resolve(root,"test-results"),{recursive:true});
const state={order:null,rpcs:[],rpcImpl:null,fetches:[],fetchImpl:null};
globalThis.__rc33={state};
const stubs={
 "supabase":`export const adminClient=()=>({
  from:()=>{const q={select:()=>q,eq:()=>q,maybeSingle:async()=>({data:globalThis.__rc33.state.order&&{...globalThis.__rc33.state.order},error:null})};return q},
  rpc:async(n,a)=>{const s=globalThis.__rc33.state;s.rpcs.push({n,a});return s.rpcImpl(n,a)}});`,
 "access":`export const requireVendorAccess=async()=>({ok:false,code:"UNAUTHORIZED",error:"x"});`,
};
await build({entryPoints:[resolve(root,"services/vendorPackagePaymentService.ts")],bundle:true,
 platform:"node",target:"node20",format:"esm",outfile,logLevel:"silent",
 plugins:[{name:"rc33-stubs",setup(b){
  b.onResolve({filter:/lib\/supabase$/},()=>({path:"supabase",namespace:"rc33"}));
  b.onResolve({filter:/\/vendorAccessService$/},()=>({path:"access",namespace:"rc33"}));
  b.onLoad({filter:/.*/,namespace:"rc33"},a=>({contents:stubs[a.path],loader:"js"}));
 }}]});
const svc=await import(pathToFileURL(outfile).href);

const SECRET="whsec_rc33_test_only";
const ORDER_ID="11111111-1111-4111-8111-111111111111";
const baseOrder=()=>({id:ORDER_ID,vendor_id:"v1",package_id:"p1",package_name:"Pack",package_price:2500,
 package_currency:"INR",credits_included:10,validity_days:30,order_status:"created",payment_status:"pending",
 payment_provider:"razorpay",payment_method:null,provider_order_id:"order_RC33ABC123",provider_payment_id:null,
 provider_amount_subunits:250000,provider_receipt:"x",provider_mode:"test",activation_status:"not_activated"});
const payment=(o={})=>({id:"pay_RC33ABC123",order_id:"order_RC33ABC123",amount:250000,currency:"INR",
 status:"captured",captured:true,...o});
const body=(kind="payment.captured")=>JSON.stringify({event:kind,payload:{payment:{entity:{id:"pay_RC33ABC123",order_id:"order_RC33ABC123"}}}});
const sign=raw=>createHmac("sha256",SECRET).update(raw).digest("hex");
const receipt={status:"applied",order_id:ORDER_ID,credits_added:10,
 vendor_package_id:"22222222-2222-4222-8222-222222222222",expires_at:"2027-01-01T00:00:00Z"};

const realFetch=globalThis.fetch;
const env={...process.env};
function setup({mode="test",ledger,pay=payment(),rpc,order=baseOrder(),fetchStatus=200}={}){
 Object.assign(process.env,{RAZORPAY_VENDOR_PACKAGE_MODE:mode,
  RAZORPAY_TEST_KEY_ID:"rzp_test_rc33",RAZORPAY_TEST_KEY_SECRET:"s",RAZORPAY_TEST_WEBHOOK_SECRET:SECRET,
  RAZORPAY_LIVE_KEY_ID:"rzp_live_rc33",RAZORPAY_LIVE_KEY_SECRET:"s",RAZORPAY_LIVE_WEBHOOK_SECRET:SECRET});
 if(ledger===undefined)delete process.env.RAZORPAY_VENDOR_PACKAGE_EVENT_LEDGER_MODE;
 else process.env.RAZORPAY_VENDOR_PACKAGE_EVENT_LEDGER_MODE=ledger;
 Object.assign(state,{order,rpcs:[],fetches:[],rpcImpl:rpc??(async()=>({data:receipt}))});
 globalThis.fetch=async u=>{state.fetches.push(String(u));
  return fetchStatus===200?new Response(JSON.stringify(pay),{status:200}):new Response("{}",{status:fetchStatus})};
}
test.afterEach(()=>{globalThis.fetch=realFetch;for(const k of Object.keys(process.env))if(!(k in env))delete process.env[k];Object.assign(process.env,env)});
const run=(raw=body(),eventId="evt_RC33ABC123")=>svc.handleVendorPackageRazorpayWebhook(raw,sign(raw),eventId);
const activations=()=>state.rpcs.filter(r=>r.n==="qf_activate_vendor_package_order_v2");

test("ledger runtime stays uninstalled (financial activation HOLD)",()=>assert.equal(RC28_PROVIDER_LEDGER_RUNTIME_INSTALLED,false));

test("TEST legacy: verified capture activates once; identical replay is idempotent already_activated",async()=>{
 setup();
 assert.deepEqual(await run(),{ok:true,data:{status:"activated"}});
 setup({rpc:async()=>({data:{status:"already_applied",order_id:ORDER_ID,credits_added:0}}),
  order:{...baseOrder(),activation_status:"activated",order_status:"completed",payment_status:"paid",provider_payment_id:"pay_RC33ABC123"}});
 assert.deepEqual(await run(),{ok:true,data:{status:"already_activated"}});
 assert.equal(activations().length,1);
});

test("partial and full refund never reach the activation RPC and are not acknowledged",async()=>{
 for(const pay of [payment({amount_refunded:50000,refund_status:"partial"}),payment({status:"refunded",amount_refunded:250000,refund_status:"full"})]){
  setup({pay});
  const r=await run();
  assert.equal(r.ok,false);assert.equal(r.code,"PAYMENT_REFUNDED");
  assert.equal(activations().length,0);
 }
});

test("uncertain provider/DB outcomes are never acknowledged",async()=>{
 setup({fetchStatus:503});assert.equal((await run()).ok,false);assert.equal(activations().length,0);
 setup({pay:payment({status:"authorized",captured:false})});assert.equal((await run()).ok,false);assert.equal(activations().length,0);
 // unknown COMMIT: activation RPC aborted/timeout, and malformed receipts
 setup({rpc:async()=>({error:{code:"57014",message:"canceling statement due to statement timeout"}})});
 assert.equal((await run()).ok,false);
 for(const data of [null,{},{status:"applied",order_id:ORDER_ID,credits_added:1},{status:"already_applied",order_id:ORDER_ID,credits_added:5}]){
  setup({rpc:async()=>({data})});
  const r=await run();
  assert.equal(r.ok,false);assert.equal(r.code,"PAYMENT_ACTIVATION_RECEIPT_INVALID");
 }
});

test("refund-locked and drifted orders refuse before provider-trusting Core call",async()=>{
 setup({order:{...baseOrder(),payment_status:"refund_pending"}});
 assert.equal((await run()).ok,false);assert.equal(activations().length,0);
 setup({order:{...baseOrder(),provider_payment_id:"pay_OTHER12345"}});
 assert.equal((await run()).ok,false);assert.equal(activations().length,0);
});

test("TEST and LIVE modes are distinct: cross-mode order and LIVE-without-ledger deny before any lookup or provider GET",async()=>{
 setup({order:{...baseOrder(),provider_mode:"live"}});
 assert.equal((await run()).ok,false);assert.equal(state.fetches.length,0);assert.equal(activations().length,0);
 setup({mode:"live",order:{...baseOrder(),provider_mode:"live"}});
 const live=await run();
 assert.equal(live.ok,false);assert.equal(state.fetches.length,0);assert.equal(state.rpcs.length,0);
 setup({ledger:"enforce"});
 const enforce=await run();
 assert.equal(enforce.ok,false);assert.equal(state.fetches.length,0);assert.equal(state.rpcs.length,0);
});

test("payment.failed outcomes: DB-confirmed only; malformed failure receipt is not acknowledged",async()=>{
 setup({rpc:async()=>({data:{status:"marked_failed",order_id:ORDER_ID}})});
 assert.deepEqual(await run(body("payment.failed")),{ok:true,data:{status:"failed_recorded"}});
 setup({rpc:async()=>({data:{status:"ignored_paid",order_id:ORDER_ID}})});
 assert.deepEqual(await run(body("payment.failed")),{ok:true,data:{status:"failure_ignored"}});
 setup({rpc:async()=>({data:{status:"weird",order_id:ORDER_ID}})});
 assert.equal((await run(body("payment.failed"))).ok,false);
});
