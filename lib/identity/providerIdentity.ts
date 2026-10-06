// ============================================================================
// QuickFurno — Phase 22 provider-neutral authentication contract.
//
// Authentication providers prove a subject. They do NOT grant marketplace roles,
// vendor access, admin privilege, credits, or any other Core authorization.
// ============================================================================

export const IdentityProviderKind = {
  SUPABASE: "supabase",
  OIDC: "oidc",
  SAML: "saml",
  TEST: "test",
} as const;

export type IdentityProviderKindValue =
  (typeof IdentityProviderKind)[keyof typeof IdentityProviderKind];

export const IdentityAssuranceLevel = {
  UNKNOWN: "unknown",
  AAL1: "aal1",
  AAL2: "aal2",
} as const;

export type IdentityAssuranceLevelValue =
  (typeof IdentityAssuranceLevel)[keyof typeof IdentityAssuranceLevel];

export interface ProviderAuthentication {
  readonly providerKey: string;
  readonly providerKind: IdentityProviderKindValue;
  readonly subject: string;
  readonly sessionId: string | null;
  readonly assuranceLevel: IdentityAssuranceLevelValue;
  readonly authenticatedAt: string | null;
  readonly expiresAt: string | null;
}

export interface AuthenticationProviderAdapter {
  readonly providerKey: string;
  readonly providerKind: IdentityProviderKindValue;
  authenticateCurrentRequest(): Promise<ProviderAuthentication | null>;
}

const PROVIDER_KEY = /^[a-z0-9][a-z0-9._:-]{1,79}$/u;

export function isProviderKey(value: unknown): value is string {
  return typeof value === "string" && PROVIDER_KEY.test(value);
}

export function isProviderSubject(value: unknown): value is string {
  return typeof value === "string" && value.length >= 1 && value.length <= 512;
}

export function isProviderAuthentication(
  value: unknown,
): value is ProviderAuthentication {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<ProviderAuthentication>;
  return (
    isProviderKey(candidate.providerKey) &&
    Object.values(IdentityProviderKind).includes(
      candidate.providerKind as IdentityProviderKindValue,
    ) &&
    isProviderSubject(candidate.subject) &&
    (candidate.sessionId === null || typeof candidate.sessionId === "string") &&
    Object.values(IdentityAssuranceLevel).includes(
      candidate.assuranceLevel as IdentityAssuranceLevelValue,
    ) &&
    (candidate.authenticatedAt === null ||
      typeof candidate.authenticatedAt === "string") &&
    (candidate.expiresAt === null || typeof candidate.expiresAt === "string")
  );
}

export const IDENTITY_PROVIDER_CUTOVER_POLICY = Object.freeze({
  acceptLegacyProviderSessionsAfterCutover: false,
  assumePasswordHashPortability: false,
  assumeMfaEnrollmentPortability: false,
  providerClaimsGrantAuthorization: false,
  requireReauthenticationAfterProviderCutover: true,
  requireCredentialResetOrVerifiedMigrationWhenPasswordImportIsUnsupported: true,
});
