import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync,readdirSync} from "node:fs";
import {createHash} from "node:crypto";
import {assessL8Candidate} from "../../../contracts/vox/l8MigrationIdentityGate.mjs";
const digest=s=>createHash("sha256").update(s).digest("hex");
const history=[{version:"20261001010000",digest:digest("immutable") }];
const identity={neutralStaff:true,coreProfileRole:"staff",currentAal:"aal2",
  superadminInherited:false};
const candidate=[{version:"20261016040000",
 path:"ops/vox/sql-candidates/20261016040000_vox08n_transactional_work_notification_outbox_candidate.sql",
 digest:digest("candidate")}];
const assess=(p={})=>assessL8Candidate({stagingHistory:history,
 productionHistory:history,candidates:candidate,staffIdentity:identity,...p});
test("matching metadata and neutral AAL2 yield source-only, NEVER staging approval",()=>{
 const r=assess();assert.equal(r.ok,true);assert.equal(r.sourcePreparationComplete,true);
 assert.equal(r.protectedStagingPermitted,false);assert.equal(r.productionPermitted,false);
 assert.equal(r.requiresIndependentFirstTeamLeader,true);
});
test("shared version with changed SQL digest is independent-DBA hold",()=>{
 const r=assess({productionHistory:[{...history[0],digest:digest("tampered")}]});
 assert.equal(r.ok,false);assert.equal(r.reason,"HISTORICAL_MIGRATION_DIVERGENCE_REQUIRES_DBA");
 assert.equal(r.historicalDrift.changedBodies,1);
});
test("missing or extra migrations refuse parity",()=>{
 assert.equal(assess({productionHistory:[{version:"20261001020000",digest:digest("x")}]}).ok,false);
 assert.equal(assess({stagingHistory:[]}).ok,false);
});
test("reject alternative SQL versions, migration collisions and traversal",()=>{
 assert.equal(assess({candidates:[...candidate,{...candidate[0],path:"ops/vox/sql-candidates/a.sql"}]}).ok,false);
 assert.equal(assess({candidates:[{...candidate[0],version:history[0].version}]}).ok,false);
 assert.equal(assess({candidates:[{...candidate[0],path:"supabase/migrations/20261016040000_unsafe.sql"}]}).ok,false);
});
test("reject inherited Core admin and missing genuine AAL2",()=>{
 assert.equal(assess({staffIdentity:{...identity,coreProfileRole:"admin"}}).ok,false);
 assert.equal(assess({staffIdentity:{...identity,currentAal:"aal1"}}).ok,false);
 assert.equal(assess({staffIdentity:{...identity,superadminInherited:true}}).ok,false);
});
test("actual source keeps unapproved SQL out of managed migration directory",()=>{
 const root=new URL("../../../",import.meta.url);
 const dirs=["20261016040000_vox08n_transactional_work_notification_outbox_candidate.sql",
 "20261016050000_vox08r_internal_outbox_metrics_candidate.sql"];
 for(const name of dirs){
  const file=readFileSync(new URL("ops/vox/sql-candidates/"+name,root),"utf8");
  assert.match(file,/SOURCE[- ]ONLY|UNAPPROVED SOURCE CANDIDATE/);
  assert.ok(digest(file).length===64);
 }
 const managed=readdirSync(new URL("supabase/migrations/",root));
 for(const name of dirs)assert.equal(managed.includes(name),false);
 const s=readFileSync(new URL("services/vox/verifiedScopedStaff.ts",root),"utf8");
 assert.match(s,/isNeutralVoxStaffPrincipal/);
 assert.match(s,/jwt\.aal\s*!==\s*"aal2"/);
 assert.doesNotMatch(s,/profile\.data\?\.role\s*===\s*"admin"\s*\?\s*scoped/);
});