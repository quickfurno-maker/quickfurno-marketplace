import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync,readdirSync} from "node:fs";
import {resolve,dirname} from "node:path";
import {fileURLToPath} from "node:url";
const root=resolve(dirname(fileURLToPath(import.meta.url)),"../../..");
const read=p=>readFileSync(resolve(root,p),"utf8");
test("historical finance migration remains immutable; V2 not installed",()=>{
 const old=read("supabase/migrations/20260912010000_qf_vendor_package_razorpay_testmode.sql");
 const v2=read("ops/vox/rc17-review-candidates/20261031001000_rc17_razorpay_v2_authority_REVIEW_ONLY.sql");
 assert.match(old,/as \$(?=\r?\n)/);
 assert.match(v2,/REVIEW ONLY \/ UNINSTALLED/);
 assert.match(v2,/payment_provider is distinct from 'not_connected'/);
 assert.doesNotMatch(v2,/as \$(?=\r?\n)|^\$;$/m);
 assert.equal(readdirSync(resolve(root,"supabase/migrations")).some(x=>/rc1[789]_razorpay|rc1[789]_eod/.test(x)),false);
});
test("real PG17 harness includes concurrent credit grant and NULL-provider negatives",()=>{
 const pg=read("scripts/mvp/vox/validate-vox-rc17-razorpay-v2-real-pg17.mjs");
 assert.match(pg,/Promise\.all\(\[\s*activate\(testOrder,"pay_test","test"\)/);
 assert.match(pg,/CONCURRENT_EXACT_ONCE_CREDIT/);
 assert.match(pg,/NULL_PROVIDER_CANNOT_CLAIM/);
 assert.match(pg,/provider_calls=0/);
 assert.match(pg,/--pull","never"/);
});
test("signing database review can never become a service-role-only fake signature",()=>{
 const sql=read("ops/vox/rc17-review-candidates/20261031002000_rc17_eod_publication_authority_REVIEW_ONLY.sql");
 const route=read("app/api/vox/v1/official-eod-publish/route.ts");
 assert.match(sql,/REVOKE ALL ON FUNCTION public\.qf_vox_ab7g_official_eod_publish_candidate_v1/);
 assert.match(sql,/service_role/);
 assert.match(route,/VERIFIED_APPROVAL_WRITER_INSTALLED=false/);
});
