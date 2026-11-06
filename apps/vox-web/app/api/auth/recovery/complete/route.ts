import {cookies} from "next/headers";
import {allowedOrigin,safeJson,staffAuth} from "../../../../../lib/auth";
import {recoveryKey,verifyRecoveryTicket} from "../../../../../lib/recoveryTicket.mjs";
import {COMPLETE_COOKIE,recoveryEnabled} from "../../../../../lib/recoveryStage";
export const runtime="nodejs";export const dynamic="force-dynamic";
export async function POST(request:Request){
 if(!recoveryEnabled())return safeJson({ok:false,error:"RECOVERY_DISABLED"},503);
 if(!allowedOrigin(request))return safeJson({ok:false,error:"ORIGIN_DENIED"},403);
 if(!request.headers.get("content-type")?.startsWith("application/json"))
  return safeJson({ok:false,error:"INVALID_CONTENT"},415);
 try{
  const raw=await request.text();
  if(raw.length>900)return safeJson({ok:false,error:"INVALID_REQUEST"},413);
  const value:unknown=JSON.parse(raw);
  if(!value||typeof value!=="object"||Array.isArray(value))return safeJson({ok:false,error:"INVALID_REQUEST"},400);
  const data=value as Record<string,unknown>;
  if(Object.keys(data).length!==1||typeof data.password!=="string"||
    data.password.length<8||data.password.length>512)
   return safeJson({ok:false,error:"INVALID_REQUEST"},400);
  const store=await cookies();
  const ticket=store.get(COMPLETE_COOKIE)?.value;
  // Always invalidate the one-time authorization BEFORE a password change.
  store.delete(COMPLETE_COOKIE);
  const auth=await staffAuth();
  const {data:{user},error}=await auth.auth.getUser();
  if(error||!user||!verifyRecoveryTicket(ticket,"complete",user.id,recoveryKey()))
   return safeJson({ok:false,error:"RECOVERY_SESSION_EXPIRED"},403);
  const updated=await auth.auth.updateUser({password:data.password});
  if(updated.error)return safeJson({ok:false,error:"PASSWORD_CHANGE_REJECTED"},409);
  // Invalidate the recovery login rather than promoting its AAL1 session.
  await auth.auth.signOut();
  return safeJson({ok:true,next:"login"},200);
 }catch{return safeJson({ok:false,error:"RECOVERY_UNAVAILABLE"},503);}
}
export function GET(){return safeJson({ok:false,error:"METHOD_NOT_ALLOWED"},405);}
