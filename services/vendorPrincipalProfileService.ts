// ============================================================================
// QuickFurno — services/vendorPrincipalProfileService.ts   (server-only)
//
// QF-MVP-80.02 GATE-06 REPAIR — establish `profiles.role = 'vendor'` for an
// auth principal the SERVER just created as a vendor.
//
// THE DEFECT THIS CLOSES
//   `public.handle_new_user` (migration 20260723000700) classifies a new auth
//   user ONLY from `new.raw_app_meta_data ->> 'qf_principal'`, and yields a
//   NEUTRAL null role for anything else. That is the correct rule. But the
//   Supabase Auth Admin API applies custom `app_metadata` in a step separate
//   from the INSERT that fires the AFTER INSERT trigger, so a user created via
//   `auth.admin.createUser({ app_metadata: { qf_principal: "vendor" } })` is
//   seen by the trigger WITHOUT the marker and lands with `role = NULL` —
//   even though the finished row carries `qf_principal: "vendor"`.
//
//   Consequence: `getMyRole()` returns null, and app/vendor/dashboard/layout.tsx
//   redirects the vendor straight back to the login page. The account exists,
//   the password works, and the dashboard is still unreachable.
//
//   Proven in production on 2026-08-30: auth user 6b7c8b16 carries
//   qf_principal=vendor and profiles.role=NULL, while the three vendors created
//   before the trigger landed (2026-07-02..07-05) carry role='vendor' from the
//   OLD trigger's default. This affects BOTH callers of that pattern — Gate-06
//   activation and app/actions.submitVendorAccountRegistration (public vendor
//   signup) — so both use this one helper.
//
// WHY HERE AND NOT IN THE TRIGGER
//   The trigger's rule is right and is the security boundary: it can never
//   produce 'admin'. Changing it to trust a later-arriving value would weaken
//   the classification for every principal type. The narrower, honest fix is
//   for the server that KNOWS it just created a vendor to say so explicitly.
//
// GUARANTEES
//   • writes the literal 'vendor' and nothing else — no role value is ever
//     taken from an argument, so 'admin'/'Superadmin' are unreachable;
//   • never overwrites a non-null role — a conflicting role FAILS CLOSED;
//   • the update is a compare-and-swap on `role IS NULL`, so a role assigned
//     concurrently is never clobbered;
//   • touches no other profile column and no vendor business state.
// ============================================================================

import { adminClient } from "../lib/supabase";
import { AppError, appError, fail, ok, type Result } from "../lib/errors";

export const PROFILES_TABLE = "profiles";

/** The ONLY role literal this module may write. */
export const VENDOR_PRINCIPAL_ROLE = "vendor";

export const VendorPrincipalProfileError = {
  PROFILE_NOT_FOUND: "PROFILE_NOT_FOUND",
  /** The profile already holds a different, non-null role. Never overwritten. */
  PROFILE_ROLE_CONFLICT: "PROFILE_ROLE_CONFLICT",
  PROFILE_ROLE_WRITE_FAILED: "PROFILE_ROLE_WRITE_FAILED",
} as const;

export type VendorPrincipalProfileErrorCode =
  (typeof VendorPrincipalProfileError)[keyof typeof VendorPrincipalProfileError];

const MESSAGES: Record<string, string> = {
  PROFILE_NOT_FOUND: "No profile exists for this authentication account.",
  PROFILE_ROLE_CONFLICT: "This account already holds a different role and was left unchanged.",
  PROFILE_ROLE_WRITE_FAILED: "The vendor role could not be written.",
};

function profileError(code: VendorPrincipalProfileErrorCode): AppError {
  return new AppError(code, MESSAGES[code]);
}

/** What the assertion had to do. Useful evidence; carries no secret. */
export const VendorPrincipalProfileOutcome = {
  /** Already correct — no write was performed. */
  ALREADY_VENDOR: "ALREADY_VENDOR",
  /** The neutral null role was upgraded to 'vendor'. */
  ROLE_ASSIGNED: "ROLE_ASSIGNED",
} as const;

export type VendorPrincipalProfileOutcomeValue =
  (typeof VendorPrincipalProfileOutcome)[keyof typeof VendorPrincipalProfileOutcome];

export interface VendorPrincipalProfile {
  readonly authUserId: string;
  readonly role: string;
  readonly outcome: VendorPrincipalProfileOutcomeValue;
}

/**
 * Ensure the given auth principal's profile carries the vendor role.
 *
 * SERVER-ONLY and PRIVILEGED: it uses the service-role client because the
 * caller has already established its own authority (a superadmin session for
 * Gate-06 activation, or the server's own registration flow). It takes only an
 * auth user id — there is no role parameter to forge.
 */
export async function ensureVendorPrincipalProfile(
  authUserId: string
): Promise<Result<VendorPrincipalProfile>> {
  try {
    const id = typeof authUserId === "string" ? authUserId.trim() : "";
    if (!id) throw appError("VALIDATION");

    const db = adminClient();

    const { data, error } = await db
      .from(PROFILES_TABLE)
      .select("id, role")
      .eq("id", id)
      .maybeSingle();
    if (error) throw error;
    if (!data) throw profileError("PROFILE_NOT_FOUND");

    const current = (data as { role?: unknown }).role;
    const role = typeof current === "string" ? current.trim() : "";

    if (role === VENDOR_PRINCIPAL_ROLE) {
      return ok({ authUserId: id, role: VENDOR_PRINCIPAL_ROLE, outcome: VendorPrincipalProfileOutcome.ALREADY_VENDOR });
    }
    // Any other non-empty role — 'admin' above all — is left exactly as it is.
    if (role !== "") throw profileError("PROFILE_ROLE_CONFLICT");

    // Compare-and-swap on the NULL role. If something assigned a role between
    // the read and this write, zero rows are affected and we fail closed rather
    // than overwrite it.
    const { data: updated, error: updateError } = await db
      .from(PROFILES_TABLE)
      .update({ role: VENDOR_PRINCIPAL_ROLE })
      .eq("id", id)
      .is("role", null)
      .select("id, role");
    if (updateError) throw profileError("PROFILE_ROLE_WRITE_FAILED");
    if ((updated ?? []).length !== 1) throw profileError("PROFILE_ROLE_CONFLICT");

    return ok({ authUserId: id, role: VENDOR_PRINCIPAL_ROLE, outcome: VendorPrincipalProfileOutcome.ROLE_ASSIGNED });
  } catch (e) {
    return fail(e);
  }
}
