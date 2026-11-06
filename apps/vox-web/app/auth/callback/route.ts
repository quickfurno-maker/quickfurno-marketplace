import {cookies} from "next/headers";
import {NextResponse} from "next/server";
import {staffAuth} from "../../../lib/auth";
import {emailDigest,issueRecoveryTicket,recoveryKey,verifyRecoveryTicket} from "../../../lib/recoveryTicket.mjs";
import {INIT_COOKIE,COMPLETE_COOKIE,cookieOptions,recoveryEnabled,recoveryOrigin,trustedRecoveryHost} from "../../../lib/recoveryStage";
export const runtime="nodejs";export const dynamic="force-dynamic";
const CODE=/^[A-Za-z0-9_-]{16,512}$/;
const response=(path:string)=>{
 const r=NextResponse.redirect("https://vox.quickfurno.in"+path,303);
 r.headers.set("Cache-Control","private, no-store, max-age=0");
 r.headers.set("Referrer-Policy","no-referrer");
 return r;
};
export async function GET(request:Request){
 if(!recoveryEnabled()||!trustedRecoveryHost(request)||!recoveryOrigin())
  return new Response(null,{status:404,headers:{"Cache-Control":"no-store"}});
 const url=new URL(request.url);
 const params=[...url.searchParams.keys()];
 const code=url.searchParams.get("code");
 const store=await cookies();
 const init=store.get(INIT_COOKIE)?.value;
 store.delete(INIT_COOKIE);
 if(!code||!CODE.test(code)||params.length!==1||params[0]!=="code"||!init)
  return response("/login?recovery=expired");
 try{
  const key=recoveryKey();
  // The HMAC is checked again after Auth has validated the one-time PKCE code
  // and identified the actual user; no email or arbitrary next URL is trusted.
  const auth=await staffAuth();
  const exchanged=await auth.auth.exchangeCodeForSession(code);
  if(exchanged.error||!exchanged.data.user||!exchanged.data.user.email)
   return response("/login?recovery=expired");
  const user=exchanged.data.user;
  const address=user.email;
  if(typeof address!=="string"||!verifyRecoveryTicket(init,"init",emailDigest(address),key)){
   await auth.auth.signOut();
   return response("/login?recovery=expired");
  }
  store.set(COMPLETE_COOKIE,issueRecoveryTicket("complete",user.id,key),{
   ...cookieOptions,sameSite:"strict"
  });
  return response("/password/reset");
 }catch{return response("/login?recovery=expired");}
}
export function POST(){return new Response(null,{status:405});}
