import test,{after} from "node:test";
import assert from "node:assert/strict";
import ts from "typescript";
import {runInNewContext} from "node:vm";
import {readFileSync} from "node:fs";
import {join,resolve,dirname} from "node:path";
import {fileURLToPath} from "node:url";
import {safeReturnPath,withReturn} from "../lib/returnTo.mjs";

const root=resolve(dirname(fileURLToPath(import.meta.url)),"..");
// TypeScript is already a pinned VOX Web dependency in every historical CI
// workflow. Evaluate only this known-local server module under a mocked
// auth/Core environment; no root-only esbuild dependency is introduced.
const source=readFileSync(join(root,"lib/ownerVendorVerification.ts"),"utf8");
const compiled=ts.transpileModule(source,{compilerOptions:{
 module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true,
}}).outputText;
// Node 20 legacy CI cannot import a .ts file directly. Transpile the real
// side-effect-free gate with the pinned Web TypeScript dependency instead of
// replacing its security decision with a hardcoded test stub.
const gateSource=readFileSync(join(root,"lib/ownerVendorReviewGate.ts"),"utf8");
const gateCompiled=ts.transpileModule(gateSource,{compilerOptions:{
 module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,
}}).outputText;
const gateModule={exports:{}};
runInNewContext(gateCompiled,{
 module:gateModule,exports:gateModule.exports,
},"ownerVendorReviewGate.test-compiled.cjs");
const {ownerVendorReadGate,ownerVendorDecisionGate}=gateModule.exports;
const mockModule={exports:{}};
const mockRequire=name=>{
 if(name==="server-only")return {};
 if(name==="./ownerVendorReviewGate")return {ownerVendorReadGate,ownerVendorDecisionGate};
 if(name==="./auth")return {
  verifiedMfaSession:async()=>globalThis.__ownerToken??null,
 };
 if(name==="./core")return {
  origin:()=>process.env.VOX_CORE_ORIGIN==="https://staging-core.quickfurno.in"
   ?"https://staging-core.quickfurno.in":null,
 };
 throw new Error("UNEXPECTED_IMPORT_"+name);
};
runInNewContext(compiled,{
 module:mockModule,exports:mockModule.exports,require:mockRequire,
 process,Buffer,URL,Response,AbortSignal,Date,
 fetch:(...args)=>globalThis.fetch(...args),
},"ownerVendorVerification.test-compiled.cjs");
const bridge=mockModule.exports;
const origFetch=globalThis.fetch;
const envKeys=["VOX_STAFF_PORTAL_ENABLED","VOX_STAFF_VIEW_MODE",
 "VOX_OWNER_VENDOR_REVIEW_ENABLED","VOX_OWNER_VENDOR_DECISION_ENABLED","VOX_CORE_ORIGIN"];
const old=Object.fromEntries(envKeys.map(k=>[k,process.env[k]]));
after(()=>{
 globalThis.fetch=origFetch;delete globalThis.__ownerToken;
 for(const [k,v]of Object.entries(old))if(v===undefined)delete process.env[k];else process.env[k]=v;
 // No temporary files or host writes were made.
});
const UUID="22222222-2222-4222-8222-222222222222";
const ID2="33333333-3333-4333-8333-333333333333";
const token="verified-owner-AAL2-test";
const row={
 vendorId:UUID,caseVersion:1,caseState:"pending",submittedAt:"2026-11-05T04:00:00Z",
 contactStatus:"verified",identityStatus:"pending",officeStatus:"pending",
 categoryStatus:"pending",zoneStatus:"pending",consentValid:true,
 pendingScanCount:2,rejectedScanCount:0
};
const queue={ok:true,schema:"qf.vox.owner.vendor-verification-queue.v1",
 mode:"READ_ONLY",source:"quickfurno-core",pending:[row],limit:20,
 canApprove:false,canViewPrivateDocuments:false,canActivateLeads:false,
 requiresSeparateOwnerCaseDecision:true};
const state={ok:true,schema:"qf.vox.owner.vendor-private-review.v1",
 vendorId:UUID,mode:"OWNER_REVIEW",casePresent:true,caseVersion:1,caseState:"pending",
 contactStatus:"verified",identityStatus:"pending",officeStatus:"pending",
 categoryStatus:"pending",zoneStatus:"pending",consentValid:true,
 identityEvidenceVerified:false,officeEvidenceVerified:false,
 readyForCoreApproval:false,canViewPrivateDocuments:false,canActivateLeads:false,
 requiresSeparateCoreVendorApproval:true};
const decision={ok:true,schema:"qf.vox.owner.vendor-review-decision.v1",
 vendorId:UUID,caseState:"documents_requested",immutableDecisionRecorded:true,
 vendorBusinessStatusUnchanged:true,leadActivationUnchanged:true,
 requiresSeparateCoreVendorApproval:true};
const input={vendorId:UUID,caseVersion:1,action:"request_documents",
 reasonCode:"office_proof_missing"};
const setup=()=>{
 process.env.VOX_STAFF_PORTAL_ENABLED="staging";
 process.env.VOX_STAFF_VIEW_MODE="owner";
 process.env.VOX_OWNER_VENDOR_REVIEW_ENABLED="staging";
 process.env.VOX_OWNER_VENDOR_DECISION_ENABLED="staging";
 process.env.VOX_CORE_ORIGIN="https://staging-core.quickfurno.in";
 globalThis.__ownerToken=token;
};
function mock(content,opts={}){
 const calls=[];
 globalThis.fetch=async(url,options)=>{
  calls.push({url:String(url),options});
  const value=typeof content==="function"?content(calls.length):content;
  return new Response(JSON.stringify(value),{
   status:opts.status||200,
   headers:{"content-type":"application/json"}});
 };
 return calls;
}
test("VOX-V1 Owner review read is independently OFF and never queries Core",async()=>{
 setup();delete process.env.VOX_OWNER_VENDOR_REVIEW_ENABLED;
 const calls=mock(queue);
 const result=await bridge.ownerVendorQueue();
 assert.equal(result.ok,false);assert.equal(result.status,503);
 assert.equal(calls.length,0);
 setup();process.env.VOX_STAFF_VIEW_MODE="scoped";
 assert.equal((await bridge.ownerVendorQueue()).status,503);
 assert.equal(calls.length,0);
 setup();delete process.env.VOX_STAFF_PORTAL_ENABLED;
 assert.equal((await bridge.ownerVendorQueue()).status,503);
 assert.equal(calls.length,0);
});
test("VOX-V2 Owner read always requires existing MFA and pinned Staging Core",async()=>{
 setup();globalThis.__ownerToken=null;
 const calls=mock(queue);
 assert.equal((await bridge.ownerVendorQueue()).status,401);
 assert.equal(calls.length,0);
 setup();process.env.VOX_CORE_ORIGIN="https://attacker.example";
 assert.equal((await bridge.ownerVendorQueue()).status,503);
 assert.equal(calls.length,0);
});
test("VOX-V3 bounded queue, privacy projection, AAL2 recheck and header stripping",async()=>{
 setup();
 const calls=mock(queue);
 const r=await bridge.ownerVendorQueue();
 assert.equal(r.ok,true);
 assert.equal(r.data.length,1);
 assert.deepEqual(Object.keys(r.data[0]).sort(),Object.keys(row).sort());
 assert.equal(calls.length,1);
 assert.equal(calls[0].url,"https://staging-core.quickfurno.in/api/vox/v1/owner-vendor-verification-queue");
 assert.equal(calls[0].options.method,"GET");
 assert.equal(calls[0].options.cache,"no-store");
 assert.equal(calls[0].options.redirect,"error");
 assert.equal(calls[0].options.headers.authorization,"Bearer "+token);
 assert.equal(calls[0].options.headers.origin,undefined);
 assert.equal(calls[0].options.headers.cookie,undefined);
});
test("VOX-V4 rejects Core queue PII, duplicate vendor, over 20 and invalid flags",async()=>{
 setup();
 for(const bad of [
  {...queue,pending:[{...row,phone:"9876543210"}]},
  {...queue,pending:[row,row]},
  {...queue,pending:Array.from({length:21},(_,i)=>({...row,vendorId:i%2?UUID:ID2}))},
  {...queue,canActivateLeads:true},
  {...queue,schema:"other"},
  {...queue,pending:[{...row,caseVersion:0}]},
  {...queue,pending:[{...row,privateStorageKey:"vendors/secret.png"}]}
 ]){
  mock(bad);const r=await bridge.ownerVendorQueue();
  assert.equal(r.ok,false,JSON.stringify(bad).slice(0,100));
 }
});
test("VOX-V5 verifies narrow immutable case projection without raw documents",async()=>{
 setup();const calls=mock(state);
 const r=await bridge.ownerVendorCase(UUID);
 assert.equal(r.ok,true);
 assert.deepEqual(Object.keys(r.data).sort(),[
  "vendorId","casePresent","caseVersion","caseState","contactStatus",
  "identityStatus","officeStatus","categoryStatus","zoneStatus","consentValid",
  "identityEvidenceVerified","officeEvidenceVerified","readyForCoreApproval"
 ].sort());
 assert.equal(calls[0].url,"https://staging-core.quickfurno.in/api/vox/v1/owner-vendor-verification-case?vendorId="+UUID);
 assert.equal((await bridge.ownerVendorCase("not-a-uuid")).status,400);
 mock({...state,privateDocument:"raw"});
 assert.equal((await bridge.ownerVendorCase(UUID)).status,503);
});
test("VOX-V6 protected decision POST preserves exact immutable Core CAS receipt",async()=>{
 setup();const calls=mock(decision);
 const r=await bridge.ownerVendorDecision(input);
 assert.equal(r.ok,true);
 assert.equal(r.data.caseState,"documents_requested");
 assert.equal(calls.length,1);
 assert.equal(calls[0].url,"https://staging-core.quickfurno.in/api/vox/v1/owner-vendor-verification-case");
 assert.equal(calls[0].options.method,"POST");
 assert.deepEqual(JSON.parse(calls[0].options.body),input);
 assert.equal(calls[0].options.headers.authorization,"Bearer "+token);
 assert.equal(calls[0].options.headers.origin,undefined);
 assert.equal(calls[0].options.headers.cookie,undefined);
});
test("VOX-V7 independent decision flag, invalid input and unconfirmed result fail closed",async()=>{
 setup();delete process.env.VOX_OWNER_VENDOR_DECISION_ENABLED;
 const calls=mock(decision);
 assert.equal((await bridge.ownerVendorDecision(input)).status,503);
 assert.equal(calls.length,0);
 setup();
 for(const bad of [{...input,caseVersion:0},{...input,action:"grant_credits"},
  {...input,reasonCode:"INVALID"},{...input,actorId:UUID},
  {...input,vendorId:"forged"}]){
  const result=await bridge.ownerVendorDecision(bad);
  assert.equal(result.status,400);
 }
 assert.equal(calls.length,0);
 mock({...decision,leadActivationUnchanged:false});
 assert.equal((await bridge.ownerVendorDecision(input)).status,503);
});
test("VOX-V8 stale session, malformed JSON and excessive Core responses fail closed",async()=>{
 setup();
 globalThis.__ownerToken=token;mock(()=>{globalThis.__ownerToken="revoked";return queue});
 assert.equal((await bridge.ownerVendorQueue()).status,403);
 setup();const calls=mock({...queue,pending:[{...row,summary:"x".repeat(26000)}]});
 assert.equal((await bridge.ownerVendorQueue()).status,503);
 assert.equal(calls.length,1);
});
test("VOX-V9 route pages never call public DB, arbitrary Core or access staff actions",()=>{
 const read=p=>readFileSync(join(root,p),"utf8");
 const paths=[
  "app/api/owner/vendor-verification/queue/route.ts",
  "app/api/owner/vendor-verification/case/route.ts",
  "app/api/owner/vendor-verification/decision/route.ts",
  "app/owner/vendors/verification/OwnerReviewConsole.tsx",
 ];
 for(const p of paths){
  const s=read(p);
  assert.doesNotMatch(s,/\.from\("vendors"\)|SUPABASE_SERVICE_ROLE|NEXT_PUBLIC_SERVICE|https:\/\/staging-core/);
  assert.doesNotMatch(s,/\.storage\.|\.sendMessage\(|\.grantCredits\(/);
 }
 const command=read("app/api/owner/vendor-verification/decision/route.ts");
 assert.match(command,/allowedOrigin\(request\)/);
 assert.match(command,/MAX_BYTES=2048/);
 assert.match(command,/request\.body\?\.getReader\(\)/);
 assert.match(command,/validOwnerReviewInput\(raw\)/);
 const page=read("app/owner/vendors/verification/page.tsx");
 assert.match(page,/verifiedMfaSession\(\)/);
 assert.match(page,/ownerVendorReviewReadEnabled\(\)/);
 assert.match(page,/decisionEnabled=\{ownerVendorDecisionEnabled\(\)\}/);
 const nav=read("app/operations/page.tsx");
 assert.match(nav,/ownerVerificationVisible\?<Link href="\/owner\/vendors\/verification"/);
 const ownerStart=nav.indexOf('{ownerMode?<nav aria-label="Owner operations workspaces"');
 const ownerEnd=nav.indexOf('</nav>:<nav aria-label="VOX staff workspaces"',ownerStart);
 assert.ok(ownerStart>=0&&ownerEnd>ownerStart,"Owner and Staff nav must remain separate");
 assert.doesNotMatch(nav.slice(ownerStart,ownerEnd),/href="\/studio"/,
  "Jarvis Automation Studio must stay outside the Owner navigation");
});
test("VOX-V10 exact owner return path, never open redirect or Staff broadening",()=>{
 assert.equal(safeReturnPath("/owner/vendors/verification"),"/owner/vendors/verification");
 assert.equal(withReturn("/login","/owner/vendors/verification"),
  "/login?next="+encodeURIComponent("/owner/vendors/verification"));
 for(const path of [
  "/owner/admin","/owner/staff","/owner/vendors/verification/../../admin",
  "//attacker.example","https://attacker.example","/owner/vendors/verification?query=x",
  "/owner/vendors/verification#hash", "/owner/vendors/other"
 ])assert.equal(safeReturnPath(path),null,path);
});
