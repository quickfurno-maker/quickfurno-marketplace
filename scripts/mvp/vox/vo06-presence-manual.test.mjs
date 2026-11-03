import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const read=p=>readFileSync(new URL("../../../"+p,import.meta.url),"utf8");
const core=read("app/api/vox/v1/team-presence/route.ts");
const web=read("apps/vox-web/lib/teamPresence.ts");
const api=read("apps/vox-web/app/api/team-presence/route.ts");
const ui=read("apps/vox-web/app/team/presence/ManualPresenceControl.tsx");
test("VO6 Core presence write remains hard-disabled until DB and Auth go",()=>{
 assert.match(core,/VO6_MANAGED_PRESENCE_CERTIFIED=false as const/);
 assert.match(core,/VOX_VO6_PRESENCE_WRITE_ENABLED!=="staging"/);
 assert.match(core,/getVerifiedScopedStaff\(header\)/);
 assert.match(core,/qf_vox_staff_presence_signal_candidate_v1/);
 assert.match(core,/p_actor:scope\.userId,p_team:scope\.teamId,p_state:state/);
 assert.match(core,/same\(scope,latest\)/);
});
test("VO6 voluntary states only; never accepts browser actor, city or timing",()=>{
 assert.match(core,/Object\.keys\(x\)\.join\("\|"\)!=="state"/);
 assert.match(core,/ONLINE","AWAY","BUSY","IN_MEETING","ON_BREAK/);
 assert.match(core,/PRESENCE_SIGNAL_OUTCOME_UNKNOWN/);
 assert.match(core,/providerMessagesSent:0,moneyMinorUnits:0/);
 assert.doesNotMatch(core,/body\.userId|body\.teamId|body\.cityId|body\.seenAt/);
});
test("VO6 Staff Web requires independent Core MFA, valid receipt and CSRF",()=>{
 assert.match(web,/verifiedMfaSession\(\)/);
 assert.match(web,/origin\(\)/);
 assert.match(web,/r\.state!==state/);
 assert.match(web,/r\.attendanceVerified!==false/);
 assert.match(api,/allowedOrigin\(request\)/);
 assert.match(api,/Object\.keys\(body\)\.join\("\\|"\)!=="state"/);

});
test("VO6 Staff UI never auto-observes keyboard, GPS, camera or live video",()=>{
 assert.match(ui,/ManualPresenceControl/);
 assert.match(ui,/method:"POST",credentials:"same-origin"/);
 assert.match(ui,/router\.refresh\(\)/);
 assert.match(ui,/90 seconds unless you explicitly update it/);
 assert.doesNotMatch(ui,/setInterval|navigator\.geolocation|MediaRecorder|onKeyDown|onMouseMove/);
});
