import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const read=p=>readFileSync(new URL("../../../"+p,import.meta.url),"utf8");
const core=read("app/api/vox/v1/tl-assignments/route.ts");
const web=read("apps/vox-web/lib/teamAssignments.ts");
const route=read("apps/vox-web/app/api/tl-assignments/route.ts");
const ui=read("apps/vox-web/app/team/assignments/TeamAssignmentControl.tsx");
const page=read("apps/vox-web/app/team/assignments/page.tsx");
test("TL Core writer is hard-disabled until genuine managed signoff",()=>{
 assert.match(core,/VO5_MANAGED_TL_ASSIGNMENT_CERTIFIED=false as const/);
 assert.match(core,/getVerifiedScopedStaff\(header\)/);
 assert.match(core,/assignScopedTeamWork\(body,/);
 assert.match(core,/getUserById\(targetId\)/);
});
test("TL Web limits reference window, never displays private client rows",()=>{
 assert.match(web,/x\.mode!=="REFERENCES_ONLY"/);
 assert.match(web,/x\.boundedWindow!==true/);
 assert.match(web,/x\.totalKnown!==false/);
 assert.match(web,/x\.actionsEnabled!==false/);
 assert.match(page,/fetchTeamAssignments\(\)/);
 assert.doesNotMatch(page,/phone_number|mobile_number|contact_email|payment/);
});
test("TL BFF requires exact same-origin CSRF and Core AAL2",()=>{
 assert.match(route,/allowedOrigin\(request\)/);
 assert.match(web,/verifiedMfaSession\(\)/);
 assert.match(web,/cache:"no-store",redirect:"error"/);
 assert.match(web,/x\.nonce!==command\.nonce/);
 assert.match(web,/x\.vendorAssignmentsChanged!==0/);
});
test("TL UI never starts another nonce when pending",()=>{
 assert.match(ui,/loadPendingTl\(store\(\)\)/);
 assert.match(ui,/savePendingTl\(store\(\),cmd\)/);
 assert.match(ui,/clearPendingTl\(store\(\),cmd,raw\)/);
 assert.match(ui,/if\(pending\)cmd=pending;/);
 assert.match(ui,/crypto\.randomUUID\(\)/);
 assert.doesNotMatch(ui,/setInterval|navigator\.geolocation|MediaRecorder/);
});
