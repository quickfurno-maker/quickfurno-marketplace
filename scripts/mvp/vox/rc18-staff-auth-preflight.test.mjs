import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {resolve,dirname} from "node:path";
import {fileURLToPath} from "node:url";
const root=resolve(dirname(fileURLToPath(import.meta.url)),"../../..");
const source=readFileSync(resolve(root,"services/vox/verifiedStaffBearer.ts"),"utf8");
const core=readFileSync(resolve(root,"services/vox/rc8PgVendorConversationOperator.ts"),"utf8");
test("real GoTrue bearer, not caller JWT/body claims, preconditions Staff authorization",()=>{
 assert.match(source,/verifySupabaseBearerUser\(token\)/);
 assert.match(source,/!aal2ClaimMatches\(token,user\.id\)/);
 assert.match(source,/user\.app_metadata\?\.qf_principal!=="vox_staff"/);
 assert.match(source,/user\.app_metadata\?\.vox_role!=="operations_manager"/);
 assert.match(source,/user\.app_metadata\?\.admin_role!=null/);
 assert.match(source,/expiresAtMs<=Date\.now\(\)/);
});
test("current profile, Staff membership, revocation, team and city are re-read",()=>{
 assert.match(source,/from\("profiles"\)\.select\("role,is_active"\)/);
 assert.match(source,/profile\.data\.role!==null/);
 assert.match(source,/from\("vox_staff_memberships_v1"\)/);
 assert.match(source,/\.eq\("staff_role","operations_manager"\)/);
 assert.match(source,/m\.revoked_at!==null/);
 assert.match(source,/Date\.parse\(m\.expires_at\)<=Date\.now\(\)/);
 assert.match(source,/from\("vox_staff_teams_v1"\)/);
 assert.match(source,/team\.data\.is_active!==true/);
 assert.match(source,/cityId:team\.data\.city_id/);
});
test("Staff Auth preflight does not enable production Core write",()=>{
 assert.match(core,/RC8_CORE_WRITER_INSTALLED=false/);
 assert.match(core,/RC8_CORE_RELEASE_GATE=Object\.freeze/);
 assert.match(core,/allConsentMutationPathsSerialized:false/);
 assert.match(core,/JOIN auth\.users u ON u\.id=m\.auth_user_id/);
 assert.match(core,/CORE_WRITER_RELEASE_GATE_CLOSED/);
});
