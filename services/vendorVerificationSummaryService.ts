import { adminClient } from "../lib/supabase";
import { fail, ok, type Result } from "../lib/errors";
import { requireVendorAccess } from "./vendorAccessService";

export type VendorContactVerificationSummary = {
  phoneE164: string | null;
  phoneVerified: boolean;
  whatsappOtpEnabled: boolean;
  whatsappVerifiedAt: string | null;
  verificationAvailable: boolean;
  verificationReadiness: string;
};

function e164Hint(value: string | null | undefined): string | null {
  const candidate = String(value ?? "").trim();
  return /^\+[1-9]\d{7,14}$/.test(candidate) ? candidate : null;
}

/**
 * Read-only V1 onboarding projection. Authentication authority remains
 * vendor_dashboard_users + the OTP challenge service; this function creates no
 * second verification state.
 */
export async function getCurrentVendorContactVerificationSummary():
  Promise<Result<VendorContactVerificationSummary>> {
  try {
    const access = await requireVendorAccess();
    if (!access.ok) return access;

    const db = adminClient();
    const [membershipRead, vendorRead, automationRead] = await Promise.all([
      db
        .from("vendor_dashboard_users")
        .select("phone, phone_verified, whatsapp_otp_enabled, whatsapp_verified_at")
        .eq("id", access.data.vendorDashboardUserId)
        .eq("vendor_id", access.data.vendorId)
        .maybeSingle(),
      db
        .from("vendors")
        .select("whatsapp_number, phone")
        .eq("id", access.data.vendorId)
        .maybeSingle(),
      db
        .from("communication_automation_catalog")
        .select("readiness_status, is_operationally_enabled, provider_required")
        .eq("automation_key", "vendor_whatsapp_verify")
        .maybeSingle(),
    ]);

    if (membershipRead.error) throw membershipRead.error;
    if (vendorRead.error) throw vendorRead.error;

    const membership = membershipRead.data as {
      phone?: string | null;
      phone_verified?: boolean | null;
      whatsapp_otp_enabled?: boolean | null;
      whatsapp_verified_at?: string | null;
    } | null;
    const vendor = vendorRead.data as { whatsapp_number?: string | null; phone?: string | null } | null;
    const automation = automationRead.error ? null : automationRead.data as {
      readiness_status?: string | null;
      is_operationally_enabled?: boolean | null;
      provider_required?: string | null;
    } | null;

    const operational = automation?.is_operationally_enabled === true;
    const readiness = String(automation?.readiness_status ?? "not_configured");

    return ok({
      phoneE164: membership?.phone || e164Hint(vendor?.whatsapp_number || vendor?.phone),
      phoneVerified: membership?.phone_verified === true,
      whatsappOtpEnabled: membership?.whatsapp_otp_enabled === true,
      whatsappVerifiedAt: membership?.whatsapp_verified_at ?? null,
      verificationAvailable: operational,
      verificationReadiness: readiness,
    });
  } catch (error) {
    return fail(error);
  }
}
