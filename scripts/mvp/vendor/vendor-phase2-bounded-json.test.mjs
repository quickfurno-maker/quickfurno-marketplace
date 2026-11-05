import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {readBoundedVendorJson,invalidDeclaredVendorLength} from "../../../lib/vendors/readBoundedVendorJson.ts";

const root=resolve(import.meta.dirname,"../../..");
const src=path=>readFileSync(resolve(root,path),"utf8");
const otp=src("app/api/vendor/onboarding/request-otp/route.ts");
const complete=src("app/api/vendor/onboarding/complete/route.ts");
const evidence=src("app/api/vendor/private-evidence/route.ts");
const url="https://staging-core.quickfurno.in/api/vendor/onboarding/complete";
const req=(data,headers={})=>new Request(url,{
 method:"POST",headers:{"content-type":"application/json",...headers},body:data
});

test("P2J1 browser HTTP/2 JSON without Content-Length accepted within actual byte cap",async()=>{
 const body=JSON.stringify({mobile:"9876543210",token:"123456",registration:{business_name:"Demo"}});
 const result=await readBoundedVendorJson(req(body),1024);
 assert.deepEqual(result,{ok:true,value:JSON.parse(body)});
 assert.equal(invalidDeclaredVendorLength(null,1024),false);
});

test("P2J2 forged lower declared length never bypasses actual byte cap",async()=>{
 const body=JSON.stringify({payload:"x".repeat(1000)});
 const result=await readBoundedVendorJson(req(body,{"content-length":"1"}),120);
 assert.deepEqual(result,{ok:false,reason:"too_large"});
});
test("P2J3 oversized, noninteger, invalid or zero declared length fails before body read",async()=>{
 for(const value of ["0","-1","NaN","1.1","4097","99999999999999999999999"]){
  assert.equal(invalidDeclaredVendorLength(value,4096),true);
  const result=await readBoundedVendorJson(req("{}",{"content-length":value}),4096);
  assert.deepEqual(result,{ok:false,reason:"too_large"});
 }
 assert.equal(invalidDeclaredVendorLength("4096",4096),false);
});
test("P2J4 truncated JSON, malformed UTF8, missing body, oversize stream and zero limit reject",async()=>{
 assert.deepEqual(await readBoundedVendorJson(req('{"mobile":'),4096),{ok:false,reason:"invalid"});
 const malformed=new Request(url,{method:"POST",headers:{"content-type":"application/json"},
   body:new Uint8Array([0xc3,0x28])});
 assert.deepEqual(await readBoundedVendorJson(malformed,4096),{ok:false,reason:"invalid"});
 assert.deepEqual(await readBoundedVendorJson(new Request(url,{method:"POST"}),4096),{ok:false,reason:"invalid"});
 assert.deepEqual(await readBoundedVendorJson(req("{}"),0),{ok:false,reason:"invalid"});
 assert.deepEqual(await readBoundedVendorJson(req(JSON.stringify({x:"x".repeat(1000)})),100),
  {ok:false,reason:"too_large"});
});
test("P2J5 signup + OTP must bound bytes prior to JSON object validation or Auth provider",()=>{
 for(const [code,max] of [[otp,1024],[complete,8192]]){
  assert.match(code,new RegExp("readBoundedVendorJson\\(request,"+max+"\\)"));
  assert.doesNotMatch(code,/await request\.json\(\)/);
  assert.match(code,/sameOrigin\(request\)/);
  assert.match(code,/INVALID_CONTENT_TYPE/);
  assert.match(code,/INVALID_REQUEST_SIZE/);
 }
 assert.ok(otp.indexOf("readBoundedVendorJson(request,1024)")<
   otp.indexOf("coordinateVendorOtpRequest("));
 assert.ok(complete.indexOf("readBoundedVendorJson(request,8192)")<
   complete.indexOf("enrollPendingVendorAfterWhatsappOtp("));
 assert.match(complete,/QF_VENDOR_ATOMIC_SIGNUP_MODE==="staging"/);
 assert.match(complete,/QF_VENDOR_OTP_VERIFY_MODE==="staging"/);
 assert.doesNotMatch(complete,/auth\.admin\.createUser|sendMessage\(/);
});
test("P2J6 private evidence accepts absent claimed length but remains actual-stream bounded",()=>{
 assert.match(evidence,/invalidDeclaredVendorLength\(request\.headers\.get\("content-length"\),MAX_BODY\)/);
 assert.match(evidence,/readBoundedVendorMultipart\(request,MAX_BODY\)/);
 assert.doesNotMatch(evidence,/Number\(request\.headers\.get\("content-length"\)\)/);
 assert.ok(evidence.indexOf("readBoundedVendorMultipart(request,MAX_BODY)")<
  evidence.indexOf("qf_vendor_begin_private_verification_case"));
 assert.match(evidence,/QF_VENDOR_PRIVATE_BUCKET_CERTIFIED==="staging"/);
 assert.match(evidence,/pending_scan_and_owner_review/);
});
