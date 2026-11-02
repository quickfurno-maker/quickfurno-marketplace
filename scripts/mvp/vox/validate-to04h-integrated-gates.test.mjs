import test from "node:test";
import assert from "node:assert/strict";
import {existsSync,readFileSync} from "node:fs";
import {resolve} from "node:path";
import {inspect} from "./verify-to04g-migration-history.mjs";
import {assess} from "./check-to04c-schema-readiness.mjs";
import {deriveCanonicalCityVendorIds} from "../../../contracts/vox/canonicalZoneGate.mjs";
const root=resolve(import.meta.dirname,"../../..");
const read=p=>readFileSync(resolve(root,p),"utf8");
test("integrated candidate retains immutable DB drift and no unchecked schema release",()=>{
 const mig=inspect(JSON.parse(read("ops/vox/certification/TO04G-READONLY-MIGRATION-METADATA.json")));
 const schema=assess(JSON.parse(read("ops/vox/certification/TO04C-LIVE-SCHEMA-EVIDENCE.json")));
 assert.equal(mig.ready,false);assert.equal(schema.ready,false);
 assert.equal(mig.counts.sharedExactVersions,34);
 assert.equal(mig.counts.shiftedNameVersionPairs,28);
 assert.equal(mig.counts.duplicateNamesStaging,2);
});
test("integrated candidate uses only Core granted vendor zones and current AAL2",()=>{
 const route=read("app/api/vox/v1/work-queue/route.ts");
 assert.match(route,/deriveCanonicalCityVendorIds\(/);
 assert.match(route,/VOX_DEPARTMENT_ENFORCEMENT_ENABLED/);
 assert.match(route,/getVerifiedScopedStaff\(request\.headers\.get\("authorization"\)\)/);
 const id=n=>"00000000-0000-4000-8000-"+String(n).padStart(12,"0");
 const r=deriveCanonicalCityVendorIds({cityId:id(1),grantedVendorIds:[id(2)],
  vendors:[{id:id(2),service_zone_id:id(3)}],
  zones:[{id:id(3),city_id:id(1),is_active:true}]});
 assert.deepEqual(r,{ok:true,ids:[id(2)]});
});
test("actual Core work candidate has serialized membership capacity and SQL-native denial proof",()=>{
 const sql=read("ops/vox/sql-candidates/20261015030000_vox_to02e_work_queue_atomic_candidate.sql");
 assert.match(sql,/VOX_WORK_STAFF_CAPACITY_REACHED/);
 assert.match(sql,/vox_staff_memberships_v1\s+where auth_user_id=p_actor for update/);
 assert.match(sql,/w\.source_kind='prospect'/);
 assert.match(sql,/w\.source_kind='vendor'/);
 assert.match(sql,/w\.source_kind='support_thread'/);
 const denial=read("scripts/mvp/vox/fixtures/vox-to04f-capacity-denial-assertions.sql");
 assert.match(denial,/get stacked diagnostics error_message=MESSAGE_TEXT/);
 assert.match(denial,/OVER_CAPACITY_CLAIM_ACCEPTED/);
 assert.match(denial,/DENIED_CLAIM_APPENDED_AUDIT/);
});
test("no second Admin, no dual department mutation RPC route, no actual staging grants",()=>{
 assert.equal(existsSync(resolve(root,"app/api/vox/v1/staff-department-actions/route.ts")),false);
 assert.ok(existsSync(resolve(root,"app/api/vox/v1/staff-departments/route.ts")));
 const hold=JSON.parse(read("ops/vox/certification/TO04A-HOLD.json"));
 assert.equal(hold.status,"HOLD");
 assert.equal(hold.bootstrapIndependentReviewer,null);
 assert.equal(hold.productionActivationAuthorized,false);
});
