import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
const root=resolve(import.meta.dirname,"../../..");
const read=p=>readFileSync(resolve(root,p),"utf8");
const pre=read("ops/vox/tests/vox_managed_staging_preflight_20261030.sql");
const post=read("ops/vox/tests/vox_managed_staging_postflight_20261030.sql");
let count=0;const check=(name,fn)=>{fn();count++;console.log("PASS",name)};
for(const [name,s] of [["preflight",pre],["postflight",post]]){
 check(name+" Staging-only target",()=>assert.match(s,/uckafzuochmbvtiodmcl/));
 check(name+" contains no SQL mutations",()=>assert.doesNotMatch(s,/^\s*(alter|drop|create|truncate|update|delete|insert|grant|revoke|do\s+\$|commit|begin)\b/im));
 check(name+" is fail-closed",()=>assert.match(s,/CASE[\s\S]+END release_decision/i));
}
check("P0-6 ledger version and function predicates",()=>{assert.match(pre,/20261029160138/);assert.match(pre,/is_active is true/);});
check("live VOX object and grant drift guards",()=>{assert.match(pre,/HOLD_VOX_OBJECT_DRIFT/);assert.match(pre,/HOLD_FUNCTION_GRANT_DRIFT/);});
check("migration fanout guard 59/22",()=>{assert.match(pre,/admin_policies<>59/);assert.match(pre,/vendor_policies<>22/);});
check("MFA requires distinct verified user identities",()=>assert.match(pre,/count\(distinct user_id\)/));
check("postflight requires all 39 tables force RLS",()=>{assert.match(post,/vox_tables<>39/);assert.match(post,/forced_rls<>39/);});
check("both browser roles have no direct table privileges",()=>{for(const role of ["anon","authenticated"])for(const op of ["SELECT","INSERT","UPDATE","DELETE"])assert.ok(post.includes("has_table_privilege('"+role+"',oid,'"+op+"')"));});
check("no fabricated approval",()=>assert.match(pre,/REQUIRES_INDEPENDENT_DBA_APPSEC_REVIEW_AND_SIGNED_OWNER_RELEASE/));
console.log("VOX_STAGING_GUARDS_SOURCE_PASS "+count+"/"+count);
