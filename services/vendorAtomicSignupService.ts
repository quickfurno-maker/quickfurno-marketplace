/**
 * Server-only pending vendor enrollment adapter. No public route and no default
 * provider activation. Reuses the verified Supabase Auth OTP controller and
 * one atomic, service-role PostgreSQL RPC for all three account records.
 *
 * This routine NEVER trusts caller-supplied Auth identity, provider, payment,
 * activation, coordinates or role, and does not expose the service-role client.
 * A failed RPC changes no business state; a retry returns the same vendor id.
 */
import "server-only";
import { adminClient, serverClient } from "../lib/supabase";
import { hashPhoneE164 } from "../lib/communication/phone";
import { VENDOR_REGISTRATION_PRIVACY_REVISION, hasVendorRegistrationConsent, isValidOptionalGstin, normalizeOptionalGstin } from "../lib/vendors/vendorSignupPolicy";
import { normalizeVerifiedVendorMobile } from "../lib/vendors/vendorContactContract";
import { resolveActiveCity } from "../lib/locations/cityService";
import { readClaimedVendorOtpPurpose } from "./authOtpPurposeReservationService";
import { verifyVendorSignupWhatsappOtp, type TrustedVendorOtpRuntime, type VendorSignupOtpVerificationInput } from "./vendorSignupOtpVerificationService";
import type { VendorRegistrationInput } from "../lib/types";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VALID_OUTCOMES = new Set(["created_pending", "resume_existing", "owner_repair_required"]);
export const VENDOR_ENROLLMENT_UNAVAILABLE = "VENDOR_ENROLLMENT_UNAVAILABLE";

export type VendorAtomicEnrollmentResult =
  | { readonly ok: true; readonly outcome: "created_pending" | "resume_existing"; readonly vendorId: string }
  | { readonly ok: false; readonly code: typeof VENDOR_ENROLLMENT_UNAVAILABLE | "OWNER_REPAIR_REQUIRED" };

/**
 * OTP verification and database enrollment happen in the SAME request. The
 * trusted runtime provider must be resolved by a server-only policy adapter;
 * its safe default denies. There is no login or account creation shortcut.
 */
export async function enrollPendingVendorAfterWhatsappOtp(
  otpInput: VendorSignupOtpVerificationInput,
  form: VendorRegistrationInput,
  runtime: TrustedVendorOtpRuntime = { resolveApprovedProvider: async () => null },
): Promise<VendorAtomicEnrollmentResult> {
  const unavailable: VendorAtomicEnrollmentResult = { ok: false, code: VENDOR_ENROLLMENT_UNAVAILABLE };
  try {
    if (process.env.QF_VENDOR_ATOMIC_SIGNUP_MODE !== "staging") return unavailable;
    if (!hasVendorRegistrationConsent(form?.registration_consent_accepted) ||
        !isValidOptionalGstin(form.gst_number)) return unavailable;

    const verified = await verifyVendorSignupWhatsappOtp(otpInput, runtime);
    if (!verified.ok) return unavailable;
    if (verified.decision.kind === "owner_repair_required")
      return { ok: false, code: "OWNER_REPAIR_REQUIRED" };

    const mobile10 = normalizeVerifiedVendorMobile(form.phone);
    if (!mobile10 || mobile10 !== verified.mobile10 ||
        (form.whatsapp_number && normalizeVerifiedVendorMobile(form.whatsapp_number) !== mobile10)) {
      return unavailable;
    }
    const city = await resolveActiveCity(form.city);
    if (!city || !Array.isArray(form.service_categories) ||
        !form.service_categories.length || form.service_categories.length > 20) return unavailable;

    const sb = await serverClient();
    const { data: current, error: authError } = await sb.auth.getUser();
    if (authError || !current?.user || current.user.id !== verified.authUserId ||
        current.user.phone !== "+91" + mobile10 || !current.user.phone_confirmed_at) return unavailable;

    const phoneE164 = "+91" + mobile10;
    const claim = await readClaimedVendorOtpPurpose(phoneE164, current.user.id);
    if (!claim || claim.authUserId !== verified.authUserId) return unavailable;
    // Never source this key from the browser or from an unverified message row.
    const provider = await runtime.resolveApprovedProvider();
    if (!provider || !provider.trim() ||
        ["mock","fake","test","local","development"].includes(provider.trim().toLowerCase()))
      return unavailable;

    // The SQL RPC re-checks the signed private claim, auth.users verified phone,
    // destination hash, provider-bound WhatsApp delivery and every ownership
    // conflict UNDER LOCK. JSONB fields are strictly allowlisted in SQL.
    const payload = {
      phone: mobile10,
      whatsapp_number: mobile10,
      business_name: form.business_name,
      owner_name: form.owner_name,
      city: city.name,
      service_categories: form.service_categories,
      email: form.email || null,
      gst_number: normalizeOptionalGstin(form.gst_number) || null,
      google_place_id: form.google_place_id,
      formatted_address: form.formatted_address,
      office_address_line1: form.office_address_line1,
      office_state: form.office_state,
      registration_consent_accepted: true,
      registration_consent_version: VENDOR_REGISTRATION_PRIVACY_REVISION,
    };
    const { data, error } = await adminClient().rpc("qf_register_pending_vendor_atomic", {
      p_auth_user_id: verified.authUserId,
      p_phone_digest: claim.phoneDigest,
      p_destination_hash: hashPhoneE164(phoneE164),
      p_provider_key: provider,
      p_registration: payload,
    });
    if (error) return unavailable;
    const rows = Array.isArray(data) ? data : data ? [data] : [];
    if (rows.length !== 1) return unavailable;
    const row = rows[0] as Record<string, unknown>;
    const outcome = row.outcome;
    const vendorId = row.vendor_id;
    if (outcome === "owner_repair_required") return { ok: false, code: "OWNER_REPAIR_REQUIRED" };
    if (!VALID_OUTCOMES.has(String(outcome)) || !UUID.test(String(vendorId)) ||
        (outcome !== "created_pending" && outcome !== "resume_existing")) return unavailable;
    if (verified.decision.kind === "resume_existing" &&
        (outcome !== "resume_existing" || verified.decision.vendorId !== vendorId)) return unavailable;
    if (verified.decision.kind === "create_pending" && outcome !== "created_pending" && outcome !== "resume_existing")
      return unavailable;
    return { ok: true, outcome, vendorId: String(vendorId) };
  } catch {
    return unavailable;
  }
}
