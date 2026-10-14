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
