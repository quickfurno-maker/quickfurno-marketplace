import "server-only";
import {adminClient,verifySupabaseBearerUser} from "@/lib/supabase";
import {FINANCE_REFUND_REVIEW_ROLES,issueVerifiedFinanceReviewer,type VerifiedFinanceReviewer}
 from "@/lib/payments/vendorPackageRefundReviewAuthority.mjs";
const JWT=/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function bearer(value:string|null):string|null{
 if(!value||!value.startsWith("Bearer "))return null;
 const t=value.slice(7);
 return t.length>100&&t.length<8192&&JWT.test(t)?t:null;
}
function claimsOf(token:string):Record<string,unknown>|null{
 try{return JSON.parse(Buffer.from(token.split(".")[1],"base64url").toString("utf8"));}
 catch{return null;}
}
/** RC37 Finance refund-intake reviewer: SOURCE-ONLY. Real GoTrue AAL2 identity
 * plus a CANONICAL finance review role and live Staff membership/team/city.
 * No such role exists today (FINANCE_REFUND_REVIEW_ROLES is empty), so this
 * returns null BEFORE any network or database read. A caller-supplied reviewer
 * id is never an input. Claims are parsed only AFTER Auth server confirmation. */
export async function verifyVoxFinanceRefundReviewerBearer(
 authorization:string|null
):Promise<VerifiedFinanceReviewer|null>{
 const token=bearer(authorization);
 if(!token||FINANCE_REFUND_REVIEW_ROLES.length===0)return null;
 const user=await verifySupabaseBearerUser(token);
 if(!user)return null;
 const role=user.app_metadata?.vox_role;
 const claims=claimsOf(token);
 const now=Math.floor(Date.now()/1000);
 if(!claims||claims.sub!==user.id||claims.aal!=="aal2"||claims.is_anonymous===true||
    typeof claims.exp!=="number"||!Number.isSafeInteger(claims.exp)||
    claims.exp<=now||claims.exp>now+86400||
    typeof claims.iat!=="number"||claims.iat>now+30||
    user.app_metadata?.qf_principal!=="vox_staff"||
    typeof role!=="string"||!FINANCE_REFUND_REVIEW_ROLES.includes(role)||
    user.app_metadata?.admin_role!=null)return null;
 const expiresAtMs=claims.exp*1000;
 try{
  const admin=adminClient();
  const profile=await admin.from("profiles").select("role,is_active").eq("id",user.id).maybeSingle();
  if(profile.error||!profile.data||profile.data.role!==null||profile.data.is_active!==true)return null;
  const membership=await admin.from("vox_staff_memberships_v1")
   .select("auth_user_id,team_id,staff_role,is_active,revoked_at,expires_at")
   .eq("auth_user_id",user.id).eq("staff_role",role).maybeSingle();
  const m=membership.data;
  if(membership.error||!m||m.auth_user_id!==user.id||m.staff_role!==role||
     m.is_active!==true||m.revoked_at!==null||!UUID.test(m.team_id||"")||
     typeof m.expires_at!=="string"||!Number.isFinite(Date.parse(m.expires_at))||
     Date.parse(m.expires_at)<=Date.now())return null;
  const team=await admin.from("vox_staff_teams_v1")
   .select("id,city_id,is_active").eq("id",m.team_id).maybeSingle();
  if(team.error||!team.data||team.data.id!==m.team_id||
     team.data.is_active!==true||!UUID.test(team.data.city_id||""))return null;
  const city=await admin.from("cities").select("id,is_active")
   .eq("id",team.data.city_id).maybeSingle();
  if(city.error||city.data?.id!==team.data.city_id||city.data?.is_active!==true)return null;
  return issueVerifiedFinanceReviewer({userId:user.id,staffRole:role,aal:"aal2",
   expiresAtMs,teamId:m.team_id,cityId:team.data.city_id});
 }catch{return null;}
}
