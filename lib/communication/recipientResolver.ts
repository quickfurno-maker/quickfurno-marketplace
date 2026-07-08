// ============================================================================
// QuickFurno — lib/communication/recipientResolver.ts
//
// Provider-neutral recipient resolution contract (Phase 5B review fix #1).
//
// WHY THIS EXISTS
// A communication message persists only `recipient_type` + `recipient_id` plus a
// destination HASH and MASK — never the plaintext destination. A scheduled send
// or a retry that happens after a process restart therefore has no way to
// recover the number it must dial. The resolver closes that gap: it turns the
// durable recipient reference back into a normalized E.164 destination, at
// dispatch time, on the server.
//
// SECURITY
//   • Server-only. Implementations read privileged tables; the resolved
//     plaintext destination never crosses into browser code.
//   • Never invents a fallback destination. An unresolvable recipient fails
//     closed, so a misconfigured row can never send an OTP to a wrong number.
//   • Always returns a value normalized by lib/communication/phone.ts, so the
//     hash computed at dispatch matches the hash computed at enqueue.
// ============================================================================

import { AppError, fail, ok, type Result } from "../errors";
import { normalizePhoneE164 } from "./phone";
import type { CommunicationRecipientType } from "./types";

export const RecipientResolutionError = {
  /** recipient_id is null for a recipient type that requires one. */
  RECIPIENT_ID_REQUIRED: "RECIPIENT_ID_REQUIRED",
  /** This recipient type has no destination concept (integration / system). */
  RECIPIENT_TYPE_UNSUPPORTED: "RECIPIENT_TYPE_UNSUPPORTED",
  /** No row exists for the recipient reference. */
  RECIPIENT_NOT_FOUND: "RECIPIENT_NOT_FOUND",
  /** The row exists but holds no destination. */
  RECIPIENT_DESTINATION_MISSING: "RECIPIENT_DESTINATION_MISSING",
  /** The stored destination is not a valid international number. */
  RECIPIENT_DESTINATION_INVALID: "RECIPIENT_DESTINATION_INVALID",
  /** The lookup itself failed (transport/permission). */
  RECIPIENT_LOOKUP_FAILED: "RECIPIENT_LOOKUP_FAILED",
} as const;

export type RecipientResolutionErrorCode =
  (typeof RecipientResolutionError)[keyof typeof RecipientResolutionError];

const RECIPIENT_ERROR_MESSAGES: Record<RecipientResolutionErrorCode, string> = {
  RECIPIENT_ID_REQUIRED: "A recipient id is required to resolve a destination.",
  RECIPIENT_TYPE_UNSUPPORTED: "This recipient type has no resolvable communication destination.",
  RECIPIENT_NOT_FOUND: "No recipient record matches this reference.",
  RECIPIENT_DESTINATION_MISSING: "The recipient record has no communication destination on file.",
  RECIPIENT_DESTINATION_INVALID: "The recipient destination on file is not a valid international number.",
  RECIPIENT_LOOKUP_FAILED: "Recipient destination lookup failed.",
};

export function recipientResolutionError(code: RecipientResolutionErrorCode): AppError {
  return new AppError(code, RECIPIENT_ERROR_MESSAGES[code]);
}

export function failRecipientResolution(code: RecipientResolutionErrorCode): Result<never> {
  return fail(recipientResolutionError(code));
}

/**
 * Resolves a durable recipient reference to a normalized E.164 destination.
 * Injectable so the dispatcher can be exercised without a database, and so a
 * future recipient source (e.g. an admin escalation roster) is a new
 * implementation rather than a change to communication business logic.
 */
export interface CommunicationRecipientResolver {
  /** Stable identity of this resolver, for logging and admin diagnostics. */
  readonly resolverKey: string;

  resolveDestination(
    recipientType: CommunicationRecipientType,
    recipientId: string | null
  ): Promise<Result<string>>;
}

/** Recipient types that carry no destination and can never be resolved. */
export const NON_ADDRESSABLE_RECIPIENT_TYPES: readonly CommunicationRecipientType[] =
  Object.freeze(["integration", "system"]);

export function isAddressableRecipientType(type: CommunicationRecipientType): boolean {
  return !NON_ADDRESSABLE_RECIPIENT_TYPES.includes(type);
}

/**
 * Shared guard used by every implementation: rejects non-addressable recipient
 * types and missing ids before any I/O happens.
 */
export function validateRecipientReference(
  recipientType: CommunicationRecipientType,
  recipientId: string | null
): Result<string> {
  if (!isAddressableRecipientType(recipientType)) {
    return failRecipientResolution(RecipientResolutionError.RECIPIENT_TYPE_UNSUPPORTED);
  }
  if (!recipientId) {
    return failRecipientResolution(RecipientResolutionError.RECIPIENT_ID_REQUIRED);
  }
  return ok(recipientId);
}

/**
 * Normalize a destination read from storage, mapping the failure modes onto the
 * resolver's vocabulary. Blank/absent → MISSING; malformed → INVALID.
 */
export function normalizeResolvedDestination(raw: string | null | undefined): Result<string> {
  if (raw === null || raw === undefined || raw.trim() === "") {
    return failRecipientResolution(RecipientResolutionError.RECIPIENT_DESTINATION_MISSING);
  }
  const normalized = normalizePhoneE164(raw);
  if (!normalized.ok) {
    return failRecipientResolution(RecipientResolutionError.RECIPIENT_DESTINATION_INVALID);
  }
  return ok(normalized.e164);
}

/**
 * In-memory resolver for tests, harnesses and local sandboxes. Holds only the
 * destinations it was explicitly given — it never guesses and never falls back.
 */
export class StaticCommunicationRecipientResolver implements CommunicationRecipientResolver {
  readonly resolverKey = "static";

  private readonly entries = new Map<string, string>();

  constructor(seed: Record<string, string> = {}) {
    for (const [key, destination] of Object.entries(seed)) {
      this.entries.set(key, destination);
    }
  }

  private static key(recipientType: CommunicationRecipientType, recipientId: string): string {
    return `${recipientType}:${recipientId}`;
  }

  /** Register a destination. Returns `this` for fluent test setup. */
  set(
    recipientType: CommunicationRecipientType,
    recipientId: string,
    destination: string
  ): this {
    this.entries.set(StaticCommunicationRecipientResolver.key(recipientType, recipientId), destination);
    return this;
  }

  clear(): void {
    this.entries.clear();
  }

  async resolveDestination(
    recipientType: CommunicationRecipientType,
    recipientId: string | null
  ): Promise<Result<string>> {
    const reference = validateRecipientReference(recipientType, recipientId);
    if (!reference.ok) return reference;

    const raw = this.entries.get(
      StaticCommunicationRecipientResolver.key(recipientType, reference.data)
    );
    if (raw === undefined) {
      return failRecipientResolution(RecipientResolutionError.RECIPIENT_NOT_FOUND);
    }
    return normalizeResolvedDestination(raw);
  }
}
