/**
 * Returning vendor WhatsApp authentication. Reuses ONLY the registered Auth OTP
 * session, fresh signed purpose/delivery evidence, existing vendor ownership
 * reconciliation and the canonical active dashboard membership resolver.
 *
 * No vendor creation or role promotion. A Pending vendor business can log in
 * when its owner membership is active; no leads/credits/approval are granted.
 */
import "server-only";
import { adminClient, serverClient } from "../lib/supabase";
import { authorizeReturningVendorSession, maySendReturningVendorOtp } from "../lib/vendors/vendorReturningLoginPolicy";
import { normalizeVerifiedVendorMobile } from "../lib/vendors/vendorContactContract";
import { invalidateLocalSession } from "../lib/identity/sessionInvalidation";
import { verifyVendorSignupWhatsappOtp } from "./vendorSignupOtpVerificationService";
import { resolveVendorAccess } from "./vendorAccessService";
import { recordAuthSecurityEvent } from "./authSecurityEventService";
import { AuthSecurityEventType } from "../lib/identity/authSecurityEvent";
import { PrincipalType } from "../lib/identity/principal";

/**
 * Service-role preflight is intentionally NOT a public account-existence API.
 * Rejects unknown, duplicated, suspended and non-vendor phones BEFORE asking
 * Supabase to send a chargeable WhatsApp OTP. The route always responds 202.
 */
export async function eligibleReturningVendorPhone(mobile: string): Promise<boolean> {
  if (!vendorWhatsappReturningModeEnabled()) return false;
  const mobile10 = normalizeVerifiedVendorMobile(mobile);
  if (!mobile10) return false;
  try {
    const db = adminClient();
    const {data:vendors,error:vendorError} = await db.from("vendors")
      .select("id,user_id,phone").eq("phone",mobile10).limit(2);
    if (vendorError || !Array.isArray(vendors) || vendors.length !== 1 ||
      typeof vendors[0].user_id !== "string") return false;
    const userId: string = vendors[0].user_id;
    const [memberships,profile,clients] = await Promise.all([
      db.from("vendor_dashboard_users")
        .select("id,user_id,vendor_id,role,status").eq("user_id",userId).limit(2),
      db.from("profiles").select("role").eq("id",userId).maybeSingle(),
      db.from("client_accounts").select("id").eq("user_id",userId).limit(2),
    ]);
    if (memberships.error || profile.error || clients.error) return false;
    return maySendReturningVendorOtp({
      mobile10, vendors,
      memberships: Array.isArray(memberships.data) ? memberships.data : null,
      profile: profile.data ?? null,
      clientAccounts: Array.isArray(clients.data) ? clients.data : null,
    });
  } catch { return false; }
}

export const RETURNING_VENDOR_LOGIN_FAILED = "VENDOR_WHATSAPP_LOGIN_FAILED" as const;
export type VendorWhatsappLoginResult =
  | { ok: true; code: "VENDOR_LOGIN_VERIFIED"; vendorId: string }
  | { ok: false; code: typeof RETURNING_VENDOR_LOGIN_FAILED };

export const vendorWhatsappReturningModeEnabled = () =>
  process.env.QF_RUNTIME_ENV === "staging" &&
  process.env.QF_VENDOR_RETURNING_LOGIN_MODE === "staging" &&
  process.env.QF_VENDOR_OTP_VERIFY_MODE === "staging" &&
  process.env.QF_VENDOR_OTP_EVIDENCE_READ_ENABLED === "staging" &&
  process.env.QF_VENDOR_OTP_REQUEST_MODE === "staging" &&
  process.env.QF_VENDOR_WHATSAPP_PROVIDER_CERTIFIED === "staging" &&
  process.env.QF_VENDOR_SHARED_SIGNED_HOOK_CERTIFIED === "staging" &&
  process.env.QF_VENDOR_TRUSTED_WHATSAPP_PROVIDER === "meta_whatsapp";

const CLOSED: VendorWhatsappLoginResult = { ok: false, code: RETURNING_VENDOR_LOGIN_FAILED };

export async function verifyReturningVendorWhatsappLogin(
  mobile: string, token: string,
): Promise<VendorWhatsappLoginResult> {
  if (!vendorWhatsappReturningModeEnabled()) return CLOSED;
  const normalized = normalizeVerifiedVendorMobile(mobile);
  if (!normalized || typeof token !== "string" || !/^[0-9]{6,8}$/.test(token)) return CLOSED;

  // The verifier does the real Supabase Auth verifyOtp, signed purpose, fresh
  // WhatsApp-only provider ledger, auth.getUser and cross-account inspections.
  // It invalidates its local Auth session on an attestation failure.
  const verified = await verifyVendorSignupWhatsappOtp(
    { mobile: normalized, token },
    { resolveApprovedProvider: async () =>
      vendorWhatsappReturningModeEnabled() ? "meta_whatsapp" : null },
  );
  if (!verified.ok) return CLOSED;

  // After verifyOtp an Auth cookie may already have been established. Every
  // subsequent denial MUST invalidate only this request's local session.
  const sb = await serverClient().catch(() => null);
  const deny = async (): Promise<VendorWhatsappLoginResult> => {
    if (sb) {
      try { await invalidateLocalSession(sb); } catch { /* deny regardless */ }
    }
    return CLOSED;
  };
  if (!sb) return CLOSED;
  try {
    if (!vendorWhatsappReturningModeEnabled() ||
      verified.decision.kind !== "resume_existing") return await deny();
    const { data, error } = await sb.auth.getUser();
    if (error || !data?.user ||
      data.user.id !== verified.authUserId ||
      data.user.phone !== "+91" + normalized ||
      !data.user.phone_confirmed_at) return await deny();

    // A valid phone OTP alone cannot adopt a different/suspended vendor.
    const access = await resolveVendorAccess(verified.authUserId);
    const admission = authorizeReturningVendorSession({
      verifiedAuthUserId: verified.authUserId,
      verifiedPhoneE164: data.user.phone,
      otpDecision: verified.decision,
      vendorAccess: access,
    });
    if (!admission.ok) return await deny();

    // Best-effort only; login security does not depend on telemetry delivery.
    try {
      if (access.ok) {
        // Source-only login metadata. The canonical principal and mapping ID
        // were resolved from the signed Auth session, never the request body.
        const now = new Date().toISOString();
        await adminClient().from("vendor_dashboard_users")
          .update({last_login_method:"whatsapp_otp",last_login_at:now,updated_at:now})
          .eq("id",access.context.vendorDashboardUserId)
          .eq("user_id",admission.authUserId)
          .eq("vendor_id",admission.vendorId);
        await recordAuthSecurityEvent({
          eventType: AuthSecurityEventType.VENDOR_LOGIN_SUCCESS,
          principalType: PrincipalType.VENDOR,
          principalId: admission.vendorId,
          actorUserId: admission.authUserId,
          metadata: { login_method: "whatsapp_otp", login_identifier_kind: "phone" },
        });
      }
    } catch { /* telemetry must never authorize or deny a vendor */ }
    return { ok: true, code: "VENDOR_LOGIN_VERIFIED", vendorId: admission.vendorId };
  } catch { return await deny(); }
}
