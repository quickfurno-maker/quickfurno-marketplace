import test from "node:test";
import assert from "node:assert/strict";
import {validateOwnerAccessGuard} from "./rc73-staging-owner-guard-smoke.mjs";
test("seven actual Owner routes require Cloudflare identity, no write-capable method",async()=>{
 const calls=[];
 const r=await validateOwnerAccessGuard("http://127.0.0.1:3325/",async(url,opts)=>{
  calls.push({url,opts});return {status:403};
 });
 assert.equal(r.checks,7);assert.equal(r.releaseGo,false);
 assert.equal(r.authenticatedOwnerVerified,false);
 assert.equal(r.identityBypass,false);
 assert.ok(calls.every(x=>x.opts.method==="GET"&&!x.opts.headers.authorization));
 assert.ok(calls.some(x=>x.url.endsWith("/api/auth/mfa")));
});
test("unexpected status, remote origin, malformed host, token-bearing URL all fail closed",async()=>{
 for(const origin of ["https://vox.quickfurno.in/","http://localhost:3325/",
  "http://127.0.0.1:3327/","http://127.0.0.1:3325/login",
  "http://user:password@127.0.0.1:3325/"]){
  await assert.rejects(validateOwnerAccessGuard(origin,async()=>({status:403})),
   /RC73_OWNER_READONLY_PROBE_INVALID_OR_EXPOSED/);
 }
 await assert.rejects(validateOwnerAccessGuard("http://127.0.0.1:3325/",async()=>({status:200})),
  /RC73_OWNER_READONLY_PROBE_INVALID_OR_EXPOSED/);
});
