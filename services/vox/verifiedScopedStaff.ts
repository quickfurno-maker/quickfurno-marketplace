import "server-only";
import {createClient} from "@supabase/supabase-js";
import {adminClient} from "@/lib/supabase";
import {resolveScopedStaff, type ScopedVoxContext} from "@/contracts/vox/scopedStaff.mjs";
const JWT=/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
export async function getVerifiedScopedStaff(header:string|null):Promise<ScopedVoxContext|null>{
 const raw=header?.startsWith("Bearer ")?header.slice(7):"";
 if(!raw||raw.length<100||raw.length>8192||!JWT.test(raw))return null;
 const url=process.env.NEXT_PUBLIC_SUPABASE_URL;
 const key=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
 if(!url||!key)return null;
 const auth=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
 const {data:{user},error}=await auth.auth.getUser(raw);
 if(error||!user)return null;
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
 if(profile.error||profile.data?.role!=="admin"||profile.data?.is_active!==true)return null;
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
 return resolveScopedStaff({userId:user.id,identityVerified:true,
   membership:membership.data,team:team.data,grants:scopes.data});
}
