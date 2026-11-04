/**
 * Verified vendor registration ownership reconciliation (PURE, no I/O).
 *
 * Call ONLY after Supabase Auth and the protected vendor WhatsApp delivery
 * ledger establish the signed user, confirmed phone and fresh OTP admission.
 * The evidence and all three DB result sets must be loaded by the SERVER.
 *
 * This does NOT create vendors, issue memberships, promote roles or activate
 * leads. It prevents "retry signup" from silently becoming "second business".
 */
import { decideVerifiedVendorSignup, type VerifiedVendorSignupEvidence } from "./vendorVerifiedSignupDecision";

export interface VendorOwnershipRow {
  readonly id: string;
  readonly user_id: string | null;
  readonly phone: string | null;
}
export interface VendorDashboardOwnershipRow {
  readonly vendor_id: string;
  readonly user_id: string | null;
  readonly role: string | null;
  readonly status: string | null;
}
export interface VendorOwnershipSnapshot {
  /** null is a failed/unperformed lookup, NEVER an empty result. */
  readonly vendorsByAuthUser: readonly VendorOwnershipRow[] | null;
  readonly vendorsByMobile: readonly VendorOwnershipRow[] | null;
  readonly dashboardByAuthUser: readonly VendorDashboardOwnershipRow[] | null;
}

export type VendorOwnershipResolution =
  | { readonly kind: "create_pending"; readonly authUserId: string; readonly mobile10: string }
  | { readonly kind: "resume_existing"; readonly vendorId: string }
  | { readonly kind: "owner_repair_required"; readonly vendorId: string; readonly reason: "missing_membership" | "inactive_membership" | "missing_vendor_profile" }
  | { readonly kind: "deny"; readonly reason: "unverified" | "lookup_unavailable" | "ambiguous_rows" | "phone_owned_elsewhere" | "ownership_conflict" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MOBILE = /^[6-9]\d{9}$/;

export function reconcileVerifiedVendorOwnership(
  proof: VerifiedVendorSignupEvidence,
  snapshot: VendorOwnershipSnapshot,
): VendorOwnershipResolution {
  // This decision is not Auth; it is the final policy check on already proven
  // server evidence. An unknown or denied OTP admission always denies.
  const decision = decideVerifiedVendorSignup(proof);
  if (decision.kind === "deny") return { kind: "deny", reason: "unverified" };

  const byUser = snapshot?.vendorsByAuthUser;
  const byMobile = snapshot?.vendorsByMobile;
  const mapped = snapshot?.dashboardByAuthUser;
  if (!Array.isArray(byUser) || !Array.isArray(byMobile) || !Array.isArray(mapped))
    return { kind: "deny", reason: "lookup_unavailable" };
  // Never let a .limit(2) read pick an arbitrary "first match".
  if (byUser.length > 1 || byMobile.length > 1 || mapped.length > 1)
    return { kind: "deny", reason: "ambiguous_rows" };

  const userId = proof.authUserId;
  const mobile = proof.authPhoneE164.slice(3);
  if (!UUID.test(userId) || !MOBILE.test(mobile))
    return { kind: "deny", reason: "unverified" };

  const userVendor = byUser[0] ?? null;
  const phoneVendor = byMobile[0] ?? null;
  const member = mapped[0] ?? null;

  // A phone number is never sufficient to adopt a vendor claimed by another
  // principal — including a legacy row with user_id = NULL.
  if (phoneVendor && (phoneVendor.user_id !== userId ||
      !UUID.test(phoneVendor.id) || phoneVendor.phone !== mobile)) {
    return { kind: "deny", reason: "phone_owned_elsewhere" };
  }
  if (userVendor && (!UUID.test(userVendor.id) || userVendor.user_id !== userId ||
      userVendor.phone !== mobile || phoneVendor?.id !== userVendor.id)) {
    return { kind: "deny", reason: "ownership_conflict" };
  }
  if (member && (member.user_id !== userId || !UUID.test(member.vendor_id) ||
      (member.role ?? "").trim().toLowerCase() !== "owner")) {
    return { kind: "deny", reason: "ownership_conflict" };
  }

  if (decision.kind === "create_pending") {
    // Evidence lookup must agree with the earlier decision. A missing row in
    // one lookup must never turn an existing link into a new registration.
    if (userVendor || phoneVendor || member)
      return { kind: "deny", reason: "ownership_conflict" };
    return decision;
  }

  // Existing vendor must be the identical business in every authority.
  if (!userVendor || !phoneVendor || userVendor.id !== decision.vendorId ||
      phoneVendor.id !== decision.vendorId ||
      (member && member.vendor_id !== decision.vendorId)) {
    return { kind: "deny", reason: "ownership_conflict" };
  }
  // No public retry can repair or reactivate a membership. Owner-only repair
  // reuses existing Core provisioning and must separately audit authority.
  // Auth may already be linked to the business while profiles.role remains
  // neutral because of historical GoTrue trigger ordering. Never advertise a
  // usable dashboard until Owner-only role repair has completed.
  if ((proof.existingProfileRole ?? "").trim().toLowerCase() !== "vendor")
    return { kind: "owner_repair_required", vendorId: decision.vendorId, reason: "missing_vendor_profile" };
  if (!member) return { kind: "owner_repair_required", vendorId: decision.vendorId, reason: "missing_membership" };
  if (member.status !== "active")
    return { kind: "owner_repair_required", vendorId: decision.vendorId, reason: "inactive_membership" };
  return { kind: "resume_existing", vendorId: decision.vendorId };
}
