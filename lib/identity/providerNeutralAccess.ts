// ============================================================================
// QuickFurno — Phase 22 provider-neutral Core access contexts.
// Business authorization fields remain in existing Core tables.
// ============================================================================

export interface StableVendorAccessContext {
  readonly principalId: string;
  readonly vendorDashboardUserId: string;
  readonly vendorId: string;
  readonly role: string;
  readonly membershipStatus: string;
}

export interface StableClientAccessContext {
  readonly principalId: string;
  readonly clientAccountId: string;
  readonly phoneE164: string | null;
  readonly status: string;
  readonly whatsappVerifiedAt: string | null;
}

export interface StableAdminAccessContext {
  readonly principalId: string;
  readonly profileId: string;
  readonly role: "admin";
  readonly adminRole: string;
  readonly isActive: boolean;
}

export const StableBusinessAccessDenialReason = {
  NO_BINDING: "no_binding",
  AMBIGUOUS_BINDING: "ambiguous_binding",
  BUSINESS_RECORD_NOT_FOUND: "business_record_not_found",
  BUSINESS_ACCESS_NOT_ACTIVE: "business_access_not_active",
  BUSINESS_RECORD_MALFORMED: "business_record_malformed",
  LOOKUP_FAILED: "lookup_failed",
} as const;

export type StableBusinessAccessDenialReasonValue =
  (typeof StableBusinessAccessDenialReason)[keyof typeof StableBusinessAccessDenialReason];

export type StableBusinessAccessResolution<T> =
  | { readonly ok: true; readonly context: T }
  | {
      readonly ok: false;
      readonly reason: StableBusinessAccessDenialReasonValue;
    };
