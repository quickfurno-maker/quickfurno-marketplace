// ============================================================================
// QuickFurno — Identity & Security Foundation (Phase 5A) — public surface.
//
// Canonical identity vocabulary + verification/security contracts. Pure and
// deterministic: no network calls, no OTP transport, no provider code. Does not
// replace the existing auth guards (app/actions.ts) or the Phase 4 policy engine.
// ============================================================================

export {
  PrincipalType,
  KNOWN_PRINCIPAL_TYPES,
  SESSION_BACKED_PRINCIPAL_TYPES,
  isPrincipalType,
  isSessionBackedPrincipalType,
  anonymousPrincipal,
  clientPrincipal,
  vendorPrincipal,
  adminPrincipal,
  integrationPrincipal,
  systemPrincipal,
} from "./principal";
export type { PrincipalTypeValue, PrincipalRef } from "./principal";

export {
  VerificationPurpose,
  KNOWN_VERIFICATION_PURPOSES,
  isVerificationPurpose,
  challengePurposeMatches,
  VerificationChallengeStatus,
  KNOWN_CHALLENGE_STATUSES,
  TERMINAL_CHALLENGE_STATUSES,
  isVerificationChallengeStatus,
  isChallengeTerminalState,
  isChallengeActiveState,
} from "./verification";
export type {
  VerificationPurposeValue,
  VerificationChallengeStatusValue,
  VerificationChallenge,
} from "./verification";

export {
  ClientAccountStatus,
  KNOWN_CLIENT_ACCOUNT_STATUSES,
  isClientAccountStatus,
} from "./clientAccount";
export type { ClientAccountStatusValue, ClientAccount } from "./clientAccount";

export {
  AuthSecurityEventType,
  KNOWN_AUTH_SECURITY_EVENT_TYPES,
  isAuthSecurityEventType,
  isForbiddenSecurityMetadataKey,
  containsForbiddenSecurityKey,
  sanitizeAuthSecurityMetadata,
} from "./authSecurityEvent";
export type { AuthSecurityEventTypeValue, AuthSecurityEvent } from "./authSecurityEvent";
