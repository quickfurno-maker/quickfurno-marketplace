/**
 * QuickFurno Anisha: dedicated Meta WhatsApp OTP transport.
 *
 * Source-only Staging integration. The public signup form and Supabase Hook
 * cannot supply any sender or Meta account identifiers. Every outbound path
 * must bind to the VENDOR account, never default to Riya, mock, or SMS.
 */
import { createHash } from "node:crypto";
import {
  WHATSAPP_AUTH_LANE_IDENTITIES,
  isExactWhatsappSenderForLane,
} from "./whatsappAuthLaneIsolation";
import { renderWhatsAppTemplateComponents } from "./providers/whatsappTemplateBinding";

export const VENDOR_OTP_PROVIDER_KEY = "meta_whatsapp_cloud";
export const VENDOR_OTP_TEMPLATE_KEY = "vendor_login_otp";
export const VENDOR_OTP_PROVIDER_TEMPLATE_NAME = "qf_vendor_auth_otp";
export const VENDOR_OTP_PROVIDER_TEMPLATE_ID = "1640977640737783";
export const VENDOR_OTP_MESSAGE_TYPE = "vendor_login_otp";
export const VENDOR_OTP_LANGUAGE = "en";

type Env = Readonly<Record<string, string | undefined>>;
type VendorConfigResult =
  | { readonly ok: true; readonly providerEnv: Readonly<Record<string, string | undefined>> }
  | { readonly ok: false; readonly reason: string };

const ID = WHATSAPP_AUTH_LANE_IDENTITIES.vendor;
const GRAPH = /^v\d{1,3}\.\d{1,3}$/;
const SHA256_HEX = /^[a-f0-9]{64}$/;
const RED_CANARY_WINDOW_MS = 15 * 60 * 1000;

/**
 * A RED phone is not automatically disconnected by Meta. The Owner may
 * authorize one explicitly hashed Staging test recipient for at most 15
 * minutes, but provider-enforced quotas/restrictions still apply.
 * Production, absent status, expired approval and unknown quality deny.
 * No global RED opt-in: callers must independently prove recipient match.
 */
export function isApprovedRedVendorOtpCanary(
  env: Env, nowMs: number = Date.now(),
): boolean {
  if (env.QF_RUNTIME_ENV !== "staging" ||
      env.QF_VENDOR_META_QUALITY_RATING !== "RED" ||
      env.QF_VENDOR_META_PHONE_STATUS !== "CONNECTED" ||
      env.QF_VENDOR_RED_CANARY_APPROVED !== "staging" ||
      !SHA256_HEX.test(env.QF_VENDOR_RED_CANARY_PHONE_SHA256 ?? "")) return false;
  const expiryText = env.QF_VENDOR_RED_CANARY_UTC_EXPIRES_AT ?? "";
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(expiryText)) return false;
  const expiresAt = Date.parse(expiryText);
  return Number.isFinite(nowMs) && Number.isFinite(expiresAt) &&
    expiresAt > nowMs && expiresAt - nowMs <= RED_CANARY_WINDOW_MS;
}

export function isApprovedRedVendorOtpRecipient(
  env: Env, phoneE164: string, nowMs: number = Date.now(),
): boolean {
  return isApprovedRedVendorOtpCanary(env,nowMs) &&
    /^\+91[6-9]\d{9}$/.test(phoneE164) &&
    createHash("sha256").update(phoneE164,"utf8").digest("hex") ===
      env.QF_VENDOR_RED_CANARY_PHONE_SHA256;
}

export function prepareVendorOtpProviderEnv(env: Env): VendorConfigResult {
  // This is a SEPARATE operational approval, not an alias for any Client/Riya
  // gate. OFF by default in all production and Staging deployments.
  if (env.QF_RUNTIME_ENV !== "staging" ||
      env.QF_VENDOR_SHARED_SIGNED_HOOK_CERTIFIED !== "staging" ||
      env.QF_VENDOR_WHATSAPP_PROVIDER_CERTIFIED !== "staging" ||
      env.QF_VENDOR_AUTH_LANE_ISOLATION_MODE !== "staging" ||
      env.QF_VENDOR_OTP_REQUEST_MODE !== "staging" ||
      env.QF_VENDOR_REAL_OTP_CANARY_APPROVED !== "staging" ||
      (env.QF_VENDOR_META_QUALITY_RATING !== "GREEN" &&
       !isApprovedRedVendorOtpCanary(env))) {
    return { ok: false, reason: "vendor_otp_canary_disabled" };
  }

  // Vendor OTP uses its own Meta system-user token and its own WABA/phone
  // references. No inherited client token, provider account or app identity.
  const token = env.WHATSAPP_VENDOR_ACCESS_TOKEN;
  const vendorSender = {
    wabaId: env.WHATSAPP_VENDOR_WABA_ID ?? "",
    phoneNumberId: env.WHATSAPP_VENDOR_PHONE_NUMBER_ID ?? "",
  };
  const clientSender = {
    wabaId: env.WHATSAPP_WABA_ID ?? "",
    phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID ?? "",
  };
  if (!token || token.trim().length < 40) {
    return { ok: false, reason: "vendor_credential_missing" };
  }
  if (!isExactWhatsappSenderForLane("vendor", vendorSender)) {
    return { ok: false, reason: "vendor_sender_mismatch" };
  }
  if (!isExactWhatsappSenderForLane("client", clientSender)) {
    return { ok: false, reason: "client_sender_not_isolated" };
  }
  if (vendorSender.wabaId === clientSender.wabaId ||
      vendorSender.phoneNumberId === clientSender.phoneNumberId ||
      env.WHATSAPP_VENDOR_ACCESS_TOKEN === env.WHATSAPP_ACCESS_TOKEN) {
    return { ok: false, reason: "shared_vendor_client_provider" };
  }
  if (env.QF_VENDOR_TRUSTED_WHATSAPP_PROVIDER !== VENDOR_OTP_PROVIDER_KEY) {
    return { ok: false, reason: "vendor_provider_key_mismatch" };
  }
  const graph = env.WHATSAPP_VENDOR_GRAPH_API_VERSION;
  const timeoutMs = Number(env.WHATSAPP_VENDOR_AUTH_HTTP_TIMEOUT_MS);
  if (!graph || !GRAPH.test(graph) || !Number.isInteger(timeoutMs) ||
      timeoutMs < 500 || timeoutMs > 4000) {
    return { ok: false, reason: "vendor_transport_config_invalid" };
  }

  // Minimal override: use the existing, security-hardened Meta adapter,
  // approved-mapping runtime fence, consent layer and durable delivery ledger.
  // Entire snapshot is consumed only inside THIS vendor-only sender path.
  return {
    ok: true,
    providerEnv: Object.freeze({
      ...env,
      WHATSAPP_PROVIDER_MODE: "meta_cloud",
      WHATSAPP_ACCESS_TOKEN: token,
      WHATSAPP_WABA_ID: ID.wabaId,
      WHATSAPP_PHONE_NUMBER_ID: ID.phoneNumberId,
      WHATSAPP_GRAPH_API_VERSION: graph,
      WHATSAPP_AUTH_HTTP_TIMEOUT_MS: String(timeoutMs),
      WHATSAPP_HTTP_TIMEOUT_MS: env.WHATSAPP_VENDOR_HTTP_TIMEOUT_MS ?? "10000",
    }),
  };
}

/** The current Meta AUTHENTICATION copy-code template requires the SAME
 * single OTP in both BODY and BUTTON index 0 (URL subtype). The existing Core
 * renderer proves this exact send-shape before any mapping can be activated.
 */
export const AUTH_OTP_COPY_CODE_MAPPING_SCHEMA = Object.freeze({
  bindingVersion: 2,
  profile: "AUTH_OTP_COPY_CODE",
  bindings: Object.freeze([
    Object.freeze({component:"body",position:1,sourceKey:"otp",parameterType:"text"}),
    Object.freeze({component:"button",position:1,sourceKey:"otp",parameterType:"text",
      buttonIndex:0,buttonSubType:"url"}),
  ]),
});

export function hasCanonicalOtpCopyCodeBinding(schema:unknown):boolean {
  if (!schema || typeof schema !== "object" ||
      !("bindingVersion" in schema) || schema.bindingVersion !== 2 ||
      !("profile" in schema) || schema.profile !== "AUTH_OTP_COPY_CODE") return false;
  const result = renderWhatsAppTemplateComponents(schema,{otp:"123456"});
  if (!result.ok || result.components.length !== 2) return false;
  const [body,button]=result.components;
  return body.type === "body" && body.parameters.length === 1 &&
    body.parameters[0].type === "text" && body.parameters[0].text === "123456" &&
    button.type === "button" && button.sub_type === "url" &&
    button.index === "0" && button.parameters.length === 1 &&
    button.parameters[0].type === "text" && button.parameters[0].text === "123456";
}

export function isApprovedVendorOtpBinding(row: {
  template_key?: unknown;
  provider_key?: unknown;
  channel?: unknown;
  provider_template_id?: unknown;
  provider_template_name?: unknown;
  language?: unknown;
  provider_category?: unknown;
  approval_status?: unknown;
  is_active?: unknown;
  variables_schema?: unknown;
} | null): boolean {
  return Boolean(row &&
    row.template_key === VENDOR_OTP_TEMPLATE_KEY &&
    row.provider_key === VENDOR_OTP_PROVIDER_KEY &&
    row.channel === "whatsapp" &&
    row.provider_template_id === VENDOR_OTP_PROVIDER_TEMPLATE_ID &&
    row.provider_template_name === VENDOR_OTP_PROVIDER_TEMPLATE_NAME &&
    row.language === VENDOR_OTP_LANGUAGE &&
    String(row.provider_category).toLowerCase() === "authentication" &&
    row.approval_status === "approved" && row.is_active === true &&
    hasCanonicalOtpCopyCodeBinding(row.variables_schema));
}

export function isApprovedVendorAutomation(row: {
  automation_key?: unknown;
  lane?: unknown;
  channel?: unknown;
  provider_required?: unknown;
  template_key?: unknown;
  readiness_status?: unknown;
  is_operationally_enabled?: unknown;
} | null): boolean {
  return Boolean(row &&
    row.automation_key === VENDOR_OTP_MESSAGE_TYPE &&
    row.lane === "authentication" &&
    row.channel === "whatsapp" &&
    row.template_key === VENDOR_OTP_TEMPLATE_KEY &&
    row.provider_required === VENDOR_OTP_PROVIDER_KEY &&
    row.readiness_status === "active" &&
    row.is_operationally_enabled === true);
}

export function hasValidVendorAccountIdentity(row: {
  provider_key?: unknown;
  channel?: unknown;
  business_account_reference?: unknown;
  phone_number_reference?: unknown;
  readiness_status?: unknown;
  health_status?: unknown;
  configuration_status?: unknown;
  webhook_status?: unknown;
  phone_number_status?: unknown;
  billing_status?: unknown;
  business_verification_status?: unknown;
} | null): boolean {
  return Boolean(row && row.provider_key === VENDOR_OTP_PROVIDER_KEY &&
    row.channel === "whatsapp" &&
    row.business_account_reference === ID.wabaId &&
    row.phone_number_reference === ID.phoneNumberId &&
    row.readiness_status === "provider_ready" &&
    row.configuration_status === "complete" &&
    row.phone_number_status === "connected" &&
    row.webhook_status === "verified" &&
    row.billing_status === "active" &&
    row.health_status === "healthy" &&
    row.business_verification_status === "verified");
}

/** Pure signed-vendor OTP orchestrator, dependency-injected for hostile QA.
 * The server adapter provides real DB gates and the canonical Core Meta sender.
 * No API/network/secret/OTP persistence happens in this module.
 */
import {ephemeralAuthDestination,type CommunicationIntent} from "./types";
import type {AuthNetworkDeadline} from "../auth/hookDeadline";
export type VendorOtpOutcomeKind =
  "delivered"|"delivery_failed"|"delivery_uncertain"|"in_progress"|"service_unavailable";
export type VendorOtpOutcome={readonly kind:VendorOtpOutcomeKind;readonly dispatchAttempted:boolean};
export type VendorOtpInput={
  readonly phoneE164:string;readonly otp:string;readonly authUserId:string;
  readonly signedWebhookId:string;readonly deadline:AuthNetworkDeadline;
};
type VendorEnv=Readonly<Record<string,string|undefined>>;
export type VendorGate = () => Promise<
  {readonly ok:true;readonly providerAccountId:string}|{readonly ok:false}
>;
export type VendorSender=(
  intent:CommunicationIntent,deadline:AuthNetworkDeadline,vendorEnv:VendorEnv
)=>Promise<{readonly ok:boolean;readonly status?:string;
  readonly provider?:string;readonly providerAccountId?:string|null}>;
export type VendorOtpDeps={readonly gate:VendorGate;readonly send:VendorSender};

const BLOCKED:VendorOtpOutcome={kind:"service_unavailable",dispatchAttempted:false};
const FAILED:VendorOtpOutcome={kind:"delivery_failed",dispatchAttempted:false};
const PHONE=/^\+91[6-9]\d{9}$/;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const WEBHOOK=/^[A-Za-z0-9._:-]{1,200}$/;
const OTP=/^\d{6,8}$/;
const DELIVERED=new Set(["accepted","sent","delivered","read"]);

/** Never accepts a browser purpose or sender; called only by the trusted
 * signed Auth Hook after server-HMAC vendor_login purpose claim. */
export async function deliverVendorWhatsappOtp(
  input:VendorOtpInput,env:VendorEnv,deps:VendorOtpDeps,
):Promise<VendorOtpOutcome>{
  if(!input||!PHONE.test(input.phoneE164)||!UUID.test(input.authUserId)||
    !WEBHOOK.test(input.signedWebhookId)||!OTP.test(input.otp)||
    !input.deadline||typeof input.deadline.remainingNetworkBudgetMs!=="function"||
    input.deadline.remainingNetworkBudgetMs()<500)return FAILED;
  const cfg=prepareVendorOtpProviderEnv(env);
  if(!cfg.ok)return BLOCKED;
  // A RED rating can never authorize arbitrary vendor phones; narrow,
  // short-lived approval remains distinct from the signed-hook DB gate.
  if(env.QF_VENDOR_META_QUALITY_RATING==="RED" &&
     !isApprovedRedVendorOtpRecipient(env,input.phoneE164))return BLOCKED;
  let gate:Awaited<ReturnType<VendorGate>>;
  try{gate=await deps.gate()}catch{return BLOCKED}
  if(!gate.ok||!UUID.test(gate.providerAccountId))return BLOCKED;
  const intent:CommunicationIntent={
    type:VENDOR_OTP_MESSAGE_TYPE,lane:"authentication",channel:"whatsapp",
    recipient_type:"vendor",recipient_id:null,
    destination_source:ephemeralAuthDestination(input.phoneE164),
    template_key:VENDOR_OTP_TEMPLATE_KEY,variables:{otp:input.otp},
    entity_type:"auth_user",entity_id:input.authUserId,
    correlation_id:input.signedWebhookId,
    idempotency_key:`${VENDOR_OTP_MESSAGE_TYPE}:${input.signedWebhookId}`,
    priority:"critical",scheduled_at:null,policy_decision_id:null,
    metadata:{transport_origin:"signed_supabase_send_sms_hook",auth_purpose:"vendor_login"},
  };
  let sent:Awaited<ReturnType<VendorSender>>;
  try{sent=await deps.send(intent,input.deadline,cfg.providerEnv)}
  catch{return {kind:"delivery_uncertain",dispatchAttempted:true}}
  if(!sent.ok)return {kind:"delivery_failed",dispatchAttempted:true};
  if(sent.provider!==VENDOR_OTP_PROVIDER_KEY||
    sent.providerAccountId!==gate.providerAccountId)
    return {kind:"delivery_failed",dispatchAttempted:true};
  if(sent.status==="outcome_unknown"||typeof sent.status!=="string")
    return {kind:"delivery_uncertain",dispatchAttempted:true};
  if(DELIVERED.has(sent.status))return {kind:"delivered",dispatchAttempted:true};
  if(sent.status==="queued"||sent.status==="dispatching")
    return {kind:"in_progress",dispatchAttempted:true};
  return {kind:"delivery_failed",dispatchAttempted:true};
}
