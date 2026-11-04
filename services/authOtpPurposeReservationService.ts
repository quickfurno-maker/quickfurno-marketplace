/**
 * Server-only OTP purpose reservation/claim adapter.
 *
 * The REST/Hook integration is intentionally NOT wired in this batch.
 * Requires the reviewed, source-pinned private SQL migration to be deployed,
 * and both client & vendor OTP request paths to reserve before the shared hook.
 *
 * Never logs phones, OTPs, phone hashes, webhook signatures or secrets.
 */
import "server-only";
import { createHmac, randomUUID } from "node:crypto";
import { adminClient } from "../lib/supabase";
import {
  AUTH_OTP_RESERVATION_TTL_SECONDS,
  isAuthOtpPhone,
  isAuthOtpPurpose,
  parseClaimedAuthOtpPurpose,
  type AuthOtpPurpose,
} from "../lib/identity/authOtpPurposePolicy";

type RpcResult = { data: unknown; error: { code?: string } | null };
type RpcDeps = {
  rpc(name: string, args: Record<string, string | number | null>): Promise<RpcResult>;
};
const defaultRpc: RpcDeps = {
  rpc: async (name, args) => {
    const { data, error } = await adminClient().rpc(name, args);
    return { data, error };
  },
};

function getPhoneDigest(phoneE164: unknown): string | null {
  if (!isAuthOtpPhone(phoneE164)) return null;
  // This is NOT plain SHA-256: phone numbers are a very small enumerable space.
  // Dedicated 256-bit+ secret, independent of message signing and Auth secrets.
  const encoded = process.env.QF_AUTH_OTP_PURPOSE_HMAC_KEY_BASE64;
  if (!encoded || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) return null;
  const secret = Buffer.from(encoded, "base64");
  if (secret.length < 32) return null;
  return createHmac("sha256", secret).update(phoneE164).digest("hex");
}

export type ReservedOtpPurpose = {
  readonly reservationId: string;
  readonly purpose: AuthOtpPurpose;
  readonly phoneDigest: string;
};

/**
 * Only server-side OTP request handlers may call this. The resulting digest
 * remains private; never send it to a browser. A conflicting purpose fails
 * rather than silently converting a client OTP to a vendor OTP.
 */
export async function reserveAuthOtpPurpose(
  phoneE164: string,
  purpose: AuthOtpPurpose,
  deps: RpcDeps = defaultRpc,
): Promise<ReservedOtpPurpose | null> {
  const phoneDigest = getPhoneDigest(phoneE164);
  if (!phoneDigest || !isAuthOtpPurpose(purpose)) return null;
  const reservationId = randomUUID();
  try {
    const { data, error } = await deps.rpc("qf_reserve_auth_otp_purpose", {
      p_phone_digest: phoneDigest,
      p_purpose: purpose,
      p_reservation_id: reservationId,
      p_ttl_seconds: AUTH_OTP_RESERVATION_TTL_SECONDS,
    });
    return !error && data === true ? { reservationId, purpose, phoneDigest } : null;
  } catch {
    return null; // missing migration / private RPC / DB outage => no OTP sent
  }
}

/**
 * Must only be called AFTER the common Auth Hook verifies Standard Webhooks
 * signature and payload. Without an active server reservation it returns null,
 * never falls back to client_login.
 */
export async function claimSignedAuthOtpPurpose(
  signed: { phoneE164: string; authUserId: string; verifiedWebhookId: string },
  deps: RpcDeps = defaultRpc,
): Promise<AuthOtpPurpose | null> {
  const digest = getPhoneDigest(signed.phoneE164);
  if (!digest || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(signed.authUserId) ||
      !signed.verifiedWebhookId || signed.verifiedWebhookId.length > 200) return null;
  try {
    const { data, error } = await deps.rpc("qf_claim_auth_otp_purpose", {
      p_phone_digest: digest,
      p_auth_user_id: signed.authUserId,
      p_verified_webhook_id: signed.verifiedWebhookId,
    });
    return error ? null : parseClaimedAuthOtpPurpose(data);
  } catch {
    return null;
  }
}

/** Called only after an unsuccessful pre-hook signInWithOtp request. */
export async function releaseUnclaimedAuthOtpPurpose(
  reservation: ReservedOtpPurpose, deps: RpcDeps = defaultRpc,
): Promise<boolean> {
  try {
    const { data, error } = await deps.rpc("qf_release_auth_otp_purpose", {
      p_phone_digest: reservation.phoneDigest,
      p_reservation_id: reservation.reservationId,
    });
    return !error && data === true;
  } catch {
    return false;
  }
}
