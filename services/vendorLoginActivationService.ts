// ============================================================================
// QuickFurno — services/vendorLoginActivationService.ts   (server-only)
//
// QF-MVP-80.02 GATE-06 — SUPERADMIN-ONLY "Activate vendor login".
//
// THE PROBLEM THIS EXISTS FOR
//   Approved vendors created through the admin/application path carry
//   `vendors.user_id = NULL` (services/vendorService.registerVendor writes
//   `user_id: input.user_id ?? null`). The vendor dashboard resolves the vendor
//   business from `vendors.user_id` (app/actions.getMyVendor /
//   requireVendorOwner) and RLS keys on it too, so such a vendor can be fully
//   eligible for assignments and credits yet unable to reach a dashboard.
//   The only existing writer of `vendors.user_id` is
//   app/actions.submitVendorAccountRegistration, which always creates a NEW
//   vendor row — so telling an approved vendor to "just sign up" DUPLICATES the
//   business instead of restoring access to it.
//
// WHAT THIS DOES
//   Given an EXISTING approved vendor id, it creates a Supabase Auth principal
//   for that vendor's stored email, claims the EXISTING vendor row for it with a
//   compare-and-swap, reuses the canonical vendor_dashboard_users linkage, and
//   hands back a single-use recovery link for the superadmin to deliver.
//
// WHAT IT MUST NEVER DO — each one is enforced below and tested:
//   • never create a vendor row (it holds no INSERT on `vendors`);
//   • never move an already-linked vendor (CAS requires user_id IS NULL);
//   • never adopt a pre-existing auth principal (that is a different authority
//     with different evidence requirements — it fails closed instead);
//   • never activate a vendor whose email is shared with another vendor row,
//     because auth.users.email is UNIQUE and a shared address cannot say which
//     business the login owns;
//   • never set, store, transmit, generate or default a password;
//   • never change status, verification, package, credit, activity or
//     visibility state;
//   • never touch assignment, matching, WhatsApp, Routes or the automatic
//     assignment mode.
//
// WHY THIS IS A SEPARATE MODULE FROM services/vendorAccessService.ts
//   Phase 5C fixes that file's boundary: it is the RESOLVER, and its harness
//   asserts it never reaches `adminClient().auth` — the property that keeps the
//   authentication path from ever minting or assuming a session with the
//   service role. Provisioning genuinely needs the Auth Admin API, so it lives
//   here instead of being smuggled in there behind a weakened assertion. The
//   linkage itself is NOT reimplemented: this module calls the canonical,
//   already-authorized `linkVendorAuthUser`, which derives its own authority.
// ============================================================================

import type { SupabaseClient } from "@supabase/supabase-js";

import { adminClient, serverClient } from "../lib/supabase";
import { AppError, appError, fail, ok, type Result } from "../lib/errors";
import { vendorPrincipalAppMetadata } from "../lib/identity/authPrincipalMarker";
import { normalizeStatus } from "../lib/vendors/vendorEligibility";
import { linkVendorAuthUser } from "./vendorAccessService";

/** The admin role this operation requires. Plain `admin` is NOT sufficient. */
export const SUPERADMIN_ADMIN_ROLE = "Superadmin";

/** Normalized account status a vendor must hold to be activated. */
export const ACTIVATABLE_VENDOR_STATUS = "approved";

/** Membership role written for the vendor's own login. */
export const VENDOR_LOGIN_OWNER_ROLE = "owner";

/** Columns this service reads from `vendors`. No business state beyond status. */
export const VENDOR_ACTIVATION_COLUMNS = "id, status, email, phone, owner_name, business_name, user_id";

/** Bounded directory scan: an unbounded one could silently miss a collision. */
export const AUTH_DIRECTORY_PAGE_SIZE = 200;
export const AUTH_DIRECTORY_MAX_PAGES = 50;

export const VendorLoginActivationError = {
  VENDOR_NOT_FOUND: "VENDOR_NOT_FOUND",
  VENDOR_NOT_APPROVED: "VENDOR_NOT_APPROVED",
  VENDOR_EMAIL_MISSING: "VENDOR_EMAIL_MISSING",
  /** Two or more vendor rows share this email. Fail closed; never pick one. */
  VENDOR_EMAIL_NOT_UNIQUE: "VENDOR_EMAIL_NOT_UNIQUE",
  /** An auth principal already holds this email. Adoption is not this authority. */
  AUTH_EMAIL_COLLISION: "AUTH_EMAIL_COLLISION",
  /** The auth directory could not be read completely — collisions unprovable. */
  AUTH_DIRECTORY_UNREADABLE: "AUTH_DIRECTORY_UNREADABLE",
  AUTH_USER_CREATE_FAILED: "AUTH_USER_CREATE_FAILED",
  /** The vendor row was claimed by someone else between read and write. */
  VENDOR_CLAIM_CONFLICT: "VENDOR_CLAIM_CONFLICT",
} as const;

export type VendorLoginActivationErrorCode =
  (typeof VendorLoginActivationError)[keyof typeof VendorLoginActivationError];

const ACTIVATION_MESSAGES: Record<string, string> = {
  VENDOR_NOT_FOUND: "Vendor not found.",
  VENDOR_NOT_APPROVED: "Only an approved vendor can be given a login.",
  VENDOR_EMAIL_MISSING: "This vendor has no stored email address to sign in with.",
  VENDOR_EMAIL_NOT_UNIQUE:
    "This email address is shared with another vendor record. Give each business its own address first.",
  AUTH_EMAIL_COLLISION:
    "An authentication account already uses this email address. Link it deliberately instead.",
  AUTH_DIRECTORY_UNREADABLE: "The authentication directory could not be read. Nothing was changed.",
  AUTH_USER_CREATE_FAILED: "The authentication account could not be created.",
  VENDOR_CLAIM_CONFLICT: "This vendor was linked by someone else. Nothing was changed.",
};

function activationError(code: VendorLoginActivationErrorCode): AppError {
  return new AppError(code, ACTIVATION_MESSAGES[code]);
}

/** The `vendors` columns this service reads. */
interface VendorActivationRow {
  id: string | null;
  status: string | null;
  email: string | null;
  phone: string | null;
  owner_name: string | null;
  business_name: string | null;
  user_id: string | null;
}

export interface ActivateVendorLoginInput {
  /** The operation's TARGET. Never the source of authority to perform it. */
  readonly vendorId: string;
}

/**
 * Sanitized outcome. Carries no password, no service credential, no session and
 * no vendor business state — only what the operator must see to hand over.
 */
export interface VendorLoginActivation {
  readonly vendorId: string;
  readonly authUserId: string;
  /** True when the vendor already had a login; nothing was created or changed. */
  readonly alreadyActive: boolean;
  readonly dashboardMappingLinked: boolean;
  /** Single-use Supabase recovery link. Show once, never log, never store. */
  readonly recoveryLink: string | null;
  readonly recoveryLinkIssued: boolean;
}

/**
 * Establish SUPERADMIN authority from the CURRENT request-scoped session.
 *
 * PRIVATE BY DESIGN, for the same reason as the Phase 5C admin guard: an
 * authorization value passed as an argument is a claim, never a proof. Both
 * facts are read from the Supabase-validated session — `profiles.role` for
 * admin, and `app_metadata.admin_role` for Superadmin. `app_metadata` is
 * writable only by the service role, so a user cannot self-promote through it.
 */
async function requireSuperadminSession(): Promise<Result<string>> {
  try {
    const sb = await serverClient();
    const { data, error } = await sb.auth.getUser();
    if (error || !data?.user?.id) return fail(appError("UNAUTHORIZED"));

    const { data: profile, error: profileError } = await sb
      .from("profiles")
      .select("role")
      .eq("id", data.user.id)
      .maybeSingle();

    if (profileError) return fail(appError("UNAUTHORIZED"));
    if ((profile as { role?: string } | null)?.role !== "admin") return fail(appError("UNAUTHORIZED"));

    const adminRole = (data.user.app_metadata as { admin_role?: unknown } | null | undefined)?.admin_role;
    if (adminRole !== SUPERADMIN_ADMIN_ROLE) return fail(appError("UNAUTHORIZED"));

    return ok(data.user.id);
  } catch {
    return fail(appError("UNAUTHORIZED"));
  }
}

/**
 * Give an EXISTING approved vendor a login, without creating a second vendor.
 *
 * Authorization is established internally; `input.vendorId` names the target and
 * confers no authority. Replay-safe: an already-linked vendor returns
 * `alreadyActive` without creating an auth user or writing anything.
 */
export async function activateVendorLogin(
  input: ActivateVendorLoginInput
): Promise<Result<VendorLoginActivation>> {
  const superadmin = await requireSuperadminSession();
  if (!superadmin.ok) return superadmin;
  return performVendorLoginActivation(input);
}

/**
 * The provisioning write. Private: reachable only after
 * `requireSuperadminSession()` has proven superadmin authority.
 */
async function performVendorLoginActivation(
  input: ActivateVendorLoginInput
): Promise<Result<VendorLoginActivation>> {
  // Set only between "auth user created" and "vendor row claimed". While it is
  // set, ANY failure must delete that user again, so a failed activation leaves
  // no orphan principal behind.
  let uncommittedAuthUserId: string | null = null;

  try {
    const vendorId = typeof input?.vendorId === "string" ? input.vendorId.trim() : "";
    if (!vendorId) throw appError("VALIDATION");

    const db = adminClient();

    const { data: vendorData, error: vendorError } = await db
      .from("vendors")
      .select(VENDOR_ACTIVATION_COLUMNS)
      .eq("id", vendorId)
      .maybeSingle();
    if (vendorError) throw vendorError;
    if (!vendorData) throw activationError("VENDOR_NOT_FOUND");
    const vendor = vendorData as VendorActivationRow;

    if (normalizeStatus(vendor.status) !== ACTIVATABLE_VENDOR_STATUS) {
      throw activationError("VENDOR_NOT_APPROVED");
    }

    // REPLAY. An already-linked vendor is a safe no-op, never a second account.
    if (vendor.user_id) {
      return ok({
        vendorId,
        authUserId: vendor.user_id,
        alreadyActive: true,
        dashboardMappingLinked: await hasDashboardMapping(db, vendorId, vendor.user_id),
        recoveryLink: null,
        recoveryLinkIssued: false,
      });
    }

    const email = vendor.email?.trim().toLowerCase() || "";
    if (!email) throw activationError("VENDOR_EMAIL_MISSING");

    // auth.users.email is UNIQUE, so a shared business email cannot identify
    // which vendor owns the login. Refuse rather than choose a winner.
    const { data: sharing, error: sharingError } = await db
      .from("vendors")
      .select("id")
      .ilike("email", email)
      .limit(2);
    if (sharingError) throw sharingError;
    if ((sharing ?? []).length !== 1) throw activationError("VENDOR_EMAIL_NOT_UNIQUE");

    const directory = await findAuthUserIdByEmail(db, email);
    if (!directory.readable) throw activationError("AUTH_DIRECTORY_UNREADABLE");
    if (directory.authUserId) throw activationError("AUTH_EMAIL_COLLISION");

    // No `password` argument: the account is deliberately unusable until the
    // vendor sets their own through the recovery link below. The trusted vendor
    // classification travels in app_metadata, which only the service-role Admin
    // API can set; public.handle_new_user reads that key and nothing else.
    const { data: created, error: createError } = await db.auth.admin.createUser({
      email,
      email_confirm: true,
      app_metadata: vendorPrincipalAppMetadata(),
      user_metadata: { full_name: vendor.owner_name || vendor.business_name || null },
    });
    if (createError || !created?.user?.id) throw activationError("AUTH_USER_CREATE_FAILED");
    uncommittedAuthUserId = created.user.id;

    // COMPARE-AND-SWAP. `user_id IS NULL` is the whole safety property: it
    // claims an unowned vendor and can never move an owned one. Exactly one
    // affected row, or this is a conflict and the auth user is rolled back.
    const { data: claimed, error: claimError } = await db
      .from("vendors")
      .update({ user_id: uncommittedAuthUserId })
      .eq("id", vendorId)
      .is("user_id", null)
      .select("id, user_id");
    if (claimError) throw activationError("VENDOR_CLAIM_CONFLICT");
    if ((claimed ?? []).length !== 1) throw activationError("VENDOR_CLAIM_CONFLICT");

    // The canonical Phase 5C linkage, called through its PUBLIC entry point so
    // it re-derives its own admin authority. Reported, never silently assumed:
    // the dashboard already works off vendors.user_id, and rolling the claim
    // back over a secondary mapping would be the more dangerous failure.
    const mapping = await linkVendorAuthUser({
      vendorId,
      authUserId: uncommittedAuthUserId,
      email,
      phone: vendor.phone,
      role: VENDOR_LOGIN_OWNER_ROLE,
    });

    const recoveryLink = await issueRecoveryLink(db, email);

    // Committed. Past this point a failure must NOT delete the linked account.
    const authUserId = uncommittedAuthUserId;
    uncommittedAuthUserId = null;

    return ok({
      vendorId,
      authUserId,
      alreadyActive: false,
      dashboardMappingLinked: mapping.ok,
      recoveryLink,
      recoveryLinkIssued: recoveryLink !== null,
    });
  } catch (e) {
    if (uncommittedAuthUserId) await rollbackAuthUser(uncommittedAuthUserId);
    return fail(e);
  }
}

/**
 * Find an auth principal by email across a BOUNDED page scan.
 *
 * An exhausted page budget returns `readable: false`, not "no collision found":
 * treating an incomplete scan as proof of absence is exactly how a duplicate
 * identity would slip through.
 */
async function findAuthUserIdByEmail(
  db: SupabaseClient,
  email: string
): Promise<{ readable: boolean; authUserId: string | null }> {
  let page = 1;
  while (page <= AUTH_DIRECTORY_MAX_PAGES) {
    const { data, error } = await db.auth.admin.listUsers({
      page,
      perPage: AUTH_DIRECTORY_PAGE_SIZE,
    });
    if (error || !data) return { readable: false, authUserId: null };

    const users = data.users ?? [];
    const hit = users.find((u) => String(u?.email ?? "").trim().toLowerCase() === email);
    if (hit?.id) return { readable: true, authUserId: hit.id };
    if (users.length < AUTH_DIRECTORY_PAGE_SIZE) return { readable: true, authUserId: null };
    page += 1;
  }
  return { readable: false, authUserId: null };
}

/** Does the canonical mapping row already exist for this pair? Read-only. */
async function hasDashboardMapping(
  db: SupabaseClient,
  vendorId: string,
  authUserId: string
): Promise<boolean> {
  try {
    const { data, error } = await db
      .from("vendor_dashboard_users")
      .select("id")
      .eq("vendor_id", vendorId)
      .eq("user_id", authUserId)
      .limit(1);
    if (error) return false;
    return (data ?? []).length === 1;
  } catch {
    return false;
  }
}

/**
 * Ask Supabase Auth for a single-use recovery link.
 *
 * This is a HANDOVER mechanism, not a password: QuickFurno never invents,
 * stores or transmits one. Failure is non-fatal — the account and the link are
 * already correct, and the operator can re-issue.
 */
async function issueRecoveryLink(db: SupabaseClient, email: string): Promise<string | null> {
  try {
    const { data, error } = await db.auth.admin.generateLink({ type: "recovery", email });
    if (error || !data) return null;
    const link = (data as { properties?: { action_link?: unknown } }).properties?.action_link;
    return typeof link === "string" && link.length > 0 ? link : null;
  } catch {
    return null;
  }
}

/** Compensating delete for an auth user created before a failed vendor claim. */
async function rollbackAuthUser(authUserId: string): Promise<void> {
  try {
    await adminClient().auth.admin.deleteUser(authUserId);
  } catch {
    // Swallowed on purpose: the activation already failed and is reported as
    // such. Masking that failure with the rollback's own error would be worse.
  }
}
