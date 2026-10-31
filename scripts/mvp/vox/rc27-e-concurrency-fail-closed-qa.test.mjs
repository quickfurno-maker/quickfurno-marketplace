// RC27-E QA: concurrency races and cross-mode fail-closed gates.
// Source/pure tests always run offline. The native PG17 race harness runs only
// with RC27_NATIVE_PG17=1 in a network-isolated disposable docker container
// (no managed DB, no provider). It never touches runtime Core/Finance/EOD code.
import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {resolve,dirname} from "node:path";
import {fileURLToPath} from "node:url";
import {spawn,spawnSync} from "node:child_process";
import {randomUUID} from "node:crypto";
import {vendorPackageEventLedgerConfigError,vendorPackageEventLedgerMode}
 from "../../../lib/payments/vendorPackageProviderEventLedger.mjs";
import {assessVendorPackageRefundEvidence as assessRefund}
 from "../../../lib/payments/vendorPackageRefundEvidence.mjs";
import {reconcileRefundAgainstCreditEvidence as reconcile}
 from "../../../lib/payments/vendorPackageRefundReconciliationReview.mjs";
import {assertReadOnlyProbe,assertPlanNonExecuting,buildRc26MigrationReleasePlan}
 from "./rc26-migration-release-plan.mjs";

const root=resolve(dirname(fileURLToPath(import.meta.url)),"../../..");
const read=p=>readFileSync(resolve(root,p),"utf8");
let fetchCalls=0;
const realFetch=globalThis.fetch;
test.before(()=>{globalThis.fetch=async()=>{fetchCalls++;throw Error("PROVIDER_CALL_FORBIDDEN")}});
test.after(()=>{globalThis.fetch=realFetch;assert.equal(fetchCalls,0,"no provider calls")});

// In REPEATABLE READ/SERIALIZABLE the snapshot is fixed by the first
// snapshot-taking statement (any SELECT, including SELECT pg_advisory_xact_lock).
// LOCK TABLE does not take a snapshot. A lock acquired after the snapshot cannot
// make rows committed by the lock holder visible.
function serializableQueries(src){
 const begin=src.indexOf("BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE");
 assert.ok(begin>=0,"SERIALIZABLE transaction expected");
 const out=[];const re=/\.query\(\s*(?:"([^"]*)"|([A-Za-z_]\w*))/g;re.lastIndex=begin;
 // lastIndex starts inside the BEGIN literal, so BEGIN itself is not captured.
 let m;while((m=re.exec(src))&&out.length<4){
  const sql=(m[1]??m[2]).trim();if(sql!=="ROLLBACK")out.push(sql);
 }
 return out;
}
const takesSnapshot=sql=>/^SELECT\b/i.test(sql)||/^[a-z_]\w*$/i.test(sql);

test("EOD signed-intent writer locks revocations BEFORE its SERIALIZABLE snapshot",()=>{
 const src=read("scripts/mvp/vox/rc8-pg-signed-intent-writer.mjs");
 const [first]=serializableQueries(src);
 assert.match(first,/^LOCK TABLE\b/,"first statement must be a non-snapshot LOCK");
 assert.match(src,/signer_revocations_candidate_v1 IN SHARE MODE"\);/);
});

test("Core D2-D: session lock precedes SERIALIZABLE snapshot; writer gate stays OFF",()=>{
 const src=read("services/vox/rc8PgVendorConversationOperator.ts");
 const q=serializableQueries(src);
 // The RC27 source must hold the D2-D session key before the snapshot, even
 // though the inner SERIALIZABLE transaction also takes an xact-level lock.
 const sessionLock=src.indexOf("await db.query(destinationSessionLock,[hash])");
 const snapshot=src.indexOf('await db.query("BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE READ WRITE")');
 const unlock=src.indexOf("await db.query(destinationSessionUnlock,[lockHash])");
 assert.ok(sessionLock>0&&snapshot>sessionLock&&unlock>snapshot,
  "destination lock must bracket the SERIALIZABLE snapshot, then unlock");
 assert.match(src,/RC8_CORE_WRITER_INSTALLED=false as const/);
 assert.match(src,/allConsentMutationPathsSerialized:false/);
 const lockAt=q.findIndex(s=>/pg_advisory_xact_lock|^LOCK TABLE/.test(s));
 const snapshotBeforeLock=lockAt<0||q.slice(0,lockAt).some(takesSnapshot)||
  /^SELECT pg_advisory_xact_lock/.test(q[lockAt]);
 if(snapshotBeforeLock){
  // Known RC26 blocker 1: concurrent D2-D STOP suppression can be invisible.
  assert.match(src,/RC8_CORE_WRITER_INSTALLED=false as const/);
  assert.match(src,/allConsentMutationPathsSerialized:false/);
  assert.match(read("services/vox/rc19VerifiedConversationWriter.ts"),
   /RC19_VERIFIED_CORE_WRITER_INSTALLED=false as const/);
 }
 // D2-D STOP writers must keep taking the same destination advisory key.
 const d2d=read("supabase/migrations/20260712000300_communication_consent_command_writer_rpc.sql");
 assert.match(d2d,/pg_advisory_xact_lock\(hashtextextended\('dst\|' \|\| p_destination_hash \|\| '\|' \|\| p_channel, 0\)\)/);
 assert.match(src,/hashtextextended\('dst\|' \|\| \$1::text \|\| '\|whatsapp',0\)/);
});

test("cross-mode ledger config: only exact lowercase test|live; LIVE never without enforce",()=>{
 for(const mode of ["Live","TEST"," live","test ","prod","production","sandbox",0,true,{}])
  for(const ledger of ["off","enforce"])
   assert.notEqual(vendorPackageEventLedgerConfigError(mode,ledger),null,JSON.stringify([mode,ledger]));
 for(const ledger of [vendorPackageEventLedgerMode("off"),vendorPackageEventLedgerMode(""),
   vendorPackageEventLedgerMode("on"),vendorPackageEventLedgerMode("1")])
  assert.notEqual(vendorPackageEventLedgerConfigError("live",ledger),null);
});

const ORDER_ID="00000000-0000-4000-8000-000000000101";
const VENDOR_ID="00000000-0000-4000-8000-000000000102";
const refundBase={localOrderId:ORDER_ID,paymentId:"pay_ABC12345",providerMode:"test",
 providerReconciled:true,paymentCaptured:true,paymentRefunded:false,refundPending:false,
 activationStatus:"activated",creditsGranted:10,creditsConsumed:0,creditsRemaining:10};
test("refund evidence fuzz: no mode/lifecycle combination ever authorizes money or credit revocation",()=>{
 let cases=0;
 for(const providerMode of ["test","live","TEST","LIVE","",null,"disabled"])
  for(const paymentCaptured of [true,false,"unknown",null])
   for(const providerReconciled of [true,false,null])
    for(const refundPending of [false,true,null])
     for(const activationStatus of ["activated","pending","failed"])
      for(const [creditsConsumed,creditsRemaining] of [[0,10],[3,7],[3,6],[11,-1],[null,10]]){
      const ev={...refundBase,providerMode,paymentCaptured,providerReconciled,refundPending,activationStatus,
       creditsConsumed,creditsRemaining};
      const a=assessRefund(ev);cases++;
      assert.notEqual(a.refundAllowed,true,JSON.stringify(ev));
      const r=reconcile({vendorId:VENDOR_ID,refundEvidence:ev});
      assert.notEqual(r.refundAllowed,true,JSON.stringify(ev));
      assert.notEqual(r.creditRevocationAllowed,true,JSON.stringify(ev));
      if(creditsConsumed!==0)assert.notEqual(a.ok&&r.ok,true,"consumed/unknown credits never clean");
     }
 assert.ok(cases>2000);
});

test("migration plan: more forged authority and non-SELECT probes fail closed",()=>{
 const plan=buildRc26MigrationReleasePlan();
 const allApproved=plan.steps.map(s=>({...s,approvals:Object.fromEntries(
  Object.keys(s.approvals).map(k=>[k,"approved"]))}));
 for(const forged of [
  {...plan,managedWrites:true},
  {...plan,steps:allApproved},
  {...plan,forbiddenOperations:plan.forbiddenOperations.filter(x=>!/db push/.test(x))},
  {...plan,steps:plan.steps.slice(1)},
 ])assert.throws(()=>assertPlanNonExecuting(forged),/RC26_/);
 for(const sql of [
  "copy (select 1) to program 'id'",
  "select lo_import('/etc/passwd')",
  "select dblink_exec('host=x','drop table t')",
  "select pg_terminate_backend(1)",
  "select set_config('search_path','evil',true)",
  "select 1;\nalter role postgres superuser",
 ])assert.throws(()=>assertReadOnlyProbe(sql),/RC26_PROBE_NOT_READ_ONLY/,sql);
});

// ---------------------------------------------------------------------------
// Native PG17 two-session race: D2-D STOP vs Staff TAKEOVER.
const NATIVE=process.env.RC27_NATIVE_PG17==="1";
const HASH="a".repeat(64);
function psqlSync(c,sql){
 const r=spawnSync("docker",["exec","-i","-e","PGPASSWORD=isolated_rc27e_only",c,"psql","-h","127.0.0.1","-U","postgres","-X","-q","-At",
  "-v","ON_ERROR_STOP=1"],{input:sql,encoding:"utf8",timeout:30000});
 if(r.status!==0)throw Error("PSQL_FAILED: "+r.stderr);
 return r.stdout.trim();
}
function psqlAsync(c,sql){
 const p=spawn("docker",["exec","-i","-e","PGPASSWORD=isolated_rc27e_only",c,"psql","-h","127.0.0.1","-U","postgres","-X","-q","-At",
  "-v","ON_ERROR_STOP=1"]);
 let out="",err="";p.stdout.on("data",d=>out+=d);p.stderr.on("data",d=>err+=d);
 p.stdin.end(sql);
 return new Promise(ok=>p.on("close",code=>ok({code,out,err})));
}
async function until(c,sql,label){
 for(let i=0;i<200;i++){
  try{if(psqlSync(c,sql)==="t")return}
  catch(e){
   // During initdb, the temporary Unix-socket server may appear and close.
   // Only the first READY probe may retry a connection-not-ready error;
   // all later SQL errors are genuine failures and must surface immediately.
   if(label!=="READY"||!/connection.*(?:refused|failed)|no such file|server is starting up/i.test(String(e)))
    throw e;
  }
  await new Promise(r=>setTimeout(r,50));
 }
 throw Error("BARRIER_TIMEOUT_"+label);
}
const waiting=app=>"SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='"+
 app+"' AND wait_event_type='Lock')";
async function race(c,variant){
 const conv=randomUUID(),tag=variant.toLowerCase();
 psqlSync(c,"INSERT INTO public.communication_conversations VALUES('"+conv+"','"+HASH+"',false,0);"+
  "DELETE FROM public.communication_suppressions;");
 const lockDst="SELECT pg_advisory_xact_lock(hashtextextended('dst|"+HASH+"|whatsapp',0));\n";
 const gate=psqlAsync(c,"SET application_name='rc27_gate_"+tag+"';\n"+
  "SELECT pg_advisory_lock(9001);\nSELECT pg_sleep(60);\n");
 await until(c,"SELECT EXISTS(SELECT 1 FROM pg_locks WHERE locktype='advisory' AND objid=9001 AND granted)","GATE");
 // D2-D STOP: destination lock, suppression insert, held open until the gate falls.
 const stop=psqlAsync(c,"SET application_name='rc27_stop_"+tag+"';\nBEGIN;\n"+lockDst+
  "INSERT INTO public.communication_suppressions(destination_hash,channel,scope,is_active) "+
  "VALUES('"+HASH+"','whatsapp','transactional',true);\n"+
  "SELECT pg_advisory_lock_shared(9001);\nCOMMIT;\n");
 await until(c,waiting("rc27_stop_"+tag),"STOP");
 const pre="SELECT destination_hash FROM public.communication_conversations WHERE id='"+conv+"';\n";
 const decide="SELECT 'SUPP='||count(*) FROM (SELECT 1 FROM public.communication_suppressions "+
  "WHERE destination_hash='"+HASH+"' AND channel='whatsapp' AND is_active FOR SHARE) s;\n"+
  "UPDATE public.communication_conversations SET human_takeover=true,revision=revision+1 "+
  "WHERE id='"+conv+"' AND NOT EXISTS(SELECT 1 FROM public.communication_suppressions "+
  "WHERE destination_hash='"+HASH+"' AND channel='whatsapp' AND is_active);\nCOMMIT;\n";
 const body={
  // Exact RC8 Core order: SERIALIZABLE, unlocked conversation read, then lock.
  RC8_CURRENT:"BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE READ WRITE;\n"+pre+lockDst,
  // Lock-first via SELECT still fixes the snapshot before the lock is granted.
  SERIALIZABLE_SELECT_LOCK_FIRST:"BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE READ WRITE;\n"+lockDst+pre,
  // Non-snapshot LOCK TABLE first (EOD pattern): snapshot after STOP commit.
  SERIALIZABLE_LOCK_TABLE_FIRST:"BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE READ WRITE;\n"+
   "LOCK TABLE public.communication_suppressions IN SHARE MODE;\n"+pre+lockDst,
  // READ COMMITTED: each statement after the lock gets a fresh snapshot.
  READ_COMMITTED_LOCK:"BEGIN TRANSACTION ISOLATION LEVEL READ COMMITTED READ WRITE;\n"+pre+lockDst,
 }[variant];
 const take=psqlAsync(c,"SET application_name='rc27_take_"+tag+"';\n"+body+decide);
 await until(c,waiting("rc27_take_"+tag),"TAKEOVER");
 psqlSync(c,"SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE application_name='rc27_gate_"+tag+"';");
 const [s,t]=await Promise.all([stop,take]);await gate;
 assert.equal(s.code,0,"STOP must commit: "+s.err);
 const final=psqlSync(c,"SELECT human_takeover||'|'||(SELECT count(*) FROM public.communication_suppressions "+
  "WHERE is_active) FROM public.communication_conversations WHERE id='"+conv+"';");
 return {variant,takeoverExit:t.code,takeoverOut:t.out.trim(),takeoverErr:t.err.trim(),final};
}

test("native PG17: D2-D STOP vs Staff TAKEOVER race (disposable, network none)",
 {skip:NATIVE?false:"set RC27_NATIVE_PG17=1 (requires local docker postgres:17-alpine)",timeout:180000},
 async()=>{
  const c="vox-rc27e-pg17-"+randomUUID().slice(0,12);
  const run=spawnSync("docker",["run","--rm","-d","--network","none","--name",c,
   "-e","POSTGRES_PASSWORD=isolated_rc27e_only","postgres:17-alpine"],{encoding:"utf8"});
  assert.equal(run.status,0,"ISOLATED_DOCKER_START_FAILED "+run.stderr);
  try{
   await until(c,"SELECT true","READY").catch(async()=>{
    await new Promise(r=>setTimeout(r,3000));await until(c,"SELECT true","READY");});
   assert.equal(psqlSync(c,"SHOW server_version_num").slice(0,2),"17");
   psqlSync(c,"CREATE TABLE public.communication_conversations(id uuid PRIMARY KEY,"+
    "destination_hash text NOT NULL,human_takeover boolean NOT NULL,revision int NOT NULL);"+
    "CREATE TABLE public.communication_suppressions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),"+
    "destination_hash text NOT NULL,channel text NOT NULL,scope text NOT NULL,is_active boolean NOT NULL);");
   const results={};
   for(const v of ["RC8_CURRENT","SERIALIZABLE_SELECT_LOCK_FIRST",
     "SERIALIZABLE_LOCK_TABLE_FIRST","READ_COMMITTED_LOCK"])results[v]=await race(c,v);
   console.log(JSON.stringify(results,null,1));
   // Safe orders: TAKEOVER sees the committed STOP and never takes over.
   for(const v of ["SERIALIZABLE_LOCK_TABLE_FIRST","READ_COMMITTED_LOCK"]){
    assert.equal(results[v].final,"false|1",v);
    assert.match(results[v].takeoverOut,/SUPP=1/,v);
   }
   // Hazard characterization: a stale snapshot hides the committed STOP, so
   // the takeover commits against an active suppression. This is the real race
   // that keeps the RC8 Core writer and serialization gate hard OFF.
   for(const v of ["RC8_CURRENT","SERIALIZABLE_SELECT_LOCK_FIRST"]){
    assert.equal(results[v].final,"true|1",v+" race not reproduced: "+JSON.stringify(results[v]));
    assert.match(results[v].takeoverOut,/SUPP=0/,v);
   }
  }finally{spawnSync("docker",["rm","-f",c],{encoding:"utf8"})}
 });
