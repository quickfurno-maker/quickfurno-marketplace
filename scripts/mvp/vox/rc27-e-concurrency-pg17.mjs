#!/usr/bin/env node
// RC28 isolated PG17 race proof. Always RUN the test; no skipping.
// Executed as a separate mandatory CI step after docker pull postgres:17-alpine.
// Deliberately not a *.test.mjs source-only suite: the RC4 source gate has no
// managed or disposable database and correctly prohibits skipped tests.
import test from "node:test";
import assert from "node:assert/strict";
import {spawn,spawnSync} from "node:child_process";
import {randomUUID} from "node:crypto";
// ---------------------------------------------------------------------------
// Native PG17 two-session race: D2-D STOP vs Staff TAKEOVER.
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
 {timeout:180000},
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
