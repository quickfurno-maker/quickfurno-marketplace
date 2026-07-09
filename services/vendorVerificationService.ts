// ============================================================================
// QuickFurno — services/vendorVerificationService.ts   (server-only)
//
// Vendor WhatsApp IDENTITY VERIFICATION. An AUTHENTICATED vendor proves possession
// of an explicitly-supplied international phone number; only then is that number
// bound to their dashboard identity as `phone_e164` and are `phone_verified` /
// `whatsapp_otp_enabled` set.
//
// WHAT THIS IS NOT
//   • Not a login. Phase 5C vendor login is untouched and continues to depend on
//     exactly three things: an authentic Supabase user, a valid mapping, an active
//     membership. It never reads phone_verified or whatsapp_otp_enabled.
//   • Not a business-contact update. `vendors.phone` and `vendors.whatsapp_number`
//     are never read and never written here.
//   • Not a country-code guess. A bare national number is REJECTED; no legacy
//     `vendor_dashboard_users.phone` value is ever promoted to `phone_e164`.
//
// The identity authority is `VendorAccessContext` from the Supabase session. A
// vendor_id, dashboard-user id, or challenge id arriving from the browser is
// UNTRUSTED: a challenge is only ever accepted when its stored lineage matches the
// resolved context on all three axes.
// ============================================================================

import { AppError, fail, ok, type Result } from "../lib/errors";
import { maskPhoneE164, normalizePhoneE164 } from "../lib/communication/phone";
import { AuthSecurityEventType } from "../lib/identity/authSecurityEvent";
import { PrincipalType } from "../lib/identity/principal";
import {
  VerificationPurpose,
  challengePurposeMatches,
  VerificationChallengeStatus,
} from "../lib/identity/verification";
import type { VendorAccessContext } from "../lib/identity/vendorAccess";
import { VENDOR_WHATSAPP_VERIFY_BINDING } from "../lib/identity/vendorAuthAutomation";
import {
  VENDOR_OTP_MAX_ATTEMPTS,
  VENDOR_WHATSAPP_REQUEST_FAILED_CODE,
  VENDOR_WHATSAPP_REQUEST_FAILED_MESSAGE,
  VENDOR_WHATSAPP_VERIFY_FAILED_CODE,
  VENDOR_WHATSAPP_VERIFY_FAILED_MESSAGE,
  VendorVerificationFailureClassification,
  challengeExpiryIso,
  isChallengeExpired,
  type VendorChallengeIssued,
  type VendorVerificationFailureClassificationValue,
  type VendorWhatsappVerificationResult,
} from "../lib/identity/vendorVerification";
import {
  generateVendorOtp,
  hashVendorOtp,
  isPlausibleVendorOtp,
  isUuidShaped,
  loadVendorOtpPeppers,
  primaryVendorOtpPepper,
  verifyVendorOtp,
} from "../lib/identity/vendorOtpCrypto";
import { ephemeralAuthDestination, type CommunicationIntent } from "../lib/communication/types";
import { CommunicationService } from "./communicationService";
import { recordAuthSecurityEvent } from "./authSecurityEventService";
import { requireVendorAccess } from "./vendorAccessService";
import { evaluateVendorAuthAutomationGate } from "./vendorAuthAutomationService";
import {
  cancelChallenge,
  consumeWhatsappChallenge,
  destinationHashFor,
  expirePendingChallenge,
  hasFreshChallengeAttestation,
  issueChallengeAtomic,
  loadChallenge,
  newChallengeId,
  recordChallengeDelivery,
  registerFailedAttempt,
  type IssueChallengeReason,
  type VendorChallengeRow,
} from "./vendorAuthChallengeService";

const AUDIT_TRANSPORT = "whatsapp";
const PURPOSE = VerificationPurpose.VENDOR_WHATSAPP_VERIFY;
const BINDING = VENDOR_WHATSAPP_VERIFY_BINDING;

function requestFailure(): Result<never> {
  return fail(new AppError(VENDOR_WHATSAPP_REQUEST_FAILED_CODE, VENDOR_WHATSAPP_REQUEST_FAILED_MESSAGE));
}

/** Map an atomic-issuance refusal onto a sanitized audit classification. */
function issueReasonToClassification(
  reason: IssueChallengeReason
): VendorVerificationFailureClassificationValue {
  switch (reason) {
    case "rate_limited":
      return VendorVerificationFailureClassification.RATE_LIMITED;
    case "lineage_mismatch":
      return VendorVerificationFailureClassification.CHALLENGE_OWNERSHIP_MISMATCH;
    case "membership_not_active":
      return VendorVerificationFailureClassification.NO_VENDOR_ACCESS;
    case "purpose_invalid":
      return VendorVerificationFailureClassification.PURPOSE_MISMATCH;
    default:
      return VendorVerificationFailureClassification.ISSUE_FAILED;
  }
}
function verifyFailure(): Result<never> {
  return fail(new AppError(VENDOR_WHATSAPP_VERIFY_FAILED_CODE, VENDOR_WHATSAPP_VERIFY_FAILED_MESSAGE));
}

// ----------------------------------------------------------------------------
// Sanitized auditing — never an OTP, OTP hash, pepper, raw phone, or raw error
// ----------------------------------------------------------------------------
async function auditFailure(params: {
  eventType: typeof AuthSecurityEventType.VENDOR_WHATSAPP_VERIFICATION_FAILED | typeof AuthSecurityEventType.AUTH_RATE_LIMIT_TRIGGERED | typeof AuthSecurityEventType.AUTH_CHALLENGE_EXPIRED;
  classification: VendorVerificationFailureClassificationValue;
  destinationHash: string | null;
  correlationId: string | null;
  context: VendorAccessContext | null;
  challengeId?: string | null;
  attemptCount?: number | null;
  extra?: Record<string, unknown>;
}): Promise<void> {
  await recordAuthSecurityEvent({
    eventType: params.eventType,
    principalType: PrincipalType.VENDOR,
    principalId: params.context?.vendorId ?? null,
    actorUserId: params.context?.authUserId ?? null,
    purpose: PURPOSE,
    correlationId: params.correlationId,
    destinationHash: params.destinationHash,
    metadata: {
      transport: AUDIT_TRANSPORT,
      failure_classification: params.classification,
      challenge_id: params.challengeId ?? null,
      attempt_count: params.attemptCount ?? null,
      vendor_dashboard_role: params.context?.role ?? null,
      ...(params.extra ?? {}),
    },
  });
}

// ============================================================================
// REQUEST — issue a purpose-bound challenge and dispatch its OTP
// ============================================================================
export interface RequestVendorWhatsappVerificationInput {
  /** MUST be explicitly international. A bare local number is rejected. */
  readonly phone: string;
  readonly correlationId?: string | null;
}

export async function requestVendorWhatsappVerification(
  input: RequestVendorWhatsappVerificationInput
): Promise<Result<VendorChallengeIssued>> {
  const correlationId = input?.correlationId ?? null;
  try {
    // 1) Identity authority comes from the session, never from the request body.
    const access = await requireVendorAccess();
    if (!access.ok) return requestFailure();
    const context = access.data;

    // 2) Explicit canonical E.164 only. No country code is ever inferred, and the
    //    legacy `vendor_dashboard_users.phone` column is never consulted.
    const normalized = normalizePhoneE164(input?.phone);
    if (!normalized.ok) {
      await auditFailure({
        eventType: AuthSecurityEventType.VENDOR_WHATSAPP_VERIFICATION_FAILED,
        classification:
          normalized.code === "PHONE_MISSING_COUNTRY_CODE"
            ? VendorVerificationFailureClassification.AMBIGUOUS_LOCAL_PHONE
            : VendorVerificationFailureClassification.INVALID_PHONE,
        destinationHash: null,
        correlationId,
        context,
      });
      return requestFailure();
    }
    const phoneE164 = normalized.e164;
    const destinationHash = destinationHashFor(phoneE164);

    // 3) The production kill-switch. Disabled → no challenge, no OTP, no provider.
    const gate = await evaluateVendorAuthAutomationGate(BINDING);
    if (!gate.ok) {
      await auditFailure({
        eventType: AuthSecurityEventType.VENDOR_WHATSAPP_VERIFICATION_FAILED,
        classification: VendorVerificationFailureClassification.SERVICE_UNAVAILABLE,
        destinationHash,
        correlationId,
        context,
      });
      return requestFailure();
    }

    // 4) Without a pepper we cannot hash an OTP safely. Fail closed.
    const peppers = loadVendorOtpPeppers();
    const pepper = primaryVendorOtpPepper(peppers);
    if (!pepper) {
      await auditFailure({
        eventType: AuthSecurityEventType.VENDOR_WHATSAPP_VERIFICATION_FAILED,
        classification: VendorVerificationFailureClassification.PEPPER_NOT_CONFIGURED,
        destinationHash,
        correlationId,
        context,
      });
      return requestFailure();
    }

    // 5–9) The OTP is generated and HMAC-bound in memory FIRST, then handed to the
    //    ONE atomic issuance authority. That database function serializes issuance
    //    for this identity under a FOR UPDATE lock and, in a single transaction,
    //    re-validates lineage, evaluates the persisted cooldown/hour/day limits,
    //    cancels the prior pending challenge, and inserts exactly one new one. A
    //    losing/rate-limited request inserts nothing, cancels nothing, sends nothing.
    const challengeId = newChallengeId();
    const otp = generateVendorOtp();
    const otpHash = hashVendorOtp(
      {
        challengeId,
        purpose: PURPOSE,
        vendorDashboardUserId: context.vendorDashboardUserId,
        destinationHash,
      },
      otp,
      pepper
    );

    // The expiry, attempt limit, cooldown, and rate limits are ALL owned by the
    // database function — no policy value is passed from here.
    const issued = await issueChallengeAtomic({
      challengeId,
      purpose: PURPOSE,
      vendorDashboardUserId: context.vendorDashboardUserId,
      authUserId: context.authUserId,
      vendorId: context.vendorId,
      destinationHash,
      otpHash,
    });
    if (!issued.ok) {
      const rateLimited = issued.reason === "rate_limited";
      await auditFailure({
        eventType: rateLimited
          ? AuthSecurityEventType.AUTH_RATE_LIMIT_TRIGGERED
          : AuthSecurityEventType.VENDOR_WHATSAPP_VERIFICATION_FAILED,
        classification: issueReasonToClassification(issued.reason),
        destinationHash,
        correlationId,
        context,
        challengeId,
        extra: rateLimited ? { rate_limit_scope: issued.scope ?? null } : undefined,
      });
      return requestFailure();
    }

    // 10) One immediate authentication-lane dispatch. The OTP travels only in
    //     `variables` (the auth lane persists none) to a fenced ephemeral
    //     destination. `recipient_id` is the CANONICAL vendor id from the context.
    const intent: CommunicationIntent = {
      type: BINDING.messageType,
      lane: "authentication",
      channel: "whatsapp",
      recipient_type: "vendor",
      recipient_id: context.vendorId,
      destination_source: ephemeralAuthDestination(phoneE164),
      template_key: BINDING.templateKey,
      variables: { otp },
      entity_type: "verification_challenge",
      entity_id: challengeId,
      correlation_id: correlationId,
      idempotency_key: `${BINDING.messageType}:${challengeId}`,
      priority: "critical",
      scheduled_at: null,
      policy_decision_id: null,
      metadata: { purpose: PURPOSE, transport_origin: "vendor_whatsapp_verification" },
    };

    const sent = await new CommunicationService().send(intent);
    const delivered =
      sent.ok &&
      (sent.data.status === "accepted" ||
        sent.data.status === "sent" ||
        sent.data.status === "delivered" ||
        sent.data.status === "read");

    if (!delivered) {
      // 11) An OTP nobody received must not stay live.
      await cancelChallenge(challengeId);
      await auditFailure({
        eventType: AuthSecurityEventType.VENDOR_WHATSAPP_VERIFICATION_FAILED,
        classification: VendorVerificationFailureClassification.DISPATCH_FAILED,
        destinationHash,
        correlationId,
        context,
        challengeId,
      });
      return requestFailure();
    }

    // 12) Bind the ledger row + the CHANNEL and provider that actually carried it.
    //    If the link cannot be written (DB error) or matches zero rows (the challenge
    //    was concurrently terminalized), FAIL CLOSED: cancel the challenge rather than
    //    leave an unlinked-but-otherwise-pending challenge, and do NOT resend.
    const linked = await recordChallengeDelivery(
      challengeId,
      sent.data.id,
      sent.data.provider,
      sent.data.channel
    );
    if (!linked) {
      await cancelChallenge(challengeId);
      await auditFailure({
        eventType: AuthSecurityEventType.VENDOR_WHATSAPP_VERIFICATION_FAILED,
        classification: VendorVerificationFailureClassification.LINKAGE_FAILED,
        destinationHash,
        correlationId,
        context,
        challengeId,
      });
      return requestFailure();
    }

    await recordAuthSecurityEvent({
      eventType: AuthSecurityEventType.VENDOR_WHATSAPP_VERIFICATION_REQUESTED,
      principalType: PrincipalType.VENDOR,
      principalId: context.vendorId,
      actorUserId: context.authUserId,
      purpose: PURPOSE,
      correlationId,
      destinationHash,
      metadata: {
        transport: AUDIT_TRANSPORT,
        challenge_id: challengeId,
        provider: sent.data.provider,
        vendor_dashboard_role: context.role,
      },
    });

    // `expiresAt` here is an ADVISORY display hint for the UI countdown, derived from
    // the matching app-side TTL constant. The DATABASE stored the authoritative
    // expiry (now() + its own TTL) and the verify path enforces THAT, never this.
    return ok({
      ok: true,
      challengeId,
      expiresAt: challengeExpiryIso(),
      phoneMasked: maskPhoneE164(phoneE164),
    });
  } catch {
    return requestFailure();
  }
}

// ============================================================================
// VERIFY — prove possession, require transport attestation, then bind identity
// ============================================================================
export interface VerifyVendorWhatsappChallengeInput {
  readonly challengeId: string;
  readonly phone: string;
  /** Opaque six-digit secret. Never logged, hashed into audit, or persisted. */
  readonly otp: string;
  readonly correlationId?: string | null;
}

export async function verifyVendorWhatsappChallenge(
  input: VerifyVendorWhatsappChallengeInput
): Promise<Result<VendorWhatsappVerificationResult>> {
  const correlationId = input?.correlationId ?? null;
  try {
    const access = await requireVendorAccess();
    if (!access.ok) return verifyFailure();
    const context = access.data;

    if (!isUuidShaped(input?.challengeId)) {
      await auditFailure({
        eventType: AuthSecurityEventType.VENDOR_WHATSAPP_VERIFICATION_FAILED,
        classification: VendorVerificationFailureClassification.CHALLENGE_NOT_FOUND,
        destinationHash: null,
        correlationId,
        context,
      });
      return verifyFailure();
    }

    const normalized = normalizePhoneE164(input?.phone);
    if (!normalized.ok) {
      await auditFailure({
        eventType: AuthSecurityEventType.VENDOR_WHATSAPP_VERIFICATION_FAILED,
        classification:
          normalized.code === "PHONE_MISSING_COUNTRY_CODE"
            ? VendorVerificationFailureClassification.AMBIGUOUS_LOCAL_PHONE
            : VendorVerificationFailureClassification.INVALID_PHONE,
        destinationHash: null,
        correlationId,
        context,
      });
      return verifyFailure();
    }
    const phoneE164 = normalized.e164;
    const destinationHash = destinationHashFor(phoneE164);

    if (!isPlausibleVendorOtp(input?.otp)) {
      await auditFailure({
        eventType: AuthSecurityEventType.VENDOR_WHATSAPP_VERIFICATION_FAILED,
        classification: VendorVerificationFailureClassification.INVALID_OTP_SHAPE,
        destinationHash,
        correlationId,
        context,
        challengeId: input.challengeId,
      });
      return verifyFailure();
    }

    const challenge = await loadChallenge(input.challengeId.trim());
    if (!challenge) {
      await auditFailure({
        eventType: AuthSecurityEventType.VENDOR_WHATSAPP_VERIFICATION_FAILED,
        classification: VendorVerificationFailureClassification.CHALLENGE_NOT_FOUND,
        destinationHash,
        correlationId,
        context,
        challengeId: input.challengeId,
      });
      return verifyFailure();
    }

    const denial = await guardChallengeForContext(challenge, context, {
      destinationHash,
      correlationId,
    });
    if (denial) return verifyFailure();

    // The gate is what authorizes a provider; the attestation is bound to it.
    const gate = await evaluateVendorAuthAutomationGate(BINDING);
    if (!gate.ok) {
      await auditFailure({
        eventType: AuthSecurityEventType.VENDOR_WHATSAPP_VERIFICATION_FAILED,
        classification: VendorVerificationFailureClassification.SERVICE_UNAVAILABLE,
        destinationHash,
        correlationId,
        context,
        challengeId: challenge.id,
      });
      return verifyFailure();
    }

    const peppers = loadVendorOtpPeppers();
    if (peppers.length === 0) {
      await auditFailure({
        eventType: AuthSecurityEventType.VENDOR_WHATSAPP_VERIFICATION_FAILED,
        classification: VendorVerificationFailureClassification.PEPPER_NOT_CONFIGURED,
        destinationHash,
        correlationId,
        context,
        challengeId: challenge.id,
      });
      return verifyFailure();
    }

    // Contextual HMAC over the challenge id, purpose, dashboard identity, and
    // destination hash — verified against EVERY configured pepper (rotation).
    const otpValid = verifyVendorOtp(
      {
        challengeId: challenge.id,
        purpose: PURPOSE,
        vendorDashboardUserId: context.vendorDashboardUserId,
        destinationHash,
      },
      input.otp.trim(),
      challenge.otp_hash as string,
      peppers
    );

    if (!otpValid) {
      // ATOMIC increment + lock. Never a read-then-write in application code.
      const attempt = await registerFailedAttempt(challenge.id, PURPOSE);
      await auditFailure({
        eventType: AuthSecurityEventType.VENDOR_WHATSAPP_VERIFICATION_FAILED,
        classification: VendorVerificationFailureClassification.OTP_REJECTED,
        destinationHash,
        correlationId,
        context,
        challengeId: challenge.id,
        attemptCount: attempt.attemptCount,
        extra: { challenge_locked: attempt.locked },
      });
      return verifyFailure();
    }

    // The OTP proves possession of the code; the ledger proves OUR authorized
    // transport carried it. Both are required, and the CHANNEL and provider that
    // carried it must be the ones the binding + gate authorized (Phase 5E: whatsapp).
    const attested = await hasFreshChallengeAttestation({
      challengeId: challenge.id,
      destinationHash,
      messageType: BINDING.messageType,
      expectedChannel: BINDING.channel,
      expectedProvider: gate.providerRequired,
    });
    if (
      !attested ||
      challenge.delivery_channel !== BINDING.channel ||
      challenge.delivery_provider !== gate.providerRequired
    ) {
      await auditFailure({
        eventType: AuthSecurityEventType.VENDOR_WHATSAPP_VERIFICATION_FAILED,
        classification: VendorVerificationFailureClassification.ATTESTATION_MISSING,
        destinationHash,
        correlationId,
        context,
        challengeId: challenge.id,
      });
      return verifyFailure();
    }

    // ATOMIC: CAS the challenge to consumed, THEN bind the verified phone identity.
    const consumed = await consumeWhatsappChallenge({
      challengeId: challenge.id,
      vendorDashboardUserId: context.vendorDashboardUserId,
      authUserId: context.authUserId,
      vendorId: context.vendorId,
      phoneE164,
      destinationHash,
    });

    if (!consumed.ok || !consumed.identity) {
      await auditFailure({
        eventType: AuthSecurityEventType.VENDOR_WHATSAPP_VERIFICATION_FAILED,
        classification: consumed.phoneConflict
          ? VendorVerificationFailureClassification.PHONE_OWNERSHIP_CONFLICT
          : VendorVerificationFailureClassification.CONSUME_FAILED,
        destinationHash,
        correlationId,
        context,
        challengeId: challenge.id,
      });
      return verifyFailure();
    }

    const audit = await recordAuthSecurityEvent({
      eventType: AuthSecurityEventType.VENDOR_WHATSAPP_VERIFIED,
      principalType: PrincipalType.VENDOR,
      principalId: context.vendorId,
      actorUserId: context.authUserId,
      purpose: PURPOSE,
      correlationId,
      destinationHash,
      metadata: {
        transport: AUDIT_TRANSPORT,
        challenge_id: challenge.id,
        provider: gate.providerRequired,
        vendor_dashboard_role: context.role,
      },
    });

    return ok({
      vendorDashboardUserId: consumed.identity.vendorDashboardUserId,
      vendorId: consumed.identity.vendorId,
      authUserId: consumed.identity.authUserId,
      phoneMasked: maskPhoneE164(consumed.identity.phoneE164),
      phoneVerified: true,
      whatsappOtpEnabled: true,
      whatsappVerifiedAt: consumed.identity.whatsappVerifiedAt,
      auditRecorded: audit.ok,
    });
  } catch {
    return verifyFailure();
  }
}

/**
 * Every ownership / purpose / lifecycle / destination guard, in one place.
 * Returns a classification when the challenge must be REFUSED, else null.
 *
 * A challenge is accepted only when its stored lineage matches the resolved
 * session context on ALL THREE axes (dashboard identity, Auth user, vendor). It
 * can therefore never verify another vendor's identity, and — because the purpose
 * is compared with the Phase 5A `challengePurposeMatches` contract — never satisfy
 * a different purpose.
 */
async function guardChallengeForContext(
  challenge: VendorChallengeRow,
  context: VendorAccessContext,
  audit: { destinationHash: string; correlationId: string | null }
): Promise<VendorVerificationFailureClassificationValue | null> {
  const deny = async (
    classification: VendorVerificationFailureClassificationValue,
    eventType: typeof AuthSecurityEventType.VENDOR_WHATSAPP_VERIFICATION_FAILED | typeof AuthSecurityEventType.AUTH_CHALLENGE_EXPIRED = AuthSecurityEventType.VENDOR_WHATSAPP_VERIFICATION_FAILED
  ) => {
    await auditFailure({
      eventType,
      classification,
      destinationHash: audit.destinationHash,
      correlationId: audit.correlationId,
      context,
      challengeId: challenge.id,
    });
    return classification;
  };

  if (!challengePurposeMatches(challenge.purpose, PURPOSE)) {
    return await deny(VendorVerificationFailureClassification.PURPOSE_MISMATCH);
  }
  if (
    challenge.vendor_dashboard_user_id !== context.vendorDashboardUserId ||
    challenge.user_id !== context.authUserId ||
    challenge.vendor_id !== context.vendorId
  ) {
    return await deny(VendorVerificationFailureClassification.CHALLENGE_OWNERSHIP_MISMATCH);
  }
  if (challenge.status === VerificationChallengeStatus.LOCKED) {
    return await deny(VendorVerificationFailureClassification.CHALLENGE_LOCKED);
  }
  if (challenge.status !== VerificationChallengeStatus.PENDING) {
    return await deny(VendorVerificationFailureClassification.CHALLENGE_NOT_PENDING);
  }
  if (isChallengeExpired(challenge.expires_at)) {
    // Transition the ledger, never revive. Safety never depended on this running.
    await expirePendingChallenge(challenge.id);
    return await deny(
      VendorVerificationFailureClassification.CHALLENGE_EXPIRED,
      AuthSecurityEventType.AUTH_CHALLENGE_EXPIRED
    );
  }
  if (challenge.destination_hash !== audit.destinationHash) {
    return await deny(VendorVerificationFailureClassification.DESTINATION_MISMATCH);
  }
  return null;
}
