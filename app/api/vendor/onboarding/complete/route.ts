/**
 * Complete vendor signup from a WhatsApp-verified Supabase Auth OTP session.
 * No password, email-auth fallback, client OTP, public vendor insert, lead,
 * payment, credit mutation or provider send. OFF until separate Staging gates.
 */
import "server-only";
import { enrollPendingVendorAfterWhatsappOtp } from "@/services/vendorAtomicSignupService";
import { readBoundedVendorJson } from "@/lib/vendors/readBoundedVendorJson";
import { normalizeVerifiedVendorMobile } from "@/lib/vendors/vendorContactContract";
import { isValidOptionalGstin,hasVendorRegistrationConsent } from "@/lib/vendors/vendorSignupPolicy";
import type { VendorRegistrationInput } from "@/lib/types";

export const runtime="nodejs";
export const dynamic="force-dynamic";
const TOKEN=/^[0-9]{6,8}$/;
const ALLOWED=new Set([
 "business_name","owner_name","phone","whatsapp_number","email","city",
 "service_categories","gst_number","registration_consent_accepted",
 "google_place_id","google_city","formatted_address","office_address_line1",
 "office_address_line2","office_state","office_city","office_landmark",
 "office_latitude","office_longitude","base_area","areas_covered",
 "covers_full_city","years_experience","experience","starting_price",
 "team_size","monthly_capacity","business_type","selected_category",
 "selected_subcategories","sublocality","neighborhood","area_normalized",
 "source_url","utm_source","utm_medium","utm_campaign",
 "aarohi_acquisition_token"
]);
const respond=(body:unknown,status:number)=>Response.json(body,{
 status,headers:{"cache-control":"no-store,max-age=0","x-content-type-options":"nosniff"},
});
const enabled=()=>process.env.QF_VENDOR_ATOMIC_SIGNUP_MODE==="staging" &&
 process.env.QF_VENDOR_OTP_VERIFY_MODE==="staging" &&
 process.env.QF_VENDOR_OTP_EVIDENCE_READ_ENABLED==="staging" &&
 process.env.QF_VENDOR_WHATSAPP_PROVIDER_CERTIFIED==="staging" &&
 process.env.QF_VENDOR_SHARED_SIGNED_HOOK_CERTIFIED==="staging";
function sameOrigin(request:Request):boolean{
 const origin=request.headers.get("origin");
 try{return Boolean(origin&&new URL(origin).origin===new URL(request.url).origin);}
 catch{return false;}
}
const provider=async():Promise<string|null>=>{
 if(!enabled())return null;
 const p=process.env.QF_VENDOR_TRUSTED_WHATSAPP_PROVIDER;
 return p==="meta_whatsapp_cloud" ? p : null;
};

export async function POST(request:Request):Promise<Response>{
 if(!enabled())return respond({ok:false,code:"VENDOR_SIGNUP_NOT_YET_AVAILABLE"},503);
 if(!sameOrigin(request))return respond({ok:false,code:"ORIGIN_REQUIRED"},403);
 if(request.headers.get("content-type")?.split(";")[0].trim()!=="application/json")
   return respond({ok:false,code:"INVALID_CONTENT_TYPE"},415);

 try{
  const bounded=await readBoundedVendorJson(request,8192);
  if(!bounded.ok)return respond({ok:false,code:
   bounded.reason==="too_large"?"INVALID_REQUEST_SIZE":"INVALID_SIGNUP"},bounded.reason==="too_large"?413:400);
  const incoming:unknown=bounded.value;
  if(!incoming||typeof incoming!=="object"||Array.isArray(incoming))
   return respond({ok:false,code:"INVALID_SIGNUP"},400);
  const body=incoming as Record<string,unknown>;
  if(Object.keys(body).sort().join(",")!=="mobile,registration,token"||
     typeof body.mobile!=="string"||!normalizeVerifiedVendorMobile(body.mobile)||
     typeof body.token!=="string"||!TOKEN.test(body.token)||
     !body.registration||typeof body.registration!=="object"||Array.isArray(body.registration))
    return respond({ok:false,code:"INVALID_SIGNUP"},400);
  const raw=body.registration as Record<string,unknown>;
  if(Object.keys(raw).some(key=>!ALLOWED.has(key))||
     raw.phone!==body.mobile||
     !hasVendorRegistrationConsent(raw.registration_consent_accepted)||
     !isValidOptionalGstin(raw.gst_number)||
     typeof raw.business_name!=="string"||raw.business_name.trim().length<2||
     typeof raw.owner_name!=="string"||raw.owner_name.trim().length<2||
     typeof raw.city!=="string"||typeof raw.google_place_id!=="string"||
     typeof raw.formatted_address!=="string"||
     typeof raw.office_address_line1!=="string"||
     typeof raw.office_state!=="string"||
     !Array.isArray(raw.service_categories)||
     raw.service_categories.length<1||raw.service_categories.length>20||
     raw.service_categories.some(x=>typeof x!=="string"))
    return respond({ok:false,code:"INVALID_SIGNUP"},400);
  const result=await enrollPendingVendorAfterWhatsappOtp(
   {mobile:body.mobile,token:body.token},
   raw as unknown as VendorRegistrationInput,
   {resolveApprovedProvider:provider},
  );
  if(!result.ok)return respond({ok:false,code:result.code},409);
  return respond({
   ok:true,code:result.outcome==="resume_existing"?"VENDOR_EXISTING":"VENDOR_PENDING",
   vendorId:result.vendorId,status:"Pending",
   isActive:false,acceptingLeads:false,creditsGranted:false,
   requiresOwnerVerification:true,
  },200);
 }catch{return respond({ok:false,code:"VENDOR_SIGNUP_UNAVAILABLE"},503);}
}
export function GET():Response{return respond({ok:false,code:"METHOD_NOT_ALLOWED"},405);}
