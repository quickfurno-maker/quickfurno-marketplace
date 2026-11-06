/**
 * Anisha's server-only Meta WhatsApp OTP adapter.
 * Shared signed Supabase Hook is the only caller; purpose was verified and
 * claimed privately. Client/Riya env and sender never used by this adapter.
 *
 * Purpose and account gating are independent of the existing client flow.
 * No SMS fallback, queues or resend; Core keeps OTP in memory only.
 */
import "server-only";
import {adminClient} from "../lib/supabase";
import type {AuthNetworkDeadline} from "../lib/auth/hookDeadline";
import type {CommunicationIntent} from "../lib/communication/types";
import {
  deliverVendorWhatsappOtp as deliverVendorOtpPure,
  hasValidVendorAccountIdentity,isApprovedVendorAutomation,isApprovedVendorOtpBinding,
  VENDOR_OTP_MESSAGE_TYPE,VENDOR_OTP_PROVIDER_KEY,VENDOR_OTP_TEMPLATE_KEY,
  type VendorOtpInput,type VendorOtpOutcome,type VendorGate,type VendorSender,
} from "../lib/communication/vendorWhatsappOtpTransport";
import {createRuntimeCommunicationService} from "./runtimeCommunicationService";
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Three independent DB authorities must agree exactly before send:
 * correct WABA/phone, ACTIVE vendor OTP automation, approved correct
 * provider-owned template. Missing/duplicate/error/mismatch all deny. */
export const readVendorOtpGate:VendorGate=async()=>{
  try{
    const db=adminClient();
    const [a,m,c]=await Promise.all([
      db.from("communication_provider_accounts")
        .select("id,provider_key,channel,business_account_reference,phone_number_reference,readiness_status,configuration_status,phone_number_status,webhook_status,billing_status,health_status,business_verification_status")
        .eq("provider_key",VENDOR_OTP_PROVIDER_KEY).eq("channel","whatsapp")
        .eq("phone_number_reference","1088396637681784").limit(2),
      db.from("communication_provider_template_mappings")
        .select("template_key,provider_key,channel,provider_template_id,provider_template_name,language,provider_category,approval_status,is_active,variables_schema")
        .eq("provider_key",VENDOR_OTP_PROVIDER_KEY).eq("template_key",VENDOR_OTP_TEMPLATE_KEY)
        .eq("language","en").limit(2),
      db.from("communication_automation_catalog")
        .select("automation_key,lane,channel,provider_required,template_key,readiness_status,is_operationally_enabled")
        .eq("automation_key",VENDOR_OTP_MESSAGE_TYPE).limit(2),
    ]);
    if(a.error||m.error||c.error||!Array.isArray(a.data)||a.data.length!==1||
      !Array.isArray(m.data)||m.data.length!==1||
      !Array.isArray(c.data)||c.data.length!==1)return {ok:false};
    const row=a.data[0];
    if(!hasValidVendorAccountIdentity(row)||typeof row.id!=="string"||
      !UUID.test(row.id)||!isApprovedVendorOtpBinding(m.data[0])||
      !isApprovedVendorAutomation(c.data[0]))return {ok:false};
    return {ok:true,providerAccountId:row.id};
  }catch{return {ok:false}}
};

/** Reuse the one canonical Core sender, consent and provider-account
 * attribution boundary. An independently created Meta provider is prohibited. */
export const sendVendorOtpThroughCore:VendorSender=async(
  intent:CommunicationIntent,deadline:AuthNetworkDeadline,
  vendorEnv:Readonly<Record<string,string|undefined>>,
)=>{
  const service=createRuntimeCommunicationService(vendorEnv);
  if(!service.ok)return {ok:false};
  try{
    const sent=await service.data.send(intent,{authDeadline:deadline});
    if(!sent.ok)return {ok:false};
    return {ok:true,status:sent.data.status,provider:sent.data.provider,
      providerAccountId:sent.data.provider_account_id};
  }catch{return {ok:false}}
};

/** Callable only after the shared Supabase Hook has checked signature,
 * parsed payload, and atomically claimed vendor_login purpose. */
export async function deliverVendorWhatsappOtp(input:VendorOtpInput):
  Promise<VendorOtpOutcome>{
  return deliverVendorOtpPure(input,process.env,{
    gate:readVendorOtpGate,send:sendVendorOtpThroughCore,
  });
}
