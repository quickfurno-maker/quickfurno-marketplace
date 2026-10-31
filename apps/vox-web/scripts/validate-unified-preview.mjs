import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";

const root=resolve(import.meta.dirname,"..");
const source=file=>readFileSync(resolve(root,file),"utf8");
let passed=0;
function check(label,fn){fn();passed++;console.log("PASS "+label)}

const home=source("app/page.tsx");
const preview=source("app/preview/staff-management/page.tsx");
const staff=source("app/team/admin/staff/setup.tsx");
const realStaff=source("app/team/admin/staff/page.tsx");
const nav=source("app/components/VoxWorkspaceNav.tsx");
const csp=source("next.config.ts");

check("root design preview requires explicit development and local-only flag",
  ()=>assert.match(home,/NODE_ENV==="development" && process\.env\.VOX_DEMO_PREVIEW==="local-only"/));
check("root keeps production locked and permits only verified staging MFA redirect",
  ()=>{
    assert.match(home,/if\(isLocalPreview\)return <LocalPreview\/>/);
    assert.match(home,/if\(process\.env\.VOX_STAFF_PORTAL_ENABLED==="staging"\)\{/);
    assert.match(home,/await verifiedMfaSession\(\)/);
    assert.match(home,/if\(accessToken\)redirect\("\/operations"\)/);
    assert.match(home,/return <Locked\/>/);
    assert.doesNotMatch(home,/service_role|adminClient\(/);
  });
check("no Core or Auth HTTP reads in demonstration homepage",
  ()=>assert.doesNotMatch(home,/\bfetch\s*\(|createClient|service_role|NEXT_PUBLIC_/));
check("no fake verified metrics or Staff counts",
  ()=>{assert.match(home,/NOT CONNECTED/);assert.match(home,/No tasks are fabricated/);assert.doesNotMatch(home,/staffEmail|fakeStaff|customerPhone/);});
check("Staff preview route requires explicit development and local-only flag",
  ()=>assert.match(preview,/NODE_ENV==="development" && process\.env\.VOX_DEMO_PREVIEW==="local-only"/));
check("Staff preview hard-404 when flags are absent",
  ()=>assert.match(preview,/if \(!isLocalPreview\) notFound\(\)/));
check("Staff preview contains no authenticated personnel or verified team data",
  ()=>{assert.match(preview,/roster=\{\[\]\} rosterVerified=\{false\} teams=\{\[\]\} teamsVerified=\{false\}/);assert.doesNotMatch(preview,/\bfetch\s*\(|staffRef:|teamId:/);});
check("real Staff Management route still uses Core verified capability before rendering",
  ()=>{assert.match(realStaff,/await fetchAdminStaffCapabilityCatalog\(\)/);assert.match(realStaff,/if\(!result\.ok\)return/);});
check("Staff Management never creates account or grant directly",
  ()=>{assert.doesNotMatch(staff,/\bfetch\s*\(|createUser|inviteUser|service_role/);assert.match(staff,/disabled type="button"/);});
check("Staff and Mission Control use a shared navigation shell",
  ()=>{assert.match(staff,/VoxWorkspaceFrame/);assert.match(home,/VoxWorkspaceFrame/);assert.match(nav,/export function VoxWorkspaceFrame/);});
check("preview Team Management navigation targets only local design route",
  ()=>assert.match(nav,/preview && item\.id === "staff" \? "\/preview\/staff-management"/));
check("live Staff route remains the Core-gated URL",
  ()=>assert.match(nav,/id: "staff".+href: "\/team\/admin\/staff"/));
check("review never fabricates approval decisions",
  ()=>assert.match(home,/these are not pending approval records/));
check("mobile layout has responsive navigation and cards",
  ()=>{assert.match(source("app/components/vox-workspace.css"),/@media \(max-width: 760px\)/);assert.match(source("app/mission.css"),/@media\(max-width: 580px\)/);});
check("development eval allowed only for React dev debugging, production retains strict CSP",
  ()=>{assert.match(csp,/NODE_ENV === "development" \? " 'unsafe-eval'" : ""/);assert.match(csp,/Content-Security-Policy/);});
const role=source("app/components/VoxRolePerspective.tsx");

check("role perspectives are only local display state, never authorization",
  ()=>{assert.match(home,/<VoxRolePerspective \/>/);assert.match(role,/useState<Role>\("admin"\)/);
    assert.match(role,/NO PERMISSION CHANGES/);assert.doesNotMatch(role,/\bfetch\s*\(|createClient|service_role|document\.cookie/);});
check("role preview has Admin, Leader and Staff with pressed-state semantics",
  ()=>{assert.match(role,/Admin \/ Superadmin/);assert.match(role,/Team Leader/);assert.match(role,/Staff Member/);
    assert.match(role,/aria-pressed=\{selected===role\}/);});
check("Staff leader preview acknowledges independent initial bootstrap",
  ()=>assert.match(role,/independently approved bootstrap/));
check("navigation search is bounded and local, with no network or service role",
  ()=>{assert.match(nav,/maxLength=\{65\}/);assert.match(nav,/inputRef\.current\?\.focus\(\)/);
    assert.doesNotMatch(nav,/\bfetch\s*\(|service_role|window\.location\.assign/);});
check("preview routes beyond Mission and Staff are not clickable links",
  ()=>{assert.match(nav,/if \(preview && item\.id !== "mission" && item\.id !== "staff"\)/);
    assert.match(nav,/aria-disabled="true"/);assert.match(nav,/voxWorkspaceNavUnavailable/);});
check("staff department search filters only passed-in Core capability catalogue",
  ()=>{assert.match(staff,/const visiblePacks=packs\.filter/);assert.match(staff,/maxLength=\{60\}/);
    assert.doesNotMatch(staff,/localStorage|sessionStorage/);});
check("directory status/search filters only provided scoped roster",
  ()=>{assert.match(staff,/const list=roster\.filter/);assert.match(staff,/r\.state===statusFilter/);
    assert.match(staff,/list\.map\(\(member,i\)/);});
check("planning draft may be cleared but cannot invite",
  ()=>{assert.match(staff,/onClick=\{\(\)=>setSelected\(\[\]\)\}/);
    assert.match(staff,/<button disabled type="button" className="staffSetupInvite"/);});
check("staff lifecycle labels are explicit plans, not real user operations",
  ()=>{assert.match(staff,/Planning and review only/);assert.match(staff,/No automatic changes/);
    assert.match(staff,/Joiner|JOINER/);assert.match(staff,/MOVER/);assert.match(staff,/LEAVER/);});
console.log("VOX_UNIFIED_PREVIEW_SECURITY_QA_PASS "+passed+"/"+passed);
