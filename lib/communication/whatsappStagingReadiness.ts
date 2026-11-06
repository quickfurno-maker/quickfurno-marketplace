/**
 * QuickFurno F9 — read-only, no-send two-WABA Staging readiness decision.
 *
 * Deliberately CANNOT emit "GO": readiness in Core is distinct from external
 * Meta quality, verified signed Auth-Hook configuration, consented device proof
 * and Owner release approval. Never treat a claimed environment flag as proof.
 * Non-secret provider identifiers only; no tokens, numbers or OTP content.
 */
import {
  WHATSAPP_AUTH_LANE_IDENTITIES,
  isExactWhatsappSenderForLane,
  type WhatsappAuthLane,
} from "./whatsappAuthLaneIsolation";

export interface ProviderAccountSnapshot {
  readonly id?: string | null;
  readonly provider_key?: string | null;
  readonly channel?: string | null;
  readonly phone_number_reference?: string | null;
  readonly business_account_reference?: string | null;
  readonly readiness_status?: string | null;
  readonly configuration_status?: string | null;
  readonly webhook_status?: string | null;
  readonly health_status?: string | null;
  readonly billing_status?: string | null;
  readonly account_alias?: string | null;
}
export interface RuntimePolicySnapshot {
  readonly provider_key?: string | null;
  readonly channel?: string | null;
  readonly activation_status?: string | null;
  readonly outbound_enabled?: boolean | null;
  readonly webhook_processing_enabled?: boolean | null;
}
export interface TemplateMappingSnapshot {
  readonly template_key?: string | null;
  readonly provider_template_id?: string | null;
  readonly provider_template_name?: string | null;
  readonly provider_key?: string | null;
  readonly channel?: string | null;
  readonly is_active?: boolean | null;
  readonly approval_status?: string | null;
}
export interface AutomationSnapshot {
  readonly automation_key?: string | null;
  readonly is_operationally_enabled?: boolean | null;
}
export interface WhatsappStagingSnapshot {
  readonly accounts: readonly ProviderAccountSnapshot[];
  readonly runtimePolicies: readonly RuntimePolicySnapshot[];
  readonly mappings: readonly TemplateMappingSnapshot[];
  readonly automations: readonly AutomationSnapshot[];
}
const PROVIDER = "meta_whatsapp_cloud";
const OTP = Object.freeze({
  client: { key: "client_login_otp", name: "qf_client_auth_otp", id: "1793889608370870" },
  vendor: { key: "vendor_login_otp", name: "qf_vendor_auth_otp", id: "1640977640737783" },
});
export type StagingReadinessReason =
  | "missing_or_mixed_client_account"
  | "missing_or_mixed_vendor_account"
  | "unexpected_provider_account_rows"
  | "runtime_policy_unavailable"
  | "runtime_messaging_inactive"
  | "unexpected_runtime_activation"
  | "client_otp_mapping_missing_or_mismatched"
  | "vendor_otp_mapping_missing_or_mismatched"
  | "unexpected_otp_mapping_activation"
  | "client_otp_automation_missing"
  | "vendor_otp_automation_missing"
  | "unexpected_otp_automation_activation"
  | "provider_health_unverified"
  | "vendor_meta_quality_red_or_unverified"
  | "signed_runtime_hook_unverified"
  | "consented_handset_delivery_unverified"
  | "external_owner_go_required";
export interface WhatsappStagingAssessment {
  readonly mode: "READ_ONLY";
  readonly releaseVerdict: "HOLD";
  readonly canSendOtp: false;
  readonly canApproveVendor: false;
  readonly twoSenderInventoryValid: boolean;
  readonly dormantConfigValid: boolean;
  readonly blockers: readonly StagingReadinessReason[];
  readonly clients: { readonly lane: "client"; readonly accountRegistered: boolean; readonly readiness: string };
  readonly vendors: { readonly lane: "vendor"; readonly accountRegistered: boolean; readonly readiness: string };
}
function matches(
  account: ProviderAccountSnapshot,
  lane: WhatsappAuthLane,
): boolean {
  return account.provider_key === PROVIDER &&
    account.channel === "whatsapp" &&
    isExactWhatsappSenderForLane(lane, {
      wabaId: account.business_account_reference ?? "",
      phoneNumberId: account.phone_number_reference ?? "",
    });
}
export function assessWhatsappStagingReadiness(
  snapshot: WhatsappStagingSnapshot,
): WhatsappStagingAssessment {
  const reasons: StagingReadinessReason[] = [];
  const accounts=Array.isArray(snapshot?.accounts)?snapshot.accounts:[];
  const policies=Array.isArray(snapshot?.runtimePolicies)?snapshot.runtimePolicies:[];
  const mappings=Array.isArray(snapshot?.mappings)?snapshot.mappings:[];
  const automations=Array.isArray(snapshot?.automations)?snapshot.automations:[];
  const client=accounts.filter(a=>matches(a,"client"));
  const vendor=accounts.filter(a=>matches(a,"vendor"));
  const clientOK=client.length===1 && client[0].readiness_status==="disabled";
  const vendorOK=vendor.length===1 && vendor[0].readiness_status==="disabled";
  if(!clientOK)reasons.push("missing_or_mixed_client_account");
  if(!vendorOK)reasons.push("missing_or_mixed_vendor_account");
  if(accounts.length!==2)reasons.push("unexpected_provider_account_rows");
  const runtime=policies.filter(p=>p.provider_key===PROVIDER&&p.channel==="whatsapp");
  if(runtime.length!==1)reasons.push("runtime_policy_unavailable");
  const policy=runtime[0];
  const policyDormant=Boolean(policy&&policy.activation_status==="disabled"&&
    policy.outbound_enabled===false&&policy.webhook_processing_enabled===false);
  if(!policyDormant) {
    if(policy?.outbound_enabled===true||policy?.webhook_processing_enabled===true||
      policy?.activation_status==="active")reasons.push("unexpected_runtime_activation");
    else reasons.push("runtime_policy_unavailable");
  }
  if(policyDormant)reasons.push("runtime_messaging_inactive");

  for(const lane of ["client","vendor"] as const){
    const o=OTP[lane];
    const rows=mappings.filter(m=>m.template_key===o.key);
    if(rows.length!==1||rows[0].provider_key!==PROVIDER||
      rows[0].channel!=="whatsapp"||
      rows[0].provider_template_name!==o.name||
      rows[0].provider_template_id!==o.id||
      rows[0].approval_status!=="approved"){
      reasons.push(lane==="client"?"client_otp_mapping_missing_or_mismatched":"vendor_otp_mapping_missing_or_mismatched");
    }
    if(rows.some(m=>m.is_active!==false))reasons.push("unexpected_otp_mapping_activation");
    const matches=automations.filter(a=>a.automation_key===o.key);
    if(matches.length!==1)reasons.push(lane==="client"?"client_otp_automation_missing":"vendor_otp_automation_missing");
    if(matches.some(a=>a.is_operationally_enabled!==false))
      reasons.push("unexpected_otp_automation_activation");
  }
  const healthVerified=accounts.length===2 &&
    accounts.every(a=>a.health_status==="healthy"&&a.billing_status==="active"&&a.webhook_status==="verified");
  if(!healthVerified)reasons.push("provider_health_unverified");
  // Meta's current vendor quality was RED. A DB row or operator env flag
  // cannot replace independently sourced, date-bound quality evidence.
  reasons.push("vendor_meta_quality_red_or_unverified");
  reasons.push("signed_runtime_hook_unverified");
  reasons.push("consented_handset_delivery_unverified");
  reasons.push("external_owner_go_required");

  const unique=Object.freeze([...new Set(reasons)]);
  const valid=clientOK&&vendorOK&&accounts.length===2;
  const configValid=valid&&policyDormant&&mappings.length===2&&automations.length===2&&
    !unique.some(x=>x.endsWith("mismatched")||x.startsWith("unexpected_")||x.endsWith("_missing"));
  return {
    mode:"READ_ONLY",releaseVerdict:"HOLD",canSendOtp:false,canApproveVendor:false,
    twoSenderInventoryValid:valid,dormantConfigValid:configValid,blockers:unique,
    clients:{lane:"client",accountRegistered:client.length===1,readiness:client[0]?.readiness_status??"unknown"},
    vendors:{lane:"vendor",accountRegistered:vendor.length===1,readiness:vendor[0]?.readiness_status??"unknown"},
  };
}
