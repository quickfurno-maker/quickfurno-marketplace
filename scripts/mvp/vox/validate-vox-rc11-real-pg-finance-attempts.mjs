#!/usr/bin/env node
// RC11: REAL PG17 append-only Finance attempt evidence, entirely disposable.
// No payment mutation, provider calls, or managed environment connections.
import {Pool} from "pg";
import {execFileSync} from "node:child_process";
import {readFileSync} from "node:fs";
import {resolve,dirname} from "node:path";
import {fileURLToPath} from "node:url";
const root=resolve(dirname(fileURLToPath(import.meta.url)),"../../..");
const container="qf-vox-rc11-finance-pg17";
const docker=args=>execFileSync("docker",args,{encoding:"utf8",timeout:20000,windowsHide:true,
 stdio:["ignore","pipe","ignore"]}).trim();
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const eq=(a,b,msg)=>{if(a!==b)throw Error(msg+" expected="+b+" actual="+a)};
const uuid=n=>"00000000-0000-4000-8000-"+String(n).padStart(12,"0");
const O1=uuid(1),O2=uuid(2),O3=uuid(6),O4=uuid(7),O5=uuid(8);
const A1=uuid(3),A2=uuid(4),A3=uuid(5),A4=uuid(9);
const event=(eventId,orderId,attemptId,index,eventKind="REQUESTED",
 environment="TEST",digest="b".repeat(64),req="a".repeat(64))=>[
 eventId,orderId,attemptId,index,environment,eventKind,req,digest,"CORE_CHECKOUT"];
const insert="INSERT INTO public.vox_rc11_payment_attempt_events_candidate_v1 "+
 "(event_id,order_id,attempt_id,attempt_sequence,environment,event_kind,"+
 "request_token_hash,event_digest,origin) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)";
async function rejects(fn,label){
 let failed=false;
 try{await fn()}catch{failed=true}
 if(!failed)throw Error(label+" SHOULD_HAVE_FAILED");
}
let pool,started=false;
try{
 if(process.env.DOCKER_HOST&&!/^(npipe|unix):\/\//.test(process.env.DOCKER_HOST))
  throw Error("REMOTE_DOCKER_DISALLOWED");
 docker(["image","inspect","postgres:17-alpine"]);
 if(docker(["ps","-aq","--filter","name=^/"+container+"$"]))
  throw Error("CONTAINER_ALREADY_PRESENT");
 docker(["run","--pull","never","-d","--rm","--name",container,
  "-p","127.0.0.1::5432","-e","POSTGRES_PASSWORD=synthetic_only","postgres:17-alpine"]);
 started=true;
 let port=0,ready=false;
 for(let i=0;i<125;i++){
  try{
   const match=docker(["port",container,"5432/tcp"]).match(/^127\.0\.0\.1:(\d+)$/m);
   if(match)port=Number(match[1]);
   ready=docker(["exec",container,"psql","-X","-A","-t","-U","postgres","-d","postgres","-c","SELECT 1;"])==="1"&&
    docker(["logs",container]).includes("PostgreSQL init process complete; ready for start up.");
  }catch{}
  if(port&&ready)break;await sleep(130);
 }
 if(!port||!ready)throw Error("PG17_NOT_READY");
 pool=new Pool({host:"127.0.0.1",port,user:"postgres",password:"synthetic_only",
  database:"postgres",max:4,connectionTimeoutMillis:3000});
 for(let i=0;i<30;i++){try{await pool.query("SELECT 1");break}catch(e){
  if(i===29)throw e;await sleep(110)}}
 await pool.query("CREATE ROLE anon NOLOGIN;CREATE ROLE authenticated NOLOGIN;CREATE ROLE service_role NOLOGIN");
 await pool.query("CREATE TABLE public.vendor_package_orders(id uuid PRIMARY KEY,payment_provider text NOT NULL,provider_mode text,payment_status text NOT NULL DEFAULT 'pending')");
 await pool.query("INSERT INTO public.vendor_package_orders(id,payment_provider,provider_mode) "+
  "VALUES($1,'razorpay_test',NULL),($2,'razorpay','live'),($3,'razorpay','test'),"+
  "($4,'razorpay',NULL),($5,'razorpay_test','live')",[O1,O2,O3,O4,O5]);
 const ddl=readFileSync(resolve(root,
  "ops/vox/rc7-review-candidates/20261030040000_vox_rc11_payment_attempt_audit_review_only.sql"),"utf8");
 await pool.query(ddl);
 await pool.query(insert,event(uuid(11),O1,A1,1));
 await pool.query(insert,event(uuid(12),O1,A1,2,"TIMEOUT_UNCERTAIN","TEST","c".repeat(64)));
 await rejects(()=>pool.query(insert,event(uuid(13),O1,A1,2,"PROVIDER_ERROR","TEST","d".repeat(64))),
  "SAME_ATTEMPT_SEQ_REPLAY");
 await rejects(()=>pool.query(insert,event(uuid(14),O2,A1,3,"PROVIDER_ERROR","LIVE","e".repeat(64))),
  "CROSS_ORDER_AND_MODE");
 await rejects(()=>pool.query(insert,event(uuid(15),O1,A2,2,"PROVIDER_RESPONSE_RECEIVED","TEST","f".repeat(64))),
  "FIRST_EVENT_NONREQUEST");
 await rejects(()=>pool.query(insert,event(uuid(16),O1,A2,1,"REQUESTED","LIVE","1".repeat(64))),
  "TEST_LIVE_MISMATCH");
 await rejects(()=>pool.query(insert,event(uuid(17),uuid(99),A2,1)), "NO_PARENT_ORDER");
 await pool.query(insert,event(uuid(18),O2,A3,1,"REQUESTED","LIVE","2".repeat(64)));
 await pool.query(insert,event(uuid(20),O3,A4,1,"REQUESTED","TEST","3".repeat(64)));
 await rejects(()=>pool.query(insert,event(uuid(21),O4,uuid(81),1,"REQUESTED","LIVE","4".repeat(64))),"MODERN_LIVE_WITHOUT_EXPLICIT_MODE_DENIED");
 await rejects(()=>pool.query(insert,event(uuid(22),O5,uuid(82),1,"REQUESTED","TEST","5".repeat(64))),"LEGACY_TEST_WITH_CONTRADICTORY_LIVE_MODE_DENIED");
 await rejects(()=>pool.query(insert,event(uuid(23),O3,uuid(83),1,"REQUESTED","LIVE","6".repeat(64))),"MODERN_TEST_CANNOT_BECOME_LIVE");
 await rejects(()=>pool.query(
  "UPDATE public.vox_rc11_payment_attempt_events_candidate_v1 SET event_kind='PROVIDER_ERROR' WHERE event_id=$1",
  [uuid(11)]),"APPEND_ONLY_UPDATE");
 await rejects(()=>pool.query(
  "DELETE FROM public.vox_rc11_payment_attempt_events_candidate_v1 WHERE event_id=$1",[uuid(11)]),
  "APPEND_ONLY_DELETE");
 const actor=await pool.connect();
 try{
  await actor.query("SET ROLE authenticated");
  await rejects(()=>actor.query(insert,event(uuid(19),O1,uuid(88),1)), "AUTHENTICATED_CANNOT_WRITE");
 }finally{try{await actor.query("RESET ROLE")}catch{}actor.release()}
 const info=await pool.query("SELECT count(*)::int AS events,"+
 "count(DISTINCT attempt_id)::int AS attempts FROM public.vox_rc11_payment_attempt_events_candidate_v1");
 eq(info.rows[0].events,4,"ONLY_FOUR_VALID_RECORDS");eq(info.rows[0].attempts,3,"THREE_VALID_ATTEMPTS");
 const payments=await pool.query("SELECT payment_status FROM public.vendor_package_orders ORDER BY id");
 eq(payments.rows.length,5,"FIVE_ORDER_FIXTURES");
 for(const row of payments.rows)eq(row.payment_status,"pending","NO_PAYMENT_MUTATION");
 const acl=await pool.query("SELECT has_table_privilege('authenticated',"+
 " 'public.vox_rc11_payment_attempt_events_candidate_v1','INSERT') AS auth_insert,"+
 " has_table_privilege('service_role',"+
 " 'public.vox_rc11_payment_attempt_events_candidate_v1','INSERT') AS service_insert");
 eq(acl.rows[0].auth_insert,false,"AUTH_NO_WRITES");eq(acl.rows[0].service_insert,false,"SERVICE_NO_WRITES");
 console.log("VOX_RC11_REAL_PG17_FINANCE_ATTEMPT_AUDIT_PASS "+
  "events=4 attempts=3 append_only=true test_live_fenced=true "+
  "cross_order_and_sequence_replay_denied=true no_payment_mutation=true "+
  "provider_calls=0 authorized_managed_writer=false");
}catch(e){console.error("VOX_RC11_REAL_PG17_FINANCE_ATTEMPT_AUDIT_FAIL "+String(e?.stack||e));
 process.exitCode=1;
}finally{if(pool)try{await pool.end()}catch{}
 if(started)try{docker(["rm","-f","-v",container])}catch{}}
