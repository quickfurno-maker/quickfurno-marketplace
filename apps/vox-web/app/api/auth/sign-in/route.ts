import {allowedOrigin,safeJson,staffAuth} from "../../../../lib/auth";
export const runtime="nodejs";
export async function POST(request:Request){
 if(process.env.VOX_STAFF_PORTAL_ENABLED!=="staging")return safeJson({ok:false,error:"STAFF_GATE_DISABLED"},503);
 if(!allowedOrigin(request))return safeJson({ok:false,error:"ORIGIN_DENIED"},403);
 if(!request.headers.get("content-type")?.startsWith("application/json"))return safeJson({ok:false,error:"INVALID_CONTENT"},415);
 try{
  const body=await request.text();
  if(body.length>2048)return safeJson({ok:false,error:"INVALID_CONTENT"},413);
  const input=JSON.parse(body);
  const email=typeof input.email==="string"?input.email.trim():"";
  const password=typeof input.password==="string"?input.password:"";
  if(email.length<3||email.length>254||password.length<8||password.length>512)return safeJson({ok:false,error:"INVALID_LOGIN"},400);
  const auth=await staffAuth();
  const result=await auth.auth.signInWithPassword({email,password});
  return result.error?safeJson({ok:false,error:"INVALID_LOGIN"},401):safeJson({ok:true,next:"mfa"},200);
 }catch{return safeJson({ok:false,error:"LOGIN_UNAVAILABLE"},503);}
}
