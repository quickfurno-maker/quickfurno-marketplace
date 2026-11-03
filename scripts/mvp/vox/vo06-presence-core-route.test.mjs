import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const src=readFileSync(new URL("../../../app/api/vox/v1/team-presence/route.ts",import.meta.url),"utf8");
test("VO6 current team private presence read remains literally OFF",()=>{
 assert.match(src,/VO6_MANAGED_PRESENCE_CERTIFIED=false as const/);
 assert.match(src,/if\(!VO6_MANAGED_PRESENCE_CERTIFIED\|\|/);
 assert.match(src,/VOX_VO6_PRESENCE_READ_ENABLED!=="staging"/);
});
test("VO6 verifies current Staff identity, bounded same-team and city roster",()=>{
 assert.match(src,/getVerifiedScopedStaff\(header\)/);
 assert.match(src,/scope\.role==="team_leader"/);
 assert.match(src,/getUserById\(id\)/);
 assert.match(src,/\.eq\("team_id",scope\.teamId\)/);
 assert.match(src,/\.eq\("city_id",scope\.cityId\)/);
 assert.match(src,/\.in\("staff_id",roster\)\.limit\(21\)/);
 assert.match(src,/same\(scope,refreshed\)/);
});
test("VO6 absence of observation source never becomes fake OFFLINE",()=>{
 assert.match(src,/PRESENCE_OBSERVATIONS_UNAVAILABLE/);
 assert.match(src,/projectVerifiedTeamPresence\(/);
 assert.match(src,/liveRealtimeConnected:false/);
 assert.match(src,/attendanceVerified:false,timeTrackingVerified:false/);
 assert.doesNotMatch(src,/\.rpc\(|\.insert\(|\.update\(/);
});
