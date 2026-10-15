import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
const root=resolve(import.meta.dirname,"../../..");
const read=x=>readFileSync(resolve(root,x),"utf8");
const core=read("app/api/vox/v1/staff-team-options/route.ts");
const bff=read("apps/vox-web/lib/core.ts");
const ui=read("apps/vox-web/app/team/admin/staff/setup.tsx");
const page=read("apps/vox-web/app/team/admin/staff/page.tsx");
const env=read("apps/vox-web/.env.example");
let n=0;const check=(name,fn)=>{fn();n++;console.log("PASS "+name)};
check("Core backend owner AAL2 only and independent flag",()=>{
 assert.match(core,/verifyVoxOwnerBearer\(request\.headers\.get\("authorization"\)\)/);
 assert.match(core,/VOX_STAFF_TEAM_OPTIONS_ENABLED!=="staging"/);
});
check("Core bounded canonical city and active team lookup",()=>{
 assert.match(core,/from\("vox_staff_teams_v1"\)/);
 assert.match(core,/from\("cities"\)/);
 assert.match(core,/limit\(41\)/);
 assert.match(core,/t\.is_active&&byCity\.get\(t\.city_id\)\?\.is_active===true/);
});
check("Core no mutations or person records",()=>{
 assert.doesNotMatch(core,/\.insert\(|\.update\(|\.delete\(|inviteUserByEmail|createUser\(|\.from\("profiles"\)/);
 for(const method of ["POST","PUT","PATCH","DELETE"])
  assert.match(core,new RegExp("export function "+method+"\\(\\)"));
});
check("UI selector flag off default and AAL2 via existing Web session",()=>{
 assert.match(env,/VOX_ADMIN_STAFF_TEAM_PICKER_UI_ENABLED=disabled/);
 assert.match(bff,/fetchAdminStaffTeamOptions\([\s\S]*verifiedMfaSession\(\)/);
});
check("BFF locked origin, strict response and server-only Core bearer",()=>{
 assert.match(bff,/fetchAdminStaffTeamOptions\([\s\S]*base\+"\/api\/vox\/v1\/staff-team-options"/);
 assert.match(bff,/fetchAdminStaffTeamOptions\([\s\S]*redirect:"error"/);
 assert.match(bff,/qf\.vox\.staff\.team-options\.v1/);
 assert.match(bff,/x\.actionsEnabled!==false/);
});
check("Only owner-verified page can render selection",()=>{
 assert.match(page,/if\(!result\.ok\)return/);
 assert.match(page,/await fetchAdminStaffTeamOptions\(\)/);
 assert.match(page,/teamsVerified=\{teamChoices\.ok\}/);
});
check("No browser fetch, invite or save, and no Admin role picker",()=>{
 assert.match(ui,/select value=\{teamId\}/);
 assert.match(ui,/<button disabled type="button"/);
 assert.doesNotMatch(ui,/fetch\(|localStorage|sessionStorage|inviteUserByEmail|type="submit"|value="admin"/);
});
console.log("VOX_TO02E_ADMIN_TEAM_PICKER_SOURCE_PASS "+n+"/7");
