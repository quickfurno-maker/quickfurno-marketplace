import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {buildRazorpayProviderEventEnvelope} from "../../../lib/payments/vendorPackageProviderEventLedger.mjs";
import {createRc28VendorPackageEventRepository,RC28_PROVIDER_LEDGER_RUNTIME_INSTALLED}
 from "../../../lib/payments/vendorPackageProviderEventRepository.mjs";
import {resolveVendorPackageEventLedgerGate,processVendorPackageProviderEvent}
 from "../../../lib/payments/vendorPackageProviderEventProcessing.mjs";

const event=(kind="captured",eventId="evt_RC29FINANCE")=>buildRazorpayProviderEventEnvelope({
 eventId,bodySha256:createHash("sha256").update('{"event":"payment.captured"}').digest("hex"),
 providerMode:"test",candidate:{kind,paymentId:"pay_RC29ABC123",providerOrderId:"order_RC29ABC123"}
});
function simulatedSql(){
 const state=new Map(), calls=[];
 const rpc=async(name,args)=>{
  calls.push({name,args});
  const key=args.p_provider_mode+"|"+args.p_event_id;
  if(name==="qf_record_vendor_package_razorpay_event_v2"){
   const old=state.get(key);
   if(old)return {data:{event_id:args.p_event_id,provider_mode:args.p_provider_mode,
    status:old.body===args.p_body_sha256?"replay":"conflict",outcome:old.outcome}};
   state.set(key,{body:args.p_body_sha256,attempt:1});
   return {data:{event_id:args.p_event_id,provider_mode:args.p_provider_mode,status:"claimed",attempt_count:1}};
  }
  if(name==="qf_complete_vendor_package_razorpay_event_v2"){
   const old=state.get(key);
   if(!old||old.body!==args.p_body_sha256||old.attempt!==args.p_attempt_count)throw Error("LEASE_REJECTED");
   old.outcome=args.p_outcome;
   return {data:{event_id:args.p_event_id,provider_mode:args.p_provider_mode,
    status:args.p_disposition,outcome:args.p_outcome,error_code:args.p_error_code}};
  }
  throw Error("UNEXPECTED_RPC");
 };
 return {rpc,calls};
}
test("RC29 runtime financial activation remains hard disabled",()=>{
 assert.equal(RC28_PROVIDER_LEDGER_RUNTIME_INSTALLED,false);
 assert.equal(resolveVendorPackageEventLedgerGate({providerMode:"live",ledgerModeValue:"off"}).action,"deny");
 assert.equal(resolveVendorPackageEventLedgerGate({providerMode:"test",ledgerModeValue:"enforce"}).action,"deny");
});
test("RC29 verified event processes once, captures exact body and replays without Core writes",async()=>{
 const {rpc,calls}=simulatedSql();
 let activations=0;
 const repository=createRc28VendorPackageEventRepository(rpc);
 const first=await processVendorPackageProviderEvent({envelope:event(),repository,
  handle:async()=>{activations++;return "activated"}});
 assert.deepEqual({ack:first.ack,status:first.status},{ack:true,status:"activated"});
 const replay=await processVendorPackageProviderEvent({envelope:event(),repository,
  handle:async()=>{throw Error("CORE_WRITER_MUST_NOT_RUN_ON_REPLAY")}});
 assert.deepEqual({ack:replay.ack,status:replay.status,replay:replay.replay},
  {ack:true,status:"activated",replay:true});
 assert.equal(activations,1);
 assert.deepEqual(calls.map(x=>x.name),[
  "qf_record_vendor_package_razorpay_event_v2",
  "qf_complete_vendor_package_razorpay_event_v2",
  "qf_record_vendor_package_razorpay_event_v2"]);
 assert.equal(calls[1].args.p_body_sha256,event().bodySha256);
});
test("RC29 same event ID with different verified body hash never reactivates",async()=>{
 const {rpc}=simulatedSql(),repository=createRc28VendorPackageEventRepository(rpc);
 let calls=0;
 await processVendorPackageProviderEvent({envelope:event(),repository,
  handle:async()=>{calls++;return "activated"}});
 const drift=Object.freeze({...event(),bodySha256:"b".repeat(64)});
 const result=await processVendorPackageProviderEvent({envelope:drift,repository,
  handle:async()=>{calls++;return "activated"}});
 assert.deepEqual({ack:result.ack,status:result.status,code:result.code},
  {ack:false,status:"rejected",code:"PROVIDER_EVENT_CONFLICT"});
 assert.equal(calls,1);
});
