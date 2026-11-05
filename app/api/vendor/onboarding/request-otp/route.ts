/**
 * Vendor WhatsApp OTP initiation — server-only and OFF until the shared signed
 * Supabase Auth Hook plus the independent Meta Authentication provider are
 * certified in an approved staging environment. No SMS fallback.
 */
import "server-only";
import { publicClient } from "@/lib/supabase";
import { allowPublicMutation } from "@/lib/security/publicMutationRateLimit";
import { coordinateVendorOtpRequest } from "@/lib/identity/vendorOtpRequestCoordination";
import { reserveAuthOtpPurpose } from "@/services/authOtpPurposeReservationService";

export const runtime="nodejs";
export const dynamic="force-dynamic";
const MOBILE=/^[6-9][0-9]{9}$/;
const respond=(body:unknown,status:number)=>Response.json(body,{
  status,headers:{"cache-control":"no-store, max-age=0","x-content-type-options":"nosniff"},
});
const enabled=()=>process.env.QF_VENDOR_OTP_REQUEST_MODE==="staging" &&
  process.env.QF_VENDOR_SHARED_SIGNED_HOOK_CERTIFIED==="staging" &&
  process.env.QF_VENDOR_WHATSAPP_PROVIDER_CERTIFIED==="staging";
function sameOrigin(request:Request):boolean{
  const origin=request.headers.get("origin");
  try{return Boolean(origin && new URL(origin).origin===new URL(request.url).origin);}
  catch{return false;}
}
export async function POST(request:Request):Promise<Response>{
  if(!enabled())return respond({ok:false,code:"WHATSAPP_OTP_NOT_YET_AVAILABLE"},503);
  if(!sameOrigin(request))return respond({ok:false,code:"ORIGIN_REQUIRED"},403);
  if(request.headers.get("content-type")?.split(";")[0].trim()!=="application/json")
    return respond({ok:false,code:"INVALID_CONTENT_TYPE"},415);
  const length=Number(request.headers.get("content-length"));
  if(!Number.isFinite(length)||length>1024 || length<1)
    return respond({ok:false,code:"INVALID_REQUEST_SIZE"},413);
  try{
    const value:unknown=await request.json();
    if(!value||typeof value!=="object"||Array.isArray(value))
      return respond({ok:false,code:"INVALID_MOBILE"},400);
    const body=value as Record<string,unknown>;
    if(Object.keys(body).length!==1||typeof body.mobile!=="string"||!MOBILE.test(body.mobile))
      return respond({ok:false,code:"INVALID_MOBILE"},400);
    const phone="+91"+body.mobile;
    const outcome=await coordinateVendorOtpRequest(phone,{
      vendorGate:async()=>enabled(),
      abuseAllowed:async()=>await allowPublicMutation({
        scope:"vendor-whatsapp-otp-request",identity:phone,
        limit:3,windowMs:15*60*1000,
      }),
      reserveVendorPurpose:async(value,purpose)=>Boolean(await reserveAuthOtpPurpose(value,purpose)),
      initiateSupabaseOtp:async(value)=>{
        // Supabase generates the OTP; the verified, independently gated Send
        // SMS hook must deliver it by WhatsApp. Never supply channel="sms".
        const {error}=await publicClient().auth.signInWithOtp({
          phone:value,options:{shouldCreateUser:true},
        });
        return error?"uncertain":"initiated";
      },
    });
    if(outcome.kind!=="initiated")
      return respond({ok:false,code:"OTP_REQUEST_UNAVAILABLE"},409);
    return respond({ok:true,code:"OTP_REQUEST_INITIATED",deliveryConfirmed:false},202);
  }catch{return respond({ok:false,code:"OTP_REQUEST_UNAVAILABLE"},503);}
}
export function GET():Response{return respond({ok:false,code:"METHOD_NOT_ALLOWED"},405);}
