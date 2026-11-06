/**
 * Authenticate an existing vendor owner from a fresh Meta WhatsApp-delivered
 * Supabase Auth OTP and current canonical dashboard membership.
 */
import "server-only";
import { readBoundedVendorJson } from "@/lib/vendors/readBoundedVendorJson";
import { allowPublicMutation } from "@/lib/security/publicMutationRateLimit";
import {
  verifyReturningVendorWhatsappLogin,
  vendorWhatsappReturningModeEnabled,
} from "@/services/returningWhatsappVendorLoginService";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const MOBILE = /^[6-9][0-9]{9}$/;
const TOKEN = /^[0-9]{6,8}$/;
const respond = (body:unknown,status:number)=>Response.json(body,{
  status,headers:{"cache-control":"no-store,max-age=0","x-content-type-options":"nosniff"},
});
const sameOrigin = (r:Request)=>{
  try {const origin=r.headers.get("origin");return Boolean(origin &&
    new URL(origin).origin===new URL(r.url).origin);}catch{return false;}
};
export async function POST(request:Request):Promise<Response>{
  if(!vendorWhatsappReturningModeEnabled())
    return respond({ok:false,code:"VENDOR_WHATSAPP_LOGIN_NOT_AVAILABLE"},503);
  if(!sameOrigin(request))return respond({ok:false,code:"ORIGIN_REQUIRED"},403);
  if(request.headers.get("content-type")?.split(";")[0].trim()!=="application/json")
    return respond({ok:false,code:"INVALID_CONTENT_TYPE"},415);
  const bounded=await readBoundedVendorJson(request,1024).catch(()=>null);
  if(!bounded?.ok)return respond({ok:false,code:"INVALID_REQUEST"},400);
  const value=bounded.value;
  if(!value||typeof value!=="object"||Array.isArray(value))
    return respond({ok:false,code:"INVALID_REQUEST"},400);
  const body=value as Record<string,unknown>;
  if(Object.keys(body).sort().join(",")!=="mobile,token" ||
    typeof body.mobile!=="string"||!MOBILE.test(body.mobile) ||
    typeof body.token!=="string"||!TOKEN.test(body.token))
    return respond({ok:false,code:"INVALID_REQUEST"},400);

  // Reject brute-force attempts before consuming a Supabase OTP.
  const allowed=await allowPublicMutation({
    scope:"vendor-returning-whatsapp-login-verify",identity:"+91"+body.mobile,
    limit:5,windowMs:15*60*1000,
  }).catch(()=>false);
  if(!allowed)return respond({ok:false,code:"VENDOR_WHATSAPP_LOGIN_FAILED"},401);
  const result=await verifyReturningVendorWhatsappLogin(body.mobile,body.token)
    .catch(()=>({ok:false as const,code:"VENDOR_WHATSAPP_LOGIN_FAILED" as const}));
  if(!result.ok)return respond({ok:false,code:"VENDOR_WHATSAPP_LOGIN_FAILED"},401);
  // No vendorId is accepted in any route parameter or POST body.
  return respond({ok:true,code:result.code,redirectTo:"/vendor/dashboard"},200);
}
export function GET():Response {
  return respond({ok:false,code:"METHOD_NOT_ALLOWED"},405);
}
