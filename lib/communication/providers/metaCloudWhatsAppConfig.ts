// ============================================================================
// QuickFurno — lib/communication/providers/metaCloudWhatsAppConfig.ts  (Phase 5F-B)
//
// SERVER-ONLY environment contract for the Meta WhatsApp Cloud API adapter.
//
// SECURITY — the cardinal rule: this module NEVER logs, throws, persists, or returns
// a secret VALUE. Every failure path reports only missing/invalid VARIABLE NAMES.
//
// PURPOSE-SPECIFIC LOADERS (Phase 5F-B correction) — each operation requires ONLY
// the variables it genuinely needs, so GET webhook verification works with just the
// verify token, POST signature verification works with just the app secret, outbound
// sending needs no app secret / verify token, and health needs no verify token.
//
// FAIL CLOSED — `meta_cloud` with incomplete/invalid config never silently falls back
// to mock. In production, an ABSENT mode fails closed (no accidental implicit mock).
// All resolution is LAZY (called at runtime), so a missing production credential
// never breaks the Next.js build.
// ============================================================================

export const WHATSAPP_PROVIDER_MODE_ENV = "WHATSAPP_PROVIDER_MODE";

export type WhatsAppProviderMode = "mock" | "meta_cloud";

/** Conservative Graph API version format, e.g. `v19.0`. Must be explicitly set. */
export const GRAPH_API_VERSION_PATTERN = /^v\d{1,3}\.\d{1,3}$/;

// Timeout bounds (ms). The AUTH ceiling is deliberately well below a Supabase HTTP
// Auth Hook's execution window, leaving room for signature verification, the DB
// operational gate, mapping, ledger writes, response normalization, and the hook
// response. The BUSINESS ceiling is larger; health reuses the business bounds.
export const AUTH_TIMEOUT_MIN_MS = 500;
export const AUTH_TIMEOUT_MAX_MS = 4000;
export const BUSINESS_TIMEOUT_MIN_MS = 1000;
export const BUSINESS_TIMEOUT_MAX_MS = 30000;
export const HEALTH_TIMEOUT_MIN_MS = BUSINESS_TIMEOUT_MIN_MS;
export const HEALTH_TIMEOUT_MAX_MS = BUSINESS_TIMEOUT_MAX_MS;

// Safe runtime defaults when a provider runtime is built for an operation that does
// not carry that timeout (e.g. a webhook-only provider never sends).
export const DEFAULT_AUTH_TIMEOUT_MS = 3000;
export const DEFAULT_BUSINESS_TIMEOUT_MS = 10000;
export const DEFAULT_HEALTH_TIMEOUT_MS = 10000;

type EnvSource = Record<string, string | undefined>;

function readTrimmed(env: EnvSource, name: string): string | null {
  const raw = env[name];
  return typeof raw === "string" && raw.trim() !== "" ? raw.trim() : null;
}

function readVersion(env: EnvSource, name: string, missing: string[], invalid: string[]): string | null {
  const v = readTrimmed(env, name);
  if (v === null) { missing.push(name); return null; }
  if (!GRAPH_API_VERSION_PATTERN.test(v)) { invalid.push(name); return null; }
  return v;
}

function readBoundedInt(
  env: EnvSource, name: string, min: number, max: number, missing: string[], invalid: string[]
): number | null {
  const v = readTrimmed(env, name);
  if (v === null) { missing.push(name); return null; }
  const n = Number(v);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < min || n > max) { invalid.push(name); return null; }
  return n;
}

// ----------------------------------------------------------------------------
// Result vocabulary
// ----------------------------------------------------------------------------
export type ConfigFailure = {
  readonly ok: false;
  readonly missing: readonly string[];
  readonly invalid: readonly string[];
};
export type ConfigResult<T> = ({ readonly ok: true } & T) | ConfigFailure;

/** A ledger/log-safe description of a failed resolution — variable NAMES only. */
export function describeConfigFailure(res: ConfigFailure): string {
  const parts: string[] = [];
  if (res.missing.length > 0) parts.push(`missing: ${res.missing.join(", ")}`);
  if (res.invalid.length > 0) parts.push(`invalid: ${res.invalid.join(", ")}`);
  return `Meta WhatsApp Cloud config incomplete (${parts.join("; ") || "unknown"}).`;
}

// ----------------------------------------------------------------------------
// 1. Provider mode (production fail-closed)
// ----------------------------------------------------------------------------
export type ProviderModeDecision =
  | { readonly ok: true; readonly mode: WhatsAppProviderMode; readonly explicit: boolean }
  | { readonly ok: false; readonly reason: "mode_required_in_production" | "invalid_mode"; readonly variable: string };

/**
 * Resolve the provider mode with a production-safe default.
 *   • NODE_ENV != production + absent → mock (allowed, implicit).
 *   • NODE_ENV = production + absent → FAIL CLOSED (no accidental implicit mock).
 *   • explicit mock/meta_cloud → that mode.
 *   • unrecognised value → fail closed (never mock).
 * Lazy: only called at runtime, so an absent production var never breaks the build.
 */
export function resolveProviderModeDecision(env: EnvSource = process.env): ProviderModeDecision {
  const raw = readTrimmed(env, WHATSAPP_PROVIDER_MODE_ENV);
  const isProd = readTrimmed(env, "NODE_ENV") === "production";
  if (raw === null) {
    if (isProd) return { ok: false, reason: "mode_required_in_production", variable: WHATSAPP_PROVIDER_MODE_ENV };
    return { ok: true, mode: "mock", explicit: false };
  }
  if (raw === "mock") return { ok: true, mode: "mock", explicit: true };
  if (raw === "meta_cloud") return { ok: true, mode: "meta_cloud", explicit: true };
  return { ok: false, reason: "invalid_mode", variable: WHATSAPP_PROVIDER_MODE_ENV };
}

/** Back-compat helper: the mode string, or "invalid_mode". Non-production semantics. */
export function resolveWhatsAppProviderMode(env: EnvSource = process.env): WhatsAppProviderMode | "invalid_mode" {
  const raw = readTrimmed(env, WHATSAPP_PROVIDER_MODE_ENV);
  if (raw === null || raw === "mock") return "mock";
  if (raw === "meta_cloud") return "meta_cloud";
  return "invalid_mode";
}

// ----------------------------------------------------------------------------
// 2. Outbound send config (no app secret / verify token)
// ----------------------------------------------------------------------------
export interface MetaOutboundConfig {
  readonly accessToken: string;
  readonly phoneNumberId: string;
  readonly wabaId: string;
  readonly graphApiVersion: string;
  readonly authHttpTimeoutMs: number;
  readonly businessHttpTimeoutMs: number;
}

export function resolveOutboundMetaConfig(env: EnvSource = process.env): ConfigResult<{ config: MetaOutboundConfig }> {
  const missing: string[] = [];
  const invalid: string[] = [];
  const accessToken = readTrimmed(env, "WHATSAPP_ACCESS_TOKEN") ?? (missing.push("WHATSAPP_ACCESS_TOKEN"), null);
  const phoneNumberId = readTrimmed(env, "WHATSAPP_PHONE_NUMBER_ID") ?? (missing.push("WHATSAPP_PHONE_NUMBER_ID"), null);
  const wabaId = readTrimmed(env, "WHATSAPP_WABA_ID") ?? (missing.push("WHATSAPP_WABA_ID"), null);
  const graphApiVersion = readVersion(env, "WHATSAPP_GRAPH_API_VERSION", missing, invalid);
  const authHttpTimeoutMs = readBoundedInt(env, "WHATSAPP_AUTH_HTTP_TIMEOUT_MS", AUTH_TIMEOUT_MIN_MS, AUTH_TIMEOUT_MAX_MS, missing, invalid);
  const businessHttpTimeoutMs = readBoundedInt(env, "WHATSAPP_HTTP_TIMEOUT_MS", BUSINESS_TIMEOUT_MIN_MS, BUSINESS_TIMEOUT_MAX_MS, missing, invalid);
  if (missing.length || invalid.length) return { ok: false, missing, invalid };
  return {
    ok: true,
    config: {
      accessToken: accessToken as string, phoneNumberId: phoneNumberId as string, wabaId: wabaId as string,
      graphApiVersion: graphApiVersion as string,
      authHttpTimeoutMs: authHttpTimeoutMs as number, businessHttpTimeoutMs: businessHttpTimeoutMs as number,
    },
  };
}

// ----------------------------------------------------------------------------
// 3. GET webhook verification config (verify token only)
// ----------------------------------------------------------------------------
export interface MetaWebhookVerifyConfig { readonly webhookVerifyToken: string }

export function resolveWebhookVerifyConfig(env: EnvSource = process.env): ConfigResult<{ config: MetaWebhookVerifyConfig }> {
  const v = readTrimmed(env, "WHATSAPP_WEBHOOK_VERIFY_TOKEN");
  if (v === null) return { ok: false, missing: ["WHATSAPP_WEBHOOK_VERIFY_TOKEN"], invalid: [] };
  return { ok: true, config: { webhookVerifyToken: v } };
}

// ----------------------------------------------------------------------------
// 4. POST webhook signature config (app secret only)
// ----------------------------------------------------------------------------
export interface MetaWebhookSignatureConfig { readonly appSecret: string }

export function resolveWebhookSignatureConfig(env: EnvSource = process.env): ConfigResult<{ config: MetaWebhookSignatureConfig }> {
  const v = readTrimmed(env, "WHATSAPP_APP_SECRET");
  if (v === null) return { ok: false, missing: ["WHATSAPP_APP_SECRET"], invalid: [] };
  return { ok: true, config: { appSecret: v } };
}

// ----------------------------------------------------------------------------
// 5. Health-check config (no verify token, no app secret)
// ----------------------------------------------------------------------------
export interface MetaHealthConfig {
  readonly accessToken: string;
  readonly phoneNumberId: string;
  readonly graphApiVersion: string;
  readonly healthHttpTimeoutMs: number;
}

export function resolveHealthConfig(env: EnvSource = process.env): ConfigResult<{ config: MetaHealthConfig }> {
  const missing: string[] = [];
  const invalid: string[] = [];
  const accessToken = readTrimmed(env, "WHATSAPP_ACCESS_TOKEN") ?? (missing.push("WHATSAPP_ACCESS_TOKEN"), null);
  const phoneNumberId = readTrimmed(env, "WHATSAPP_PHONE_NUMBER_ID") ?? (missing.push("WHATSAPP_PHONE_NUMBER_ID"), null);
  const graphApiVersion = readVersion(env, "WHATSAPP_GRAPH_API_VERSION", missing, invalid);
  // Health timeout falls back to the business timeout when its own var is absent.
  let healthHttpTimeoutMs: number | null = null;
  if (readTrimmed(env, "WHATSAPP_HEALTH_HTTP_TIMEOUT_MS") !== null) {
    healthHttpTimeoutMs = readBoundedInt(env, "WHATSAPP_HEALTH_HTTP_TIMEOUT_MS", HEALTH_TIMEOUT_MIN_MS, HEALTH_TIMEOUT_MAX_MS, missing, invalid);
  } else {
    healthHttpTimeoutMs = readBoundedInt(env, "WHATSAPP_HTTP_TIMEOUT_MS", BUSINESS_TIMEOUT_MIN_MS, BUSINESS_TIMEOUT_MAX_MS, missing, invalid);
  }
  if (missing.length || invalid.length) return { ok: false, missing, invalid };
  return {
    ok: true,
    config: {
      accessToken: accessToken as string, phoneNumberId: phoneNumberId as string,
      graphApiVersion: graphApiVersion as string, healthHttpTimeoutMs: healthHttpTimeoutMs as number,
    },
  };
}

// ----------------------------------------------------------------------------
// Provider runtime — the fields a MetaCloudWhatsAppProvider instance may need.
// Each is nullable so a provider built for ONE purpose (send vs webhook vs health)
// carries only what that purpose requires; a method fails closed if its field is
// absent. Never a full-credential requirement for a single operation.
// ----------------------------------------------------------------------------
export interface MetaProviderRuntime {
  readonly accessToken: string | null;
  readonly phoneNumberId: string | null;
  readonly wabaId: string | null;
  readonly graphApiVersion: string | null;
  readonly appSecret: string | null;
  readonly authHttpTimeoutMs: number;
  readonly businessHttpTimeoutMs: number;
  readonly healthHttpTimeoutMs: number;
}

export function outboundToRuntime(o: MetaOutboundConfig): MetaProviderRuntime {
  return {
    accessToken: o.accessToken, phoneNumberId: o.phoneNumberId, wabaId: o.wabaId,
    graphApiVersion: o.graphApiVersion, appSecret: null,
    authHttpTimeoutMs: o.authHttpTimeoutMs, businessHttpTimeoutMs: o.businessHttpTimeoutMs,
    healthHttpTimeoutMs: DEFAULT_HEALTH_TIMEOUT_MS,
  };
}

export function webhookSignatureToRuntime(c: MetaWebhookSignatureConfig): MetaProviderRuntime {
  return {
    accessToken: null, phoneNumberId: null, wabaId: null, graphApiVersion: null, appSecret: c.appSecret,
    authHttpTimeoutMs: DEFAULT_AUTH_TIMEOUT_MS, businessHttpTimeoutMs: DEFAULT_BUSINESS_TIMEOUT_MS,
    healthHttpTimeoutMs: DEFAULT_HEALTH_TIMEOUT_MS,
  };
}

export function healthToRuntime(h: MetaHealthConfig): MetaProviderRuntime {
  return {
    accessToken: h.accessToken, phoneNumberId: h.phoneNumberId, wabaId: null, graphApiVersion: h.graphApiVersion,
    appSecret: null, authHttpTimeoutMs: DEFAULT_AUTH_TIMEOUT_MS, businessHttpTimeoutMs: DEFAULT_BUSINESS_TIMEOUT_MS,
    healthHttpTimeoutMs: h.healthHttpTimeoutMs,
  };
}
