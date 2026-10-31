import test from "node:test";
import assert from "node:assert/strict";
import {build} from "esbuild";
import {mkdtempSync,readFileSync,writeFileSync,existsSync,statSync} from "node:fs";
import {tmpdir} from "node:os";
import {join,resolve,dirname} from "node:path";
import {pathToFileURL,fileURLToPath} from "node:url";
import {classifyVendorPackageRefundIntake} from "../../../lib/payments/vendorPackageRefundIntake.mjs";
import {buildRazorpayProviderEventEnvelope} from "../../../lib/payments/vendorPackageProviderEventLedger.mjs";
import {createRefundIntakeReviewer} from "../../../lib/payments/vendorPackageRefundIntakeReview.mjs";
import {FINANCE_REFUND_REVIEW_ROLES,authorizeRefundReviewer,issueVerifiedFinanceReviewer,
 createFinanceRefundReviewService,projectRefundIntakePreview}
 from "../../../lib/payments/vendorPackageRefundReviewAuthority.mjs";
const root=resolve(dirname(fileURLToPath(import.meta.url)),"../../..");
const U="11111111-1111-4111-8111-111111111111";
const FORGED="99999999-9999-4999-8999-999999999999";
const TEAM="22222222-2222-4222-8222-222222222222";
const CITY="33333333-3333-4333-8333-333333333333";
const paymentId="pay_RC37ABCDE",orderId="order_RC37ABCDE",refundId="rfnd_RC37ABCDE";
const hash="a".repeat(64);
const refundEvent=name=>({event:name,payload:{refund:{entity:{id:refundId,payment_id:paymentId}},
 payment:{entity:{id:paymentId,order_id:orderId}}}});
const envelope=(name="refund.processed",eventId="evt_RC37PROCESSED1")=>buildRazorpayProviderEventEnvelope({
 eventId,providerMode:"test",bodySha256:hash,candidate:classifyVendorPackageRefundIntake(refundEvent(name))});
const principal=(role="finance_reviewer",o={})=>issueVerifiedFinanceReviewer({userId:U,staffRole:role,
 aal:"aal2",expiresAtMs:Date.now()+600000,teamId:TEAM,cityId:CITY,...o});

test("no canonical finance role: approved set is empty and everything denies",()=>{
 assert.deepEqual([...FINANCE_REFUND_REVIEW_ROLES],[]);
 assert.equal(Object.isFrozen(FINANCE_REFUND_REVIEW_ROLES),true);
 const p=principal();
 assert.equal(authorizeRefundReviewer(p).reason,"FINANCE_REVIEW_ROLE_NOT_CANONICAL");
 assert.equal(authorizeRefundReviewer(p,[]).ok,false);
 assert.equal(authorizeRefundReviewer(p,"finance_reviewer").ok,false);
});
test("principal minting rejects non-AAL2, expired, malformed and unknown shapes",()=>{
 for(const bad of [{aal:"aal1"},{expiresAtMs:Date.now()-1},{userId:"nope"},{staffRole:""},
  {teamId:"x"},{cityId:undefined},{expiresAtMs:1.5}])
  assert.equal(principal("finance_reviewer",bad),null);
 assert.equal(issueVerifiedFinanceReviewer(null),null);
});
test("forged/unissued principals never authorize, even with a role list",()=>{
 const literal={userId:U,staffRole:"finance_reviewer",aal:"aal2",expiresAtMs:Date.now()+1e6,teamId:TEAM,cityId:CITY};
 assert.equal(authorizeRefundReviewer(literal,["finance_reviewer"]).reason,"FINANCE_REVIEWER_NOT_VERIFIED");
 assert.equal(authorizeRefundReviewer({...principal()},["finance_reviewer"]).ok,false);
 assert.equal(authorizeRefundReviewer(null,["finance_reviewer"]).ok,false);
 assert.equal(authorizeRefundReviewer(principal("support_agent"),["finance_reviewer"]).reason,"FINANCE_REVIEW_ROLE_FORBIDDEN");
 const p=principal();
 assert.equal(authorizeRefundReviewer(p,["finance_reviewer"],p.expiresAtMs+1).reason,"FINANCE_REVIEWER_SESSION_INVALID");
 assert.equal(authorizeRefundReviewer(p,["finance_reviewer"]).reviewerId,U);
});
test("default service performs zero RPCs: fail-closed writer",async()=>{
 let calls=0;
 const svc=createFinanceRefundReviewService({callRpc:async()=>{calls++;return {data:null}}});
 const r=await svc.review(principal(),{envelope:envelope(),decision:"escalated_for_policy_decision"});
 assert.equal(r.ok,false);assert.equal(r.reason,"FINANCE_REVIEW_ROLE_NOT_CANONICAL");
 assert.equal(r.refundAllowed,false);assert.equal(r.creditMutation,false);assert.equal(calls,0);
});
test("reviewer id comes only from the verified principal, never the caller",async()=>{
 const seen=[];
 const svc=createFinanceRefundReviewService({approvedRoles:["finance_reviewer"],callRpc:async(name,args)=>{
  seen.push({name,args});
  return {data:{event_id:args.p_event_id,provider_mode:"test",refund_id:args.p_refund_id,
   status:"reviewed",decision:args.p_decision,reviewable_credits:null}};
 }});
 const input={envelope:envelope(),decision:"escalated_for_policy_decision"};
 for(const smuggle of [{reviewerId:FORGED},{reviewerId:undefined},{principal:principal()}]){
  const r=await svc.review(principal(),{...input,...smuggle});
  assert.equal(r.reason,"REFUND_REVIEW_CALLER_IDENTITY_REJECTED");
 }
 assert.equal(seen.length,0);
 assert.equal((await svc.review({...principal()},input)).ok,false);
 assert.equal((await svc.review(null,input)).ok,false);
 assert.equal(seen.length,0);
 const ok=await svc.review(principal(),input);
 assert.equal(ok.ok,true);assert.equal(ok.refundAllowed,false);assert.equal(ok.creditMutation,false);
 assert.equal(seen.length,1);assert.equal(seen[0].name,"qf_review_vendor_package_refund_intake_v3");
 assert.equal(seen[0].args.p_reviewer_id,U);
 assert.equal(seen[0].args.p_refund_id,refundId);assert.equal(seen[0].args.p_payment_id,paymentId);
});
test("refund id is bound to the signed envelope and required for the bound reviewer",async()=>{
 const e=envelope();assert.equal(e.refundId,refundId);
 const pay=buildRazorpayProviderEventEnvelope({eventId:"evt_RC37CAPTURED1",providerMode:"test",
  bodySha256:hash,candidate:{kind:"captured",paymentId,providerOrderId:orderId}});
 assert.equal(Object.hasOwn(pay,"refundId"),false);
 let calls=0;
 const bound=createRefundIntakeReviewer(async()=>{calls++;return {data:null}},{refundBound:true});
 for(const bad of [{...e,refundId:undefined},{...e,refundId:"rfnd_"},{...e,refundId:"rfnd_x y12345"},{...e,paymentId:undefined}]){
  const r=await bound.review({envelope:bad,reviewerId:U,decision:"escalated_for_policy_decision"});
  assert.equal(r.reason,"REFUND_REVIEW_REFUND_ID_REQUIRED");
 }
 assert.equal(calls,0);
});
test("refund-bound replay: second event of the SAME refund cannot get a new decision",async()=>{
 // Fake mirrors qf_review_vendor_package_refund_intake_v3: first decision per refund wins.
 const store=new Map();
 const rpc=async(name,a)=>{
  assert.equal(name,"qf_review_vendor_package_refund_intake_v3");
  const key=a.p_provider_mode+":"+a.p_refund_id;
  if(!store.has(key))store.set(key,{event:a.p_event_id,rev:a.p_reviewer_id,dec:a.p_decision,cr:a.p_reviewable_credits});
  const v=store.get(key);
  const same=v.event===a.p_event_id&&v.rev===a.p_reviewer_id&&v.dec===a.p_decision&&v.cr===a.p_reviewable_credits;
  return {data:{event_id:a.p_event_id,provider_mode:a.p_provider_mode,refund_id:a.p_refund_id,
   status:same?"reviewed":"review_conflict",decision:v.dec,reviewable_credits:v.cr}};
 };
 const svc=createFinanceRefundReviewService({approvedRoles:["finance_reviewer"],callRpc:rpc});
 const created=envelope("refund.created","evt_RC37CREATED001"),processed=envelope();
 const d="escalated_for_policy_decision";
 assert.equal((await svc.review(principal(),{envelope:created,decision:d})).ok,true);
 assert.equal((await svc.review(principal(),{envelope:created,decision:d})).ok,true,"identical retry idempotent");
 const second=await svc.review(principal(),{envelope:processed,decision:d});
 assert.equal(second.ok,false);assert.equal(second.reason,"REFUND_REVIEW_CONFLICT");
 const other=await svc.review(principal("finance_reviewer",{userId:FORGED}),{envelope:created,decision:d});
 assert.equal(other.reason,"REFUND_REVIEW_CONFLICT");
 // A receipt that omits/forges the refund id is rejected, not trusted.
 const forged=createRefundIntakeReviewer(async a=>({data:{event_id:"evt_RC37PROCESSED1",provider_mode:"test",
  refund_id:"rfnd_OTHER12345",status:"reviewed",decision:d,reviewable_credits:null}}),{refundBound:true});
 assert.equal((await forged.review({envelope:processed,reviewerId:U,decision:d})).reason,"REFUND_REVIEW_RECEIPT_INVALID");
});
test("SQL candidate binds one decision per provider refund, serialized and service-role only",()=>{
 const sql=readFileSync(resolve(root,"scripts/mvp/vox/fixtures/rc37-review-only-refund-id-bound-review.pg17.sql"),"utf8");
 assert.match(sql,/PRIMARY KEY \(provider_mode,refund_id\)/);
 assert.match(sql,/ON CONFLICT \(provider_mode,refund_id\) DO NOTHING/);
 assert.match(sql,/pg_advisory_xact_lock/);
 assert.match(sql,/e\.payment_id IS DISTINCT FROM p_payment_id/);
 assert.match(sql,/FORCE ROW LEVEL SECURITY/);
 assert.match(sql,/REVOKE ALL ON FUNCTION[\s\S]*FROM PUBLIC/);
 assert.match(sql,/TO service_role/);
 assert.doesNotMatch(sql.replace(/--.*$/gm,""),/(?<!FOR )\bUPDATE\b|\bDELETE\b|vendor_package_orders|wallet|razorpay_fetch/i);
});
test("preview projection is strict and exposes no hash",()=>{
 const row={event_id:"evt_RC37PROCESSED1",provider_mode:"test",event_type:"refund.processed",
  payment_id:paymentId,provider_order_id:orderId,status:"quarantined",error_code:"REFUND_REVIEW_REQUIRED",body_sha256:hash};
 const out=projectRefundIntakePreview([row]);
 assert.equal(out.length,1);assert.equal(JSON.stringify(out).includes(hash),false);
 for(const bad of [{...row,status:"claimed"},{...row,error_code:"PAYMENT_REFUNDED"},{...row,event_type:"payment.captured"},
  {...row,provider_mode:"x"},{...row,payment_id:"pay_"}])assert.equal(projectRefundIntakePreview([bad]),null);
 assert.equal(projectRefundIntakePreview(new Array(21).fill(row)),null);
 assert.equal(projectRefundIntakePreview(null),null);
});

// ---- compiled TS auth + BFF negative tests (real verifier/route, mocked Supabase only) ----
const tmp=mkdtempSync(join(tmpdir(),"vox-rc37-"));
const authoritySrc=readFileSync(resolve(root,"lib/payments/vendorPackageRefundReviewAuthority.mjs"),"utf8");
const needle="export const FINANCE_REFUND_REVIEW_ROLES=Object.freeze([]);";
assert.ok(authoritySrc.includes(needle));
const rolePatched=join(tmp,"authority-with-role.mjs");
writeFileSync(rolePatched,authoritySrc.replace(needle,'export const FINANCE_REFUND_REVIEW_ROLES=Object.freeze(["finance_reviewer"]);')
 .replace('from "./vendorPackageRefundIntakeReview.mjs"',"from "+JSON.stringify(resolve(root,"lib/payments/vendorPackageRefundIntakeReview.mjs"))));
const compile=async(entry,name,patchRole)=>{
 const out=join(tmp,name);
 await build({entryPoints:[resolve(root,entry)],outfile:out,bundle:true,platform:"node",format:"esm",
  target:"node24",logLevel:"silent",plugins:[{name:"mock-supabase",setup(b){
   b.onResolve({filter:/^server-only$/},()=>({path:"server-only",namespace:"mock"}));
   b.onResolve({filter:/^@\/lib\/supabase$/},()=>({path:"db",namespace:"mock"}));
   if(patchRole)b.onResolve({filter:/vendorPackageRefundReviewAuthority\.mjs$/},()=>({path:rolePatched}));
   b.onResolve({filter:/^@\//},a=>{const base=resolve(root,a.path.slice(2));
    return {path:[base,base+".ts"].find(p=>existsSync(p)&&statSync(p).isFile())??base};});
   b.onLoad({filter:/.*/,namespace:"mock"},a=>({loader:"js",contents:a.path==="db"?
    "export const verifySupabaseBearerUser=t=>globalThis.__rc37.verify(t);export const adminClient=()=>globalThis.__rc37.admin();":""}));
  }}]});
 return import(pathToFileURL(out).href);
};
const b64=o=>Buffer.from(JSON.stringify(o)).toString("base64url");
const jwt=(o={})=>{const now=Math.floor(Date.now()/1000);
 return "Bearer "+b64({alg:"ES256",typ:"JWT"})+"."+b64({sub:U,aal:"aal2",exp:now+3600,iat:now-5,...o})+"."+"s".repeat(64);};
const future=new Date(Date.now()+3600e3).toISOString();
const world=(over={})=>{
 const w={calls:0,verifyCalls:0,user:{id:U,app_metadata:{qf_principal:"vox_staff",vox_role:"finance_reviewer"}},
  tables:{profiles:{data:{role:null,is_active:true},error:null},
   vox_staff_memberships_v1:{data:{auth_user_id:U,team_id:TEAM,staff_role:"finance_reviewer",is_active:true,revoked_at:null,expires_at:future},error:null},
   vox_staff_teams_v1:{data:{id:TEAM,city_id:CITY,is_active:true},error:null},
   cities:{data:{id:CITY,is_active:true},error:null},...over.tables},...over};
 globalThis.__rc37={verify:async()=>{w.verifyCalls++;return w.user},admin:()=>({from:t=>{
  w.calls++;const r=()=>w.tables[t]??{data:null,error:{message:"x"}};
  const c=new Proxy({},{get:(_,k)=>k==="then"?(f,g)=>Promise.resolve(r()).then(f,g):
   k==="maybeSingle"?async()=>r():()=>c});return c;}})};
 return w;
};
const fin=await compile("services/vox/verifiedFinanceReviewerBearer.ts","fin-default.mjs",false);
const finRole=await compile("services/vox/verifiedFinanceReviewerBearer.ts","fin-role.mjs",true);
test("compiled default verifier denies every token before any Auth or DB call",async()=>{
 const w=world();
 for(const h of [jwt(),null,"","Bearer x",jwt({aal:"aal1"})])
  assert.equal(await fin.verifyVoxFinanceRefundReviewerBearer(h),null);
 assert.equal(w.verifyCalls,0);assert.equal(w.calls,0);
});
test("compiled role-enabled verifier: positive and negative AAL2/role/membership matrix",async()=>{
 let w=world();
 const ok=await finRole.verifyVoxFinanceRefundReviewerBearer(jwt());
 assert.equal(ok.userId,U);assert.equal(ok.staffRole,"finance_reviewer");assert.equal(authorizeRefundReviewer(ok,["finance_reviewer"]).ok,false,
  "principal minted by a different module copy is not trusted by this one");
 const neg=[
  ["aal1",()=>world(),jwt({aal:"aal1"})],
  ["sub mismatch",()=>world(),jwt({sub:FORGED})],
  ["anonymous",()=>world(),jwt({is_anonymous:true})],
  ["expired",()=>world(),jwt({exp:Math.floor(Date.now()/1000)-1})],
  ["too long lived",()=>world(),jwt({exp:Math.floor(Date.now()/1000)+86401})],
  ["no auth user",()=>world({user:null}),jwt()],
  ["not vox_staff",()=>world({user:{id:U,app_metadata:{qf_principal:"other",vox_role:"finance_reviewer"}}}),jwt()],
  ["wrong role",()=>world({user:{id:U,app_metadata:{qf_principal:"vox_staff",vox_role:"operations_manager"}}}),jwt()],
  ["admin_role set",()=>world({user:{id:U,app_metadata:{qf_principal:"vox_staff",vox_role:"finance_reviewer",admin_role:"Superadmin"}}}),jwt()],
  ["legacy core role",()=>world({tables:{profiles:{data:{role:"admin",is_active:true},error:null}}}),jwt()],
  ["inactive profile",()=>world({tables:{profiles:{data:{role:null,is_active:false},error:null}}}),jwt()],
  ["membership revoked",()=>world({tables:{vox_staff_memberships_v1:{data:{auth_user_id:U,team_id:TEAM,staff_role:"finance_reviewer",is_active:true,revoked_at:future,expires_at:future},error:null}}}),jwt()],
  ["membership expired",()=>world({tables:{vox_staff_memberships_v1:{data:{auth_user_id:U,team_id:TEAM,staff_role:"finance_reviewer",is_active:true,revoked_at:null,expires_at:new Date(Date.now()-1000).toISOString()},error:null}}}),jwt()],
  ["membership other role",()=>world({tables:{vox_staff_memberships_v1:{data:{auth_user_id:U,team_id:TEAM,staff_role:"support_agent",is_active:true,revoked_at:null,expires_at:future},error:null}}}),jwt()],
  ["team inactive",()=>world({tables:{vox_staff_teams_v1:{data:{id:TEAM,city_id:CITY,is_active:false},error:null}}}),jwt()],
  ["city disabled",()=>world({tables:{cities:{data:{id:CITY,is_active:false},error:null}}}),jwt()],
  ["db error",()=>world({tables:{vox_staff_memberships_v1:{data:null,error:{message:"x"}}}}),jwt()],
 ];
 for(const [label,mk,h] of neg){mk();assert.equal(await finRole.verifyVoxFinanceRefundReviewerBearer(h),null,label);}
 void w;
});
const route=await compile("app/api/vox/v1/finance/refund-intake/route.ts","route.mjs",false);
const flags=["VOX_FINANCE_READ_ENABLED","VOX_STAFF_READ_ENABLED","VOX_STAFF_GRANTS_ENABLED",
 "VOX_FINANCE_REFUND_REVIEW_PREVIEW_ENABLED","VOX_FINANCE_REFUND_REVIEW_WRITE_ENABLED"];
const setFlags=on=>{for(const k of flags)on?process.env[k]="staging":delete process.env[k];};
const url="https://local.test/api/vox/v1/finance/refund-intake";
const eventRow={event_id:"evt_RC37PROCESSED1",provider_mode:"test",event_type:"refund.processed",
 payment_id:paymentId,provider_order_id:orderId,status:"quarantined",error_code:"REFUND_REVIEW_REQUIRED"};
const ownerWorld=(rows=[eventRow])=>world({user:{id:U,app_metadata:{admin_role:"Superadmin"}},
 tables:{profiles:{data:{role:"admin",is_active:true},error:null},
  qf_vendor_package_provider_events_candidate_v2:{data:rows,error:null}}});
test("route is default disabled for preview and writer, before auth or DB",async()=>{
 setFlags(false);const w=ownerWorld();
 assert.equal((await route.GET(new Request(url,{headers:{authorization:jwt()}}))).status,503);
 assert.equal((await route.POST(new Request(url,{method:"POST",headers:{authorization:jwt()}}))).status,503);
 assert.equal(w.verifyCalls,0);assert.equal(w.calls,0);
 for(const m of ["PUT","PATCH","DELETE"])assert.equal(route[m]().status,405);
});
test("preview: Owner AAL2 only, read-only, no hash, bounded, filters refused",async()=>{
 setFlags(true);
 let w=ownerWorld();
 const r=await route.GET(new Request(url,{headers:{authorization:jwt()}}));
 assert.equal(r.status,200);assert.match(r.headers.get("cache-control"),/no-store/);
 const body=await r.json();
 assert.equal(body.canReview,false);assert.equal(body.canRefund,false);assert.equal(body.previewCount,1);
 assert.equal(JSON.stringify(body).includes("body_sha256"),false);
 assert.equal((await route.GET(new Request(url+"?x=1",{headers:{authorization:jwt()}}))).status,400);
 assert.equal((await route.GET(new Request(url,{headers:{authorization:jwt({aal:"aal1"})}}))).status,403);
 w=ownerWorld(new Array(21).fill(eventRow));
 assert.equal((await route.GET(new Request(url,{headers:{authorization:jwt()}}))).status,503);
 w=ownerWorld([{...eventRow,status:"claimed"}]);
 assert.equal((await route.GET(new Request(url,{headers:{authorization:jwt()}}))).status,503);
 w=world({user:{id:U,app_metadata:{qf_principal:"vox_staff",vox_role:"operations_manager"}}});
 assert.equal((await route.GET(new Request(url,{headers:{authorization:jwt()}}))).status,403);
 void w;
});
test("writer: enabled flags still deny every caller (no canonical role), body never read, no mutation",async()=>{
 setFlags(true);
 for(const user of [{id:U,app_metadata:{admin_role:"Superadmin"}},
  {id:U,app_metadata:{qf_principal:"vox_staff",vox_role:"operations_manager"}},
  {id:U,app_metadata:{qf_principal:"vox_staff",vox_role:"finance_reviewer"}},null]){
  const w=world({user});let bodyRead=false;
  const req=new Request(url,{method:"POST",headers:{authorization:jwt(),"content-type":"application/json"},
   body:JSON.stringify({reviewerId:FORGED,decision:"escalated_for_policy_decision"})});
  const orig=req.json.bind(req);req.json=async()=>{bodyRead=true;return orig()};
  const origText=req.text.bind(req);req.text=async()=>{bodyRead=true;return origText()};
  const r=await route.POST(req);
  assert.equal(r.status,403);assert.equal((await r.json()).error,"FINANCE_REVIEWER_AAL2_ROLE_REQUIRED");
  assert.equal(bodyRead,false);assert.equal(w.verifyCalls,0);assert.equal(w.calls,0);
 }
});
test("source: route and verifier contain no write, provider, secret or caller-reviewer paths",()=>{
 for(const f of ["app/api/vox/v1/finance/refund-intake/route.ts","services/vox/verifiedFinanceReviewerBearer.ts"]){
  const s=readFileSync(resolve(root,f),"utf8");
  assert.doesNotMatch(s,/\.rpc\(|\.insert\(|\.update\(|\.delete\(|\.upsert\(|razorpay|fetch\(|process\.env\.[A-Z_]*(SECRET|KEY)/i,f);
  assert.doesNotMatch(s,/request\.(json|text|formData)\(/,f);
 }
});
