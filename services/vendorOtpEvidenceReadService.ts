/**
 * Source-only, read-only vendor WhatsApp OTP evidence inspection.
 *
 * Not a public endpoint, not a login, not a verifyOtp controller and NOT
 * registration admission. The future OTP verifier must consume the code via
 * request-scoped Supabase verifyOtp and establish its signed session BEFORE it
 * can feed this evidence into evaluateVendorOtpAdmission().
 *
 * Operationally OFF unless the exact Staging read flag is set. This routine
 * calls no Auth mutation, messaging provider, wallet, vendor insert or EOD job.
 * A missing private migration or a missing signed-purpose claim fails closed.
 */
import "server-only";
import { adminClient, serverClient } from "../lib/supabase";
import { hashPhoneE164 } from "../lib/communication/phone";
import { readClaimedVendorOtpPurpose } from "./authOtpPurposeReservationService";
import type {
  VendorOtpAdmissionEvidence,
  VendorOtpPurposeClaim,
} from "../lib/identity/vendorWhatsappOtpAdmission";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PHONE = /^\+91[6-9]\d{9}$/;
const AUTH_SUCCESS = ["accepted", "sent", "delivered", "read"];
type Delivery = NonNullable<VendorOtpAdmissionEvidence["delivery"]>;

export interface VendorOtpEvidenceReadResult {
  readonly authUserId: string;
  readonly authPhoneE164: string;
  readonly phoneConfirmedAt: string | null;
  readonly purposeClaim: VendorOtpPurposeClaim;
  readonly delivery: Delivery;
}

/**
 * Does not accept a user-id from the browser. providerRequired MUST originate
 * from a separately authorized live provider/automation gate, not the form.
 * Any unconfigured/ambiguous/missing result is DENIED, never client fallback.
 */
export async function inspectVendorOtpEvidenceForCurrentSession(
  expectedPhoneE164: string,
  providerRequired: string,
): Promise<VendorOtpEvidenceReadResult | null> {
  if (process.env.QF_VENDOR_OTP_EVIDENCE_READ_ENABLED !== "staging" ||
      !PHONE.test(expectedPhoneE164) ||
      typeof providerRequired !== "string" || !providerRequired.trim() ||
      ["mock", "fake", "test", "development", "local"].includes(providerRequired.trim().toLowerCase())) {
    return null;
  }
  try {
    const sb = await serverClient();
    const { data: auth, error: authError } = await sb.auth.getUser();
    const user = auth?.user;
    if (authError || !user || !UUID.test(user.id) ||
        user.phone !== expectedPhoneE164 || !user.phone_confirmed_at) return null;

    // Signed private vendor-purpose claim binds the exact phone's server HMAC,
    // Auth user id, and the signed Supabase webhook id. No browser-supplied
    // purpose or client OTP record is accepted.
    const claim = await readClaimedVendorOtpPurpose(expectedPhoneE164, user.id);
    if (!claim) return null;
    const destinationHash = hashPhoneE164(expectedPhoneE164);

    const { data, error } = await adminClient()
      .from("communication_messages")
      .select("message_type,lane,channel,recipient_type,entity_type,entity_id,destination_hash,provider,correlation_id,status,created_at")
      .eq("message_type", "vendor_login_otp")
      .eq("lane", "authentication")
      .eq("channel", "whatsapp")
      .eq("recipient_type", "vendor")
      .eq("entity_type", "auth_user")
      .eq("entity_id", user.id)
      .eq("destination_hash", destinationHash)
      .eq("provider", providerRequired)
      .eq("correlation_id", claim.verifiedWebhookId)
      .in("status", AUTH_SUCCESS)
      .order("created_at", { ascending: false })
      .limit(2);

    if (error || !Array.isArray(data) || data.length !== 1) return null;
    const row = data[0] as Record<string, unknown>;
    // Defence in depth against a lenient or mocked query layer.
    if (row.message_type !== "vendor_login_otp" || row.lane !== "authentication" ||
        row.channel !== "whatsapp" || row.recipient_type !== "vendor" ||
        row.entity_type !== "auth_user" || row.entity_id !== user.id ||
        row.destination_hash !== destinationHash ||
        row.provider !== providerRequired ||
        row.correlation_id !== claim.verifiedWebhookId ||
        !AUTH_SUCCESS.includes(String(row.status)) ||
        typeof row.created_at !== "string") return null;

    return {
      authUserId: user.id,
      authPhoneE164: expectedPhoneE164,
      phoneConfirmedAt: user.phone_confirmed_at,
      purposeClaim: claim,
      // "deliveredAt" in the pure contract is the successful ledger record
      // creation timestamp, not a claim of a provider's delivered receipt.
      delivery: {
        authUserId: user.id,
        phoneE164: expectedPhoneE164,
        messageType: "vendor_login_otp",
        channel: "whatsapp",
        provider: providerRequired,
        status: String(row.status),
        verifiedWebhookId: claim.verifiedWebhookId,
        deliveredAt: row.created_at,
      },
    };
  } catch {
    return null;
  }
}
