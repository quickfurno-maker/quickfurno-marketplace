import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {resolve,dirname} from "node:path";
import {fileURLToPath} from "node:url";
import {readBoundedRazorpayWebhookBody as read,RAZORPAY_WEBHOOK_MAX_BYTES as MAX}
 from "../../../lib/payments/readBoundedRazorpayWebhookBody.mjs";
const req=(body,headers={})=>new Request("http://127.0.0.1/local",{
 method:"POST",body,headers,duplex:"half"});
test("exact raw JSON, UTF8 and 64KiB upper limit are byte-preserving",async()=>{
 const text='{"event":"payment.captured","note":"₹"}';
 const r=await read(req(text));
 assert.equal(r.ok,true);assert.equal(r.rawBody,text);
 const maximum=await read(req("a".repeat(MAX)));
 assert.equal(maximum.ok,true);assert.equal(maximum.rawBody.length,MAX);
 const oversized=await read(req("a".repeat(MAX+1)));
 assert.equal(oversized.ok,false);assert.equal(oversized.code,"WEBHOOK_BODY_TOO_LARGE");
});
test("declared too large, malformed, dishonest length, empty and invalid UTF8 deny",async()=>{
 for(const [request,code] of [
  [req("{}",{"content-length":String(MAX+1)}),"WEBHOOK_BODY_TOO_LARGE"],
  [req("{}",{"content-length":"none"}),"WEBHOOK_LENGTH_INVALID"],
  [req("{}",{"content-length":"2"}),null],
  [req("{}",{"content-length":"6"}),"WEBHOOK_LENGTH_MISMATCH"],
  [req(""),"WEBHOOK_BODY_EMPTY"],
  [req(new Uint8Array([0xff,0xfe])),"WEBHOOK_BODY_UTF8_INVALID"]
 ]){
  if(code===null)continue;
  const result=await read(request);
  assert.equal(result.ok,false);
  assert.equal(result.code,code);
 }
});
test("chunk boundary crossing max denies without concatenating unbounded body",async()=>{
 const stream=new ReadableStream({
  start(controller){
   controller.enqueue(new Uint8Array(MAX));
   controller.enqueue(new Uint8Array(1));
   controller.close();
  }
 });
 assert.equal((await read(req(stream))).code,"WEBHOOK_BODY_TOO_LARGE");
});
test("live HTTP route checks bounded input before calling payment handler",()=>{
 const root=resolve(dirname(fileURLToPath(import.meta.url)),"../../..");
 const src=readFileSync(resolve(root,"app/api/webhooks/razorpay/vendor-package/route.ts"),"utf8");
 assert.ok(src.indexOf("readBoundedRazorpayWebhookBody(request)")<
  src.indexOf("handleVendorPackageRazorpayWebhook(bounded.rawBody"));
 assert.doesNotMatch(src,/await request\.text\(\)/);
 assert.match(src,/status = bounded.code === "WEBHOOK_BODY_TOO_LARGE" \? 413 : 400/);
});
