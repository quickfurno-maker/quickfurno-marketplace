import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const route=name=>readFileSync(new URL("../../../app/api/vox/v1/"+name+"/route.ts",import.meta.url),"utf8");
test("AB7N Riya scoped client metadata rechecks current Auth, department and grant AFTER all reads",()=>{
 const source=route("riya-client-cases");
 const projection=source.indexOf("projectScopedClientCaseList({");
 const lastAuth=source.lastIndexOf("await getVerifiedScopedStaff(");
 const lastGrant=source.lastIndexOf('db.from("vox_staff_object_scopes_v1")');
 const response=source.lastIndexOf("return send(projected,200)");
 assert.ok(projection>0&&lastAuth>projection&&lastGrant>lastAuth&&response>lastGrant);
 assert.match(source,/CLIENT_CASE_AUTH_REVOKED_DURING_READ/);
 assert.match(source,/CLIENT_CASE_OBJECT_GRANT_REVOKED_DURING_READ/);
 assert.match(source,/current\.verifiedDepartments\?\.includes\("client_success"\)/);
 assert.match(source,/current\.teamId!==scope\.teamId/);
 assert.match(source,/renewed\.data\.length!==grants\.data\.length/);
});
test("AB7N team chat revalidates team, city, role and AAL2 before content response",()=>{
 const source=route("staff-chat");
 const read=source.indexOf('from("vox_staff_team_messages_candidate_v1")');
 const recheck=source.indexOf('const current=await getVerifiedScopedStaff(');
 const response=source.indexOf("schema:\"qf.vox.staff.team.chat.preview.v1\"");
 assert.ok(read>0&&recheck>read&&response>recheck);
 assert.match(source,/TEAM_CHAT_SCOPE_REVOKED_DURING_READ/);
 assert.match(source,/current!\.teamId!==s!\.teamId/);
 assert.match(source,/current!\.cityId!==s!\.cityId/);
 assert.match(source,/!canChat\(current\)/);
});
