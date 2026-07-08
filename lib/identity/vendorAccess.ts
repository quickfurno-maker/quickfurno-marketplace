// ============================================================================
// QuickFurno — Identity Foundation: vendor access contract (Phase 5C)
//
// The canonical, PURE contract for "which QuickFurno vendor business does this
// authenticated Supabase user have dashboard access to?". No network calls, no
// database access, no Supabase imports — services/vendorAccessService.ts is the
// only resolver.
//
// RESPONSIBILITY SEPARATION (do not merge these — see the Phase 5C doc):
//   • Supabase Auth              = authentication + session authority
//   • vendor_dashboard_users     = auth principal → vendor business access mapping
//   • vendors                    = the business entity
//   • Phase 4 policy engine      = business authorization authority
//   • Phase 5A auth_security_events = authentication/security audit log
//   • Phase 5B communication core   = transport, never an authentication authority
//
// A vendor may authenticate successfully while WhatsApp verification is pending,
// business verification is pending, the package is inactive, credits are zero,
// and lead eligibility is false. Those are BUSINESS states enforced by other
// layers. None of them is an authentication credential.
// ============================================================================

import { vendorPrincipal, type PrincipalRef } from "./principal";

/** The only vendor_dashboard_users.status value that grants dashboard access. */
export const VENDOR_MEMBERSHIP_ACTIVE = "active";

/**
 * Membership statuses this codebase understands. Deliberately NOT enforced as a
 * database CHECK constraint: the live table predates this phase and may hold
 * values we have not seen. Anything that is not exactly `active` fails closed.
 */
export const KNOWN_VENDOR_MEMBERSHIP_STATUSES: readonly string[] = Object.freeze([
  "active",
  "invited",
  "suspended",
  "revoked",
]);

/**
 * True only for an exactly-active membership. Unknown, empty, and mis-cased
 * values all deny access — an unrecognised status must never grant entry.
 */
export function isActiveVendorMembership(status: unknown): boolean {
  return typeof status === "string" && status.trim().toLowerCase() === VENDOR_MEMBERSHIP_ACTIVE;
}

/**
 * The authenticated caller's resolved vendor access. `vendorId` here is the ONLY
 * trustworthy vendor identity for a request — it is derived from the Supabase
 * auth user, never from anything the browser sent.
 */
export interface VendorAccessContext {
  readonly authUserId: string;
  readonly vendorDashboardUserId: string;
  readonly vendorId: string;
  readonly role: string;
  readonly membershipStatus: string;
}

export const VendorAccessDenialReason = {
  /** No authenticated Supabase user on this request. */
  NOT_AUTHENTICATED: "not_authenticated",
  /** Authentic user, but no vendor_dashboard_users row maps them to a vendor. */
  NO_VENDOR_MAPPING: "no_vendor_mapping",
  /** Mapping exists but membership is not active (invited/suspended/revoked/unknown). */
  MEMBERSHIP_NOT_ACTIVE: "membership_not_active",
  /** Mapping row is missing an id / vendor_id / role — never guess. */
  MALFORMED_MAPPING: "malformed_mapping",
  /** Mapping points at a vendor row that does not exist. */
  VENDOR_NOT_FOUND: "vendor_not_found",
  /** The lookup itself failed (transport/permission/duplicate mapping). */
  LOOKUP_FAILED: "lookup_failed",
} as const;

export type VendorAccessDenialReasonValue =
  (typeof VendorAccessDenialReason)[keyof typeof VendorAccessDenialReason];

export type VendorAccessResolution =
  | { readonly ok: true; readonly context: VendorAccessContext }
  | { readonly ok: false; readonly reason: VendorAccessDenialReasonValue };

export function grantVendorAccess(context: VendorAccessContext): VendorAccessResolution {
  return { ok: true, context: Object.freeze(context) };
}

export function denyVendorAccess(reason: VendorAccessDenialReasonValue): VendorAccessResolution {
  return { ok: false, reason };
}

/**
 * Business/verification/billing columns that MUST NOT participate in resolving
 * authentication access. Listed here so the contract is explicit, the Phase 5C
 * doc can cite it, and the harness can assert the resolver never reads them.
 */
export const BUSINESS_STATE_FIELDS_EXCLUDED_FROM_AUTHENTICATION: readonly string[] = Object.freeze([
  "verification_status", // vendor business verification
  "paid_status", // subscription / payment
  "package_status", // subscription package
  "remaining_credits", // credit wallet
  "total_credits",
  "accepting_leads", // lead eligibility
  "is_active", // vendor business activation
  "public_visibility",
  "phone_verified", // WhatsApp/phone verification (Phase 5E)
  "whatsapp_otp_enabled", // WhatsApp OTP capability (Phase 5D/5E)
]);

/**
 * The ONLY column the access resolver reads from `vendors`: existence of the
 * business entity. Reading anything else would smuggle a business state into the
 * authentication decision.
 */
export const VENDOR_IDENTITY_LOOKUP_COLUMNS = "id";

/**
 * Compare a *requested* vendor id against the authenticated context.
 *
 * A requested vendor id may be VALIDATED, but it can never become the identity
 * authority. Callers pass the untrusted value here and use `context.vendorId`
 * afterwards — never the argument.
 */
export function vendorScopeMatches(
  context: VendorAccessContext,
  requestedVendorId: string | null | undefined
): boolean {
  if (typeof requestedVendorId !== "string" || requestedVendorId.trim() === "") return false;
  return requestedVendorId === context.vendorId;
}

/** Bridge to the Phase 5A canonical principal vocabulary. */
export function vendorAccessPrincipal(context: VendorAccessContext): PrincipalRef {
  return vendorPrincipal({ vendorId: context.vendorId, userId: context.authUserId });
}
