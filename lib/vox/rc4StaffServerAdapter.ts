import "server-only";
import {adminClient,verifySupabaseBearerUser} from "@/lib/supabase";
import {authorizeRc4Staff} from "@/lib/vox/rc4StaffAuthorization.mjs";
// Server wiring for the RC4 Staff binder. HARD-OFF: requires an explicit
// env value AND a reviewed same-session revocation probe (not yet available).
// Read-only: this adapter never creates users or writes any row.
type Required="owner"|"team_leader"|"staff";
async function loadFacts(userId:string){
 const db=adminClient();
 const profile=await db.from("profiles").select("id,role,is_active").eq("id",userId).maybeSingle();
 const auth=await db.auth.admin.getUserById(userId);
 const membership=await db.from("vox_staff_memberships_v1")
  .select("auth_user_id,team_id,staff_role,is_active,expires_at,revoked_at")
  .eq("auth_user_id",userId).maybeSingle();
 if(profile.error||auth.error||membership.error)throw new Error("facts");
 const team=membership.data?await db.from("vox_staff_teams_v1")
  .select("id,city_id,is_active").eq("id",membership.data.team_id).maybeSingle():{data:null,error:null};
 const city=team.data?await db.from("cities").select("id,is_active").eq("id",team.data.city_id).maybeSingle():{data:null,error:null};
 if(team.error||city.error)throw new Error("facts");
 return {profile:profile.data,authUser:auth.data.user,membership:membership.data,
  team:team.data,city:city.data,
  // BLOCKER: no reviewed authorization-epoch source exists yet. Undefined makes
  // the binder fail closed with DEPENDENCY_UNAVAILABLE.
  authorizationEpoch:undefined as string|null|undefined};
}
// BLOCKER: auth.sessions is not exposed via PostgREST; a reviewed read-only
// SECURITY DEFINER probe is required. Until then every session is "not live".
async function isSessionLive(_userId:string,_sessionId:string):Promise<boolean>{return false;}
export async function requireRc4Staff(input:{authorization:string|null;required:Required;
  claimedUserId?:string;teamId?:string;cityId?:string;
  approval?:{requestedBy:string;targetUserId:string}}){
 if(process.env.VOX_RC4_STAFF_AUTHZ_ENABLED!=="staging")
  return {ok:false as const,code:"DEPENDENCY_UNAVAILABLE",status:503};
 return authorizeRc4Staff({...input,deps:{verifyBearer:verifySupabaseBearerUser,loadFacts,isSessionLive}});
}
