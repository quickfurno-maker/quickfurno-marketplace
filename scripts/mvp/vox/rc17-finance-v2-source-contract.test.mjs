import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {resolve,dirname} from "node:path";
const root=resolve(dirname(fileURLToPath(import.meta.url)),"../../..");
const read=p=>readFileSync(resolve(root,p),"utf8");
const sql=read("ops/vox/rc17-review-candidates/20261031001000_rc17_razorpay_v2_authority_REVIEW_ONLY.sql");
const core=read("services/vendorPackagePaymentService.ts");
const fixture=read("scripts/mvp/vox/validate-vox-rc17-razorpay-v2-real-pg17.mjs");
const functions=[
 ["qf_claim_vendor_package_razorpay_order_v2","uuid,uuid,text"],
 ["qf_release_vendor_package_razorpay_order_claim_v2","uuid,uuid,text"],
 ["qf_bind_vendor_package_razorpay_order_v2","uuid,text,bigint,text,uuid,text"],
 ["qf_activate_vendor_package_order_v2","uuid,text,text"],
 ["qf_mark_vendor_package_payment_failed_v2","uuid,text,text"],
];
test("every payment V2 Core RPC has a separately versioned review-only SQL authority",()=>{
 assert.match(sql,/REVIEW ONLY \/ UNINSTALLED/);
 assert.match(sql,/BEGIN;[\s\S]*COMMIT;/);
 assert.match(sql,/ADD COLUMN IF NOT EXISTS provider_mode text/);
 assert.match(sql,/provider_mode IN \('test','live'\)/);
 for(const [fn,sig] of functions){
  assert.match(core,new RegExp('["\x27]'+fn+'["\x27]'));
  assert.match(sql,new RegExp('create or replace function public\\.'+fn+'\\('));
  assert.ok(sql.includes(fn+'('+sig+')'),fn+" exact signature absent");
  assert.ok(sql.includes('revoke all on function public.'+fn+'('+sig+') from public, anon, authenticated;'),fn+" browser revoked");
  assert.ok(sql.includes('grant execute on function public.'+fn+'('+sig+') to service_role;'),fn+" Core only");
 }
 assert.equal((sql.match(/create or replace function public\.qf_[a-z_]+_v2\(/g)||[]).length,5);
 assert.equal((sql.match(/p_provider_mode text/g)||[]).length,5);
});
test("V2 persistence and replay semantics remain fail-closed",()=>{
 for(const text of ["PROVIDER_ORDER_CREATION_UNCERTAIN","RAZORPAY_V2_MODE_REQUIRED",
  "RAZORPAY_V2_BOUND_MODE_MISMATCH","RAZORPAY_V2_BIND_TOKEN_OR_MODE_MISMATCH",
  "RAZORPAY_V2_CLAIM_RELEASE_DENIED","PACKAGE_ORDER_LEDGER_DRIFT",
  "PACKAGE_CREDIT_GRANT_NOT_APPLIED","RC17_V2_BROWSER_RPC_AUTHORITY_EXPOSED"])
   assert.ok(sql.includes(text),text);
 assert.doesNotMatch(sql,/as \$\s*\n|^\$;$/m,"legacy invalid delimiter copied");
 assert.doesNotMatch(sql,/grant execute[^;]*to authenticated|grant all[^;]*to authenticated/i);
 assert.match(sql,/provider_order_request_token is not null then\s+raise exception 'PROVIDER_ORDER_CREATION_UNCERTAIN'/);
});
test("isolated Postgres runner exercises real five-RPC transaction and no provider",()=>{
 for(const marker of ["postgres:17-alpine","CONCURRENT_CLAIM","UNCERTAIN_SAME_TOKEN_RETRY",
 "WRONG_BIND_TOKEN","PAYMENT_CROSS_MODE","DUPLICATE_CREDIT",
 "RELEASE_REPLAY","FAILED_CROSS_MODE","BROWSER_RPC_EXPOSED",
 "VOX_RC17_REAL_PG17_RAZORPAY_V2_PASS"]) assert.ok(fixture.includes(marker),marker);
 assert.match(fixture,/MANAGED_CREDENTIAL_DENIED_/);
 assert.match(fixture,/--pull","never"/);
 assert.match(fixture,/docker\(\["rm","-f","-v",name\]\)/);
});
