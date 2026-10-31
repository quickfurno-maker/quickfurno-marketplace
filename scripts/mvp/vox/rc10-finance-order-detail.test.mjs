import test from "node:test";
import assert from "node:assert/strict";
import {build} from "esbuild";
import {mkdtempSync,rmSync,readFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join,resolve,dirname} from "node:path";
import {pathToFileURL,fileURLToPath} from "node:url";
import {projectRc10FinanceOrderDetail} from "../../../contracts/vox/rc10FinanceOrderDetail.mjs";
const root=resolve(dirname(fileURLToPath(import.meta.url)),"../../..");
const id="11111111-1111-4111-8111-111111111111",vendor="22222222-2222-4222-8222-222222222222",pkg="33333333-3333-4333-8333-333333333333";
const order={id,vendor_id:vendor,package_id:pkg,package_price:"3999.00",
 package_currency:"INR",credits_included:4,order_status:"completed",
 payment_status:"paid",activation_status:"activated",created_at:"2026-10-30T09:30:00Z",
 provider_payment_id:"SECRET_PAY",transaction_id:"SECRET_UTR"};
const payment={id,vendor_id:vendor,package_id:pkg,amount:"3999.00",
 payment_status:"Paid",created_at:"2026-10-30T09:31:00Z",
 transaction_id:"SECRET_UTR",admin_notes:"SECRET_NOTES"};
test("exact Order/Payments stable-ID correlation exposes only permitted recorded values",()=>{
 const result=projectRc10FinanceOrderDetail(order,payment);
 assert.ok(result);assert.equal(result.ledgerStatus,"CORE_RECORDS_AGREE");
 assert.equal(result.ledger.recordedAmount,3999);
 assert.equal(result.providerConfirmed,false);
 assert.equal(result.isAttemptHistoryComplete,false);
 for(const s of ["SECRET_PAY","SECRET_UTR","SECRET_NOTES","admin_notes"])
  assert.equal(JSON.stringify(result).includes(s),false,s);
});
test("inconsistent Core payment history fails closed; missing pending ledger is allowed",()=>{
 for(const p of [{...payment,id:pkg},{...payment,vendor_id:pkg},
   {...payment,amount:"3998"},{...payment,payment_status:"Failed"},
   {...payment,created_at:"not-a-date"}]){
  assert.equal(projectRc10FinanceOrderDetail(order,p),null);
 }
 assert.equal(projectRc10FinanceOrderDetail(order,null),null);
 const p={...order,payment_status:"pending",activation_status:"not_activated"};
 assert.equal(projectRc10FinanceOrderDetail(p,null).ledgerStatus,"NO_CORRELATED_PAYMENT_RECORD");
});
const tmp=mkdtempSync(join(tmpdir(),"vox-rc10-finance-handler-"));
const dest=join(tmp,"route.mjs");
await build({entryPoints:[resolve(root,"app/api/vox/v1/finance/order/[orderId]/route.ts")],
 outfile:dest,bundle:true,platform:"node",format:"esm",target:"node24",
 logLevel:"silent",plugins:[{name:"mock-secure-local-db",setup(build){
  build.onResolve({filter:/^server-only$/},()=>({path:"server-only",namespace:"mock"}));
  build.onResolve({filter:/^@\/lib\/supabase$/},()=>({path:"db",namespace:"mock"}));
  build.onResolve({filter:/^@\/services\/vox\/verifiedStaffBearer$/},()=>({path:"auth",namespace:"mock"}));
  build.onResolve({filter:/^@\//},a=>({path:resolve(root,a.path.slice(2))}));
  build.onLoad({filter:/.*/,namespace:"mock"},a=>({loader:"js",contents:
   a.path==="auth"?"export async function verifyVoxOwnerBearer(){return globalThis.__rc10.nextOwner();}":
   a.path==="db"?"export function adminClient(){return globalThis.__rc10.adminClient();}":""}));
 }}]});
const route=await import(pathToFileURL(dest).href);
const flags=["VOX_FINANCE_READ_ENABLED","VOX_FINANCE_DETAIL_READ_ENABLED",
 "VOX_STAFF_READ_ENABLED","VOX_STAFF_GRANTS_ENABLED"];
const prev=Object.fromEntries(flags.map(key=>[key,process.env[key]]));
const enable=v=>{for(const key of flags)if(v)process.env[key]="staging";else delete process.env[key];};
const fake=(o=order,p=payment,owners=[id,id])=>{
 let lookups=0,checks=0;
 globalThis.__rc10={
  nextOwner:async()=>owners[checks++]??null,
  adminClient:()=>({from:table=>{
   assert.ok(["vendor_package_orders","payments"].includes(table));lookups++;
   return {select:columns=>{
    assert.doesNotMatch(columns,/transaction_id|admin_notes|provider_payment_id|provider_order_id|phone/);
    return {eq:(key,value)=>{
     assert.equal(key,"id");assert.equal(value,id);
     return {maybeSingle:async()=>({data:table==="payments"?p:o,error:null})};
    }};
   }};
  }})
 };
 return {get lookups(){return lookups},get checks(){return checks}};
};
const req=(idParam=id,search="")=>new Request("https://local.test/api/vox/v1/finance/order/"+idParam+search,
 {headers:{authorization:"Bearer synthetic-for-route-only"}});
const run=(idParam=id,search="")=>route.GET(req(idParam,search),{params:Promise.resolve({orderId:idParam})});
test("default gates deny even before auth/database",async()=>{
 enable(false);const s=fake();
 const r=await run();assert.equal(r.status,503);
 assert.equal(s.lookups,0);assert.equal(s.checks,0);
});
test("invalid order ID and unauthorized Owner AAL2 deny without database disclosure",async()=>{
 enable(true);const s=fake();
 assert.equal((await run("not-an-id")).status,400);
 assert.equal((await run(id,"?query=anything")).status,400);
 assert.equal(s.lookups,0);
 const denied=fake(order,payment,[null]);
 assert.equal((await run()).status,403);
 assert.equal(denied.lookups,0);
});
test("real route responds with strict read-only correlated facts and no sensitive columns",async()=>{
 enable(true);const s=fake();
 const r=await run();assert.equal(r.status,200);
 assert.match(r.headers.get("cache-control"),/no-store/);
 const body=await r.json();assert.equal(body.schema,"qf.vox.finance.order-detail.v1");
 assert.equal(body.detail.ledgerStatus,"CORE_RECORDS_AGREE");
 assert.equal(body.detail.providerConfirmed,false);
 assert.equal(JSON.stringify(body).includes("SECRET_PAY"),false);
 assert.equal(JSON.stringify(body).includes("SECRET_UTR"),false);
 assert.equal(s.lookups,2);assert.equal(s.checks,2);
});
test("revoked Owner and mismatched order/payment records fail closed",async()=>{
 enable(true);
 let s=fake(order,payment,[id,null]);let r=await run();assert.equal(r.status,403);assert.equal(s.checks,2);
 s=fake(order,{...payment,amount:"2500"});r=await run();assert.equal(r.status,503);
 assert.equal((await r.json()).error,"CORE_FINANCE_RECORD_MISMATCH");
});
test("mutation verbs never touch Core",()=>{
 enable(true);const s=fake();
 for(const method of ["POST","PUT","PATCH","DELETE"])
  assert.equal(route[method]().status,405);
 assert.equal(s.lookups,0);
});
test("web data path is MFA and Core gated, safe, linked, and uncacheable",()=>{
 const core=readFileSync(resolve(root,"apps/vox-web/lib/core.ts"),"utf8");
 const fn=core.slice(core.indexOf("export async function fetchOwnerFinanceOrderDetail("),
  core.indexOf("export async function fetchOwnerFinancePreview()"));
 assert.match(fn,/VOX_FINANCE_DETAIL_READ_UI_ENABLED/);
 assert.match(fn,/verifiedMfaSession/);assert.match(fn,/const base=origin\(\)/);
 assert.match(fn,/cache:"no-store"/);assert.match(fn,/redirect:"error"/);
 assert.match(fn,/providerConfirmed!==false/);
 assert.doesNotMatch(fn,/\.rpc\(|razorpayFetch|\.insert\(|\.update\(/);
 const page=readFileSync(resolve(root,"apps/vox-web/app/finance/[orderId]/page.tsx"),"utf8");
 const list=readFileSync(resolve(root,"apps/vox-web/app/finance/page.tsx"),"utf8");
 assert.match(page,/fetchOwnerFinanceOrderDetail/);
 assert.match(page,/incomplete/);
 assert.match(list,/href=\{"\/finance\/"\+o\.orderId\}/);
});
test("cleanup synthetic flags and isolated route harness",()=>{
 for(const [k,v] of Object.entries(prev))if(v===undefined)delete process.env[k];else process.env[k]=v;
 delete globalThis.__rc10;rmSync(tmp,{recursive:true,force:true});
});
