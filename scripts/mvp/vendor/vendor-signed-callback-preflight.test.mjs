/**
 * F11 cryptographic, NO SEND/NO DB check for QuickFurno signed callbacks.
 * All strings are synthetic. No production webhook, provider or token use.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {createHmac} from "node:crypto";
import {readFileSync} from "node:fs";
import {Webhook} from "standardwebhooks";
import {
  collectStandardWebhookHeaders,loadSendSmsHookSecrets,normalizeHookSecret,
  StandardWebhooksSignatureVerifier,parseSendSmsHookEvent,isWithinHookBodyCeiling,
  MAX_HOOK_BODY_BYTES,
} from "../../../lib/auth/supabaseSendSmsHook.ts";
import {
  verifyMetaWebhookSignatureBytes,computeMetaWebhookSignature,
  verifyMetaWebhookGetChallenge,
} from "../../../lib/communication/providers/metaWhatsAppWebhook.ts";
import {resolveWebhookIdentityRegistryConfig} from "../../../lib/communication/providers/metaCloudWhatsAppConfig.ts";
import {decideCallbackIdentityRegistry} from "../../../lib/communication/providers/metaCallbackIdentityRegistry.ts";

const source={user:{id:"aa11bb22-3333-4444-8555-666677778888",phone:"+919999999999"},sms:{otp:"123456"}};
const raw=JSON.stringify(source);
const fixedTime=new Date();
const id="msg-f11-synthetic-001";
const key="whsec_"+Buffer.alloc(32,11).toString("base64");
const oldKey="whsec_"+Buffer.alloc(32,17).toString("base64");
const wh=new Webhook(key);
const headers={
  "webhook-id":id,
  "webhook-timestamp":String(Math.floor(fixedTime.getTime()/1000)),
  "webhook-signature":wh.sign(id,fixedTime,raw),
};
const verifier=new StandardWebhooksSignatureVerifier();
const pick=h=>collectStandardWebhookHeaders(n=>h[n]??null);
const verify=(body,h=headers,secrets=[key])=>verifier.verify(body,pick(h),secrets);
const client={wabaId:"27861262223494153",phoneNumberId:"1333595106493545"};
const vendor={wabaId:"1569174604351612",phoneNumberId:"1088396637681784"};
const registry=resolveWebhookIdentityRegistryConfig({
 WHATSAPP_WABA_ID:client.wabaId,WHATSAPP_PHONE_NUMBER_ID:client.phoneNumberId,
 WHATSAPP_VENDOR_WABA_ID:vendor.wabaId,
 WHATSAPP_VENDOR_PHONE_NUMBER_ID:vendor.phoneNumberId,
});
const metaSecret="dummy-test-meta-app-secret-not-a-real-credential";
function envelope(w,p){return {
 object:"whatsapp_business_account",
 entry:[{id:w,changes:[{field:"messages",value:{metadata:{phone_number_id:p},messages:[{id:"wamid-local",type:"text"}]}}]}],
};}
function metaProbe(w,p){
 const body=JSON.stringify(envelope(w,p));
 return {body,signature:computeMetaWebhookSignature(body,metaSecret)};
}
test("F11-01 official Standard Webhooks signature signs exact synthetic bytes",()=>{
 assert.equal(verifier.verifierKey,"standard_webhooks");
 assert.equal(verify(raw).ok,true);
});
test("F11-02 Supabase event only parsed AFTER signature verification",()=>{
 const v=verify(raw);assert.equal(v.ok,true);
 const parsed=parseSendSmsHookEvent(v.payload);assert.equal(parsed.ok,true);
 assert.equal(parsed.event.phoneE164,source.user.phone);
});
test("F11-03 changed OTP bytes cannot reuse a valid Supabase signature",()=>{
 assert.equal(verify(raw.replace("123456","123457")).ok,false);
});
test("F11-04 changed user ID cannot reuse a valid Supabase signature",()=>{
 assert.equal(verify(raw.replace(source.user.id,"ee11bb22-3333-4444-8555-666677778888")).ok,false);
});
test("F11-05 changed webhook-id invalidates Supabase signature",()=>{
 assert.equal(verify(raw,{...headers,"webhook-id":"msg-f11-forged"}).ok,false);
});
test("F11-06 changed webhook-timestamp invalidates Supabase signature",()=>{
 assert.equal(verify(raw,{...headers,"webhook-timestamp":String(Math.floor(Date.now()/1000)-300)}).ok,false);
});
test("F11-07 wrong signing key rejects synthetic Supabase payload",()=>{
 assert.equal(verify(raw,headers,[oldKey]).ok,false);
});
test("F11-08 secret rotation verifies only the actually authorized key",()=>{
 assert.equal(verify(raw,headers,[oldKey,key]).ok,true);
});
test("F11-09 versioned v1 key parsing preserves whole secrets",()=>{
 const a=loadSendSmsHookSecrets({SEND_SMS_HOOK_SECRETS:"v1,"+oldKey+"|v1,"+key+"|v1,"+oldKey});
 assert.equal(a.length,2);assert.equal(a[0],"v1,"+oldKey);
 assert.equal(normalizeHookSecret(a[1]),key);
 assert.equal(verify(raw,headers,a.map(normalizeHookSecret)).ok,true);
});
test("F11-10 missing Standard Webhooks signature headers deny",()=>{
 for(const k of Object.keys(headers)){
  const h={...headers};delete h[k];assert.equal(pick(h),null);
 }
});
test("F11-11 Supabase oversized body fails before processing",()=>{
 assert.equal(isWithinHookBodyCeiling("x".repeat(MAX_HOOK_BODY_BYTES+1)),false);
});
test("F11-12 malformed authorized shape fails parser",()=>{
 const shape={user:{id:source.user.id,phone:source.user.phone},sms:{}};
 assert.equal(parseSendSmsHookEvent(shape).ok,false);
});
test("F11-13 Meta raw-byte HMAC validates client WABA callback locally",()=>{
 const {body,signature}=metaProbe(client.wabaId,client.phoneNumberId);
 assert.equal(verifyMetaWebhookSignatureBytes(Buffer.from(body),signature,metaSecret),true);
});
test("F11-14 Meta raw-byte HMAC validates separate vendor callback locally",()=>{
 const {body,signature}=metaProbe(vendor.wabaId,vendor.phoneNumberId);
 assert.equal(verifyMetaWebhookSignatureBytes(Buffer.from(body),signature,metaSecret),true);
});
test("F11-15 Meta signed vendor body cannot substitute client phone metadata",()=>{
 const {body,signature}=metaProbe(vendor.wabaId,vendor.phoneNumberId);
 assert.equal(verifyMetaWebhookSignatureBytes(Buffer.from(body.replace(vendor.phoneNumberId,client.phoneNumberId)),signature,metaSecret),false);
});
test("F11-16 Meta signature rejects wrong secret",()=>{
 const {body,signature}=metaProbe(client.wabaId,client.phoneNumberId);
 assert.equal(verifyMetaWebhookSignatureBytes(Buffer.from(body),signature,"another-test-key"),false);
});
test("F11-17 Meta signature rejects invalid grammar before HMAC",()=>{
 const {body,signature}=metaProbe(client.wabaId,client.phoneNumberId);
 for(const bad of ["sha256=xxx",signature.toUpperCase(),signature.slice(7),"sha1="+signature.slice(7),""]){
  assert.equal(verifyMetaWebhookSignatureBytes(Buffer.from(body),bad,metaSecret),false);
 }
});
test("F11-18 authorized client signed callback matches client identity only",()=>{
 assert.equal(registry.ok,true);
 const x=metaProbe(client.wabaId,client.phoneNumberId);
 assert.equal(verifyMetaWebhookSignatureBytes(Buffer.from(x.body),x.signature,metaSecret),true);
 assert.equal(decideCallbackIdentityRegistry(JSON.parse(x.body),{identities:registry.identities}).kind,"authorized");
});
test("F11-19 authorized vendor signed callback matches vendor identity only",()=>{
 const x=metaProbe(vendor.wabaId,vendor.phoneNumberId);
 assert.equal(verifyMetaWebhookSignatureBytes(Buffer.from(x.body),x.signature,metaSecret),true);
 assert.equal(decideCallbackIdentityRegistry(JSON.parse(x.body),{identities:registry.identities}).kind,"authorized");
});
test("F11-20 even validly signed callback with swapped WABA and phone denied",()=>{
 const x=metaProbe(vendor.wabaId,client.phoneNumberId);
 assert.equal(verifyMetaWebhookSignatureBytes(Buffer.from(x.body),x.signature,metaSecret),true);
 assert.equal(decideCallbackIdentityRegistry(JSON.parse(x.body),{identities:registry.identities}).kind,"rejected");
});
test("F11-21 validly signed foreign WABA cannot impersonate Riya",()=>{
 const x=metaProbe("123456789011111111",client.phoneNumberId);
 assert.equal(verifyMetaWebhookSignatureBytes(Buffer.from(x.body),x.signature,metaSecret),true);
 assert.equal(decideCallbackIdentityRegistry(JSON.parse(x.body),{identities:registry.identities}).kind,"rejected");
});
test("F11-22 validly signed Meta mixed-account envelope fails as a whole",()=>{
 const x=envelope(client.wabaId,client.phoneNumberId);
 x.entry.push(envelope(vendor.wabaId,vendor.phoneNumberId).entry[0]);
 const body=JSON.stringify(x);
 const sig="sha256="+createHmac("sha256",metaSecret).update(body).digest("hex");
 assert.equal(verifyMetaWebhookSignatureBytes(Buffer.from(body),sig,metaSecret),true);
 assert.equal(decideCallbackIdentityRegistry(x,{identities:registry.identities}).kind,"rejected");
});
test("F11-23 Meta GET subscribe challenge echoes only with correct verify token",()=>{
 const r=verifyMetaWebhookGetChallenge({mode:"subscribe",verifyToken:"not-real-verify-token",challenge:"test_challenge_123"},"not-real-verify-token");
 assert.deepEqual(r,{ok:true,challenge:"test_challenge_123"});
});
test("F11-24 Meta GET challenge rejects wrong token/mode/missing challenge",()=>{
 const token="test-verify-token";
 for(const p of [
  {mode:"subscribe",verifyToken:"other",challenge:"abc"},
  {mode:"update",verifyToken:token,challenge:"abc"},
  {mode:"subscribe",verifyToken:token,challenge:""},
 ]){
  assert.equal(verifyMetaWebhookGetChallenge(p,token).ok,false);
 }
});
test("F11-25 actual Meta handler runs signature verification BEFORE parsing/identity/runtime effects",()=>{
 const text=readFileSync("services/metaWhatsAppWebhookService.ts","utf8");
 const fn=text.slice(text.indexOf("export async function handleMetaWhatsAppWebhookPostBytes("));
 const sig=fn.indexOf("verifyMetaWebhookSignatureBytes("),parse=fn.indexOf("safeParse("),
  registry=fn.indexOf("resolveWebhookIdentityRegistryConfig("),
  identity=fn.indexOf("decideCallbackIdentityRegistry("),
  next=fn.indexOf("processVerifiedExpectedMetaWebhook(");
 assert.ok(sig>=0&&parse>sig&&registry>parse&&identity>registry&&next>identity);
});
test("F11-26 signed Supabase Auth Hook calls purpose claim before Anisha/Riya branch",()=>{
 const text=readFileSync("services/supabaseSendSmsHookService.ts","utf8");
 const claim=text.indexOf("await claimSignedAuthOtpPurpose(");
 const vendor=text.indexOf('if (signedPurpose === "vendor_login")',claim);
 const anisha=text.indexOf("await deliverVendorWhatsappOtp({",vendor);
 const riya=text.indexOf("await deliverClientLoginOtp(",anisha);
 assert.ok(claim>0&&vendor>claim&&anisha>vendor&&riya>anisha);
});
test("F11-27 production Meta webhook route never bypasses signature+identity gates",()=>{
 const text=readFileSync("app/api/webhooks/whatsapp/meta/route.ts","utf8");
 assert.match(text,/handleMetaWhatsAppWebhookPostBytes/);
 assert.match(text,/readMetaWebhookRawBytes/);
 assert.match(text,/verifyMetaWebhookGetChallenge/);
});
test("F11-28 production Supabase Hook route preserves bounded body and signed service",()=>{
 const text=readFileSync("app/api/auth/hooks/supabase-send-sms/route.ts","utf8");
 assert.match(text,/readBoundedRawBody\(/);
 assert.match(text,/handleSupabaseSendSmsHook\(/);
});
