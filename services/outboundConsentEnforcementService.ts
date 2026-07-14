// ============================================================================
// QuickFurno — services/outboundConsentEnforcementService.ts   (Phase 5F-D3-B, server-only)
//
// The SOLE OUTBOUND CONSENT ENFORCEMENT COORDINATOR. It is the ONLY module permitted to interpret a
// D2-C disposition, and it converts that discriminated result into ONE CLOSED authorization outcome.
//
// AUTHORITY. QuickFurno Core is the sole consent authority. D2-C
// (services/communicationConsentDecisionService.ts) remains the SOLE read-only consent/suppression
// DECISION authority; this coordinator only ADAPTS and ENFORCES it. It:
//   • NEVER duplicates suppression or preference logic;
//   • NEVER reads communication_suppressions or communication_preferences directly;
//   • NEVER collapses D2-C into a universal `allowed` boolean;
//   • NEVER modifies D2-C, D2-D or D2-E.
// CommunicationService, provider adapters, Meta, SMS, n8n and Jarvis consume ONLY the closed outcome
// below — none of them ever sees a disposition, a preference row, or a suppression row.
//
// CONSENT ≠ SEND AUTHORIZATION. An `allow` means the CONSENT LAYER passed and nothing more. The
// authentication action, transport policy, auth deadline, transactional basis, template/mapping gate,
// provider runtime gate and canary all remain SEPARATE authorities that must ALSO pass.
//
// PROVIDER-NEUTRAL. One coordinator serves BOTH outbound paths: WhatsApp (through CommunicationService)
// and the DIRECT SMS authentication fallback. A WhatsApp decision NEVER authorizes an SMS send — the
// channel is part of the decision input, so SMS gets its own `channel: "sms"` decision. RCS is excluded
// from D3-B (no RCS send path exists).
//
// PRIVACY. The outcome carries a closed code and nothing else. No destination hash, no plaintext
// destination, no principal id, no matched preference/suppression id, no raw D2-C row, no database
// error, no SQLSTATE, no stack, no OTP and no message body ever leaves this module.
// ============================================================================

import {
  decideCommunicationConsent,
  type CommunicationConsentDecisionInput,
  type ConsentDecisionOutcome,
} from "./communicationConsentDecisionService";
import {
  resolveOutboundConsentScope,
  type OutboundConsentScope,
} from "../lib/communication/outboundConsentScope";

// ----------------------------------------------------------------------------
// Public input contract — the MINIMUM facts, and nothing that could leak or be abused
// ----------------------------------------------------------------------------
/** D3-B enforces WhatsApp and SMS. RCS is deliberately out of scope (no send path exists). */
export type EnforcementChannel = "whatsapp" | "sms";
export type EnforcementRecipientType = "client" | "vendor" | "admin" | "integration" | "system";
export type EnforcementDestinationSource = "recipient_reference" | "ephemeral_auth_destination";

/**
 * NOTE what is ABSENT, deliberately: no plaintext phone, no OTP, no message body, no webhook payload,
 * and — critically — NO caller-selected consent scope, identity confidence, principal or policy version.
 * A caller that could choose its own scope or claim its own identity would be interpreting consent.
 * Every one of those is DERIVED here, from facts the caller cannot forge into an upgrade.
 */
export interface OutboundConsentEnforcementInput {
  readonly channel: EnforcementChannel;
  readonly messageType: string;
  readonly templateKey: string;
  readonly lane: string;
  /** sha256(canonical E.164) lowercase hex. NEVER a plaintext phone. */
  readonly destinationHash: string;
  readonly destinationSource: EnforcementDestinationSource;
  readonly recipientType: string;
  readonly recipientId: string | null;
}

// ----------------------------------------------------------------------------
// Public output contract — a CLOSED authorization outcome (never a disposition, never a row)
// ----------------------------------------------------------------------------
export type OutboundConsentDenyCode =
  | "CONSENT_SUPPRESSED"
  | "CONSENT_NOT_GRANTED"
  | "UNCLASSIFIED_MESSAGE_TYPE"
  | "MESSAGE_TYPE_TEMPLATE_MISMATCH"
  | "MESSAGE_LANE_SCOPE_MISMATCH";

export type OutboundConsentInvalidCode = "CONSENT_ENFORCEMENT_INVALID" | "CONSENT_AUTHORITY_INTEGRITY";
export type OutboundConsentUnavailableCode = "CONSENT_AUTHORITY_UNAVAILABLE";

export type OutboundConsentOutcome =
  /** The CONSENT LAYER passed. Every other authority (transport, deadline, template, runtime) still applies. */
  | { readonly kind: "allow"; readonly scope: OutboundConsentScope }
  /** A definitive consent DENIAL. Retrying can never change it into an allow. */
  | { readonly kind: "deny"; readonly code: OutboundConsentDenyCode; readonly retryable: false }
  /** The authority could not be evaluated. Infrastructure, NOT a decision. */
  | { readonly kind: "unavailable"; readonly code: OutboundConsentUnavailableCode; readonly retryable: true }
  /** The request or the authority itself is not trustworthy. Never retried. */
  | { readonly kind: "invalid"; readonly code: OutboundConsentInvalidCode; readonly retryable: false };

/** The narrow interface CommunicationService and the SMS orchestrator consume. Nothing wider. */
export interface OutboundConsentEnforcer {
  authorize(input: OutboundConsentEnforcementInput): Promise<OutboundConsentOutcome>;
}

// ----------------------------------------------------------------------------
// Injectable collaborator — production binds the real D2-C authority
// ----------------------------------------------------------------------------
export interface OutboundConsentEnforcementDeps {
  readonly decide: (input: CommunicationConsentDecisionInput) => Promise<ConsentDecisionOutcome>;
}

export function defaultOutboundConsentEnforcementDeps(): OutboundConsentEnforcementDeps {
  return { decide: (input) => decideCommunicationConsent(input) };
}

// ----------------------------------------------------------------------------
// Identity derivation — the caller can NEVER upgrade it
// ----------------------------------------------------------------------------
const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HEX64 = /^[0-9a-f]{64}$/;
/** The principal types D2-C accepts. `integration` / `system` are NOT consent principals. */
const CONSENT_PRINCIPAL_TYPES: readonly string[] = ["client", "vendor", "admin"];

export type DerivedIdentity =
  | { readonly identityConfidence: "exact"; readonly principal: { readonly type: "client" | "vendor" | "admin"; readonly id: string } }
  | { readonly identityConfidence: "unknown"; readonly principal: null };

/**
 * Derive the consent identity from facts the caller cannot forge into an upgrade.
 *
 * A. `ephemeral_auth_destination` → ALWAYS `unknown` / `null`.
 *    The destination was SUPPLIED BY THE CALLER (a first-time client login OTP, a vendor typing the
 *    number they want verified, a password-reset number, the SMS fallback). It is NOT proven to belong
 *    to the recipient. The PRESENCE OF `recipient_id` MUST NEVER UPGRADE IT TO `exact`: doing so would
 *    consult vendor A's consent record for a destination that may belong to somebody else entirely —
 *    a wrong-subject decision, and for marketing a consent-laundering hole.
 *
 * B. `recipient_reference` → `exact`, but ONLY when the binding is genuinely proven:
 *    the destination was RESOLVED FROM the canonical recipient record, the recipient type is a real
 *    consent principal (client/vendor/admin), and the id is a well-formed UUID. Anything else — a
 *    missing id, a malformed id, an `integration`/`system` recipient — stays `unknown`. Never guessed,
 *    never a first match.
 *
 * `unknown` is always SAFE: suppressions are destination-hash scoped, so they still apply in full, and
 * marketing still default-denies (an unknown identity can never produce `marketing_opted_in`).
 */
export function deriveConsentIdentity(input: {
  readonly destinationSource: EnforcementDestinationSource;
  readonly recipientType: string;
  readonly recipientId: string | null;
}): DerivedIdentity {
  const unknown: DerivedIdentity = { identityConfidence: "unknown", principal: null };

  // A — an ephemeral destination is caller-supplied. It can NEVER be exact.
  if (input.destinationSource !== "recipient_reference") return unknown;

  // B — a recipient-reference destination was resolved FROM the principal's own record.
  const type = input.recipientType;
  const id = input.recipientId;
  if (!CONSENT_PRINCIPAL_TYPES.includes(type)) return unknown;
  if (typeof id !== "string" || !UUID_SHAPE.test(id)) return unknown;

  return { identityConfidence: "exact", principal: { type: type as "client" | "vendor" | "admin", id } };
}

// ----------------------------------------------------------------------------
// The coordinator
// ----------------------------------------------------------------------------
const deny = (code: OutboundConsentDenyCode): OutboundConsentOutcome => ({ kind: "deny", code, retryable: false });
const unavailable = (): OutboundConsentOutcome => ({ kind: "unavailable", code: "CONSENT_AUTHORITY_UNAVAILABLE", retryable: true });
const invalid = (code: OutboundConsentInvalidCode): OutboundConsentOutcome => ({ kind: "invalid", code, retryable: false });

/**
 * Authorize ONE outbound send against the consent layer. Order: resolve the scope from the closed
 * registry (no DB call for an unclassified/mismatched message) → derive the identity → ask D2-C →
 * map the discriminated result to the closed outcome.
 */
export async function authorizeOutboundConsent(
  input: OutboundConsentEnforcementInput,
  deps: OutboundConsentEnforcementDeps = defaultOutboundConsentEnforcementDeps()
): Promise<OutboundConsentOutcome> {
  // 1) Narrow input fences. An unusable request never reaches the authority.
  if (!input || (input.channel !== "whatsapp" && input.channel !== "sms")) return invalid("CONSENT_ENFORCEMENT_INVALID");
  if (typeof input.destinationHash !== "string" || !HEX64.test(input.destinationHash)) return invalid("CONSENT_ENFORCEMENT_INVALID");
  if (input.destinationSource !== "recipient_reference" && input.destinationSource !== "ephemeral_auth_destination") {
    return invalid("CONSENT_ENFORCEMENT_INVALID");
  }

  // 2) Scope from the CLOSED registry. An unclassified type / template mismatch / lane mismatch is a
  //    DENY — and it NEVER touches the database (there is nothing to ask about an unreviewed send).
  const scoped = resolveOutboundConsentScope({
    messageType: input.messageType,
    templateKey: input.templateKey,
    lane: input.lane,
  });
  if (!scoped.ok) return deny(scoped.reason);
  const scope = scoped.scope;

  // 3) Identity — derived, never accepted from the caller.
  const identity = deriveConsentIdentity({
    destinationSource: input.destinationSource,
    recipientType: input.recipientType,
    recipientId: input.recipientId,
  });

  // 4) THE authority. D2-C decides; this module only enforces.
  let outcome: ConsentDecisionOutcome;
  try {
    outcome = await deps.decide({
      channel: input.channel,
      scope,
      destinationHash: input.destinationHash,
      identityConfidence: identity.identityConfidence,
      principal: identity.principal,
    });
  } catch {
    // A thrown dependency is INFRASTRUCTURE, never a decision. Sanitized; no raw error escapes.
    return unavailable();
  }

  // 5) D2-C failure mapping. A failure is NEVER an allow.
  if (!outcome.ok) {
    switch (outcome.code) {
      case "AUTHORITY_LOOKUP_FAILED":
        return unavailable();                                  // retryable: the authority may recover
      case "AUTHORITY_INTEGRITY_VIOLATION":
        return invalid("CONSENT_AUTHORITY_INTEGRITY");         // the authority is not trustworthy
      case "INVALID_DECISION_INPUT":
        return invalid("CONSENT_ENFORCEMENT_INVALID");         // our own input was wrong: deterministic
      default:
        return invalid("CONSENT_ENFORCEMENT_INVALID");         // an unexpected code fails closed
    }
  }

  // 6) Disposition mapping, PER SCOPE. Only the explicitly listed disposition may pass; everything
  //    else — including any disposition a future D2-C might add — FAILS CLOSED.
  const disposition = outcome.disposition;

  if (scope === "marketing") {
    // MARKETING DEFAULT-DENY. ONLY an explicit, policy-current opt-in on an EXACT identity passes.
    // `unknown` (no preference, a stale policy version, an ambiguous/unknown identity) is a DENY —
    // absence of consent is NEVER affirmative consent.
    if (disposition === "marketing_opted_in") return { kind: "allow", scope };
    if (disposition === "blocked") return deny("CONSENT_SUPPRESSED");
    if (disposition === "unknown") return deny("CONSENT_NOT_GRANTED");
    return invalid("CONSENT_ENFORCEMENT_INVALID");
  }

  // AUTHENTICATION and TRANSACTIONAL: a suppression blocks; otherwise the CONSENT LAYER passes and the
  // remaining authorities decide. (`marketing_opted_in` is not a valid disposition for these scopes —
  // receiving it means D2-C answered a different question than we asked, so it fails closed.)
  if (disposition === "blocked") return deny("CONSENT_SUPPRESSED");
  if (disposition === "no_consent_objection") return { kind: "allow", scope };
  return invalid("CONSENT_ENFORCEMENT_INVALID");
}

/** LAZY: constructed per request. The production enforcer bound to the real D2-C authority. */
export function createOutboundConsentEnforcer(
  deps: OutboundConsentEnforcementDeps = defaultOutboundConsentEnforcementDeps()
): OutboundConsentEnforcer {
  return { authorize: (input) => authorizeOutboundConsent(input, deps) };
}

// ============================================================================
// PHASE 8A — FAIL-CLOSED AUTHORITY
//
// THE SECURITY INVARIANT:
//   a missing, null, undefined, malformed or throwing consent authority ⇒ ZERO provider calls.
//
// TypeScript alone cannot hold that line. `as any`, plain JavaScript (every harness is .mjs), reflection
// and future unsafe code can all put a non-enforcer where an enforcer belongs. So the type system states
// the requirement and the RUNTIME enforces it: anything that is not a structurally valid enforcer is
// normalized to the fail-closed enforcer below, and anything that is not a structurally valid OUTCOME is
// normalized to a deliberate integrity failure. Absence is never permission.
// ============================================================================

/**
 * The FAIL-CLOSED outcome. Frozen, so a caller that receives it cannot mutate it into an allow.
 *
 * `unavailable` (not `deny`) is the honest classification: we did not decide that consent was refused, we
 * were UNABLE TO EVALUATE the authority at all. That distinction is load-bearing downstream — it preserves
 * the lane split (an authentication row fails; a business row stays retryable and is re-evaluated later),
 * whereas a `deny` would permanently CANCEL a legitimate business message.
 */
export const FAIL_CLOSED_CONSENT_OUTCOME: OutboundConsentOutcome = Object.freeze({
  kind: "unavailable",
  code: "CONSENT_AUTHORITY_UNAVAILABLE",
  retryable: true,
} as const);

/**
 * The enforcer used when NO trustworthy authority is available. It never consults D2-C, never touches the
 * database, and can never allow: every authorization is `unavailable`.
 *
 * PRODUCTION USES THIS ONLY WHERE SENDING IS NOT THE PURPOSE — the Meta webhook builds a
 * CommunicationService to process DELIVERY RECEIPTS, and binding this enforcer means that even if a future
 * edit accidentally called a send method on that object, it would send NOTHING. The real send paths bind
 * `createOutboundConsentEnforcer()` through `createRuntimeCommunicationService`, never this.
 */
export function createFailClosedOutboundConsentEnforcer(): OutboundConsentEnforcer {
  return { authorize: async () => FAIL_CLOSED_CONSENT_OUTCOME };
}

/**
 * Is this value structurally usable as an enforcer? A missing fourth argument, `null`, `undefined`, a
 * primitive, an array, or an object whose `authorize` is not callable all answer NO — and the caller then
 * substitutes the fail-closed enforcer.
 *
 * This deliberately does NOT try to prove the enforcer is the RIGHT one — it cannot. It proves only that
 * calling `authorize` will not throw a TypeError. Whatever it then returns is validated separately by
 * `normalizeOutboundConsentOutcome`, so a hostile or broken enforcer still cannot produce an allow.
 */
export function isOutboundConsentEnforcer(value: unknown): value is OutboundConsentEnforcer {
  if (value === null || value === undefined) return false;
  if (Array.isArray(value)) return false;
  const t = typeof value;
  if (t !== "object" && t !== "function") return false;
  return typeof (value as { authorize?: unknown }).authorize === "function";
}

// ---- the CLOSED outcome union, as runtime data -------------------------------------------------------
//
// Each `Record<Union, true>` below is a COMPILE-TIME EXHAUSTIVENESS FENCE: adding a member to the union
// without adding it here is a TypeScript error, so the validator can never silently fall behind the type.
const DENY_CODES: Record<OutboundConsentDenyCode, true> = {
  CONSENT_SUPPRESSED: true,
  CONSENT_NOT_GRANTED: true,
  UNCLASSIFIED_MESSAGE_TYPE: true,
  MESSAGE_TYPE_TEMPLATE_MISMATCH: true,
  MESSAGE_LANE_SCOPE_MISMATCH: true,
};
const INVALID_CODES: Record<OutboundConsentInvalidCode, true> = {
  CONSENT_ENFORCEMENT_INVALID: true,
  CONSENT_AUTHORITY_INTEGRITY: true,
};
const UNAVAILABLE_CODES: Record<OutboundConsentUnavailableCode, true> = {
  CONSENT_AUTHORITY_UNAVAILABLE: true,
};
const ALLOW_SCOPES: Record<OutboundConsentScope, true> = {
  authentication: true,
  transactional: true,
  marketing: true,
};

const hasOwn = (o: object, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k);

/** The deliberate integrity failure. NOT an accident of an outer `catch`. */
export const CONSENT_INTEGRITY_OUTCOME: OutboundConsentOutcome = Object.freeze({
  kind: "invalid",
  code: "CONSENT_AUTHORITY_INTEGRITY",
  retryable: false,
} as const);

/**
 * Validate an enforcer's return value against the COMPLETE closed union and re-mint it canonically.
 *
 * WHY NOT JUST `outcome.kind === "allow"`. That trusted a single field on an object of unknown provenance:
 * a duck-typed `{ kind: "allow" }` — no scope, no authority, no decision — was indistinguishable from a
 * real authorization and would have reached the provider. Every variant is therefore checked IN FULL:
 * the discriminant, the required fields, the code's membership of that variant's closed code set, the
 * `retryable` flag, and the ABSENCE of contradictory fields (an `allow` carrying a `code`, or a `deny`
 * carrying a `scope`, is not a valid outcome of this contract — it is a sign of a confused authority).
 *
 * The returned object is a FRESH canonical value, never the caller's object, so no extra property can be
 * smuggled through this boundary into the dispatch path.
 *
 * Anything malformed becomes `CONSENT_AUTHORITY_INTEGRITY` — an `invalid`, which is TERMINAL and never
 * retried. That is the correct classification: an authority returning nonsense is untrustworthy, and
 * retrying an untrustworthy authority cannot make it trustworthy.
 */
export function normalizeOutboundConsentOutcome(value: unknown): OutboundConsentOutcome {
  if (value === null || value === undefined) return CONSENT_INTEGRITY_OUTCOME;
  if (typeof value !== "object") return CONSENT_INTEGRITY_OUTCOME;   // primitives, functions
  if (Array.isArray(value)) return CONSENT_INTEGRITY_OUTCOME;

  const o = value as Record<string, unknown>;

  switch (o.kind) {
    case "allow": {
      // An allow MUST carry a scope from the closed registry, and MUST NOT carry deny/failure fields.
      if (typeof o.scope !== "string") return CONSENT_INTEGRITY_OUTCOME;
      if (!hasOwn(ALLOW_SCOPES, o.scope)) return CONSENT_INTEGRITY_OUTCOME;
      if (hasOwn(o, "code") || hasOwn(o, "retryable")) return CONSENT_INTEGRITY_OUTCOME;   // contradictory
      return { kind: "allow", scope: o.scope as OutboundConsentScope };
    }
    case "deny": {
      if (typeof o.code !== "string" || !hasOwn(DENY_CODES, o.code)) return CONSENT_INTEGRITY_OUTCOME;
      if (o.retryable !== false) return CONSENT_INTEGRITY_OUTCOME;     // a retryable deny is a contradiction
      if (hasOwn(o, "scope")) return CONSENT_INTEGRITY_OUTCOME;
      return { kind: "deny", code: o.code as OutboundConsentDenyCode, retryable: false };
    }
    case "unavailable": {
      if (typeof o.code !== "string" || !hasOwn(UNAVAILABLE_CODES, o.code)) return CONSENT_INTEGRITY_OUTCOME;
      if (o.retryable !== true) return CONSENT_INTEGRITY_OUTCOME;
      if (hasOwn(o, "scope")) return CONSENT_INTEGRITY_OUTCOME;
      return { kind: "unavailable", code: o.code as OutboundConsentUnavailableCode, retryable: true };
    }
    case "invalid": {
      if (typeof o.code !== "string" || !hasOwn(INVALID_CODES, o.code)) return CONSENT_INTEGRITY_OUTCOME;
      if (o.retryable !== false) return CONSENT_INTEGRITY_OUTCOME;
      if (hasOwn(o, "scope")) return CONSENT_INTEGRITY_OUTCOME;
      return { kind: "invalid", code: o.code as OutboundConsentInvalidCode, retryable: false };
    }
    default:
      return CONSENT_INTEGRITY_OUTCOME;                                // unknown / missing discriminant
  }
}
