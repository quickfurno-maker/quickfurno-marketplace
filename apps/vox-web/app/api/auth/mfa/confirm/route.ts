import {allowedOrigin,safeJson,staffAuth} from "../../../../../lib/auth";
export const runtime="nodejs";
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export async function POST(request:Request){
 if(process.env.VOX_STAFF_PORTAL_ENABLED!=="staging")return safeJson({ok:false,error:"STAFF_GATE_DISABLED"},503);
 if(!allowedOrigin(request))return safeJson({ok:false,error:"ORIGIN_DENIED"},403);
 if(!request.headers.get("content-type")?.startsWith("application/json"))return safeJson({ok:false,error:"INVALID_CONTENT"},415);
 try{
  const body=await request.text();
  if(body.length>256)return safeJson({ok:false,error:"INVALID_CONTENT"},413);
  const data=JSON.parse(body);
  const factorId=typeof data.factorId==="string"?data.factorId:"";
  const code=typeof data.code==="string"?data.code:"";
  if(!UUID.test(factorId)||!/^[0-9]{6}$/.test(code))return safeJson({ok:false,error:"INVALID_CODE"},400);
  const auth=await staffAuth();
  const {data:{user},error}=await auth.auth.getUser();
  const owner=user?.app_metadata?.admin_role==="Superadmin";\n  const staff=user?.app_metadata?.qf_principal==="vox_staff"&&\n   user?.app_metadata?.admin_role==null&&\n   process.env.VOX_STAFF_MFA_ENROLL_ENABLED==="staging";\n  if(error||!user||!user.email_confirmed_at||(!owner&&!staff))
   return safeJson({ok:false,error:"UNAUTHORIZED"},401);
  const factors=await auth.auth.mfa.listFactors();
  if(factors.error||!factors.data?.all?.some(f=>f.id===factorId&&f.factor_type==="totp"&&f.status==="unverified"))
   return safeJson({ok:false,error:"MFA_FACTOR_DENIED"},403);
  const result=await auth.auth.mfa.challengeAndVerify({factorId,code});
  return result.error?safeJson({ok:false,error:"MFA_FAILED"},401):safeJson({ok:true,next:"operations"},200);
 }catch{return safeJson({ok:false,error:"MFA_UNAVAILABLE"},503);}
}
