import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync,mkdirSync} from "node:fs";
import {resolve,dirname} from "node:path";
import {fileURLToPath,pathToFileURL} from "node:url";
import {build} from "esbuild";
// RC27 Track A: the SERIALIZABLE snapshot must not exist until the D2-D
// destination lock is held. Mock adapter proves ordering + fail-closed unlock;
// the genuine two-backend race lives in validate-vox-rc8-real-pg-vendor-core.mjs.
const root=resolve(dirname(fileURLToPath(import.meta.url)),"../../..");
const read=p=>readFileSync(resolve(root,p),"utf8");
mkdirSync(resolve(root,"test-results"),{recursive:true});
const outfile=resolve(root,"test-results/vox-rc27-core-race-bundle.mjs");
await build({entryPoints:[resolve(root,"services/vox/rc8PgVendorConversationOperator.ts")],
 bundle:true,platform:"node",format:"esm",target:"node20",outfile,logLevel:"silent"});
const mod=await import(pathToFileURL(outfile).href+"?t="+Date.now());
const {executeRc8PgVendorConversationOperator:execute,RC8_CORE_WRITER_INSTALLED,
 RC27_DESTINATION_LOCK_TIMEOUT_MS}=mod;
const id=n=>"00000000-0000-4000-8000-"+String(n).padStart(12,"0");
const CONV=id(1),NONCE=id(2),STAFF=id(3),VENDOR=id(4),CITY=id(5),TEAM=id(6),
 HASH="a".repeat(64);
const input=()=>({conversationId:CONV,nonce:NONCE,expectedRevision:0,action:"TAKEOVER",
 verifiedStaff:{userId:STAFF,aal:"aal2",expiresAtMs:Date.now()+600000}});
function fake(over={}){
 const log=[],released=[];let inTx=false,lockHeld=false;
 const one=row=>({rows:[row],rowCount:1});
 const db={
  async query(sql,values=[]){
   log.push(sql);
   if(over.failOn&&over.failOn(sql))throw Object.assign(Error("synthetic"),{code:"55P03"});
   if(sql.startsWith("BEGIN")){inTx=true;return {rows:[],rowCount:0};}
   if(sql==="COMMIT"||sql==="ROLLBACK"){inTx=false;return {rows:[],rowCount:0};}
   if(sql.startsWith("SET LOCAL"))return {rows:[],rowCount:0};
   if(sql.startsWith("SELECT pg_advisory_lock(")){lockHeld=true;return one({pg_advisory_lock:""});}
   if(sql.startsWith("SELECT pg_advisory_unlock(")){
    const was=lockHeld;lockHeld=false;
    return one({unlocked:over.unlockResult??was});
   }
   if(sql.includes("FROM pg_catalog.pg_locks"))return one({held:over.leftover??(lockHeld?1:0)});
   if(sql.startsWith("SELECT pg_advisory_xact_lock("))return one({});
   if(sql.startsWith("SELECT destination_hash,subject_type"))
    return over.noConversation?{rows:[],rowCount:0}:one({destination_hash:HASH,subject_type:"vendor"});
   if(sql.startsWith("SELECT c.id,"))return one({id:CONV,tenant_id:"quickfurno",channel:"whatsapp",
    destination_hash:over.changedHash??HASH,subject_type:"vendor",subject_id:VENDOR,state:"OPEN",
    revision:"0",assigned_actor:"ANISHA",human_takeover:false,city_id:CITY,city_active:true,
    zone_active:true,zone_matching_enabled:true});
   if(sql.startsWith("SELECT m.auth_user_id"))return one({auth_user_id:STAFF,team_id:TEAM});
   if(sql.startsWith("SELECT cap.id"))return one({id:id(7),reviewer_id:id(8)});
   if(sql.includes("FROM public.vox_staff_object_scopes_v1 WHERE"))return one({id:id(9)});
   if(sql.includes("FROM public.communication_suppressions"))
    return over.suppressed?one({id:id(10),scope:"transactional",reason:"user_stop",
     policy_version:"qf-consent-v1",is_active:true,expires_at:null,deactivated_at:null}):
     {rows:[],rowCount:0};
   if(sql.includes("FROM public.communication_preferences"))return {rows:[],rowCount:0};
   if(sql.startsWith("UPDATE public.communication_conversations"))return one({id:CONV});
   if(sql.startsWith("INSERT INTO public.communication_conversation_events"))return one({id:id(11)});
   if(sql.startsWith("INSERT INTO public.vox_rc8_conversation_operator_receipts"))return one({nonce:NONCE});
   if(sql.startsWith("SELECT os.id"))return one({id:id(9)});
   throw Error("UNEXPECTED_SQL "+sql.slice(0,60));
  },
  release(destroy){released.push(destroy===true);}
 };
 return {log,released,acquire:async()=>db,state:()=>({inTx,lockHeld})};
}
const idx=(log,pred,from=0)=>log.findIndex((s,i)=>i>=from&&pred(s));
const isBeginSerializable=s=>s.startsWith("BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE");

test("release gate stays closed and lock timeout is bounded",()=>{
 assert.equal(RC8_CORE_WRITER_INSTALLED,false);
 assert.ok(RC27_DESTINATION_LOCK_TIMEOUT_MS>0&&RC27_DESTINATION_LOCK_TIMEOUT_MS<=5000);
});

test("destination session lock is held BEFORE the first SERIALIZABLE snapshot",async()=>{
 const f=fake();
 const r=await execute(input(),f.acquire);
 assert.equal(r.ok,true,JSON.stringify(r));
 const pre=idx(f.log,s=>s.startsWith("SELECT destination_hash"));
 const lock=idx(f.log,s=>s.startsWith("SELECT pg_advisory_lock("));
 const ser=idx(f.log,isBeginSerializable);
 assert.ok(pre>=0&&lock>pre&&ser>lock,"pre-read -> session lock -> serializable");
 // Destination hint is read in autocommit, never inside a transaction.
 assert.ok(!f.log.slice(0,pre).some(s=>s.startsWith("BEGIN")));
 // Lock wait is bounded inside its own short READ COMMITTED transaction.
 assert.match(f.log[lock-2],/^BEGIN TRANSACTION ISOLATION LEVEL READ COMMITTED/);
 assert.equal(f.log[lock-1],"SET LOCAL lock_timeout='"+RC27_DESTINATION_LOCK_TIMEOUT_MS+"ms'");
 assert.equal(f.log[lock+1],"COMMIT");
 // Only snapshot-free utility statements may precede the first serializable query.
 assert.match(f.log[ser+1],/^SET LOCAL lock_timeout=/);
 // Unlock strictly after the final COMMIT, verified, then pooled (not destroyed).
 const finalCommit=f.log.lastIndexOf("COMMIT");
 const unlock=idx(f.log,s=>s.startsWith("SELECT pg_advisory_unlock("));
 assert.ok(unlock>finalCommit&&finalCommit>ser);
 assert.ok(f.log[unlock+1].includes("pg_catalog.pg_locks"));
 assert.deepEqual(f.released,[false]);
 assert.deepEqual(f.state(),{inTx:false,lockHeld:false});
});

test("STOP visible after lock => consent denied, rollback, then verified unlock",async()=>{
 const f=fake({suppressed:true});
 const r=await execute(input(),f.acquire);
 assert.equal(r.reason,"CONSENT_DENIED");
 assert.equal(f.log.some(s=>s.startsWith("UPDATE ")),false);
 const rb=f.log.lastIndexOf("ROLLBACK");
 assert.ok(idx(f.log,s=>s.startsWith("SELECT pg_advisory_unlock("))>rb);
 assert.deepEqual(f.released,[false]);
});

test("lock timeout fails closed before any serializable transaction",async()=>{
 const f=fake({failOn:s=>s.startsWith("SELECT pg_advisory_lock(")});
 const r=await execute(input(),f.acquire);
 assert.equal(r.reason,"DESTINATION_LOCK_UNAVAILABLE");
 assert.equal(f.log.some(isBeginSerializable),false);
 assert.equal(f.log.some(s=>s.startsWith("UPDATE ")||s.startsWith("INSERT ")),false);
 assert.ok(f.log.includes("ROLLBACK"));
 assert.deepEqual(f.released,[false]);
});

test("destination changed between hint and FOR UPDATE => denied and unlocked",async()=>{
 const f=fake({changedHash:"b".repeat(64)});
 const r=await execute(input(),f.acquire);
 assert.equal(r.reason,"CURRENT_SUBJECT_SCOPE_OR_STATE_DENIED");
 assert.deepEqual(f.released,[false]);
 assert.equal(f.state().lockHeld,false);
});

test("missing conversation takes no lock and opens no transaction",async()=>{
 const f=fake({noConversation:true});
 const r=await execute(input(),f.acquire);
 assert.equal(r.reason,"CONVERSATION_NOT_FOUND");
 assert.equal(f.log.some(s=>s.startsWith("BEGIN")||s.includes("advisory")),false);
 assert.deepEqual(f.released,[false]);
});

for(const [label,over] of [
 ["unlock reports not held",{unlockResult:false}],
 ["advisory lock still present after unlock",{leftover:1}],
 ["unlock statement throws",{failOn:s=>s.startsWith("SELECT pg_advisory_unlock(")}],
 ["final rollback throws",{suppressed:true,failOn:s=>s==="ROLLBACK"}]
]){
 test("fail-closed unlock: "+label+" => connection destroyed",async()=>{
  const f=fake(over);
  await execute(input(),f.acquire);
  assert.deepEqual(f.released,[true]);
 });
}

test("commit outcome unknown destroys the session without reuse",async()=>{
 const f=fake({failOn:s=>s==="COMMIT"&&f.log.some(x=>x.startsWith("INSERT INTO public.vox_rc8"))});
 const r=await execute(input(),f.acquire);
 assert.equal(r.reason,"COMMIT_OUTCOME_UNKNOWN");
 assert.equal(f.log.some(s=>s.startsWith("SELECT pg_advisory_unlock(")),false);
 assert.deepEqual(f.released,[true]);
});

test("source order: session lock precedes serializable BEGIN; no second consent path",()=>{
 const core=read("services/vox/rc8PgVendorConversationOperator.ts");
 const body=core.slice(core.indexOf("export async function executeRc8PgVendorConversationOperator("));
 const lock=body.indexOf("await db.query(destinationSessionLock");
 const ser=body.indexOf('"BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE READ WRITE"');
 const pre=body.indexOf("SELECT destination_hash,subject_type");
 assert.ok(pre>0&&lock>pre&&ser>lock);
 assert.equal(body.split("BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE").length,2);
 assert.equal(body.split("authorizeConversationalWhatsAppConsent(").length,2);
 assert.match(core,/RC8_CORE_WRITER_INSTALLED=false as const/);
 assert.match(core,/allConsentMutationPathsSerialized:false/);
});
