// VOX-11 release-adversarial QA. Safe to run on PRs and schedule.
// A passing source test NEVER implies live Staging / production launch.
import {execFileSync} from "node:child_process";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import assert from "node:assert/strict";
const root=resolve(import.meta.dirname,"../../.."),read=p=>readFileSync(resolve(root,p),"utf8");
const checks=[
 ["scripts/mvp/vox/validate-vox-00-adapters.mjs",20],
 ["scripts/mvp/vox/validate-vox-02-overview.mjs",13],
 ["scripts/mvp/vox/validate-vox-03-scope.mjs",33],
 ["scripts/mvp/vox/validate-vox-04-desk.mjs",28],
 ["scripts/mvp/vox/validate-vox-05-crm.mjs",26],
 ["scripts/mvp/vox/validate-vox-05-studios.mjs",12],
 ["scripts/mvp/vox/validate-vox-05-approval-source.mjs",15],
 ["scripts/mvp/vox/validate-vox-07-finalizer-source.mjs",38],
 ["scripts/mvp/vox/validate-vox08-source.mjs",16],
 ["scripts/mvp/vox/validate-vox-10-aos.mjs",17],
];
let count=0;
for(const [path,expected] of checks){
 const stdout=execFileSync(process.execPath,[resolve(root,path)],{cwd:root,encoding:"utf8",timeout:90000});
 const last=stdout.trim().split(/\r?\n/).at(-1)??"";
 if(!last.includes(" "+expected+"/"+expected))throw new Error("SOURCE_COUNT_MISMATCH: "+path+": "+last);
 count+=expected;
 console.log("PASS "+path+" = "+expected);
}
if(count!==218)throw Error("SOURCE_TOTAL_MISMATCH "+count);
const manifest=JSON.parse(read("docs/vox/VOX-11-RELEASE-MANIFEST.json"));
assert.equal(manifest.releaseStatus,"HOLD");
for(const [gate,pass] of Object.entries(manifest.criticalGates)){
 if(pass!==false)throw Error("UNSUPPORTED_LAUNCH_CLAIM: "+gate);
}
const ownerRoutes=["app/api/vox/v1/aos-health/route.ts","app/api/vox/v1/staff-grants/route.ts"];
const staffRoutes=["app/api/vox/v1/acquisition/route.ts","app/api/vox/v1/vendor360/route.ts","app/api/vox/v1/desk/route.ts"];
const owner=ownerRoutes.map(read).join("\n"),staff=staffRoutes.map(read).join("\n");
assert.match(owner,/verifyVoxOwnerBearer/);
assert.match(staff,/getVerifiedScopedStaff/);
assert.match(owner,/VOX_AOS_HEALTH_ENABLED!=="staging"/);
assert.match(owner,/VOX_STAFF_GRANTS_ENABLED!=="staging"/);
for(const route of [...ownerRoutes,...staffRoutes]){
 const src=read(route);
 assert.match(src,/no-store/);
 if(/aos-health|acquisition|vendor360|desk/.test(route)){
  assert.doesNotMatch(src,/sendWhatsApp|lead_assignments\)\.insert|wallet\.update/);
 }
}
assert.doesNotMatch(read("app/api/vox/v1/staff-grants/route.ts"),/process\.env\.SUPABASE_SERVICE_ROLE_KEY/);
assert.match(read("services/vox/verifiedStaffBearer.ts"),/auth\.getUser\(token\)/);
assert.match(read("supabase/migrations/20261014050000_vox_v1_team_leader_review_policy.sql"),/VOX_TEAM_LEADER_ESCALATION_DENIED/);
assert.match(read("contracts/vox/aosHealth.mjs"),/AGNI|agni:"NOT_CONNECTED"/i);
console.log("VOX11_QA_SOURCE_AND_RELEASE_HOLD_PASS "+count+"/218; releaseStatus=HOLD");
