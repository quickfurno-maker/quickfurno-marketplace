// ============================================================================
// QuickFurno — Phase 22 stable internal principal directory (pure contract).
// ============================================================================

import {
  isProviderAuthentication,
  type AuthenticationProviderAdapter,
  type ProviderAuthentication,
} from "./providerIdentity";

export const InternalPrincipalKind = {
  HUMAN: "human",
  INTEGRATION: "integration",
  SYSTEM: "system",
} as const;

export type InternalPrincipalKindValue =
  (typeof InternalPrincipalKind)[keyof typeof InternalPrincipalKind];

export const InternalPrincipalStatus = {
  ACTIVE: "active",
  DISABLED: "disabled",
  RETIRED: "retired",
} as const;

export type InternalPrincipalStatusValue =
  (typeof InternalPrincipalStatus)[keyof typeof InternalPrincipalStatus];

export const ProviderIdentityStatus = {
  ACTIVE: "active",
  DISABLED: "disabled",
  UNLINKED: "unlinked",
} as const;

export type ProviderIdentityStatusValue =
  (typeof ProviderIdentityStatus)[keyof typeof ProviderIdentityStatus];

export const BusinessBindingType = {
  PROFILE: "profile",
  CLIENT_ACCOUNT: "client_account",
  VENDOR_DASHBOARD_USER: "vendor_dashboard_user",
} as const;

export type BusinessBindingTypeValue =
  (typeof BusinessBindingType)[keyof typeof BusinessBindingType];

export interface InternalPrincipalRecord {
  readonly id: string;
  readonly principalKind: InternalPrincipalKindValue;
  readonly status: InternalPrincipalStatusValue;
  readonly identityRevision: number;
}

export interface ProviderIdentityRecord {
  readonly principalId: string;
  readonly providerKey: string;
  readonly providerSubject: string;
  readonly status: ProviderIdentityStatusValue;
}

export interface BusinessBindingRecord {
  readonly principalId: string;
  readonly bindingType: BusinessBindingTypeValue;
  readonly businessId: string;
  readonly status: "active" | "revoked";
}

export interface IdentityDirectoryRepository {
  findProviderIdentity(
    providerKey: string,
    providerSubject: string,
  ): Promise<ProviderIdentityRecord | null>;
  findPrincipal(principalId: string): Promise<InternalPrincipalRecord | null>;
  listBusinessBindings(
    principalId: string,
    bindingType?: BusinessBindingTypeValue,
  ): Promise<readonly BusinessBindingRecord[]>;
}

export interface MappedPrincipalContext {
  readonly principalId: string;
  readonly principalKind: InternalPrincipalKindValue;
  readonly identityRevision: number;
  readonly authentication: ProviderAuthentication;
}

export const StablePrincipalDenialReason = {
  NOT_AUTHENTICATED: "not_authenticated",
  INVALID_PROVIDER_EVIDENCE: "invalid_provider_evidence",
  PROVIDER_IDENTITY_NOT_MAPPED: "provider_identity_not_mapped",
  PROVIDER_IDENTITY_NOT_ACTIVE: "provider_identity_not_active",
  PRINCIPAL_NOT_FOUND: "principal_not_found",
  PRINCIPAL_NOT_ACTIVE: "principal_not_active",
  DIRECTORY_LOOKUP_FAILED: "directory_lookup_failed",
} as const;

export type StablePrincipalDenialReasonValue =
  (typeof StablePrincipalDenialReason)[keyof typeof StablePrincipalDenialReason];

export type StablePrincipalResolution =
  | { readonly ok: true; readonly context: MappedPrincipalContext }
  | { readonly ok: false; readonly reason: StablePrincipalDenialReasonValue };

export async function resolveMappedPrincipal(
  adapter: AuthenticationProviderAdapter,
  repository: IdentityDirectoryRepository,
): Promise<StablePrincipalResolution> {
  let authentication: ProviderAuthentication | null;
  try {
    authentication = await adapter.authenticateCurrentRequest();
  } catch {
    return { ok: false, reason: StablePrincipalDenialReason.NOT_AUTHENTICATED };
  }
  if (!authentication) {
    return { ok: false, reason: StablePrincipalDenialReason.NOT_AUTHENTICATED };
  }
  if (
    authentication.providerKey !== adapter.providerKey ||
    authentication.providerKind !== adapter.providerKind ||
    !isProviderAuthentication(authentication)
  ) {
    return {
      ok: false,
      reason: StablePrincipalDenialReason.INVALID_PROVIDER_EVIDENCE,
    };
  }

  try {
    const providerIdentity = await repository.findProviderIdentity(
      authentication.providerKey,
      authentication.subject,
    );
    if (!providerIdentity) {
      return {
        ok: false,
        reason: StablePrincipalDenialReason.PROVIDER_IDENTITY_NOT_MAPPED,
      };
    }
    if (providerIdentity.status !== ProviderIdentityStatus.ACTIVE) {
      return {
        ok: false,
        reason: StablePrincipalDenialReason.PROVIDER_IDENTITY_NOT_ACTIVE,
      };
    }

    const principal = await repository.findPrincipal(
      providerIdentity.principalId,
    );
    if (!principal) {
      return {
        ok: false,
        reason: StablePrincipalDenialReason.PRINCIPAL_NOT_FOUND,
      };
    }
    if (principal.status !== InternalPrincipalStatus.ACTIVE) {
      return {
        ok: false,
        reason: StablePrincipalDenialReason.PRINCIPAL_NOT_ACTIVE,
      };
    }

    return {
      ok: true,
      context: Object.freeze({
        principalId: principal.id,
        principalKind: principal.principalKind,
        identityRevision: principal.identityRevision,
        authentication,
      }),
    };
  } catch {
    return {
      ok: false,
      reason: StablePrincipalDenialReason.DIRECTORY_LOOKUP_FAILED,
    };
  }
}
