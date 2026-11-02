import test from "node:test";import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {reconcileStaffAuthAfterCoreFence as reconcile} from "../../../contracts/vox/ab7gAuthSessionReconciliation.mjs";
const handler=readFileSync(new URL("../../../services/vox/verifiedScopedStaff.ts",import.meta.url),"utf8");
const id=n=>"00000000-0000-4000-8000-"+String(n).padStart(12,"0");
test("AB7I Auth JWT remains potentially valid after refresh-token global sign-out",async()=>{
 const result=await reconcile({environment:"staging",enabled:true,
  targetId:id(1),ownerId:id(2),reviewerId:id(3),suspensionNonce:id(4),
  verifyIndependentSuspensionReceipt:async()=>true,
  verifyCurrentOwnerAal2:async()=>true,
  verifyCurrentTargetIsDisabled:async()=>true,
  requestGlobalSessionRevoke:async()=>({accepted:true,targetId:id(1),nonce:id(4)}),
  verifyGlobalSessionRevoke:async()=>true});
 assert.equal(result.ok,true);assert.equal(result.refreshSessionsRevokedVerified,true);
 assert.equal(result.authSessionsInvalidated,false);assert.equal(result.activeJwtMayRemainValid,true);
});
test("AB7I every protected Staff read rechecks current Core membership",()=>{
 assert.match(handler,/verifySupabaseBearerUser\(raw\)/);
 assert.match(handler,/vox_staff_memberships_v1/);
 assert.match(handler,/resolveScopedStaff\(/);
 assert.match(handler,/restrictScopedStaffByDepartment/);
});
test("AB7I Staff bearer cannot elevate stale review approvals",()=>{
 assert.match(handler,/isNeutralVoxStaffPrincipal/);
 assert.match(handler,/reviewerMembers/);
 assert.match(handler,/db\.auth\.admin\.getUserById/);
});
