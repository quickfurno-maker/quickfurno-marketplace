import "server-only";

import { adminClient, serverClient } from "../lib/supabase";
import {
  BusinessBindingType,
  InternalPrincipalKind,
  InternalPrincipalStatus,
  ProviderIdentityStatus,
  resolveMappedPrincipal,
  type BusinessBindingRecord,
  type BusinessBindingTypeValue,
  type IdentityDirectoryRepository,
  type InternalPrincipalRecord,
  type MappedPrincipalContext,
  type ProviderIdentityRecord,
  type StablePrincipalResolution,
} from "../lib/identity/identityDirectory";
import {
  IdentityAssuranceLevel,
  IdentityProviderKind,
  type AuthenticationProviderAdapter,
  type ProviderAuthentication,
} from "../lib/identity/providerIdentity";
import {
  StableBusinessAccessDenialReason,
  type StableAdminAccessContext,
  type StableBusinessAccessResolution,
  type StableClientAccessContext,
  type StableVendorAccessContext,
} from "../lib/identity/providerNeutralAccess";

export const SUPABASE_PRIMARY_PROVIDER_KEY = "supabase-primary";

export function supabaseRequestAuthAdapter(): AuthenticationProviderAdapter {
  return Object.freeze({
    providerKey: SUPABASE_PRIMARY_PROVIDER_KEY,
    providerKind: IdentityProviderKind.SUPABASE,
    async authenticateCurrentRequest(): Promise<ProviderAuthentication | null> {
      const sb = await serverClient();
      const { data, error } = await sb.auth.getUser();
      if (error || !data?.user?.id) return null;
      return Object.freeze({
        providerKey: SUPABASE_PRIMARY_PROVIDER_KEY,
        providerKind: IdentityProviderKind.SUPABASE,
        subject: data.user.id,
        sessionId: null,
        assuranceLevel: IdentityAssuranceLevel.UNKNOWN,
        authenticatedAt: data.user.last_sign_in_at ?? null,
        expiresAt: null,
      });
    },
  });
}

export function databaseIdentityDirectoryRepository(): IdentityDirectoryRepository {
  return Object.freeze({
    async findProviderIdentity(providerKey, providerSubject) {
      const { data, error } = await adminClient()
        .from("identity_provider_identities")
        .select("principal_id, provider_key, provider_subject, status")
        .eq("provider_key", providerKey)
        .eq("provider_subject", providerSubject)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      return {
        principalId: String(data.principal_id),
        providerKey: String(data.provider_key),
        providerSubject: String(data.provider_subject),
        status: String(data.status) as ProviderIdentityRecord["status"],
      };
    },
    async findPrincipal(principalId) {
      const { data, error } = await adminClient()
        .from("identity_principals")
        .select("id, principal_kind, status, identity_revision")
        .eq("id", principalId)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      return {
        id: String(data.id),
        principalKind: String(
          data.principal_kind,
        ) as InternalPrincipalRecord["principalKind"],
        status: String(data.status) as InternalPrincipalRecord["status"],
        identityRevision: Number(data.identity_revision),
      };
    },
    async listBusinessBindings(principalId, bindingType) {
      let query = adminClient()
        .from("identity_business_bindings")
        .select("principal_id, binding_type, business_id, status")
        .eq("principal_id", principalId)
        .eq("status", "active");
      if (bindingType) query = query.eq("binding_type", bindingType);
      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []).map((row) => ({
        principalId: String(row.principal_id),
        bindingType: String(row.binding_type) as BusinessBindingTypeValue,
        businessId: String(row.business_id),
        status: String(row.status) as BusinessBindingRecord["status"],
      }));
    },
  });
}

export async function resolveCurrentStablePrincipal(): Promise<StablePrincipalResolution> {
  return resolveMappedPrincipal(
    supabaseRequestAuthAdapter(),
    databaseIdentityDirectoryRepository(),
  );
}

export async function resolveStablePrincipalWithAdapter(
  adapter: AuthenticationProviderAdapter,
  repository: IdentityDirectoryRepository = databaseIdentityDirectoryRepository(),
): Promise<StablePrincipalResolution> {
  return resolveMappedPrincipal(adapter, repository);
}

async function oneBinding(
  principalId: string,
  type: BusinessBindingTypeValue,
  repository: IdentityDirectoryRepository,
): Promise<BusinessBindingRecord | null | "ambiguous"> {
  const rows = (
    await repository.listBusinessBindings(principalId, type)
  ).filter((row) => row.status === "active");
  if (rows.length === 0) return null;
  if (rows.length !== 1) return "ambiguous";
  return rows[0];
}

export async function resolveStableVendorAccess(
  principal: MappedPrincipalContext,
  repository: IdentityDirectoryRepository = databaseIdentityDirectoryRepository(),
): Promise<StableBusinessAccessResolution<StableVendorAccessContext>> {
  try {
    const binding = await oneBinding(
      principal.principalId,
      BusinessBindingType.VENDOR_DASHBOARD_USER,
      repository,
    );
    if (!binding)
      return { ok: false, reason: StableBusinessAccessDenialReason.NO_BINDING };
    if (binding === "ambiguous") {
      return {
        ok: false,
        reason: StableBusinessAccessDenialReason.AMBIGUOUS_BINDING,
      };
    }
    const { data, error } = await adminClient()
      .from("vendor_dashboard_users")
      .select("id, vendor_id, role, status")
      .eq("id", binding.businessId)
      .maybeSingle();
    if (error) throw error;
    if (!data) {
      return {
        ok: false,
        reason: StableBusinessAccessDenialReason.BUSINESS_RECORD_NOT_FOUND,
      };
    }
    if (!data.id || !data.vendor_id || !data.role || !data.status) {
      return {
        ok: false,
        reason: StableBusinessAccessDenialReason.BUSINESS_RECORD_MALFORMED,
      };
    }
    if (String(data.status).trim().toLowerCase() !== "active") {
      return {
        ok: false,
        reason: StableBusinessAccessDenialReason.BUSINESS_ACCESS_NOT_ACTIVE,
      };
    }
    const vendor = await adminClient()
      .from("vendors")
      .select("id")
      .eq("id", data.vendor_id)
      .maybeSingle();
    if (vendor.error) throw vendor.error;
    if (!vendor.data) {
      return {
        ok: false,
        reason: StableBusinessAccessDenialReason.BUSINESS_RECORD_NOT_FOUND,
      };
    }
    return {
      ok: true,
      context: Object.freeze({
        principalId: principal.principalId,
        vendorDashboardUserId: String(data.id),
        vendorId: String(data.vendor_id),
        role: String(data.role),
        membershipStatus: String(data.status),
      }),
    };
  } catch {
    return {
      ok: false,
      reason: StableBusinessAccessDenialReason.LOOKUP_FAILED,
    };
  }
}

export async function resolveStableClientAccess(
  principal: MappedPrincipalContext,
  repository: IdentityDirectoryRepository = databaseIdentityDirectoryRepository(),
): Promise<StableBusinessAccessResolution<StableClientAccessContext>> {
  try {
    const binding = await oneBinding(
      principal.principalId,
      BusinessBindingType.CLIENT_ACCOUNT,
      repository,
    );
    if (!binding)
      return { ok: false, reason: StableBusinessAccessDenialReason.NO_BINDING };
    if (binding === "ambiguous") {
      return {
        ok: false,
        reason: StableBusinessAccessDenialReason.AMBIGUOUS_BINDING,
      };
    }
    const { data, error } = await adminClient()
      .from("client_accounts")
      .select("id, phone_e164, status, whatsapp_verified_at")
      .eq("id", binding.businessId)
      .maybeSingle();
    if (error) throw error;
    if (!data) {
      return {
        ok: false,
        reason: StableBusinessAccessDenialReason.BUSINESS_RECORD_NOT_FOUND,
      };
    }
    if (!data.id || !data.status) {
      return {
        ok: false,
        reason: StableBusinessAccessDenialReason.BUSINESS_RECORD_MALFORMED,
      };
    }
    if (String(data.status).trim().toLowerCase() !== "active") {
      return {
        ok: false,
        reason: StableBusinessAccessDenialReason.BUSINESS_ACCESS_NOT_ACTIVE,
      };
    }
    return {
      ok: true,
      context: Object.freeze({
        principalId: principal.principalId,
        clientAccountId: String(data.id),
        phoneE164: data.phone_e164 ?? null,
        status: String(data.status),
        whatsappVerifiedAt: data.whatsapp_verified_at ?? null,
      }),
    };
  } catch {
    return {
      ok: false,
      reason: StableBusinessAccessDenialReason.LOOKUP_FAILED,
    };
  }
}

export async function resolveStableAdminAccess(
  principal: MappedPrincipalContext,
  repository: IdentityDirectoryRepository = databaseIdentityDirectoryRepository(),
): Promise<StableBusinessAccessResolution<StableAdminAccessContext>> {
  try {
    const binding = await oneBinding(
      principal.principalId,
      BusinessBindingType.PROFILE,
      repository,
    );
    if (!binding)
      return { ok: false, reason: StableBusinessAccessDenialReason.NO_BINDING };
    if (binding === "ambiguous") {
      return {
        ok: false,
        reason: StableBusinessAccessDenialReason.AMBIGUOUS_BINDING,
      };
    }
    const profile = await adminClient()
      .from("profiles")
      .select("id, role, is_active")
      .eq("id", binding.businessId)
      .maybeSingle();
    if (profile.error) throw profile.error;
    if (!profile.data) {
      return {
        ok: false,
        reason: StableBusinessAccessDenialReason.BUSINESS_RECORD_NOT_FOUND,
      };
    }
    if (profile.data.role !== "admin") {
      return {
        ok: false,
        reason: StableBusinessAccessDenialReason.BUSINESS_ACCESS_NOT_ACTIVE,
      };
    }
    const coreRole = await adminClient()
      .from("identity_admin_roles")
      .select("admin_role, status")
      .eq("principal_id", principal.principalId)
      .eq("status", "active")
      .maybeSingle();
    if (coreRole.error) throw coreRole.error;
    if (!coreRole.data?.admin_role) {
      return {
        ok: false,
        reason: StableBusinessAccessDenialReason.BUSINESS_ACCESS_NOT_ACTIVE,
      };
    }
    return {
      ok: true,
      context: Object.freeze({
        principalId: principal.principalId,
        profileId: String(profile.data.id),
        role: "admin",
        isActive: profile.data.is_active !== false,
        adminRole: String(coreRole.data.admin_role),
      }),
    };
  } catch {
    return {
      ok: false,
      reason: StableBusinessAccessDenialReason.LOOKUP_FAILED,
    };
  }
}

export function stablePrincipalContractDefaults() {
  return Object.freeze({
    principalKind: InternalPrincipalKind.HUMAN,
    principalStatus: InternalPrincipalStatus.ACTIVE,
    providerIdentityStatus: ProviderIdentityStatus.ACTIVE,
  });
}
