// ============================================================================
// QuickFurno — Identity Foundation: client account contract (Phase 5A)
//
// Pure contract for the additive public.client_accounts identity foundation.
// Phase 5A adds NO historical-lead relinking and does NOT change anonymous
// enquiry submission — anonymous lead capture continues exactly as before.
// ============================================================================

/** Client account lifecycle status. */
export const ClientAccountStatus = {
  ACTIVE: "active",
  SUSPENDED: "suspended",
  DISABLED: "disabled",
} as const;

export type ClientAccountStatusValue =
  (typeof ClientAccountStatus)[keyof typeof ClientAccountStatus];

export const KNOWN_CLIENT_ACCOUNT_STATUSES: readonly ClientAccountStatusValue[] =
  Object.freeze(Object.values(ClientAccountStatus));

export function isClientAccountStatus(value: unknown): value is ClientAccountStatusValue {
  return (
    typeof value === "string" && (KNOWN_CLIENT_ACCOUNT_STATUSES as string[]).includes(value)
  );
}

/**
 * Immutable client account contract mirroring public.client_accounts.
 * `userId` maps to the Supabase auth identity; `phoneE164` is the normalized
 * business phone identity (unique where present). `whatsappVerifiedAt` is set
 * only once the client's WhatsApp is verified by a future Phase 5 flow.
 */
export interface ClientAccount {
  readonly id: string;
  readonly userId: string;
  readonly phoneE164: string | null;
  readonly displayName: string | null;
  readonly whatsappVerifiedAt: string | null;
  readonly status: ClientAccountStatusValue;
  readonly createdAt: string;
  readonly updatedAt: string;
}
