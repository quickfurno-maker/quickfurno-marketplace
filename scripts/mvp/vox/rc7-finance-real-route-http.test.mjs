import test from "node:test";
import assert from "node:assert/strict";
import {build} from "esbuild";
import {mkdtempSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {resolve,join,dirname} from "node:path";
import {pathToFileURL,fileURLToPath} from "node:url";
const root=resolve(dirname(fileURLToPath(import.meta.url)),"../../..");
const tmp=mkdtempSync(join(tmpdir(),"qf-vox-finance-route-"));
const outfile=join(tmp,"route.mjs");
await build({
 entryPoints:[resolve(root,"app/api/vox/v1/finance/route.ts")],
 outfile,bundle:true,platform:"node",format:"esm",target:"node24",logLevel:"silent",
 plugins:[{name:"no-live-core-mocks",setup(build){
  build.onResolve({filter:/^server-only$/},()=>({path:"server-only",namespace:"mock"}));
  build.onResolve({filter:/^@\/lib\/supabase$/},()=>({path:"supabase",namespace:"mock"}));
  build.onResolve({filter:/^@\/services\/vox\/verifiedStaffBearer$/},()=>({path:"verified",namespace:"mock"}));
  build.onResolve({filter:/^@\//},args=>({path:resolve(root,args.path.slice(2))}));
  build.onLoad({filter:/.*/,namespace:"mock"},args=>({
   loader:"js",contents:args.path==="verified"?
    "export async function verifyVoxOwnerBearer(){return globalThis.__voxMock.nextOwner();}":
    args.path==="supabase"?
    "export function adminClient(){return globalThis.__voxMock.adminClient();}":""
  }));
 }}]
});
const route=await import(pathToFileURL(outfile).href);
const OWNER="11111111-1111-4111-8111-111111111111";
const VENDOR="22222222-2222-4222-8222-222222222222";
const order={id:OWNER,vendor_id:VENDOR,package_price:"2500.00",
 package_currency:"INR",credits_included:4,order_status:"completed",
 payment_status:"paid",activation_status:"activated",
 created_at:"2026-10-30T09:00:00Z",provider_payment_id:"pay_never_expose"};
const prev={VOX_FINANCE_READ_ENABLED:process.env.VOX_FINANCE_READ_ENABLED,
 VOX_STAFF_READ_ENABLED:process.env.VOX_STAFF_READ_ENABLED,
 VOX_STAFF_GRANTS_ENABLED:process.env.VOX_STAFF_GRANTS_ENABLED};
const setFlags=enabled=>{for(const key of Object.keys(prev))
 if(enabled)process.env[key]="staging";else delete process.env[key];};
const mock=(rows=[order],owners=[OWNER,OWNER])=>{
 let checks=0,reads=0;
 globalThis.__voxMock={
  nextOwner:async()=>owners[checks++]??null,
  adminClient:()=>({
   from(table){
    assert.equal(table,"vendor_package_orders");reads++;
    return {
     select(cols){
      assert.doesNotMatch(cols,/provider_payment_id|provider_order_id|phone/);
      return {
       order(column,settings){
        assert.equal(column,"created_at");
        assert.equal(settings.ascending,false);
        return {
         limit:async limit=>{
          assert.equal(limit,21);
          return {data:rows,error:null};
         }
        };
       }
      };
     }
    };
   }
  })
 };
 return {get checks(){return checks},get reads(){return reads}};
};
const req=(path="/api/vox/v1/finance")=>new Request("https://staging-core.quickfurno.in"+path,{headers:{authorization:"Bearer mock-token"}});
test("default disabled: no Owner verification or database read",async()=>{
 setFlags(false);const spies=mock();
 const r=await route.GET(req());assert.equal(r.status,503);
 assert.equal((await r.json()).error,"FINANCE_PREVIEW_DISABLED");
 assert.equal(spies.checks,0);assert.equal(spies.reads,0);
});
test("strict URL filters and Owner authorization deny without SQL",async()=>{
 setFlags(true);const s=mock();
 assert.equal((await route.GET(req("?page=2"))).status,400);
 assert.equal(s.reads,0);
 const denied=mock([order],[null]);
 assert.equal((await route.GET(req())).status,403);
 assert.equal(denied.reads,0);
});
test("actual route success strips sensitive payment metadata and is uncacheable",async()=>{
 setFlags(true);const s=mock();
 const r=await route.GET(req());assert.equal(r.status,200);
 assert.match(r.headers.get("cache-control"),/no-store/);
 assert.equal(r.headers.get("vary"),"Authorization");
 const body=await r.json();assert.equal(body.ok,true);
 assert.equal(body.previewCount,1);assert.equal(body.canRefund,false);
 assert.equal(body.hasProviderConfirmation,false);
 assert.equal(body.orders[0].recordedOrderAmount,2500);
 assert.equal(JSON.stringify(body).includes("pay_never_expose"),false);
 assert.equal(s.checks,2);assert.equal(s.reads,1);
});
test("Owner revoked during async query cannot receive the result",async()=>{
 setFlags(true);const s=mock([order],[OWNER,null]);
 const r=await route.GET(req());assert.equal(r.status,403);
 assert.equal((await r.json()).error,"OWNER_AUTH_REVOKED_DURING_READ");
 assert.equal(s.checks,2);assert.equal(s.reads,1);
});
test("over-limit and corrupt Core rows fail closed",async()=>{
 setFlags(true);
 for(const rows of [Array(21).fill(order),[{...order,package_currency:"USD"}]]){
  mock(rows);const r=await route.GET(req());assert.equal(r.status,503);
 }
});
test("all mutation HTTP verbs reject before touching Core",async()=>{
 setFlags(true);const s=mock();
 for(const verb of ["POST","PUT","PATCH","DELETE"]){
  const r=route[verb]();assert.equal(r.status,405);
 }
 assert.equal(s.checks,0);assert.equal(s.reads,0);
});
test("fixture cleanup",()=>{
 for(const [k,v] of Object.entries(prev))if(v===undefined)delete process.env[k];else process.env[k]=v;
 delete globalThis.__voxMock;
 rmSync(tmp,{recursive:true,force:true});
});
