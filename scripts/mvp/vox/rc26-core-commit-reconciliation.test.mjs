import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {resolve,dirname} from "node:path";
import {fileURLToPath} from "node:url";
import ts from "typescript";
const root=resolve(dirname(fileURLToPath(import.meta.url)),"../../..");
const read=p=>readFileSync(resolve(root,p),"utf8");
// Node 20 is still used by legacy VOX source CI. Transpile only this local,
// import-free TypeScript module into native ES module JavaScript for testing.
// Root tsc independently validates types; do not skip transpile diagnostics.
const compiled=ts.transpileModule(read("services/vox/rc26CoreCommitReconciliation.ts"),{
 compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022},
 reportDiagnostics:true
});
if(compiled.diagnostics?.some(x=>x.category===ts.DiagnosticCategory.Error))
 throw Error("RC26_CORE_RECONCILIATION_TS_TRANSPILE_FAILED");
const {reconcileRc8CoreCommitOutcome,RC26_CORE_RECONCILER_ROUTE_INSTALLED}=
 await import("data:text/javascript;base64,"+
  Buffer.from(compiled.outputText,"utf8").toString("base64"));
const id=n=>"00000000-0000-4000-8000-"+String(n).padStart(12,"0");
const CONV=id(1),NONCE=id(2),ACTOR=id(3),EVENT=id(4);
const original={conversationId:CONV,nonce:NONCE,actorId:ACTOR,action:"TAKEOVER",expectedRevision:0};
const receipt={nonce:NONCE,conversation_id:CONV,actor_id:ACTOR,action:"TAKEOVER",
 previous_revision:"0",new_revision:"1",event_id:EVENT,consent_scope:"transactional",
 event_conversation_id:CONV};
function fake(over={}){
 const queries=[],released=[];
 const db={
  query:async(sql,values=[])=>{
   queries.push({sql,values});
   if(over.throwOn&&sql.startsWith(over.throwOn))throw Error("synthetic");
   if(sql.includes("FROM public.communication_conversations"))
    return over.noConversation?{rows:[],rowCount:0}:{rows:[{id:CONV}],rowCount:1};
   if(sql.includes("vox_rc8_conversation_operator_receipts_candidate_v1")){
    const rows=over.receipts??[receipt];return {rows,rowCount:rows.length};
   }
   return {rows:[],rowCount:0};
  },
  release:destroy=>released.push(destroy===true)
 };
 return {db,queries,released,acquire:async()=>db};
}
const noWrites=q=>assert.equal(q.some(x=>/\b(COMMIT|INSERT|UPDATE|DELETE|TRUNCATE)\b/.test(x.sql)),false);
test("release flags stay hard-off",()=>{
 assert.equal(RC26_CORE_RECONCILER_ROUTE_INSTALLED,false);
 assert.match(read("services/vox/rc8PgVendorConversationOperator.ts"),/RC8_CORE_WRITER_INSTALLED=false as const/);
 assert.match(read("services/vox/rc19VerifiedConversationWriter.ts"),/RC19_VERIFIED_CORE_WRITER_INSTALLED=false as const/);
 assert.doesNotMatch(read("services/vox/rc26CoreCommitReconciliation.ts"),/fetch\(|\.send\(|adminClient|process\.env/);
});
test("durable matching receipt+event => COMMITTED, lock before receipt read, always rollback",async()=>{
 const f=fake();
 const r=await reconcileRc8CoreCommitOutcome(original,f.acquire);
 assert.equal(r.outcome,"COMMITTED");assert.equal(r.revision,1);
 assert.equal(r.requiresReconciliation,false);assert.equal(r.providerMessagesSent,0);
 assert.match(f.queries[0].sql,/BEGIN TRANSACTION ISOLATION LEVEL READ COMMITTED READ WRITE/);
 assert.match(f.queries[1].sql,/SET LOCAL lock_timeout/);
 assert.match(f.queries[2].sql,/communication_conversations WHERE id=\$1::uuid FOR SHARE/);
 assert.deepEqual(f.queries[2].values,[CONV]);
 assert.match(f.queries[3].sql,/receipts_candidate_v1/);assert.deepEqual(f.queries[3].values,[NONCE]);
 assert.equal(f.queries.at(-1).sql,"ROLLBACK");
 assert.deepEqual(f.released,[false]);noWrites(f.queries);
});
test("no receipt after writer lock released => durable NOT_COMMITTED",async()=>{
 const f=fake({receipts:[]});
 const r=await reconcileRc8CoreCommitOutcome(original,f.acquire);
 assert.equal(r.outcome,"NOT_COMMITTED");assert.equal(r.revision,null);
 assert.equal(f.queries.at(-1).sql,"ROLLBACK");noWrites(f.queries);
});
test("nonce bound to a different command, actor, revision or missing event => CONFLICT",async()=>{
 for(const bad of [{actor_id:id(9)},{conversation_id:id(9)},{action:"PAUSE_AI"},
   {previous_revision:"1"},{new_revision:"2"},{consent_scope:"marketing"},
   {event_conversation_id:null},{event_id:null}]){
  const f=fake({receipts:[{...receipt,...bad}]});
  const r=await reconcileRc8CoreCommitOutcome(original,f.acquire);
  assert.equal(r.outcome,"CONFLICT",JSON.stringify(bad));
 }
 const dup=fake({receipts:[receipt,receipt]});
 assert.equal((await reconcileRc8CoreCommitOutcome(original,dup.acquire)).outcome,"CONFLICT");
});
test("lock timeout / read failure stays UNKNOWN and never claims rollback",async()=>{
 for(const at of ["SET LOCAL","SELECT id FROM","SELECT r.nonce"]){
  const f=fake({throwOn:at});
  const r=await reconcileRc8CoreCommitOutcome(original,f.acquire);
  assert.equal(r.outcome,"UNKNOWN");assert.equal(r.requiresReconciliation,true);
  assert.equal(f.queries.at(-1).sql,"ROLLBACK");assert.deepEqual(f.released,[false]);
 }
 const missing=fake({noConversation:true});
 assert.equal((await reconcileRc8CoreCommitOutcome(original,missing.acquire)).outcome,"UNKNOWN");
});
test("unverified ROLLBACK destroys the connection instead of pooling it",async()=>{
 const f=fake({throwOn:"ROLLBACK"});
 const r=await reconcileRc8CoreCommitOutcome(original,f.acquire);
 assert.equal(r.outcome,"COMMITTED");assert.deepEqual(f.released,[true]);
});
test("invalid input never acquires a connection",async()=>{
 let acquired=0;const acquire=async()=>{acquired++;return fake().db};
 for(const bad of [null,{},{...original,nonce:"x"},{...original,actorId:"x"},
   {...original,action:"SEND"},{...original,expectedRevision:-1},
   {...original,expectedRevision:2147483647},{...original,expectedRevision:1.5}]){
  assert.equal((await reconcileRc8CoreCommitOutcome(bad,acquire)).outcome,"UNKNOWN");
 }
 assert.equal(acquired,0);
 assert.equal((await reconcileRc8CoreCommitOutcome(original,async()=>null)).reason,"TRANSACTION_ADAPTER_INVALID");
});
