/**
 * Pure fail-closed registration decision after the existing vendor OTP
 * admission guard validates signed Supabase identity and server-side WhatsApp
 * delivery evidence. Inputs MUST be loaded by a trusted server controller;
 * public form values can never establish role, Auth ownership or admission.
 *
 * No DB insert, role mutation, Auth creation, provider send or credit change.
 */
export interface VerifiedVendorSignupEvidence {
  readonly authUserId: string;
  readonly authPhoneE164: string;
  readonly submittedMobile: string;
  readonly phoneConfirmedAt: string | null;
  readonly serverOtpAdmission: "admitted" | "denied" | null;
  readonly existingClientAccount: boolean | null;
  readonly existingProfileRole: string | null;
  /** undefined = lookup not completed (deny); null = definitely unlinked. */
  readonly existingVendorLink: {
    readonly authUserId: string;
    readonly vendorId: string;
    readonly phone: string;
  } | null | undefined;
}
export type VerifiedVendorSignupDecision =
  | { readonly kind: "create_pending"; readonly authUserId: string; readonly mobile10: string }
  | { readonly kind: "resume_existing"; readonly vendorId: string }
  | { readonly kind: "deny"; readonly reason: "identity" | "phone" | "client_conflict" | "role_conflict" | "link_unknown" | "link_conflict" };

const E164 = /^\+91[6-9]\d{9}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function normalizedMobile10(raw: string): string | null {
  const phone = raw.startsWith("+91") ? raw.slice(3) : raw;
  return /^[6-9]\d{9}$/.test(phone) ? phone : null;
}

/** One verified Auth identity = at most one in-progress vendor registration. */
export function decideVerifiedVendorSignup(
  proof: VerifiedVendorSignupEvidence
): VerifiedVendorSignupDecision {
  if (!UUID.test(proof.authUserId) || !E164.test(proof.authPhoneE164) ||
      proof.serverOtpAdmission !== "admitted" ||
      !proof.phoneConfirmedAt || !Number.isFinite(Date.parse(proof.phoneConfirmedAt))) {
    return { kind: "deny", reason: "identity" };
  }
  const mobile = normalizedMobile10(proof.submittedMobile ?? "");
  if (!mobile || proof.authPhoneE164 !== "+91" + mobile) {
    return { kind: "deny", reason: "phone" };
  }
  if (proof.existingClientAccount !== false) {
    return { kind: "deny", reason: "client_conflict" };
  }
  const role = proof.existingProfileRole?.trim().toLowerCase() || null;
  if (role !== null && role !== "vendor") {
    return { kind: "deny", reason: "role_conflict" };
  }
  if (proof.existingVendorLink === undefined) {
    return { kind: "deny", reason: "link_unknown" };
  }
  const existing = proof.existingVendorLink;
  if (existing !== null) {
    if (!UUID.test(existing.vendorId) || existing.authUserId !== proof.authUserId ||
        normalizedMobile10(existing.phone) !== mobile) {
      return { kind: "deny", reason: "link_conflict" };
    }
    // Resume/status retrieval only; caller may NOT insert another vendor row.
    return { kind: "resume_existing", vendorId: existing.vendorId };
  }
  return { kind: "create_pending", authUserId: proof.authUserId, mobile10: mobile };
}
