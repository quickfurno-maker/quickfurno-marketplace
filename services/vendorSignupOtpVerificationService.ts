/**
 * Server-only vendor signup OTP verifier — SOURCE ONLY, NO PUBLIC ROUTE.
 *
 * Reuses Supabase Auth phone OTP as the sole credential/session authority.
 * The existing shared signed Send SMS Hook must route vendor_login with an
 * independent provider/template gate BEFORE this may be externally exposed.
 *
 * Fail closed on EVERY Auth, purpose, delivery, account ownership or storage
 * fault. If verification may have created a request-scoped Supabase session,
 * discard only that LOCAL session on denial; never revoke other devices.
 *
 * This returns a verified preflight DECISION, not a DB transaction or access
 * grant. Atomic registration and dashboard/profile linking must still
 * re-check ownership under DB constraints and remain Pending by default.
 */
import "server-only";
import { serverClient } from "../lib/supabase";
import { normalizeVerifiedVendorMobile } from "../lib/vendors/vendorContactContract";
import { invalidateLocalSession } from "../lib/identity/sessionInvalidation";
import { evaluateVendorOtpAdmission } from "../lib/identity/vendorWhatsappOtpAdmission";
import { reconcileVerifiedVendorOwnership, type VendorOwnershipResolution } from "../lib/vendors/vendorSignupOwnershipReconciliation";
import { inspectVendorSignupOwnershipFromCurrentSession } from "./vendorSignupOwnershipReadService";
import { inspectVendorOtpEvidenceForCurrentSession } from "./vendorOtpEvidenceReadService";

export const VENDOR_SIGNUP_OTP_VERIFY_FAILED = "VENDOR_SIGNUP_OTP_VERIFY_FAILED";
export type VendorSignupOtpVerificationOutcome =
  | { readonly ok: true; readonly authUserId: string; readonly mobile10: string;
      readonly decision: Exclude<VendorOwnershipResolution, { kind: "deny" }> }
  | { readonly ok: false; readonly code: typeof VENDOR_SIGNUP_OTP_VERIFY_FAILED };

export interface VendorSignupOtpVerificationInput {
  readonly mobile: string;
  /** Never persist, log, hash, audit or return the Supabase OTP code. */
  readonly token: string;
}

/** Implement only with the server-side vendor provider/runtime gate. */
export interface TrustedVendorOtpRuntime {
  /** null means disabled/unproven. Browser input cannot establish a provider. */
  readonly resolveApprovedProvider: () => Promise<string | null>;
}
const CLOSED: VendorSignupOtpVerificationOutcome =
  Object.freeze({ ok: false, code: VENDOR_SIGNUP_OTP_VERIFY_FAILED });
const TOKEN = /^\d{6,8}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Operationally OFF with the default runtime. No provider or network sends.
 * A future authenticated route MUST obtain its runtime provider via trusted
 * server policy, and never pass any browser-supplied provider key.
 */
export async function verifyVendorSignupWhatsappOtp(
  input: VendorSignupOtpVerificationInput,
  runtime: TrustedVendorOtpRuntime = { resolveApprovedProvider: async () => null },
): Promise<VendorSignupOtpVerificationOutcome> {
  let sb: Awaited<ReturnType<typeof serverClient>> | null = null;
  let authAttempted = false;
  const deny = async (): Promise<VendorSignupOtpVerificationOutcome> => {
    if (authAttempted && sb) {
      try { await invalidateLocalSession(sb); } catch { /* still deny */ }
    }
    return CLOSED;
  };

  try {
    if (process.env.QF_VENDOR_OTP_VERIFY_MODE !== "staging") return CLOSED;
    const mobile10 = normalizeVerifiedVendorMobile(input?.mobile);
    if (!mobile10 || typeof input?.token !== "string" || !TOKEN.test(input.token)) return CLOSED;
    const phoneE164 = "+91" + mobile10;

    // Resolve the approved provider BEFORE consuming any code or establishing
    // a session; a disabled/unknown/mock adapter cannot prove WhatsApp OTP.
    const approvedProvider = await runtime.resolveApprovedProvider();
    if (!approvedProvider || !approvedProvider.trim() ||
        ["mock", "test", "fake", "local", "development"].includes(approvedProvider.trim().toLowerCase()))
      return CLOSED;

    sb = await serverClient();
    authAttempted = true;
    const { data: verified, error: otpError } = await sb.auth.verifyOtp({
      phone: phoneE164, token: input.token, type: "sms",
    });
    if (otpError || !verified?.user?.id || !UUID.test(verified.user.id)) return await deny();

    // Verify the exact session established by verifyOtp, never a decoded JWT,
    // request user_id, app_metadata role, or phone checkbox from the form.
    const { data: authenticated, error: userError } = await sb.auth.getUser();
    const user = authenticated?.user;
    if (userError || !user || user.id !== verified.user.id ||
        user.phone !== phoneE164 || !user.phone_confirmed_at) return await deny();

    const [ownership, evidence] = await Promise.all([
      inspectVendorSignupOwnershipFromCurrentSession(mobile10),
      inspectVendorOtpEvidenceForCurrentSession(phoneE164, approvedProvider),
    ]);
    if (!ownership || !evidence ||
        ownership.unsignedEvidence.authUserId !== user.id ||
        evidence.authUserId !== user.id || evidence.authPhoneE164 !== phoneE164) {
      return await deny();
    }

    // Unknown client account ownership is never treated as negative evidence.
    if (ownership.unsignedEvidence.existingClientAccount !== false) return await deny();
    const admission = evaluateVendorOtpAdmission({
      authUserId: user.id,
      authPhoneE164: user.phone,
      phoneConfirmedAt: user.phone_confirmed_at,
      expectedPhoneE164: phoneE164,
      // HMAC was generated independently in the service-role purpose reader,
      // then checked against its private RPC receipt.
      expectedPhoneDigest: evidence.purposeClaim.phoneDigest,
      expectedProvider: approvedProvider,
      purposeClaim: evidence.purposeClaim,
      existingProfileRole: ownership.unsignedEvidence.existingProfileRole,
      existingClientAccount: false, // explicitly proven absent by the signed-session lookup above
      delivery: evidence.delivery,
      nowMs: Date.now(),
    });
    if (!admission.admitted) return await deny();

    const decision = reconcileVerifiedVendorOwnership({
      ...ownership.unsignedEvidence,
      serverOtpAdmission: "admitted",
    }, ownership.snapshot);
    if (decision.kind === "deny") return await deny();

    // The verified result is INTERNAL. A separate, DB-atomic controller must
    // enforce one vendor/phone membership, consent and Pending status anew.
    return { ok: true, authUserId: user.id, mobile10, decision };
  } catch {
    return await deny();
  }
}
