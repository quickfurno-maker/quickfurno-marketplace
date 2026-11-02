import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {runAb5InAppOnlyBatch as run}
 from "../../../contracts/vox/ab5InternalOutboxBatch.mjs";
const id=n=>"00000000-0000-4000-8000-"+String(n).padStart(12,"0");
const workerId=id(1);
const rows=[{job_id:id(2),work_event_id:id(3),
 lease_token:id(4),attempt:1},
 {job_id:id(5),work_event_id:id(6),
 lease_token:id(7),attempt:2}];
function setup(){
 let claims=0,processed=0,failures=0;
 return {get claims(){return claims},get processed(){return processed},
  get failures(){return failures},
  args:{enabled:true,privateWorkerAttested:true,workerId,batch:5,
   leaseSeconds:60,
   claim:async()=>{claims++;return rows;},
   process:async({jobId})=>{processed++;
    return {job_id:jobId,internal_records:2};},
   fail:async({jobId})=>{failures++;
    return {job_id:jobId,new_state:"PENDING",attempt:1};}}};
}
test("AB5 private worker processes only in-app verified Core receipts",async()=>{
 const x=setup(),r=await run(x.args);
 assert.equal(r.ok,true);assert.equal(x.claims,1);
 assert.equal(x.processed,2);assert.equal(r.internalDelivered,4);
 assert.equal(r.providerMessagesSent,0);
 assert.equal(r.workerActivated,false);
});
test("AB5 cannot activate from browser, arbitrary worker, unsafe batch or lease",async()=>{
 for(const patch of [
  {enabled:false},{privateWorkerAttested:false},{workerId:"browser"},
  {batch:11},{batch:0},{leaseSeconds:20},{leaseSeconds:301}
 ]){
  const x=setup(),r=await run({...x.args,...patch});
  assert.equal(r.ok,false);
  assert.equal(x.claims,0);
 }
});
test("AB5 rejects duplicate, foreign or invalid leases before processing",async()=>{
 for(const jobs of [
  [rows[0],rows[0]],
  [{...rows[0],attempt:0}],
  [{...rows[0],lease_token:"malicious"}],
  new Array(11).fill(rows[0])
 ]){
  const x=setup(),r=await run({...x.args,claim:async()=>jobs});
  assert.equal(r.ok,false);assert.equal(x.processed,0);
 }
});
test("AB5 SQL transient failure returns to Core retry only, never WhatsApp",async()=>{
 const x=setup(),r=await run({...x.args,
  process:async()=>{throw Error("synthetic transient DB outage");},
  fail:async({jobId})=>({job_id:jobId,new_state:"PENDING",attempt:
   jobId===rows[0].job_id?1:2})});
 assert.equal(r.ok,true);assert.equal(r.requeued,2);
 assert.equal(r.internalDelivered,0);assert.equal(r.providerMessagesSent,0);
});
test("AB5 fifth failure becomes governed DLQ and does not fake delivery",async()=>{
 const x=setup(),last=[{...rows[0],attempt:5}];
 const r=await run({...x.args,claim:async()=>last,
  process:async()=>null,fail:async({jobId})=>({
   job_id:jobId,new_state:"DEAD_LETTER",attempt:5})});
 assert.equal(r.ok,true);assert.equal(r.deadLetter,1);
 assert.equal(r.internalDelivered,0);
});
test("AB5 lease settlement unknown stops whole batch rather than assuming success",async()=>{
 const x=setup(),r=await run({...x.args,
  process:async()=>null,fail:async()=>{throw Error("db timeout");}});
 assert.equal(r.ok,false);
 assert.equal(r.reason,"LEASE_RECOVERY_UNCERTAIN");
 assert.equal(r.internalDelivered,0);
});
test("AB5 server composition only invokes existing private Core in-app RPCs",()=>{
 const source=readFileSync(new URL(
  "../../../services/vox/ab5InternalOutboxWorker.ts",import.meta.url),"utf8");
 for(const s of ["import \"server-only\"","adminClient",
  "qf_vox_staff_notification_outbox_claim_v1",
  "qf_vox_staff_notification_outbox_process_v1",
  "qf_vox_staff_notification_outbox_fail_v1",
  "VOX_AB5_PRIVATE_INAPP_WORKER_ENABLED"])assert.ok(source.includes(s));
 assert.doesNotMatch(source,/fetch\(|sendWhatsApp|sendEmail|axios|MetaWebhook/);
});
