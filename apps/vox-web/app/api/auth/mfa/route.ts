import {allowedOrigin,safeJson,staffAuth} from "../../../../lib/auth";
export const runtime="nodejs";
export async function POST(request:Request){
 if(process.env.VOX_STAFF_PORTAL_ENABLED!=="staging")return safeJson({ok:false,error:"STAFF_GATE_DISABLED"},503);
 if(!allowedOrigin(request))return safeJson({ok:false,error:"ORIGIN_DENIED"},403);
 if(!request.headers.get("content-type")?.startsWith("application/json"))return safeJson({ok:false,error:"INVALID_CONTENT"},415);
 try {
  const raw=await request.text();
  if(raw.length>256)return safeJson({ok:false,error:"INVALID_CONTENT"},413);
  const parsed=JSON.parse(raw);
  const code=typeof parsed.code==="string"?parsed.code:"";
  if(!/^[0-9]{6}$/.test(code))return safeJson({ok:false,error:"INVALID_CODE"},400);
  const auth=await staffAuth();
  const {data:{user}}=await auth.auth.getUser();
  if(!user)return safeJson({ok:false,error:"UNAUTHORIZED"},401);
  const factors=await auth.auth.mfa.listFactors();
  if(factors.error)return safeJson({ok:false,error:"MFA_UNAVAILABLE"},503);
  const verified=factors.data?.totp?.filter(f=>f.status==="verified")??[];
  if(verified.length!==1)return safeJson({ok:false,error:"MFA_FACTOR_NOT_CONFIGURED"},403);
  const result=await auth.auth.mfa.challengeAndVerify({factorId:verified[0].id,code});
  if(result.error)return safeJson({ok:false,error:"MFA_FAILED"},401);
  return safeJson({ok:true,next:"operations"});
 }catch{return safeJson({ok:false,error:"MFA_UNAVAILABLE"},503);}
}
