import test from "node:test";import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const route=readFileSync(new URL("../../../app/api/vox/v1/staff-directory/route.ts",import.meta.url),"utf8");
test("RC1 private Staff roster uses one existing Core Superadmin, no second auth",()=>{
 assert.match(route,/verifyVoxOwnerBearer/);
 assert.match(route,/vox_staff_memberships_v1/);
 assert.doesNotMatch(route,/auth\.admin\.createUser|signUp\(/);
});
test("RC1 staff directory rechecks genuine Owner AAL2 after both membership+team reads",()=>{
 const members=route.indexOf('from("vox_staff_memberships_v1")');
 const teams=route.indexOf('from("vox_staff_teams_v1")');
 const retry=route.lastIndexOf("await verifyVoxOwnerBearer(");
 const ret=route.indexOf('schema:"qf.vox.staff.directory.preview.v1"');
 assert.ok(members>0&&teams>members&&retry>teams&&ret>retry);
 assert.match(route,/OWNER_AUTH_REVOKED_DURING_DIRECTORY_READ/);
 assert.match(route,/currentOwner!==owner/);
});
