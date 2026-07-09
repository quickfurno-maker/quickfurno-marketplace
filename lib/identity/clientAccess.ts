// ============================================================================
// QuickFurno — Identity Foundation: client access contract (Phase 5D)
//
// The canonical, PURE contract for "which QuickFurno client business identity
// does this authenticated Supabase user hold?". No network calls, no database
// access, no Supabase imports — services/clientAccessService.ts is the only
// resolver.
//
// RESPONSIBILITY SEPARATION (do not merge these):
//   • Supabase Auth               = authentication + session authority
//   • client_accounts             = auth principal → client business identity map
//   • Phase 5B communication core = transport, never an authentication authority
//   • Phase 5A auth_security_events = authentication/security audit log
//
// A client's access depends on EXACTLY THREE things:
//   1. an authentic Supabase user,
//   2. a valid user→client_accounts mapping,
//   3. an active client account status.
// It must NEVER depend on lead status, lead quality, vendor matching,
// subscription, vendor state, or marketing consent. Anonymous lead submission
// remains entirely independent of this contract.
// ============================================================================

import type { ClientAccountStatusValue } from "./clientAccount";
import { ClientAccountStatus } from "./clientAccount";
import { clientPrincipal, type PrincipalRef } from "./principal";

/** The only client_accounts.status value that grants client access. */
export const CLIENT_ACCOUNT_ACTIVE = ClientAccountStatus.ACTIVE;

/**
 * True only for an exactly-active client account. Unknown, empty, and mis-cased
 * values all deny access — an unrecognised status must never grant entry, and a
 * suspended/disabled account is never silently reactivated.
 */
export function isActiveClientAccount(status: unknown): boolean {
  return typeof status === "string" && status.trim().toLowerCase() === CLIENT_ACCOUNT_ACTIVE;
}

/**
 * The authenticated caller's resolved client access. `clientAccountId` here is
 * the ONLY trustworthy client identity for a request — it is derived from the
 * Supabase auth user, never from anything the browser sent.
 */
export interface ClientAccessContext {
  readonly authUserId: string;
  readonly clientAccountId: string;
  readonly phoneE164: string | null;
  readonly status: ClientAccountStatusValue;
  readonly whatsappVerifiedAt: string | null;
}

export const ClientAccessDenialReason = {
  /** No authenticated Supabase user on this request. */
  NOT_AUTHENTICATED: "not_authenticated",
  /** Authentic user, but no client_accounts row maps them to a client identity. */
  NO_CLIENT_ACCOUNT: "no_client_account",
  /** Mapping exists but status is not active (suspended/disabled/unknown). */
  ACCOUNT_NOT_ACTIVE: "account_not_active",
  /** Mapping row is missing an id / user_id / status — never guess. */
  MALFORMED_ACCOUNT: "malformed_account",
  /** The lookup itself failed (transport/permission/duplicate mapping). */
  LOOKUP_FAILED: "lookup_failed",
} as const;

export type ClientAccessDenialReasonValue =
  (typeof ClientAccessDenialReason)[keyof typeof ClientAccessDenialReason];

export type ClientAccessResolution =
  | { readonly ok: true; readonly context: ClientAccessContext }
  | { readonly ok: false; readonly reason: ClientAccessDenialReasonValue };

export function grantClientAccess(context: ClientAccessContext): ClientAccessResolution {
  return { ok: true, context: Object.freeze(context) };
}

export function denyClientAccess(reason: ClientAccessDenialReasonValue): ClientAccessResolution {
  return { ok: false, reason };
}

/** Bridge to the Phase 5A canonical principal vocabulary. */
export function clientAccessPrincipal(context: ClientAccessContext): PrincipalRef {
  return clientPrincipal({ clientAccountId: context.clientAccountId, userId: context.authUserId });
}
