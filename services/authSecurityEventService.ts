// ============================================================================
// QuickFurno — services/authSecurityEventService.ts   (server-only)
//
// THE single server-side persistence path for public.auth_security_events
// (Phase 5A). No other module may insert into that table, and no duplicate
// security-event table exists.
//
// SECURITY INVARIANTS
//   • Metadata always passes through the Phase 5A `sanitizeAuthSecurityMetadata`
//     vocabulary — no weaker local copy — which DROPS secret-looking keys
//     (otp, password, token, authorization, provider_secret, raw_payload, …).
//   • `destinationHash` must already be a SHA-256 digest. Passing a raw phone or
//     email is rejected loudly rather than silently written.
//   • Even after sanitization, any value that LOOKS like a raw login identifier
//     (an email address or an E.164 phone) is rejected. Secret-key filtering
//     alone would not catch `{ typed_value: "vendor@example.com" }`.
//   • Audit writes are advisory: they return Result<null> and never throw into a
//     caller's authentication flow.
//
// The table grants service_role SELECT + INSERT only (append-only), so this
// module uses adminClient() and never updates or deletes.
// ============================================================================

import { adminClient } from "../lib/supabase";
import { AppError, fail, isMissingRelationError, ok, type Result } from "../lib/errors";
import {
  isAuthSecurityEventType,
  sanitizeAuthSecurityMetadata,
  type AuthSecurityEventTypeValue,
} from "../lib/identity/authSecurityEvent";
import { isVendorLoginIdentifierHash } from "../lib/identity/vendorLoginIdentifier";
import type { PrincipalTypeValue } from "../lib/identity/principal";
import type { VerificationPurposeValue } from "../lib/identity/verification";

export const AuthSecurityEventError = {
  UNKNOWN_AUTH_SECURITY_EVENT_TYPE: "UNKNOWN_AUTH_SECURITY_EVENT_TYPE",
  AUTH_SECURITY_EVENT_DESTINATION_NOT_HASHED: "AUTH_SECURITY_EVENT_DESTINATION_NOT_HASHED",
  AUTH_SECURITY_EVENT_RAW_IDENTIFIER_FORBIDDEN: "AUTH_SECURITY_EVENT_RAW_IDENTIFIER_FORBIDDEN",
} as const;

const AUTH_SECURITY_EVENT_MESSAGES: Record<string, string> = {
  UNKNOWN_AUTH_SECURITY_EVENT_TYPE: "Unknown authentication security event type.",
  AUTH_SECURITY_EVENT_DESTINATION_NOT_HASHED:
    "A security event destination must be a SHA-256 hash, never a raw identifier.",
  AUTH_SECURITY_EVENT_RAW_IDENTIFIER_FORBIDDEN:
    "Security event metadata must not contain a raw login identifier.",
};

function authSecurityEventError(code: keyof typeof AuthSecurityEventError): AppError {
  return new AppError(code, AUTH_SECURITY_EVENT_MESSAGES[code]);
}

/** Looks like an email address anywhere inside the string. */
const EMAIL_LIKE = /[^\s@]+@[^\s@]+\.[^\s@]{2,}/;
/** Looks like an E.164 phone anywhere inside the string. */
const E164_LIKE = /\+\d{8,15}/;

function looksLikeRawIdentifier(value: unknown): boolean {
  if (typeof value === "string") return EMAIL_LIKE.test(value) || E164_LIKE.test(value);
  if (Array.isArray(value)) return value.some(looksLikeRawIdentifier);
  if (value && typeof value === "object") {
    return Object.values(value as Record<string, unknown>).some(looksLikeRawIdentifier);
  }
  return false;
}

export interface RecordAuthSecurityEventInput {
  readonly eventType: AuthSecurityEventTypeValue;
  readonly principalType?: PrincipalTypeValue | null;
  /** Business identity id (vendors.id / client_accounts.id) where known. */
  readonly principalId?: string | null;
  /** Supabase auth.users.id where known. */
  readonly actorUserId?: string | null;
  readonly purpose?: VerificationPurposeValue | null;
  readonly correlationId?: string | null;
  /** SHA-256 digest ONLY. Never a raw phone/email. */
  readonly destinationHash?: string | null;
  readonly metadata?: Record<string, unknown>;
}

/**
 * Append one sanitized row to public.auth_security_events.
 *
 * Returns `Result<null>` rather than throwing: an audit-write failure must not
 * take down a login. Callers that care surface it (see `auditRecorded` on the
 * vendor login outcome).
 */
export async function recordAuthSecurityEvent(
  input: RecordAuthSecurityEventInput
): Promise<Result<null>> {
  try {
    if (!isAuthSecurityEventType(input.eventType)) {
      throw authSecurityEventError("UNKNOWN_AUTH_SECURITY_EVENT_TYPE");
    }

    const destinationHash = input.destinationHash ?? null;
    if (destinationHash !== null && !isVendorLoginIdentifierHash(destinationHash)) {
      // A caller tried to store a raw identifier in the hash column.
      throw authSecurityEventError("AUTH_SECURITY_EVENT_DESTINATION_NOT_HASHED");
    }

    // Phase 5A vocabulary drops secret-looking KEYS; this catches secret-looking
    // VALUES that a well-named key would otherwise smuggle through.
    const metadata = sanitizeAuthSecurityMetadata(input.metadata);
    if (looksLikeRawIdentifier(metadata)) {
      throw authSecurityEventError("AUTH_SECURITY_EVENT_RAW_IDENTIFIER_FORBIDDEN");
    }

    const { error } = await adminClient()
      .from("auth_security_events")
      .insert({
        event_type: input.eventType,
        principal_type: input.principalType ?? null,
        principal_id: input.principalId ?? null,
        actor_user_id: input.actorUserId ?? null,
        purpose: input.purpose ?? null,
        correlation_id: input.correlationId ?? null,
        destination_hash: destinationHash,
        metadata,
      });

    if (error) {
      // Phase 5A not applied in this environment — degrade rather than break auth.
      if (isMissingRelationError(error)) return ok(null);
      throw error;
    }

    return ok(null);
  } catch (e) {
    return fail(e);
  }
}
