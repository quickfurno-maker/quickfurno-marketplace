import test from "node:test";
import assert from "node:assert/strict";
import {createHmac} from "node:crypto";
import {isCoreStaffOutboxMetric as valid,signCoreOutboxMetricEnvelope as sign}
 from "../../../contracts/vox/outboxMetricsAttestation.mjs";
const id=n=>"00000000-0000-4000-8000-"+String(n).padStart(12,"0");
const secret="SYNTHETIC_ONLY_SHARED_CORE_AGNI_HMAC_2026_NOT_LIVE";
const now=Date.parse("2026-10-16T11:00:00Z");
const metric=()=>({schema:"qf.vox.internal-notification-outbox.metrics.v1",
 source:"QUICKFURNO_CORE",observedAt:"2026-10-16T10:59:59.000Z",
 collectionId:id(1),pending:1,leased:0,completed:2,deadLetter:0,
 oldestPendingAgeSeconds:4,maxAttemptsObserved:1,
 totalKnown:false,includesExternalProviderDelivery:false});
test("sign exact bounded private Core metric with HMAC SHA256",()=>{
 const token=sign({metric:metric(),secret,jti:id(8),now});
 const [body,sig]=token.split(".");
 const mac=createHmac("sha256",secret).update(body).digest("base64url");
 assert.equal(sig,mac);
 const b=JSON.parse(Buffer.from(body,"base64url").toString());
 assert.equal(b.schema,"qf.vox.internal-outbox.metrics.envelope.v1");
 assert.equal(b.iss,"quickfurno-core");assert.equal(b.aud,"qf-agni-owner-gateway");
 assert.equal(b.iat,Math.floor(now/1000));assert.equal(b.exp-b.iat,90);
 assert.deepEqual(b.metric,metric());
});
test("no tenant/user IDs, endpoint, provider claims or URL serialized",()=>{
 const b=sign({metric:metric(),secret,jti:id(8),now}).split(".")[0];
 const t=Buffer.from(b,"base64url").toString();
 for(const phrase of ["userId","staffId","phone","destination","providerDeliveries","url","token","password"]){
  assert.equal(t.includes(phrase),false);
 }
});
test("reject stale/future/forged source or fake complete count",()=>{
 for(const change of [
  {observedAt:"2026-10-16T10:00:00Z"},
  {observedAt:"2026-10-16T11:10:00Z"},
  {source:"BROWSER"},{schema:"v0"},
  {totalKnown:true},{includesExternalProviderDelivery:true},
  {collectionId:"PRIVATE_USER_EMAIL"}
 ]){
  const m={...metric(),...change};
  assert.equal(valid(m,now),false);
  assert.throws(()=>sign({metric:m,secret,jti:id(8),now}));
 }
});
test("reject extra source fields and user data, not silently sanitize",()=>{
 for(const change of [{phone:"123"},{provider_key:"SECRET"},{signed:true}]){
  assert.equal(valid({...metric(),...change},now),false);
 }
});
test("unbounded, fractional, NaN or contradictory counters denied",()=>{
 for(const m of [
  {...metric(),pending:-1},{...metric(),leased:1.3},
  {...metric(),deadLetter:Number.NaN},
  {...metric(),completed:1000001},
  {...metric(),pending:0,oldestPendingAgeSeconds:5},
  {...metric(),pending:4,oldestPendingAgeSeconds:null},
  {...metric(),maxAttemptsObserved:6}
 ])assert.equal(valid(m,now),false);
});
test("missing secret, fake JTI or abnormal wall time denied",()=>{
 for(const input of [
  {metric:metric(),secret:"tiny",jti:id(8),now},
  {metric:metric(),secret,jti:"MALICIOUS",now},
  {metric:metric(),secret,jti:id(8),now:-1}
 ])assert.throws(()=>sign(input));
});
test("valid no pending rows preserves no inventing age or total",()=>{
 const m={...metric(),pending:0,oldestPendingAgeSeconds:null};
 assert.equal(valid(m,now),true);
 const token=sign({metric:m,secret,jti:id(4),now});
 assert.equal(typeof token,"string");
});
