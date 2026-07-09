// ============================================================================
// QuickFurno — services/clientOtpAuthService.ts   (server-only)
//
// Client (homeowner) WhatsApp OTP login, built ON TOP OF Supabase Auth.
//
// AUTHORITATIVE MODEL
//   • Supabase Auth generates, validates, and verifies the OTP and owns the
//     session. This service never generates an OTP, never stores one, never
//     writes a verification_challenges row, and never mints a custom JWT/session.
//   • The request path calls the REQUEST-SCOPED SSR client's
//     signInWithOtp({ phone }) — NOT admin auth, NOT channel:"whatsapp"
//     (QuickFurno reroutes the Supabase-generated OTP through its own provider-
//     neutral WhatsApp Send SMS hook).
//   • The verify path calls verifyOtp({ phone, token, type:"sms" }), then requires
//     the Auth phone to match, a fresh QuickFurno WhatsApp communication
//     attestation to exist, and a safe client_accounts provisioning to succeed —
//     only then is whatsapp_verified_at written.
//
// FAILURE DISCIPLINE
//   • The OTP token is opaque and never logged, hashed, stored, or audited.
//   • Every verify rejection returns ONE generic public error; the cause is kept
//     only in sanitized audit metadata.
//   • Any denial AFTER verifyOtp established a session invalidates ONLY that local
//     session (Phase 5C-equivalent semantics), never a global sign-out.
// ============================================================================

import { adminClient, serverClient } from "../lib/supabase";
import { AppError, appError, fail, ok, type Result } from "../lib/errors";
import { hashPhoneE164, normalizePhoneE164 } from "../lib/communication/phone";
import { AuthSecurityEventType } from "../lib/identity/authSecurityEvent";
import { PrincipalType } from "../lib/identity/principal";
import type { ClientAccessContext } from "../lib/identity/clientAccess";
import {
  ATTESTATION_SUCCESS_STATUSES,
  CLIENT_OTP_VERIFY_FAILED_CODE,
  CLIENT_OTP_VERIFY_FAILED_MESSAGE,
  ClientOtpRequestFailureClassification,
  ClientOtpRequestStatus,
  ClientOtpVerifyFailureClassification,
  isAttestationFresh,
  isAttestationSuccessStatus,
  isPlausibleOtpToken,
  normalizeAuthProvidedPhone,
  type ClientOtpRequestResponse,
  type ClientOtpRequestFailureClassificationValue,
  type ClientOtpVerifyFailureClassificationValue,
} from "../lib/identity/clientOtp";
import {
  CLIENT_LOGIN_OTP_ENTITY_TYPE,
  CLIENT_LOGIN_OTP_LANE,
  CLIENT_LOGIN_OTP_MESSAGE_TYPE,
} from "../lib/identity/clientOtpAutomation";
import {
  invalidateLocalSession,
  type SessionInvalidationOutcome,
} from "../lib/identity/sessionInvalidation";
import { recordAuthSecurityEvent } from "./authSecurityEventService";
import { evaluateClientLoginOtpGate } from "./clientOtpAutomationService";
import { provisionVerifiedClientAccount } from "./clientAccessService";
import type { SupabaseClient } from "@supabase/supabase-js";

const AUDIT_TRANSPORT = "whatsapp_hook";
const COMMUNICATION_MESSAGES_TABLE = "communication_messages";

// ----------------------------------------------------------------------------
// Audit helpers (sanitized; no OTP, token, raw phone, or raw Auth error)
// ----------------------------------------------------------------------------
async function auditRequest(params: {
  succeeded: boolean;
  classification?: ClientOtpRequestFailureClassificationValue;
  destinationHash: string | null;
  correlationId: string | null;
}): Promise<void> {
  if (params.succeeded) {
    await recordAuthSecurityEvent({
      eventType: AuthSecurityEventType.CLIENT_OTP_REQUESTED,
      principalType: PrincipalType.CLIENT,
      correlationId: params.correlationId,
      destinationHash: params.destinationHash,
      metadata: { transport: AUDIT_TRANSPORT },
    });
    return;
  }
  await recordAuthSecurityEvent({
    eventType: AuthSecurityEventType.CLIENT_OTP_REQUEST_FAILED,
    principalType: PrincipalType.CLIENT,
    correlationId: params.correlationId,
    destinationHash: params.destinationHash,
    metadata: { transport: AUDIT_TRANSPORT, failure_classification: params.classification },
  });
}

async function auditVerifyFailed(params: {
  classification: ClientOtpVerifyFailureClassificationValue;
  destinationHash: string | null;
  correlationId: string | null;
  actorUserId: string | null;
  sessionInvalidation?: SessionInvalidationOutcome | null;
}): Promise<void> {
  const metadata: Record<string, unknown> = {
    transport: AUDIT_TRANSPORT,
    failure_classification: params.classification,
  };
  if (params.sessionInvalidation) {
    metadata.session_invalidated = params.sessionInvalidation.invalidated;
    metadata.session_invalidation_failure = params.sessionInvalidation.failure;
    metadata.session_invalidation_attempts = params.sessionInvalidation.attempts;
  }
  await recordAuthSecurityEvent({
    eventType: AuthSecurityEventType.CLIENT_OTP_VERIFY_FAILED,
    principalType: PrincipalType.CLIENT,
    principalId: null,
    actorUserId: params.actorUserId,
    correlationId: params.correlationId,
    destinationHash: params.destinationHash,
    metadata,
  });
}

// ----------------------------------------------------------------------------
// OTP REQUEST
// ----------------------------------------------------------------------------
export interface RequestClientWhatsappOtpInput {
  readonly phone: string;
  readonly correlationId?: string | null;
}

/**
 * Start a client WhatsApp OTP login. Normalizes the phone, checks the operational
 * gate, and — only if operational — asks Supabase Auth to generate + deliver the
 * OTP through signInWithOtp. Returns a NON-ENUMERATING response: an existing and a
 * first-time number get the identical `otp_requested` result, and a post-call
 * Supabase error does not change it.
 */
export async function requestClientWhatsappOtp(
  input: RequestClientWhatsappOtpInput
): Promise<ClientOtpRequestResponse> {
  const correlationId = input?.correlationId ?? null;
  try {
    const normalized = normalizePhoneE164(input?.phone);
    if (!normalized.ok) {
      await auditRequest({
        succeeded: false,
        classification: ClientOtpRequestFailureClassification.INVALID_PHONE,
        destinationHash: null,
        correlationId,
      });
      return { ok: false, status: ClientOtpRequestStatus.INVALID_PHONE };
    }
    const phoneE164 = normalized.e164;
    const destinationHash = hashPhoneE164(phoneE164);

    // The production kill-switch. If the automation is not operationally enabled,
    // we never call signInWithOtp.
    const gate = await evaluateClientLoginOtpGate();
    if (!gate.ok) {
      await auditRequest({
        succeeded: false,
        classification: ClientOtpRequestFailureClassification.SERVICE_UNAVAILABLE,
        destinationHash,
        correlationId,
      });
      return { ok: false, status: ClientOtpRequestStatus.SERVICE_UNAVAILABLE };
    }

    // Request-scoped SSR client — Supabase Auth is the OTP + session authority.
    // First-time numbers follow the Supabase user-creation path (default).
    const sb = await serverClient();
    const { error } = await sb.auth.signInWithOtp({ phone: phoneE164 });

    if (error) {
      // Do NOT reveal whether the user exists or why Supabase declined. The raw
      // Auth error is never persisted; only a sanitized classification is.
      await auditRequest({
        succeeded: false,
        classification: ClientOtpRequestFailureClassification.OTP_DISPATCH_REJECTED,
        destinationHash,
        correlationId,
      });
      return { ok: true, status: ClientOtpRequestStatus.OTP_REQUESTED };
    }

    await auditRequest({ succeeded: true, destinationHash, correlationId });
    return { ok: true, status: ClientOtpRequestStatus.OTP_REQUESTED };
  } catch {
    // Never leak an internal error shape; keep the response non-enumerating.
    return { ok: true, status: ClientOtpRequestStatus.OTP_REQUESTED };
  }
}

// ----------------------------------------------------------------------------
// OTP VERIFY
// ----------------------------------------------------------------------------
export interface VerifyClientWhatsappOtpInput {
  readonly phone: string;
  /** Opaque short authentication secret. Never logged, hashed, stored, or audited. */
  readonly token: string;
  readonly correlationId?: string | null;
}

export interface VerifyClientWhatsappOtpSuccess extends ClientAccessContext {
  /** False when the success audit write failed; the login still succeeded. */
  readonly auditRecorded: boolean;
}

function genericVerifyFailure(): Result<never> {
  return fail(new AppError(CLIENT_OTP_VERIFY_FAILED_CODE, CLIENT_OTP_VERIFY_FAILED_MESSAGE));
}

/**
 * Verify a client WhatsApp OTP and establish authenticated client access.
 * Every rejection path returns one indistinguishable generic failure.
 */
export async function verifyClientWhatsappOtp(
  input: VerifyClientWhatsappOtpInput
): Promise<Result<VerifyClientWhatsappOtpSuccess>> {
  const correlationId = input?.correlationId ?? null;
  try {
    const normalized = normalizePhoneE164(input?.phone);
    if (!normalized.ok) {
      await auditVerifyFailed({
        classification: ClientOtpVerifyFailureClassification.INVALID_PHONE,
        destinationHash: null,
        correlationId,
        actorUserId: null,
      });
      return genericVerifyFailure();
    }
    const phoneE164 = normalized.e164;
    const destinationHash = hashPhoneE164(phoneE164);

    if (!isPlausibleOtpToken(input?.token)) {
      await auditVerifyFailed({
        classification: ClientOtpVerifyFailureClassification.INVALID_TOKEN_SHAPE,
        destinationHash,
        correlationId,
        actorUserId: null,
      });
      return genericVerifyFailure();
    }
    const token = input.token.trim();

    // Request-scoped SSR client — this is what establishes the browser session.
    const sb = await serverClient();
    const { data, error } = await sb.auth.verifyOtp({ phone: phoneE164, token, type: "sms" });

    if (error || !data?.user?.id) {
      // Ordinary OTP failure: no session, no client account, no verified timestamp.
      await auditVerifyFailed({
        classification: error
          ? ClientOtpVerifyFailureClassification.OTP_REJECTED
          : ClientOtpVerifyFailureClassification.NO_AUTH_USER,
        destinationHash,
        correlationId,
        actorUserId: null,
      });
      return genericVerifyFailure();
    }

    const authUserId = data.user.id;

    // A session may now exist. Any denial below must tear ONLY it down.
    try {
      // The Auth user's verified phone must normalize to the same canonical phone.
      const authPhone = normalizeAuthProvidedPhone(
        typeof data.user.phone === "string" ? data.user.phone : null
      );
      if (!authPhone.ok || authPhone.e164 !== phoneE164) {
        return await denyAfterAuth({
          sb,
          classification: ClientOtpVerifyFailureClassification.AUTH_PHONE_MISMATCH,
          destinationHash,
          correlationId,
          authUserId,
        });
      }

      // The automation must be operationally acceptable AND a fresh QuickFurno
      // WhatsApp communication attestation must exist. A disabled mock-only
      // automation can never prove production WhatsApp delivery.
      const gate = await evaluateClientLoginOtpGate();
      if (!gate.ok) {
        return await denyAfterAuth({
          sb,
          classification: ClientOtpVerifyFailureClassification.ATTESTATION_MISSING,
          destinationHash,
          correlationId,
          authUserId,
        });
      }

      const attested = await hasFreshCommunicationAttestation(authUserId, phoneE164);
      if (!attested) {
        return await denyAfterAuth({
          sb,
          classification: ClientOtpVerifyFailureClassification.ATTESTATION_MISSING,
          destinationHash,
          correlationId,
          authUserId,
        });
      }

      // Resolve/provision the client identity. This is the ONLY place
      // whatsapp_verified_at is written, and only now.
      const provisioning = await provisionVerifiedClientAccount({ authUserId, phoneE164 });
      if (!provisioning.ok) {
        return await denyAfterAuth({
          sb,
          classification: provisioning.classification,
          destinationHash,
          correlationId,
          authUserId,
        });
      }
      const context = provisioning.context;

      const audit = await recordAuthSecurityEvent({
        eventType: AuthSecurityEventType.CLIENT_LOGIN_SUCCESS,
        principalType: PrincipalType.CLIENT,
        principalId: context.clientAccountId,
        actorUserId: authUserId,
        correlationId,
        destinationHash,
        metadata: { transport: AUDIT_TRANSPORT, login_method: "whatsapp_otp" },
      });

      return ok({ ...context, auditRecorded: audit.ok });
    } catch {
      // Unsafe lookup/provisioning failure AFTER authentication → invalidate the
      // session we cannot safely hand out.
      return await denyAfterAuth({
        sb,
        classification: ClientOtpVerifyFailureClassification.PROVISIONING_FAILED,
        destinationHash,
        correlationId,
        authUserId,
      });
    }
  } catch {
    // Pre-authentication failure (no session to invalidate).
    return genericVerifyFailure();
  }
}

/**
 * Tear down ONLY the current local session, record a sanitized failure, and
 * return the generic denial. The public result is identical whether or not the
 * invalidation was confirmed.
 */
async function denyAfterAuth(params: {
  sb: SupabaseClient;
  classification: ClientOtpVerifyFailureClassificationValue;
  destinationHash: string | null;
  correlationId: string | null;
  authUserId: string;
}): Promise<Result<never>> {
  const sessionInvalidation = await invalidateLocalSession(params.sb);
  await auditVerifyFailed({
    classification: params.classification,
    destinationHash: params.destinationHash,
    correlationId: params.correlationId,
    actorUserId: params.authUserId,
    sessionInvalidation,
  });
  return genericVerifyFailure();
}

/**
 * Confirm a recent, successful QuickFurno WhatsApp communication for this auth
 * user + phone. The ledger match proves QuickFurno's transport carried the OTP;
 * the verified OTP proves possession of the code. Both are required.
 */
async function hasFreshCommunicationAttestation(
  authUserId: string,
  phoneE164: string
): Promise<boolean> {
  const destinationHash = hashPhoneE164(phoneE164);
  const { data, error } = await adminClient()
    .from(COMMUNICATION_MESSAGES_TABLE)
    .select("id, status, created_at, entity_id, destination_hash")
    .eq("message_type", CLIENT_LOGIN_OTP_MESSAGE_TYPE)
    .eq("lane", CLIENT_LOGIN_OTP_LANE)
    .eq("entity_type", CLIENT_LOGIN_OTP_ENTITY_TYPE)
    .eq("entity_id", authUserId)
    .eq("destination_hash", destinationHash)
    .in("status", ATTESTATION_SUCCESS_STATUSES as string[])
    .order("created_at", { ascending: false })
    .limit(1);

  if (error) throw error;
  const rows = (data ?? []) as Array<{
    status: string;
    created_at: string;
    entity_id: string;
    destination_hash: string;
  }>;
  const row = rows[0];
  if (!row) return false;

  // Defence in depth (never trust a lenient query layer): re-check every field.
  if (row.entity_id !== authUserId) return false;
  if (row.destination_hash !== destinationHash) return false;
  if (!isAttestationSuccessStatus(row.status)) return false;
  if (!isAttestationFresh(row.created_at)) return false;
  return true;
}

// Re-export so a caller resolving the current client uses the canonical guard.
export { requireClientAccess, resolveCurrentClientAccess } from "./clientAccessService";
