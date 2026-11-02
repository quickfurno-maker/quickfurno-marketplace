import test from "node:test";
import assert from "node:assert/strict";
import {build} from "esbuild";
import {mkdtempSync,rmSync,readFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join,resolve,dirname} from "node:path";
import {pathToFileURL,fileURLToPath} from "node:url";
import {projectRc11PaymentAttemptTimeline} from "../../../contracts/vox/rc11PaymentAttemptTimeline.mjs";
const root=resolve(dirname(fileURLToPath(import.meta.url)),"../../..");
const uuid=n=>"00000000-0000-4000-8000-"+String(n).padStart(12,"0");
const ORDER=uuid(1),A1=uuid(2),A2=uuid(3);
const make=(eventId=10,attempt=A1,seq=1)=>({
 event_id:uuid(eventId),order_id:ORDER,attempt_id:attempt,attempt_sequence:seq,
 environment:"TEST",event_kind:"REQUESTED",origin:"CORE_CHECKOUT",
 observed_at:"2026-10-30T15:00:00Z",recorded_at:"2026-10-30T15:00:01Z",
 request_token_hash:"a".repeat(64),event_digest:"b".repeat(64),
 provider_payment_id:"DONT_SHOW_PROVIDER_ID",transaction_id:"DONT_SHOW_UTR"
});
test("model projects globally unique exact attempt references without provider metadata",()=>{
 const x=projectRc11PaymentAttemptTimeline([make(),make(11,A2)],ORDER);
 assert.ok(x);assert.equal(x.eventCount,2);assert.equal(x.isCompleteHistory,false);
 assert.notEqual(x.events[0].attemptRef,x.events[1].attemptRef);
 for(const secret of ["DONT_SHOW_PROVIDER_ID","DONT_SHOW_UTR","request_token_hash","event_digest"])
  assert.equal(JSON.stringify(x).includes(secret),false,secret);
});
test("model fails closed on cross-order, duplicate, sequence and malformed evidence",()=>{
 for(const events of [[{...make(),order_id:uuid(9)}],
  [make(),make(10,A2)],[make(),make(11,A1)],
  [{...make(),environment:"STAGING"}],[{...make(),event_kind:"CAPTURED"}],
  [{...make(),observed_at:"garbage"}],Array.from({length:51},(_,i)=>make(50+i,A2,i+1))]){
  assert.equal(projectRc11PaymentAttemptTimeline(events,ORDER),null);
 }
});
const temp=mkdtempSync(join(tmpdir(),"vox-rc11-finance-"));
const outfile=join(temp,"route.mjs");
await build({entryPoints:[resolve(root,"app/api/vox/v1/finance/order/[orderId]/attempts/route.ts")],
 outfile,bundle:true,platform:"node",format:"esm",target:"node24",
 logLevel:"silent",plugins:[{name:"fake-auth-and-db",setup(b){
  b.onResolve({filter:/^server-only$/},()=>({path:"server-only",namespace:"fake"}));
  b.onResolve({filter:/^@\/lib\/supabase$/},()=>({path:"db",namespace:"fake"}));
  b.onResolve({filter:/^@\/services\/vox\/verifiedStaffBearer$/},()=>({path:"auth",namespace:"fake"}));
  b.onResolve({filter:/^@\//},a=>({path:resolve(root,a.path.slice(2))}));
  b.onLoad({filter:/.*/,namespace:"fake"},a=>({loader:"js",contents:
   a.path==="auth"?"export async function verifyVoxOwnerBearer(){return globalThis.__rc11.nextOwner();}":
   a.path==="db"?"export function adminClient(){return globalThis.__rc11.db();}":""}));
 }}]});
const route=await import(pathToFileURL(outfile).href);
const flags=["VOX_FINANCE_READ_ENABLED","VOX_FINANCE_DETAIL_READ_ENABLED",
 "VOX_FINANCE_ATTEMPTS_READ_ENABLED","VOX_STAFF_READ_ENABLED",
 "VOX_STAFF_GRANTS_ENABLED"];
const env=Object.fromEntries(flags.map(k=>[k,process.env[k]]));
const enable=on=>{for(const f of flags)if(on)process.env[f]="staging";else delete process.env[f];};
const fake=(rows=[make()],owners=[uuid(99),uuid(99)],order={id:ORDER})=>{
 let calls=0,auth=0;
 globalThis.__rc11={
  nextOwner:async()=>owners[auth++]??null,
  db:()=>({
   from:table=>({
    select:columns=>{
     assert.doesNotMatch(columns,/provider_payment_id|transaction_id|request_token_hash|event_digest|admin_notes/);
     calls++;
     if(table==="vendor_package_orders"){
      return {eq:(col,id)=>{
       assert.equal(col,"id");assert.equal(id,ORDER);
       return {maybeSingle:async()=>({data:order,error:null})};
      }};
     }
     if(table==="vox_rc11_payment_attempt_events_candidate_v1"){
      return {eq:(col,id)=>{
       assert.equal(col,"order_id");assert.equal(id,ORDER);
       return {order:(field,opts)=>{
        assert.equal(field,"recorded_at");assert.equal(opts.ascending,false);
        return {limit:async max=>{assert.equal(max,51);return {data:rows,error:null}}};
       }};
      }};
     }
     throw Error("UNREVIEWED_TABLE_"+table);
    }
   })
  })
 };
 return {get calls(){return calls},get auth(){return auth}};
};
const req=(id=ORDER,suffix="")=>new Request("https://local.test/api/vox/v1/finance/order/"+id+"/attempts"+suffix,
 {headers:{authorization:"Bearer a-synthetic-route-only-token"}});
const run=(id=ORDER,suffix="")=>route.GET(req(id,suffix),{params:Promise.resolve({orderId:id})});
test("default disabled and malformed ID must not reach the Core database",async()=>{
 enable(false);let s=fake();
 assert.equal((await run()).status,503);assert.equal(s.calls,0);assert.equal(s.auth,0);
 enable(true);s=fake();
 assert.equal((await run("invalid")).status,400);
 assert.equal((await run(ORDER,"?unexpected=1")).status,400);
 assert.equal(s.calls,0);
});
test("real API handler requires valid Owner, 2 rechecks, returns limited safe events",async()=>{
 enable(true);let s=fake([make(),make(11,A2)]);
 const r=await run();assert.equal(r.status,200);
 const data=await r.json();assert.equal(data.schema,"qf.vox.finance.attempt-evidence.v1");
 assert.equal(data.isProviderSettlementVerified,false);
 assert.equal(data.isCompleteHistory,false);
 assert.equal(data.eventCount,2);assert.equal(s.calls,2);assert.equal(s.auth,2);
 assert.match(r.headers.get("cache-control"),/no-store/);
 assert.doesNotMatch(JSON.stringify(data),/DONT_SHOW_UTR|DONT_SHOW_PROVIDER_ID/);
});
test("missing/revoked Owner and missing order fail closed",async()=>{
 enable(true);let s=fake([make()],[null]);assert.equal((await run()).status,403);
 assert.equal(s.calls,0);
 s=fake([make()],[uuid(99),null]);assert.equal((await run()).status,403);
 assert.equal(s.auth,2);
 s=fake([make()],[uuid(99),uuid(99)],null);assert.equal((await run()).status,404);
});
test("oversized and cross-order evidence denied",async()=>{
 enable(true);let s=fake(Array.from({length:51},(_,i)=>make(50+i,A2,i+1)));
 assert.equal((await run()).status,503);
 s=fake([{...make(),order_id:uuid(99)}]);
 assert.equal((await run()).status,503);
});
test("all mutation verbs denied without reading DB",()=>{
 enable(true);const s=fake();
 for(const verb of ["POST","PUT","PATCH","DELETE"])assert.equal(route[verb]().status,405);
 assert.equal(s.calls,0);
});
test("VOX Web remains default-off with MFA-verified Core BFF and no payment actions",()=>{
 const core=readFileSync(resolve(root,"apps/vox-web/lib/core.ts"),"utf8");
 const fn=core.slice(core.indexOf("export async function fetchOwnerFinanceAttemptEvidence("),
  core.indexOf("export async function fetchOwnerFinanceOrderDetail("));
 assert.match(fn,/VOX_FINANCE_ATTEMPTS_READ_UI_ENABLED/);
 assert.match(fn,/verifiedMfaSession/);assert.match(fn,/cache:"no-store"/);
 assert.match(fn,/isProviderSettlementVerified!==false/);
 assert.doesNotMatch(fn,/\.rpc\(|razorpay|\.insert\(|\.update\(/);
 const page=readFileSync(resolve(root,"apps/vox-web/app/finance/[orderId]/page.tsx"),"utf8");
 assert.match(page,/fetchOwnerFinanceAttemptEvidence/);
 assert.match(page,/Not complete provider attempt history/);
});
test("restore environment and remove disposable bundle",()=>{
 for(const [k,v] of Object.entries(env))if(v===undefined)delete process.env[k];else process.env[k]=v;
 delete globalThis.__rc11;rmSync(temp,{recursive:true,force:true});
});
