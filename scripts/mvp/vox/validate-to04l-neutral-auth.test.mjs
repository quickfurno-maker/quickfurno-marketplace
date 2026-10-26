import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const read=p=>readFileSync(new URL(p,import.meta.url),"utf8");
const evidence=JSON.parse(read("../../../ops/vox/certification/TO04L-LIVE-AUTH-NEUTRAL-TRIGGER.json"));
test("real staging/production Auth trigger creates only vendor or neutral Core profile",()=>{
 assert.equal(evidence.schema,"qf.vox.to04l.auth-neutral-profile-trigger.v1");
 assert.equal(evidence.containsUserRows,false);
 for(const env of ["staging","production"]){
  const e=evidence.environments[env];
  assert.equal(e.triggerName,"on_auth_user_created");
  assert.equal(e.triggerFunction,"public.handle_new_user()");
  assert.equal(e.selectsServerAppMetadataKey,"qf_principal");
  assert.equal(e.vendorProfileRole,"vendor");
  assert.equal(e.otherClassificationRole,null);
  assert.equal(e.profileRoleNullable,true);
  assert.equal(e.writesAdminRole,false);
  assert.deepEqual(e.readsUserMetadataOnlyFor,["full_name","phone"]);
 }
});
test("neutral profile never becomes Staff without real Supabase Auth + AAL2 and exact grants",()=>{
 const reader=read("../../../services/vox/verifiedScopedStaff.ts");
 const principal=read("../../../contracts/vox/neutralStaffPrincipal.mjs");
 const scope=read("../../../contracts/vox/effectiveDepartments.mjs");
 assert.match(reader,/verifySupabaseBearerUser\(raw\)/);
 assert.match(reader,/jwt\.aal!=="aal2"/);
 assert.match(principal,/meta\.qf_principal==='vox_staff'/);
 assert.match(principal,/profile\.role!==null/);
 assert.match(reader,/vox_staff_memberships_v1/);
 assert.match(reader,/restrictScopedStaffByDepartment/);
 assert.match(scope,/r\.decided_by===r\.requested_by/);
});
test("trigger snapshot is not independent staff activation or migration approval",()=>{
 assert.equal(evidence.realStageRun,false);
 assert.equal(evidence.securityReviewerApproved,false);
 assert.equal(evidence.stagingSchemaInstalled,false);
 assert.equal(evidence.releaseAuthorized,false);
 const sql=read("./fixtures/vox-to04l-neutral-auth-trigger-pg17.sql");
 assert.match(sql,/v_principal='vendor'/);
 assert.match(sql,/v_role:=null/);
 assert.match(sql,/PUBLIC_METADATA_GRANTED_ADMIN_ROLE/);
});
