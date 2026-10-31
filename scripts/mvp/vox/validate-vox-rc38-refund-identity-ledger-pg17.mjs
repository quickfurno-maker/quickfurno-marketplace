#!/usr/bin/env node
// RC38 review-only genuine PG17 proof of the refund identity ledger addendum v4.
// Disposable local container, --network none. No managed DB, secrets or provider.
import {readFileSync} from "node:fs";
import {resolve,dirname} from "node:path";
import {fileURLToPath} from "node:url";
import {randomUUID} from "node:crypto";
import {spawn,spawnSync} from "node:child_process";
import {buildRazorpayProviderEventEnvelope} from "../../../lib/payments/vendorPackageProviderEventLedger.mjs";
import {createRefundIdentityBinder,computeRefundIdentityMac,verifyDurableRefundIdentity}
 from "../../../lib/payments/vendorPackageRefundIdentityBinding.mjs";
import {createRefundIntakeReviewer} from "../../../lib/payments/vendorPackageRefundIntakeReview.mjs";
const root=resolve(dirname(fileURLToPath(import.meta.url)),"../../..");
const fx=f=>readFileSync(resolve(root,"scripts/mvp/vox/fixtures",f),"utf8");
for(const k of ["DATABASE_URL","SUPABASE_URL","SUPABASE_SERVICE_ROLE_KEY","RAZORPAY_LIVE_KEY_SECRET"])
 if(process.env[k])throw Error("RC38_MANAGED_CREDENTIAL_DENIED_"+k);
if(process.env.DOCKER_HOST&&!/^(npipe|unix):\/\//.test(process.env.DOCKER_HOST))
 throw Error("RC38_REMOTE_DOCKER_DENIED");
const name="qf-vox-rc38-identity-"+randomUUID().slice(0,8);
const psqlArgs=["exec","-i","-e","PGPASSWORD=synthetic_only",name,"psql","-h","127.0.0.1","-X","-q","-A","-t",
 "-U","postgres","-d","postgres","-v","ON_ERROR_STOP=1"];
const docker=(args,input="",allow=false)=>{
 const p=spawnSync("docker",args,{input,encoding:"utf8",timeout:60000});
 if(p.error||p.status!==0){if(allow)return p;throw Error("DOCKER_SQL_FAILED "+(p.stderr||p.error||"").slice(0,700))}
 return p;
};
const query=(text,allow=false)=>docker(psqlArgs,text,allow);
// Separate connection per call => genuinely concurrent PostgreSQL backends.
const queryAsync=text=>new Promise(res=>{
 const p=spawn("docker",psqlArgs,{stdio:["pipe","pipe","pipe"]});
 let out="",err="";
 p.stdout.on("data",d=>out+=d);p.stderr.on("data",d=>err+=d);
 p.on("close",status=>res({status,stdout:out,stderr:err}));
 p.stdin.end(text);
});
const expect=(yes,why)=>{if(!yes)throw Error("RC38_IDENTITY_PROOF_FAILED_"+why)};
const parse=s=>JSON.parse(s.stdout.trim().split(/\r?\n/).at(-1));
const num=s=>Number(s.stdout.trim().split(/\r?\n/).at(-1));
const KEY="rc38-synthetic-hmac-key-0123456789abcdef!";
const KEY_ID="k1";
const HEX=c=>c.repeat(64);
const lit=x=>x===null?"NULL":"'"+String(x).replaceAll("'","''")+"'";
const asRole=(role,sql)=>"SET ROLE "+role+";"+sql;
const fnRecord=(event,hash,type,pay,order)=>asRole("service_role",
 "SELECT public.qf_record_vendor_package_razorpay_event_v2("+[event,"test",hash,type,pay,order].map(lit).join(",")+")::text;");
const fnQuarantine=(event,hash)=>asRole("service_role",
 "SELECT public.qf_complete_vendor_package_razorpay_event_v2("+[lit(event),"'test'",lit(hash),"1","'quarantined'","NULL","'REFUND_REVIEW_REQUIRED'"].join(",")+")::text;");
const seed=(event,type,pay,order,hash=HEX("a"))=>{
 expect(parse(query(fnRecord(event,hash,type,pay,order))).status==="claimed","SEED_CLAIM_"+event);
 expect(parse(query(fnQuarantine(event,hash))).status==="quarantined","SEED_QUARANTINE_"+event);
};
const env=(eventId,type,refundId,paymentId,orderId,hash=HEX("a"))=>buildRazorpayProviderEventEnvelope({
 eventId,providerMode:"test",bodySha256:hash,
 candidate:{kind:"refund",eventName:type,refundId,paymentId,providerOrderId:orderId}});
const bindSql=(e,mac,keyId=KEY_ID,over={})=>asRole("service_role",
 "SELECT public.qf_bind_vendor_package_refund_identity_v4("+
 [over.eventId??e.eventId,e.providerMode,over.hash??e.bodySha256,over.refundId??e.refundId,
  over.paymentId??e.paymentId,mac,keyId].map(lit).join(",")+")::text;");
const macOf=e=>computeRefundIdentityMac(e,KEY);
const reviewSql=(event,hash,who,decision="escalated_for_policy_decision")=>asRole("service_role",
 "SELECT public.qf_review_vendor_package_refund_intake_v4("+
 [lit(event),"'test'",lit(hash),lit(who),lit(decision),"NULL"].join(",")+")::text;");
const U1="11111111-1111-4111-8111-111111111111",U2="22222222-2222-4222-8222-222222222222",
 U3="33333333-3333-4333-8333-333333333333";
const count=(table,where)=>num(query("SELECT count(*) FROM public."+table+" WHERE "+where+";"));
let made=false;
try{
 docker(["image","inspect","postgres:17-alpine"]);
 docker(["run","--rm","--pull","never","--network","none","-d","--name",name,
  "-e","POSTGRES_PASSWORD=synthetic_only","postgres:17-alpine"]);
 made=true;
 let ready=false;
 for(let i=0;i<100;i++){
  if(docker(["exec",name,"pg_isready","-q","-h","127.0.0.1","-U","postgres","-d","postgres"],"",true).status===0){ready=true;break}
  await new Promise(r=>setTimeout(r,120));
 }
 expect(ready,"POSTGRES_NOT_READY");
 query("CREATE ROLE service_role LOGIN BYPASSRLS; CREATE ROLE anon LOGIN;CREATE ROLE authenticated LOGIN;");
 query(fx("rc28-review-only-provider-event-ledger.pg17.sql"));
 query(fx("rc35-review-only-refund-intake-review.pg17.sql"));
 query(fx("rc37-review-only-refund-id-bound-review.pg17.sql"));
 query(fx("rc38-review-only-refund-identity-ledger-v4.pg17.sql"));

 // ---- Refund R1: three events of one refund + one hostile event for another payment.
 const R1="rfnd_RC38REFUND01",PA="pay_RC38PAYA0001",PB="pay_RC38PAYB0001",OA="order_RC38ORDA001",OB="order_RC38ORDB001";
 seed("evt_RC38R1CREATED","refund.created",PA,OA);
 seed("evt_RC38R1PROCESS","refund.processed",PA,OA);
 seed("evt_RC38R1FAILED1","refund.failed",PA,OA);
 seed("evt_RC38R1HOSTILE","refund.processed",PB,OB);
 const e1=env("evt_RC38R1CREATED","refund.created",R1,PA,OA);
 const e2=env("evt_RC38R1PROCESS","refund.processed",R1,PA,OA);
 const e3=env("evt_RC38R1FAILED1","refund.failed",R1,PA,OA);
 const eH=env("evt_RC38R1HOSTILE","refund.processed",R1,PB,OB);

 // Duplicate delivery of the SAME event, 8 concurrent backends.
 const dup=await Promise.all(Array.from({length:8},()=>queryAsync(bindSql(e1,macOf(e1)))));
 expect(dup.every(r=>r.status===0&&parse(r).status==="bound"),"CONCURRENT_DUPLICATE_ALL_BOUND");
 expect(count("qf_vendor_package_refund_identities_candidate_v4","refund_id="+lit(R1))===1,"ONE_IDENTITY_ROW");
 expect(count("qf_vendor_package_refund_event_bindings_candidate_v4","event_id="+lit(e1.eventId))===1,"ONE_BINDING_ROW");

 // Remaining events of the refund + hostile different-payment event, all concurrent.
 const mixed=await Promise.all([e2,e3,eH,e2,e3,eH].map(e=>queryAsync(bindSql(e,macOf(e)))));
 const st=(e)=>mixed.filter((_,i)=>[e2,e3,eH,e2,e3,eH][i]===e).map(r=>{expect(r.status===0,"MIXED_RPC_OK");return parse(r).status});
 expect(st(e2).every(s=>s==="bound")&&st(e3).every(s=>s==="bound"),"SAME_PAYMENT_EVENTS_BOUND");
 expect(st(eH).every(s=>s==="identity_conflict"),"DIFFERENT_PAYMENT_EVENT_REJECTED");
 expect(count("qf_vendor_package_refund_event_bindings_candidate_v4","refund_id="+lit(R1))===3,"HOSTILE_NOT_PERSISTED");
 expect(count("qf_vendor_package_refund_event_bindings_candidate_v4","event_id='evt_RC38R1HOSTILE'")===0,"HOSTILE_NO_BINDING");

 // ---- Race for the FIRST binding of a refund: two payments compete concurrently.
 const R2="rfnd_RC38REFUND02";
 seed("evt_RC38R2PAYA001","refund.created",PA,OA);
 seed("evt_RC38R2PAYB001","refund.created",PB,OB);
 const f1=env("evt_RC38R2PAYA001","refund.created",R2,PA,OA),f2=env("evt_RC38R2PAYB001","refund.created",R2,PB,OB);
 const raceIn=[f1,f2,f1,f2,f1,f2];
 const race=await Promise.all(raceIn.map(e=>queryAsync(bindSql(e,macOf(e)))));
 expect(race.every(r=>r.status===0),"RACE_RPC_OK");
 const winners=new Set(raceIn.filter((_,i)=>parse(race[i]).status==="bound").map(e=>e.paymentId));
 expect(winners.size===1,"RACE_EXACTLY_ONE_PAYMENT_WINS");
 expect(raceIn.every((e,i)=>parse(race[i]).status===(winners.has(e.paymentId)?"bound":"identity_conflict")),"RACE_LOSER_CONFLICT");
 expect(count("qf_vendor_package_refund_identities_candidate_v4","refund_id="+lit(R2))===1,"RACE_ONE_IDENTITY");
 expect(count("qf_vendor_package_refund_event_bindings_candidate_v4","refund_id="+lit(R2))===1,"RACE_ONE_BINDING");

 // ---- Tamper / replay at the RPC boundary.
 expect(parse(query(bindSql(e1,macOf(e1)))).status==="bound","REPLAY_EXACT_IDEMPOTENT");
 expect(parse(query(bindSql(e1,HEX("c")))).status==="identity_conflict","REPLAY_DIFFERENT_MAC_CONFLICT");
 expect(parse(query(bindSql(e1,macOf(e1),"k2"))).status==="identity_conflict","REPLAY_DIFFERENT_KEYID_CONFLICT");
 expect(parse(query(bindSql(e1,macOf(e1),KEY_ID,{refundId:"rfnd_RC38OTHER01"}))).status==="identity_conflict","REPLAY_OTHER_REFUND_CONFLICT");
 expect(query(bindSql(e1,macOf(e1),KEY_ID,{hash:HEX("f")}),true).status!==0,"BODY_HASH_TAMPER_DENIED");
 expect(query(bindSql(e1,macOf(e1),KEY_ID,{paymentId:PB}),true).status!==0,"EVENT_PAYMENT_TAMPER_DENIED");
 expect(query(bindSql(e1,"zz",KEY_ID),true).status!==0,"MAC_SHAPE_DENIED");
 expect(query(bindSql(e1,macOf(e1),KEY_ID,{eventId:"evt_RC38UNKNOWN01"}),true).status!==0,"UNKNOWN_EVENT_DENIED");
 for(const sql of ["UPDATE public.qf_vendor_package_refund_event_bindings_candidate_v4 SET identity_mac='"+HEX("d")+"';",
  "DELETE FROM public.qf_vendor_package_refund_event_bindings_candidate_v4;",
  "UPDATE public.qf_vendor_package_refund_identities_candidate_v4 SET payment_id='"+PB+"';",
  "DELETE FROM public.qf_vendor_package_refund_identities_candidate_v4;",
  "TRUNCATE public.qf_vendor_package_refund_event_bindings_candidate_v4;"]){
  const r=query(sql,true);
  expect(r.status!==0&&/REFUND_IDENTITY_LEDGER_IMMUTABLE/.test(r.stderr),"IMMUTABLE_SUPERUSER "+sql.slice(0,30));
  expect(query(asRole("service_role",sql),true).status!==0,"IMMUTABLE_SERVICE_ROLE "+sql.slice(0,30));
 }
 for(const role of ["anon","authenticated"]){
  expect(query(asRole(role,"SELECT public.qf_bind_vendor_package_refund_identity_v4('evt_RC38R1CREATED','test','"+
   HEX("a")+"','"+R1+"','"+PA+"','"+macOf(e1)+"','k1');"),true).status!==0,"BIND_DENIED_"+role);
  expect(query(asRole(role,"SELECT public.qf_get_vendor_package_refund_identity_v4('evt_RC38R1CREATED','test');"),true).status!==0,"GET_DENIED_"+role);
  expect(query(asRole(role,"SELECT * FROM public.qf_vendor_package_refund_event_bindings_candidate_v4;"),true).status!==0,"TABLE_DENIED_"+role);
 }
 const rls=query("SELECT string_agg(relrowsecurity::text||relforcerowsecurity::text,',') FROM pg_class WHERE oid IN "+
  "('public.qf_vendor_package_refund_identities_candidate_v4'::regclass,'public.qf_vendor_package_refund_event_bindings_candidate_v4'::regclass);");
 expect(/^(true|t)(true|t),(true|t)(true|t)$/.test(rls.stdout.trim()),"FORCE_RLS");

 // ---- v3 guard: caller-supplied v3 identity can no longer contradict a durable binding.
 const v3=(event,hash,who,refund,pay)=>asRole("service_role",
  "SELECT public.qf_review_vendor_package_refund_intake_v3("+
  [lit(event),"'test'",lit(hash),lit(who),"'escalated_for_policy_decision'","NULL",lit(refund),lit(pay)].join(",")+")::text;");
 expect(query(v3("evt_RC38R1PROCESS",HEX("a"),U1,"rfnd_RC38FORGED01",PA),true).stderr.includes("REFUND_IDENTITY_MISMATCH"),"V3_FORGED_REFUND_BLOCKED");
 expect(query(v3("evt_RC38R1HOSTILE",HEX("a"),U1,R1,PB),true).stderr.includes("REFUND_IDENTITY_MISMATCH"),"V3_OTHER_PAYMENT_BLOCKED");
 // Pre-existing unbound v3 review pins the refund to its payment: later bind to another payment is rejected.
 const R4="rfnd_RC38REFUND04";
 seed("evt_RC38R4V3FIRST","refund.created",PA,OA);seed("evt_RC38R4PAYB001","refund.created",PB,OB);
 expect(parse(query(v3("evt_RC38R4V3FIRST",HEX("a"),U1,R4,PA))).status==="reviewed","V3_LEGACY_REVIEW_STILL_WORKS");
 const g=env("evt_RC38R4PAYB001","refund.created",R4,PB,OB);
 expect(parse(query(bindSql(g,macOf(g)))).status==="identity_conflict","BIND_AFTER_V3_OTHER_PAYMENT_REJECTED");

 // ---- v4 review derives identity from the durable row; unbound events cannot be reviewed.
 const R3="rfnd_RC38REFUND03";
 seed("evt_RC38R3UNBOUND","refund.created",PA,OA);
 expect(query(reviewSql("evt_RC38R3UNBOUND",HEX("a"),U1),true).stderr.includes("REFUND_IDENTITY_UNBOUND"),"UNBOUND_REVIEW_DENIED");
 expect(query(reviewSql("evt_RC38R1CREATED",HEX("b"),U1),true).status!==0,"REVIEW_BAD_HASH_DENIED");
 void R3;
 // Concurrent reviews of ONE refund through three different events/reviewers.
 const revs=await Promise.all([["evt_RC38R1CREATED",U1],["evt_RC38R1PROCESS",U2],["evt_RC38R1FAILED1",U3],
  ["evt_RC38R1CREATED",U1],["evt_RC38R1PROCESS",U2],["evt_RC38R1FAILED1",U3]].map(([ev,who])=>queryAsync(reviewSql(ev,HEX("a"),who))));
 expect(revs.every(r=>r.status===0),"CONCURRENT_REVIEW_RPC_OK");
 const reviewed=new Set(revs.filter(r=>parse(r).status==="reviewed").map(r=>parse(r).event_id));
 expect(reviewed.size===1,"ONE_EVENT_WINS_REVIEW");
 expect(revs.filter(r=>parse(r).status==="reviewed").every(r=>reviewed.has(parse(r).event_id)),"ONLY_WINNER_EVENT_REVIEWED");
 expect(revs.filter(r=>parse(r).status==="review_conflict").length===4,"OTHERS_CONFLICT");
 expect(revs.every(r=>parse(r).refund_id===R1&&parse(r).payment_id===PA),"REVIEW_IDENTITY_FROM_DB");
 expect(count("qf_vendor_package_refund_reviews_by_refund_candidate_v3","refund_id="+lit(R1))===1,"ONE_DECISION_PER_REFUND");

 // ---- Application adapter against the real RPCs (HMAC key held app-side only).
 const allowed={
  qf_bind_vendor_package_refund_identity_v4:["p_event_id","p_provider_mode","p_body_sha256","p_refund_id","p_payment_id","p_identity_mac","p_mac_key_id"],
  qf_get_vendor_package_refund_identity_v4:["p_event_id","p_provider_mode"],
  qf_review_vendor_package_refund_intake_v4:["p_event_id","p_provider_mode","p_body_sha256","p_reviewer_id","p_decision","p_reviewable_credits"]};
 const callRpc=async(fnName,args)=>{
  if(!Object.hasOwn(allowed,fnName))throw Error("UNREVIEWED_RPC_REFUSED");
  const r=query(asRole("service_role","SELECT public."+fnName+"("+allowed[fnName].map(k=>lit(args[k])).join(",")+")::text;"),true);
  if(r.status!==0)return {data:null,error:{message:r.stderr.slice(0,200)}};
  return {data:parse(r),error:null};
 };
 const R5="rfnd_RC38REFUND05";
 seed("evt_RC38R5CREATED","refund.created",PA,OA);seed("evt_RC38R5PROCESS","refund.processed",PA,OA);
 const h1=env("evt_RC38R5CREATED","refund.created",R5,PA,OA),h2=env("evt_RC38R5PROCESS","refund.processed",R5,PA,OA);
 const binder=createRefundIdentityBinder(callRpc,{macKey:KEY,keyId:KEY_ID});
 const wrongKeyBinder=createRefundIdentityBinder(callRpc,{macKey:"x".repeat(40),keyId:KEY_ID});
 const reviewer=createRefundIntakeReviewer(callRpc,{identityLedger:{macKey:KEY}});
 const d="escalated_for_policy_decision";
 expect((await reviewer.review({envelope:h1,reviewerId:U1,decision:d})).reason==="REFUND_REVIEW_IDENTITY_UNBOUND","ADAPTER_UNBOUND_DENIED");
 expect((await binder.bind(h1)).ok===true&&(await binder.bind(h1)).ok===true,"ADAPTER_BIND_IDEMPOTENT");
 expect((await wrongKeyBinder.bind(h1)).reason==="REFUND_IDENTITY_CONFLICT","ADAPTER_REPLAY_OTHER_KEY_CONFLICT");
 expect((await binder.bind(h2)).ok===true,"ADAPTER_BIND_SECOND_EVENT");
 const okReview=await reviewer.review({envelope:h1,reviewerId:U1,decision:d});
 expect(okReview.ok===true&&okReview.refundAllowed===false&&okReview.creditMutation===false,"ADAPTER_REVIEW_RECORDED");
 expect((await reviewer.review({envelope:h2,reviewerId:U1,decision:d})).reason==="REFUND_REVIEW_CONFLICT","ADAPTER_SECOND_EVENT_CONFLICT");
 // The v4 review needs no refund/payment from the caller: a forged envelope is rejected, not trusted.
 expect((await reviewer.review({envelope:{...h1,refundId:"rfnd_RC38FORGED02"},reviewerId:U1,decision:d})).reason==="REFUND_REVIEW_IDENTITY_INVALID","ADAPTER_FORGED_ENVELOPE_REJECTED");
 // A different HMAC key (wrong app secret) can never accept the durable row.
 const wrongKeyReviewer=createRefundIntakeReviewer(callRpc,{identityLedger:{macKey:"y".repeat(40)}});
 expect((await wrongKeyReviewer.review({envelope:h2,reviewerId:U2,decision:d})).reason==="REFUND_REVIEW_IDENTITY_INVALID","ADAPTER_WRONG_KEY_REJECTED");

 // ---- Durable tamper evidence: a privileged actor disables the guard and rewrites the MAC.
 const R6="rfnd_RC38REFUND06";
 seed("evt_RC38R6TAMPERED","refund.created",PA,OA);
 const t1=env("evt_RC38R6TAMPERED","refund.created",R6,PA,OA);
 expect((await binder.bind(t1)).ok===true,"TAMPER_SEED_BOUND");
 const intact=(await callRpc("qf_get_vendor_package_refund_identity_v4",{p_event_id:t1.eventId,p_provider_mode:"test"})).data;
 expect(verifyDurableRefundIdentity(intact,KEY)===true,"DURABLE_ROW_VERIFIES");
 query("ALTER TABLE public.qf_vendor_package_refund_event_bindings_candidate_v4 DISABLE TRIGGER USER;"+
  "UPDATE public.qf_vendor_package_refund_event_bindings_candidate_v4 SET identity_mac='"+HEX("e")+"' WHERE event_id='evt_RC38R6TAMPERED';"+
  "ALTER TABLE public.qf_vendor_package_refund_event_bindings_candidate_v4 ENABLE TRIGGER USER;");
 const tampered=(await callRpc("qf_get_vendor_package_refund_identity_v4",{p_event_id:t1.eventId,p_provider_mode:"test"})).data;
 expect(verifyDurableRefundIdentity(tampered,KEY)===false,"TAMPERED_MAC_DETECTED");
 const before=count("qf_vendor_package_refund_reviews_by_refund_candidate_v3","refund_id="+lit(R6));
 expect((await reviewer.review({envelope:t1,reviewerId:U1,decision:d})).reason==="REFUND_REVIEW_IDENTITY_INVALID","TAMPERED_ROW_BLOCKS_REVIEW");
 expect(count("qf_vendor_package_refund_reviews_by_refund_candidate_v3","refund_id="+lit(R6))===before&&before===0,"TAMPERED_ROW_NO_WRITE");
 expect(count("qf_vendor_package_refund_event_bindings_candidate_v4","event_id='evt_RC38R6TAMPERED'")===1,"TAMPER_ROW_STILL_SINGLE");

 // No credit/order/wallet/provider objects exist or were touched.
 expect(num(query("SELECT count(*) FROM pg_tables WHERE schemaname='public' AND tablename ~ '(order|wallet|credit|refund_exec)';"))===0,"NO_MONEY_TABLES");
 console.log("VOX_RC38_REAL_PG17_REFUND_IDENTITY_V4_PASS concurrent_duplicate=true concurrent_cross_payment_race=true"+
  " tamper_replay=true immutable=true hmac_adapter=true durable_tamper_detected=true v3_guard=true"+
  " live_schema=false refund_active=false provider_calls=0 managed_release=false");
}finally{if(made)docker(["rm","-f",name],"",true)}
