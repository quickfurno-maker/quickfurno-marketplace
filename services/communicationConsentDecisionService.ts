// ============================================================================
// QuickFurno — services/communicationConsentDecisionService.ts  (Phase 5F-D2-C, server-only)
//
// The SOLE read-only communication-consent + suppression PRECEDENCE authority. Given a
// (channel, scope, destinationHash, identityConfidence, principal), it returns a sanitized,
// type-safe DISPOSITION. Consent truth belongs to QuickFurno Core — Meta, n8n, Jarvis,
// campaign workflows and provider adapters must NEVER decide consent independently.
//
// SERVER-ONLY. This module imports the RLS-bypassing `adminClient` and lives in the service
// layer; it exposes no API route and is imported by no client code. The repository's server-only
// mechanism is service-layer placement + the documented server-only `adminClient` (there is no
// `import "server-only"` convention anywhere in the repo), and this module follows it.
//
// READ-ONLY. It reads communication_suppressions (always) and communication_preferences (only for
// an EXACT identity). It performs NO write: no insert/update/upsert/delete/rpc. The injected DB
// dependency exposes read methods only; the production adapter uses select-only queries with NO
// .single()/.maybeSingle()/.limit() so duplicate rows are PRESERVED for integrity detection.
//
// SEMANTIC FENCE. `marketing_opted_in` / `no_consent_objection` mean the CONSENT requirement
// passed — NOT that a message may be sent. Provider capability, runtime activation, template
// validity, the authentication action + transport policy, and the transactional basis are all
// SEPARATE authorities that must also pass. D2-C owns consent + suppression precedence ONLY.
//
// FAILURE MODEL (the D1-B truth principle). An infrastructure read failure is a distinct
// AUTHORITY_LOOKUP_FAILED — never collapsed into a success disposition. A DB row that violates the
// schema's own vocabulary/shape (a malformed UUID, a malformed timestamp, a duplicate physically-
// active row, a contradictory state) is a second-fence AUTHORITY_INTEGRITY_VIOLATION and is NEVER
// silently treated as expired/unknown. No raw DB error / SQLSTATE / row / destination is exposed.
// ============================================================================

import { adminClient } from "../lib/supabase";
import { CONSENT_POLICY_VERSION } from "../lib/communication/consentPolicy";

// ----------------------------------------------------------------------------
// Public input contract (narrow; no plaintext destination / phone / payload / token)
// ----------------------------------------------------------------------------
export type CommunicationChannel = "whatsapp" | "sms" | "rcs";
export type CommunicationConsentScope = "authentication" | "transactional" | "marketing";
export type ConsentIdentityConfidence = "exact" | "ambiguous" | "unknown";
export type ConsentPrincipalType = "client" | "vendor" | "admin";
export type ConsentPrincipal = { readonly type: ConsentPrincipalType; readonly id: string } | null;

export interface CommunicationConsentDecisionInput {
  readonly channel: CommunicationChannel;
  readonly scope: CommunicationConsentScope;
  /** sha256(canonical E.164) lowercase hex. NEVER a plaintext phone / wa_id / MSISDN. */
  readonly destinationHash: string;
  readonly identityConfidence: ConsentIdentityConfidence;
  /** Present iff identityConfidence === 'exact'; null for ambiguous/unknown. */
  readonly principal: ConsentPrincipal;
  /** Injected evaluation instant; when omitted, deps.now() is used. Frozen to ms internally. */
  readonly evaluatedAt?: Date;
}

// ----------------------------------------------------------------------------
// Public output contract (discriminated; consent semantics ≠ final send authorization)
// ----------------------------------------------------------------------------
export type ConsentDisposition = "blocked" | "marketing_opted_in" | "no_consent_objection" | "unknown";
export type ReconsentEligibility =
  | "self_service_allowed"
  | "admin_only"
  | "provider_resolution_required"
  | "not_reversible"
  | "not_applicable";
export type ConsentSuppressionReason =
  | "user_stop"
  | "provider_block"
  | "hard_bounce"
  | "complaint"
  | "admin"
  | "legal"
  | "abuse"
  | "unspecified"
  | null;

/** Every reason code the authority can emit — a closed literal union, never an arbitrary string. */
export type ConsentReasonCode =
  | "global_suppression_active"
  | "scope_suppression_active"
  | "preference_blocked"
  | "preference_marketing_opted_in"
  | "preference_authentication_no_objection"
  | "preference_transactional_no_objection"
  | "preference_policy_version_mismatch"
  | "preference_policy_version_mismatch_no_objection"
  | "no_marketing_preference"
  | "ambiguous_identity_no_marketing_authority"
  | "unknown_identity_no_marketing_authority"
  | "authentication_no_consent_objection"
  | "transactional_no_consent_objection";

export interface ConsentDecisionSuccess {
  readonly ok: true;
  readonly disposition: ConsentDisposition;
  readonly reasonCode: ConsentReasonCode;
  readonly policyVersion: typeof CONSENT_POLICY_VERSION;
  readonly principalConfidence: ConsentIdentityConfidence;
  readonly matchedPreferenceId: string | null;
  readonly matchedSuppressionId: string | null;
  readonly suppressionReason: ConsentSuppressionReason;
  readonly reconsent: ReconsentEligibility;
}
export interface ConsentDecisionFailure {
  readonly ok: false;
  readonly code: "INVALID_DECISION_INPUT" | "AUTHORITY_LOOKUP_FAILED" | "AUTHORITY_INTEGRITY_VIOLATION";
}
export type ConsentDecisionOutcome = ConsentDecisionSuccess | ConsentDecisionFailure;

// ----------------------------------------------------------------------------
// Minimal internal row types (only the columns the decision needs)
// ----------------------------------------------------------------------------
export interface ConsentSuppressionRow {
  readonly id: string;
  readonly scope: string;
  readonly reason: string;
  readonly policy_version: string;
  readonly is_active: boolean;
  readonly expires_at: string | null;
  readonly deactivated_at: string | null;
}
export interface ConsentPreferenceRow {
  readonly id: string;
  readonly state: string;
  readonly policy_version: string;
  readonly consented_at: string | null;
  readonly withdrawn_at: string | null;
}

// ----------------------------------------------------------------------------
// Injected READ-ONLY dependencies (production adapter binds select-only queries)
// ----------------------------------------------------------------------------
export interface ConsentDecisionDeps {
  readonly now: () => Date;
  readonly readSuppressions: (q: {
    readonly destinationHash: string;
    readonly channel: string;
    readonly scopes: readonly string[];
  }) => Promise<ConsentSuppressionRow[]>;
  readonly readExactPreference: (q: {
    readonly principalType: string;
    readonly principalId: string;
    readonly channel: string;
    readonly scope: string;
  }) => Promise<ConsentPreferenceRow[]>;
}

/**
 * Normalize a Supabase read response into a cardinality-PRESERVING array. Error ALWAYS takes
 * precedence (thrown → the caller maps it to AUTHORITY_LOOKUP_FAILED); null data → []. Duplicate
 * rows are preserved verbatim so the service can detect an integrity violation. Exported for tests.
 */
export function normalizeSupabaseReadResult<T>(res: { readonly data: readonly T[] | null; readonly error: unknown }): T[] {
  if (res.error) throw res.error;
  return res.data ? [...res.data] : [];
}

/** LAZY: constructed per request. SELECT-ONLY — no .single()/.maybeSingle()/.limit()/write. */
export function defaultConsentDecisionDeps(): ConsentDecisionDeps {
  return {
    now: () => new Date(),
    readSuppressions: async ({ destinationHash, channel, scopes }) => {
      const { data, error } = await adminClient()
        .from("communication_suppressions")
        .select("id, scope, reason, policy_version, is_active, expires_at, deactivated_at")
        .eq("destination_hash", destinationHash)
        .eq("channel", channel)
        .eq("is_active", true)
        .in("scope", scopes as string[]);
      return normalizeSupabaseReadResult<ConsentSuppressionRow>({ data: data as ConsentSuppressionRow[] | null, error });
    },
    readExactPreference: async ({ principalType, principalId, channel, scope }) => {
      const { data, error } = await adminClient()
        .from("communication_preferences")
        .select("id, state, policy_version, consented_at, withdrawn_at")
        .eq("principal_type", principalType)
        .eq("principal_id", principalId)
        .eq("channel", channel)
        .eq("scope", scope);
      return normalizeSupabaseReadResult<ConsentPreferenceRow>({ data: data as ConsentPreferenceRow[] | null, error });
    },
  };
}

// ----------------------------------------------------------------------------
// Vocabularies + shapes
// ----------------------------------------------------------------------------
const CHANNELS: readonly string[] = ["whatsapp", "sms", "rcs"];
const SCOPES: readonly string[] = ["authentication", "transactional", "marketing"];
const CONFIDENCES: readonly string[] = ["exact", "ambiguous", "unknown"];
const PRINCIPAL_TYPES: readonly string[] = ["client", "vendor", "admin"];
const SUPPRESSION_SCOPES: readonly string[] = ["global", "marketing", "transactional"];
const SUPPRESSION_REASONS: readonly string[] = [
  "unspecified", "user_stop", "provider_block", "hard_bounce", "complaint", "admin", "legal", "abuse",
];
const HEX64 = /^[0-9a-f]{64}$/;
const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const POLICY_VERSION_SHAPE = /^[A-Za-z0-9._:-]{1,64}$/;

const fail = (code: ConsentDecisionFailure["code"]): ConsentDecisionFailure => ({ ok: false, code });

// STRICT timezone-qualified RFC3339 (Supabase timestamptz). Requires a `T` separator, seconds, an
// explicit timezone (`Z` or `±HH:MM`), and at most microsecond (1–6 digit) fractional precision.
// Anchored — timezone-less, date-only, locale, and trailing/leading text never match. A match is NOT
// sufficient: components are range- and calendar-validated below.
const RFC3339_TS = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?(Z|([+-])(\d{2}):(\d{2}))$/;

function daysInMonth(year: number, month: number): number {
  if (month === 2) return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0 ? 29 : 28;
  return [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
}

/**
 * Parse a nullable DB timestamptz string to an IMMUTABLE ms. Requires a STRICT, timezone-qualified,
 * calendar-valid RFC3339 string — NOT lenient Date.parse. `null` → a valid null. `undefined`, a
 * non-string, a timezone-less/date-only/locale value, an impossible calendar date, an out-of-range
 * component, or an invalid offset is corruption → `{ ok:false }` (the caller maps it to integrity).
 */
function parseNullableTimestamp(v: unknown): { readonly ok: true; readonly ms: number | null } | { readonly ok: false } {
  if (v === null) return { ok: true, ms: null };
  if (typeof v !== "string") return { ok: false };            // undefined / non-string is corruption
  const m = RFC3339_TS.exec(v);
  if (!m) return { ok: false };                               // not timezone-qualified RFC3339
  const year = Number(m[1]), month = Number(m[2]), day = Number(m[3]);
  const hour = Number(m[4]), minute = Number(m[5]), second = Number(m[6]);
  if (year < 1 || month < 1 || month > 12) return { ok: false };
  if (day < 1 || day > daysInMonth(year, month)) return { ok: false };  // rejects Feb 29 non-leap, Apr 31, …
  if (hour > 23 || minute > 59 || second > 59) return { ok: false };    // no leap second
  const millis = m[7] ? Number((m[7] + "000").slice(0, 3)) : 0;
  // Calendar round-trip via setUTC* (avoids the Date 0–99 year remap; catches any normalization).
  const d = new Date(0);
  d.setUTCFullYear(year, month - 1, day);
  d.setUTCHours(hour, minute, second, millis);
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day
      || d.getUTCHours() !== hour || d.getUTCMinutes() !== minute || d.getUTCSeconds() !== second) return { ok: false };
  // Apply the explicit timezone offset to derive the final UTC instant.
  let offsetMinutes = 0;
  if (m[8] !== "Z") {
    const offHour = Number(m[10]), offMin = Number(m[11]);
    if (offHour > 23 || offMin > 59) return { ok: false };
    offsetMinutes = (m[9] === "+" ? 1 : -1) * (offHour * 60 + offMin);
  }
  const ms = d.getTime() - offsetMinutes * 60_000;
  if (!Number.isFinite(ms)) return { ok: false };
  return { ok: true, ms };
}

/**
 * The exact (non-global) suppression scope a request can be blocked by, or null. AUTHENTICATION
 * has NO exact suppression scope — it is affected ONLY by a global suppression. A marketing/
 * transactional suppression must NEVER block authentication.
 */
function exactSuppressionScope(scope: CommunicationConsentScope): string | null {
  if (scope === "marketing") return "marketing";
  if (scope === "transactional") return "transactional";
  return null; // authentication has NO exact suppression scope
}

/** Candidate suppression scopes queried for a request: always global, plus the exact scope if any. */
function candidateScopes(scope: CommunicationConsentScope): readonly string[] {
  const exact = exactSuppressionScope(scope);
  return exact === null ? ["global"] : ["global", exact];
}

/** Re-consent eligibility for an active suppression's reason. Never mutates anything. */
function reconsentFor(reason: string): ReconsentEligibility {
  if (reason === "user_stop") return "self_service_allowed";
  if (reason === "provider_block" || reason === "hard_bounce") return "provider_resolution_required";
  // complaint / admin / legal / abuse / unspecified
  return "admin_only";
}

// ----------------------------------------------------------------------------
// Input validation (never touches the DB for invalid input)
// ----------------------------------------------------------------------------
function isValidInput(input: CommunicationConsentDecisionInput): boolean {
  if (!input || typeof input !== "object") return false;
  if (!CHANNELS.includes(input.channel)) return false;
  if (!SCOPES.includes(input.scope)) return false;
  if (!CONFIDENCES.includes(input.identityConfidence)) return false;
  if (typeof input.destinationHash !== "string" || !HEX64.test(input.destinationHash)) return false;
  if (input.evaluatedAt !== undefined && (!(input.evaluatedAt instanceof Date) || Number.isNaN(input.evaluatedAt.getTime()))) return false;
  if (input.identityConfidence === "exact") {
    const p = input.principal;
    if (!p || !PRINCIPAL_TYPES.includes(p.type) || typeof p.id !== "string" || !UUID_SHAPE.test(p.id)) return false;
  } else if (input.principal !== null) {
    return false;
  }
  return true;
}

// ----------------------------------------------------------------------------
// Suppression precedence (validate ALL rows → group → duplicate → expiry → global-first)
// ----------------------------------------------------------------------------
interface NormalizedSuppression {
  readonly id: string;
  readonly scope: string;
  readonly reason: string;
  readonly expiresAtMs: number | null;
}
type SuppressionEval =
  | { readonly kind: "blocked"; readonly id: string; readonly reason: ConsentSuppressionReason; readonly reasonCode: ConsentReasonCode }
  | { readonly kind: "clear" }
  | { readonly kind: "integrity" }
  | { readonly kind: "lookup_failed" };

/** Full structural validation of one returned suppression row → normalized row, or null (integrity). */
function validateSuppressionRow(r: ConsentSuppressionRow): NormalizedSuppression | null {
  if (!r || typeof r !== "object") return null;
  if (typeof r.id !== "string" || !UUID_SHAPE.test(r.id)) return null;
  if (!SUPPRESSION_SCOPES.includes(r.scope)) return null;
  if (!SUPPRESSION_REASONS.includes(r.reason)) return null;
  if (typeof r.policy_version !== "string" || !POLICY_VERSION_SHAPE.test(r.policy_version)) return null;
  if (r.is_active !== true) return null;              // the active query must return is_active=true
  if (r.deactivated_at !== null) return null;         // an active row has deactivated_at NULL
  const exp = parseNullableTimestamp(r.expires_at);
  if (!exp.ok) return null;                           // malformed expires_at is corruption, NOT "expired"
  return { id: r.id, scope: r.scope, reason: r.reason, expiresAtMs: exp.ms };
}

/** Effective at read time using the FROZEN evaluation instant (ms). null expiry never expires. */
function isEffective(n: NormalizedSuppression, evaluatedAtMs: number): boolean {
  return n.expiresAtMs === null || n.expiresAtMs > evaluatedAtMs;
}

async function evaluateSuppressions(
  input: CommunicationConsentDecisionInput,
  evaluatedAtMs: number,
  deps: ConsentDecisionDeps
): Promise<SuppressionEval> {
  const scopes = candidateScopes(input.scope);
  let rows: ConsentSuppressionRow[];
  try {
    rows = await deps.readSuppressions({ destinationHash: input.destinationHash, channel: input.channel, scopes });
  } catch {
    return { kind: "lookup_failed" };
  }
  if (!Array.isArray(rows)) return { kind: "integrity" };
  // (1) Validate EVERY returned row COMPLETELY before any expiry/precedence — a corrupt row is an
  // integrity violation even if it "appears expired" or a valid global would otherwise win.
  const normalized: NormalizedSuppression[] = [];
  for (const r of rows) {
    const n = validateSuppressionRow(r);
    if (n === null) return { kind: "integrity" };
    normalized.push(n);
  }
  // (2-3) Group physically-active rows by scope; a duplicate physical row is an integrity violation
  // (the live partial-unique index permits only one is_active row per destination/channel/scope) —
  // detected BEFORE expiry, so a duplicate where one row is expired is still caught.
  const exact = exactSuppressionScope(input.scope);
  const globals = normalized.filter((n) => n.scope === "global");
  const scoped = exact === null ? [] : normalized.filter((n) => n.scope === exact);
  if (globals.length > 1) return { kind: "integrity" };
  if (scoped.length > 1) return { kind: "integrity" };
  // (4-5) Expiry, then global-first precedence. An expired (non-effective) row never blocks.
  const globalEff = globals.find((n) => isEffective(n, evaluatedAtMs));
  if (globalEff) return { kind: "blocked", id: globalEff.id, reason: globalEff.reason as ConsentSuppressionReason, reasonCode: "global_suppression_active" };
  const scopedEff = scoped.find((n) => isEffective(n, evaluatedAtMs));
  if (scopedEff) return { kind: "blocked", id: scopedEff.id, reason: scopedEff.reason as ConsentSuppressionReason, reasonCode: "scope_suppression_active" };
  return { kind: "clear" };
}

// ----------------------------------------------------------------------------
// Exact preference load (only for EXACT identity; full row integrity fence)
// ----------------------------------------------------------------------------
interface NormalizedPreference {
  readonly id: string;
  readonly state: "allowed" | "blocked";
  readonly policyVersion: string;
}
type PreferenceEval =
  | { readonly kind: "none" }
  | { readonly kind: "row"; readonly row: NormalizedPreference }
  | { readonly kind: "integrity" }
  | { readonly kind: "lookup_failed" };

/** Full structural + state/timestamp validation of one preference row → normalized, or null. */
function validatePreferenceRow(r: ConsentPreferenceRow): NormalizedPreference | null {
  if (!r || typeof r !== "object") return null;
  if (typeof r.id !== "string" || !UUID_SHAPE.test(r.id)) return null;
  if (r.state !== "allowed" && r.state !== "blocked") return null;
  if (typeof r.policy_version !== "string" || !POLICY_VERSION_SHAPE.test(r.policy_version)) return null;
  const consented = parseNullableTimestamp(r.consented_at);
  const withdrawn = parseNullableTimestamp(r.withdrawn_at);
  if (!consented.ok || !withdrawn.ok) return null;    // malformed timestamp is corruption
  if (r.state === "allowed") {
    if (consented.ms === null || withdrawn.ms !== null) return null; // allowed ⟹ consented set, withdrawn null
  } else {
    if (consented.ms !== null || withdrawn.ms === null) return null; // blocked ⟹ consented null, withdrawn set
  }
  return { id: r.id, state: r.state, policyVersion: r.policy_version };
}

async function loadExactPreference(
  input: CommunicationConsentDecisionInput,
  deps: ConsentDecisionDeps
): Promise<PreferenceEval> {
  if (input.identityConfidence !== "exact" || input.principal === null) return { kind: "none" };
  const principalType = input.principal ? input.principal.type : "";
  const principalId = input.principal ? input.principal.id : "";
  let rows: ConsentPreferenceRow[];
  try {
    rows = await deps.readExactPreference({ principalType, principalId, channel: input.channel, scope: input.scope });
  } catch {
    return { kind: "lookup_failed" };
  }
  if (!Array.isArray(rows)) return { kind: "integrity" };
  if (rows.length === 0) return { kind: "none" };
  if (rows.length > 1) return { kind: "integrity" };  // more than one preference for the exact tuple
  const v = validatePreferenceRow(rows[0]);
  if (v === null) return { kind: "integrity" };
  return { kind: "row", row: v };
}

// ----------------------------------------------------------------------------
// Disposition derivation (scope + preference; suppression already cleared)
// ----------------------------------------------------------------------------
type SuccessOverrides = Omit<Partial<ConsentDecisionSuccess>, "ok" | "policyVersion" | "principalConfidence"> & {
  readonly disposition: ConsentDisposition;
  readonly reasonCode: ConsentReasonCode;
};

function derive(input: CommunicationConsentDecisionInput, row: NormalizedPreference | null): SuccessOverrides {
  const scope = input.scope;
  if (row !== null) {
    if (row.state === "blocked") {
      // A blocked preference blocks ALL scopes, regardless of its (well-formed) stored policy_version.
      return { disposition: "blocked", reasonCode: "preference_blocked", matchedPreferenceId: row.id };
    }
    // state === 'allowed' — trust depends on the (already shape-validated) policy version.
    const trusted = row.policyVersion === CONSENT_POLICY_VERSION;
    if (scope === "marketing") {
      if (trusted) return { disposition: "marketing_opted_in", reasonCode: "preference_marketing_opted_in", matchedPreferenceId: row.id };
      // A stale allowed preference must NEVER authorize marketing.
      return { disposition: "unknown", reasonCode: "preference_policy_version_mismatch", matchedPreferenceId: row.id };
    }
    if (trusted) {
      return {
        disposition: "no_consent_objection",
        reasonCode: scope === "authentication" ? "preference_authentication_no_objection" : "preference_transactional_no_objection",
        matchedPreferenceId: row.id,
      };
    }
    return { disposition: "no_consent_objection", reasonCode: "preference_policy_version_mismatch_no_objection", matchedPreferenceId: row.id };
  }
  // No preference row (absent, or non-exact identity → absence means UNKNOWN).
  if (scope === "marketing") {
    const reasonCode: ConsentReasonCode =
      input.identityConfidence === "exact" ? "no_marketing_preference"
      : input.identityConfidence === "ambiguous" ? "ambiguous_identity_no_marketing_authority"
      : "unknown_identity_no_marketing_authority";
    return { disposition: "unknown", reasonCode };
  }
  if (scope === "authentication") return { disposition: "no_consent_objection", reasonCode: "authentication_no_consent_objection" };
  return { disposition: "no_consent_objection", reasonCode: "transactional_no_consent_objection" };
}

// ----------------------------------------------------------------------------
// The authority
// ----------------------------------------------------------------------------
/**
 * Decide the communication-consent DISPOSITION for a request. Read-only; sanitized result.
 * Order: validate → freeze evaluation instant → read suppressions → validate+precedence (blocking
 * short-circuits the preference lookup) → exact preference (only when identity is exact) → derive.
 */
export async function decideCommunicationConsent(
  input: CommunicationConsentDecisionInput,
  deps: ConsentDecisionDeps = defaultConsentDecisionDeps()
): Promise<ConsentDecisionOutcome> {
  // 1) Validate — NEVER touch the DB for invalid input.
  if (!isValidInput(input)) return fail("INVALID_DECISION_INPUT");
  // 2) Freeze the evaluation instant to an immutable ms (from input.evaluatedAt or the injected
  //    clock). An invalid Date from either source fails closed BEFORE any DB lookup.
  const resolved = input.evaluatedAt ?? deps.now();
  const evaluatedAtMs = resolved instanceof Date ? resolved.getTime() : NaN;
  if (!Number.isFinite(evaluatedAtMs)) return fail("INVALID_DECISION_INPUT");

  const ok = (o: SuccessOverrides): ConsentDecisionSuccess => ({
    ok: true,
    policyVersion: CONSENT_POLICY_VERSION,
    principalConfidence: input.identityConfidence,
    matchedPreferenceId: null,
    matchedSuppressionId: null,
    suppressionReason: null,
    reconsent: "not_applicable",
    ...o,
  });

  // 3) Suppression precedence FIRST. A blocking suppression short-circuits the preference lookup.
  const supp = await evaluateSuppressions(input, evaluatedAtMs, deps);
  if (supp.kind === "lookup_failed") return fail("AUTHORITY_LOOKUP_FAILED");
  if (supp.kind === "integrity") return fail("AUTHORITY_INTEGRITY_VIOLATION");
  if (supp.kind === "blocked") return ok({ disposition: "blocked", reasonCode: supp.reasonCode, matchedSuppressionId: supp.id, suppressionReason: supp.reason, reconsent: reconsentFor(String(supp.reason)) });

  // 4) Exact preference — only when identity is exact (never for ambiguous/unknown).
  const pref = await loadExactPreference(input, deps);
  if (pref.kind === "lookup_failed") return fail("AUTHORITY_LOOKUP_FAILED");
  if (pref.kind === "integrity") return fail("AUTHORITY_INTEGRITY_VIOLATION");

  // 5) Derive from scope + preference.
  return ok(derive(input, pref.kind === "row" ? pref.row : null));
}
