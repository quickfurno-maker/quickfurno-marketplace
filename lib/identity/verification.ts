// ============================================================================
// QuickFurno — Identity Foundation: verification purpose + challenge contracts
// (Phase 5A)
//
// Pure, deterministic contracts for QuickFurno-managed VENDOR verification
// challenges. NO OTP generation, NO verification service logic, NO transport.
//
// IMPORTANT: client Supabase OTP login is NOT modelled here — it stays Supabase
// Auth session-controlled. verification_challenges is for QuickFurno-managed
// vendor challenges only.
// ============================================================================

import type { PrincipalTypeValue } from "./principal";

/**
 * Typed verification purposes for QuickFurno-managed challenges. Purposes are
 * NOT interchangeable: a challenge issued for one purpose can never satisfy
 * another (enforced by `challengePurposeMatches`).
 */
export const VerificationPurpose = {
  VENDOR_WHATSAPP_VERIFY: "vendor_whatsapp_verify",
  VENDOR_PASSWORD_RESET: "vendor_password_reset",
} as const;

export type VerificationPurposeValue =
  (typeof VerificationPurpose)[keyof typeof VerificationPurpose];

export const KNOWN_VERIFICATION_PURPOSES: readonly VerificationPurposeValue[] = Object.freeze(
  Object.values(VerificationPurpose),
);

export function isVerificationPurpose(value: unknown): value is VerificationPurposeValue {
  return (
    typeof value === "string" && (KNOWN_VERIFICATION_PURPOSES as string[]).includes(value)
  );
}

/**
 * Purpose isolation contract. Returns true ONLY when both values are known
 * purposes AND they are exactly equal. A `vendor_whatsapp_verify` challenge can
 * therefore never be accepted for `vendor_password_reset`, and unknown/blank
 * values never match anything.
 */
export function challengePurposeMatches(
  challengePurpose: unknown,
  requiredPurpose: unknown,
): boolean {
  return (
    isVerificationPurpose(challengePurpose) &&
    isVerificationPurpose(requiredPurpose) &&
    challengePurpose === requiredPurpose
  );
}

/**
 * Verification challenge lifecycle states.
 *   pending   — active, awaiting verification
 *   verified  — OTP verified, not yet consumed (single-use still open)
 *   consumed  — terminal: fully used
 *   expired   — terminal: passed expiry
 *   locked    — terminal: too many attempts / rate-limited
 *   cancelled — terminal: explicitly cancelled
 */
export const VerificationChallengeStatus = {
  PENDING: "pending",
  VERIFIED: "verified",
  CONSUMED: "consumed",
  EXPIRED: "expired",
  LOCKED: "locked",
  CANCELLED: "cancelled",
} as const;

export type VerificationChallengeStatusValue =
  (typeof VerificationChallengeStatus)[keyof typeof VerificationChallengeStatus];

export const KNOWN_CHALLENGE_STATUSES: readonly VerificationChallengeStatusValue[] =
  Object.freeze(Object.values(VerificationChallengeStatus));

/** Terminal states — a challenge in one of these can never transition again. */
export const TERMINAL_CHALLENGE_STATUSES: readonly VerificationChallengeStatusValue[] =
  Object.freeze([
    VerificationChallengeStatus.CONSUMED,
    VerificationChallengeStatus.EXPIRED,
    VerificationChallengeStatus.LOCKED,
    VerificationChallengeStatus.CANCELLED,
  ]);

export function isVerificationChallengeStatus(
  value: unknown,
): value is VerificationChallengeStatusValue {
  return typeof value === "string" && (KNOWN_CHALLENGE_STATUSES as string[]).includes(value);
}

export function isChallengeTerminalState(value: unknown): boolean {
  return (
    typeof value === "string" && (TERMINAL_CHALLENGE_STATUSES as string[]).includes(value)
  );
}

/** True only for the single active state a challenge may be issued/attempted in. */
export function isChallengeActiveState(value: unknown): boolean {
  return value === VerificationChallengeStatus.PENDING;
}

/**
 * Immutable, server-only verification challenge contract mirroring
 * public.verification_challenges. Persistence is service-role only; this type is
 * never sent to the browser. It carries ONLY hashes — never a plaintext OTP or
 * destination.
 */
export interface VerificationChallenge {
  readonly id: string;
  readonly principalType: PrincipalTypeValue;
  readonly principalId: string | null;
  readonly purpose: VerificationPurposeValue;
  readonly destinationHash: string;
  readonly otpHash: string;
  readonly status: VerificationChallengeStatusValue;
  readonly expiresAt: string;
  readonly attemptCount: number;
  readonly maxAttempts: number;
  readonly resendCount: number;
  readonly createdAt: string;
  readonly verifiedAt: string | null;
  readonly consumedAt: string | null;
}
