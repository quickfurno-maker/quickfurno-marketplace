import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const read=path=>readFileSync(new URL("../../../"+path,import.meta.url),"utf8");
const core=read("app/api/vox/v1/team-shifts/route.ts");
const web=read("apps/vox-web/lib/teamShifts.ts");
const page=read("apps/vox-web/app/team/shifts/page.tsx");
test("VO5 current team shift Core route stays literal hard-OFF",()=>{
 assert.match(core,/VO5_MANAGED_TEAM_SHIFT_REPORT_CERTIFIED=false as const/);
 assert.match(core,/getVerifiedScopedStaff\(header\)/);
 assert.match(core,/tl\.role!=="team_leader"/);
 assert.match(core,/rowSourceVerified:true/);
 assert.match(core,/getUserById\(id\)/);
});
test("VO5 Web refuses unknown rows and fake complete history",()=>{
 assert.match(web,/verifiedMfaSession\(\)/);
 assert.match(web,/origin\(\)/);
 assert.match(web,/x.sourceVerified!==true|v\.sourceVerified!==true/);
 assert.match(web,/v\.rosterVerified!==true/);
 assert.match(web,/v\.completeHistory!==false/);
 assert.match(web,/v\.livePresence!==false/);
 assert.match(web,/v\.officialEod!==false/);
 assert.match(web,/v\.payrollVerified!==false/);
 assert.match(web,/v\.moneyMinorUnits!==0/);
});
test("VO5 Team Leader page renders verified data without authority claims",()=>{
 assert.match(page,/fetchVerifiedTeamShifts\(\)/);
 assert.match(page,/r\.totals\.attendanceMs/);
 assert.match(page,/r\.staff\.map/);
 assert.match(page,/neither a historical attendance total nor proof of online presence/);
 assert.doesNotMatch(page,/setInterval|navigator\.geolocation|MediaRecorder|sendMessage/);
});
