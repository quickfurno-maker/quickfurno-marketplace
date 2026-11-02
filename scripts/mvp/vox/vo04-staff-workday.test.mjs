import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const read=path=>readFileSync(new URL("../../../"+path,import.meta.url),"utf8");
const bridge=read("apps/vox-web/lib/staffTime.ts");
const api=read("apps/vox-web/app/api/staff-time/route.ts");
const controls=read("apps/vox-web/app/team/workday/WorkdayControls.tsx");
const page=read("apps/vox-web/app/team/workday/page.tsx");
const team=read("apps/vox-web/app/team/page.tsx");
test("VO4 Web-to-Core Staff time GET never invents verified shift",()=>{
 assert.match(bridge,/verifiedMfaSession\(\)/);
 assert.match(bridge,/origin\(\)/);
 assert.match(bridge,/staff-time-state/);
 assert.match(bridge,/cache:"no-store",redirect:"error"/);
 assert.match(bridge,/r\.sourceVerified!==true/);
 assert.match(bridge,/r\.officialEod!==false/);
 assert.match(bridge,/r\.payrollVerified!==false/);
});
test("VO4 Web time command is exact original nonce, verified Core receipt",()=>{
 assert.match(bridge,/response\.ok\)return unknown\(\)/);
 assert.match(bridge,/x\.nonce!==command\.nonce/);
 assert.match(bridge,/x\.revision!==command\.expectedRevision\+1/);
 assert.match(bridge,/x\.moneyMinorUnits!==0/);
 assert.match(bridge,/x\.productionCertified!==false/);
 assert.match(api,/allowedOrigin\(request\)/);
 assert.match(api,/response\.okReceipt,200/);
 assert.match(api,/retrySameNonceOnly:true/);
});
test("VO4 Workday cannot display fake time or silently re-issue nonce",()=>{
 assert.match(controls,/readPendingTimeCommand\(storage\(\)\)/);
 assert.match(controls,/savePendingTimeCommand\(storage\(\),cmd\)/);
 assert.match(controls,/clearPendingTimeCommand\(storage\(\),cmd,payload/);
 assert.match(controls,/crypto\.randomUUID\(\)/);
 assert.match(controls,/if\(pending\)cmd=pending;/);
 assert.match(controls,/Core outcome remains unconfirmed/);
 assert.doesNotMatch(controls,/setInterval\(|navigator\.geolocation|MediaRecorder/);
 assert.match(controls,/format\(snapshot\.taskMs\)/);
});
test("VO4 Workday does not mint tasks, uses only existing scoped work",()=>{
 assert.match(page,/fetchCurrentStaffTime\(\),fetchStaffWorkQueuePreview\(\)/);
 assert.match(page,/x\.assignedToMe&&/);
 assert.match(page,/x\.state==="IN_PROGRESS"/);
 assert.match(team,/href:"\/team\/workday"/);
 assert.match(page,/The managed Core time ledger and Workday UI are not independently certified/);
});
