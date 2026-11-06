/**
 * Post-OTP vendor dashboard admission. No database, Auth, provider or cookies.
 * Caller must establish Supabase Auth and signed vendor WhatsApp delivery first.
 * This pure check never upgrades the underlying vendor's business/verification state.
 */
import type { VendorOwnershipResolution } from "./vendorSignupOwnershipReconciliation";
import type { VendorAccessResolution } from "../identity/vendorAccess";

export type ReturningVendorAdmission =
  | { readonly ok: true; readonly vendorId: string; readonly authUserId: string }
  | { readonly ok: false };

const CLOSED: ReturningVendorAdmission = Object.freeze({ ok: false });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function authorizeReturningVendorSession(input: {
  verifiedAuthUserId: string;
  verifiedPhoneE164: string;
  otpDecision: VendorOwnershipResolution;
  vendorAccess: VendorAccessResolution;
}): ReturningVendorAdmission {
  if (!input || !UUID.test(input.verifiedAuthUserId) ||
    !/^\+91[6-9]\d{9}$/.test(input.verifiedPhoneE164)) return CLOSED;
  if (input.otpDecision?.kind !== "resume_existing" ||
    !UUID.test(input.otpDecision.vendorId) ||
    !input.vendorAccess?.ok) return CLOSED;

  const c = input.vendorAccess.context;
  if (c.authUserId !== input.verifiedAuthUserId ||
    c.vendorId !== input.otpDecision.vendorId ||
    !UUID.test(c.vendorDashboardUserId) ||
    c.membershipStatus !== "active" ||
    c.role !== "owner") return CLOSED;
  return { ok: true, vendorId: c.vendorId, authUserId: c.authUserId };
}

/**
 * Pre-send eligibility. Only a currently linked owner may be sent a returning
 * vendor OTP. No inactive business check: Pending businesses may access status.
 * NULL/unavailable/duplicated reads deny. Never expose this boolean to callers.
 */
export function maySendReturningVendorOtp(input: {
  mobile10: string;
  vendors: readonly { id: string; user_id: string | null; phone: string | null }[] | null;
  memberships: readonly {
    id: string; user_id: string | null; vendor_id: string | null;
    role: string | null; status: string | null;
  }[] | null;
  profile: { role: string | null } | null;
  clientAccounts: readonly unknown[] | null;
}): boolean {
  if (!input || !/^[6-9][0-9]{9}$/.test(input.mobile10) ||
    !Array.isArray(input.vendors) || input.vendors.length !== 1 ||
    !Array.isArray(input.memberships) || input.memberships.length !== 1 ||
    !Array.isArray(input.clientAccounts) || input.clientAccounts.length !== 0 ||
    input.profile?.role !== "vendor") return false;
  const v = input.vendors[0];
  const m = input.memberships[0];
  return Boolean(UUID.test(v.id) && v.phone === input.mobile10 &&
    v.user_id && UUID.test(v.user_id) && UUID.test(m.id) &&
    m.user_id === v.user_id && m.vendor_id === v.id &&
    m.role === "owner" && m.status === "active");
}
