/**
 * F9 VOX Owner/AAL2 only: READ-ONLY actual two-WABA Staging readiness.
 *
 * No activation, Meta API, OTP send, token, customer data or provider secret.
 * Explicit Staging flag OFF by default, independently verified Owner before
 * and after privileged DB reads, never cache an Owner's control-plane status.
 * Readiness is intentionally HOLD until separate real E2E/Meta proof + GO.
 */
import "server-only";
import {adminClient} from "@/lib/supabase";
import {assessWhatsappStagingReadiness} from "@/lib/communication/whatsappStagingReadiness";
import {verifyVoxOwnerBearer} from "@/services/vox/verifiedStaffBearer";

export const runtime="nodejs";
export const dynamic="force-dynamic";
const respond=(body:unknown,status:number)=>Response.json(body,{
  status,
  headers:{"cache-control":"private, no-store, max-age=0",
    "vary":"Authorization","x-content-type-options":"nosniff"},
});
const disabled=()=>respond({ok:false,code:"OWNER_WHATSAPP_READINESS_DISABLED"},503);
const unavailable=()=>respond({ok:false,code:"OWNER_WHATSAPP_READINESS_UNAVAILABLE"},503);
const forbidden=()=>respond({ok:false,code:"OWNER_AAL2_REQUIRED"},403);

export async function GET(request:Request):Promise<Response>{
  if(process.env.VOX_OWNER_WHATSAPP_READINESS_ENABLED!=="staging")return disabled();
  const url=new URL(request.url);
  if(url.hash||url.searchParams.size!==0)return respond({ok:false,code:"INVALID_QUERY"},400);
  try{
    const owner=await verifyVoxOwnerBearer(request.headers.get("authorization"));
    if(!owner)return forbidden();
    const db=adminClient();
    const [a,p,m,c]=await Promise.all([
      db.from("communication_provider_accounts")
        .select("provider_key,channel,id,account_alias,phone_number_reference,business_account_reference,readiness_status,configuration_status,webhook_status,health_status,billing_status")
        .eq("provider_key","meta_whatsapp_cloud").eq("channel","whatsapp").limit(3),
      db.from("communication_provider_runtime_policies")
        .select("provider_key,channel,activation_status,outbound_enabled,webhook_processing_enabled")
        .eq("provider_key","meta_whatsapp_cloud").eq("channel","whatsapp").limit(2),
      db.from("communication_provider_template_mappings")
        .select("template_key,provider_template_id,provider_template_name,provider_key,channel,is_active,approval_status")
        .in("template_key",["client_login_otp","vendor_login_otp"]).limit(3),
      db.from("communication_automation_catalog")
        .select("automation_key,is_operationally_enabled")
        .in("automation_key",["client_login_otp","vendor_login_otp"]).limit(3),
    ]);
    if(a.error||p.error||m.error||c.error||!a.data||!p.data||!m.data||!c.data)
      return unavailable();
    const assessed=assessWhatsappStagingReadiness({
      accounts:a.data,runtimePolicies:p.data,mappings:m.data,automations:c.data,
    });
    const fresh=await verifyVoxOwnerBearer(request.headers.get("authorization"));
    if(fresh!==owner)return forbidden();
    return respond({
      ok:true,schema:"qf.vox.owner.whatsapp-staging-readiness.v1",
      ...assessed,
      evidenceScope:"staging_core_database_only",
      requiresIndependentMetaQualityCheck:true,
      requiresSignedHookAndConsentedHandsetE2E:true,
    },200);
  }catch{return unavailable()}
}
export function POST():Response{return respond({ok:false,code:"READ_ONLY"},405)}
export function PUT():Response{return respond({ok:false,code:"READ_ONLY"},405)}
export function PATCH():Response{return respond({ok:false,code:"READ_ONLY"},405)}
export function DELETE():Response{return respond({ok:false,code:"READ_ONLY"},405)}
