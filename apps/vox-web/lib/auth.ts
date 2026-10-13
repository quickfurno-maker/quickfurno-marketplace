import "server-only";
import {cookies} from "next/headers";
import {createServerClient} from "@supabase/ssr";
function required(n:string){const v=process.env[n];if(!v)throw new Error("VOX_AUTH_UNCONFIGURED");return v;}
export async function staffAuth() {
 const store=await cookies();
 return createServerClient(required("VOX_SUPABASE_URL"),required("VOX_SUPABASE_PUBLISHABLE_KEY"),{
  cookies:{
   getAll:()=>store.getAll(),
   setAll(items){for(const {name,value,options} of items)store.set(name,value,{
    ...options,httpOnly:true,sameSite:"strict",secure:process.env.NODE_ENV==="production",path:"/"
   });}
  },
 });
}
export function allowedOrigin(request:Request):boolean {
 const u=new URL(request.url);
 const expected=process.env.VOX_EXPECTED_ORIGIN ?? (process.env.NODE_ENV==="production"?"https://vox.quickfurno.in":"http://127.0.0.1:3107");
 return u.origin===expected && request.headers.get("origin")===expected;
}
export function safeJson(value:unknown,status=200){
 return Response.json(value,{status,headers:{"cache-control":"private, no-store, max-age=0","x-content-type-options":"nosniff"}});
}
export async function verifiedMfaSession():Promise<string|null>{
 try{
  const auth=await staffAuth();
  const {data:{user},error}=await auth.auth.getUser();
  if(error||!user) return null;
  const {data:{session}}=await auth.auth.getSession();
  if(!session||session.user.id!==user.id||typeof session.access_token!=="string")return null;
  const aal=await auth.auth.mfa.getAuthenticatorAssuranceLevel();
  if(aal.error||aal.data?.currentLevel!=="aal2")return null;
  return session.access_token;
 }catch{return null;}
}
