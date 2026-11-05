import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {resolve,dirname} from "node:path";
import {fileURLToPath} from "node:url";
import {readBoundedOwnerMfaJson} from "../lib/readBoundedOwnerMfaJson.ts";
const root=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const read=p=>readFileSync(resolve(root,p),"utf8");
const url="https://vox.quickfurno.in/api/auth/mfa";
const req=(v,headers={})=>new Request(url,{method:"POST",
 headers:{"content-type":"application/json",...headers},body:v});
test("P3-A1 real size within 256 bytes and no Content-Length parses",async()=>{
 const json=JSON.stringify({code:"123456"});
 assert.deepEqual(await readBoundedOwnerMfaJson(req(json)),{
  ok:true,value:{code:"123456"}
 });
});
test("P3-A2 fake low Content-Length cannot bypass actual streamed bytes",async()=>{
 const json=JSON.stringify({code:"123456",junk:"x".repeat(512)});
 assert.deepEqual(await readBoundedOwnerMfaJson(req(json,{"content-length":"4"})),
  {ok:false,reason:"too_large"});
});
test("P3-A3 oversized/zero/negative/nonnumeric lengths fail closed before Auth",async()=>{
 for(const declared of ["0","-1","1.2","NaN","10000000000000000000000","999"]){
  assert.deepEqual(await readBoundedOwnerMfaJson(req("{}",{"content-length":declared})),
   {ok:false,reason:"too_large"});
 }
});
test("P3-A4 missing, malformed JSON/UTF8, trailing text, and zero limit fail closed",async()=>{
 assert.deepEqual(await readBoundedOwnerMfaJson(new Request(url,{method:"POST"})),
  {ok:false,reason:"invalid"});
 assert.deepEqual(await readBoundedOwnerMfaJson(req('{"code":')),
  {ok:false,reason:"invalid"});
 assert.deepEqual(await readBoundedOwnerMfaJson(req("{}"),0),
  {ok:false,reason:"invalid"});
 assert.deepEqual(await readBoundedOwnerMfaJson(req("{} 123")),
  {ok:false,reason:"invalid"});
 const malformed=new Request(url,{method:"POST",body:new Uint8Array([0xff,0xfe])});
 assert.deepEqual(await readBoundedOwnerMfaJson(malformed),
  {ok:false,reason:"invalid"});
});
test("P3-A5 both owner MFA challenge and enrollment confirmation bound body BEFORE Auth",()=>{
 for(const file of ["app/api/auth/mfa/route.ts","app/api/auth/mfa/confirm/route.ts"]){
  const code=read(file);
  assert.match(code,/VOX_STAFF_PORTAL_ENABLED!=="staging"/);
  assert.match(code,/allowedOrigin\(request\)/);
  assert.match(code,/readBoundedOwnerMfaJson\(request,256\)/);
  assert.doesNotMatch(code,/await request\.text\(\)|await request\.json\(\)/);
  assert.match(code,/Object\.keys\((?:parsed|data)\)\.sort\(\)\.join\(","\)/);
  assert.match(code,/challengeAndVerify\(/);
  assert.ok(code.indexOf("readBoundedOwnerMfaJson(request,256)")<
   code.indexOf("const auth=await staffAuth()"));
  assert.doesNotMatch(code,/console\.log\(|SUPABASE_SERVICE_ROLE_KEY|sendMessage\(/);
 }
});
test("P3-A6 existing MFA verification must be real AAL2 and not app metadata",()=>{
 const code=read("lib/auth.ts");
 assert.match(code,/auth\.auth\.getUser\(\)/);
 assert.match(code,/auth\.auth\.getSession\(\)/);
 assert.match(code,/getAuthenticatorAssuranceLevel\(\)/);
 assert.match(code,/currentLevel!=="aal2"/);
 assert.doesNotMatch(code,/user_metadata.*Superadmin|mfa_verified_cookie/);
});
