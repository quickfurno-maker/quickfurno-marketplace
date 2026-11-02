import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const file=new URL("../../../app/api/vox/v1/work-transitions/route.ts",import.meta.url);
const js=ts.transpileModule(readFileSync(file,"utf8"),{
 compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}
}).outputText;
const uuid=n=>"00000000-0000-4000-8000-"+String(n).padStart(12,"0");
const flags=Object.fromEntries([
 "VOX_STAFF_READ_ENABLED","VOX_STAFF_GRANTS_ENABLED",
 "VOX_DEPARTMENT_ENFORCEMENT_ENABLED","VOX_WORK_ACTIONS_ENABLED"
].map(k=>[k,"staging"]));
const state={scopes:[],authCalls:0,dbCalls:0};
const scope=(departments=["service_support"])=>({
 userId:uuid(1),teamId:uuid(2),cityId:uuid(3),role:"support_agent",
 canMutate:false,canReadContent:true,
 prospectIds:[],vendorIds:[uuid(5)],supportThreadIds:[],conversationIds:[],
 verifiedDepartments:departments
});
const ctx=vm.createContext({process:{env:flags},Response,Request,setTimeout,clearTimeout});
const m=new vm.SourceTextModule(js,{context:ctx,identifier:"rc80-core-work"});
const imports=new Map([
 ["server-only",{}],
 ["@/lib/supabase",{adminClient:()=>({rpc:async(name,params)=>{
  state.dbCalls++;assert.equal(name,"qf_vox_work_transition_candidate_v1");
  assert.equal(params.p_actor,uuid(1));
  return {error:null,data:[{work_item_id:uuid(4),new_state:"ASSIGNED",new_revision:1}]};
 }})}],
 ["@/services/vox/verifiedScopedStaff",{getVerifiedScopedStaff:async()=>{
  const i=state.authCalls++;
  return state.scopes[i]??null;
 }}]
]);
await m.link(spec=>{
 const exports=imports.get(spec);assert.ok(exports,"unknown import "+spec);
 return new vm.SyntheticModule(Object.keys(exports),function(){
  for(const [k,v] of Object.entries(exports))this.setExport(k,v);
 },{context:ctx,identifier:spec});
});
await m.evaluate();
const post=rev=>new Request("https://staging-core.quickfurno.in/api/vox/v1/work-transitions",{
 method:"POST",headers:{"content-type":"application/json",authorization:"Bearer TEST_ONLY"},
 body:JSON.stringify({action:"CLAIM",itemId:uuid(4),expectedRevision:rev,nonce:uuid(6),reason:""})
});
const reset=(a,b)=>{state.scopes=[a,b];state.authCalls=0;state.dbCalls=0;};

test("same verified Staff actor, department pack and object grants confirm exact original nonce",async()=>{
 reset(scope(),scope());
 const r=await m.namespace.POST(post(0));
 assert.equal(r.status,200);
 const b=await r.json();
 assert.equal(b.nonce,uuid(6));assert.equal(b.revision,1);
 assert.equal(b.providerMessagesSent,0);assert.equal(state.dbCalls,1);
 assert.equal(state.authCalls,2);
});
test("post-write department substitution with identical object IDs is UNKNOWN",async()=>{
 reset(scope(["service_support"]),scope(["vendor_success"]));
 const r=await m.namespace.POST(post(0)),b=await r.json();
 assert.equal(r.status,503);assert.equal(b.error,"WORK_TRANSITION_OUTCOME_UNKNOWN");
 assert.equal(b.retrySameNonceOnly,true);assert.equal(b.committed,null);
 assert.equal(state.dbCalls,1);assert.equal(state.authCalls,2);
});
test("missing verified department proof after mutation can never certify success",async()=>{
 reset(scope(),{...scope(),verifiedDepartments:undefined});
 const r=await m.namespace.POST(post(0));
 assert.equal(r.status,503);assert.equal(state.dbCalls,1);
});
test("post-write role revocation also reports uncertain original command",async()=>{
 reset(scope(),{...scope(),role:"auditor"});
 const r=await m.namespace.POST(post(0));
 assert.equal(r.status,503);assert.equal(state.dbCalls,1);
});
test("int4 revision overflow is denied before Auth or SQL",async()=>{
 reset(scope(),scope());
 const r=await m.namespace.POST(post(2147483647));
 assert.equal(r.status,400);assert.equal(state.authCalls,0);assert.equal(state.dbCalls,0);
});