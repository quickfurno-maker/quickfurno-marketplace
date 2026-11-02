// Offline cross-repo REAL Core signer -> REAL AGNI production-compiled verifier.
// Use: $env:VOX_L6_AGNI_DIST='D:\...\qfa-voxL3-agni-20261016\packages\observability-intelligence\dist\voxCoreOutboxSignedView.js'
//      node --test scripts/mvp/vox/validate-voxL6-real-core-to-agni-interop.mjs
// This requires a separately built AGNI source checkout (exact SHA is
// documented in VOX-L6 QA), not an installed production service or network.
import test from "node:test";
import assert from "node:assert/strict";
import {pathToFileURL} from "node:url";
import {randomUUID} from "node:crypto";
import {resolve,isAbsolute} from "node:path";
import {stat} from "node:fs/promises";
import {signCoreOutboxMetricEnvelope} from "../../../contracts/vox/outboxMetricsAttestation.mjs";
const p=process.env.VOX_L6_AGNI_DIST;
if(!p||!isAbsolute(p))throw Error("AGNI_COMPANION_DIST_ABSOLUTE_PATH_REQUIRED");
const modulePath=resolve(p);
if(!(await stat(modulePath)).isFile())throw Error("EXACT_AGNI_BUILD_REQUIRED");
const {verifyCoreOutboxMetricForCurrentOwner:verify}=await import(pathToFileURL(modulePath).href);
if(typeof verify!=="function")throw Error("NO_COMPILED_REAL_AGNI_VERIFIER");
const secret="VOX-L6_SYNTHETIC_TEST_KEY_NO_PRODUCTION_CREDENTIALS_ONLY";
const ownerUserId="primary-owner";
const now=Date.parse("2026-10-16T15:41:12.000Z");
const metric=()=>({schema:"qf.vox.internal-notification-outbox.metrics.v1",
 source:"QUICKFURNO_CORE",observedAt:new Date(now).toISOString(),
 collectionId:randomUUID(),pending:1,leased:0,completed:2,deadLetter:0,
 oldestPendingAgeSeconds:11,maxAttemptsObserved:2,
 totalKnown:false,includesExternalProviderDelivery:false});
const make=(m=metric(),iat=now)=>signCoreOutboxMetricEnvelope({
 metric:m,secret,jti:randomUUID(),now:iat
});
function scope(token,overrides={}){
 const seen=new Set();
 return {token,secret,ownerUserId,now:new Date(now),
  authorizeCurrentOwner:async id=>id==="primary-owner",
  claimOnce:async jti=>!seen.has(jti)&&!!seen.add(jti),
  ...overrides};
}
test("actual Core HMAC producer is accepted by real built AGNI verifier",async()=>{
 const token=make();
 const verified=await verify(scope(token));
 assert.equal(verified.verifiedTransport,"SIGNED_VERIFIED");
 assert.equal(verified.ownerId,ownerUserId);
 assert.equal(verified.sourceProof,"CORE_HMAC_AND_DURABLE_REPLAY");
 assert.notEqual(verified.state,"UNKNOWN");
 assert.equal(verified.actionsEnabled,false);
 assert.equal("providerMessagesSent" in verified,false);
 assert.equal("staffPhone" in verified,false);
});
test("same actual signed Core token cannot be accepted twice",async()=>{
 const token=make();
 const params=scope(token);
 await verify(params);
 await assert.rejects(()=>verify(params),/REPLAY_DENIED/);
});
test("a signed Core payload never bypasses revoked Owner session",async()=>{
 let replayCalls=0;
 const args=scope(make(),{
  authorizeCurrentOwner:async()=>false,
  claimOnce:async()=>{replayCalls++;return true;}
 });
 await assert.rejects(()=>verify(args),/OWNER_SCOPE_DENIED/);
 assert.equal(replayCalls,0);
});
test("wrong secret/tampered token rejected before Owner DB replay",async()=>{
 const token=make();
 let claims=0;
 for(const bad of [{secret:"THIS_IS_NOT_THE_CORE_SHARED_HMAC_KEY_V1"},
  {token:token.slice(0,-1)+(token.at(-1)==="A"?"B":"A")}]){
  await assert.rejects(()=>verify(scope(token,{...bad,
   claimOnce:async()=>{claims++;return true;}})),/SIGNATURE_DENIED/);
 }
 assert.equal(claims,0);
});
test("signed stale metric or mismatched clock fails independently",async()=>{
 const token=make();
 const args=scope(token,{now:new Date(now+3600000)});
 await assert.rejects(()=>verify(args),/EXPIRED|BODY_UNVERIFIED/);
});
test("Core signer rejects unsupported event payload or fake external messages",()=>{
 assert.throws(()=>make({...metric(),includesExternalProviderDelivery:true}),
  /PROVENANCE_REQUIRED/);
 assert.throws(()=>make({...metric(),providerMessagesSent:1}),/PROVENANCE_REQUIRED/);
});
