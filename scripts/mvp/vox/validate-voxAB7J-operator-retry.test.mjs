import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFileSync} from "node:fs";
import ts from "typescript";
const file=readFileSync(new URL("../../../services/jarvisOperatorCommandService.ts",import.meta.url),"utf8");
const compiled=ts.transpileModule(file,{compilerOptions:{
 module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022
}}).outputText;
const id=n=>"00000000-0000-4000-8000-"+String(n).padStart(12,"0");
const flag="VOX_AB7H_SIGNED_OPERATOR_ATOMIC_ENABLED";
function scenario(){
 let receipt=null,approved=false,nativeWrites=0,finalizations=0;
 let eventId=id(3),splitWrites=0;
 const command={commandId:id(1),idempotencyKey:"signed-1",action:"CONVERSATION_PAUSE_AI",
  payload:{conversationId:id(2),expectedRevision:7}};
 const rawBody=Buffer.from("signed-raw-request-immutable");
 const actorId="jarvis-os:operator1";
 function db(){
 return {
  from(table){
   if(table!=="jarvis_os_operator_command_receipts"){
    splitWrites++;throw new Error("LEGACY_SPLIT_WRITER_INVOKED");
   }
   return {
    insert:async row=>receipt?{error:{code:"23505"}}:((receipt={...row}),{error:null}),
    select:()=>({or:()=>({limit:async()=>({error:null,data:receipt?[receipt]:[]})})}),
    update:row=>({eq(){return this;},select:async()=>{
     if(!receipt||receipt.state!=="CLAIMED")return {error:null,data:[]};
     receipt={...receipt,...row};finalizations++;
     return {error:null,data:[{command_id:command.commandId}]};
    }})
   };
  },
  rpc:async (name,p)=>{
   assert.equal(name,"qf_vox_ab7h_signed_operator_atomic_candidate_v1");
   nativeWrites++;
   assert.equal(p.p_digest,createHash("sha256").update(rawBody).digest("hex"));
   assert.equal(p.p_operator_label,actorId);
   if(!approved)return {error:{code:"AB7H_INDEPENDENT_SIGNED_REVIEW_REQUIRED"},data:null};
   return {error:null,data:[{
    event_id:eventId,new_revision:8,new_state:"PAUSED",command_id:command.commandId
   }]};
  }
 };
 }
 const module={exports:{}};
 new Function("require","module","exports",compiled)((name)=>{
  if(name==="server-only")return {};
  if(name==="node:crypto")return {createHash};
  if(name==="@/lib/supabase")return {adminClient:db};
  if(name==="@/lib/jarvis/operatorCommandContract")return {
   QFJ_OPERATOR_COMMAND_PROTOCOL:"qf.operator.v1",
   parseQfjOperatorCommandResult:x=>x};
  if(name==="@/services/automationPersistenceService")return {};
  if(name==="@/services/agniGovernanceService")return {};
  if(name==="@/services/conversationalWhatsAppService")return {};
  throw Error("Unexpected dependency "+name);
 },module,module.exports);
 return {
  execute:()=>module.exports.executeJarvisOperatorCommand({command,rawBody,operatorId:"operator1"}),
  approve:()=>{approved=true},
  get receipt(){return receipt},
  get nativeWrites(){return nativeWrites},
  get finalizations(){return finalizations},
  get splitWrites(){return splitWrites}
 };
}
test("AB7J unapproved signed STOP stays claimed; exact retry after independent approval executes once",async()=>{
 const previous=process.env[flag];process.env[flag]="staging";
 try{
  const x=scenario();
  const pending=await x.execute();
  assert.equal(pending.status,"UNAVAILABLE");
  assert.equal(x.receipt.state,"CLAIMED");
  assert.equal(x.finalizations,0);
  x.approve();
  const applied=await x.execute();
  assert.equal(applied.status,"APPLIED_BY_AUTHORITY");
  assert.equal(x.receipt.state,"FINALIZED");
  assert.equal(x.nativeWrites,2);
  assert.equal(x.finalizations,1);
  const third=await x.execute();
  assert.equal(third.status,"APPLIED_BY_AUTHORITY");
  assert.equal(x.nativeWrites,2);
  assert.equal(x.splitWrites,0);
 }finally{
  if(previous===undefined)delete process.env[flag];
  else process.env[flag]=previous;
 }
});
