import test from "node:test";
import assert from "node:assert/strict";
import {build} from "esbuild";
import {mkdtempSync,rmSync,readFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {resolve,join,dirname} from "node:path";
import {fileURLToPath,pathToFileURL} from "node:url";
const root=resolve(dirname(fileURLToPath(import.meta.url)),"../../..");
const tmp=mkdtempSync(join(tmpdir(),"qf-vox-rc42-credit-"));
const out=join(tmp,"credit-service.mjs");
await build({entryPoints:[resolve(root,"services/badLeadRecoveryService.ts")],outfile:out,
 bundle:true,platform:"node",format:"esm",target:"node24",logLevel:"silent",
 plugins:[{name:"credit-service-stubs",setup(b){
  // Test-only compiled copy opens the reviewed-install switch to exercise the
  // *candidate* contract; production source remains a hard literal false.
  b.onLoad({filter:/services[\\/]badLeadRecoveryService\.ts$/},a=>({loader:"ts",contents:
   readFileSync(a.path,"utf8").replace("RC43_BAD_LEAD_ATOMIC_RPC_INSTALLED=false as const",
   "RC43_BAD_LEAD_ATOMIC_RPC_INSTALLED=true as const")
    .replace("RC82_BAD_LEAD_REJECTION_RPC_INSTALLED=false as const",
     "RC82_BAD_LEAD_REJECTION_RPC_INSTALLED=true as const")
    .replace("CREDIT_RPC_TIMEOUT_MS=4000","CREDIT_RPC_TIMEOUT_MS=25")
    .replace("REJECT_RPC_TIMEOUT_MS=4000","REJECT_RPC_TIMEOUT_MS=25")
    .replace("RECOMMEND_RPC_TIMEOUT_MS=3000","RECOMMEND_RPC_TIMEOUT_MS=25")}));
  b.onResolve({filter:/^\.\.\/lib\/supabase$/},()=>({path:"supabase",namespace:"fake"}));
  b.onResolve({filter:/^\.\.\/lib\/errors$/},()=>({path:"errors",namespace:"fake"}));
  b.onLoad({filter:/.*/,namespace:"fake"},a=>({loader:"js",contents:
   a.path==="supabase"?"export function adminClient(){return globalThis.__rc42Db();}":
   "export function ok(data){return {ok:true,data};} export function fail(e){return {ok:false,code:'UNAVAILABLE',error:String(e)};}"
  }));
 }}]});
const {applyBadLeadRecovery:apply,recommendBadLeadRecovery:recommend,
 generateBadLeadRecoveryRecommendation:generate}=await import(pathToFileURL(out).href);
test("production source cannot activate lead credit via env alone",()=>{
 const src=readFileSync(resolve(root,"services/badLeadRecoveryService.ts"),"utf8");
 assert.match(src,/RC43_BAD_LEAD_ATOMIC_RPC_INSTALLED=false as const/);
 assert.match(src,/if\(!RC43_BAD_LEAD_ATOMIC_RPC_INSTALLED\s*\|\|/);
});
const REPORT="11111111-1111-4111-8111-111111111111",ACTOR="22222222-2222-4222-8222-222222222222";
const gate="QF_VOX_BAD_LEAD_CREDIT_ONLY_ATOMIC_ENABLED";
const rejectGate="QF_VOX_BAD_LEAD_REJECT_RPC_ENABLED";
const calls=[];
globalThis.__rc42Db=()=>({rpc:async(name,args)=>{calls.push({name,args});return {data:globalThis.__rc42Reply,error:null};}});
const before=()=>{calls.length=0;delete process.env[gate];
 process.env[rejectGate]="staging";globalThis.__rc42Reply={
 status:"applied",lead_credits_restored:1,cash_refunded_minor_units:0,
 original_assignment_id:"44444444-4444-4444-8444-444444444444",
 credit_restoration_approval_id:"55555555-5555-4555-8555-555555555555",
 automatic_replacement_created:false};};
test("recommendation receipt loss is bounded, UNKNOWN and never retries or grants credits",async()=>{
 before();
 const saved=globalThis.__rc42Db;
 for(const mode of ["hang","throw","transport","missing","forged"]){
  let sent=0;
  globalThis.__rc42Db=()=>({rpc:async(name,args)=>{
   sent++;
   assert.equal(name,"qf_recommend_bad_lead_recovery_v1");
   if(mode==="hang")return new Promise(()=>{});
   if(mode==="throw")throw Error("private error");
   if(mode==="transport")return {data:null,error:{message:"private"}};
   if(mode==="missing")return {data:null,error:null};
   return {data:{status:"applied",lead_credits_restored:1},error:null};
  }});
  const reply=await recommend(REPORT,"restore_credit");
  assert.equal(reply.ok,false);
  assert.equal(reply.code,mode==="forged"?"RECOMMENDATION_RESPONSE_INVALID":"RECOMMEND_OUTCOME_UNKNOWN");
  assert.equal(sent,1);
  assert.equal(JSON.stringify(reply).includes("private error"),false);
 }
 globalThis.__rc42Db=saved;
});
test("default OFF cannot grant any credit or call database",async()=>{
 before();const r=await apply(REPORT,"restore_credit",ACTOR);
 assert.equal(r.ok,false);assert.equal(r.code,"CREDIT_ONLY_ATOMIC_NOT_APPROVED");
 assert.equal(calls.length,0);
});
test("legacy direct replacement, double remedy and money actions denied even when gate ON",async()=>{
 before();process.env[gate]="staging";
 for(const action of ["replace","restore_credit_and_replace","cash_refund"]){
  const r=await apply(REPORT,action,ACTOR);
  assert.equal(r.ok,false);assert.equal(r.code,"BAD_LEAD_CREDIT_ONLY_POLICY");
 }
 assert.equal(calls.length,0);
});
test("authenticated upstream actor handoff reaches only assignment-atomic candidate",async()=>{
 before();process.env[gate]="staging";
 const r=await apply(REPORT,"restore_credit",ACTOR);assert.equal(r.ok,true);
 assert.equal(r.data.replacementStatus,"not_requested");
 assert.equal(r.data.restorationStatus,"applied");
 assert.equal(r.data.originalAssignmentId,"44444444-4444-4444-8444-444444444444");
 assert.equal(r.data.creditRestorationApprovalId,"55555555-5555-4555-8555-555555555555");
 assert.equal(r.data.leadCreditsRestored,1);
 assert.deepEqual(calls,[{name:"qf_vox_rc42_bad_lead_credit_only_atomic_candidate_v1",
  args:{p_report_id:REPORT,p_actor_id:ACTOR}}]);
});
test("replay is zero additional lead credits; no direct money or replacement",async()=>{
 before();process.env[gate]="staging";
 globalThis.__rc42Reply={status:"already_applied",lead_credits_restored:0,cash_refunded_minor_units:0,
  original_assignment_id:"44444444-4444-4444-8444-444444444444",
  credit_restoration_approval_id:"55555555-5555-4555-8555-555555555555"};
 const reply=await apply(REPORT,"restore_credit",ACTOR);
 assert.equal(reply.ok,true);assert.equal(reply.data.restorationStatus,"already_applied");
 assert.equal(reply.data.creditRestorationApprovalId,"55555555-5555-4555-8555-555555555555");
 assert.equal(reply.data.leadCreditsRestored,0);
 assert.equal(calls.length,1);
});
test("an attempted credit RPC transport failure never claims rollback or allows a new grant",async()=>{
 before();process.env[gate]="staging";
 const original=globalThis.__rc42Db;
 try{
  globalThis.__rc42Db=()=>({rpc:async()=>{throw Error("private connection data");}});
  const thrown=await apply(REPORT,"restore_credit",ACTOR);
  assert.equal(thrown.ok,false);assert.equal(thrown.code,"CREDIT_OUTCOME_UNKNOWN");
  assert.equal(String(thrown.error).includes("private connection data"),false);
  globalThis.__rc42Db=()=>({rpc:async()=>({data:null,error:{message:"private backend state"}})});
  const result=await apply(REPORT,"restore_credit",ACTOR);
  assert.equal(result.ok,false);assert.equal(result.code,"CREDIT_OUTCOME_UNKNOWN");
  assert.equal(String(result.error).includes("private backend state"),false);
 }finally{globalThis.__rc42Db=original;}
});
test("hung canonical credit RPC is bounded, unknown and never automatically retried",async()=>{
 before();process.env[gate]="staging";
 const original=globalThis.__rc42Db;let attempted=0;
 try{
  globalThis.__rc42Db=()=>({rpc:async()=>{attempted++;return new Promise(()=>{});}});
  const start=Date.now();
  const r=await apply(REPORT,"restore_credit",ACTOR);
  assert.ok(Date.now()-start<1000);
  assert.equal(r.ok,false);assert.equal(r.code,"CREDIT_OUTCOME_UNKNOWN");
  assert.match(r.error,/Reconcile this exact bad-lead report/);
  assert.equal(attempted,1);
 }finally{globalThis.__rc42Db=original;}
});
test("unverifiable credit receipt is an uncertain outcome, never permission to grant again",async()=>{
 before();process.env[gate]="staging";
 globalThis.__rc42Reply={status:"applied",lead_credits_restored:2,
  cash_refunded_minor_units:0,original_assignment_id:"wrong"};
 const r=await apply(REPORT,"restore_credit",ACTOR);
 assert.equal(r.ok,false);assert.equal(r.code,"CREDIT_OUTCOME_UNKNOWN");
});
test("money or extra credits in RPC response never claim successful restoration",async()=>{
 before();process.env[gate]="staging";
 for(const bad of [
  {status:"applied",lead_credits_restored:2,cash_refunded_minor_units:0},
  {status:"applied",lead_credits_restored:1,cash_refunded_minor_units:100},
  {status:"applied",lead_credits_restored:1,cash_refunded_minor_units:0,automatic_replacement_created:true},
  {status:"already_applied",lead_credits_restored:1,cash_refunded_minor_units:0},
  {status:"applied",lead_credits_restored:1,cash_refunded_minor_units:0,automatic_replacement_created:false},
  {...globalThis.__rc42Reply,original_assignment_id:"wrong"},
  {...globalThis.__rc42Reply,credit_restoration_approval_id:null},
  {...globalThis.__rc42Reply,status:"already_applied",lead_credits_restored:0,automatic_replacement_created:true},
  {status:"rejected",reason_code:"human_approval_required"}
 ]){
  globalThis.__rc42Reply=bad;
  const r=await apply(REPORT,"restore_credit",ACTOR);
  assert.equal(r.ok,false);
 }
});
test("rejection never acknowledges forged money, credit or replacement effects",async()=>{
 before();
 for(const values of [
  {lead_credits_restored:1},
  {cash_refunded_minor_units:50},
  {automatic_replacement_created:true},
  {lead_credits_restored:2,cash_refunded_minor_units:100},
  {replacement_assignment_id:"66666666-6666-4666-8666-666666666666"},
  {monetary_refund_id:"refund_forged"}
 ]){
  globalThis.__rc42Reply={status:"applied",...values};
  const v=await apply(REPORT,"reject",ACTOR);
  assert.equal(v.ok,false);assert.equal(v.code,"REJECT_OUTCOME_UNKNOWN");
 }
 globalThis.__rc42Reply={status:"already_applied",lead_credits_restored:0,cash_refunded_minor_units:0};
 const v=await apply(REPORT,"reject",ACTOR);
 assert.equal(v.ok,true);
 assert.equal(v.data.replacementAssignmentId,null);
 assert.ok(calls.every(c=>c.name==="qf_apply_bad_lead_recovery_v1"));
});
test("rejection transport errors, null receipts and hanging RPC are UNKNOWN and never auto-retried",async()=>{
 before();
 const original=globalThis.__rc42Db;
 let calls=0;
 try{
  for(const mode of ["throw","null","hang"]){
   calls=0;
   globalThis.__rc42Db=()=>({rpc:async(name,args)=>{
    calls++;
    assert.equal(name,"qf_apply_bad_lead_recovery_v1");
    assert.equal(args.p_action,"reject");
    if(mode==="throw")throw Error("private backend detail");
    if(mode==="null")return {data:null,error:null};
    return new Promise(()=>{});
   }});
   const result=await apply(REPORT,"reject",ACTOR);
   assert.equal(result.ok,false);
   assert.equal(result.code,"REJECT_OUTCOME_UNKNOWN");
   assert.equal(String(result.error).includes("private backend detail"),false);
   assert.equal(calls,1);
  }
 }finally{globalThis.__rc42Db=original;}
});
test("advisory recommendation cannot masquerade as a payout or lead grant",async()=>{
 before();
 for(const effect of [{cash_refunded_minor_units:1},{lead_credits_restored:1},
  {replacement_assignment_id:"66666666-6666-4666-8666-666666666666"},
  {monetary_refund_id:"refund_forged"}]){
  globalThis.__rc42Reply={status:"applied",...effect};
  const r=await recommend(REPORT,"restore_credit");
  assert.equal(r.ok,false);assert.equal(r.code,"RECOMMENDATION_RESPONSE_INVALID");
 }
});
test("unverified actor ID blocked before all grant calls",async()=>{
 before();process.env[gate]="staging";
 assert.equal((await apply(REPORT,"restore_credit","forged-actor")).ok,false);
 assert.equal(calls.length,0);
});
test("malformed report ID cannot reach recommendation or credit lookup",async()=>{
 before();
 for(const bad of ["","../other","not-uuid",null]){
  const recommendResult=await recommend(bad,"restore_credit");
  const generateResult=await generate(bad);
  assert.equal(recommendResult.code,"VALIDATION");
  assert.equal(generateResult.code,"VALIDATION");
 }
 assert.equal(calls.length,0);
});
test("recommendation refuses legacy direct replacement before database",async()=>{
 before();assert.equal((await recommend(REPORT,"replace")).ok,false);
 assert.equal((await recommend(REPORT,"restore_credit_and_replace")).ok,false);
 assert.equal(calls.length,0);
});
process.on("exit",()=>{try{rmSync(tmp,{recursive:true,force:true});}catch{}});


test("RC82 canonical rejection writer stays hard-OFF in actual source",()=>{
 const src=readFileSync(resolve(root,"services/badLeadRecoveryService.ts"),"utf8");
 assert.match(src,/RC82_BAD_LEAD_REJECTION_RPC_INSTALLED=false as const/);
 assert.match(src,/if\(!RC82_BAD_LEAD_REJECTION_RPC_INSTALLED \|\|/);
 assert.match(src,/QF_VOX_BAD_LEAD_REJECT_RPC_ENABLED/);
});
test("RC82 rejection cannot run without distinct reviewed Staging permission",async()=>{
 before();delete process.env[rejectGate];
 const r=await apply(REPORT,"reject",ACTOR);
 assert.equal(r.ok,false);assert.equal(r.code,"BAD_LEAD_REJECTION_NOT_APPROVED");
 assert.equal(calls.length,0);
 process.env[rejectGate]="production";
 const second=await apply(REPORT,"reject",ACTOR);
 assert.equal(second.ok,false);assert.equal(second.code,"BAD_LEAD_REJECTION_NOT_APPROVED");
 assert.equal(calls.length,0);
});
