import test from "node:test";
import assert from "node:assert/strict";
import {coordinateVendorOtpRequest} from "../../../lib/identity/vendorOtpRequestCoordination.ts";

const PHONE="+919876543210";
const fixture=()=>{
  const calls=[];
  const deps={
    vendorGate:async()=>{calls.push("vendor-gate");return true;},
    abuseAllowed:async(p)=>{calls.push("abuse:"+p);return true;},
    reserveVendorPurpose:async(p,purpose)=>{calls.push("reserve:"+purpose+":"+p);return true;},
    initiateSupabaseOtp:async(p)=>{calls.push("auth:"+p);return "initiated";},
  };
  return {calls,deps};
};
test("Q1 only a valid E.164 Indian mobile may start the vendor lane",async()=>{
  for(const phone of ["9876543210","+19876543210","+910876543210","+9198765432100","","+91987654321A"]){
    const {deps,calls}=fixture();
    assert.deepEqual(await coordinateVendorOtpRequest(phone,deps),{kind:"blocked",reason:"invalid_phone"});
    assert.deepEqual(calls,[]);
  }
});
test("Q2 success requires gate -> abuse -> atomic vendor-purpose reservation -> Auth",async()=>{
  const {deps,calls}=fixture();
  assert.deepEqual(await coordinateVendorOtpRequest(PHONE,deps),{kind:"initiated"});
  assert.deepEqual(calls,["vendor-gate","abuse:"+PHONE,"reserve:vendor_login:"+PHONE,"auth:"+PHONE]);
});
test("Q3 vendor gate OFF means no reservation or Auth OTP",async()=>{
  const {deps,calls}=fixture();
  deps.vendorGate=async()=>{calls.push("vendor-gate");return false;};
  assert.deepEqual(await coordinateVendorOtpRequest(PHONE,deps),{kind:"blocked",reason:"gate_closed"});
  assert.deepEqual(calls,["vendor-gate"]);
});
test("Q4 abuse denial means no reservation and no Auth allocation",async()=>{
  const {deps,calls}=fixture();
  deps.abuseAllowed=async()=>{calls.push("abuse");return false;};
  assert.deepEqual(await coordinateVendorOtpRequest(PHONE,deps),{kind:"blocked",reason:"rate_limited"});
  assert.deepEqual(calls,["vendor-gate","abuse"]);
});
test("Q5 conflict with simultaneous client-purpose lease prevents vendor send",async()=>{
  const {deps,calls}=fixture();
  deps.reserveVendorPurpose=async()=>{calls.push("reserve-conflict");return false;};
  assert.deepEqual(await coordinateVendorOtpRequest(PHONE,deps),{kind:"blocked",reason:"reservation_conflict"});
  assert.deepEqual(calls,["vendor-gate","abuse:"+PHONE,"reserve-conflict"]);
});
test("Q6 Auth rejection and unknown outcomes never trigger SMS fallback or retry",async()=>{
  for(const value of ["rejected","uncertain"]){
    const {deps,calls}=fixture();
    deps.initiateSupabaseOtp=async()=>{calls.push("auth");return value;};
    const result=await coordinateVendorOtpRequest(PHONE,deps);
    assert.deepEqual(result,{kind:"blocked",reason:value==="rejected"?"auth_rejected":"outcome_uncertain"});
    assert.equal(calls.filter(x=>x==="auth").length,1);
    assert.equal(calls.some(x=>/sms|client_login|retry|release/.test(x)),false);
  }
});
test("Q7 thrown provider/Auth uncertainty is terminal, no second send",async()=>{
  const {deps,calls}=fixture();
  deps.initiateSupabaseOtp=async()=>{calls.push("auth");throw Error("timeout");};
  assert.deepEqual(await coordinateVendorOtpRequest(PHONE,deps),{kind:"blocked",reason:"outcome_uncertain"});
  assert.equal(calls.filter(x=>x==="auth").length,1);
});
test("Q8 thrown gate or reservation error never reaches provider",async()=>{
  for(const key of ["vendorGate","abuseAllowed","reserveVendorPurpose"]){
    const {deps,calls}=fixture();
    deps[key]=async()=>{calls.push("throw:"+key);throw Error("offline");};
    assert.deepEqual(await coordinateVendorOtpRequest(PHONE,deps),{kind:"blocked",reason:"outcome_uncertain"});
    assert.equal(calls.some(x=>x.startsWith("auth:")),false);
  }
});
