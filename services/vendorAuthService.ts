// ============================================================================
// QuickFurno — services/vendorAuthService.ts   (server-only)
//
// Vendor password login, built ON TOP OF Supabase Auth.
//
// WHAT THIS IS NOT
//   • Not a custom JWT system. Not a custom session system.
//   • No password is generated, stored, hashed, logged, or echoed here.
//   • No second session cookie. Supabase Auth remains the session authority.
//   • adminClient().auth.signInWithPassword() is NEVER used — signing a user in
//     with the service-role key would bypass the request's auth context and
//     leave no browser session.
//
// FLOW
//   1. canonicalize the identifier (email lowercased / phone → E.164, ambiguous
//      local numbers rejected — never guess a country code);
//   2. authenticate through the REQUEST-SCOPED SSR auth client, so the session
//      cookie is established on this response;
//   3. resolve the vendor access mapping (services/vendorAccessService.ts);
//   4. on success: stamp last_login_at/last_login_method server-side and record
//      vendor.login_success;
//   5. on ANY failure — including "authenticated but no active vendor mapping" —
//      sign the session out through the SAME auth context, record a sanitized
//      vendor.login_failed, and return one indistinguishable generic error.
//
// The caller must be a Server Action or Route Handler: `signInWithPassword`
// writes the Supabase auth cookies, and Next.js only permits cookie writes there.
// ============================================================================

import type { SupabaseClient } from "@supabase/supabase-js";
import { serverClient } from "../lib/supabase";
import { AppError, fail, ok, type Result } from "../lib/errors";
import { AuthSecurityEventType } from "../lib/identity/authSecurityEvent";
import { PrincipalType } from "../lib/identity/principal";
import {
  hashVendorLoginIdentifier,
  normalizeVendorLoginIdentifier,
  type VendorLoginIdentifier,
} from "../lib/identity/vendorLoginIdentifier";
import { VendorAccessDenialReason } from "../lib/identity/vendorAccess";
import { recordAuthSecurityEvent } from "./authSecurityEventService";
import {
  VendorLoginMethod,
  recordVendorLoginMetadata,
  resolveVendorAccess,
} from "./vendorAccessService";

/**
 * The ONE public failure code. Every failure path returns this exact code and
 * message, so an attacker cannot distinguish "no such email", "wrong password",
 * "no vendor mapping", or "membership suspended".
 */
export const VENDOR_LOGIN_FAILED_CODE = "VENDOR_LOGIN_FAILED";
const VENDOR_LOGIN_FAILED_MESSAGE = "Invalid login credentials.";

function genericLoginFailure(): Result<never> {
  return fail(new AppError(VENDOR_LOGIN_FAILED_CODE, VENDOR_LOGIN_FAILED_MESSAGE));
}

/**
 * Internal audit classification. Written to auth_security_events metadata (never
 * exposed to an unauthenticated caller) so operators can distinguish the causes
 * the public error deliberately hides.
 */
export const VendorLoginFailureClassification = {
  INVALID_LOGIN_IDENTIFIER: "invalid_login_identifier",
  MISSING_CREDENTIAL: "missing_credential",
  AUTHENTICATION_REJECTED: "authentication_rejected",
  NO_VENDOR_MAPPING: "no_vendor_mapping",
  MEMBERSHIP_NOT_ACTIVE: "membership_not_active",
  MALFORMED_MAPPING: "malformed_mapping",
  VENDOR_NOT_FOUND: "vendor_not_found",
  LOOKUP_FAILED: "lookup_failed",
  NOT_AUTHENTICATED: "not_authenticated",
} as const;

export type VendorLoginFailureClassificationValue =
  (typeof VendorLoginFailureClassification)[keyof typeof VendorLoginFailureClassification];

/** Maps an access-denial reason onto its audit classification. */
const DENIAL_CLASSIFICATION: Record<string, VendorLoginFailureClassificationValue> = {
  [VendorAccessDenialReason.NOT_AUTHENTICATED]: VendorLoginFailureClassification.NOT_AUTHENTICATED,
  [VendorAccessDenialReason.NO_VENDOR_MAPPING]: VendorLoginFailureClassification.NO_VENDOR_MAPPING,
  [VendorAccessDenialReason.MEMBERSHIP_NOT_ACTIVE]: VendorLoginFailureClassification.MEMBERSHIP_NOT_ACTIVE,
  [VendorAccessDenialReason.MALFORMED_MAPPING]: VendorLoginFailureClassification.MALFORMED_MAPPING,
  [VendorAccessDenialReason.VENDOR_NOT_FOUND]: VendorLoginFailureClassification.VENDOR_NOT_FOUND,
  [VendorAccessDenialReason.LOOKUP_FAILED]: VendorLoginFailureClassification.LOOKUP_FAILED,
};

export interface VendorPasswordLoginInput {
  /** Email or explicitly international phone. Never persisted in any form. */
  readonly identifier: string;
  /** Never stored, never logged, never audited, never in metadata. */
  readonly password: string;
  readonly correlationId?: string | null;
}

export interface VendorPasswordLoginSuccess {
  readonly authUserId: string;
  readonly vendorId: string;
  readonly vendorDashboardUserId: string;
  readonly role: string;
  readonly loginMethod: typeof VendorLoginMethod.PASSWORD;
  readonly identifierKind: VendorLoginIdentifier["kind"];
  /** False when the audit write failed; login still succeeded. */
  readonly auditRecorded: boolean;
}

async function auditLoginFailure(params: {
  classification: VendorLoginFailureClassificationValue;
  identifier: VendorLoginIdentifier | null;
  actorUserId: string | null;
  correlationId: string | null;
}): Promise<void> {
  // Only the HASH of a canonical identifier is ever persisted; an identifier we
  // could not canonicalize contributes nothing at all.
  const destinationHash = params.identifier ? hashVendorLoginIdentifier(params.identifier) : null;

  await recordAuthSecurityEvent({
    eventType: AuthSecurityEventType.VENDOR_LOGIN_FAILED,
    principalType: PrincipalType.VENDOR,
    principalId: null,
    actorUserId: params.actorUserId,
    correlationId: params.correlationId,
    destinationHash,
    metadata: {
      login_method: VendorLoginMethod.PASSWORD,
      login_identifier_kind: params.identifier?.kind ?? null,
      failure_classification: params.classification,
    },
  });
}

/** Invalidate a session we just created but must not hand out. */
async function invalidateSession(sb: SupabaseClient): Promise<void> {
  try {
    await sb.auth.signOut();
  } catch {
    /* best effort — the caller still receives a denial */
  }
}

/**
 * Authenticate a vendor with Supabase Auth, then resolve their vendor access.
 * Returns a single generic failure for every rejection path.
 */
export async function vendorPasswordLogin(
  input: VendorPasswordLoginInput
): Promise<Result<VendorPasswordLoginSuccess>> {
  const correlationId = input?.correlationId ?? null;

  try {
    const normalized = normalizeVendorLoginIdentifier(input?.identifier);
    if (!normalized.ok) {
      // Ambiguous local phone numbers land here: no country code is ever guessed.
      await auditLoginFailure({
        classification: VendorLoginFailureClassification.INVALID_LOGIN_IDENTIFIER,
        identifier: null,
        actorUserId: null,
        correlationId,
      });
      return genericLoginFailure();
    }
    const identifier = normalized.identifier;

    if (typeof input.password !== "string" || input.password.length === 0) {
      await auditLoginFailure({
        classification: VendorLoginFailureClassification.MISSING_CREDENTIAL,
        identifier,
        actorUserId: null,
        correlationId,
      });
      return genericLoginFailure();
    }

    // The request-scoped SSR client: this is what establishes the browser session.
    const sb = await serverClient();

    const credentials =
      identifier.kind === "email"
        ? { email: identifier.canonical, password: input.password }
        : { phone: identifier.canonical, password: input.password };

    const { data, error } = await sb.auth.signInWithPassword(credentials);

    if (error || !data?.user?.id) {
      await auditLoginFailure({
        classification: VendorLoginFailureClassification.AUTHENTICATION_REJECTED,
        identifier,
        actorUserId: null,
        correlationId,
      });
      return genericLoginFailure();
    }

    const authUserId = data.user.id;
    const access = await resolveVendorAccess(authUserId);

    if (!access.ok) {
      // Authentic Supabase user, but not a vendor we grant dashboard access to.
      // Tear down the session we just established, through the same auth context.
      await invalidateSession(sb);
      await auditLoginFailure({
        classification:
          DENIAL_CLASSIFICATION[access.reason] ?? VendorLoginFailureClassification.LOOKUP_FAILED,
        identifier,
        actorUserId: authUserId,
        correlationId,
      });
      return genericLoginFailure();
    }

    const context = access.context;

    // Server-side only: `authenticated` holds no UPDATE grant on this table.
    await recordVendorLoginMetadata(context.vendorDashboardUserId, VendorLoginMethod.PASSWORD);

    const audit = await recordAuthSecurityEvent({
      eventType: AuthSecurityEventType.VENDOR_LOGIN_SUCCESS,
      principalType: PrincipalType.VENDOR,
      principalId: context.vendorId,
      actorUserId: authUserId,
      correlationId,
      destinationHash: hashVendorLoginIdentifier(identifier),
      metadata: {
        login_method: VendorLoginMethod.PASSWORD,
        login_identifier_kind: identifier.kind,
        vendor_dashboard_role: context.role,
      },
    });

    return ok({
      authUserId,
      vendorId: context.vendorId,
      vendorDashboardUserId: context.vendorDashboardUserId,
      role: context.role,
      loginMethod: VendorLoginMethod.PASSWORD,
      identifierKind: identifier.kind,
      auditRecorded: audit.ok,
    });
  } catch {
    // Never leak an internal error shape through the login surface.
    return genericLoginFailure();
  }
}
