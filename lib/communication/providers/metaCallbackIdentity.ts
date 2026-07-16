// ============================================================================
// QuickFurno — lib/communication/providers/metaCallbackIdentity.ts  (Phase 8B-1A)
//
// PURE, closed-union CALLBACK-IDENTITY AUTHORITY for verified Meta WhatsApp Cloud
// webhooks. Given an already-signature-verified, already-parsed payload and the
// server's EXPECTED identity (our WABA id + phone-number id), it decides — with no
// I/O, no clock, no randomness, no DB, no network — whether the callback provably
// belongs to THIS QuickFurno tenant.
//
// FIELD-SPECIFIC RULES (the interim whole-payload policy):
//   • `messages`  callbacks require BOTH the exact WABA id (entry.id) AND the exact
//                 phone-number id (value.metadata.phone_number_id).
//   • `message_template_status_update` and account callbacks require the exact WABA
//                 id (entry.id) ONLY.
//   • Any other field is NOT identity-bearing/actionable → it contributes nothing.
//
// NEVER TRUST `display_phone_number`. The ONLY phone identity that counts is the
// opaque `phone_number_id`; the human-readable display number is attacker-influenced
// display data and is never read here.
//
// WHOLE-PAYLOAD FAIL-CLOSED (availability debt, per-change isolation deferred to
// Phase 8B-2): if ANY supported change in the payload carries a foreign, malformed
// or unprovable identity, the WHOLE payload is rejected. A payload that carries no
// supported identity-bearing change at all is `unsupported` (safely acknowledged by
// the caller with zero effects), never `authorized`.
//
// The decision is a CLOSED UNION — `authorized | rejected | unsupported` — so a
// caller can never accidentally treat an unhandled shape as allowed.
// ============================================================================

/** The exact Meta id grammar: 1–64 ASCII digits. WABA ids and phone-number ids are
 *  opaque numeric strings; anything else is malformed and can never match. */
export const META_CALLBACK_ID_GRAMMAR = /^[0-9]{1,64}$/;

/** The supported, identity-bearing callback classes. */
export type MetaCallbackClass = "messages" | "template" | "account";

/** The server's expected identity — both values MUST be grammar-valid. */
export interface ExpectedCallbackIdentity {
  readonly wabaId: string;
  readonly phoneNumberId: string;
}

/** Why a callback was rejected. Every reason is a fail-closed outcome. */
export type CallbackIdentityRejectReason =
  | "malformed_expected_identity" // the server config we were handed is itself invalid
  | "unprovable_waba" // a supported change carried no usable entry.id
  | "malformed_waba" // entry.id present but not grammar-valid
  | "foreign_waba" // entry.id valid but belongs to another WABA
  | "unprovable_phone_number" // a messages change carried no usable phone_number_id
  | "malformed_phone_number" // phone_number_id present but not grammar-valid
  | "foreign_phone_number"; // phone_number_id valid but belongs to another number

/** The closed-union decision. */
export type CallbackIdentityDecision =
  | { readonly kind: "authorized"; readonly classes: readonly MetaCallbackClass[] }
  | { readonly kind: "rejected"; readonly reason: CallbackIdentityRejectReason }
  | { readonly kind: "unsupported" };

/**
 * The account-level fields (mirrors the classifier in metaWhatsAppWebhook.ts). Kept
 * local so this module stays PURE and free of an import cycle with the webhook lib
 * that re-exports it.
 */
const ACCOUNT_FIELDS: ReadonlySet<string> = new Set([
  "account_update",
  "account_review_update",
  "account_alerts",
  "phone_number_name_update",
  "phone_number_quality_update",
  "business_capability_update",
]);

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

/** A callback id is trusted ONLY as a non-empty STRING (numbers are never coerced). */
function readIdString(obj: Record<string, unknown>, key: string): string | null {
  const v = obj[key];
  return typeof v === "string" && v.length > 0 ? v : null;
}

function isGrammarValid(v: unknown): v is string {
  return typeof v === "string" && META_CALLBACK_ID_GRAMMAR.test(v);
}

/** Map a change `field` to its supported identity-bearing class, or null. */
function classifyChangeField(field: string): MetaCallbackClass | null {
  if (field === "messages") return "messages";
  if (field === "message_template_status_update") return "template";
  if (ACCOUNT_FIELDS.has(field)) return "account";
  return null;
}

/**
 * Compare an actual id against the expected id, returning a reject reason or null.
 * `kind` selects the reason vocabulary so the caller can report which field failed.
 */
function verdictForId(
  actual: string | null,
  expected: string,
  kind: "waba" | "phone_number"
): CallbackIdentityRejectReason | null {
  if (actual === null) return kind === "waba" ? "unprovable_waba" : "unprovable_phone_number";
  if (!META_CALLBACK_ID_GRAMMAR.test(actual)) return kind === "waba" ? "malformed_waba" : "malformed_phone_number";
  if (actual !== expected) return kind === "waba" ? "foreign_waba" : "foreign_phone_number";
  return null;
}

/**
 * Decide the callback identity of an already-verified, already-parsed Meta payload.
 * Pure and total: every input maps to exactly one closed-union decision.
 */
export function decideCallbackIdentity(
  payload: unknown,
  expected: ExpectedCallbackIdentity
): CallbackIdentityDecision {
  // The authority NEVER trusts its caller: a malformed expected identity authorizes
  // nothing. (The config resolver already guarantees the grammar; this is defense
  // in depth so a future miswiring can only fail closed.)
  if (!expected || !isGrammarValid(expected.wabaId) || !isGrammarValid(expected.phoneNumberId)) {
    return { kind: "rejected", reason: "malformed_expected_identity" };
  }

  const root = asObject(payload);
  if (!root || root.object !== "whatsapp_business_account") return { kind: "unsupported" };
  const entries = Array.isArray(root.entry) ? root.entry : [];

  const classes: MetaCallbackClass[] = [];
  let sawSupported = false;
  let firstReject: CallbackIdentityRejectReason | null = null;

  for (const entryRaw of entries) {
    const entry = asObject(entryRaw);
    // entry.id is the WABA id for EVERY supported class. Read it once per entry.
    const entryId = entry ? readIdString(entry, "id") : null;
    const changes = entry && Array.isArray(entry.changes) ? entry.changes : [];
    for (const changeRaw of changes) {
      const change = asObject(changeRaw);
      const field = change && typeof change.field === "string" ? change.field : null;
      if (!field) continue;
      const klass = classifyChangeField(field);
      if (!klass) continue; // not identity-bearing/actionable — ignored, never authorizing

      sawSupported = true;

      // WABA identity is required for ALL supported classes, from entry.id ONLY.
      const wabaVerdict = verdictForId(entryId, expected.wabaId, "waba");
      if (wabaVerdict) {
        if (!firstReject) firstReject = wabaVerdict;
        continue; // whole-payload fail-closed: a bad supported change poisons the payload
      }

      // `messages` ALSO require the phone-number identity, from value.metadata
      // .phone_number_id ONLY — display_phone_number is never consulted.
      if (klass === "messages") {
        const value = change ? asObject(change.value) : null;
        const metadata = value ? asObject(value.metadata) : null;
        const phoneId = metadata ? readIdString(metadata, "phone_number_id") : null;
        const phoneVerdict = verdictForId(phoneId, expected.phoneNumberId, "phone_number");
        if (phoneVerdict) {
          if (!firstReject) firstReject = phoneVerdict;
          continue;
        }
      }

      classes.push(klass);
    }
  }

  if (firstReject) return { kind: "rejected", reason: firstReject };
  if (!sawSupported) return { kind: "unsupported" };
  return { kind: "authorized", classes };
}
