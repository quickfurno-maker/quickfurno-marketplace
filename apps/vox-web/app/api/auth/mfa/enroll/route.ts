import {allowedOrigin,safeJson,staffAuth} from "../../../../../lib/auth";
export const runtime="nodejs";
export async function POST(request:Request){
 if(process.env.VOX_STAFF_PORTAL_ENABLED!=="staging")return safeJson({ok:false,error:"STAFF_GATE_DISABLED"},503);
 if(!allowedOrigin(request))return safeJson({ok:false,error:"ORIGIN_DENIED"},403);
 try{
  const auth=await staffAuth();
  const {data:{user},error}=await auth.auth.getUser();
  if(error||!user||user.app_metadata?.admin_role!=="Superadmin"||!user.email_confirmed_at)
   return safeJson({ok:false,error:"UNAUTHORIZED"},401);
  const existing=await auth.auth.mfa.listFactors();
  if(existing.error)return safeJson({ok:false,error:"MFA_UNAVAILABLE"},503);
  if(existing.data?.totp?.some(x=>x.status==="verified"))return safeJson({ok:false,error:"ALREADY_ENROLLED"},409);
  const enrolled=await auth.auth.mfa.enroll({factorType:"totp",friendlyName:"QuickFurno VOX Staff"});
  if(enrolled.error||!enrolled.data?.id||!enrolled.data.totp)return safeJson({ok:false,error:"ENROLLMENT_UNAVAILABLE"},503);
  const qr=String(enrolled.data.totp.qr_code??"");
  const secret=String(enrolled.data.totp.secret??"");
  if(!/^data:image\/svg\+xml/.test(qr)||!/^[-A-Z2-7]{16,100}$/i.test(secret))
   return safeJson({ok:false,error:"ENROLLMENT_INVALID"},503);
  // One-time secret returned ONLY to the verified same-origin owner browser.
  return safeJson({ok:true,factorId:enrolled.data.id,qrCode:qr,secret},200);
 }catch{return safeJson({ok:false,error:"ENROLLMENT_UNAVAILABLE"},503);}
}
