import {cookies} from "next/headers";
import {allowedOrigin,safeJson,staffAuth} from "../../../../../lib/auth";
import {emailDigest,issueRecoveryTicket,recoveryKey} from "../../../../../lib/recoveryTicket.mjs";
import {INIT_COOKIE,cookieOptions,recoveryEnabled,recoveryOrigin} from "../../../../../lib/recoveryStage";
export const runtime="nodejs";export const dynamic="force-dynamic";
const EMAIL=/^[^\s@]{1,64}@[^\s@]{1,190}$/;
export async function POST(request:Request){
 if(!recoveryEnabled())return safeJson({ok:false,error:"RECOVERY_DISABLED"},503);
 if(!allowedOrigin(request)||!recoveryOrigin())return safeJson({ok:false,error:"ORIGIN_DENIED"},403);
 if(!request.headers.get("content-type")?.startsWith("application/json"))
  return safeJson({ok:false,error:"INVALID_CONTENT"},415);
 try{
  const raw=await request.text();
  if(raw.length>360)return safeJson({ok:false,error:"INVALID_REQUEST"},413);
  const v:unknown=JSON.parse(raw);
  if(!v||typeof v!=="object"||Array.isArray(v))return safeJson({ok:false,error:"INVALID_REQUEST"},400);
  const x=v as Record<string,unknown>;
  if(Object.keys(x).length!==1||typeof x.email!=="string"||!EMAIL.test(x.email.trim())||x.email.length>254)
   return safeJson({ok:false,error:"INVALID_REQUEST"},400);
  const email=x.email.trim().toLowerCase();
  const ticket=issueRecoveryTicket("init",emailDigest(email),recoveryKey());
  const auth=await staffAuth();
  // Supabase Auth and the upstream WAF must be rate-limited before this is enabled.
  // Responses never disclose whether the email belongs to a real staff account.
  await auth.auth.resetPasswordForEmail(email,{redirectTo:recoveryOrigin()!+"/auth/callback"});
  const store=await cookies();
  store.set(INIT_COOKIE,ticket,cookieOptions);
  return safeJson({ok:true,message:"If the account is eligible, check its mailbox."},202);
 }catch{return safeJson({ok:false,error:"RECOVERY_UNAVAILABLE"},503);}
}
export function GET(){return safeJson({ok:false,error:"METHOD_NOT_ALLOWED"},405);}
