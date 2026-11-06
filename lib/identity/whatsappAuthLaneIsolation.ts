/**
 * QuickFurno's locked, distinct WhatsApp sender identities.
 *
 * These are PUBLIC provider identifiers, not access tokens or secrets.
 * Caller-supplied WABA, phone, OTP purpose, and template cannot change lanes.
 * The checks are pure and operate before ANY send or provider invocation.
 */
import { AUTH_OTP_PURPOSE, type AuthOtpPurpose } from "./authOtpPurposePolicy";

export type WhatsappAuthLane = "client" | "vendor";
export interface WhatsappSenderIdentity {
  readonly wabaId: string;
  readonly phoneNumberId: string;
}
export const WHATSAPP_AUTH_LANE_IDENTITIES = Object.freeze({
  client: Object.freeze({
    wabaId: "27861262223494153",
    phoneNumberId: "1333595106493545",
  }),
  vendor: Object.freeze({
    wabaId: "1569174604351612",
    phoneNumberId: "1088396637681784",
  }),
} satisfies Record<WhatsappAuthLane, WhatsappSenderIdentity>);

export const WHATSAPP_AUTH_LANE_TEMPLATES = Object.freeze({
  client: "qf_client_auth_otp",
  vendor: "qf_vendor_auth_otp",
} satisfies Record<WhatsappAuthLane, string>);

const META_ID = /^[0-9]{10,24}$/;
export function isExactWhatsappSenderForLane(
  lane: WhatsappAuthLane,
  actual: WhatsappSenderIdentity | null | undefined,
): boolean {
  if (!actual || !META_ID.test(actual.wabaId ?? "") ||
    !META_ID.test(actual.phoneNumberId ?? "")) return false;
  const expected = WHATSAPP_AUTH_LANE_IDENTITIES[lane];
  const other = WHATSAPP_AUTH_LANE_IDENTITIES[lane === "client" ? "vendor" : "client"];
  return expected.wabaId !== other.wabaId &&
    expected.phoneNumberId !== other.phoneNumberId &&
    actual.wabaId === expected.wabaId &&
    actual.phoneNumberId === expected.phoneNumberId;
}

export function requiredWhatsappLaneForOtpPurpose(
  claimedPurpose: AuthOtpPurpose | null,
): WhatsappAuthLane | null {
  if (claimedPurpose === AUTH_OTP_PURPOSE.CLIENT_LOGIN) return "client";
  if (claimedPurpose === AUTH_OTP_PURPOSE.VENDOR_LOGIN) return "vendor";
  return null; // missing/uncertain reservation is NEVER a client login
}

export function canUseSignedClientOtpDispatch(
  claimedPurpose: AuthOtpPurpose | null,
  actual: WhatsappSenderIdentity | null | undefined,
): boolean {
  return requiredWhatsappLaneForOtpPurpose(claimedPurpose) === "client" &&
    isExactWhatsappSenderForLane("client", actual);
}

/**
 * In the current shared Hook the only wired send path is CLIENT/Riya.
 * When Staging attempts to certify vendor OTPs, force a signed purpose claim
 * and exact client sender guard before the existing client delivery path.
 * Vendor-purpose claims MUST be held until a distinct vendor transport,
 * private provider account, delivery ledger and quality gate are certified.
 * Never infer routing from a phone prefix or a browser role.
 */
export function mustEnforceSignedAuthLaneIsolation(
  env: Readonly<Record<string, string | undefined>>,
): boolean {
  return env.QF_VENDOR_SHARED_SIGNED_HOOK_CERTIFIED === "staging" ||
    env.QF_VENDOR_AUTH_LANE_ISOLATION_MODE === "staging";
}
