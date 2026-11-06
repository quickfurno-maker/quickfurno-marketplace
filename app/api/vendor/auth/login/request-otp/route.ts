/**
 * Begin returning-vendor WhatsApp OTP. A non-enumerating response deliberately
 * never reveals whether a mobile number has a vendor membership.
 * No user auto-creation, SMS fallback or client-purpose OTP.
 */
import "server-only";
import { publicClient } from "@/lib/supabase";
import { allowPublicMutation } from "@/lib/security/publicMutationRateLimit";
import { coordinateVendorOtpRequest } from "@/lib/identity/vendorOtpRequestCoordination";
import { readBoundedVendorJson } from "@/lib/vendors/readBoundedVendorJson";
import { reserveAuthOtpPurpose } from "@/services/authOtpPurposeReservationService";
import { vendorWhatsappReturningModeEnabled, eligibleReturningVendorPhone } from "@/services/returningWhatsappVendorLoginService";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const MOBILE = /^[6-9][0-9]{9}$/;
const response = (body: unknown, status: number) => Response.json(body, {
  status, headers: {"cache-control":"no-store, max-age=0","x-content-type-options":"nosniff"},
});
const sameOrigin = (r: Request) => {
  try { const origin = r.headers.get("origin"); return Boolean(origin &&
    new URL(origin).origin === new URL(r.url).origin); } catch { return false; }
};

export async function POST(request: Request): Promise<Response> {
  if (!vendorWhatsappReturningModeEnabled())
    return response({ok:false,code:"VENDOR_WHATSAPP_LOGIN_NOT_AVAILABLE"},503);
  if (!sameOrigin(request)) return response({ok:false,code:"ORIGIN_REQUIRED"},403);
  if (request.headers.get("content-type")?.split(";")[0].trim()!=="application/json")
    return response({ok:false,code:"INVALID_CONTENT_TYPE"},415);

  const bounded = await readBoundedVendorJson(request,1024).catch(()=>null);
  if (!bounded?.ok) return response({ok:false,code:"INVALID_REQUEST"},400);
  const value = bounded.value;
  if (!value || typeof value!=="object" || Array.isArray(value))
    return response({ok:false,code:"INVALID_REQUEST"},400);
  const body = value as Record<string,unknown>;
  if (Object.keys(body).length!==1 || typeof body.mobile!=="string" || !MOBILE.test(body.mobile))
    return response({ok:false,code:"INVALID_REQUEST"},400);

  const phone = "+91"+body.mobile;
  // All enrolled and unenrolled phone numbers receive the same safe response.
  // Fresh purpose lease ensures the signed Meta Hook cannot deliver a client OTP.
  try {
    await coordinateVendorOtpRequest(phone,{
      vendorGate:async()=>vendorWhatsappReturningModeEnabled(),
      abuseAllowed:async()=>allowPublicMutation({
        scope:"vendor-returning-whatsapp-login",identity:phone,
        limit:3,windowMs:15*60*1000,
      }),
      reserveVendorPurpose:async (value,purpose)=>
        (await eligibleReturningVendorPhone(body.mobile as string)) &&
        Boolean(await reserveAuthOtpPurpose(value,purpose)),
      initiateSupabaseOtp:async value=>{
        const {error} = await publicClient().auth.signInWithOtp({
          phone:value,options:{shouldCreateUser:false},
        });
        return error?"uncertain":"initiated";
      },
    });
  } catch { /* uncertainty never permits a blind second send */ }
  return response({ok:true,code:"OTP_REQUEST_ACCEPTED",deliveryConfirmed:false},202);
}

export function GET():Response {
  return response({ok:false,code:"METHOD_NOT_ALLOWED"},405);
}
