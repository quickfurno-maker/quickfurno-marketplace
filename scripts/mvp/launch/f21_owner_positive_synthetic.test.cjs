"use strict";
/**
 * F21: exercise REAL Core/VOX Owner source with synthetic trusted boundaries.
 * Zero network: mocked MFA, adminClient and Core fetch ONLY.
 * No deployment; no arbitrary module can access real app env or providers.
 */
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const ts=require("typescript");
const ROOT=path.resolve(__dirname,"../../..");
const owner="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const vendor="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const vendor2="cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const auth="Bearer f21-synthetic-owner-aal2";
const CORE_URL="https://synthetic-core.test/api/vox/v1/owner-vendor-verification-case";
const VOX_URL="https://synthetic-vox.test/api/owner/vendor-verification/decision";
function load(sourcePath,dependencies,context={}){
 const source=fs.readFileSync(path.join(ROOT,sourcePath),"utf8");
 const result=ts.transpileModule(source,{compilerOptions:{
  module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true
 },reportDiagnostics:true});
 const errors=(result.diagnostics||[]).filter(x=>x.category===ts.DiagnosticCategory.Error);
 assert.equal(errors.length,0,"typescript test transpilation: "+sourcePath);
 const exports={};
 const lookup=(name)=>{if(Object.prototype.hasOwnProperty.call(dependencies,name))return dependencies[name];
  throw Error("F21_UNAPPROVED_IMPORT:"+name);};
 const ctx={...context};
 const run=new Function("require","exports","process","Buffer","Response","Request","URL","AbortSignal","fetch",
  '"use strict";\n'+result.outputText);
 run(lookup,exports,ctx.process||{env:{}},Buffer,Response,Request,URL,AbortSignal,
  ctx.fetch||(()=>{throw Error("F21_FORBID_UNMOCKED_NETWORK");}));
 return exports;
}
const caseSnapshot=()=>({
 casePresent:true,caseVersion:1,state:"under_review",
 contactStatus:"verified",identityStatus:"verified",officeStatus:"verified",
 categoryStatus:"verified",zoneStatus:"verified",
 consentValid:true,identityEvidenceVerified:true,officeEvidenceVerified:false,
 readyForCoreApproval:false
});
function core(params={}){
 let calls=[],verified=0;
 const env={VOX_OWNER_VENDOR_CASE_REVIEW_ENABLED:"staging"};
 const rpc=async(name,input)=>{calls.push({name,input});
  return params.rpc ? params.rpc(name,input) : ({data: name==="qf_vendor_owner_review_snapshot"?
    caseSnapshot():"approved",error:null});
 };
 const verify=async(token)=>{verified++;
  if(params.revokeAt && verified>=params.revokeAt)return null;
  return token===auth?owner:null;
 };
 const module=load("app/api/vox/v1/owner-vendor-verification-case/route.ts",{
  "server-only":{},"@/lib/supabase":{adminClient:()=>({rpc})},
  "@/services/vox/verifiedStaffBearer":{verifyVoxOwnerBearer:verify},
 },{process:{env}});
 return {module,calls,verified:()=>verified,env};
}
function corePost(payload,extraHeaders={}){
 return new Request(CORE_URL,{method:"POST",headers:{
  authorization:auth,origin:"https://synthetic-core.test",
  "content-type":"application/json",...extraHeaders},body:JSON.stringify(payload)});
}
function coreGet(v=vendor,extra={}){
 return new Request(CORE_URL+"?vendorId="+v,{headers:{authorization:auth,...extra}});
}
const action=(over={})=>({vendorId:vendor,caseVersion:1,action:"approve",reasonCode:"all_verified",...over});
const caseProjection=(over={})=>({
 ok:true,schema:"qf.vox.owner.vendor-private-review.v1",vendorId:vendor,mode:"OWNER_REVIEW",
 casePresent:true,caseVersion:1,caseState:"under_review",contactStatus:"verified",
 identityStatus:"verified",officeStatus:"verified",categoryStatus:"verified",
 zoneStatus:"verified",consentValid:true,identityEvidenceVerified:true,
 officeEvidenceVerified:false,readyForCoreApproval:false,
 canViewPrivateDocuments:false,canActivateLeads:false,
 requiresSeparateCoreVendorApproval:true,...over
});
const decisionProjection=(over={})=>({
 ok:true,schema:"qf.vox.owner.vendor-review-decision.v1",
 vendorId:vendor,caseState:"approved",immutableDecisionRecorded:true,
 vendorBusinessStatusUnchanged:true,leadActivationUnchanged:true,
 requiresSeparateCoreVendorApproval:true,...over
});
const queueRow=(vid=vendor)=>({
 vendorId:vid,caseVersion:1,caseState:"under_review",
 submittedAt:"2026-11-07T00:00:00Z",
 contactStatus:"verified",identityStatus:"verified",officeStatus:"verified",
 categoryStatus:"verified",zoneStatus:"verified",consentValid:true,
 pendingScanCount:1,rejectedScanCount:0
});
const queueProjection=(over={})=>({
 ok:true,schema:"qf.vox.owner.vendor-verification-queue.v1",
 mode:"READ_ONLY",source:"quickfurno-core",limit:20,
 canApprove:false,canViewPrivateDocuments:false,canActivateLeads:false,
 requiresSeparateOwnerCaseDecision:true,pending:[queueRow()],...over
});
function web(options={}){
 let calls=[],sessionChecks=0;
 const env={
  VOX_STAFF_PORTAL_ENABLED:"staging",
  VOX_STAFF_VIEW_MODE:"owner",
  VOX_OWNER_VENDOR_REVIEW_ENABLED:"staging",
  VOX_OWNER_VENDOR_DECISION_ENABLED:"staging",
  ...(options.env||{})
 };
 const gate=load("apps/vox-web/lib/ownerVendorReviewGate.ts",{});
 const verify=async()=>{sessionChecks++;
  return (options.revokeAt&&sessionChecks>=options.revokeAt)?null:"f21-verified-aal2-token";
 };
 const responder=options.respond||(()=>({status:200,body:queueProjection()}));
 const fetch=async(url,init)=>{
   assert.match(url,/^https:\/\/synthetic-core\.test\/api\/vox\/v1\/owner-vendor-verification/);
   const {status=200,body={},headers={}}=responder(url,init);
   calls.push({url,method:init.method,headers:init.headers,body:init.body||null});
   return new Response(JSON.stringify(body),{status,headers:{"content-type":"application/json",...headers}});
 };
 const module=load("apps/vox-web/lib/ownerVendorVerification.ts",{
  "server-only":{},"./auth":{verifiedMfaSession:verify},
  "./core":{origin:()=>"https://synthetic-core.test"},
  "./ownerVendorReviewGate":gate
 },{process:{env},fetch});
 return {module,calls,env,sessionChecks:()=>sessionChecks};
}
test("F21-01 real Core Owner GET projects private review without document bytes",async()=>{
 const x=core();const r=await x.module.GET(coreGet());
 assert.equal(r.status,200);const body=await r.json();
 assert.equal(body.ok,true);assert.equal(body.vendorId,vendor);
 assert.equal(body.canViewPrivateDocuments,false);assert.equal(body.canActivateLeads,false);
 assert.equal(body.readyForCoreApproval,false);
 assert.equal(body.requiresSeparateCoreVendorApproval,true);
 assert.equal(x.calls.length,1);
 assert.equal(x.calls[0].name,"qf_vendor_owner_review_snapshot");
 assert.equal(x.verified(),2);
 assert.equal(r.headers.get("cache-control"),"private, no-store, max-age=0");
});
test("F21-02 real Core Owner POST records only immutable decision and cannot activate",async()=>{
 const x=core();const r=await x.module.POST(corePost(action()));
 assert.equal(r.status,200);const b=await r.json();
 assert.equal(b.immutableDecisionRecorded,true);
 assert.equal(b.vendorBusinessStatusUnchanged,true);assert.equal(b.leadActivationUnchanged,true);
 assert.equal(b.requiresSeparateCoreVendorApproval,true);
 assert.equal(x.calls.length,1);assert.equal(x.calls[0].name,"qf_owner_record_vendor_verification_decision");
 assert.equal(x.calls[0].input.p_reviewer_user_id,owner);
 assert.equal(x.calls[0].input.p_expected_case_version,1);
 assert.equal(x.verified(),2);
});
test("F21-03 original Owner Core review flag OFF denies before auth and DB",async()=>{
 const x=core();x.env.VOX_OWNER_VENDOR_CASE_REVIEW_ENABLED="";
 const r=await x.module.POST(corePost(action()));
 assert.equal(r.status,503);assert.equal(x.calls.length,0);assert.equal(x.verified(),0);
});
test("F21-04 Owner POST wrong origin denies with no DB",async()=>{
 const x=core();
 const r=await x.module.POST(corePost(action(),{origin:"https://other.test"}));
 assert.equal(r.status,403);assert.equal(x.calls.length,0);
});
test("F21-05 Owner POST invalid case version/reviewer supplied is rejected",async()=>{
 const x=core();for(const a of [action({caseVersion:0}),action({caseVersion:1.5}),
 action({reviewerId:owner}),action({reasonCode:""}),action({action:"activate"})]){
  const r=await x.module.POST(corePost(a));assert.equal(r.status,400);
 }
 assert.equal(x.calls.length,0);
});
test("F21-06 stale Owner session denies before RPC",async()=>{
 const x=core({revokeAt:2});const r=await x.module.POST(corePost(action()));
 assert.equal(r.status,403);assert.equal(x.calls.length,0);
});
test("F21-07 failed Core RPC never claims decision recorded",async()=>{
 const x=core({rpc:()=>({data:null,error:{code:"denied"}})});
 const r=await x.module.POST(corePost(action()));assert.equal(r.status,503);
 assert.equal((await r.json()).ok,false);
});
test("F21-08 invalid Core RPC state cannot become approved",async()=>{
 const x=core({rpc:()=>({data:"credit_granted",error:null})});
 const r=await x.module.POST(corePost(action()));assert.equal(r.status,409);
});
test("F21-09 Core GET invalid vendor query denied before RPC",async()=>{
 const x=core();const r=await x.module.GET(coreGet("not-a-uuid"));
 assert.equal(r.status,400);assert.equal(x.calls.length,0);
});
test("F21-10 Core GET snapshot owner session revoked after IO denied",async()=>{
 const x=core({revokeAt:2});const r=await x.module.GET(coreGet());
 assert.equal(r.status,403);assert.equal((await r.json()).code,"OWNER_SESSION_REVOKED");
});
test("F21-11 actual VOX Owner read and decision gates require owner-only mode",()=>{
 const x=web();assert.equal(x.module.ownerVendorReviewReadEnabled(),true);
 assert.equal(x.module.ownerVendorDecisionEnabled(),true);
 x.env.VOX_STAFF_VIEW_MODE="scoped";assert.equal(x.module.ownerVendorReviewReadEnabled(),false);
 x.env.VOX_STAFF_VIEW_MODE="owner";x.env.VOX_OWNER_VENDOR_DECISION_ENABLED="";
 assert.equal(x.module.ownerVendorReviewReadEnabled(),true);
 assert.equal(x.module.ownerVendorDecisionEnabled(),false);
});
test("F21-12 VOX real BFF queue positive project with no browser headers",async()=>{
 const x=web();const r=await x.module.ownerVendorQueue();
 assert.equal(r.ok,true);assert.equal(r.data.length,1);assert.equal(r.data[0].vendorId,vendor);
 assert.equal(x.calls.length,1);const c=x.calls[0];
 assert.equal(c.method,"GET");assert.equal(c.headers.authorization,"Bearer f21-verified-aal2-token");
 assert.equal(c.headers.cookie,undefined);assert.equal(c.headers.origin,undefined);
 assert.equal(x.sessionChecks(),2);
});
test("F21-13 VOX real BFF case positive with strict privacy flags",async()=>{
 const x=web({respond:()=>({status:200,body:caseProjection()})});
 const r=await x.module.ownerVendorCase(vendor);
 assert.equal(r.ok,true);assert.equal(r.data.readyForCoreApproval,false);
 assert.deepEqual(Object.keys(r.data).sort().includes("storageKey"),false);
 assert.equal(x.calls.length,1);
});
test("F21-14 VOX decision positive but does not authorize vendor activation",async()=>{
 const x=web({respond:()=>({status:200,body:decisionProjection()})});
 const r=await x.module.ownerVendorDecision(action());
 assert.equal(r.ok,true);assert.equal(r.data.caseState,"approved");
 assert.equal(x.calls[0].method,"POST");
 assert.deepEqual(JSON.parse(x.calls[0].body),action());
 assert.equal(x.sessionChecks(),2);
});
test("F21-15 VOX BFF refuses unsigned/extra Core decision fields",async()=>{
 for(const body of [decisionProjection({leadActivationUnchanged:false}),
  decisionProjection({vendorBusinessStatusUnchanged:false}),
  decisionProjection({storageKey:"leak"}),
  decisionProjection({vendorId:vendor2})]){
  const x=web({respond:()=>({status:200,body})});
  const r=await x.module.ownerVendorDecision(action());
  assert.equal(r.ok,false);assert.equal(r.status,503);
 }
});
test("F21-16 VOX BFF rejects duplicate vendor queue rows",async()=>{
 const x=web({respond:()=>({status:200,body:queueProjection({
  pending:[queueRow(),queueRow()]
 })})});
 const r=await x.module.ownerVendorQueue();assert.equal(r.ok,false);assert.equal(r.status,503);
});
test("F21-17 VOX BFF rejects queue with wrong capabilities",async()=>{
 for(const patch of [{canActivateLeads:true},{canApprove:true},{limit:100}]){
  const x=web({respond:()=>({status:200,body:queueProjection(patch)})});
  const r=await x.module.ownerVendorQueue();assert.equal(r.ok,false);assert.equal(r.status,503);
 }
});
test("F21-18 VOX BFF detects overlong Core JSON response",async()=>{
 const x=web({respond:()=>({status:200,
  body:{...queueProjection(),padding:"x".repeat(26000)}})});
 const r=await x.module.ownerVendorQueue();assert.equal(r.ok,false);assert.equal(r.status,503);
});
test("F21-19 VOX BFF rejects content spoofing",async()=>{
 const x=web({respond:()=>({status:200,body:queueProjection(),
  headers:{"content-type":"text/html"}})});
 const r=await x.module.ownerVendorQueue();assert.equal(r.ok,false);assert.equal(r.status,503);
});
test("F21-20 VOX BFF detects revoked session after Core reply",async()=>{
 const x=web({revokeAt:2});const r=await x.module.ownerVendorQueue();
 assert.equal(r.ok,false);assert.equal(r.status,403);assert.equal(r.error,"OWNER_SESSION_REVOKED");
});
test("F21-21 VOX BFF rejects authenticated Core 403",async()=>{
 const x=web({respond:()=>({status:403,body:{error:"forbidden"}})});
 const r=await x.module.ownerVendorQueue();assert.equal(r.ok,false);assert.equal(r.status,403);
});
test("F21-22 VOX BFF refuses decision when decision flag OFF",async()=>{
 const x=web({env:{VOX_OWNER_VENDOR_DECISION_ENABLED:""}});
 const r=await x.module.ownerVendorDecision(action());assert.equal(r.status,503);assert.equal(x.calls.length,0);
});
test("F21-23 VOX BFF validates exact input schema, no user reviewer",async()=>{
 const x=web();for(const v of [action({extra:true}),action({caseVersion:-1}),
  action({reasonCode:"unbounded space"}),action({vendorId:vendor2+"wrong"})]){
  assert.equal(x.module.validOwnerReviewInput(v),false);
 }
 assert.equal(x.calls.length,0);
});
