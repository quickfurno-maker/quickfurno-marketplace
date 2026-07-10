// ============================================================================
// QuickFurno — lib/communication/providers/exotelConfig.ts   (Phase 5F-C3-A)
//
// SERVER-ONLY environment contract for the Exotel SMS adapter.
//
// NO EXOTEL ACCOUNT EXISTS YET. Nothing here provisions one, and a complete config is
// still not permission to send: an SMS dispatch would additionally have to pass the C2 SMS
// runtime infrastructure gate (which has no Exotel policy, account, mapping or canary row)
// AND Phase 5F-C1's fallback decision, explicit active failure rule, attempt budget and
// atomic attempt claim. India DLT registration is EXTERNAL and PENDING (Phase 5F-C3-C).
//
// SECURITY — the cardinal rule, inherited verbatim from the Meta config loader:
// this module NEVER logs, throws, persists, or returns a secret VALUE. Every failure path
// reports only missing/invalid VARIABLE NAMES. There is no `console` call in this file.
//
// SERVER-ONLY is enforced twice:
//   • every variable name is bare (never `NEXT_PUBLIC_*`), so Next.js cannot inline it
//     into a client bundle; and
//   • if the loader is somehow evaluated in a browser, or if a `NEXT_PUBLIC_EXOTEL_*`
//     variable exists at all (meaning a credential was exposed to the bundle), the config
//     is reported INCOMPLETE and the provider is not a candidate.
//
// FAIL CLOSED — a missing or blank REQUIRED variable, or an invalid OPTIONAL one, makes the
// config incomplete. An incomplete config never silently degrades to mock and never yields
// a provider candidate. All resolution is LAZY (called at runtime), so an absent production
// credential can never break the Next.js build.
// ============================================================================

/** The one provider identity the Exotel adapter ever reports, and its selection mode. */
export const EXOTEL_SMS_PROVIDER_KEY = "exotel_sms";

/** Global default endpoint. Mumbai (India) accounts use `api.in.exotel.com`. */
export const DEFAULT_EXOTEL_SUBDOMAIN = "api.exotel.com";
export const EXOTEL_MUMBAI_SUBDOMAIN = "api.in.exotel.com";

/** A configured subdomain must be an Exotel host. This is an SSRF fence: a hostile value
 *  would otherwise redirect the Basic credentials to an attacker-controlled server. */
export const EXOTEL_SUBDOMAIN_SUFFIX = ".exotel.com";

// Timeout bounds (ms). The AUTH ceiling is deliberately well below a Supabase HTTP Auth
// Hook's execution window, matching the Meta adapter's authentication lane.
export const EXOTEL_AUTH_TIMEOUT_MIN_MS = 500;
export const EXOTEL_AUTH_TIMEOUT_MAX_MS = 4000;
/** Aligned with the Meta adapter's `HEALTH_TIMEOUT_MIN_MS`; declared here, never imported. */
export const EXOTEL_HEALTH_TIMEOUT_MIN_MS = 1000;
export const EXOTEL_HEALTH_TIMEOUT_MAX_MS = 15000;
export const DEFAULT_EXOTEL_AUTH_TIMEOUT_MS = 3000;
export const DEFAULT_EXOTEL_HEALTH_TIMEOUT_MS = 5000;

/** Blank or absent ANY of these → config incomplete → NOT a candidate → fail closed. */
export const EXOTEL_REQUIRED_ENV_VARS: readonly string[] = Object.freeze([
  "EXOTEL_ACCOUNT_SID",
  "EXOTEL_API_KEY",
  "EXOTEL_API_TOKEN",
  "EXOTEL_SENDER_ID",
]);

/** Absent → defaulted. PRESENT BUT INVALID → config incomplete (never silently ignored). */
export const EXOTEL_OPTIONAL_ENV_VARS: readonly string[] = Object.freeze([
  "EXOTEL_SUBDOMAIN",
  "EXOTEL_DLT_ENTITY_ID",
  "EXOTEL_DLT_TEMPLATE_ID",
  "EXOTEL_AUTH_HTTP_TIMEOUT_MS",
  "EXOTEL_HEALTH_HTTP_TIMEOUT_MS",
]);

/** Any variable matching this proves a credential was exposed to the client bundle. */
export const PUBLIC_EXOTEL_ENV_PATTERN = /^NEXT_PUBLIC_.*EXOTEL/i;

// ----------------------------------------------------------------------------
// Value shapes. Every pattern is a STRUCTURAL check on a value that is never echoed.
// ----------------------------------------------------------------------------
const ACCOUNT_SID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

/**
 * The API key and token are concatenated as `key:token` into a Basic credential, so a `:`
 * would make the pair ambiguous, and whitespace/control characters would permit header
 * injection. Printable ASCII excluding `:` and space is the only accepted alphabet.
 */
const API_CREDENTIAL_PATTERN = /^[\x21-\x39\x3B-\x7E]{8,256}$/;

/** A DLT-registered alphanumeric sender header (a.k.a. sender id). */
const SENDER_ID_PATTERN = /^[A-Za-z0-9]{3,11}$/;

/** Lowercase DNS hostname — no scheme, no port, no path, no embedded credentials. */
const HOSTNAME_PATTERN = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/;

/** Exotel DLT entity/template ids are numeric strings. Passthrough only — never derived. */
const DLT_ID_PATTERN = /^[0-9]{1,32}$/;

type EnvSource = Record<string, string | undefined>;

function readTrimmed(env: EnvSource, name: string): string | null {
  const raw = env[name];
  return typeof raw === "string" && raw.trim() !== "" ? raw.trim() : null;
}

function readRequired(
  env: EnvSource,
  name: string,
  pattern: RegExp,
  missing: string[],
  invalid: string[]
): string | null {
  const v = readTrimmed(env, name);
  if (v === null) {
    missing.push(name);
    return null;
  }
  if (!pattern.test(v)) {
    invalid.push(name);
    return null;
  }
  return v;
}

/** Absent → `null` (the caller substitutes a default). Present but malformed → invalid. */
function readOptional(
  env: EnvSource,
  name: string,
  pattern: RegExp,
  invalid: string[]
): string | null {
  const v = readTrimmed(env, name);
  if (v === null) return null;
  if (!pattern.test(v)) {
    invalid.push(name);
    return null;
  }
  return v;
}

/** Absent → the supplied default. Present but out of bounds / non-integer → invalid. */
function readOptionalBoundedInt(
  env: EnvSource,
  name: string,
  min: number,
  max: number,
  fallback: number,
  invalid: string[]
): number {
  const v = readTrimmed(env, name);
  if (v === null) return fallback;
  const n = Number(v);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < min || n > max) {
    invalid.push(name);
    return fallback;
  }
  return n;
}

function readSubdomain(env: EnvSource, invalid: string[]): string {
  const raw = readTrimmed(env, "EXOTEL_SUBDOMAIN");
  if (raw === null) return DEFAULT_EXOTEL_SUBDOMAIN;
  const host = raw.toLowerCase();
  if (!HOSTNAME_PATTERN.test(host) || !host.endsWith(EXOTEL_SUBDOMAIN_SUFFIX)) {
    invalid.push("EXOTEL_SUBDOMAIN");
    return DEFAULT_EXOTEL_SUBDOMAIN;
  }
  return host;
}

// ----------------------------------------------------------------------------
// Result vocabulary — NAMES only, never values
// ----------------------------------------------------------------------------
export interface ExotelConfig {
  readonly accountSid: string;
  readonly apiKey: string;
  readonly apiToken: string;
  readonly senderId: string;
  readonly subdomain: string;
  /** Opaque DLT passthrough. The adapter forwards them; it never derives or invents them. */
  readonly dltEntityId: string | null;
  readonly dltTemplateId: string | null;
  readonly authHttpTimeoutMs: number;
  readonly healthHttpTimeoutMs: number;
}

export type ExotelConfigFailure = {
  readonly ok: false;
  readonly missing: readonly string[];
  readonly invalid: readonly string[];
};

export type ExotelConfigResult = { readonly ok: true; readonly config: ExotelConfig } | ExotelConfigFailure;

/**
 * A log/ledger-safe description of a failed resolution — variable NAMES only. No value of
 * any environment variable can reach this string.
 */
export function describeExotelConfigFailure(result: ExotelConfigFailure): string {
  const parts: string[] = [];
  if (result.missing.length > 0) parts.push(`missing: ${result.missing.join(", ")}`);
  if (result.invalid.length > 0) parts.push(`invalid: ${result.invalid.join(", ")}`);
  return `Exotel SMS config incomplete (${parts.join("; ") || "unknown"}).`;
}

/**
 * The first variable NAME responsible for an incomplete config, for a fail-closed reason
 * field. Missing variables outrank invalid ones: an absent credential is the more
 * fundamental fault.
 */
export function firstExotelConfigVariable(result: ExotelConfigFailure): string {
  return result.missing[0] ?? result.invalid[0] ?? "EXOTEL_ACCOUNT_SID";
}

/** True when a `NEXT_PUBLIC_EXOTEL_*` variable exists — a credential reached the bundle. */
export function publicExotelVariables(env: EnvSource): string[] {
  return Object.keys(env)
    .filter((name) => PUBLIC_EXOTEL_ENV_PATTERN.test(name))
    .sort();
}

/**
 * Resolve the Exotel SMS config. LAZY: called per request, never at module import.
 *
 * Resolving a COMPLETE config makes Exotel a selectable CANDIDATE and nothing more.
 * Provider readiness never authorizes a send (the C2 rule, preserved verbatim).
 */
export function resolveExotelConfig(env: EnvSource = process.env): ExotelConfigResult {
  const missing: string[] = [];
  const invalid: string[] = [];

  // Server-only fence 1: a browser must never resolve a credential.
  if (typeof window !== "undefined") {
    return { ok: false, missing: [], invalid: ["EXOTEL_SERVER_ONLY"] };
  }
  // Server-only fence 2: a NEXT_PUBLIC_* Exotel variable means a credential was inlined
  // into the client bundle. Refuse the whole config rather than use the server-side one.
  const exposed = publicExotelVariables(env);
  if (exposed.length > 0) return { ok: false, missing: [], invalid: exposed };

  const accountSid = readRequired(env, "EXOTEL_ACCOUNT_SID", ACCOUNT_SID_PATTERN, missing, invalid);
  const apiKey = readRequired(env, "EXOTEL_API_KEY", API_CREDENTIAL_PATTERN, missing, invalid);
  const apiToken = readRequired(env, "EXOTEL_API_TOKEN", API_CREDENTIAL_PATTERN, missing, invalid);
  const senderId = readRequired(env, "EXOTEL_SENDER_ID", SENDER_ID_PATTERN, missing, invalid);

  const subdomain = readSubdomain(env, invalid);
  const dltEntityId = readOptional(env, "EXOTEL_DLT_ENTITY_ID", DLT_ID_PATTERN, invalid);
  const dltTemplateId = readOptional(env, "EXOTEL_DLT_TEMPLATE_ID", DLT_ID_PATTERN, invalid);
  const authHttpTimeoutMs = readOptionalBoundedInt(
    env, "EXOTEL_AUTH_HTTP_TIMEOUT_MS",
    EXOTEL_AUTH_TIMEOUT_MIN_MS, EXOTEL_AUTH_TIMEOUT_MAX_MS, DEFAULT_EXOTEL_AUTH_TIMEOUT_MS, invalid
  );
  const healthHttpTimeoutMs = readOptionalBoundedInt(
    env, "EXOTEL_HEALTH_HTTP_TIMEOUT_MS",
    EXOTEL_HEALTH_TIMEOUT_MIN_MS, EXOTEL_HEALTH_TIMEOUT_MAX_MS, DEFAULT_EXOTEL_HEALTH_TIMEOUT_MS, invalid
  );

  if (missing.length > 0 || invalid.length > 0) return { ok: false, missing, invalid };

  return {
    ok: true,
    config: {
      accountSid: accountSid as string,
      apiKey: apiKey as string,
      apiToken: apiToken as string,
      senderId: senderId as string,
      subdomain,
      dltEntityId,
      dltTemplateId,
      authHttpTimeoutMs,
      healthHttpTimeoutMs,
    },
  };
}

/** True only when every required variable is present and every present variable is valid. */
export function isExotelConfigComplete(env: EnvSource = process.env): boolean {
  return resolveExotelConfig(env).ok;
}
