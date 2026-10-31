#!/usr/bin/env node
// RC28 review-only genuine PG17 event ledger proof, no managed DB or Razorpay.
import {readFileSync} from "node:fs";
import {resolve,dirname} from "node:path";
import {fileURLToPath} from "node:url";
import {randomUUID} from "node:crypto";
import {spawnSync} from "node:child_process";
import {buildRazorpayProviderEventEnvelope} from "../../../lib/payments/vendorPackageProviderEventLedger.mjs";
import {createRc28VendorPackageEventRepository} from "../../../lib/payments/vendorPackageProviderEventRepository.mjs";
import {processVendorPackageProviderEvent} from "../../../lib/payments/vendorPackageProviderEventProcessing.mjs";
const root=resolve(dirname(fileURLToPath(import.meta.url)),"../../..");
const file=resolve(root,"scripts/mvp/vox/fixtures/rc28-review-only-provider-event-ledger.pg17.sql");
const sql=readFileSync(file,"utf8");
for(const k of ["DATABASE_URL","SUPABASE_URL","SUPABASE_SERVICE_ROLE_KEY","RAZORPAY_LIVE_KEY_SECRET"])
 if(process.env[k])throw Error("RC28_MANAGED_CREDENTIAL_DENIED_"+k);
if(process.env.DOCKER_HOST&&!/^(npipe|unix):\/\//.test(process.env.DOCKER_HOST))
 throw Error("RC28_REMOTE_DOCKER_DENIED");
const name="qf-vox-rc28-event-ledger-"+randomUUID().slice(0,8);
const docker=(args,input="",allowedFailure=false)=>{
 const p=spawnSync("docker",args,{input,encoding:"utf8",timeout:30000});
 if(p.error||p.status!==0){if(allowedFailure)return p;throw Error("DOCKER_SQL_FAILED "+(p.stderr||p.error||"").slice(0,700))}
 return p;
};
const query=(text,allow=false)=>docker(["exec","-i","-e","PGPASSWORD=synthetic_only",name,
 "psql","-h","127.0.0.1","-X","-q","-A","-t","-U","postgres","-d","postgres",
 "-v","ON_ERROR_STOP=1"],text,allow);
const expect=(yes,why)=>{if(!yes)throw Error("RC28_LEDGER_PROOF_FAILED_"+why)};
const parse=s=>JSON.parse(s.stdout.trim().split(/\r?\n/).at(-1));
const id="evt_ABC12345678",h="a".repeat(64),bad="b".repeat(64);
const fn=(event,mode,hash,eventType="payment.captured")=>
 "SET ROLE service_role;SELECT public.qf_record_vendor_package_razorpay_event_v2("+
 ["'"+event+"'","'"+mode+"'","'"+hash+"'","'"+eventType+"'","'pay_ABC12345'","'order_ABC12345'"].join(",")+
 ")::text;";
const finish=(event,mode,hash,attempt,disposition,outcome,code)=>
 "SET ROLE service_role;SELECT public.qf_complete_vendor_package_razorpay_event_v2("+
 ["'"+event+"'","'"+mode+"'","'"+hash+"'",String(attempt),"'"+disposition+"'",
 outcome?"'"+outcome+"'":"NULL",code?"'"+code+"'":"NULL"].join(",")+")::text;";
let made=false;
try{
 docker(["image","inspect","postgres:17-alpine"]);
 docker(["run","--rm","--pull","never","--network","none","-d","--name",name,
 "-e","POSTGRES_PASSWORD=synthetic_only","postgres:17-alpine"]);
 made=true;
 let ready=false;
 for(let i=0;i<100;i++){
  const x=docker(["exec",name,"pg_isready","-q","-h","127.0.0.1","-U","postgres","-d","postgres"],"",true);
  if(x.status===0){ready=true;break}
  await new Promise(r=>setTimeout(r,120));
 }
 expect(ready,"FINAL_POSTGRES_NOT_READY");
 query("CREATE ROLE service_role LOGIN BYPASSRLS; CREATE ROLE anon LOGIN;CREATE ROLE authenticated LOGIN;");
 query(sql);
 const a=parse(query(fn(id,"test",h)));
 expect(a.status==="claimed"&&a.attempt_count===1,"FIRST_CLAIM");
 expect(parse(query(fn(id,"test",h))).status==="in_flight","ACTIVE_LEASE");
 expect(parse(query(fn(id,"test",bad))).status==="conflict","BODY_HASH_DRIFT");
 const wrong=query(finish(id,"test",h,9,"completed","activated",null),true);
 expect(wrong.status!==0,"STALE_ATTEMPT_REJECTED");
 const complete=parse(query(finish(id,"test",h,1,"completed","activated",null)));
 expect(complete.status==="completed"&&complete.outcome==="activated","EXACT_COMPLETION");
 expect(parse(query(fn(id,"test",h))).outcome==="activated","REPLAY_DURABLE");
 const live=parse(query(fn(id,"live",h)));
 expect(live.status==="claimed"&&live.attempt_count===1,"TEST_LIVE_ISOLATION");
 const unauthorized=query("SET ROLE authenticated;SELECT public.qf_record_vendor_package_razorpay_event_v2("+
  "'"+id+"','test','"+h+"','payment.captured','pay_ABC12345','order_ABC12345');",true);
 expect(unauthorized.status!==0,"AUTHENTICATED_RPC_DENIED");
 const grants=query("SELECT has_table_privilege('anon','public.qf_vendor_package_provider_events_candidate_v2','SELECT')::text,"+
  "has_table_privilege('authenticated','public.qf_vendor_package_provider_events_candidate_v2','INSERT')::text,"+
  "has_function_privilege('authenticated','public.qf_record_vendor_package_razorpay_event_v2(text,text,text,text,text,text)','EXECUTE')::text;");
 expect(grants.stdout.trim()==="false|false|false"||grants.stdout.trim()==="f|f|f","DENY_GRANTS");
 const rls=query("SELECT relrowsecurity::text||'|'||relforcerowsecurity::text FROM pg_class WHERE oid="+
  "'public.qf_vendor_package_provider_events_candidate_v2'::regclass;");
 expect(rls.stdout.trim()==="true|true"||rls.stdout.trim()==="t|t","RLS_FORCE");
 query("UPDATE public.qf_vendor_package_provider_events_candidate_v2 SET claimed_at=clock_timestamp()-interval '6 minutes'"+
  " WHERE event_id='"+id+"' AND provider_mode='live';");
 const reclaimed=parse(query(fn(id,"live",h)));
 expect(reclaimed.status==="claimed"&&reclaimed.attempt_count===2,"STALE_LEASE_RECLAIMED");
 expect(query(finish(id,"live",h,1,"completed","activated",null),true).status!==0,"STALE_FENCED");
 expect(parse(query(finish(id,"live",h,2,"quarantined",null,"PROVIDER_EVENT_FAILED"))).status===
  "quarantined","QUARANTINE_RECEIPT");
 expect(parse(query(fn(id,"live",h))).status==="quarantined","QUARANTINE_REPLAY");
 // A genuine unknown provider settlement cannot be marked completed or
 // acknowledged merely because the bounded automatic attempt budget ended.
 const exhaustedId="evt_RC30UNKNOWN25";
 const firstUnknown=parse(query(fn(exhaustedId,"test",h)));
 expect(firstUnknown.status==="claimed","UNKNOWN_INITIAL_CLAIM");
 query("UPDATE public.qf_vendor_package_provider_events_candidate_v2 "+
  "SET status='retryable',claimed_at=NULL,attempt_count=25,"+
  "error_code='PROVIDER_EVENT_HTTP_UNCERTAIN' WHERE event_id='"+
  exhaustedId+"' AND provider_mode='test';");
 const exhausted=parse(query(fn(exhaustedId,"test",h)));
 expect(exhausted.status==="needs_reconciliation"&&
  exhausted.last_error_code==="PROVIDER_EVENT_ATTEMPTS_EXHAUSTED",
  "EXHAUSTED_UNCERTAIN_NEVER_ACK");
 const exhaustedAgain=parse(query(fn(exhaustedId,"test",h)));
 expect(exhaustedAgain.status==="needs_reconciliation","EXHAUSTION_NO_NEW_CLAIM");
 const persisted=query("SELECT status||'|'||attempt_count||'|'||error_code "+
  "FROM public.qf_vendor_package_provider_events_candidate_v2 "+
  "WHERE event_id='"+exhaustedId+"' AND provider_mode='test';");
 expect(persisted.stdout.trim()==="retryable|25|PROVIDER_EVENT_ATTEMPTS_EXHAUSTED",
  "UNRESOLVED_PAYMENT_PERSISTED_NO_ACK");
 // Full integration proof: the SAME repository implementation and orchestration
 // used by source contracts now call actual isolated PostgreSQL RPCs.
 const allowed={
  qf_record_vendor_package_razorpay_event_v2:[
   "p_event_id","p_provider_mode","p_body_sha256","p_event_type",
   "p_payment_id","p_provider_order_id"],
  qf_complete_vendor_package_razorpay_event_v2:[
   "p_event_id","p_provider_mode","p_body_sha256","p_attempt_count",
   "p_disposition","p_outcome","p_error_code"]
 };
 const sqlLiteral=x=>x===null?"NULL":typeof x==="number"?String(x):
  "'"+String(x).replaceAll("'","''")+"'";
 const callRpc=async(name,args)=>{
  if(!Object.hasOwn(allowed,name))throw Error("UNREVIEWED_RPC_REFUSED");
  const stmt="SET ROLE service_role;SELECT public."+name+"("+
   allowed[name].map(k=>sqlLiteral(args[k])).join(",")+")::text;";
  return {data:parse(query(stmt)),error:null};
 };
 const envelope=buildRazorpayProviderEventEnvelope({
  eventId:"evt_RC28ACTUALDB1",providerMode:"test",bodySha256:"c".repeat(64),
  candidate:{kind:"captured",paymentId:"pay_ABC12345",providerOrderId:"order_ABC12345"}});
 let coreCalls=0;
 const processed=await processVendorPackageProviderEvent({
  envelope,repository:createRc28VendorPackageEventRepository(callRpc),
  handle:async()=>{coreCalls++;return "activated";}
 });
 expect(processed.ack===true&&processed.status==="activated"&&coreCalls===1,
  "REAL_REPOSITORY_FIRST_ACTIVATION");
 const redelivery=await processVendorPackageProviderEvent({
  envelope,repository:createRc28VendorPackageEventRepository(callRpc),
  handle:async()=>{coreCalls++;return "activated";}
 });
 expect(redelivery.ack===true&&redelivery.replay===true&&coreCalls===1,
  "REAL_REPOSITORY_REPLAY_NO_DOUBLE_CORE"); console.log("VOX_RC28_REAL_PG17_EVENT_LEDGER_PASS first_claim=true body_conflict=true"+
 " exact_once_replay=true stale_attempt_fenced=true test_live_separated=true"+
 " quarantine=true anon_auth_denied=true force_rls=true adapter_pg17_integrated=true"+
 " provider_calls=0 managed_release=false");
}finally{if(made)docker(["rm","-f",name],"",true)}
