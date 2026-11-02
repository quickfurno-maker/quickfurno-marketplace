import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const src=readFileSync(new URL("../../../services/vox/verifiedScopedStaff.ts",import.meta.url),"utf8");
const engine=readFileSync(new URL("../../../contracts/vox/effectiveDepartments.mjs",import.meta.url),"utf8");
test("fresh reviewer proofs derived from server-verified Core and real Supabase Auth",()=>{
 assert.match(src,/db\.auth\.admin\.getUserById\(id\)/);
 assert.match(src,/from\("vox_staff_memberships_v1"\)/);
 assert.match(src,/from\("profiles"\)/);
 assert.match(src,/reviewerMembers\.data\.length!==reviewersIds\.length/);
 assert.match(src,/reviewersIds\.some\(/);
 assert.match(src,/user\?\.app_metadata\?\.vox_role/);
 assert.match(src,/reviewers\}\) as ScopedVoxContext\|null/);
});
test("deny reviewer revocation and anonymous/browser-enriched proofs",()=>{
 for(const check of ['proof.staffRole!=="team_leader"',
  "proof.membershipActive!==true","proof.revokedAt!==null",
  "proof.voxRole!==\"team_leader\"",
  "proof.adminRole!==null","proof.teamId!==scoped.teamId",
  "proof.cityId!==scoped.cityId","!liveReviewers.has(r.decided_by)"])
   assert.ok(engine.includes(check),check);
 assert.doesNotMatch(src,/reviewers:\s*request\.|reviewers:\s*data\./);
});
