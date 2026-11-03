import test from "node:test";
import assert from "node:assert/strict";
import {preflightThreeRealAal2} from "../../../contracts/vox/realAal2StagingPreflight.mjs";
const id=n=>"00000000-0000-4000-8000-"+String(n).padStart(12,"0");
const now=1793699990;
const issuer="https://auth.staging.example.test/auth/v1";
function token(n,overrides={}){
 const c={iss:issuer,aud:"authenticated",aal:"aal2",sub:id(n),session_id:id(n+20),
  exp:now+3600,iat:now-30,is_anonymous:false,...overrides};
 const enc=x=>Buffer.from(JSON.stringify(x)).toString("base64url");
 return enc({alg:"HS256",typ:"JWT"})+"."+enc(c)+"."+("A".repeat(50));
}
const ts=()=>[token(1),token(2),token(3)];
test("VO8 offline preflight demands three distinct AAL2 sessions for exact Staging issuer",()=>{
 const r=preflightThreeRealAal2(ts(),{expectedIssuer:issuer,now});
 assert.equal(r.length,3);
 assert.equal(r[0].sub,id(1));
});
test("VO8 rejects AAL1, cross-environment, expired, anonymous and forged payload shapes",()=>{
 const cases=[
  {aal:"aal1"},{iss:"https://auth.prod.example.test/auth/v1"},
  {exp:now+10},{exp:now+90000},{iat:now+60},
  {is_anonymous:true},{aud:"anon"},{sub:"not-a-uuid"},
  {session_id:"not-a-uuid"}
 ];
 for(const claims of cases){
  const v=ts();v[1]=token(2,claims);
  assert.throws(()=>preflightThreeRealAal2(v,{expectedIssuer:issuer,now}),/PREFLIGHT_CLAIMS_NOT_ELIGIBLE/);
 }
});
test("VO8 rejects duplicate principal, session or bearer even with AAL2",()=>{
 const v=ts();v[1]=v[0];
 assert.throws(()=>preflightThreeRealAal2(v,{expectedIssuer:issuer,now}),/DUPLICATE_BEARER/);
 const p=ts();p[1]=token(2,{sub:id(1)});
 assert.throws(()=>preflightThreeRealAal2(p,{expectedIssuer:issuer,now}),/DISTINCT_PRINCIPALS_REQUIRED/);
 const s=ts();s[1]=token(2,{session_id:id(21)});
 assert.throws(()=>preflightThreeRealAal2(s,{expectedIssuer:issuer,now}),/DISTINCT_SESSIONS_REQUIRED/);
});
test("VO8 denies missing issuer configuration and malformed JWTs without network",()=>{
 assert.throws(()=>preflightThreeRealAal2(ts(),{now}),/ISSUER_CONFIG_REQUIRED/);
 assert.throws(()=>preflightThreeRealAal2(ts(),{now,expectedIssuer:"http://insecure/auth/v1"}),/ISSUER_CONFIG_INVALID/);
 const v=ts();v[0]="not.a.token";
 assert.throws(()=>preflightThreeRealAal2(v,{now,expectedIssuer:issuer}),/THREE_BEARERS_REQUIRED/);
});
