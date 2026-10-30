import "server-only";
import {adminClient,verifySupabaseBearerUser} from "@/lib/supabase";
const JWT=/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
function headerBearer(value:string|null):string|null {
 if(!value || !value.startsWith("Bearer ")) return null;
 const valueToken=value.slice(7);
 return valueToken.length>100 && valueToken.length<8192 && JWT.test(valueToken)?valueToken:null;
}
function aal2ClaimMatches(token:string,userId:string):boolean {
 // Auth server getUser(token) MUST have succeeded before parsing these claims.
 // This decoder is NOT a signature verifier by itself.
 try {
  const data=JSON.parse(Buffer.from(token.split(".")[1],"base64url").toString("utf8")) as Record<string,unknown>;
  const now=Math.floor(Date.now()/1000);
  return data.sub===userId && data.aal==="aal2" &&
     typeof data.exp==="number" && data.exp>now && data.exp<=now+86400 &&
     typeof data.iat==="number" && data.iat<=now+30 &&
     data.is_anonymous!==true;
 } catch { return false; }
}
export async function verifyVoxOwnerBearer(authorization:string|null):Promise<string|null>{
 const token=headerBearer(authorization);
 if(!token) return null;
 // NEVER trust JWT metadata or client-provided roles without remote Auth verification.
 const user=await verifySupabaseBearerUser(token);
 if(!user||!aal2ClaimMatches(token,user.id)) return null;
 const profile=await adminClient().from("profiles").select("role,is_active").eq("id",user.id).maybeSingle();
 if(profile.error||profile.data?.role!=="admin"||profile.data?.is_active!==true) return null;
 if(user.app_metadata?.admin_role!=="Superadmin") return null;
 return user.id;
}

/** Review-only Staff AAL2 adapter. Real GoTrue verifies the bearer before
 * metadata claims are inspected; database membership/team/profile are re-read.
 * This preflight is NOT the final PostgreSQL transaction authorization.
 * Do not expose the RC8 mutation route until the SQL-bound rechecks, consent
 * serialization and independent reviews are complete. */
export type VoxVerifiedOperationsStaff={
 userId:string;aal:"aal2";expiresAtMs:number;teamId:string;cityId:string;
};
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export async function verifyVoxOperationsStaffBearer(
 authorization:string|null
):Promise<VoxVerifiedOperationsStaff|null>{
 const token=headerBearer(authorization);
 if(!token)return null;
 const user=await verifySupabaseBearerUser(token);
 if(!user||!aal2ClaimMatches(token,user.id))return null;
 if(user.app_metadata?.qf_principal!=="vox_staff"||
    user.app_metadata?.vox_role!=="operations_manager"||
    user.app_metadata?.admin_role!=null)return null;
 try{
  const claims=JSON.parse(Buffer.from(token.split(".")[1],"base64url").toString("utf8")) as {exp?:unknown};
  if(typeof claims.exp!=="number"||!Number.isSafeInteger(claims.exp))return null;
  const expiresAtMs=claims.exp*1000;
  if(!Number.isSafeInteger(expiresAtMs)||expiresAtMs<=Date.now())return null;
  const admin=adminClient();
  const profile=await admin.from("profiles").select("role,is_active").eq("id",user.id).maybeSingle();
  if(profile.error||!profile.data||profile.data.role!==null||profile.data.is_active!==true)return null;
  const membership=await admin.from("vox_staff_memberships_v1")
   .select("auth_user_id,team_id,staff_role,is_active,revoked_at,expires_at")
   .eq("auth_user_id",user.id).eq("staff_role","operations_manager").maybeSingle();
  const m=membership.data;
  if(membership.error||!m||m.auth_user_id!==user.id||m.is_active!==true||
     m.revoked_at!==null||!UUID.test(m.team_id||"")||
     typeof m.expires_at!=="string"||
     !Number.isFinite(Date.parse(m.expires_at))||
     Date.parse(m.expires_at)<=Date.now())return null;
  const team=await admin.from("vox_staff_teams_v1")
   .select("id,city_id,is_active").eq("id",m.team_id).maybeSingle();
  if(team.error||!team.data||team.data.id!==m.team_id||
     team.data.is_active!==true||!UUID.test(team.data.city_id||""))return null;
  if(expiresAtMs<=Date.now()||Date.parse(m.expires_at)<=Date.now())return null;
  return Object.freeze({userId:user.id,aal:"aal2",expiresAtMs,
   teamId:m.team_id,cityId:team.data.city_id});
 }catch{return null;}
}
