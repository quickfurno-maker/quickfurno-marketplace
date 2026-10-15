import "server-only";
import {adminClient,verifySupabaseBearerUser} from "@/lib/supabase";
import {resolveScopedStaff, type ScopedVoxContext} from "@/contracts/vox/scopedStaff.mjs";
import {isNeutralVoxStaffPrincipal} from "@/contracts/vox/neutralStaffPrincipal.mjs";
import {restrictScopedStaffByDepartment} from "@/contracts/vox/effectiveDepartments.mjs";
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const JWT=/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
export async function getVerifiedScopedStaff(header:string|null):Promise<ScopedVoxContext|null>{
 const raw=header?.startsWith("Bearer ")?header.slice(7):"";
 if(!raw||raw.length<100||raw.length>8192||!JWT.test(raw))return null;
 const user=await verifySupabaseBearerUser(raw);
 if(!user)return null;
 // JWT is used only AFTER real Supabase Auth confirms this exact identity.
 try{
  const jwt=JSON.parse(Buffer.from(raw.split(".")[1],"base64url").toString("utf8"));
  const now=Math.floor(Date.now()/1000);
  if(jwt.sub!==user.id||jwt.aal!=="aal2"||jwt.is_anonymous===true||
     !Number.isInteger(jwt.exp)||jwt.exp<=now||jwt.exp>now+86400||
     !Number.isInteger(jwt.iat)||jwt.iat>now+30)return null;
 }catch{return null;}
 const db=adminClient();
 const profile=await db.from("profiles").select("id,role,is_active").eq("id",user.id).maybeSingle();
 // Ordinary VOX staff MUST remain neutral Core principals. A legacy Core
 // admin role would inherit admin-only RLS privileges outside VOX.
 if(profile.error||!isNeutralVoxStaffPrincipal(profile.data,user))return null;
 const membership=await db.from("vox_staff_memberships_v1")
   .select("auth_user_id,team_id,staff_role,is_active,expires_at,revoked_at")
   .eq("auth_user_id",user.id).maybeSingle();
 if(membership.error||!membership.data)return null;
 const team=await db.from("vox_staff_teams_v1")
   .select("id,city_id,is_active").eq("id",membership.data.team_id).maybeSingle();
 if(team.error||!team.data)return null;
 const city=await db.from("cities").select("id,is_active").eq("id",team.data.city_id).maybeSingle();
 if(city.error||city.data?.is_active!==true)return null;
 const scopes=await db.from("vox_staff_object_scopes_v1")
   .select("auth_user_id,scope_kind,object_id,expires_at,revoked_at")
   .eq("auth_user_id",user.id).is("revoked_at",null).limit(201);
 if(scopes.error||!scopes.data||scopes.data.length>200)return null;
 const scoped=resolveScopedStaff({userId:user.id,identityVerified:true,
   membership:membership.data,team:team.data,grants:scopes.data});
 if(!scoped||process.env.VOX_DEPARTMENT_ENFORCEMENT_ENABLED!=="staging")return scoped;
 // Default OFF: a newly enabled department layer MUST narrow, never enlarge,
 // existing Core grants. Missing/unreviewed schema or query error denies all.
 const caps=await db.from("vox_staff_department_capabilities_v1")
  .select("id,request_id,auth_user_id,team_id,city_id,department,granted_by,expires_at,revoked_at,revision")
  .eq("auth_user_id",user.id).is("revoked_at",null).limit(17);
 if(caps.error||!caps.data||caps.data.length>16)return null;
 const capIds=caps.data.map(g=>g.id);
 const reqIds=caps.data.map(g=>g.request_id);
 const requests=reqIds.length?await db.from("vox_staff_department_requests_v1")
  .select("id,target_staff_id,team_id,city_id,department,requested_by,decided_by,decision_reference,state,revision,expires_at")
  .in("id",reqIds).limit(17):{data:[],error:null};
 const decisions=reqIds.length?await db.from("vox_staff_department_decisions_v1")
  .select("request_id,reviewer_id,decision,decision_reference")
  .in("request_id",reqIds).limit(17):{data:[],error:null};
 const activations=capIds.length?await db.from("vox_staff_department_activations_v1")
  .select("request_id,capability_id,activated_by")
  .in("capability_id",capIds).limit(17):{data:[],error:null};
 if(requests.error||decisions.error||activations.error||
    !requests.data||!decisions.data||!activations.data)return null;
 // Previously approved decisions MUST NOT survive a reviewer losing TL
 // membership, being disabled or losing verified Auth principal metadata.
 // Read fresh information from Core + actual Supabase Auth, not browser claims.
 const reviewersIds=[...new Set(requests.data.map(r=>r.decided_by))];
 if(reviewersIds.some(x=>typeof x!=="string"||!UUID.test(x))||reviewersIds.length>16)return null;
 const profiles=reviewersIds.length?await db.from("profiles")
  .select("id,role,is_active").in("id",reviewersIds).limit(17):{data:[],error:null};
 const reviewerMembers=reviewersIds.length?await db.from("vox_staff_memberships_v1")
  .select("auth_user_id,team_id,staff_role,is_active,expires_at,revoked_at")
  .in("auth_user_id",reviewersIds).limit(17):{data:[],error:null};
 if(profiles.error||reviewerMembers.error||!profiles.data||!reviewerMembers.data||
    profiles.data.length!==reviewersIds.length||
    reviewerMembers.data.length!==reviewersIds.length)return null;
 const users=await Promise.all(reviewersIds.map(id=>db.auth.admin.getUserById(id)));
 if(users.some((result,index)=>result.error||result.data.user?.id!==reviewersIds[index]))return null;
 const reviewers=reviewersIds.map((id,index)=>{
  const p=profiles.data.find(v=>v.id===id);
  const m=reviewerMembers.data.find(v=>v.auth_user_id===id);
  const user=users[index].data.user;
  return {userId:id,role:p?.role??null,isActive:p?.is_active===true,
   qfPrincipal:user?.app_metadata?.qf_principal??null,
   adminRole:user?.app_metadata?.admin_role??null,
   voxRole:user?.app_metadata?.vox_role??null,
   staffRole:m?.staff_role??null,membershipActive:m?.is_active===true,
   revokedAt:m?.revoked_at??null,expiresAt:m?.expires_at??null,
   teamId:m?.team_id??null,cityId:scoped.cityId,
   teamActive:team.data.is_active===true};
 });
 return restrictScopedStaffByDepartment({scoped,capabilities:caps.data,
   requests:requests.data,decisions:decisions.data,
   activations:activations.data,reviewers}) as ScopedVoxContext|null;
}
