import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {authorizeRc4Staff} from "../../../lib/vox/rc4StaffAuthorization.mjs";
const root=resolve(import.meta.dirname,"../../..");
// Synthetic identities only. No real users, tokens, network or DB.
const U_TL="11111111-1111-4111-8111-111111111111";
const U_STAFF="22222222-2222-4222-8222-222222222222";
const U_OWNER="33333333-3333-4333-8333-333333333333";
const U_OTHER="44444444-4444-4444-8444-444444444444";
const TEAM="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TEAM_B="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const CITY="cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const CITY_B="dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const SESSION="eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const NOW=Date.parse("2026-10-30T12:00:00Z");
const sec=NOW/1000;
const FUTURE="2027-01-01T00:00:00Z";
function jwt(over={}){
 const p={sub:U_TL,aal:"aal2",exp:sec+3600,iat:sec-60,session_id:SESSION,...over};
 const b=o=>Buffer.from(JSON.stringify(o)).toString("base64url");
 return `Bearer ${b({alg:"ES256"})}.${b(p)}.${"s".repeat(90)}`;
}
function tlFacts(over={}){
 return {
  profile:{id:U_TL,role:null,is_active:true},
  authUser:{id:U_TL,app_metadata:{qf_principal:"vox_staff",vox_role:"team_leader"}},
  membership:{auth_user_id:U_TL,team_id:TEAM,staff_role:"team_leader",is_active:true,expires_at:FUTURE,revoked_at:null},
  team:{id:TEAM,city_id:CITY,is_active:true},city:{id:CITY,is_active:true},
  authorizationEpoch:null,...over};
}
function ownerFacts(over={}){
 return {profile:{id:U_OWNER,role:"admin",is_active:true},
  authUser:{id:U_OWNER,app_metadata:{admin_role:"Superadmin"}},
  membership:null,team:null,city:null,authorizationEpoch:null,...over};
}
function deps({facts=tlFacts(),id=U_TL,live=true,verified}={}){
 return {now:()=>NOW,
  verifyBearer:async()=>verified===undefined?{id,app_metadata:{}}:verified,
  loadFacts:async()=>facts,
  isSessionLive:async()=>live};
}
const call=(o={},d={})=>authorizeRc4Staff({authorization:jwt(),required:"team_leader",teamId:TEAM,cityId:CITY,deps:deps(d),...o});
const code=r=>(r.ok?"OK":r.code);

test("valid AAL2 independent Team Leader binds from verified identity with frozen principal",async()=>{
 const r=await call();
 assert.equal(r.ok,true);
 assert.deepEqual({...r.principal},{kind:"team_leader",userId:U_TL,staffRole:"team_leader",teamId:TEAM,cityId:CITY,sessionId:SESSION});
 assert.ok(Object.isFrozen(r.principal));
});
test("non-leader staff passes required=staff but never required=team_leader",async()=>{
 const f=tlFacts({profile:{id:U_STAFF,role:null,is_active:true},
  authUser:{id:U_STAFF,app_metadata:{qf_principal:"vox_staff"}},
  membership:{auth_user_id:U_STAFF,team_id:TEAM,staff_role:"support_agent",is_active:true,expires_at:FUTURE,revoked_at:null}});
 const a=jwt({sub:U_STAFF});
 assert.equal((await call({authorization:a,required:"staff"},{facts:f,id:U_STAFF})).principal.kind,"staff");
 assert.equal(code(await call({authorization:a},{facts:f,id:U_STAFF})),"PRINCIPAL_MISMATCH");
});
test("IDOR: caller-supplied user id that differs from the verified subject is rejected",async()=>{
 assert.equal(code(await call({claimedUserId:U_OTHER})),"SUBJECT_MISMATCH");
 assert.equal(code(await call({claimedUserId:U_TL})),"OK");
 assert.equal(code(await call({claimedUserId:"not-a-uuid"})),"BAD_REQUEST");
});
test("wrong JWT subject (token sub differs from Auth-verified user) is denied",async()=>{
 assert.equal(code(await call({authorization:jwt({sub:U_OTHER})})),"UNAUTHENTICATED");
});
test("Auth server rejection, malformed bearer and anonymous tokens are denied",async()=>{
 assert.equal(code(await call({},{verified:null})),"UNAUTHENTICATED");
 assert.equal(code(await call({authorization:"Bearer abc"})),"UNAUTHENTICATED");
 assert.equal(code(await call({authorization:null})),"UNAUTHENTICATED");
 assert.equal(code(await call({authorization:jwt({is_anonymous:true})})),"UNAUTHENTICATED");
});
test("no MFA: aal1, missing aal and null aal are all denied",async()=>{
 for(const aal of ["aal1",undefined,null,"AAL2"])
  assert.equal(code(await call({authorization:jwt({aal})})),"AAL2_REQUIRED");
});
test("expired, over-long, future-iat or sessionless tokens are denied",async()=>{
 for(const o of [{exp:sec-1},{exp:sec+999999},{iat:sec+3600},{session_id:undefined}])
  assert.equal(code(await call({authorization:jwt(o)})),"UNAUTHENTICATED");
});
test("membership is_active false/null/missing, revoked or expired is denied",async()=>{
 const m=x=>tlFacts({membership:{...tlFacts().membership,...x}});
 for(const x of [{is_active:false},{is_active:null},{is_active:undefined},
   {revoked_at:"2026-10-29T00:00:00Z"},{expires_at:"2026-10-01T00:00:00Z"},{expires_at:null}])
  assert.equal(code(await call({},{facts:m(x)})),"MEMBERSHIP_INACTIVE");
 assert.equal(code(await call({},{facts:tlFacts({membership:null})})),"NOT_STAFF");
 assert.equal(code(await call({},{facts:tlFacts({membership:{...tlFacts().membership,auth_user_id:U_OTHER}})})),"NOT_STAFF");
});
test("inactive profile, legacy Core role or admin metadata disqualify neutral Staff",async()=>{
 assert.equal(code(await call({},{facts:tlFacts({profile:{id:U_TL,role:null,is_active:false}})})),"NOT_STAFF");
 assert.equal(code(await call({},{facts:tlFacts({profile:{id:U_TL,role:"vendor",is_active:true}})})),"NOT_STAFF");
 const meta=m=>tlFacts({authUser:{id:U_TL,app_metadata:m}});
 assert.equal(code(await call({},{facts:meta({qf_principal:"vox_staff",vox_role:"team_leader",admin_role:"Superadmin"})})),"NOT_STAFF");
 assert.equal(code(await call({},{facts:meta({vox_role:"team_leader"})})),"NOT_STAFF");
});
test("Auth metadata and Core membership must agree on Team Leader both ways",async()=>{
 const noMeta=tlFacts({authUser:{id:U_TL,app_metadata:{qf_principal:"vox_staff"}}});
 assert.equal(code(await call({},{facts:noMeta})),"ROLE_MISMATCH");
 const phantom=tlFacts({membership:{...tlFacts().membership,staff_role:"support_agent"}});
 assert.equal(code(await call({},{facts:phantom})),"ROLE_MISMATCH");
 const unknown=tlFacts({membership:{...tlFacts().membership,staff_role:"root"}});
 assert.equal(code(await call({},{facts:unknown})),"ROLE_MISMATCH");
});
test("wrong team or city, inactive team/city, mismatched team->city are denied",async()=>{
 assert.equal(code(await call({teamId:TEAM_B})),"SCOPE_MISMATCH");
 assert.equal(code(await call({cityId:CITY_B})),"SCOPE_MISMATCH");
 assert.equal(code(await call({teamId:undefined})),"SCOPE_REQUIRED");
 assert.equal(code(await call({cityId:undefined})),"SCOPE_REQUIRED");
 assert.equal(code(await call({},{facts:tlFacts({team:{id:TEAM,city_id:CITY,is_active:false}})})),"SCOPE_MISMATCH");
 assert.equal(code(await call({},{facts:tlFacts({city:{id:CITY,is_active:null}})})),"SCOPE_MISMATCH");
 assert.equal(code(await call({},{facts:tlFacts({city:{id:CITY_B,is_active:true}})})),"SCOPE_MISMATCH");
 assert.equal(code(await call({},{facts:tlFacts({team:{id:TEAM_B,city_id:CITY,is_active:true}})})),"SCOPE_MISMATCH");
});
test("self-approval is denied as requester or as target; independent TL approves",async()=>{
 assert.equal(code(await call({approval:{requestedBy:U_TL,targetUserId:U_STAFF}})),"SELF_APPROVAL");
 assert.equal(code(await call({approval:{requestedBy:U_STAFF,targetUserId:U_TL}})),"SELF_APPROVAL");
 assert.equal(code(await call({approval:{requestedBy:U_STAFF,targetUserId:U_OTHER}})),"OK");
 assert.equal(code(await call({approval:{requestedBy:"x",targetUserId:U_OTHER}})),"BAD_REQUEST");
});
test("non-leader staff can never approve",async()=>{
 const f=tlFacts({profile:{id:U_STAFF,role:null,is_active:true},
  authUser:{id:U_STAFF,app_metadata:{qf_principal:"vox_staff"}},
  membership:{auth_user_id:U_STAFF,team_id:TEAM,staff_role:"auditor",is_active:true,expires_at:FUTURE,revoked_at:null}});
 const r=await call({authorization:jwt({sub:U_STAFF}),required:"staff",approval:{requestedBy:U_OTHER,targetUserId:U_TL}},{facts:f,id:U_STAFF});
 assert.equal(code(r),"PRINCIPAL_MISMATCH");
});
test("stale revocation: same unexpired JWT dies on session revoke or older-than-epoch iat",async()=>{
 assert.equal(code(await call({},{live:false})),"SESSION_REVOKED");
 assert.equal(code(await call({},{live:"true"})),"SESSION_REVOKED");
 const after=new Date(NOW-30_000).toISOString(); // change after token iat (sec-60)
 assert.equal(code(await call({},{facts:tlFacts({authorizationEpoch:after})})),"STALE_CREDENTIAL");
 const before=new Date(NOW-120_000).toISOString();
 assert.equal(code(await call({},{facts:tlFacts({authorizationEpoch:before})})),"OK");
 assert.equal(code(await call({},{facts:tlFacts({authorizationEpoch:undefined})})),"DEPENDENCY_UNAVAILABLE");
 assert.equal(code(await call({},{facts:tlFacts({authorizationEpoch:"garbage"})})),"DEPENDENCY_UNAVAILABLE");
});
test("dependency failures and malformed facts fail closed, never open",async()=>{
 const boom={...deps(),loadFacts:async()=>{throw new Error("db");}};
 assert.equal(code(await authorizeRc4Staff({authorization:jwt(),required:"team_leader",teamId:TEAM,cityId:CITY,deps:boom})),"DEPENDENCY_UNAVAILABLE");
 assert.equal(code(await call({},{facts:null})),"DEPENDENCY_UNAVAILABLE");
 assert.equal(code(await authorizeRc4Staff({authorization:jwt(),required:"team_leader",teamId:TEAM,cityId:CITY})),"BAD_REQUEST");
 assert.equal(code(await call({required:"admin"})),"BAD_REQUEST");
});
test("Owner and neutral Team Leader are disjoint principals",async()=>{
 const oAuth=jwt({sub:U_OWNER});
 const o=await call({authorization:oAuth,required:"owner",teamId:undefined,cityId:undefined},{facts:ownerFacts(),id:U_OWNER});
 assert.equal(o.ok,true);assert.equal(o.principal.kind,"owner");
 // Owner cannot pass as Team Leader / staff.
 assert.equal(code(await call({authorization:oAuth,required:"team_leader"},{facts:ownerFacts(),id:U_OWNER})),"PRINCIPAL_MISMATCH");
 assert.equal(code(await call({authorization:oAuth,required:"staff"},{facts:ownerFacts(),id:U_OWNER})),"PRINCIPAL_MISMATCH");
 // Team Leader cannot pass as Owner.
 assert.equal(code(await call({required:"owner"})),"PRINCIPAL_MISMATCH");
 // Owner identity that also holds a staff membership is conflated -> denied.
 const both=ownerFacts({membership:tlFacts().membership});
 assert.equal(code(await call({authorization:oAuth,required:"owner"},{facts:both,id:U_OWNER})),"OWNER_STAFF_CONFLATION");
 // Owner approval cannot target or be requested by themself.
 assert.equal(code(await call({authorization:oAuth,required:"owner",approval:{requestedBy:U_OWNER,targetUserId:U_TL}},{facts:ownerFacts(),id:U_OWNER})),"SELF_APPROVAL");
 // Inactive owner profile / missing Superadmin metadata is not Owner.
 assert.notEqual(code(await call({authorization:oAuth,required:"owner"},{facts:ownerFacts({profile:{id:U_OWNER,role:"admin",is_active:false}}),id:U_OWNER})),"OK");
 assert.notEqual(code(await call({authorization:oAuth,required:"owner"},{facts:ownerFacts({authUser:{id:U_OWNER,app_metadata:{}}}),id:U_OWNER})),"OK");
});
test("module stays pure and server adapter stays hard-off with a fail-closed revocation probe",()=>{
 const src=readFileSync(resolve(root,"lib/vox/rc4StaffAuthorization.mjs"),"utf8");
 assert.doesNotMatch(src,/process\.env|fetch\(|createClient|\.insert\(|\.update\(|\.upsert\(|\.delete\(|createUser|rpc\(/);
 const adapter=readFileSync(resolve(root,"lib/vox/rc4StaffServerAdapter.ts"),"utf8");
 assert.match(adapter,/VOX_RC4_STAFF_AUTHZ_ENABLED!=="staging"/);
 assert.match(adapter,/isSessionLive\([^)]*\)[^{]*\{return false;\}/);
 assert.doesNotMatch(adapter,/\.insert\(|\.update\(|\.upsert\(|\.delete\(|createUser|inviteUser/);
});
