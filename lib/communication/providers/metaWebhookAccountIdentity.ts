// ============================================================================
// QuickFurno — lib/communication/providers/metaWebhookAccountIdentity.ts  (Phase 8B-1B-C)
//
// PURE extraction of the OWNERSHIP-RESOLUTION IDENTITY (WABA id + phone_number_id) from an
// already-signature-verified, already-parsed, already-identity-AUTHORIZED Meta payload.
//
// It reads ONLY the payload — never an environment variable, never `display_phone_number`,
// never a secret/token/phone number. It reuses the FROZEN Phase 8B-1A Meta id grammar
// (`META_CALLBACK_ID_GRAMMAR`) VERBATIM (imported, not restated) so this extractor and the
// callback-identity authority can never disagree about what a well-formed id is. It does NOT
// import, wrap or modify the frozen `decideCallbackIdentity` authority.
//
// EXTRACTION RULES (identical field paths to the gate):
//   • WABA id        = entry.id                          (non-empty STRING only; numbers never coerced)
//   • phone_number_id = entry.changes[].value.metadata.phone_number_id, for `field === "messages"` ONLY
//     (both INBOUND_MESSAGE and DELIVERY_STATUS are `messages`-field callbacks). `display_phone_number`
//     is never consulted.
//
// It NEVER selects a first row: a payload whose `messages` changes carry CONFLICTING or malformed
// identities yields `no_identity` (the caller treats that as a deterministic non-owned outcome), never
// "pick the first". For an AUTHORIZED messages payload the gate has already proven every `messages`
// change matches the SAME expected (WABA, phone_number_id), so exactly one consistent pair remains — the
// extractor therefore returns EXACTLY the identity the gate validated. See the equivalence proof in
// scripts/phase8b1bc-inbound-webhook-account-binding-harness.mjs.
// ============================================================================

import { META_CALLBACK_ID_GRAMMAR } from "./metaCallbackIdentity";

/** The extracted resolution identity, or the fact that none is usable. Closed union. */
export type MetaWebhookAccountIdentity =
  | { readonly kind: "phone_identity"; readonly wabaId: string; readonly phoneNumberId: string }
  | { readonly kind: "no_identity" };

// Local, PURE helpers mirroring the gate's (kept local so this module imports ONLY the grammar constant
// from the frozen authority — never its private extraction internals).
function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

/** A callback id is trusted ONLY as a non-empty STRING (numbers are never coerced) — exactly like the gate. */
function readIdString(obj: Record<string, unknown>, key: string): string | null {
  const v = obj[key];
  return typeof v === "string" && v.length > 0 ? v : null;
}

function isGrammarValid(v: unknown): v is string {
  return typeof v === "string" && META_CALLBACK_ID_GRAMMAR.test(v);
}

/**
 * Extract the ownership-resolution identity from a `messages`-field Meta callback payload.
 *
 * PURE and TOTAL: every input maps to exactly one outcome.
 *   • `phone_identity` — every `messages` change carried the SAME grammar-valid (entry.id, phone_number_id);
 *   • `no_identity`    — there was no `messages` change, or the `messages` changes were malformed or
 *                        CONFLICTING (never a first-row pick).
 */
export function extractMetaWebhookAccountIdentity(payload: unknown): MetaWebhookAccountIdentity {
  const root = asObject(payload);
  if (!root || root.object !== "whatsapp_business_account") return { kind: "no_identity" };
  const entries = Array.isArray(root.entry) ? root.entry : [];

  let found: { readonly wabaId: string; readonly phoneNumberId: string } | null = null;
  let conflict = false;
  let sawMessages = false;

  for (const entryRaw of entries) {
    const entry = asObject(entryRaw);
    // entry.id is the WABA id, read once per entry (identical to the gate).
    const entryId = entry ? readIdString(entry, "id") : null;
    const changes = entry && Array.isArray(entry.changes) ? entry.changes : [];
    for (const changeRaw of changes) {
      const change = asObject(changeRaw);
      const field = change && typeof change.field === "string" ? change.field : null;
      if (field !== "messages") continue; // ONLY messages-field changes bear a phone identity
      sawMessages = true;

      const value = change ? asObject(change.value) : null;
      const metadata = value ? asObject(value.metadata) : null;
      const phoneId = metadata ? readIdString(metadata, "phone_number_id") : null;

      // Both ids must be grammar-valid (same constant the gate uses); otherwise this change yields no
      // usable identity — and a payload the gate would have rejected must never be silently bound.
      if (!isGrammarValid(entryId) || !isGrammarValid(phoneId)) {
        conflict = true;
        continue;
      }
      const pair = { wabaId: entryId, phoneNumberId: phoneId };
      if (found === null) found = pair;
      else if (found.wabaId !== pair.wabaId || found.phoneNumberId !== pair.phoneNumberId) conflict = true;
    }
  }

  if (!sawMessages || conflict || found === null) return { kind: "no_identity" };
  return { kind: "phone_identity", wabaId: found.wabaId, phoneNumberId: found.phoneNumberId };
}
