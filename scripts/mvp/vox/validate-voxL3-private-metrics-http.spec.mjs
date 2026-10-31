// Executes REAL Core L3 TS route in VM; injected Auth/RPC are synthetic.
// This proves route security denials, NOT actual Staging signed transport.
import test,{beforeEach} from "node:test";
import assert from "node:assert/strict";
import {createHmac} from "node:crypto";
import {readFileSync} from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import {signCoreOutboxMetricEnvelope as sign}
 from "../../../contracts/vox/outboxMetricsAttestation.mjs";
const id=n=>"00000000-0000-4000-8000-"+String(n).padStart(12,"0");
const SECRET="TEST_ONLY_SHARED_SIGNING_MATERIAL_NOT_PRODUCTION_2026";
const metrics=()=>({schema:"qf.vox.internal-notification-outbox.metrics.v1",
 source:"QUICKFURNO_CORE",observedAt:new Date().toISOString(),
 collectionId:id(8),pending:1,leased:0,completed:3,deadLetter:0,
 oldestPendingAgeSeconds:10,maxAttemptsObserved:1,
 totalKnown:false,includesExternalProviderDelivery:false});
const state={env:{},verified:true,actor:"qf-agni-control-plane",rpcError:false,
 rpcCalls:0,verifyCalls:0};
const reset=()=>{state.env={VOX_AGNI_OUTBOX_METRICS_ENABLED:"staging",
 VOX_STAFF_GRANTS_ENABLED:"staging",
 QF_AGNI_VERIFICATION_KEYS_JSON:"TEST_KEYS",
 VOX_AGNI_OUTBOX_SIGNING_KEY:SECRET};
 state.verified=true;state.actor="qf-agni-control-plane";
 state.rpcError=false;state.rpcCalls=0;state.verifyCalls=0;};
const ctx=vm.createContext({process:{env:new Proxy({},{
 get(_t,key){return state.env[key]},
 set(_t,key,value){state.env[key]=value;return true}
})},URL,Request,Response,Date,Buffer,Uint8Array,JSON});
const raw=readFileSync(new URL("../../../app/api/internal/agni/owner-outbox-metrics/route.ts",import.meta.url),"utf8");
const compiled=ts.transpileModule(raw,{compilerOptions:{module:ts.ModuleKind.ESNext,
 target:ts.ScriptTarget.ES2022}}).outputText;
const route=new vm.SourceTextModule(compiled,{context:ctx,identifier:"VOX_L3_ACTUAL_CORE_ROUTE"});
const mocks=new Map([
 ["next/server",{NextResponse:{json:(b,{status,headers}={})=>Response.json(b,{status,headers})}}],
 ["node:crypto",{randomUUID:()=>id(33)}],
 ["@/lib/supabase",{adminClient:()=>({rpc:async(name)=>{
  state.rpcCalls++;assert.equal(name,"qf_vox_staff_notification_outbox_metrics_v1");
  return state.rpcError?{error:{code:"MISSING"},data:null}:{error:null,data:metrics()};
 }})}],
 ["@/lib/jarvis/coreDecisionAuth",{parseQfjVerificationKeys:val=>val==="TEST_KEYS"?[{}]:null}],
 ["@/lib/jarvis/scaleRequestGuard",{
  qfjScaleHeadersForResult:()=>({}),
  qfjScaleHttpStatus:()=>403,
  verifyQfjScaleWebRequest:args=>{
   state.verifyCalls++;
   assert.equal(args.path,"/api/internal/agni/owner-outbox-metrics");
   assert.equal(args.allowLegacy,false);
   return state.verified?{ok:true,mode:"v1",metadata:{actor:state.actor}}:
    {ok:false,errorClass:"QFJ_REMOTE_REFUSED"};
  }}],
 ["@/contracts/vox/outboxMetricsAttestation.mjs",{signCoreOutboxMetricEnvelope:sign}]
]);
await route.link(name=>{
 const obj=mocks.get(name);if(!obj)throw Error("UNDECLARED_IMPORT:"+name);
 return new vm.SyntheticModule(Object.keys(obj),function(){
  for(const [k,v] of Object.entries(obj))this.setExport(k,v);
 },{context:ctx,identifier:name});
});
await route.evaluate();
const api=route.namespace;
const req=(payload={protocol:"qf.vox.agni.outbox.read.request.v1"},h="application/json")=>
 new Request("https://staging-core.quickfurno.in/api/internal/agni/owner-outbox-metrics",{
 method:"POST",headers:{"content-type":h},body:JSON.stringify(payload)});
beforeEach(reset);
test("both staging flags required before M2M Auth and DB",async()=>{
 for(const name of ["VOX_AGNI_OUTBOX_METRICS_ENABLED","VOX_STAFF_GRANTS_ENABLED"]){
  state.env[name]="off";
  const r=await api.POST(req());
  assert.equal(r.status,503);assert.equal(state.rpcCalls,0);
  assert.equal(state.verifyCalls,0);state.env[name]="staging";
 }
});
test("wrong content type and unknown payload rejected before credentials",async()=>{
 assert.equal((await api.POST(req({protocol:"X"}))).status,400);
 assert.equal((await api.POST(req(undefined,"text/plain"))).status,415);
 assert.equal((await api.POST(req({protocol:"qf.vox.agni.outbox.read.request.v1",
  actor:"OWNER_SELF_GRANTED"}))).status,400);
 assert.equal(state.verifyCalls,0);assert.equal(state.rpcCalls,0);
});
test("old or forged M2M signature fails without database read",async()=>{
 state.verified=false;
 assert.equal((await api.POST(req())).status,403);
 assert.equal(state.rpcCalls,0);
});
test("signed request with wrong actor fails",async()=>{
 state.actor="qf-jarvis-untrusted";
 assert.equal((await api.POST(req())).status,403);
 assert.equal(state.rpcCalls,0);
});
test("absent signing key and absent trusted verification keys fail closed",async()=>{
 state.env.VOX_AGNI_OUTBOX_SIGNING_KEY="";
 assert.equal((await api.POST(req())).status,503);
 state.env.VOX_AGNI_OUTBOX_SIGNING_KEY=SECRET;
 state.env.QF_AGNI_VERIFICATION_KEYS_JSON="BAD";
 assert.equal((await api.POST(req())).status,503);
 assert.equal(state.rpcCalls,0);
});
test("private RPC absent fails closed and never fabricates counts",async()=>{
 state.rpcError=true;
 const r=await api.POST(req());
 assert.equal(r.status,503);
 assert.equal((await r.json()).error,"metric_reader_unavailable");
});
test("real handler returns only HMAC signed Core aggregate to verified AGNI actor",async()=>{
 const r=await api.POST(req());
 assert.equal(r.status,200);
 const b=await r.json();
 assert.deepEqual(Object.keys(b).sort(),[
  "protocol","source","token","mode","actionsEnabled","providerMessagesSent"].sort());
 assert.equal(b.mode,"READ_ONLY");assert.equal(b.actionsEnabled,false);
 assert.equal(b.providerMessagesSent,0);
 const [token,sig]=b.token.split(".");
 assert.equal(sig,createHmac("sha256",SECRET).update(token).digest("base64url"));
 const payload=JSON.parse(Buffer.from(token,"base64url").toString("utf8"));
 assert.equal(payload.aud,"qf-agni-owner-gateway");
 assert.equal(payload.iss,"quickfurno-core");
 assert.equal(payload.metric.pending,1);
 assert.equal(payload.metric.includesExternalProviderDelivery,false);
 assert.equal(state.rpcCalls,1);
});
test("mutation verbs and browser GET prohibited",()=>{
 for(const verb of ["GET","PUT","PATCH","DELETE"]){
  const r=api[verb]();
  assert.equal(r.status,405);
 }
});
