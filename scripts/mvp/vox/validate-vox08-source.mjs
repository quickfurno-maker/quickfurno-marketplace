import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {resolveScopedStaff} from "../../../contracts/vox/scopedStaff.mjs";
const read=(path)=>readFileSync(resolve(import.meta.dirname,"../../..",path),"utf8");
let n=0;const test=(name,f)=>{f();n++;console.log("PASS "+name)};
const id=x=>"00000000-0000-4000-8000-"+String(x).padStart(12,"0");
const now=Date.now(),until=new Date(now+3*86400000).toISOString();
const ctx=resolveScopedStaff({userId:id(1),identityVerified:true,
 membership:{auth_user_id:id(1),team_id:id(2),staff_role:"team_leader",is_active:true,revoked_at:null,expires_at:until},
 team:{id:id(2),city_id:id(3),is_active:true},
 grants:[{auth_user_id:id(1),scope_kind:"prospect",object_id:id(4),expires_at:until,revoked_at:null}],now});
const sql=read("supabase/migrations/20261014050000_vox_v1_team_leader_review_policy.sql");
const route=read("app/api/vox/v1/staff-grants/route.ts");
test("active verified Team Leader eligible",()=>assert.equal(ctx?.role,"team_leader"));
test("Team Leader sees no general prospects",()=>assert.deepEqual(ctx.prospectIds,[]));
test("Team Leader sees no vendor contacts",()=>assert.deepEqual(ctx.vendorIds,[]));
test("Team Leader has no conversation content",()=>assert.equal(ctx.canReadContent,false));
test("Team Leader has no write authority",()=>assert.equal(ctx.canMutate,false));
test("role requires team membership",()=>assert.match(sql,/m\.team_id=v_request\.team_id/));
test("SQL verifies trusted explicit role not email",()=>assert.match(sql,/raw_app_meta_data->>'vox_role'='team_leader'/));
test("SQL disallows manager escalation",()=>assert.match(sql,/VOX_TEAM_LEADER_ESCALATION_DENIED/));
test("owner finalizer different from reviewer",()=>assert.match(sql,/r\.decided_by is not distinct from p_authenticated_reviewer_id/));
test("owner finalizer requires independent reviewer receipt",()=>assert.match(sql,/a\.reviewer_id=r\.decided_by/));
test("owner finalizer rechecks active Team Leader",()=>assert.match(sql,/VOX_TEAM_LEADER_REVIEW_NOT_VERIFIED/));
test("Core HTTP routes reviewer through scoped verification",()=>assert.match(route,/action==="review"\?await getVerifiedScopedStaff/));
test("Core HTTP review demands exact Team Leader role",()=>assert.match(route,/leader\?\.role==="team_leader"/));
test("Core owner retains only activation and request",()=>assert.match(route,/:await verifyVoxOwnerBearer\(request\.headers\.get\("authorization"\)\)/));
test("no personal email hardcoded into source",()=>assert.doesNotMatch(sql+route,/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i));
test("no browser grants to SQL reviewers",()=>assert.doesNotMatch(sql,/grant execute.*authenticated/));
console.log("VOX08_SCOPED_TEAM_LEADER_POLICY_PASS "+n+"/16");
