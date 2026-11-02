import test from "node:test";
import assert from "node:assert/strict";
import {buildRazorpayProviderEventEnvelope} from "../../../lib/payments/vendorPackageProviderEventLedger.mjs";
import {createRc28VendorPackageEventRepository,RC28_PROVIDER_LEDGER_RUNTIME_INSTALLED}
 from "../../../lib/payments/vendorPackageProviderEventRepository.mjs";
import {processVendorPackageProviderEvent}
 from "../../../lib/payments/vendorPackageProviderEventProcessing.mjs";
const e=()=>buildRazorpayProviderEventEnvelope({eventId:"evt_RC28TEST123",
 providerMode:"test",bodySha256:"a".repeat(64),candidate:{
 kind:"captured",paymentId:"pay_ABC12345",providerOrderId:"order_ABC12345"}});
let invoked=0;
test("production ledger activation stays false",()=>assert.equal(RC28_PROVIDER_LEDGER_RUNTIME_INSTALLED,false));
test("genuine call shape and exact persisted first-claim completion",async()=>{
 const sql=[];
 const rpc=async (name,args)=>{
  sql.push({name,args});
  if(name==="qf_record_vendor_package_razorpay_event_v2")
   return {data:{event_id:args.p_event_id,provider_mode:args.p_provider_mode,
    status:"claimed",attempt_count:1},error:null};
  return {data:{event_id:args.p_event_id,provider_mode:args.p_provider_mode,
   status:args.p_disposition,outcome:args.p_outcome,error_code:args.p_error_code},error:null};
 };
 const result=await processVendorPackageProviderEvent({envelope:e(),
  repository:createRc28VendorPackageEventRepository(rpc),
  handle:async()=>{invoked++;return "activated"}});
 assert.equal(result.ack,true);assert.equal(invoked,1);
 assert.deepEqual(sql.map(x=>x.name),[
  "qf_record_vendor_package_razorpay_event_v2","qf_complete_vendor_package_razorpay_event_v2"]);
 assert.equal(sql[1].args.p_attempt_count,1);
 assert.equal(sql[1].args.p_body_sha256,"a".repeat(64));
 assert.equal(sql[1].args.p_outcome,"activated");
});
test("unclaimed and second completion are denied before SQL",async()=>{
 const calls=[];
 const repo=createRc28VendorPackageEventRepository(async(name,args)=>{
  calls.push(name);
  return {data:{event_id:args.p_event_id,provider_mode:args.p_provider_mode,
   status:name.startsWith("qf_record")?"claimed":"completed",
   attempt_count:1,outcome:"activated"},error:null};
 });
 await assert.rejects(repo.complete(e(),{disposition:"completed",outcome:"activated"}),/LEASE_NOT_CLAIMED/);
 assert.equal(calls.length,0);
 await repo.claim(e());await repo.complete(e(),{disposition:"completed",outcome:"activated"});
 await assert.rejects(repo.complete(e(),{disposition:"completed",outcome:"activated"}),/LEASE_NOT_CLAIMED/);
 assert.equal(calls.length,2);
});
test("wrong DB receipts, provider mode and denied function calls fail closed",async()=>{
 const bad=[
  {data:{event_id:"wrong",provider_mode:"test",status:"claimed",attempt_count:1}},
  {data:{event_id:e().eventId,provider_mode:"live",status:"claimed",attempt_count:1}},
  {data:null,error:{message:"denied"}},
  {data:[{status:"claimed"}],error:null}
 ];
 for(const answer of bad){
  const repo=createRc28VendorPackageEventRepository(async()=>answer);
  await assert.rejects(repo.claim(e()));
 }
});
test("retryable unknown completion remains unacknowledged",async()=>{
 const repo=createRc28VendorPackageEventRepository(async(name,args)=>{
  if(name.startsWith("qf_record"))return {data:{event_id:args.p_event_id,
   provider_mode:args.p_provider_mode,status:"claimed",attempt_count:1}};
  throw Error("SQL_COMMIT_UNKNOWN");
 });
 const result=await processVendorPackageProviderEvent({envelope:e(),repository:repo,
  handle:async()=> "activated"});
 assert.equal(result.ack,false);assert.equal(result.retry,true);
 assert.equal(result.code,"PROVIDER_EVENT_COMPLETION_UNCONFIRMED");
});
