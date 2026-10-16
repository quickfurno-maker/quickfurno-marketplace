import test from "node:test";
import assert from "node:assert/strict";
import {runIsolatedNotificationOutboxOnce as run,candidateRpcNames as names}
 from "../../../contracts/vox/notificationOutboxWorker.mjs";
const id=n=>"00000000-0000-4000-8000-"+String(n).padStart(12,"0");
const worker=id(1);
const job=(n=2,attempt=1)=>({
 job_id:id(n),work_event_id:id(n+100),lease_token:id(n+300),attempt
});
const setup=(jobs=[job()],reply=()=>({data:[]}))=>{
 const calls=[];
 const rpc=async(name,params)=>{
  calls.push({name,params});
  if(name===names.claim)return {data:jobs};
  return reply(name,params);
 };
 return {calls,rpc};
};
test("disabled by default: not even a single RPC",async()=>{
 const fake=setup();
 const r=await run({rpc:fake.rpc,workerId:worker});
 assert.equal(r.status,"NOT_ACTIVATED");
 assert.equal(fake.calls.length,0);
});
test("must bind verified one-shot worker parameters, no unbounded job claim",async()=>{
 for(const spec of [
  {workerId:"INVALID"},{workerId:worker,maxJobs:0},
  {workerId:worker,maxJobs:11},{workerId:worker,leaseSeconds:1},
  {workerId:worker,leaseSeconds:301},{workerId:worker,maxJobs:1.5},
  {workerId:worker,leaseSeconds:60,rpc:null}
 ]){
  const fake=setup();
  const r=await run({enabled:true,rpc:fake.rpc,...spec});
  if(spec.rpc===null)assert.equal(r.status,"INVALID_PROCESSOR_INPUT");
  else assert.equal(r.status,"INVALID_PROCESSOR_INPUT");
  assert.equal(fake.calls.length,0);
 }
});
test("empty outbox is a successful bounded no-op",async()=>{
 const fake=setup([]);
 const r=await run({enabled:true,rpc:fake.rpc,workerId:worker});
 assert.equal(r.ok,true);assert.equal(r.jobsClaimed,0);
 assert.equal(r.jobsProcessed,0);
 assert.equal(fake.calls.length,1);assert.equal(fake.calls[0].name,names.claim);
 assert.deepEqual(fake.calls[0].params,{
  p_worker:worker,p_batch:5,p_lease_seconds:90
 });
});
test("processes exactly one verified persisted event and counts only internal rows",async()=>{
 const j=job();
 const fake=setup([j],(_,params)=>({data:[{
  job_id:params.p_job,internal_records:3
 }]}));
 const r=await run({enabled:true,rpc:fake.rpc,workerId:worker});
 assert.equal(r.ok,true);assert.equal(r.jobsClaimed,1);
 assert.equal(r.jobsProcessed,1);assert.equal(r.internalRecords,3);
 assert.equal(r.externalMessagesSent,0);assert.equal(r.pushDeliveriesVerified,0);
 assert.deepEqual(fake.calls[1],{name:names.process,params:{
  p_worker:worker,p_job:j.job_id,p_token:j.lease_token
 }});
});
test("bounds processing to supplied max batch, with two distinct events",async()=>{
 const fake=setup([job(2),job(3)],(_,params)=>({data:[{
  job_id:params.p_job,internal_records:1
 }]}));
 const r=await run({enabled:true,rpc:fake.rpc,workerId:worker,maxJobs:2});
 assert.equal(r.jobsClaimed,2);assert.equal(r.jobsProcessed,2);
 assert.equal(r.internalRecords,2);assert.equal(fake.calls.length,3);
});
test("confirmed SQL error triggers lease-scoped retry WITHOUT raw exception text",async()=>{
 const j=job();
 const fake=setup([j],(name,params)=>{
  if(name===names.process)return {error:{message:"Sensitive phone 111"}};
  return {data:[{job_id:j.job_id,new_state:"PENDING",attempt:1}]};
 });
 const r=await run({enabled:true,rpc:fake.rpc,workerId:worker});
 assert.equal(r.ok,true);assert.equal(r.jobsRetried,1);
 assert.equal(r.jobsProcessed,0);
 assert.equal(fake.calls[2].name,names.fail);
 assert.deepEqual(fake.calls[2].params,{
  p_worker:worker,p_job:j.job_id,p_token:j.lease_token,
  p_code:"SQL_TRANSIENT"
 });
 assert.equal(JSON.stringify(r).includes("phone"),false);
});
test("fifth failed claim transitions to dead-letter only under SQL authority",async()=>{
 const j=job(2,5);
 const fake=setup([j],name=>name===names.process?
  {error:{code:"P0001"}}:{data:[{
   job_id:j.job_id,new_state:"DEAD_LETTER",attempt:5
  }]});
 const r=await run({enabled:true,rpc:fake.rpc,workerId:worker});
 assert.equal(r.jobsDeadLettered,1);assert.equal(r.jobsRetried,0);
});
test("claim RPC rejects unsupported success shape or overbound list",async()=>{
 for(const shape of [
  {error:{code:"DENIED"}},{data:null},{data:"wrong"},
  {data:Array.from({length:11},(_,k)=>job(k+1))}
 ]){
  const calls=[];
  const rpc=async(name)=>{calls.push(name);return shape;};
  const r=await run({enabled:true,rpc,workerId:worker});
  assert.equal(r.ok,false);assert.equal(r.status,"CLAIM_DENIED_OR_UNVERIFIED");
  assert.deepEqual(calls,[names.claim]);
 }
});
test("duplicate IDs and duplicated work event in claims are rejected",async()=>{
 for(const jobs of [
  [job(),job()],
  [job(2),{...job(3),work_event_id:job(2).work_event_id}],
  [{...job(),attempt:6}],
  [{...job(),lease_token:"FORGED"}],
  [{...job(),actorId:id(9)}]
 ]){
  const fake=setup(jobs);
  const r=await run({enabled:true,rpc:fake.rpc,workerId:worker});
  assert.equal(r.status,"CLAIM_PROOF_INVALID");
  assert.equal(fake.calls.length,1);
 }
});
test("claim transport failure never invents records or delivery",async()=>{
 const r=await run({enabled:true,workerId:worker,
  rpc:async()=>{throw Error("network down")}});
 assert.equal(r.ok,false);assert.equal(r.status,"CLAIM_TRANSPORT_UNKNOWN");
 assert.equal(r.internalRecords,0);
});
test("process transport ambiguity leaves lease to expire, NO unsafe fail/replay",async()=>{
 const fake=setup([job()],async()=>{throw Error("unknown commit")});
 const r=await run({enabled:true,rpc:fake.rpc,workerId:worker});
 assert.equal(r.ok,false);assert.equal(r.status,"PARTIAL_UNVERIFIED");
 assert.equal(r.unverified,1);
 assert.equal(fake.calls.length,2);
});
test("invalid successful process receipt MUST NOT be retried to overwrite DONE",async()=>{
 const fake=setup([job()],(_,params)=>({data:[{
  job_id:id(899),internal_records:3
 }]}));
 const r=await run({enabled:true,rpc:fake.rpc,workerId:worker});
 assert.equal(r.ok,false);assert.equal(r.unverified,1);
 assert.equal(fake.calls.length,2);
});
test("failed lease rollback RPC is unconfirmed, not claimed as retried",async()=>{
 const fake=setup([job()],async name=>{
  if(name===names.process)return {error:{code:"P0001"}};
  throw Error("fail rpc unavailable");
 });
 const r=await run({enabled:true,rpc:fake.rpc,workerId:worker});
 assert.equal(r.ok,false);assert.equal(r.unverified,1);
 assert.equal(r.jobsRetried,0);assert.equal(fake.calls.length,3);
});
test("failed lease returned incorrect attempts or arbitrary state is rejected",async()=>{
 for(const record of [
  {job_id:job().job_id,new_state:"PENDING",attempt:2},
  {job_id:job().job_id,new_state:"SENT",attempt:1},
  {job_id:id(76),new_state:"PENDING",attempt:1}
 ]){
  const fake=setup([job()],name=>name===names.process?
   {error:{code:"P0001"}}:{data:[record]});
  const r=await run({enabled:true,rpc:fake.rpc,workerId:worker});
  assert.equal(r.ok,false);assert.equal(r.unverified,1);
  assert.equal(r.jobsRetried,0);
 }
});
test("no provider send, browser bearer, admin override, scheduler or busy loop",async()=>{
 const {readFileSync}=await import("node:fs");
 const {default:assert2}=await import("node:assert/strict");
 const fs=readFileSync(new URL("../../../contracts/vox/notificationOutboxWorker.mjs",import.meta.url),"utf8");
 assert2.doesNotMatch(fs,/sendWhatsApp\(|sendPush\(|setInterval\(|setTimeout\(|service_role\.insert|process\.env\.SUPABASE_SERVICE_ROLE_KEY/);
 assert2.match(fs,/runIsolatedNotificationOutboxOnce/);
 assert2.match(fs,/NOT_ACTIVATED/);
});
