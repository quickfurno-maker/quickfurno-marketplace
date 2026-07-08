// ============================================================================
// QuickFurno — services/vendorAccessService.ts   (server-only)
//
// THE one canonical resolver for vendor dashboard access. No route, page, or
// action may re-derive vendor identity by hand.
//
// IDENTITY CHAIN (the only trustworthy one):
//   Supabase Auth user  →  vendor_dashboard_users.user_id
//                       →  vendor_dashboard_users.vendor_id
//                       →  vendors.id
//
// A vendor_id arriving from a form body, query string, URL segment, hidden
// input, localStorage, or an application-created cookie is UNTRUSTED input. It
// may be COMPARED against the resolved context (`requireVendorScope`) but never
// becomes the identity authority.
//
// AUTHENTICATION ACCESS DEPENDS ON EXACTLY THREE THINGS:
//   1. an authentic Supabase user,
//   2. a valid user→vendor mapping,
//   3. an active vendor dashboard membership.
//
// It must NEVER depend on verification_status, paid_status, package_status,
// remaining_credits, accepting_leads, phone_verified, or whatsapp_otp_enabled.
// Those are business/verification states enforced by other layers (Phase 4
// policy engine, credit wallet, Phase 5E WhatsApp verification).
// ============================================================================

import { adminClient, serverClient } from "../lib/supabase";
import { AppError, appError, fail, ok, type Result } from "../lib/errors";
import { isUniqueViolationError } from "../lib/communication/dbErrors";
import { normalizePhoneE164 } from "../lib/communication/phone";
import {
  VENDOR_IDENTITY_LOOKUP_COLUMNS,
  VENDOR_MEMBERSHIP_ACTIVE,
  VendorAccessDenialReason,
  denyVendorAccess,
  grantVendorAccess,
  isActiveVendorMembership,
  vendorScopeMatches,
  type VendorAccessContext,
  type VendorAccessResolution,
} from "../lib/identity/vendorAccess";

export const VENDOR_DASHBOARD_USERS_TABLE = "vendor_dashboard_users";

/** Login methods recorded on vendor_dashboard_users.last_login_method. */
export const VendorLoginMethod = {
  PASSWORD: "password",
} as const;
export type VendorLoginMethodValue = (typeof VendorLoginMethod)[keyof typeof VendorLoginMethod];

export const VendorLinkError = {
  VENDOR_NOT_FOUND: "VENDOR_NOT_FOUND",
  /** Refuses to move an auth principal from one vendor business to another. */
  CROSS_VENDOR_LINK_CONFLICT: "CROSS_VENDOR_LINK_CONFLICT",
  VENDOR_LINK_INVALID_PHONE: "VENDOR_LINK_INVALID_PHONE",
  VENDOR_LINK_FAILED: "VENDOR_LINK_FAILED",
} as const;

const VENDOR_LINK_MESSAGES: Record<string, string> = {
  VENDOR_NOT_FOUND: "Vendor not found.",
  CROSS_VENDOR_LINK_CONFLICT:
    "This authentication account is already linked to a different vendor business.",
  VENDOR_LINK_INVALID_PHONE: "Vendor link phone must be a canonical international number.",
  VENDOR_LINK_FAILED: "The vendor authentication link could not be written.",
};

function vendorLinkError(code: keyof typeof VendorLinkError): AppError {
  return new AppError(code, VENDOR_LINK_MESSAGES[code]);
}

/** Shape of the columns this service reads from vendor_dashboard_users. */
interface VendorDashboardUserRow {
  id: string | null;
  vendor_id: string | null;
  user_id: string | null;
  role: string | null;
  status: string | null;
}

/** The mapping columns needed to authenticate. Business state is NOT selected. */
const MAPPING_COLUMNS = "id, vendor_id, user_id, role, status";

// ----------------------------------------------------------------------------
// Resolution
// ----------------------------------------------------------------------------

/**
 * Resolve vendor access for an ALREADY-AUTHENTICATED Supabase user id.
 *
 * Uses the service-role client because the caller has already been validated by
 * Supabase Auth and because admin-side linking flows must resolve users other
 * than the current session's. `resolveCurrentVendorAccess()` is the entry point
 * that establishes authenticity first.
 */
export async function resolveVendorAccess(authUserId: string): Promise<VendorAccessResolution> {
  if (typeof authUserId !== "string" || authUserId.trim() === "") {
    return denyVendorAccess(VendorAccessDenialReason.NOT_AUTHENTICATED);
  }

  let mapping: VendorDashboardUserRow | null;
  try {
    const { data, error } = await adminClient()
      .from(VENDOR_DASHBOARD_USERS_TABLE)
      .select(MAPPING_COLUMNS)
      // A partial unique index on (user_id) WHERE user_id IS NOT NULL guarantees
      // at most one row. If duplicates ever existed, maybeSingle() errors and we
      // fail closed rather than pick one.
      .eq("user_id", authUserId)
      .maybeSingle();

    if (error) return denyVendorAccess(VendorAccessDenialReason.LOOKUP_FAILED);
    mapping = (data as VendorDashboardUserRow | null) ?? null;
  } catch {
    return denyVendorAccess(VendorAccessDenialReason.LOOKUP_FAILED);
  }

  if (!mapping) return denyVendorAccess(VendorAccessDenialReason.NO_VENDOR_MAPPING);

  if (!mapping.id || !mapping.vendor_id || !mapping.role) {
    return denyVendorAccess(VendorAccessDenialReason.MALFORMED_MAPPING);
  }

  // Membership is the ONLY status consulted. Vendor business state is not read.
  if (!isActiveVendorMembership(mapping.status)) {
    return denyVendorAccess(VendorAccessDenialReason.MEMBERSHIP_NOT_ACTIVE);
  }

  try {
    const { data: vendor, error } = await adminClient()
      .from("vendors")
      // Existence only. Selecting verification_status / paid_status / credits here
      // would smuggle a business state into an authentication decision.
      .select(VENDOR_IDENTITY_LOOKUP_COLUMNS)
      .eq("id", mapping.vendor_id)
      .maybeSingle();

    if (error) return denyVendorAccess(VendorAccessDenialReason.LOOKUP_FAILED);
    if (!vendor) return denyVendorAccess(VendorAccessDenialReason.VENDOR_NOT_FOUND);
  } catch {
    return denyVendorAccess(VendorAccessDenialReason.LOOKUP_FAILED);
  }

  return grantVendorAccess({
    authUserId,
    vendorDashboardUserId: mapping.id,
    vendorId: mapping.vendor_id,
    role: mapping.role,
    membershipStatus: mapping.status as string,
  });
}

/**
 * Resolve vendor access for the CURRENT request.
 *
 * `supabase.auth.getUser()` on the request-scoped SSR client revalidates the
 * session against the Auth server — it is not a local JWT decode, and there is no
 * second QuickFurno session cookie. The auth user id it returns is the only
 * accepted input to the mapping lookup.
 */
export async function resolveCurrentVendorAccess(): Promise<VendorAccessResolution> {
  let authUserId: string;
  try {
    const sb = await serverClient();
    const { data, error } = await sb.auth.getUser();
    if (error || !data?.user?.id) {
      return denyVendorAccess(VendorAccessDenialReason.NOT_AUTHENTICATED);
    }
    authUserId = data.user.id;
  } catch {
    return denyVendorAccess(VendorAccessDenialReason.NOT_AUTHENTICATED);
  }

  return resolveVendorAccess(authUserId);
}

// ----------------------------------------------------------------------------
// Guards
// ----------------------------------------------------------------------------

/**
 * The ONE reusable guard for protected vendor routes. Fails closed and returns
 * the canonical vendorId — callers must use `context.vendorId`, never a request
 * parameter. The denial reason is deliberately not surfaced to the caller.
 */
export async function requireVendorAccess(): Promise<Result<VendorAccessContext>> {
  const resolution = await resolveCurrentVendorAccess();
  if (!resolution.ok) return fail(appError("UNAUTHORIZED"));
  return ok(resolution.context);
}

/**
 * Validate an untrusted, request-supplied vendor id against the authenticated
 * context, then return the CANONICAL context. Cross-vendor access is denied; the
 * argument never becomes identity authority.
 */
export async function requireVendorScope(
  requestedVendorId: string | null | undefined
): Promise<Result<VendorAccessContext>> {
  const access = await requireVendorAccess();
  if (!access.ok) return access;
  if (!vendorScopeMatches(access.data, requestedVendorId)) {
    return fail(appError("UNAUTHORIZED"));
  }
  return ok(access.data);
}

// ----------------------------------------------------------------------------
// Server-side login metadata
// ----------------------------------------------------------------------------

/**
 * Records login telemetry on the mapping row. Server-side only: `authenticated`
 * holds no UPDATE grant or policy on vendor_dashboard_users, so a vendor can
 * never write this (or any other) column from the browser.
 */
export async function recordVendorLoginMetadata(
  vendorDashboardUserId: string,
  method: VendorLoginMethodValue
): Promise<Result<null>> {
  try {
    const nowIso = new Date().toISOString();
    const { error } = await adminClient()
      .from(VENDOR_DASHBOARD_USERS_TABLE)
      .update({ last_login_at: nowIso, last_login_method: method, updated_at: nowIso })
      .eq("id", vendorDashboardUserId);
    if (error) throw error;
    return ok(null);
  } catch (e) {
    return fail(e);
  }
}

// ----------------------------------------------------------------------------
// Provisioning / linking (admin-authorized, server-only)
// ----------------------------------------------------------------------------

/**
 * Proof that an admin authorized a linking operation. Only obtainable from
 * `authorizeAdminForVendorLinking()`, which checks the CURRENT session — so a
 * browser-supplied vendorId can never reach `linkVendorAuthUser` unaccompanied.
 */
export interface AdminVendorLinkAuthorization {
  readonly adminUserId: string;
}

/** Mirrors the repository's existing admin convention (profiles.role = 'admin'). */
export async function authorizeAdminForVendorLinking(): Promise<Result<AdminVendorLinkAuthorization>> {
  try {
    const sb = await serverClient();
    const { data, error } = await sb.auth.getUser();
    if (error || !data?.user?.id) return fail(appError("UNAUTHORIZED"));

    const { data: profile } = await sb
      .from("profiles")
      .select("role")
      .eq("id", data.user.id)
      .maybeSingle();

    if ((profile as { role?: string } | null)?.role !== "admin") return fail(appError("UNAUTHORIZED"));
    return ok({ adminUserId: data.user.id });
  } catch (e) {
    return fail(e);
  }
}

export interface LinkVendorAuthUserInput {
  readonly vendorId: string;
  readonly authUserId: string;
  readonly email?: string | null;
  readonly phone?: string | null;
  readonly role: string;
}

/**
 * Idempotently link a Supabase auth principal to a vendor business.
 *
 * Guarantees:
 *   • never reassigns an auth principal to a different vendor (fails closed);
 *   • never overwrites an existing, differently-owned mapping;
 *   • never touches vendors.user_id;
 *   • never creates or stores a password;
 *   • never sets phone_verified / whatsapp_otp_enabled;
 *   • never changes paid or business-verification state.
 */
export async function linkVendorAuthUser(
  authorization: AdminVendorLinkAuthorization,
  input: LinkVendorAuthUserInput
): Promise<Result<VendorAccessContext>> {
  try {
    if (!authorization?.adminUserId) return fail(appError("UNAUTHORIZED"));
    if (!input.vendorId || !input.authUserId || !input.role) throw appError("VALIDATION");

    let phone: string | null = null;
    if (input.phone !== undefined && input.phone !== null && input.phone.trim() !== "") {
      const normalized = normalizePhoneE164(input.phone);
      if (!normalized.ok) throw vendorLinkError("VENDOR_LINK_INVALID_PHONE");
      phone = normalized.e164;
    }
    const email = input.email?.trim().toLowerCase() || null;

    const { data: vendor, error: vendorError } = await adminClient()
      .from("vendors")
      .select(VENDOR_IDENTITY_LOOKUP_COLUMNS)
      .eq("id", input.vendorId)
      .maybeSingle();
    if (vendorError) throw vendorError;
    if (!vendor) throw vendorLinkError("VENDOR_NOT_FOUND");

    // Does this auth principal already map somewhere?
    const { data: byUser, error: byUserError } = await adminClient()
      .from(VENDOR_DASHBOARD_USERS_TABLE)
      .select(MAPPING_COLUMNS)
      .eq("user_id", input.authUserId)
      .maybeSingle();
    if (byUserError) throw byUserError;

    const existingByUser = byUser as VendorDashboardUserRow | null;
    if (existingByUser) {
      if (existingByUser.vendor_id !== input.vendorId) {
        // Identity ownership is never reassigned. Fail safely.
        throw vendorLinkError("CROSS_VENDOR_LINK_CONFLICT");
      }
      return ok(toContext(existingByUser, input.authUserId));
    }

    // Does this vendor already have a mapping row?
    const { data: byVendor, error: byVendorError } = await adminClient()
      .from(VENDOR_DASHBOARD_USERS_TABLE)
      .select(MAPPING_COLUMNS)
      .eq("vendor_id", input.vendorId)
      .maybeSingle();
    if (byVendorError) throw byVendorError;

    const existingByVendor = byVendor as VendorDashboardUserRow | null;
    if (existingByVendor) {
      if (existingByVendor.user_id && existingByVendor.user_id !== input.authUserId) {
        throw vendorLinkError("CROSS_VENDOR_LINK_CONFLICT");
      }
      // Adopt an unclaimed mapping (user_id IS NULL) without touching any other column.
      const { data: adopted, error: adoptError } = await adminClient()
        .from(VENDOR_DASHBOARD_USERS_TABLE)
        .update({ user_id: input.authUserId, updated_at: new Date().toISOString() })
        .eq("id", existingByVendor.id as string)
        .is("user_id", null)
        .select(MAPPING_COLUMNS);

      if (adoptError) {
        if (isUniqueViolationError(adoptError)) throw vendorLinkError("CROSS_VENDOR_LINK_CONFLICT");
        throw adoptError;
      }
      const rows = (adopted ?? []) as VendorDashboardUserRow[];
      if (rows.length !== 1) throw vendorLinkError("CROSS_VENDOR_LINK_CONFLICT");
      return ok(toContext(rows[0], input.authUserId));
    }

    const { data: inserted, error: insertError } = await adminClient()
      .from(VENDOR_DASHBOARD_USERS_TABLE)
      .insert({
        vendor_id: input.vendorId,
        user_id: input.authUserId,
        phone,
        email,
        role: input.role,
        status: VENDOR_MEMBERSHIP_ACTIVE,
        // Never inferred: WhatsApp verification is Phase 5E, not a login artefact.
        phone_verified: false,
        whatsapp_otp_enabled: false,
        last_login_method: null,
        last_login_at: null,
      })
      .select(MAPPING_COLUMNS)
      .single();

    if (insertError) {
      // The partial unique index on (user_id) is the final authority.
      if (isUniqueViolationError(insertError)) throw vendorLinkError("CROSS_VENDOR_LINK_CONFLICT");
      throw insertError;
    }
    if (!inserted) throw vendorLinkError("VENDOR_LINK_FAILED");

    return ok(toContext(inserted as VendorDashboardUserRow, input.authUserId));
  } catch (e) {
    return fail(e);
  }
}

function toContext(row: VendorDashboardUserRow, authUserId: string): VendorAccessContext {
  return Object.freeze({
    authUserId,
    vendorDashboardUserId: row.id as string,
    vendorId: row.vendor_id as string,
    role: row.role as string,
    membershipStatus: row.status as string,
  });
}
