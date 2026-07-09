// ============================================================================
// QuickFurno — services/vendorAuthChallengeService.ts   (server-only)
//
// The shared persistence + concurrency layer for BOTH vendor auth challenge
// purposes. Everything security-critical that either flow needs lives here exactly
// once: challenge issuance, the provider-bound delivery attestation, the persisted
// rate limits, expiry handling, and the four ATOMIC database functions.
//
// CONCURRENCY RULE
//   No security-critical counter or claim is ever read-then-written in application
//   code. `registerFailedAttempt`, `consumeWhatsappChallenge`,
//   `consumeResetChallengeAndIssueGrant` and `claimResetGrant` are thin wrappers
//   over single-statement SQL functions, so PostgreSQL's row locking — not this
//   process — serializes concurrent callers.
//
// NEVER PERSISTED, RETURNED, OR LOGGED: the plaintext OTP, the OTP pepper, the
// plaintext reset grant token, a password, or a raw provider/Auth error.
// ============================================================================

import crypto from "crypto";
import { adminClient } from "../lib/supabase";
import { ok, fail, type Result } from "../lib/errors";
import { hashPhoneE164 } from "../lib/communication/phone";
import { isUniqueViolationError } from "../lib/communication/dbErrors";
import {
  VerificationChallengeStatus,
  type VerificationPurposeValue,
} from "../lib/identity/verification";
import {
  VENDOR_CHALLENGE_ENTITY_TYPE,
  VENDOR_ATTESTATION_SUCCESS_STATUSES,
  isChallengeExpired,
  isVendorAttestationFresh,
  isVendorAttestationSuccessStatus,
} from "../lib/identity/vendorVerification";
import { VENDOR_AUTH_LANE } from "../lib/identity/vendorAuthAutomation";

export const VERIFICATION_CHALLENGES_TABLE = "verification_challenges";
export const COMMUNICATION_MESSAGES_TABLE = "communication_messages";

/** The columns the challenge flows read. `otp_hash` is read ONLY to verify it. */
const CHALLENGE_COLUMNS =
  "id, principal_type, principal_id, purpose, destination_hash, otp_hash, status, expires_at, " +
  "attempt_count, max_attempts, vendor_dashboard_user_id, user_id, vendor_id, " +
  "delivery_channel, delivery_provider, communication_message_id, created_at";

export interface VendorChallengeRow {
  id: string;
  principal_type: string | null;
  principal_id: string | null;
  purpose: string | null;
  destination_hash: string | null;
  otp_hash: string | null;
  status: string | null;
  expires_at: string;
  attempt_count: number;
  max_attempts: number;
  vendor_dashboard_user_id: string | null;
  user_id: string | null;
  vendor_id: string | null;
  delivery_channel: string | null;
  delivery_provider: string | null;
  communication_message_id: string | null;
  created_at: string;
}

// ----------------------------------------------------------------------------
// Atomic challenge issuance (Fix 1) — one database authority, serialized per identity
// ----------------------------------------------------------------------------
export interface IssueChallengeInput {
  readonly challengeId: string;
  readonly purpose: VerificationPurposeValue;
  readonly vendorDashboardUserId: string;
  readonly authUserId: string;
  readonly vendorId: string;
  readonly destinationHash: string;
  readonly otpHash: string;
  // NOTE: there is deliberately NO expiresAt / maxAttempts / cooldown / rate-limit
  // input. The database function vendor_auth_issue_challenge owns the entire
  // security policy (TTL, attempt limit, cooldown, hourly/daily ceilings); the
  // application cannot weaken it. See lib/identity/vendorVerification.ts for the
  // MATCHING advisory constants used only for UI/docs/messaging.
}

export type IssueChallengeReason =
  | "rate_limited"
  | "lineage_mismatch"
  | "membership_not_active"
  | "purpose_invalid"
  | "issue_failed";

export type IssueChallengeOutcome =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: IssueChallengeReason; readonly scope?: string | null };

/**
 * Issue a new pending challenge THROUGH the atomic `vendor_auth_issue_challenge`
 * function. The whole rate-limit → cancel-prior → insert sequence runs inside one
 * transaction that first takes a per-identity `FOR UPDATE` lock, so this is the ONE
 * place issuance happens and there is no racy application-level path. It never
 * returns or logs the OTP; only its HASH is passed in and persisted.
 *
 * SECURITY POLICY AUTHORITY: this wrapper passes ONLY the challenge/identity fields.
 * It passes NO TTL, attempt limit, cooldown, or rate-limit value — the database
 * function owns all of those internally, so the application can never weaken them.
 */
export async function issueChallengeAtomic(input: IssueChallengeInput): Promise<IssueChallengeOutcome> {
  try {
    const { data, error } = await adminClient().rpc("vendor_auth_issue_challenge", {
      p_challenge_id: input.challengeId,
      p_vendor_dashboard_user_id: input.vendorDashboardUserId,
      p_user_id: input.authUserId,
      p_vendor_id: input.vendorId,
      p_purpose: input.purpose,
      p_destination_hash: input.destinationHash,
      p_otp_hash: input.otpHash,
    });
    if (error) return { ok: false, reason: "issue_failed" };

    const row = ((data ?? []) as Array<{
      result_code: string;
      rate_limit_scope: string | null;
      issued_challenge_id: string | null;
    }>)[0];
    if (!row) return { ok: false, reason: "issue_failed" };

    switch (row.result_code) {
      case "issued":
        // Defence in depth: the row the function claims to have issued must be ours.
        return row.issued_challenge_id === input.challengeId
          ? { ok: true }
          : { ok: false, reason: "issue_failed" };
      case "rate_limited":
        return { ok: false, reason: "rate_limited", scope: row.rate_limit_scope };
      case "lineage_mismatch":
        return { ok: false, reason: "lineage_mismatch" };
      case "membership_not_active":
        return { ok: false, reason: "membership_not_active" };
      case "purpose_invalid":
        return { ok: false, reason: "purpose_invalid" };
      default:
        return { ok: false, reason: "issue_failed" };
    }
  } catch {
    return { ok: false, reason: "issue_failed" };
  }
}

/**
 * Record which ledger row and which provider actually carried this challenge, and
 * report whether the link was written (Fix 3).
 *
 * The update is compare-and-set on `status = 'pending'`, so it can only ever link a
 * still-live challenge — it never revives a challenge that was concurrently
 * terminalized. Returns `true` ONLY when exactly one pending row was linked; a DB
 * error or a zero-row result returns `false`, and the caller then fails CLOSED
 * (cancels the challenge) rather than leaving an unlinked-but-verifiable challenge.
 */
export async function recordChallengeDelivery(
  challengeId: string,
  communicationMessageId: string,
  deliveryProvider: string,
  deliveryChannel: string
): Promise<boolean> {
  try {
    const { data, error } = await adminClient()
      .from(VERIFICATION_CHALLENGES_TABLE)
      .update({
        communication_message_id: communicationMessageId,
        delivery_channel: deliveryChannel,
        delivery_provider: deliveryProvider,
        last_sent_at: new Date().toISOString(),
      })
      .eq("id", challengeId)
      .eq("status", VerificationChallengeStatus.PENDING)
      .select("id");
    if (error) return false;
    return ((data ?? []) as unknown[]).length === 1;
  } catch {
    return false;
  }
}

/**
 * Delivery failed: the challenge can never be satisfied, so cancel it rather than
 * leave a live OTP standing that no one received.
 */
export async function cancelChallenge(challengeId: string): Promise<void> {
  try {
    await adminClient()
      .from(VERIFICATION_CHALLENGES_TABLE)
      .update({ status: VerificationChallengeStatus.CANCELLED })
      .eq("id", challengeId)
      .eq("status", VerificationChallengeStatus.PENDING);
  } catch {
    /* best effort: the challenge still cannot verify without an attestation */
  }
}

// ----------------------------------------------------------------------------
// Challenge loading + expiry
// ----------------------------------------------------------------------------
export async function loadChallenge(challengeId: string): Promise<VendorChallengeRow | null> {
  const { data, error } = await adminClient()
    .from(VERIFICATION_CHALLENGES_TABLE)
    .select(CHALLENGE_COLUMNS)
    .eq("id", challengeId)
    .maybeSingle();
  if (error) throw error;
  return (data as VendorChallengeRow | null) ?? null;
}

/**
 * Transition an expired PENDING challenge to `expired`. Authentication safety never
 * depends on this running: every read/verify/consume path independently checks
 * `expires_at`, and the atomic SQL functions carry `expires_at > now()` in their
 * WHERE clauses. This only keeps the ledger honest — and never revives anything.
 */
export async function expirePendingChallenge(challengeId: string): Promise<void> {
  try {
    await adminClient()
      .from(VERIFICATION_CHALLENGES_TABLE)
      .update({ status: VerificationChallengeStatus.EXPIRED })
      .eq("id", challengeId)
      .eq("status", VerificationChallengeStatus.PENDING);
  } catch {
    /* best effort */
  }
}

/** True when the row is pending AND still within its lifetime. */
export function isChallengeUsable(row: VendorChallengeRow, nowMs: number = Date.now()): boolean {
  if (row.status !== VerificationChallengeStatus.PENDING) return false;
  return !isChallengeExpired(row.expires_at, nowMs);
}

// ----------------------------------------------------------------------------
// Provider-bound communication delivery attestation
// ----------------------------------------------------------------------------
export interface AttestationRequirement {
  readonly challengeId: string;
  readonly destinationHash: string;
  readonly messageType: string;
  /** The CHANNEL the gate authorized — and the one that must have carried the OTP. */
  readonly expectedChannel: string;
  /** The provider the operational gate authorized — and the one that carried it. */
  readonly expectedProvider: string;
}

/**
 * Confirm that QuickFurno's AUTHORIZED transport actually carried this challenge's
 * OTP, on the expected CHANNEL and PROVIDER.
 *
 * The verified OTP proves the vendor possesses the code; this ledger match proves
 * our own channel+provider delivered it. Both are required, so a code obtained by
 * any other route (a leaked hash, a replayed message, a different provider, or a
 * different channel) cannot verify.
 *
 * `channel` and `provider` are BOTH filtered in the query and re-validated in code:
 * a lenient query layer must never turn a wrong-channel/wrong-provider row into an
 * attestation. Phase 5E authorizes only `whatsapp`; there is no SMS attestation.
 */
export async function hasFreshChallengeAttestation(
  requirement: AttestationRequirement
): Promise<boolean> {
  const { challengeId, destinationHash, messageType, expectedChannel, expectedProvider } = requirement;
  if (typeof expectedProvider !== "string" || expectedProvider.trim() === "") return false;
  if (typeof expectedChannel !== "string" || expectedChannel.trim() === "") return false;

  const { data, error } = await adminClient()
    .from(COMMUNICATION_MESSAGES_TABLE)
    .select("id, status, created_at, entity_id, entity_type, destination_hash, provider, channel, lane, message_type")
    .eq("message_type", messageType)
    .eq("lane", VENDOR_AUTH_LANE)
    .eq("channel", expectedChannel)
    .eq("entity_type", VENDOR_CHALLENGE_ENTITY_TYPE)
    .eq("entity_id", challengeId)
    .eq("destination_hash", destinationHash)
    .eq("provider", expectedProvider)
    .in("status", VENDOR_ATTESTATION_SUCCESS_STATUSES as string[])
    .order("created_at", { ascending: false })
    .limit(1);

  if (error) throw error;
  const rows = (data ?? []) as Array<{
    status: string;
    created_at: string;
    entity_id: string;
    entity_type: string;
    destination_hash: string;
    provider: string | null;
    channel: string | null;
    lane: string;
    message_type: string;
  }>;
  const row = rows[0];
  if (!row) return false;

  // Defence in depth — never trust a lenient query layer. Re-check every field.
  if (row.entity_id !== challengeId) return false;
  if (row.entity_type !== VENDOR_CHALLENGE_ENTITY_TYPE) return false;
  if (row.message_type !== messageType) return false;
  if (row.lane !== VENDOR_AUTH_LANE) return false;
  if (row.channel !== expectedChannel) return false;
  if (row.destination_hash !== destinationHash) return false;
  if (row.provider !== expectedProvider) return false;
  if (!isVendorAttestationSuccessStatus(row.status)) return false;
  if (!isVendorAttestationFresh(row.created_at)) return false;
  return true;
}

// ----------------------------------------------------------------------------
// ATOMIC DATABASE FUNCTIONS (never read-then-write in application code)
// ----------------------------------------------------------------------------
export interface FailedAttemptOutcome {
  readonly counted: boolean;
  readonly status: string | null;
  readonly attemptCount: number | null;
  readonly maxAttempts: number | null;
  readonly locked: boolean;
}

/**
 * Atomically increment the wrong-OTP counter and lock the challenge at
 * `max_attempts`. A single conditional UPDATE inside the SQL function: two racing
 * wrong guesses increment 0→1→2, a count can never be lost, and a terminal
 * challenge is never revived or decremented.
 *
 * `counted: false` means the challenge was not pending/fresh/of this purpose.
 */
export async function registerFailedAttempt(
  challengeId: string,
  purpose: VerificationPurposeValue
): Promise<FailedAttemptOutcome> {
  try {
    const { data, error } = await adminClient().rpc("vendor_auth_register_failed_attempt", {
      p_challenge_id: challengeId,
      p_purpose: purpose,
    });
    if (error) throw error;
    const rows = (data ?? []) as Array<{
      status: string;
      attempt_count: number;
      max_attempts: number;
      locked: boolean;
    }>;
    const row = rows[0];
    if (!row) return { counted: false, status: null, attemptCount: null, maxAttempts: null, locked: false };
    return {
      counted: true,
      status: row.status,
      attemptCount: row.attempt_count,
      maxAttempts: row.max_attempts,
      locked: row.locked === true,
    };
  } catch {
    // Never claim an attempt was counted when it may not have been.
    return { counted: false, status: null, attemptCount: null, maxAttempts: null, locked: false };
  }
}

export interface ConsumeWhatsappOutcome {
  readonly ok: boolean;
  readonly phoneConflict: boolean;
  readonly identity: {
    readonly vendorDashboardUserId: string;
    readonly vendorId: string;
    readonly authUserId: string;
    readonly phoneE164: string;
    readonly whatsappVerifiedAt: string;
  } | null;
}

/**
 * Atomically consume the WhatsApp verification challenge and bind the verified
 * phone identity. The challenge is compare-and-swapped to `consumed` FIRST; the
 * verified flags are never written before that swap succeeds.
 *
 * A phone already verified by another dashboard identity raises 23505 inside the
 * function, which aborts the whole transaction: nothing is bound and the challenge
 * is NOT consumed. Ownership is never stolen.
 */
export async function consumeWhatsappChallenge(params: {
  challengeId: string;
  vendorDashboardUserId: string;
  authUserId: string;
  vendorId: string;
  phoneE164: string;
  destinationHash: string;
}): Promise<ConsumeWhatsappOutcome> {
  try {
    const { data, error } = await adminClient().rpc("vendor_auth_consume_whatsapp_challenge", {
      p_challenge_id: params.challengeId,
      p_vendor_dashboard_user_id: params.vendorDashboardUserId,
      p_user_id: params.authUserId,
      p_vendor_id: params.vendorId,
      p_phone_e164: params.phoneE164,
      p_destination_hash: params.destinationHash,
    });
    if (error) {
      if (isUniqueViolationError(error) || /VENDOR_AUTH_PHONE_CONFLICT/.test(String((error as { message?: string }).message ?? ""))) {
        return { ok: false, phoneConflict: true, identity: null };
      }
      throw error;
    }
    const rows = (data ?? []) as Array<{
      vendor_dashboard_user_id: string;
      vendor_id: string;
      user_id: string;
      phone_e164: string;
      whatsapp_verified_at: string;
    }>;
    const row = rows[0];
    if (!row) return { ok: false, phoneConflict: false, identity: null };

    // Defence in depth: the returned identity must be exactly the one we asked for.
    if (
      row.vendor_dashboard_user_id !== params.vendorDashboardUserId ||
      row.vendor_id !== params.vendorId ||
      row.user_id !== params.authUserId ||
      row.phone_e164 !== params.phoneE164 ||
      !row.whatsapp_verified_at
    ) {
      return { ok: false, phoneConflict: false, identity: null };
    }

    return {
      ok: true,
      phoneConflict: false,
      identity: {
        vendorDashboardUserId: row.vendor_dashboard_user_id,
        vendorId: row.vendor_id,
        authUserId: row.user_id,
        phoneE164: row.phone_e164,
        whatsappVerifiedAt: row.whatsapp_verified_at,
      },
    };
  } catch (e) {
    if (isUniqueViolationError(e) || /VENDOR_AUTH_PHONE_CONFLICT/.test(String((e as { message?: string })?.message ?? ""))) {
      return { ok: false, phoneConflict: true, identity: null };
    }
    return { ok: false, phoneConflict: false, identity: null };
  }
}

export interface IssuedGrantIdentity {
  readonly grantId: string;
  readonly authUserId: string;
  readonly vendorId: string;
  readonly vendorDashboardUserId: string;
  readonly expiresAt: string;
}

/**
 * Atomically consume the password-reset challenge, revoke every older open grant
 * for this Auth user, and insert the new grant HASH. Returns only non-secret
 * identity/metadata — never the token or its hash.
 *
 * SECURITY POLICY AUTHORITY: this wrapper passes NO expiry. The database function
 * owns the reset-grant TTL (now() + 10 minutes) and RETURNS the authoritative
 * `expires_at`, which the caller surfaces unchanged.
 */
export async function consumeResetChallengeAndIssueGrant(params: {
  challengeId: string;
  vendorDashboardUserId: string;
  authUserId: string;
  vendorId: string;
  grantTokenHash: string;
}): Promise<Result<IssuedGrantIdentity>> {
  try {
    const { data, error } = await adminClient().rpc(
      "vendor_auth_consume_reset_challenge_and_issue_grant",
      {
        p_challenge_id: params.challengeId,
        p_vendor_dashboard_user_id: params.vendorDashboardUserId,
        p_user_id: params.authUserId,
        p_vendor_id: params.vendorId,
        p_grant_token_hash: params.grantTokenHash,
      }
    );
    if (error) throw error;
    const rows = (data ?? []) as Array<{
      grant_id: string;
      user_id: string;
      vendor_id: string;
      vendor_dashboard_user_id: string;
      expires_at: string;
    }>;
    const row = rows[0];
    if (!row) return fail(new Error("GRANT_NOT_ISSUED"));
    return ok({
      grantId: row.grant_id,
      authUserId: row.user_id,
      vendorId: row.vendor_id,
      vendorDashboardUserId: row.vendor_dashboard_user_id,
      // The DATABASE-generated expiry, surfaced unchanged.
      expiresAt: row.expires_at,
    });
  } catch (e) {
    return fail(e);
  }
}

export interface ClaimedGrantIdentity {
  readonly grantId: string;
  readonly authUserId: string;
  readonly vendorId: string;
  readonly vendorDashboardUserId: string;
  readonly challengeId: string | null;
}

/**
 * Atomically claim (BURN) a reset grant by its token hash.
 *
 * A single conditional UPDATE: the loser of a concurrent race re-evaluates
 * `consumed_at is null` after the row lock and matches zero rows, so exactly one
 * password-reset completion can ever claim a grant. Null means "not found, already
 * consumed, revoked, or expired" — all indistinguishable to the caller.
 */
export async function claimResetGrant(
  grantTokenHash: string
): Promise<ClaimedGrantIdentity | null> {
  try {
    const { data, error } = await adminClient().rpc("vendor_auth_claim_reset_grant", {
      p_grant_token_hash: grantTokenHash,
    });
    if (error) throw error;
    const rows = (data ?? []) as Array<{
      grant_id: string;
      user_id: string;
      vendor_id: string;
      vendor_dashboard_user_id: string;
      challenge_id: string | null;
    }>;
    const row = rows[0];
    if (!row || !row.user_id) return null;
    return {
      grantId: row.grant_id,
      authUserId: row.user_id,
      vendorId: row.vendor_id,
      vendorDashboardUserId: row.vendor_dashboard_user_id,
      challengeId: row.challenge_id,
    };
  } catch {
    return null;
  }
}

// ----------------------------------------------------------------------------
// Shared helpers
// ----------------------------------------------------------------------------
/** A fresh challenge id, generated server-side. Never derived from the OTP. */
export function newChallengeId(): string {
  return crypto.randomUUID();
}

/** Canonical destination hash for a normalized E.164 phone. */
export function destinationHashFor(phoneE164: string): string {
  return hashPhoneE164(phoneE164);
}
