import test from "node:test";
import assert from "node:assert/strict";
import {build} from "esbuild";
import {readFileSync,mkdtempSync,rmSync} from "node:fs";
import {resolve,join,dirname} from "node:path";
import {tmpdir} from "node:os";
import {fileURLToPath,pathToFileURL} from "node:url";
const root=resolve(dirname(fileURLToPath(import.meta.url)),"../../..");
const temp=mkdtempSync(join(tmpdir(),"rc69-real-bff-"));
const out=join(temp,"route.mjs");
await build({entryPoints:[resolve(root,"apps/vox-web/app/api/work-transitions/route.ts")],
 outfile:out,bundle:true,platform:"node",format:"esm",target:"node24",logLevel:"silent",
 plugins:[{name:"rc69-boundary",setup(b){
  b.onResolve({filter:/^server-only$/},()=>({path:"blank",namespace:"test"}));
  b.onResolve({filter:/(?:^|\\|\/)auth$/},()=>({path:"auth",namespace:"test"}));
  b.onResolve({filter:/(?:^|\\|\/)core$/},()=>({path:"core",namespace:"test"}));
  b.onLoad({filter:/.*/,namespace:"test"},a=>({loader:"js",contents:
   a.path==="auth"?`export const verifiedMfaSession=async()=>globalThis.__rc69.token;
    export const allowedOrigin=r=>r.headers.get("origin")==="http://127.0.0.1:3107"&&r.headers.get("host")==="127.0.0.1:3107";
    export const safeJson=(v,s=200)=>Response.json(v,{status:s});`:
   a.path==="core"?'export const origin=()=> "https://staging-core.quickfurno.in";':""}));
 }}]});
const api=await import(pathToFileURL(out).href);
const clientOut=join(temp,"ui-receipt.mjs");
await build({entryPoints:[resolve(root,"apps/vox-web/lib/rc69VerifiedWorkReceipt.ts")],
 outfile:clientOut,bundle:true,platform:"node",format:"esm",target:"node24",logLevel:"silent"});
const {isVerifiedWorkReceipt:isTrustedByStaffUi}=await import(pathToFileURL(clientOut).href);
const ITEM="11111111-1111-4111-8111-111111111111",
 NONCE="22222222-2222-4222-8222-222222222222";
const STATES={CLAIM:"ASSIGNED",START:"IN_PROGRESS",WAIT_EXTERNAL:"WAITING_EXTERNAL",
 REQUEST_APPROVAL:"WAITING_APPROVAL",BLOCK:"BLOCKED",RESUME:"IN_PROGRESS",COMPLETE:"DONE"};
const FLAGS=["VOX_STAFF_PORTAL_ENABLED","VOX_TEAM_WORKSPACE_ENABLED",
 "VOX_WORK_ACTIONS_UI_ENABLED","VOX_WORK_ACTIONS_ENABLED"];
const old=Object.fromEntries([...FLAGS,"VOX_STAFF_VIEW_MODE"].map(k=>[k,process.env[k]]));
const originalFetch=globalThis.fetch;
test.after(()=>{globalThis.fetch=originalFetch;for(const [k,v] of Object.entries(old))
 if(v===undefined)delete process.env[k];else process.env[k]=v;});
const command=(action,nonce=NONCE)=>({action,itemId:ITEM,expectedRevision:5,nonce,
 reason:["BLOCK","REQUEST_APPROVAL","COMPLETE"].includes(action)?"Documented internal workflow reason":""});
const receipt=(state,extra={})=>({ok:true,schema:"qf.vox.work.transaction.receipt.v1",
 workItemId:ITEM,nonce:NONCE,newState:state,revision:6,providerMessagesSent:0,
 affectsVendorLeadMatching:false,...extra});
const request=payload=>new Request("http://127.0.0.1:3107/api/work-transitions",
 {method:"POST",headers:{origin:"http://127.0.0.1:3107",host:"127.0.0.1:3107",
 "content-type":"application/json"},body:JSON.stringify(payload)});
function setup(reply){
 for(const k of FLAGS)process.env[k]="staging";
 process.env.VOX_STAFF_VIEW_MODE="scoped";
 globalThis.__rc69={token:"synthetic-staff-token",calls:[]};
 globalThis.fetch=async(url,opts)=>{
  globalThis.__rc69.calls.push({url:String(url),opts});
  return reply;
 };
}
test("real two-hop Core receipt survives Web BFF without losing UI-required schema and matching flag",async()=>{
 for(const [action,state] of Object.entries(STATES)){
  setup(Response.json(receipt(state)));
  const payload=command(action);
  const res=await api.POST(request(payload));
  assert.equal(res.status,200,action);
  const body=await res.json();
  assert.deepEqual(Object.keys(body).sort(),["affectsVendorLeadMatching","newState","nonce","ok","providerMessagesSent","revision","schema","status","workItemId"].sort());
  assert.equal(body.schema,"qf.vox.work.transaction.receipt.v1");
  assert.equal(body.affectsVendorLeadMatching,false);
  assert.equal(body.status,200);
  assert.equal(body.newState,state);
  assert.equal(body.workItemId,ITEM);
  assert.equal(body.revision,6);
  assert.equal(body.providerMessagesSent,0);
  // Genuine BFF output must pass the genuine client validator, not merely
  // individual server-side assertions, before the UI clears its nonce.
  assert.equal(isTrustedByStaffUi(body,{action,itemId:ITEM,nonce:NONCE,expectedRevision:5}),true);
  assert.equal(globalThis.__rc69.calls.length,1);
  assert.equal(globalThis.__rc69.calls[0].url,
   "https://staging-core.quickfurno.in/api/vox/v1/work-transitions");
  assert.deepEqual(JSON.parse(globalThis.__rc69.calls[0].opts.body),payload);
 }
});
test("Core success with forged side effects, wrong revision or state cannot become verified browser success",async()=>{
 for(const altered of [
  {schema:"wrong"},{providerMessagesSent:1},{affectsVendorLeadMatching:true},
  {revision:7},{newState:"DONE"},{workItemId:"other"},{nonce:"33333333-3333-4333-8333-333333333333"},{privateData:"secret"}]){
  setup(Response.json(receipt("ASSIGNED",altered)));
  const res=await api.POST(request(command("CLAIM")));
  assert.equal(res.status,503);
  const body=await res.json();
  assert.equal(body.error,"CORE_WORK_OUTCOME_UNKNOWN");
  assert.equal(body.committed,null);assert.equal(body.retrySameNonceOnly,true);
  assert.equal(isTrustedByStaffUi(body,{action:"CLAIM",itemId:ITEM,nonce:NONCE,expectedRevision:5}),false);
  assert.equal(JSON.stringify(body).includes("secret"),false);
 }
});
test("missing Staff token never sends a Core request",async()=>{
 setup(Response.json(receipt("ASSIGNED")));globalThis.__rc69.token=null;
 const res=await api.POST(request(command("CLAIM")));
 assert.equal(res.status,401);
 assert.equal(globalThis.__rc69.calls.length,0);
});
process.on("exit",()=>rmSync(temp,{recursive:true,force:true}));
