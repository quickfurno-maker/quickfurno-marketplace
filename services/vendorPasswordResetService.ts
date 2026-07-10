// ============================================================================
// QuickFurno — services/vendorPasswordResetService.ts   (server-only)
//
// Vendor password reset, in three steps:
//
//   1. request  (PUBLIC, unauthenticated, deliberately NON-ENUMERATING)
//        → resolves the dashboard identity server-side, requires an already
//          VERIFIED WhatsApp phone, and dispatches an OTP to that STORED number.
//   2. verify   (PUBLIC) → proves possession of the OTP, requires a provider-bound
//          transport attestation, and issues ONE single-use reset grant.
//   3. complete (PUBLIC) → atomically claims (burns) the grant, then asks the
//          server-only Supabase Auth Admin API to set the new password.
//
// AUTHORITY BOUNDARIES
//   • Supabase Auth is the ONLY password mutation authority. We never hash a
//     password, never write auth.users, never touch encrypted_password, and never
//     use generateLink as a second reset path.
//   • A reset grant is NOT a session. Nothing here signs anyone in; a completed
//     reset requires a fresh, ordinary Phase 5C vendor login afterwards.
//   • The reset OTP destination comes ONLY from the stored, previously verified
//     `vendor_dashboard_users.phone_e164`. A caller can never redirect it.
// ============================================================================

import crypto from "crypto";
import { adminClient } from "../lib/supabase";
import { AppError, fail, ok, type Result } from "../lib/errors";
import { normalizeVendorLoginIdentifier } from "../lib/identity/vendorLoginIdentifier";
import { AuthSecurityEventType } from "../lib/identity/authSecurityEvent";
import { PrincipalType } from "../lib/identity/principal";
import {
  VerificationPurpose,
  challengePurposeMatches,
  VerificationChallengeStatus,
} from "../lib/identity/verification";
import { isActiveVendorMembership } from "../lib/identity/vendorAccess";
import { VENDOR_PASSWORD_RESET_BINDING } from "../lib/identity/vendorAuthAutomation";
import { isChallengeExpired } from "../lib/identity/vendorVerification";
import {
  VENDOR_PASSWORD_RESET_FAILED_CODE,
  VENDOR_PASSWORD_RESET_FAILED_MESSAGE,
  VendorPasswordResetFailureClassification,
  checkVendorPasswordPolicy,
  vendorPasswordResetRequestReceived,
  type VendorPasswordResetCompleted,
  type VendorPasswordResetFailureClassificationValue,
  type VendorPasswordResetGrantIssued,
  type VendorPasswordResetRequestResponse,
} from "../lib/identity/vendorPasswordReset";
import {
  generateResetGrantToken,
  generateVendorOtp,
  hashResetGrantToken,
  hashVendorOtp,
  isPlausibleResetGrantToken,
  isPlausibleVendorOtp,
  isUuidShaped,
  loadVendorOtpPeppers,
  primaryVendorOtpPepper,
  verifyVendorOtp,
} from "../lib/identity/vendorOtpCrypto";
import { ephemeralAuthDestination, type CommunicationIntent } from "../lib/communication/types";
import { createRuntimeCommunicationService } from "./runtimeCommunicationService";
import { recordAuthSecurityEvent } from "./authSecurityEventService";
import { evaluateVendorAuthAutomationGate } from "./vendorAuthAutomationService";
import {
  cancelChallenge,
  claimResetGrant,
  consumeResetChallengeAndIssueGrant,
  destinationHashFor,
  expirePendingChallenge,
  hasFreshChallengeAttestation,
  issueChallengeAtomic,
  loadChallenge,
  newChallengeId,
  recordChallengeDelivery,
  registerFailedAttempt,
} from "./vendorAuthChallengeService";

const AUDIT_TRANSPORT = "whatsapp";
const PURPOSE = VerificationPurpose.VENDOR_PASSWORD_RESET;
const BINDING = VENDOR_PASSWORD_RESET_BINDING;
const VENDOR_DASHBOARD_USERS_TABLE = "vendor_dashboard_users";

/**
 * The columns the reset lookup reads. It reads NO business state: no
 * verification_status, paid_status, package, credits, accepting_leads. It never
 * reads the legacy `phone` column — only the canonical, verified `phone_e164`.
 */
const RESET_LOOKUP_COLUMNS =
  "id, vendor_id, user_id, email, role, status, phone_e164, phone_verified, whatsapp_otp_enabled, whatsapp_verified_at";

interface ResetIdentityRow {
  id: string | null;
  vendor_id: string | null;
  user_id: string | null;
  email: string | null;
  role: string | null;
  status: string | null;
  phone_e164: string | null;
  phone_verified: boolean | null;
  whatsapp_otp_enabled: boolean | null;
  whatsapp_verified_at: string | null;
}

function resetFailure(): Result<never> {
  return fail(new AppError(VENDOR_PASSWORD_RESET_FAILED_CODE, VENDOR_PASSWORD_RESET_FAILED_MESSAGE));
}

// ----------------------------------------------------------------------------
// Sanitized auditing — never a password, OTP, grant token, pepper, or raw error
// ----------------------------------------------------------------------------
async function auditResetFailure(params: {
  eventType:
    | typeof AuthSecurityEventType.VENDOR_PASSWORD_RESET_FAILED
    | typeof AuthSecurityEventType.VENDOR_PASSWORD_RESET_OTP_FAILED
    | typeof AuthSecurityEventType.AUTH_RATE_LIMIT_TRIGGERED
    | typeof AuthSecurityEventType.AUTH_CHALLENGE_EXPIRED;
  classification: VendorPasswordResetFailureClassificationValue;
  destinationHash?: string | null;
  correlationId: string | null;
  vendorId?: string | null;
  authUserId?: string | null;
  challengeId?: string | null;
  attemptCount?: number | null;
  extra?: Record<string, unknown>;
}): Promise<void> {
  await recordAuthSecurityEvent({
    eventType: params.eventType,
    principalType: PrincipalType.VENDOR,
    principalId: params.vendorId ?? null,
    actorUserId: params.authUserId ?? null,
    purpose: PURPOSE,
    correlationId: params.correlationId,
    destinationHash: params.destinationHash ?? null,
    metadata: {
      transport: AUDIT_TRANSPORT,
      failure_classification: params.classification,
      challenge_id: params.challengeId ?? null,
      attempt_count: params.attemptCount ?? null,
      ...(params.extra ?? {}),
    },
  });
}

// ============================================================================
// STEP 1 — REQUEST (public, non-enumerating)
// ============================================================================
export interface RequestVendorPasswordResetInput {
  /** A normalized email, or an EXPLICITLY international phone. Never a bare local number. */
  readonly identifier: string;
  readonly correlationId?: string | null;
}

/**
 * Start a vendor password reset.
 *
 * The response is IDENTICAL for an unknown identifier, an unknown/inactive vendor
 * mapping, a missing Auth user, an unverified WhatsApp phone, a disabled WhatsApp
 * OTP capability, a rate-limited identity, a closed automation gate, a provider
 * refusal, and a fully successful dispatch. `reference` is the real challenge id
 * when one was issued and an unpersisted uuid otherwise, so both shapes are
 * indistinguishable and verifying against a non-existent reference fails exactly
 * like a wrong OTP.
 *
 * Nothing about the outcome is ever returned; only sanitized classifications are
 * audited server-side.
 */
export async function requestVendorPasswordReset(
  input: RequestVendorPasswordResetInput
): Promise<VendorPasswordResetRequestResponse> {
  const correlationId = input?.correlationId ?? null;
  // The decoy reference. Generated up front so no code path can forget it.
  const decoy = crypto.randomUUID();

  try {
    const normalized = normalizeVendorLoginIdentifier(input?.identifier);
    if (!normalized.ok) {
      await auditResetFailure({
        eventType: AuthSecurityEventType.VENDOR_PASSWORD_RESET_FAILED,
        classification: VendorPasswordResetFailureClassification.INVALID_IDENTIFIER,
        correlationId,
      });
      return vendorPasswordResetRequestReceived(decoy);
    }
    const identifier = normalized.identifier;

    // Server-side identity resolution. Ambiguity fails closed — never pick a winner.
    const lookup = await resolveResetIdentity(identifier.kind, identifier.canonical);
    if (!lookup.ok) {
      await auditResetFailure({
        eventType: AuthSecurityEventType.VENDOR_PASSWORD_RESET_FAILED,
        classification: lookup.classification,
        correlationId,
      });
      return vendorPasswordResetRequestReceived(decoy);
    }
    const row = lookup.row;

    // The destination is the STORED, previously verified number. A caller supplies
    // an identifier, never a destination.
    const phoneE164 = row.phone_e164 as string;
    const destinationHash = destinationHashFor(phoneE164);
    const vendorId = row.vendor_id as string;
    const authUserId = row.user_id as string;
    const vendorDashboardUserId = row.id as string;

    const gate = await evaluateVendorAuthAutomationGate(BINDING);
    if (!gate.ok) {
      await auditResetFailure({
        eventType: AuthSecurityEventType.VENDOR_PASSWORD_RESET_FAILED,
        classification: VendorPasswordResetFailureClassification.SERVICE_UNAVAILABLE,
        destinationHash,
        correlationId,
        vendorId,
        authUserId,
      });
      return vendorPasswordResetRequestReceived(decoy);
    }

    const peppers = loadVendorOtpPeppers();
    const pepper = primaryVendorOtpPepper(peppers);
    if (!pepper) {
      await auditResetFailure({
        eventType: AuthSecurityEventType.VENDOR_PASSWORD_RESET_FAILED,
        classification: VendorPasswordResetFailureClassification.PEPPER_NOT_CONFIGURED,
        destinationHash,
        correlationId,
        vendorId,
        authUserId,
      });
      return vendorPasswordResetRequestReceived(decoy);
    }

    // ATOMIC issuance: serialized per identity, with the rate-limit evaluation,
    // prior-pending cancel, and insert all inside one locked transaction. Every
    // refusal (rate-limited or otherwise) returns the SAME non-enumerating response.
    const challengeId = newChallengeId();
    const otp = generateVendorOtp();
    const otpHash = hashVendorOtp(
      { challengeId, purpose: PURPOSE, vendorDashboardUserId, destinationHash },
      otp,
      pepper
    );

    // Expiry, attempt limit, cooldown, and rate limits are all owned by the database
    // function — no policy value is passed from here.
    const issued = await issueChallengeAtomic({
      challengeId,
      purpose: PURPOSE,
      vendorDashboardUserId,
      authUserId,
      vendorId,
      destinationHash,
      otpHash,
    });
    if (!issued.ok) {
      const rateLimited = issued.reason === "rate_limited";
      await auditResetFailure({
        eventType: rateLimited
          ? AuthSecurityEventType.AUTH_RATE_LIMIT_TRIGGERED
          : AuthSecurityEventType.VENDOR_PASSWORD_RESET_FAILED,
        classification: rateLimited
          ? VendorPasswordResetFailureClassification.RATE_LIMITED
          : VendorPasswordResetFailureClassification.CHALLENGE_ISSUE_FAILED,
        destinationHash,
        correlationId,
        vendorId,
        authUserId,
        challengeId,
        extra: rateLimited ? { rate_limit_scope: issued.scope ?? null } : undefined,
      });
      return vendorPasswordResetRequestReceived(decoy);
    }

    const intent: CommunicationIntent = {
      type: BINDING.messageType,
      lane: "authentication",
      channel: "whatsapp",
      recipient_type: "vendor",
      recipient_id: vendorId,
      // The stored verified phone — never one the requester supplied.
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
      metadata: { purpose: PURPOSE, transport_origin: "vendor_password_reset" },
    };

    // Dispatch through the RUNTIME-selected provider (mock or Meta). An unresolvable
    // provider fails closed here: nothing is sent and the challenge is cancelled.
    const runtime = createRuntimeCommunicationService();
    const sent = runtime.ok ? await runtime.data.send(intent) : runtime;
    const delivered =
      sent.ok &&
      (sent.data.status === "accepted" ||
        sent.data.status === "sent" ||
        sent.data.status === "delivered" ||
        sent.data.status === "read");

    if (!delivered) {
      await cancelChallenge(challengeId);
      await auditResetFailure({
        eventType: AuthSecurityEventType.VENDOR_PASSWORD_RESET_FAILED,
        classification: VendorPasswordResetFailureClassification.DISPATCH_FAILED,
        destinationHash,
        correlationId,
        vendorId,
        authUserId,
        challengeId,
      });
      // Still the same outward response: a provider refusal must not be observable.
      return vendorPasswordResetRequestReceived(decoy);
    }

    // Fail closed if the challenge→ledger link cannot be written (or matches zero
    // rows because the challenge was concurrently terminalized): cancel it, never
    // resend, and still return the identical non-enumerating public response.
    const linked = await recordChallengeDelivery(
      challengeId,
      sent.data.id,
      sent.data.provider,
      sent.data.channel
    );
    if (!linked) {
      await cancelChallenge(challengeId);
      await auditResetFailure({
        eventType: AuthSecurityEventType.VENDOR_PASSWORD_RESET_FAILED,
        classification: VendorPasswordResetFailureClassification.LINKAGE_FAILED,
        destinationHash,
        correlationId,
        vendorId,
        authUserId,
        challengeId,
      });
      return vendorPasswordResetRequestReceived(decoy);
    }

    await recordAuthSecurityEvent({
      eventType: AuthSecurityEventType.VENDOR_PASSWORD_RESET_REQUESTED,
      principalType: PrincipalType.VENDOR,
      principalId: vendorId,
      actorUserId: authUserId,
      purpose: PURPOSE,
      correlationId,
      destinationHash,
      metadata: {
        transport: AUDIT_TRANSPORT,
        challenge_id: challengeId,
        provider: sent.data.provider,
        vendor_dashboard_role: row.role ?? null,
      },
    });

    return vendorPasswordResetRequestReceived(challengeId);
  } catch {
    // An internal failure must not be distinguishable from an unknown account.
    return vendorPasswordResetRequestReceived(decoy);
  }
}

type ResetIdentityLookup =
  | { readonly ok: true; readonly row: ResetIdentityRow }
  | { readonly ok: false; readonly classification: VendorPasswordResetFailureClassificationValue };

/**
 * Resolve the vendor dashboard identity eligible for a WhatsApp password reset.
 *
 * Email is matched on its canonical (trimmed, lowercased) form. Phone is matched
 * ONLY on `phone_e164` — the legacy, non-canonical `phone` column is never used as
 * an authentication identity. More than one match is an ambiguity and fails closed.
 */
async function resolveResetIdentity(
  kind: "email" | "phone",
  canonical: string
): Promise<ResetIdentityLookup> {
  let rows: ResetIdentityRow[];
  try {
    const column = kind === "email" ? "email" : "phone_e164";
    const { data, error } = await adminClient()
      .from(VENDOR_DASHBOARD_USERS_TABLE)
      .select(RESET_LOOKUP_COLUMNS)
      .eq(column, canonical)
      .limit(2);
    if (error) throw error;
    rows = (data ?? []) as ResetIdentityRow[];
  } catch {
    return { ok: false, classification: VendorPasswordResetFailureClassification.LOOKUP_FAILED };
  }

  if (rows.length === 0) {
    return { ok: false, classification: VendorPasswordResetFailureClassification.NO_VENDOR_MAPPING };
  }
  if (rows.length > 1) {
    // Two identities claim one identifier. Never pick a winner.
    return { ok: false, classification: VendorPasswordResetFailureClassification.AMBIGUOUS_IDENTITY };
  }

  const row = rows[0];
  if (!row.id || !row.vendor_id) {
    return { ok: false, classification: VendorPasswordResetFailureClassification.NO_VENDOR_MAPPING };
  }
  // Defence in depth: re-check the matched column in code (a lenient/ILIKE query
  // layer must never widen the match).
  if (kind === "email" && (row.email ?? "").trim().toLowerCase() !== canonical) {
    return { ok: false, classification: VendorPasswordResetFailureClassification.NO_VENDOR_MAPPING };
  }
  if (kind === "phone" && row.phone_e164 !== canonical) {
    return { ok: false, classification: VendorPasswordResetFailureClassification.NO_VENDOR_MAPPING };
  }
  if (!isActiveVendorMembership(row.status)) {
    return { ok: false, classification: VendorPasswordResetFailureClassification.MEMBERSHIP_NOT_ACTIVE };
  }
  if (!row.user_id) {
    return { ok: false, classification: VendorPasswordResetFailureClassification.NO_AUTH_USER };
  }
  // A reset OTP may only travel to a phone the vendor already PROVED they hold.
  if (!row.phone_e164 || row.phone_verified !== true || !row.whatsapp_verified_at) {
    return { ok: false, classification: VendorPasswordResetFailureClassification.WHATSAPP_NOT_VERIFIED };
  }
  if (row.whatsapp_otp_enabled !== true) {
    return { ok: false, classification: VendorPasswordResetFailureClassification.WHATSAPP_OTP_DISABLED };
  }
  return { ok: true, row };
}

// ============================================================================
// STEP 2 — VERIFY OTP → issue exactly one single-use reset grant
// ============================================================================
export interface VerifyVendorPasswordResetOtpInput {
  readonly challengeId: string;
  readonly otp: string;
  readonly correlationId?: string | null;
}

/**
 * Verify the reset OTP and mint a grant. This establishes NO Supabase session:
 * OTP verification authorizes a reset, it is not a vendor login.
 *
 * NON-ENUMERATION (Fix 2): EVERY failure path returns the SAME `resetFailure()` —
 * one code, one message, one body shape. A malformed/synthetic/unknown reference,
 * a wrong/expired/locked/cancelled/consumed challenge, a wrong purpose, malformed
 * lineage, an inactive membership, a missing Auth user, a destination mismatch, a
 * missing/stale/wrong-provider attestation, a DB lookup failure, and a grant
 * issuance loss are all publicly indistinguishable. They differ ONLY in the
 * sanitized audit classification recorded server-side — never in the response.
 * Nothing about account/challenge existence, lifecycle status, remaining attempts,
 * phone verification, WhatsApp enablement, or delivery success is ever revealed.
 *
 * The one distinguishable outcome is SUCCESS, which returns the plaintext grant
 * token exactly once. No artificial delay is added on any path.
 */
export async function verifyVendorPasswordResetOtp(
  input: VerifyVendorPasswordResetOtpInput
): Promise<Result<VendorPasswordResetGrantIssued>> {
  const correlationId = input?.correlationId ?? null;
  try {
    if (!isUuidShaped(input?.challengeId) || !isPlausibleVendorOtp(input?.otp)) {
      await auditResetFailure({
        eventType: AuthSecurityEventType.VENDOR_PASSWORD_RESET_OTP_FAILED,
        classification: VendorPasswordResetFailureClassification.CHALLENGE_NOT_FOUND,
        correlationId,
      });
      return resetFailure();
    }

    const challenge = await loadChallenge(input.challengeId.trim());
    if (!challenge) {
      // Includes the decoy reference returned for every ineligible request.
      await auditResetFailure({
        eventType: AuthSecurityEventType.VENDOR_PASSWORD_RESET_OTP_FAILED,
        classification: VendorPasswordResetFailureClassification.CHALLENGE_NOT_FOUND,
        correlationId,
      });
      return resetFailure();
    }

    // Purpose isolation: a vendor_whatsapp_verify challenge can never reset a password.
    if (!challengePurposeMatches(challenge.purpose, PURPOSE)) {
      await auditResetFailure({
        eventType: AuthSecurityEventType.VENDOR_PASSWORD_RESET_OTP_FAILED,
        classification: VendorPasswordResetFailureClassification.PURPOSE_MISMATCH,
        correlationId,
        challengeId: challenge.id,
      });
      return resetFailure();
    }
    if (challenge.status !== VerificationChallengeStatus.PENDING) {
      await auditResetFailure({
        eventType: AuthSecurityEventType.VENDOR_PASSWORD_RESET_OTP_FAILED,
        classification: VendorPasswordResetFailureClassification.CHALLENGE_NOT_PENDING,
        correlationId,
        challengeId: challenge.id,
      });
      return resetFailure();
    }
    if (isChallengeExpired(challenge.expires_at)) {
      await expirePendingChallenge(challenge.id);
      await auditResetFailure({
        eventType: AuthSecurityEventType.AUTH_CHALLENGE_EXPIRED,
        classification: VendorPasswordResetFailureClassification.CHALLENGE_EXPIRED,
        correlationId,
        challengeId: challenge.id,
      });
      return resetFailure();
    }

    // The linked dashboard identity must still exist, be active, and hold an Auth user.
    const identity = await loadLinkedIdentity(challenge.vendor_dashboard_user_id);
    if (
      !identity ||
      !isActiveVendorMembership(identity.status) ||
      !identity.user_id ||
      identity.user_id !== challenge.user_id ||
      identity.vendor_id !== challenge.vendor_id
    ) {
      await auditResetFailure({
        eventType: AuthSecurityEventType.VENDOR_PASSWORD_RESET_OTP_FAILED,
        classification: VendorPasswordResetFailureClassification.MEMBERSHIP_NOT_ACTIVE,
        correlationId,
        challengeId: challenge.id,
      });
      return resetFailure();
    }

    const gate = await evaluateVendorAuthAutomationGate(BINDING);
    if (!gate.ok) {
      await auditResetFailure({
        eventType: AuthSecurityEventType.VENDOR_PASSWORD_RESET_OTP_FAILED,
        classification: VendorPasswordResetFailureClassification.SERVICE_UNAVAILABLE,
        correlationId,
        challengeId: challenge.id,
      });
      return resetFailure();
    }

    const peppers = loadVendorOtpPeppers();
    if (peppers.length === 0) {
      await auditResetFailure({
        eventType: AuthSecurityEventType.VENDOR_PASSWORD_RESET_OTP_FAILED,
        classification: VendorPasswordResetFailureClassification.PEPPER_NOT_CONFIGURED,
        correlationId,
        challengeId: challenge.id,
      });
      return resetFailure();
    }

    const otpValid = verifyVendorOtp(
      {
        challengeId: challenge.id,
        purpose: PURPOSE,
        vendorDashboardUserId: challenge.vendor_dashboard_user_id as string,
        destinationHash: challenge.destination_hash as string,
      },
      input.otp.trim(),
      challenge.otp_hash as string,
      peppers
    );

    if (!otpValid) {
      const attempt = await registerFailedAttempt(challenge.id, PURPOSE);
      await auditResetFailure({
        eventType: AuthSecurityEventType.VENDOR_PASSWORD_RESET_OTP_FAILED,
        classification: VendorPasswordResetFailureClassification.OTP_REJECTED,
        destinationHash: challenge.destination_hash,
        correlationId,
        vendorId: challenge.vendor_id,
        authUserId: challenge.user_id,
        challengeId: challenge.id,
        attemptCount: attempt.attemptCount,
        extra: { challenge_locked: attempt.locked },
      });
      return resetFailure();
    }

    const attested = await hasFreshChallengeAttestation({
      challengeId: challenge.id,
      destinationHash: challenge.destination_hash as string,
      messageType: BINDING.messageType,
      expectedChannel: BINDING.channel,
      expectedProvider: gate.providerRequired,
    });
    if (
      !attested ||
      challenge.delivery_channel !== BINDING.channel ||
      challenge.delivery_provider !== gate.providerRequired
    ) {
      await auditResetFailure({
        eventType: AuthSecurityEventType.VENDOR_PASSWORD_RESET_OTP_FAILED,
        classification: VendorPasswordResetFailureClassification.ATTESTATION_MISSING,
        destinationHash: challenge.destination_hash,
        correlationId,
        challengeId: challenge.id,
      });
      return resetFailure();
    }

    // High-entropy token in request memory. Only its SHA-256 reaches the database.
    const grantToken = generateResetGrantToken();
    const grantTokenHash = hashResetGrantToken(grantToken);

    // ATOMIC: CAS the challenge to consumed, revoke older open grants, insert one.
    // The grant TTL is DATABASE-OWNED — no expiry is passed from here; the function
    // returns the authoritative expires_at.
    const issued = await consumeResetChallengeAndIssueGrant({
      challengeId: challenge.id,
      vendorDashboardUserId: challenge.vendor_dashboard_user_id as string,
      authUserId: challenge.user_id as string,
      vendorId: challenge.vendor_id as string,
      grantTokenHash,
    });
    if (!issued.ok) {
      await auditResetFailure({
        eventType: AuthSecurityEventType.VENDOR_PASSWORD_RESET_OTP_FAILED,
        classification: VendorPasswordResetFailureClassification.GRANT_ISSUE_FAILED,
        correlationId,
        challengeId: challenge.id,
      });
      return resetFailure();
    }

    // The token is returned ONCE. It is never logged, audited, or persisted plain.
    return ok({ grantToken, expiresAt: issued.data.expiresAt });
  } catch {
    return resetFailure();
  }
}

async function loadLinkedIdentity(
  vendorDashboardUserId: string | null
): Promise<ResetIdentityRow | null> {
  if (!vendorDashboardUserId) return null;
  const { data, error } = await adminClient()
    .from(VENDOR_DASHBOARD_USERS_TABLE)
    .select(RESET_LOOKUP_COLUMNS)
    .eq("id", vendorDashboardUserId)
    .maybeSingle();
  if (error) throw error;
  return (data as ResetIdentityRow | null) ?? null;
}

// ============================================================================
// STEP 3 — COMPLETE (claim the grant, then Supabase Auth sets the password)
// ============================================================================
export interface CompleteVendorPasswordResetInput {
  /** Single-use, high-entropy. Never logged, audited, or persisted in plaintext. */
  readonly grantToken: string;
  /** Never logged, audited, persisted, hashed by us, or echoed. */
  readonly newPassword: string;
  readonly correlationId?: string | null;
}

/**
 * Complete the reset.
 *
 * The grant is BURNED on claim, before the password mutation is attempted. If
 * Supabase Auth then rejects the update, the grant stays consumed and the vendor
 * must start the reset again. That is deliberate: leaving a reusable grant after an
 * UNCERTAIN password mutation is the more dangerous failure.
 *
 * On success no session is created and no cookie is written — the vendor must log
 * in normally through the Phase 5C password login.
 */
export async function completeVendorPasswordReset(
  input: CompleteVendorPasswordResetInput
): Promise<Result<VendorPasswordResetCompleted>> {
  const correlationId = input?.correlationId ?? null;
  try {
    // Shape checks only. Neither value is ever logged or recorded.
    if (!isPlausibleResetGrantToken(input?.grantToken)) {
      await auditResetFailure({
        eventType: AuthSecurityEventType.VENDOR_PASSWORD_RESET_FAILED,
        classification: VendorPasswordResetFailureClassification.INVALID_GRANT_TOKEN_SHAPE,
        correlationId,
      });
      return resetFailure();
    }
    if (!checkVendorPasswordPolicy(input?.newPassword).ok) {
      await auditResetFailure({
        eventType: AuthSecurityEventType.VENDOR_PASSWORD_RESET_FAILED,
        // The failure reason (too short / too long / blank) is deliberately NOT
        // recorded: it would describe the rejected password.
        classification: VendorPasswordResetFailureClassification.INVALID_PASSWORD_SHAPE,
        correlationId,
      });
      return resetFailure();
    }

    // ATOMIC claim. Exactly one concurrent completion can win.
    const grantTokenHash = hashResetGrantToken(input.grantToken);
    const claimed = await claimResetGrant(grantTokenHash);
    if (!claimed) {
      // Not found / already consumed / revoked / expired — all indistinguishable.
      await auditResetFailure({
        eventType: AuthSecurityEventType.VENDOR_PASSWORD_RESET_FAILED,
        classification: VendorPasswordResetFailureClassification.GRANT_NOT_CLAIMABLE,
        correlationId,
      });
      return resetFailure();
    }

    // Supabase Auth is the ONLY password authority. Service-role, server-only.
    const { error } = await adminClient().auth.admin.updateUserById(claimed.authUserId, {
      password: input.newPassword,
    });

    if (error) {
      // The grant remains CONSUMED (burned). The raw Auth error is never persisted.
      await auditResetFailure({
        eventType: AuthSecurityEventType.VENDOR_PASSWORD_RESET_FAILED,
        classification: VendorPasswordResetFailureClassification.AUTH_UPDATE_REJECTED,
        correlationId,
        vendorId: claimed.vendorId,
        authUserId: claimed.authUserId,
        challengeId: claimed.challengeId,
        extra: { grant_burned: true },
      });
      return resetFailure();
    }

    const audit = await recordAuthSecurityEvent({
      eventType: AuthSecurityEventType.VENDOR_PASSWORD_RESET_COMPLETED,
      principalType: PrincipalType.VENDOR,
      principalId: claimed.vendorId,
      actorUserId: claimed.authUserId,
      purpose: PURPOSE,
      correlationId,
      metadata: {
        transport: AUDIT_TRANSPORT,
        challenge_id: claimed.challengeId,
        login_required: true,
      },
    });

    // No session, no cookie, no auto sign-in. A fresh vendor login is required.
    return ok({
      vendorId: claimed.vendorId,
      vendorDashboardUserId: claimed.vendorDashboardUserId,
      loginRequired: true,
      auditRecorded: audit.ok,
    });
  } catch {
    return resetFailure();
  }
}
