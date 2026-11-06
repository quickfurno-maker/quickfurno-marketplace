import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {F11_CALLBACK_ROUTES,F11_OWNER_PROTECTED,F11_DECISION_HOLD,
 isExactProviderCallbackUrl,isCloudflareAccessRedirect,assessF11CallbackEvidence,
} from "./f11-callback-perimeter-policy.mjs";
const root="https://hooks-staging.example.test";
const supabase=root+"/api/auth/hooks/supabase-send-sms";
const meta=root+"/api/webhooks/whatsapp/meta";
const observed=[
 {owner:"supabase",status:302,location:"https://team.cloudflareaccess.com/cdn-cgi/access/login/test"},
 {owner:"meta",status:302,location:"https://team.cloudflareaccess.com/cdn-cgi/access/login/test"},
];
test("F11-R01 operator policy holds only the two exact webhook paths",()=>{
 assert.equal(F11_CALLBACK_ROUTES.length,2);
 assert.equal(F11_CALLBACK_ROUTES[0].path,"/api/webhooks/whatsapp/meta");
 assert.equal(F11_CALLBACK_ROUTES[1].path,"/api/auth/hooks/supabase-send-sms");
});
test("F11-R02 Meta GET challenge and POST signed callback are distinct allowed methods",()=>{
 assert.deepEqual(F11_CALLBACK_ROUTES[0].methods,["GET","POST"]);
});
test("F11-R03 Supabase signed hook is POST only",()=>{
 assert.deepEqual(F11_CALLBACK_ROUTES[1].methods,["POST"]);
});
test("F11-R04 VOX Owner readiness is not an allowed callback bypass",()=>{
 assert.equal(F11_OWNER_PROTECTED,"/api/vox/v1/owner-whatsapp-launch-readiness");
 assert.equal(F11_CALLBACK_ROUTES.some(x=>x.path===F11_OWNER_PROTECTED),false);
});
test("F11-R05 correct exact HTTPS callback origins may be inventoried",()=>{
 assert.equal(isExactProviderCallbackUrl(meta,"meta"),true);
 assert.equal(isExactProviderCallbackUrl(supabase,"supabase"),true);
});
test("F11-R06 no broad host-level bypass",()=>{
 assert.equal(isExactProviderCallbackUrl(root+"/","meta"),false);
 assert.equal(isExactProviderCallbackUrl(root+"/","supabase"),false);
});
test("F11-R07 no Owner route bypass through callback contract",()=>{
 assert.equal(isExactProviderCallbackUrl(root+F11_OWNER_PROTECTED,"meta"),false);
 assert.equal(isExactProviderCallbackUrl(root+F11_OWNER_PROTECTED,"supabase"),false);
});
test("F11-R08 no callback path swapping",()=>{
 assert.equal(isExactProviderCallbackUrl(meta,"supabase"),false);
 assert.equal(isExactProviderCallbackUrl(supabase,"meta"),false);
});
for(const [name,url] of [
 ["non-HTTPS",supabase.replace("https:","http:")],
 ["query appended",supabase+"?auth=1"],
 ["fragment appended",supabase+"#token"],
 ["trailing slash",supabase+"/"],
 ["userinfo credentials","https://some_user@hooks-staging.example.test/api/auth/hooks/supabase-send-sms"],
 ["nonstandard port","https://hooks-staging.example.test:8080/api/auth/hooks/supabase-send-sms"],
 ["prefix injected",root+"/api/auth/hooks/supabase-send-sms/other"],
 ["wrong-case path",root+"/API/auth/hooks/supabase-send-sms"],
 ]){
 test("F11-R deny "+name,()=>assert.equal(isExactProviderCallbackUrl(url,"supabase"),false));
}
test("F11-R17 Cloudflare Access redirect explicitly classified",()=>{
 assert.equal(isCloudflareAccessRedirect(302,observed[0].location),true);
});
test("F11-R18 unrelated redirect not mistaken for signed-origin proof",()=>{
 assert.equal(isCloudflareAccessRedirect(302,"https://example.net/redirect"),false);
});
test("F11-R19 non-redirect status never marked Access",()=>{
 assert.equal(isCloudflareAccessRedirect(403,observed[0].location),false);
});
test("F11-R20 Access interception is a blocker for both callback owners",()=>{
 const r=assessF11CallbackEvidence({supabaseHookUrl:supabase,metaCallbackUrl:meta,observed,vendorQuality:"RED"});
 assert.ok(r.blockers.includes("SUPABASE_CLOUDFLARE_ACCESS_INTERCEPTED"));
 assert.ok(r.blockers.includes("META_CLOUDFLARE_ACCESS_INTERCEPTED"));
 assert.ok(r.blockers.includes("VENDOR_QUALITY_NOT_VERIFIED_GREEN"));
});
test("F11-R21 configured callback URLs not verified means HOLD even if perimeter probes exist",()=>{
 const r=assessF11CallbackEvidence({observed});
 assert.ok(r.blockers.includes("SUPABASE_CONFIGURED_CALLBACK_UNVERIFIED"));
 assert.ok(r.blockers.includes("META_CONFIGURED_CALLBACK_UNVERIFIED"));
 assert.equal(r.verdict,"HOLD");
});
test("F11-R22 unauthenticated HTTP 200 alone is never signed-hook proof",()=>{
 const r=assessF11CallbackEvidence({supabaseHookUrl:supabase,metaCallbackUrl:meta,
 observed:[{owner:"supabase",status:200},{owner:"meta",status:200}],vendorQuality:"GREEN"});
 assert.ok(r.blockers.includes("SUPABASE_SIGNED_ORIGIN_STILL_UNVERIFIED"));
 assert.equal(r.maySendOtp,false);
});
test("F11-R23 invalid provider status rejected before GO",()=>{
 const r=assessF11CallbackEvidence({observed:[{owner:"supabase",status:999},{owner:"meta",status:"200"}]});
 assert.ok(r.blockers.includes("SUPABASE_PERIMETER_STATUS_INVALID"));
 assert.ok(r.blockers.includes("META_PERIMETER_STATUS_INVALID"));
});
test("F11-R24 duplicates or missing probe are not accepted as evidence",()=>{
 const r=assessF11CallbackEvidence({observed:[observed[0],observed[0]]});
 assert.ok(r.blockers.includes("META_PERIMETER_EVIDENCE_MISSING"));
 assert.ok(r.blockers.includes("SUPABASE_PERIMETER_EVIDENCE_MISSING"));
});
test("F11-R25 misleading all-true test fixture still cannot authorize Production",()=>{
 const r=assessF11CallbackEvidence({
  supabaseHookUrl:supabase,metaCallbackUrl:meta,
  observed:[{owner:"supabase",status:200},{owner:"meta",status:200}],
  vendorQuality:"GREEN",separateRuntimeSecretsVerified:true,
  signedSupabaseHookVerified:true,signedMetaCallbacksVerified:true,
  consentAndHandsetVerified:true,stagingOwnerApproved:true,
 });
 assert.equal(r.verdict,F11_DECISION_HOLD);
 assert.equal(r.maySendOtp,false);
 assert.equal(r.mayDeployProduction,false);
 assert.equal(r.sourceOnly,true);
});
test("F11-R26 no unsafe physical endpoint changes in F11 policy module",()=>{
 const s=readFileSync("scripts/mvp/launch/f11-callback-perimeter-policy.mjs","utf8");
 for(const word of ["fetch(","POST(","writeFile","process.env","WHATSAPP_ACCESS_TOKEN","service_role"]){
  assert.equal(s.includes(word),false);
 }
});
test("F11-R27 owner route and staff routes never match callback allowlist",()=>{
 const urls=[root+"/api/vox/v1/staff/login",root+"/api/vox/v1/owner-workspaces",
  root+"/api/vendor/onboarding/complete",root+"/api/health"];
 for(const url of urls)assert.equal(isExactProviderCallbackUrl(url,"meta")||isExactProviderCallbackUrl(url,"supabase"),false);
});
test("F11-R28 signed webhook routes never authorized just by HTTPS",()=>{
 const r=assessF11CallbackEvidence({supabaseHookUrl:supabase,metaCallbackUrl:meta});
 assert.equal(r.maySendOtp,false);
 assert.ok(r.blockers.includes("SIGNED_SUPABASE_AUTH_HOOK_NOT_LIVE_CERTIFIED"));
 assert.ok(r.blockers.includes("SIGNED_META_INBOUND_CALLBACKS_NOT_LIVE_CERTIFIED"));
});
